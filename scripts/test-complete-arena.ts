/**
 * TEST: Complete Existing Arena
 * 
 * This script completes an arena that already has some players.
 * It adds remaining players, sets prices, waits, finalizes, and claims rewards.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaSvmTest } from "../target/types/cryptarena_svm_test";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import https from "https";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CMC_API_KEY = "ef3cc5e80cc848ceba20b3c7cba60d5d";
const ASSET_NAMES = ["SOL", "TRUMP", "PUMP", "BONK", "JUP", "PENGU", "PYTH", "HNT", "FARTCOIN", "RAY"];

// ============================================================================
// HELPERS
// ============================================================================

function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ARENA_STATUS: { [key: number]: string } = {
  0: "Uninitialized", 1: "Waiting", 2: "Ready", 3: "Active",
  4: "Ended", 5: "Suspended", 6: "Starting", 7: "Ending",
};

async function fetchPrices(symbols: string[]): Promise<{ [key: string]: number }> {
  return new Promise((resolve) => {
    const symbolList = symbols.join(",");
    const options = {
      hostname: "pro-api.coinmarketcap.com",
      path: `/v1/cryptocurrency/quotes/latest?symbol=${symbolList}`,
      method: "GET",
      headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY, "Accept": "application/json" },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const prices: { [key: string]: number } = {};
          for (const symbol of symbols) {
            if (json.data?.[symbol]?.quote?.USD?.price) {
              prices[symbol] = json.data[symbol].quote.USD.price;
            }
          }
          resolve(prices);
        } catch { resolve({}); }
      });
    });
    req.on("error", () => resolve({}));
    req.end();
  });
}

function priceToOnchain(price: number): anchor.BN {
  return new anchor.BN(Math.floor(price * 1e8));
}

async function getTokenBalance(connection: any, mint: PublicKey, owner: PublicKey): Promise<number> {
  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const account = await getAccount(connection, ata);
    return Number(account.amount) / 1e9;
  } catch {
    return 0;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🏟️  COMPLETE EXISTING ARENA");
  console.log("═".repeat(80) + "\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.CryptarenaSvmTest as Program<CryptarenaSvmTest>;
  const admin = (provider.wallet as any).payer as Keypair;
  const treasuryWallet = admin.publicKey;

  // Load wallets and mints
  const walletDir = path.join(__dirname, "../test-wallets");
  const players: Keypair[] = [];
  
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    if (fs.existsSync(walletPath)) {
      players.push(loadKeypair(walletPath));
    }
  }

  const mintsFilePath = path.join(walletDir, "token-mints-admin.json");
  const tokenMints: { [key: number]: PublicKey } = {};
  const existingMints = JSON.parse(fs.readFileSync(mintsFilePath, "utf-8"));
  for (const [key, value] of Object.entries(existingMints)) {
    tokenMints[parseInt(key)] = new PublicKey(value as string);
  }

  // PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state_v2")],
    program.programId
  );

  const globalState = await program.account.globalState.fetch(globalStatePda);
  
  // Get current arena (the one that's waiting for more players)
  // We need to check arenas starting from currentArenaId - 1 (current might be empty)
  let arenaId = globalState.currentArenaId;
  let arenaPda: PublicKey;
  let arena: any;

  // Try current arena first, then previous if current doesn't exist
  for (let tryId = arenaId.toNumber(); tryId >= 0; tryId--) {
    const tryArenaId = new anchor.BN(tryId);
    const [tryArenaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_v2"), tryArenaId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    
    try {
      arena = await program.account.arena.fetch(tryArenaPda);
      if (arena.status === 1) { // Waiting status
        arenaId = tryArenaId;
        arenaPda = tryArenaPda;
        console.log(`📍 Found waiting arena: ID ${tryId}`);
        break;
      }
    } catch {
      continue;
    }
  }

  if (!arena || arena.status !== 1) {
    console.log("❌ No waiting arena found. Run test-max-same-asset.ts first to create one.");
    return;
  }

  arenaPda = PublicKey.findProgramAddressSync(
    [Buffer.from("arena_v2"), arenaId.toArrayLike(Buffer, "le", 8)],
    program.programId
  )[0];

  console.log(`\n📊 CURRENT ARENA STATE:`);
  console.log(`   Arena ID: ${arena.id.toString()}`);
  console.log(`   Status: ${ARENA_STATUS[arena.status]}`);
  console.log(`   Players: ${arena.playerCount}/10`);
  console.log(`   Assets: ${arena.assetCount}`);
  console.log(`   Total Pool: $${(arena.totalPool.toNumber() / 1_000_000).toFixed(2)}`);

  // Track existing players and their assets
  const existingAssets = new Set<number>();
  const arenaAssetPdas: { [key: number]: PublicKey } = {};
  const playerEntries: { player: Keypair; pda: PublicKey; assetIndex: number }[] = [];

  // Check which assets are already in the arena
  for (let i = 0; i < 14; i++) {
    const [assetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_asset_v2"), arenaPda.toBuffer(), Buffer.from([i])],
      program.programId
    );
    
    try {
      const assetData = await program.account.arenaAsset.fetch(assetPda);
      if (assetData.playerCount > 0) {
        existingAssets.add(i);
        arenaAssetPdas[i] = assetPda;
        console.log(`   - Asset ${i} (${ASSET_NAMES[i]}): ${assetData.playerCount} players`);
      }
    } catch {}
  }

  // ================================================================
  // ADD REMAINING PLAYERS
  // ================================================================
  const playersNeeded = 10 - arena.playerCount;
  console.log("\n" + "═".repeat(80));
  console.log(`ADDING ${playersNeeded} MORE PLAYERS TO FILL ARENA`);
  console.log("═".repeat(80) + "\n");

  const USD_ENTRY = new anchor.BN(15_000_000);
  let playerIndex = arena.playerCount; // Start from existing count

  // Use different assets for remaining players (skip SOL since 3 already have it)
  const assetsToUse = [1, 2, 3, 4, 5, 6, 7]; // TRUMP, PUMP, BONK, JUP, PENGU, PYTH, HNT

  for (let i = 0; i < playersNeeded && i < assetsToUse.length; i++) {
    const player = players[playerIndex + i]; // Use players 4-10
    const assetIndex = assetsToUse[i];
    const assetName = ASSET_NAMES[assetIndex];
    
    console.log(`👤 Player ${playerIndex + i + 1} entering with ${assetName}...`);

    try {
      const mint = tokenMints[assetIndex];
      const playerAta = await getAssociatedTokenAddress(mint, player.publicKey);
      
      let tokenBalance = BigInt(0);
      try {
        const tokenAccount = await getAccount(connection, playerAta);
        tokenBalance = tokenAccount.amount;
      } catch {
        console.log(`   ❌ No token account`);
        continue;
      }

      const arenaVault = await getAssociatedTokenAddress(mint, arenaPda, true);
      
      const [playerEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player_entry_v2"), arenaPda.toBuffer(), player.publicKey.toBuffer()],
        program.programId
      );

      const [arenaAssetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("arena_asset_v2"), arenaPda.toBuffer(), Buffer.from([assetIndex])],
        program.programId
      );
      arenaAssetPdas[assetIndex] = arenaAssetPda;

      const tokenAmount = new anchor.BN(Number(tokenBalance) / 100);

      const tx = new Transaction();
      
      try {
        await getAccount(connection, arenaVault);
      } catch {
        tx.add(createAssociatedTokenAccountInstruction(admin.publicKey, arenaVault, arenaPda, mint));
      }

      const enterIx = await program.methods
        .enterArena(assetIndex, tokenAmount, USD_ENTRY)
        .accountsStrict({
          globalState: globalStatePda,
          arena: arenaPda,
          arenaAsset: arenaAssetPda,
          playerEntry: playerEntryPda,
          playerTokenAccount: playerAta,
          arenaVault: arenaVault,
          player: player.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .instruction();
      
      tx.add(enterIx);

      await sendAndConfirmTransaction(connection, tx, [admin, player], { skipPreflight: true });

      playerEntries.push({ player, pda: playerEntryPda, assetIndex });
      console.log(`   ✅ Entered with ${(Number(tokenAmount) / 1e9).toFixed(4)} ${assetName}`);

    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message?.slice(0, 60) || error}`);
    }

    await sleep(1000);
  }

  // Refresh arena state
  arena = await program.account.arena.fetch(arenaPda);
  console.log(`\n📊 Arena Status: ${ARENA_STATUS[arena.status]} | Players: ${arena.playerCount}/10`);

  if (arena.status !== 2) { // Not Ready yet
    console.log("⚠️  Arena not full yet. Need more players.");
    return;
  }

  console.log("\n🏁 ARENA FULL! Proceeding to set prices...\n");

  // ================================================================
  // SET START PRICES
  // ================================================================
  console.log("═".repeat(80));
  console.log("SETTING START PRICES");
  console.log("═".repeat(80) + "\n");

  const startPrices = await fetchPrices(ASSET_NAMES);
  const assetsInArena: number[] = [];

  // Get all assets in this arena
  for (let i = 0; i < 14; i++) {
    const [assetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_asset_v2"), arenaPda.toBuffer(), Buffer.from([i])],
      program.programId
    );
    
    try {
      const assetData = await program.account.arenaAsset.fetch(assetPda);
      if (assetData.playerCount > 0) {
        assetsInArena.push(i);
        arenaAssetPdas[i] = assetPda;
      }
    } catch {}
  }

  for (const assetIndex of assetsInArena) {
    const assetName = ASSET_NAMES[assetIndex];
    const price = startPrices[assetName] || 1;
    const onchainPrice = priceToOnchain(price);
    
    try {
      await program.methods
        .setStartPrice(onchainPrice)
        .accountsStrict({
          globalState: globalStatePda,
          arena: arenaPda,
          arenaAsset: arenaAssetPdas[assetIndex],
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
      
      console.log(`   ✅ ${assetName.padEnd(10)}: $${price.toFixed(4)}`);
    } catch (error: any) {
      console.log(`   ⚠️ ${assetName}: ${error.message?.slice(0, 40)}`);
    }
    await sleep(500);
  }

  arena = await program.account.arena.fetch(arenaPda);
  console.log(`\n📊 Status: ${ARENA_STATUS[arena.status]}`);

  // ================================================================
  // WAIT FOR DURATION
  // ================================================================
  if (arena.status === 3) {
    const remaining = arena.endTimestamp.toNumber() - Math.floor(Date.now() / 1000);
    if (remaining > 0) {
      console.log(`\n⏱️  Waiting ${remaining} seconds for arena to end...`);
      for (let i = remaining; i > 0; i -= 15) {
        console.log(`   ${i}s remaining...`);
        await sleep(Math.min(15000, i * 1000));
      }
    }
  }

  // ================================================================
  // SET END PRICES
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("SETTING END PRICES");
  console.log("═".repeat(80) + "\n");

  const endPrices = await fetchPrices(ASSET_NAMES);

  for (const assetIndex of assetsInArena) {
    const assetName = ASSET_NAMES[assetIndex];
    const price = endPrices[assetName] || startPrices[assetName] || 1;
    const onchainPrice = priceToOnchain(price);
    
    try {
      await program.methods
        .setEndPrice(onchainPrice)
        .accountsStrict({
          globalState: globalStatePda,
          arena: arenaPda,
          arenaAsset: arenaAssetPdas[assetIndex],
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
      
      console.log(`   ✅ ${assetName.padEnd(10)}: $${price.toFixed(4)}`);
    } catch (error: any) {
      console.log(`   ⚠️ ${assetName}: ${error.message?.slice(0, 40)}`);
    }
    await sleep(500);
  }

  // ================================================================
  // FINALIZE ARENA
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("FINALIZING ARENA");
  console.log("═".repeat(80) + "\n");

  const remainingAccounts = assetsInArena.map(idx => ({
    pubkey: arenaAssetPdas[idx],
    isSigner: false,
    isWritable: false,
  }));

  try {
    await program.methods
      .finalizeArena()
      .accountsStrict({
        globalState: globalStatePda,
        arena: arenaPda,
        admin: admin.publicKey,
      })
      .remainingAccounts(remainingAccounts)
      .signers([admin])
      .rpc();
    
    console.log(`✅ Arena finalized!`);
  } catch (error: any) {
    console.log(`❌ Error: ${error.message || error}`);
  }

  arena = await program.account.arena.fetch(arenaPda);
  const winningAsset = arena.winningAsset;
  const winnerAssetName = ASSET_NAMES[winningAsset];

  // Show volatility
  console.log("\n📊 TOKEN VOLATILITY:");
  console.log("─".repeat(60));
  
  for (const assetIndex of assetsInArena) {
    const assetName = ASSET_NAMES[assetIndex];
    try {
      const arenaAsset = await program.account.arenaAsset.fetch(arenaAssetPdas[assetIndex]);
      const movement = Number(arenaAsset.priceMovement);
      const isWinner = assetIndex === winningAsset;
      const prefix = isWinner ? "🏆" : "  ";
      console.log(`${prefix} ${assetName.padEnd(10)}: ${movement >= 0 ? '+' : ''}${movement} bps`);
    } catch {}
  }

  console.log(`\n🏆 WINNER: ${winnerAssetName} (Asset ${winningAsset})`);

  // Find winner player
  // Need to check all player entries for this arena
  let winnerPlayer: Keypair | null = null;
  let winnerEntryPda: PublicKey | null = null;

  for (const player of players) {
    const [entryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_entry_v2"), arenaPda.toBuffer(), player.publicKey.toBuffer()],
      program.programId
    );
    
    try {
      const entry = await program.account.playerEntry.fetch(entryPda);
      if (entry.assetIndex === winningAsset) {
        winnerPlayer = player;
        winnerEntryPda = entryPda;
        playerEntries.push({ player, pda: entryPda, assetIndex: winningAsset });
        break;
      }
    } catch {}
  }

  if (!winnerPlayer || !winnerEntryPda) {
    console.log("❌ Could not find winner player entry");
    return;
  }

  console.log(`   Winner Wallet: ${winnerPlayer.publicKey.toString()}`);

  // ================================================================
  // WINNER CLAIMS
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("WINNER CLAIMS REWARDS");
  console.log("═".repeat(80));

  // Claim own tokens
  console.log("\n📥 Claiming own tokens (100%)...");
  
  const winnerMint = tokenMints[winningAsset];
  const winnerAta = await getAssociatedTokenAddress(winnerMint, winnerPlayer.publicKey);
  const winnerArenaVault = await getAssociatedTokenAddress(winnerMint, arenaPda, true);

  const ownBefore = await getTokenBalance(connection, winnerMint, winnerPlayer.publicKey);

  try {
    await program.methods
      .claimOwnTokens()
      .accountsStrict({
        arena: arenaPda,
        playerEntry: winnerEntryPda,
        arenaVault: winnerArenaVault,
        winnerTokenAccount: winnerAta,
        winner: winnerPlayer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([winnerPlayer])
      .rpc();
    
    const ownAfter = await getTokenBalance(connection, winnerMint, winnerPlayer.publicKey);
    console.log(`   ✅ ${winnerAssetName}: Claimed ${(ownAfter - ownBefore).toFixed(4)}`);
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message?.slice(0, 60)}`);
  }

  // Claim from losers
  console.log("\n📥 Claiming from losers (90%)...");
  
  const winningArenaAssetPda = arenaAssetPdas[winningAsset];

  for (const player of players) {
    const [loserEntryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_entry_v2"), arenaPda.toBuffer(), player.publicKey.toBuffer()],
      program.programId
    );
    
    try {
      const loserEntry = await program.account.playerEntry.fetch(loserEntryPda);
      
      if (loserEntry.assetIndex === winningAsset) continue; // Skip winners
      
      const loserAssetIndex = loserEntry.assetIndex;
      const loserAssetName = ASSET_NAMES[loserAssetIndex];
      const loserMint = tokenMints[loserAssetIndex];
      
      const winnerLoserAta = await getOrCreateAssociatedTokenAccount(
        connection, admin, loserMint, winnerPlayer.publicKey
      );
      
      const treasuryAta = await getOrCreateAssociatedTokenAccount(
        connection, admin, loserMint, treasuryWallet
      );

      const loserArenaVault = await getAssociatedTokenAddress(loserMint, arenaPda, true);
      
      const before = await getTokenBalance(connection, loserMint, winnerPlayer.publicKey);

      await program.methods
        .claimLoserTokens()
        .accountsStrict({
          globalState: globalStatePda,
          arena: arenaPda,
          arenaAsset: winningArenaAssetPda,
          winnerEntry: winnerEntryPda,
          loserEntry: loserEntryPda,
          arenaVault: loserArenaVault,
          winnerTokenAccount: winnerLoserAta.address,
          treasuryTokenAccount: treasuryAta.address,
          winner: winnerPlayer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([winnerPlayer])
        .rpc();
      
      const after = await getTokenBalance(connection, loserMint, winnerPlayer.publicKey);
      console.log(`   ✅ ${loserAssetName.padEnd(10)}: Claimed ${(after - before).toFixed(4)}`);
      
    } catch (error: any) {
      // Skip if not a player in this arena or already claimed
    }
    
    await sleep(300);
  }

  console.log("\n" + "═".repeat(80));
  console.log("✅ ARENA COMPLETED SUCCESSFULLY!");
  console.log("═".repeat(80) + "\n");
}

main().catch(console.error);

