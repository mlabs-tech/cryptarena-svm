/**
 * Claim Arena Winnings Script
 * 
 * Claims 90% of loser tokens for a winner in an ended arena.
 * 
 * Usage:
 *   npx ts-node scripts/claim-arena-winnings.ts --arena=25 --player=9
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { CryptarenaSvmTest } from "../target/types/cryptarena_svm_test";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getAccount, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
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

// Token decimals
const TOKEN_DECIMALS: { [key: number]: number } = {
  0: 9, 1: 9, 2: 9, 3: 9, 4: 9, 5: 9, 6: 9, 7: 9, 8: 9, 9: 9, 10: 9, 11: 9, 12: 9, 13: 9,
};

// PlayerEntry discriminator
const PLAYER_ENTRY_DISCRIMINATOR = Buffer.from([158, 6, 39, 104, 234, 4, 153, 255]);

function formatAmount(rawAmount: bigint | number, decimals: number): string {
  const raw = typeof rawAmount === 'bigint' ? rawAmount : BigInt(rawAmount);
  const divisor = BigInt(10 ** decimals);
  const wholePart = raw / divisor;
  const fractionalPart = raw % divisor;
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, 4);
  return `${wholePart.toLocaleString()}.${fractionalStr}`;
}

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
  console.log("🏆 CLAIM ARENA WINNINGS");
  console.log("═".repeat(80) + "\n");

  // Parse args
  const args = process.argv.slice(2);
  const arenaArg = args.find(a => a.startsWith('--arena='));
  const playerArg = args.find(a => a.startsWith('--player='));

  if (!arenaArg || !playerArg) {
    console.log("Usage: npx ts-node scripts/claim-arena-winnings.ts --arena=25 --player=9");
    console.log("       --arena=<id>   Arena ID to claim from");
    console.log("       --player=<n>   Player number (1-10)");
    return;
  }

  const arenaId = parseInt(arenaArg.split('=')[1]);
  const playerNum = parseInt(playerArg.split('=')[1]);

  if (playerNum < 1 || playerNum > 10) {
    console.log("❌ Player must be between 1 and 10");
    return;
  }

  // Load player keypair
  const playerPath = path.join(__dirname, `../test-wallets/player${playerNum}.json`);
  if (!fs.existsSync(playerPath)) {
    console.log(`❌ Player wallet not found: ${playerPath}`);
    return;
  }
  const playerKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(playerPath, "utf8")))
  );

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(playerKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = new Program<CryptarenaSvmTest>(idl, provider);

  console.log(`📋 Program ID: ${PROGRAM_ID.toString()}`);
  console.log(`🎯 Arena: ${arenaId}`);
  console.log(`👤 Player ${playerNum}: ${playerKeypair.publicKey.toString()}`);

  // Get global state
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state_v2")],
    PROGRAM_ID
  );

  // Get arena
  const arenaBN = new anchor.BN(arenaId);
  const [arenaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena_v2"), arenaBN.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );

  const arena = await program.account.arena.fetch(arenaPda);
  
  if (arena.status !== 4) {
    console.log(`❌ Arena ${arenaId} is not ended (status: ${arena.status})`);
    return;
  }

  console.log(`\n🏟️  Arena ${arenaId} | Winner Asset: ${ASSET_NAMES[arena.winningAsset]} | Players: ${arena.playerCount}`);

  // Get winner's entry
  const [winnerEntryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("player_entry_v2"), arenaPda.toBuffer(), playerKeypair.publicKey.toBuffer()],
    PROGRAM_ID
  );

  let winnerEntry;
  try {
    winnerEntry = await program.account.playerEntry.fetch(winnerEntryPda);
  } catch {
    console.log(`❌ Player ${playerNum} did not participate in arena ${arenaId}`);
    return;
  }

  if (winnerEntry.assetIndex !== arena.winningAsset) {
    console.log(`❌ Player ${playerNum} is not a winner (entered with ${ASSET_NAMES[winnerEntry.assetIndex]}, winner is ${ASSET_NAMES[arena.winningAsset]})`);
    return;
  }

  console.log(`✅ Player ${playerNum} is a WINNER!\n`);

  // Get all player entries for this arena
  const allProgramAccounts = await connection.getProgramAccounts(PROGRAM_ID);
  const playerEntryAccounts = allProgramAccounts.filter(acc => {
    if (acc.account.data.length < 8) return false;
    return acc.account.data.slice(0, 8).equals(PLAYER_ENTRY_DISCRIMINATOR);
  });

  const arenaEntries = playerEntryAccounts.filter(acc => {
    const entryArena = new PublicKey(acc.account.data.slice(8, 40));
    return entryArena.equals(arenaPda);
  });

  // Get arena asset (for winner count)
  const [arenaAssetPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena_asset_v2"), arenaPda.toBuffer(), Buffer.from([arena.winningAsset])],
    PROGRAM_ID
  );

  // Track balances before
  console.log("─".repeat(60));
  console.log("📊 BALANCES BEFORE");
  console.log("─".repeat(60));
  
  const balancesBefore: { [token: string]: bigint } = {};
  for (let i = 0; i < ASSET_NAMES.length; i++) {
    const tokenName = ASSET_NAMES[i];
    const mintAddress = TOKEN_MINTS[i.toString()];
    if (!mintAddress) continue;
    
    const mint = new PublicKey(mintAddress);
    const balance = await getTokenBalance(connection, playerKeypair.publicKey, mint);
    balancesBefore[tokenName] = balance;
    
    if (balance > 0n) {
      const decimals = TOKEN_DECIMALS[i] || 9;
      console.log(`   ${tokenName.padEnd(10)}: ${formatAmount(balance, decimals)} ${tokenName}`);
    }
  }
  console.log("");

  // Claim from each loser
  let claimed = 0;
  let alreadyClaimed = 0;
  let errors = 0;

  console.log("─".repeat(60));
  console.log("💰 CLAIMING FROM LOSERS");
  console.log("─".repeat(60));

  for (const entry of arenaEntries) {
    try {
      const loserEntry = await program.account.playerEntry.fetch(entry.pubkey);
      
      // Skip winners
      if (loserEntry.assetIndex === arena.winningAsset) {
        continue;
      }

      // Check if already claimed from this loser (using bitmap)
      const loserBit = 1n << BigInt(loserEntry.playerIndex);
      const rewardsBitmap = BigInt(winnerEntry.rewardsClaimedBitmap.toString());
      if ((rewardsBitmap & loserBit) !== 0n) {
        console.log(`   ✓ Already claimed from Player ${loserEntry.playerIndex} (${ASSET_NAMES[loserEntry.assetIndex]})`);
        alreadyClaimed++;
        continue;
      }

      const assetName = ASSET_NAMES[loserEntry.assetIndex];
      const mintAddress = TOKEN_MINTS[loserEntry.assetIndex.toString()];
      if (!mintAddress) continue;

      const mint = new PublicKey(mintAddress);
      const arenaVault = await getAssociatedTokenAddress(mint, arenaPda, true);
      
      // Create winner's ATA if needed
      let winnerAta: PublicKey;
      try {
        const ataAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          playerKeypair,
          mint,
          playerKeypair.publicKey
        );
        winnerAta = ataAccount.address;
      } catch (ataErr: any) {
        console.log(`   ⚠️ Could not create ATA for ${assetName}: ${ataErr.message?.slice(0, 50)}`);
        continue;
      }

      const amount = (loserEntry.amount as anchor.BN).toNumber();
      const winnerReward = Math.floor(amount * 0.9); // 90% to winner
      const decimals = TOKEN_DECIMALS[loserEntry.assetIndex] || 9;

      console.log(`   💸 Claiming from Loser ${loserEntry.playerIndex} (${assetName}): ${formatAmount(winnerReward, decimals)} ${assetName}`);

      try {
        const tx = await program.methods
          .claimLoserTokens()
          .accountsStrict({
            globalState: globalStatePda,
            arena: arenaPda,
            arenaAsset: arenaAssetPda,
            winnerEntry: winnerEntryPda,
            loserEntry: entry.pubkey,
            arenaVault: arenaVault,
            winnerTokenAccount: winnerAta,
            winner: playerKeypair.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([playerKeypair])
          .rpc();

        claimed++;
        console.log(`      ✅ Claimed! TX: ${tx.slice(0, 20)}...`);

        // Refresh winner entry to get updated bitmap
        winnerEntry = await program.account.playerEntry.fetch(winnerEntryPda);
      } catch (err: any) {
        errors++;
        console.log(`      ❌ ERROR: ${err.message?.slice(0, 80)}`);
        if (err.logs) {
          console.log(`      📋 Logs: ${err.logs.slice(-2).join(' | ')}`);
        }
      }

      await sleep(500);
    } catch (decodeErr: any) {
      // Skip non-player entries
    }
  }

  // Get balances after
  console.log("\n" + "─".repeat(60));
  console.log("📊 BALANCES AFTER");
  console.log("─".repeat(60));
  
  const balancesAfter: { [token: string]: bigint } = {};
  for (let i = 0; i < ASSET_NAMES.length; i++) {
    const tokenName = ASSET_NAMES[i];
    const mintAddress = TOKEN_MINTS[i.toString()];
    if (!mintAddress) continue;
    
    const mint = new PublicKey(mintAddress);
    const balance = await getTokenBalance(connection, playerKeypair.publicKey, mint);
    balancesAfter[tokenName] = balance;
    
    if (balance > 0n || balancesBefore[tokenName] > 0n) {
      const decimals = TOKEN_DECIMALS[i] || 9;
      console.log(`   ${tokenName.padEnd(10)}: ${formatAmount(balance, decimals)} ${tokenName}`);
    }
  }

  // Summary
  console.log("\n" + "═".repeat(80));
  console.log("📊 SUMMARY");
  console.log("═".repeat(80));
  console.log(`   Claimed from: ${claimed} losers`);
  console.log(`   Already claimed: ${alreadyClaimed}`);
  console.log(`   Errors: ${errors}`);

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

