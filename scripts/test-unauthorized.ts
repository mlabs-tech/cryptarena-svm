/**
 * TEST: Unauthorized Access
 * 
 * This test verifies that non-admin users cannot set prices.
 * 
 * Expected: Non-admin calling setStartPrice or setEndPrice fails with Unauthorized error
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

const ASSET_NAMES = ["SOL", "TRUMP", "PUMP", "BONK", "JUP", "PENGU", "PYTH", "HNT", "FARTCOIN", "RAY"];

// ============================================================================
// MAIN TEST
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🧪 TEST: UNAUTHORIZED ACCESS");
  console.log("═".repeat(80));
  console.log("   Expected: Non-admin cannot set prices");
  console.log("   Error Expected: Unauthorized");
  console.log("═".repeat(80) + "\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.CryptarenaSvmTest as Program<CryptarenaSvmTest>;
  const admin = (provider.wallet as any).payer as Keypair;

  console.log("📋 Configuration:");
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   Admin: ${admin.publicKey.toString()}`);

  // Load a non-admin player
  const walletDir = path.join(__dirname, "../test-wallets");
  const nonAdmin = loadKeypair(path.join(walletDir, "player1.json"));
  console.log(`   Non-Admin: ${nonAdmin.publicKey.toString()}\n`);

  const mintsFilePath = path.join(walletDir, "token-mints.json");
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

  // Find an arena in Ready status (needs prices set)
  const globalState = await program.account.globalState.fetch(globalStatePda);
  
  // Look for an arena in Ready status
  let targetArenaId: anchor.BN | null = null;
  let targetArenaPda: PublicKey | null = null;
  let targetArena: any = null;

  for (let id = globalState.currentArenaId.toNumber(); id >= 0; id--) {
    const tryArenaId = new anchor.BN(id);
    const [tryArenaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_v2"), tryArenaId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    
    try {
      const arena = await program.account.arena.fetch(tryArenaPda);
      // Status 2 = Ready (waiting for prices)
      if (arena.status === 2 && arena.playerCount >= 10) {
        targetArenaId = tryArenaId;
        targetArenaPda = tryArenaPda;
        targetArena = arena;
        break;
      }
    } catch {}
  }

  if (!targetArenaId || !targetArenaPda) {
    console.log("⚠️  No arena in Ready status found.");
    console.log("   Run test-arena-full.ts first to create a full arena.\n");
    return;
  }

  console.log(`📍 Found Ready arena: ID ${targetArenaId.toString()}`);
  console.log(`   Players: ${targetArena.playerCount}/10\n`);

  // Find an asset in this arena
  let targetAssetIndex = 0;
  let targetAssetPda: PublicKey | null = null;

  for (let i = 0; i < 14; i++) {
    const [assetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_asset_v2"), targetArenaPda.toBuffer(), Buffer.from([i])],
      program.programId
    );
    
    try {
      const asset = await program.account.arenaAsset.fetch(assetPda);
      if (asset.playerCount > 0) {
        targetAssetIndex = i;
        targetAssetPda = assetPda;
        break;
      }
    } catch {}
  }

  if (!targetAssetPda) {
    console.log("❌ No asset found in arena.");
    return;
  }

  console.log(`📍 Target Asset: ${ASSET_NAMES[targetAssetIndex]} (index ${targetAssetIndex})\n`);

  // ================================================================
  // TEST 1: Non-admin tries to set START price
  // ================================================================
  console.log("═".repeat(80));
  console.log("TEST 1: NON-ADMIN TRIES TO SET START PRICE");
  console.log("═".repeat(80) + "\n");

  let test1Passed = false;
  const testPrice = new anchor.BN(100_00000000); // $100

  try {
    console.log(`👤 Non-admin attempting to call setStartPrice...`);
    
    await program.methods
      .setStartPrice(testPrice)
      .accountsStrict({
        globalState: globalStatePda,
        arena: targetArenaPda,
        arenaAsset: targetAssetPda,
        admin: nonAdmin.publicKey, // Non-admin trying to call
      })
      .signers([nonAdmin])
      .rpc();
    
    console.log(`   ❌ UNEXPECTED: Non-admin was allowed to set price!\n`);
    
  } catch (error: any) {
    const errorMsg = error.message || JSON.stringify(error);
    const isExpectedError = errorMsg.includes("Unauthorized") || 
                            errorMsg.includes("0x7d1") ||
                            errorMsg.includes("ConstraintHasOne") ||
                            errorMsg.includes("has_one");
    
    if (isExpectedError) {
      test1Passed = true;
      console.log(`   ✅ EXPECTED ERROR! Non-admin was correctly rejected.`);
      console.log(`   📛 Error: Unauthorized\n`);
    } else {
      console.log(`   ⚠️ Different error: ${errorMsg.slice(0, 100)}\n`);
    }
  }

  // ================================================================
  // TEST 2: Non-admin tries to finalize arena
  // ================================================================
  console.log("═".repeat(80));
  console.log("TEST 2: NON-ADMIN TRIES TO FINALIZE ARENA");
  console.log("═".repeat(80) + "\n");

  let test2Passed = false;

  try {
    console.log(`👤 Non-admin attempting to call finalizeArena...`);
    
    await program.methods
      .finalizeArena()
      .accountsStrict({
        globalState: globalStatePda,
        arena: targetArenaPda,
        admin: nonAdmin.publicKey,
      })
      .signers([nonAdmin])
      .rpc();
    
    console.log(`   ❌ UNEXPECTED: Non-admin was allowed to finalize!\n`);
    
  } catch (error: any) {
    const errorMsg = error.message || JSON.stringify(error);
    const isExpectedError = errorMsg.includes("Unauthorized") || 
                            errorMsg.includes("0x7d1") ||
                            errorMsg.includes("ConstraintHasOne") ||
                            errorMsg.includes("has_one");
    
    if (isExpectedError) {
      test2Passed = true;
      console.log(`   ✅ EXPECTED ERROR! Non-admin was correctly rejected.`);
      console.log(`   📛 Error: Unauthorized\n`);
    } else {
      console.log(`   ⚠️ Different error: ${errorMsg.slice(0, 100)}\n`);
    }
  }

  // ================================================================
  // VERIFY: Admin CAN set prices
  // ================================================================
  console.log("═".repeat(80));
  console.log("VERIFY: ADMIN CAN SET PRICES");
  console.log("═".repeat(80) + "\n");

  let adminCanSetPrice = false;

  try {
    console.log(`👤 Admin setting start price for ${ASSET_NAMES[targetAssetIndex]}...`);
    
    await program.methods
      .setStartPrice(testPrice)
      .accountsStrict({
        globalState: globalStatePda,
        arena: targetArenaPda,
        arenaAsset: targetAssetPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    
    adminCanSetPrice = true;
    console.log(`   ✅ Admin successfully set price!\n`);
    
  } catch (error: any) {
    console.log(`   ⚠️ Error: ${error.message?.slice(0, 60) || error}\n`);
  }

  // ================================================================
  // TEST RESULTS
  // ================================================================
  console.log("═".repeat(80));
  console.log("TEST RESULTS");
  console.log("═".repeat(80) + "\n");

  console.log(`   Test 1 (setStartPrice):   ${test1Passed ? "PASSED ✅" : "FAILED ❌"}`);
  console.log(`   Test 2 (finalizeArena):   ${test2Passed ? "PASSED ✅" : "FAILED ❌"}`);
  console.log(`   Admin verification:       ${adminCanSetPrice ? "PASSED ✅" : "FAILED ❌"}\n`);

  if (test1Passed && test2Passed && adminCanSetPrice) {
    console.log("🎉 ALL TESTS PASSED!");
    console.log("   ✅ Non-admin correctly rejected from setStartPrice");
    console.log("   ✅ Non-admin correctly rejected from finalizeArena");
    console.log("   ✅ Admin can set prices");
  } else {
    console.log("❌ SOME TESTS FAILED!");
  }

  console.log("\n" + "═".repeat(80) + "\n");
}

main().catch(console.error);

