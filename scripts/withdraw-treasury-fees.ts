/**
 * Collect Treasury Fees Script
 * 
 * Collects 10% treasury fees from losers in ended arenas.
 * INDEPENDENT of whether winners have claimed - treasury can collect anytime.
 * 
 * Usage:
 *   npx ts-node scripts/withdraw-treasury-fees.ts              # All ended arenas
 *   npx ts-node scripts/withdraw-treasury-fees.ts --arena=25   # Specific arena
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { CryptarenaSvmTest } from "../target/types/cryptarena_svm_test";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountInstruction, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Load IDL
const idlPath = path.join(__dirname, "../target/idl/cryptarena_svm_test.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

// Config
const RPC_URL = "https://devnet.helius-rpc.com/?api-key=aef82c1e-d2b4-4c37-90c9-7bb84228d5cf";
const PROGRAM_ID = new PublicKey("2LsREShXRB5GMera37czrEKwe5xt9FUnKAjwpW183ce9");

// Token mints
const TOKEN_MINTS_PATH = path.join(__dirname, "../test-wallets/token-mints.json");
const TOKEN_MINTS: { [key: string]: string } = JSON.parse(fs.readFileSync(TOKEN_MINTS_PATH, "utf8"));

const ASSET_NAMES = ["SOL", "TRUMP", "PUMP", "BONK", "JUP", "PENGU", "PYTH", "HNT", "FARTCOIN", "RAY", "JTO", "KMNO", "MET", "W"];

// Token decimals for each asset (index matches ASSET_NAMES)
const TOKEN_DECIMALS: { [key: number]: number } = {
  0: 9,   // SOL
  1: 9,   // TRUMP
  2: 9,   // PUMP
  3: 9,   // BONK
  4: 9,   // JUP
  5: 9,   // PENGU
  6: 9,   // PYTH
  7: 9,   // HNT
  8: 9,   // FARTCOIN
  9: 9,   // RAY
  10: 9,  // JTO
  11: 9,  // KMNO
  12: 9,  // MET
  13: 9,  // W
};

// Format raw amount to human-readable with proper decimals
function formatAmount(rawAmount: bigint | number, decimals: number): string {
  const raw = typeof rawAmount === 'bigint' ? rawAmount : BigInt(rawAmount);
  const divisor = BigInt(10 ** decimals);
  const wholePart = raw / divisor;
  const fractionalPart = raw % divisor;
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, 4); // Show 4 decimal places
  return `${wholePart.toLocaleString()}.${fractionalStr}`;
}

// PlayerEntry discriminator
const PLAYER_ENTRY_DISCRIMINATOR = Buffer.from([158, 6, 39, 104, 234, 4, 153, 255]);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTokenBalance(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const account = await getAccount(connection, ata);
    return account.amount;
  } catch {
    return 0n;
  }
}

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("💰 COLLECT TREASURY FEES");
  console.log("═".repeat(80) + "\n");

  // Load admin keypair
  const adminPath = path.join(process.env.HOME || "", ".config/solana/id.json");
  const adminKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(adminPath, "utf8")))
  );

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = new Program<CryptarenaSvmTest>(idl, provider);

  console.log(`📋 Program ID: ${PROGRAM_ID.toString()}`);
  console.log(`👤 Admin/Treasury: ${adminKeypair.publicKey.toString()}`);

  // Get global state
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state_v2")],
    PROGRAM_ID
  );
  
  const globalState = await program.account.globalState.fetch(globalStatePda);
  console.log(`📊 Current Arena ID: ${globalState.currentArenaId.toString()}\n`);

  // Parse args
  const args = process.argv.slice(2);
  const arenaArg = args.find(a => a.startsWith('--arena='));
  
  let startArenaId = 1;
  let endArenaId = (globalState.currentArenaId as anchor.BN).toNumber();
  
  if (arenaArg) {
    const arenaId = parseInt(arenaArg.split('=')[1]);
    startArenaId = arenaId;
    endArenaId = arenaId;
    console.log(`🎯 Processing only Arena ${arenaId}\n`);
  }

  // Get BEFORE balances for all tokens
  console.log("─".repeat(60));
  console.log("📊 BALANCES BEFORE");
  console.log("─".repeat(60));
  
  const balancesBefore: { [token: string]: bigint } = {};
  for (let i = 0; i < ASSET_NAMES.length; i++) {
    const tokenName = ASSET_NAMES[i];
    const mintAddress = TOKEN_MINTS[i.toString()];
    if (!mintAddress) continue;
    
    const mint = new PublicKey(mintAddress);
    const balance = await getTokenBalance(connection, adminKeypair.publicKey, mint);
    balancesBefore[tokenName] = balance;
    
    if (balance > 0n) {
      const decimals = TOKEN_DECIMALS[i] || 9;
      console.log(`   ${tokenName.padEnd(10)}: ${formatAmount(balance, decimals)} ${tokenName}`);
    }
  }
  console.log("");

  // Get ALL player entries from the program
  console.log("🔍 Fetching all player entries...");
  const allProgramAccounts = await connection.getProgramAccounts(PROGRAM_ID);
  const playerEntryAccounts = allProgramAccounts.filter(acc => {
    if (acc.account.data.length < 8) return false;
    return acc.account.data.slice(0, 8).equals(PLAYER_ENTRY_DISCRIMINATOR);
  });
  
  console.log(`   Found ${playerEntryAccounts.length} player entries total\n`);

  // Stats
  const feesCollected: { [token: string]: number } = {};
  let totalLosers = 0;
  let alreadyClaimed = 0;
  let arenaCount = 0;
  let errors = 0;

  // Process arenas
  for (let arenaId = startArenaId; arenaId <= endArenaId; arenaId++) {
    const arenaBN = new anchor.BN(arenaId);
    const [arenaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_v2"), arenaBN.toArrayLike(Buffer, "le", 8)],
      PROGRAM_ID
    );

    try {
      const arena = await program.account.arena.fetch(arenaPda);
      
      // Only process Ended arenas
      if (arena.status !== 4) {
        console.log(`⏭️  Arena ${arenaId} - Status: ${arena.status} (not ended, skipping)`);
        continue;
      }

      console.log(`${"─".repeat(60)}`);
      console.log(`🏟️  Arena ${arenaId} | Winner: ${ASSET_NAMES[arena.winningAsset]} | Players: ${arena.playerCount}`);

      arenaCount++;

      // Filter player entries for this arena
      const arenaEntries = playerEntryAccounts.filter(acc => {
        // Arena pubkey is at offset 8 (after discriminator)
        const entryArena = new PublicKey(acc.account.data.slice(8, 40));
        return entryArena.equals(arenaPda);
      });

      console.log(`   Found ${arenaEntries.length} player entries for this arena`);

      for (const entry of arenaEntries) {
        try {
          const playerEntry = await program.account.playerEntry.fetch(entry.pubkey);
          
          // Skip winners
          if (playerEntry.assetIndex === arena.winningAsset) {
            console.log(`   ⭐ Player ${playerEntry.playerIndex} (${ASSET_NAMES[playerEntry.assetIndex]}) - WINNER, skipping`);
            continue;
          }

          // Skip if already claimed
          if (playerEntry.treasuryFeeClaimed) {
            console.log(`   ✓ Player ${playerEntry.playerIndex} (${ASSET_NAMES[playerEntry.assetIndex]}) - Already claimed`);
            alreadyClaimed++;
            continue;
          }

          const assetName = ASSET_NAMES[playerEntry.assetIndex];
          const mintAddress = TOKEN_MINTS[playerEntry.assetIndex.toString()];
          if (!mintAddress) {
            console.log(`   ⚠️ Player ${playerEntry.playerIndex} (${assetName}) - No mint address found`);
            continue;
          }

          const mint = new PublicKey(mintAddress);
          const arenaVault = await getAssociatedTokenAddress(mint, arenaPda, true);
          
          // Create ATA if it doesn't exist
          let adminAta: PublicKey;
          try {
            const ataAccount = await getOrCreateAssociatedTokenAccount(
              connection,
              adminKeypair,
              mint,
              adminKeypair.publicKey
            );
            adminAta = ataAccount.address;
          } catch (ataErr: any) {
            console.log(`      ⚠️ Could not create ATA: ${ataErr.message?.slice(0, 50)}`);
            continue;
          }

          const amount = (playerEntry.amount as anchor.BN).toNumber();
          const treasuryFee = Math.floor(amount * 0.1);
          const decimals = TOKEN_DECIMALS[playerEntry.assetIndex] || 9;

          console.log(`   💸 Loser ${playerEntry.playerIndex} (${assetName}): ${formatAmount(treasuryFee, decimals)} ${assetName}`);

          try {
            const tx = await program.methods
              .collectTreasuryFee()
              .accountsStrict({
                globalState: globalStatePda,
                arena: arenaPda,
                loserEntry: entry.pubkey,
                arenaVault: arenaVault,
                treasuryTokenAccount: adminAta,
                admin: adminKeypair.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
              })
              .signers([adminKeypair])
              .rpc();

            feesCollected[assetName] = (feesCollected[assetName] || 0) + treasuryFee;
            totalLosers++;
            console.log(`      ✅ Collected! TX: ${tx.slice(0, 20)}...`);
          } catch (err: any) {
            errors++;
            console.log(`      ❌ ERROR: ${err.message?.slice(0, 80)}`);
            if (err.logs) {
              console.log(`      📋 Logs: ${err.logs.slice(-2).join(' | ')}`);
            }
          }

          await sleep(500);
        } catch (decodeErr: any) {
          console.log(`   ⚠️ Could not decode entry ${entry.pubkey.toString().slice(0, 10)}...: ${decodeErr.message?.slice(0, 50)}`);
        }
      }
    } catch (fetchErr: any) {
      if (arenaArg) {
        console.log(`❌ Arena ${arenaId} not found or error: ${fetchErr.message?.slice(0, 50)}`);
      }
      // Arena doesn't exist, skip silently for range scans
    }
  }

  // Get AFTER balances for all tokens
  console.log("\n" + "─".repeat(60));
  console.log("📊 BALANCES AFTER");
  console.log("─".repeat(60));
  
  const balancesAfter: { [token: string]: bigint } = {};
  for (let i = 0; i < ASSET_NAMES.length; i++) {
    const tokenName = ASSET_NAMES[i];
    const mintAddress = TOKEN_MINTS[i.toString()];
    if (!mintAddress) continue;
    
    const mint = new PublicKey(mintAddress);
    const balance = await getTokenBalance(connection, adminKeypair.publicKey, mint);
    balancesAfter[tokenName] = balance;
    
    if (balance > 0n || balancesBefore[tokenName] > 0n) {
      const decimals = TOKEN_DECIMALS[i] || 9;
      console.log(`   ${tokenName.padEnd(10)}: ${formatAmount(balance, decimals)} ${tokenName}`);
    }
  }

  // Summary with balance changes
  console.log("\n" + "═".repeat(80));
  console.log("📊 SUMMARY");
  console.log("═".repeat(80));
  console.log(`   Arenas processed: ${arenaCount}`);
  console.log(`   Losers collected from: ${totalLosers}`);
  console.log(`   Already collected (skipped): ${alreadyClaimed}`);
  console.log(`   Errors: ${errors}`);
  
  // Calculate and show balance changes
  console.log("\n   💰 Balance Changes:");
  let hasChanges = false;
  
  for (let i = 0; i < ASSET_NAMES.length; i++) {
    const tokenName = ASSET_NAMES[i];
    const before = balancesBefore[tokenName] || 0n;
    const after = balancesAfter[tokenName] || 0n;
    const diff = after - before;
    
    if (diff !== 0n) {
      hasChanges = true;
      const decimals = TOKEN_DECIMALS[i] || 9;
      const sign = diff > 0n ? "+" : "";
      console.log(`      ${tokenName.padEnd(10)}: ${formatAmount(before, decimals)} → ${formatAmount(after, decimals)} (${sign}${formatAmount(diff, decimals)} ${tokenName})`);
    }
  }
  
  if (!hasChanges) {
    console.log("      No balance changes.");
  }
  
  console.log("\n" + "═".repeat(80));
  console.log("✅ DONE!");
  console.log("═".repeat(80) + "\n");
}

main().catch(console.error);

