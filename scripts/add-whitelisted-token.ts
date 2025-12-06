/**
 * Add Whitelisted Token
 * 
 * This script adds a token to the whitelist so it can be used in arenas.
 * Only the admin can execute this.
 * 
 * Usage: npx ts-node scripts/add-whitelisted-token.ts <mint_address> <asset_index>
 * Example: npx ts-node scripts/add-whitelisted-token.ts 7a1eh57mbAvEHevFhsofrGYgGPiNBpwwPzQu4KU85EXe 0
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
  console.log("✅ ADD WHITELISTED TOKEN");
  console.log("═".repeat(80) + "\n");

  // Get arguments from command line
  const mintArg = process.argv[2];
  const assetIndexArg = process.argv[3];

  if (!mintArg || !assetIndexArg) {
    console.log("❌ Error: Missing required arguments");
    console.log("\nUsage: npx ts-node scripts/add-whitelisted-token.ts <mint_address> <asset_index>");
    console.log("Example: npx ts-node scripts/add-whitelisted-token.ts 7a1eh57mbAvEHevFhsofrGYgGPiNBpwwPzQu4KU85EXe 0\n");
    process.exit(1);
  }

  let tokenMint: PublicKey;
  try {
    tokenMint = new PublicKey(mintArg);
  } catch {
    console.log("❌ Error: Invalid mint address\n");
    process.exit(1);
  }

  const assetIndex = parseInt(assetIndexArg);
  if (isNaN(assetIndex) || assetIndex < 0 || assetIndex > 255) {
    console.log("❌ Error: Asset index must be a number between 0 and 255\n");
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
  console.log(`🪙 Token Mint: ${tokenMint.toString()}`);
  console.log(`🔢 Asset Index: ${assetIndex}\n`);

  // PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state_v2")],
    program.programId
  );

  const [whitelistedTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist_token_v2"), tokenMint.toBuffer()],
    program.programId
  );

  // Check if token is already whitelisted
  try {
    const existingToken = await program.account.whitelistedToken.fetch(whitelistedTokenPda);
    console.log("⚠️  Token is already whitelisted!");
    console.log(`   Asset Index: ${existingToken.assetIndex}`);
    console.log(`   Active: ${existingToken.isActive}\n`);
    
    if (existingToken.isActive) {
      console.log("✅ Token is already active in the whitelist.\n");
      return;
    } else {
      console.log("💡 Token exists but is inactive. You may want to reactivate it.\n");
      return;
    }
  } catch {
    // Token not whitelisted, continue
  }

  console.log("═".repeat(80));
  console.log("🔄 Adding token to whitelist...");
  console.log("═".repeat(80) + "\n");

  try {
    const tx = await program.methods
      .addWhitelistedToken(assetIndex)
      .accountsStrict({
        globalState: globalStatePda,
        whitelistedToken: whitelistedTokenPda,
        tokenMint: tokenMint,
        admin: admin.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    console.log("✅ Token added to whitelist successfully!");
    console.log(`   Transaction: ${tx}\n`);

    // Verify the addition
    const whitelistedToken = await program.account.whitelistedToken.fetch(whitelistedTokenPda);
    console.log("📊 Whitelisted Token Details:");
    console.log(`   Mint: ${whitelistedToken.mint.toString()}`);
    console.log(`   Asset Index: ${whitelistedToken.assetIndex}`);
    console.log(`   Active: ${whitelistedToken.isActive}`);
    console.log(`   PDA: ${whitelistedTokenPda.toString()}`);

    console.log("\n" + "🎉".repeat(30));
    console.log("✅ TOKEN WHITELIST UPDATE COMPLETE!");
    console.log("🎉".repeat(30) + "\n");

  } catch (error: any) {
    console.log("❌ Error adding token to whitelist:");
    console.log(error);
    
    if (error.message?.includes("Unauthorized")) {
      console.log("\n⚠️  Make sure you're using the admin wallet!");
    }
  }
}

main().catch(console.error);

