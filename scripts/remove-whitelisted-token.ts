/**
 * Remove Whitelisted Token
 * 
 * This script removes a token from the whitelist (sets is_active to false).
 * Only the admin can execute this.
 * 
 * Usage: npx ts-node scripts/remove-whitelisted-token.ts <mint_address>
 * Example: npx ts-node scripts/remove-whitelisted-token.ts 7a1eh57mbAvEHevFhsofrGYgGPiNBpwwPzQu4KU85EXe
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
  console.log("🚫 REMOVE WHITELISTED TOKEN");
  console.log("═".repeat(80) + "\n");

  // Get arguments from command line
  const mintArg = process.argv[2];

  if (!mintArg) {
    console.log("❌ Error: Missing required argument");
    console.log("\nUsage: npx ts-node scripts/remove-whitelisted-token.ts <mint_address>");
    console.log("Example: npx ts-node scripts/remove-whitelisted-token.ts 7a1eh57mbAvEHevFhsofrGYgGPiNBpwwPzQu4KU85EXe\n");
    process.exit(1);
  }

  let tokenMint: PublicKey;
  try {
    tokenMint = new PublicKey(mintArg);
  } catch {
    console.log("❌ Error: Invalid mint address\n");
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
  console.log(`🌐 Cluster: ${connection.rpcEndpoint}`);
  console.log(`🪙 Token Mint: ${tokenMint.toString()}\n`);

  // PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state_v2")],
    program.programId
  );

  const [whitelistedTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist_token_v2"), tokenMint.toBuffer()],
    program.programId
  );

  // Check if token is whitelisted
  try {
    const existingToken = await program.account.whitelistedToken.fetch(whitelistedTokenPda);
    console.log("📊 Current Token Status:");
    console.log(`   Asset Index: ${existingToken.assetIndex}`);
    console.log(`   Active: ${existingToken.isActive}\n`);
    
    if (!existingToken.isActive) {
      console.log("⚠️  Token is already inactive in the whitelist.\n");
      return;
    }
  } catch {
    console.log("❌ Token is not in the whitelist.\n");
    return;
  }

  console.log("═".repeat(80));
  console.log("🔄 Removing token from whitelist...");
  console.log("═".repeat(80) + "\n");

  try {
    const tx = await program.methods
      .removeWhitelistedToken()
      .accountsStrict({
        globalState: globalStatePda,
        whitelistedToken: whitelistedTokenPda,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Token removed from whitelist successfully!");
    console.log(`   Transaction: ${tx}\n`);

    // Verify the removal
    const whitelistedToken = await program.account.whitelistedToken.fetch(whitelistedTokenPda);
    console.log("📊 Updated Token Status:");
    console.log(`   Mint: ${whitelistedToken.mint.toString()}`);
    console.log(`   Asset Index: ${whitelistedToken.assetIndex}`);
    console.log(`   Active: ${whitelistedToken.isActive}`);

    console.log("\n" + "🎉".repeat(30));
    console.log("✅ TOKEN REMOVAL COMPLETE!");
    console.log("🎉".repeat(30) + "\n");

  } catch (error: any) {
    console.log("❌ Error removing token from whitelist:");
    console.log(error);
    
    if (error.message?.includes("Unauthorized")) {
      console.log("\n⚠️  Make sure you're using the admin wallet!");
    }
  }
}

main().catch(console.error);

