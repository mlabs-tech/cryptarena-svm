/**
 * Update Arena Duration
 * 
 * This script updates the global arena duration.
 * Only the admin can execute this.
 * 
 * Usage: npx ts-node scripts/update-arena-duration.ts <duration_in_seconds>
 * Example: npx ts-node scripts/update-arena-duration.ts 600  (for 10 minutes)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaSvmTest } from "../target/types/cryptarena_svm_test";
import {
  Keypair,
  PublicKey,
  Connection,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// CONFIG - Uses devnet by default
// ============================================================================

const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET_PATH = process.env.ANCHOR_WALLET || path.join(require("os").homedir(), ".config/solana/id.json");

// ============================================================================
// HELPERS
// ============================================================================

function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("⏱️  UPDATE ARENA DURATION");
  console.log("═".repeat(80) + "\n");

  // Get duration from command line argument
  const durationArg = process.argv[2];
  if (!durationArg) {
    console.log("❌ Error: Please provide duration in seconds");
    console.log("\nUsage: npx ts-node scripts/update-arena-duration.ts <duration_in_seconds>");
    console.log("Example: npx ts-node scripts/update-arena-duration.ts 600  (for 10 minutes)\n");
    process.exit(1);
  }

  const newDuration = parseInt(durationArg);
  if (isNaN(newDuration) || newDuration <= 0) {
    console.log("❌ Error: Duration must be a positive number");
    process.exit(1);
  }

  // Setup connection and wallet
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair(WALLET_PATH);
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.CryptarenaSvmTest as Program<CryptarenaSvmTest>;

  console.log(`📋 Program ID: ${program.programId.toString()}`);
  console.log(`👤 Admin: ${admin.publicKey.toString()}`);
  console.log(`🌐 Cluster: ${connection.rpcEndpoint}\n`);

  // PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state_v2")],
    program.programId
  );

  // Fetch current state
  try {
    const globalState = await program.account.globalState.fetch(globalStatePda);
    console.log("📊 Current Global State:");
    console.log(`   Current Duration: ${globalState.arenaDuration.toNumber()} seconds (${globalState.arenaDuration.toNumber() / 60} minutes)`);
    console.log(`   Admin: ${globalState.admin.toString()}`);
    console.log(`   Max Players: ${globalState.maxPlayersPerArena}`);
  } catch (error) {
    console.log("⚠️  Could not fetch current global state");
  }

  console.log("\n" + "═".repeat(80));
  console.log(`🔄 Updating arena duration to ${newDuration} seconds (${newDuration / 60} minutes)...`);
  console.log("═".repeat(80) + "\n");

  try {
    const tx = await program.methods
      .updateArenaDuration(new anchor.BN(newDuration))
      .accountsStrict({
        globalState: globalStatePda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Arena duration updated successfully!");
    console.log(`   Transaction: ${tx}\n`);

    // Verify the update
    const updatedState = await program.account.globalState.fetch(globalStatePda);
    console.log("📊 Updated Global State:");
    console.log(`   New Duration: ${updatedState.arenaDuration.toNumber()} seconds (${updatedState.arenaDuration.toNumber() / 60} minutes)`);
    console.log(`   Max Players: ${updatedState.maxPlayersPerArena}`);
    
    console.log("\n" + "🎉".repeat(30));
    console.log("✅ DURATION UPDATE COMPLETE!");
    console.log("🎉".repeat(30) + "\n");

  } catch (error: any) {
    console.log("❌ Error updating arena duration:");
    console.log(error);
    
    if (error.message?.includes("Unauthorized")) {
      console.log("\n⚠️  Make sure you're using the admin wallet!");
    }
  }
}

main().catch(console.error);

