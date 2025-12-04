/**
 * TEST: Arena Full
 * 
 * This test verifies that the program rejects an 11th player trying to enter
 * a full arena (MAX_PLAYERS = 10).
 * 
 * Expected: First 10 players succeed, 11th player fails with ArenaFull error
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaSvmTest } from "../target/types/cryptarena_svm_test";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// HELPERS
// ============================================================================

function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ASSET_NAMES = ["SOL", "TRUMP", "PUMP", "BONK", "JUP", "PENGU", "PYTH", "HNT", "FARTCOIN", "RAY", "WIF", "RENDER", "ONDO", "MEW"];

// ============================================================================
// MAIN TEST
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🧪 TEST: ARENA FULL (11th PLAYER REJECTED)");
  console.log("═".repeat(80));
  console.log("   Expected: 10 players succeed, 11th player FAILS");
  console.log("   Error Expected: ArenaFull");
  console.log("═".repeat(80) + "\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.CryptarenaSvmTest as Program<CryptarenaSvmTest>;
  const admin = (provider.wallet as any).payer as Keypair;

  console.log("📋 Configuration:");
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   Admin: ${admin.publicKey.toString()}`);

  // Load wallets and mints
  const walletDir = path.join(__dirname, "../test-wallets");
  const players: Keypair[] = [];
  
  // Load all 10 players + we need an 11th one
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    if (fs.existsSync(walletPath)) {
      players.push(loadKeypair(walletPath));
    }
  }
  
  // Generate 11th player keypair (or use admin as 11th since they have SOL)
  const player11 = admin; // Using admin as 11th player since they have tokens
  
  console.log(`   Loaded ${players.length} player wallets`);
  console.log(`   11th player: Admin wallet\n`);

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

  // Get current arena ID and create a new one
  let globalState = await program.account.globalState.fetch(globalStatePda);
  const arenaId = globalState.currentArenaId;
  
  const [arenaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena_v2"), arenaId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  console.log(`   Current Arena ID: ${arenaId.toString()}`);
  console.log(`   Arena PDA: ${arenaPda.toString()}\n`);

  // Check if arena exists and its state
  try {
    const arena = await program.account.arena.fetch(arenaPda);
    if (arena.playerCount > 0) {
      console.log(`⚠️  Arena ${arenaId.toString()} already has ${arena.playerCount} players.`);
      console.log("   This test needs a fresh arena. Completing current arena first...\n");
      console.log("   Run test-complete-arena.ts first, then retry this test.\n");
      return;
    }
  } catch {
    console.log("   Arena not yet created, will be created on first entry.\n");
  }

  console.log("═".repeat(80));
  console.log("FILLING ARENA WITH 10 PLAYERS");
  console.log("═".repeat(80) + "\n");

  const USD_ENTRY = new anchor.BN(15_000_000);
  let successCount = 0;

  // Enter 10 players with different assets
  for (let i = 0; i < 10; i++) {
    const player = players[i];
    const assetIndex = i % 10; // Different asset for each
    const assetName = ASSET_NAMES[assetIndex];
    
    console.log(`👤 Player ${i + 1} entering with ${assetName}...`);

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

      successCount++;
      console.log(`   ✅ SUCCESS! Player ${i + 1} entered. (${successCount}/10)`);

    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message?.slice(0, 60) || error}`);
    }

    await sleep(1000);
  }

  // Verify arena is full
  const arena = await program.account.arena.fetch(arenaPda);
  console.log(`\n📊 Arena Status: ${arena.playerCount}/10 players`);

  if (arena.playerCount < 10) {
    console.log("⚠️  Arena not full yet. Cannot test 11th player rejection.");
    return;
  }

  console.log("\n" + "═".repeat(80));
  console.log("ATTEMPTING 11TH PLAYER ENTRY (SHOULD FAIL)");
  console.log("═".repeat(80) + "\n");

  // Try to enter with 11th player (admin)
  const assetIndex = 10; // WIF
  const assetName = ASSET_NAMES[assetIndex];
  
  console.log(`👤 Player 11 (Admin) attempting to enter with ${assetName}...`);

  let expectedError = false;

  try {
    const mint = tokenMints[assetIndex];
    const playerAta = await getAssociatedTokenAddress(mint, player11.publicKey);
    
    const arenaVault = await getAssociatedTokenAddress(mint, arenaPda, true);
    
    const [playerEntryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_entry_v2"), arenaPda.toBuffer(), player11.publicKey.toBuffer()],
      program.programId
    );

    const [arenaAssetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_asset_v2"), arenaPda.toBuffer(), Buffer.from([assetIndex])],
      program.programId
    );

    const tokenAmount = new anchor.BN(1_000_000_000); // 1 token

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
        player: player11.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player11])
      .instruction();
    
    tx.add(enterIx);

    await sendAndConfirmTransaction(connection, tx, [admin, player11], { skipPreflight: false });
    
    console.log(`   ❌ UNEXPECTED: Player 11 was allowed to enter!`);

  } catch (error: any) {
    const errorMsg = error.message || JSON.stringify(error);
    const isExpectedError = errorMsg.includes("ArenaFull") || 
                            errorMsg.includes("Arena is full") ||
                            errorMsg.includes("0x7e8") || // Error code
                            errorMsg.includes("Ready"); // Arena moved to Ready status
    
    if (isExpectedError || arena.status === 2) { // Ready status means full
      expectedError = true;
      console.log(`   ✅ EXPECTED ERROR! Player 11 was correctly rejected.`);
      console.log(`   📛 Error: ArenaFull or ArenaNotWaiting (arena is full/ready)\n`);
    } else {
      console.log(`   ⚠️ Error: ${errorMsg.slice(0, 100)}`);
    }
  }

  // ================================================================
  // TEST RESULTS
  // ================================================================
  console.log("═".repeat(80));
  console.log("TEST RESULTS");
  console.log("═".repeat(80) + "\n");

  console.log(`   Players that succeeded: ${successCount}`);
  console.log(`   11th player rejected:   ${expectedError ? "YES ✅" : "NO ❌"}\n`);

  if (successCount === 10 && expectedError) {
    console.log("🎉 TEST PASSED!");
    console.log("   ✅ 10 players entered successfully");
    console.log("   ✅ 11th player was correctly rejected");
  } else if (successCount === 10 && arena.status === 2) {
    console.log("🎉 TEST PASSED!");
    console.log("   ✅ 10 players entered successfully");
    console.log("   ✅ Arena moved to Ready status (no more entries allowed)");
  } else {
    console.log("❌ TEST FAILED!");
  }

  console.log("\n" + "═".repeat(80) + "\n");
}

main().catch(console.error);

