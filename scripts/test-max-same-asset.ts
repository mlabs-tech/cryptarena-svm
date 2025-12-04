/**
 * TEST: Max Same Asset Per Arena
 * 
 * This test verifies that the program rejects a 4th player trying to enter
 * an arena with the same token when MAX_SAME_ASSET_PER_ARENA = 3.
 * 
 * Expected: First 3 players with same token succeed, 4th player fails with MaxAssetLimitReached
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

const formatSOL = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// MAIN TEST
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🧪 TEST: MAX SAME ASSET PER ARENA");
  console.log("═".repeat(80));
  console.log("   Expected: 3 players with same token succeed, 4th player FAILS");
  console.log("   Error Expected: MaxAssetLimitReached");
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
  
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    if (fs.existsSync(walletPath)) {
      players.push(loadKeypair(walletPath));
    }
  }
  console.log(`   Loaded ${players.length} player wallets\n`);

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

  // Check protocol
  let globalState;
  try {
    globalState = await program.account.globalState.fetch(globalStatePda);
    console.log(`✅ Protocol exists. Arena ID: ${globalState.currentArenaId.toString()}`);
    console.log(`   Max Same Asset: ${globalState.maxSameAsset}\n`);
  } catch {
    console.log("❌ Protocol not initialized. Run arena-onchain-test.ts first.\n");
    return;
  }

  const arenaId = globalState.currentArenaId;
  const [arenaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena_v2"), arenaId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  console.log(`   Arena ID: ${arenaId.toString()}`);
  console.log(`   Arena PDA: ${arenaPda.toString()}\n`);

  // All 4 players will try to enter with the SAME token (SOL - index 0)
  const SAME_ASSET_INDEX = 0; // SOL
  const ASSET_NAME = "SOL";
  const USD_ENTRY = new anchor.BN(15_000_000);
  const mint = tokenMints[SAME_ASSET_INDEX];

  console.log("═".repeat(80));
  console.log(`TEST: 4 PLAYERS ENTERING WITH SAME TOKEN (${ASSET_NAME})`);
  console.log("═".repeat(80) + "\n");

  let successCount = 0;
  let failCount = 0;
  let expectedError = false;

  for (let i = 0; i < 4; i++) {
    const player = players[i];
    const playerNum = i + 1;
    
    console.log(`👤 Player ${playerNum} attempting to enter with ${ASSET_NAME}...`);

    try {
      const playerAta = await getAssociatedTokenAddress(mint, player.publicKey);
      
      let tokenBalance = BigInt(0);
      try {
        const tokenAccount = await getAccount(connection, playerAta);
        tokenBalance = tokenAccount.amount;
      } catch {
        console.log(`   ❌ No token account for player ${playerNum}`);
        continue;
      }

      const arenaVault = await getAssociatedTokenAddress(mint, arenaPda, true);
      
      const [playerEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player_entry_v2"), arenaPda.toBuffer(), player.publicKey.toBuffer()],
        program.programId
      );

      const [arenaAssetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("arena_asset_v2"), arenaPda.toBuffer(), Buffer.from([SAME_ASSET_INDEX])],
        program.programId
      );

      const tokenAmount = new anchor.BN(Number(tokenBalance) / 100); // Use 1% for test

      const tx = new Transaction();
      
      // Create arena vault if needed
      try {
        await getAccount(connection, arenaVault);
      } catch {
        tx.add(createAssociatedTokenAccountInstruction(admin.publicKey, arenaVault, arenaPda, mint));
      }

      const enterIx = await program.methods
        .enterArena(SAME_ASSET_INDEX, tokenAmount, USD_ENTRY)
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

      await sendAndConfirmTransaction(connection, tx, [admin, player], { skipPreflight: false });

      successCount++;
      console.log(`   ✅ SUCCESS! Player ${playerNum} entered. (${successCount}/3 allowed)`);

      // Check arena asset count
      try {
        const arenaAsset = await program.account.arenaAsset.fetch(arenaAssetPda);
        console.log(`   📊 ${ASSET_NAME} players in arena: ${arenaAsset.playerCount}/3\n`);
      } catch {}

    } catch (error: any) {
      failCount++;
      
      // Check if it's the expected error
      const errorMsg = error.message || JSON.stringify(error);
      const isExpectedError = errorMsg.includes("MaxAssetLimitReached") || 
                              errorMsg.includes("Max same asset per arena reached") ||
                              errorMsg.includes("0x7e9"); // Error code for MaxAssetLimitReached
      
      if (isExpectedError) {
        expectedError = true;
        console.log(`   ✅ EXPECTED ERROR! Player ${playerNum} was correctly rejected.`);
        console.log(`   📛 Error: MaxAssetLimitReached (max 3 players per asset)\n`);
      } else {
        console.log(`   ❌ UNEXPECTED ERROR: ${errorMsg.slice(0, 100)}`);
        if (error.logs) {
          console.log("   Logs:", error.logs.slice(-3).join("\n        "));
        }
        console.log("");
      }
    }

    await sleep(1000);
  }

  // ================================================================
  // TEST RESULTS
  // ================================================================
  console.log("═".repeat(80));
  console.log("TEST RESULTS");
  console.log("═".repeat(80) + "\n");

  console.log(`   Players that succeeded: ${successCount}`);
  console.log(`   Players that failed:    ${failCount}`);
  console.log(`   Expected error caught:  ${expectedError ? "YES ✅" : "NO ❌"}\n`);

  if (successCount === 3 && failCount === 1 && expectedError) {
    console.log("🎉 TEST PASSED!");
    console.log("   ✅ First 3 players with same token entered successfully");
    console.log("   ✅ 4th player was correctly rejected with MaxAssetLimitReached");
  } else if (successCount < 3 && failCount > 0) {
    console.log("⚠️  TEST PARTIALLY COMPLETED");
    console.log("   Some players failed before reaching the limit.");
    console.log("   This could be due to existing players in the arena from previous tests.");
  } else {
    console.log("❌ TEST FAILED!");
    console.log("   The 4th player should have been rejected but wasn't.");
  }

  console.log("\n" + "═".repeat(80) + "\n");
}

main().catch(console.error);

