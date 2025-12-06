/**
 * Initialize Whitelist
 * 
 * This script initializes the whitelist with all 14 tokens from token-mints.json.
 * Only the admin can execute this.
 * 
 * Usage: npx ts-node scripts/initialize-whitelist.ts
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

// Token names for display
const TOKEN_NAMES = [
  "SOL", "TRUMP", "PUMP", "BONK", "JUP", "PENGU", "PYTH",
  "HNT", "FARTCOIN", "RAY", "JTO", "KMNO", "MET", "W"
];

// ============================================================================
// HELPERS
// ============================================================================

function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🚀 INITIALIZE TOKEN WHITELIST");
  console.log("═".repeat(80) + "\n");

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

  // Load token mints
  const walletDir = path.join(__dirname, "../test-wallets");
  const mintsFilePath = path.join(walletDir, "token-mints.json");

  if (!fs.existsSync(mintsFilePath)) {
    console.log("❌ Token mints not found at:", mintsFilePath);
    return;
  }

  const tokenMintsRaw = JSON.parse(fs.readFileSync(mintsFilePath, "utf-8"));
  const tokenMints: { [key: number]: PublicKey } = {};
  for (const [key, value] of Object.entries(tokenMintsRaw)) {
    tokenMints[parseInt(key)] = new PublicKey(value as string);
  }

  console.log(`📋 Found ${Object.keys(tokenMints).length} tokens in token-mints.json\n`);

  // PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state_v2")],
    program.programId
  );

  console.log("═".repeat(80));
  console.log("🔄 ADDING TOKENS TO WHITELIST");
  console.log("═".repeat(80) + "\n");

  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let assetIndex = 0; assetIndex < Object.keys(tokenMints).length; assetIndex++) {
    const tokenMint = tokenMints[assetIndex];
    const tokenName = TOKEN_NAMES[assetIndex] || `TOKEN_${assetIndex}`;

    if (!tokenMint) {
      console.log(`   ⚠️  ${tokenName.padEnd(10)}: Token mint not found`);
      errorCount++;
      continue;
    }

    const [whitelistedTokenPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("whitelist_token_v2"), tokenMint.toBuffer()],
      program.programId
    );

    // Check if already whitelisted
    try {
      const existingToken = await program.account.whitelistedToken.fetch(whitelistedTokenPda);
      if (existingToken.isActive) {
        console.log(`   ⏭️  ${tokenName.padEnd(10)}: Already whitelisted (index ${existingToken.assetIndex})`);
        skippedCount++;
        continue;
      }
    } catch {
      // Not whitelisted, continue
    }

    // Add to whitelist
    try {
      await program.methods
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

      console.log(`   ✅ ${tokenName.padEnd(10)}: Added to whitelist (index ${assetIndex})`);
      successCount++;
      
      // Small delay to avoid rate limiting
      await sleep(300);

    } catch (error: any) {
      console.log(`   ❌ ${tokenName.padEnd(10)}: ${error.message?.slice(0, 50)}`);
      errorCount++;
    }
  }

  console.log("\n" + "═".repeat(80));
  console.log("📊 WHITELIST INITIALIZATION SUMMARY");
  console.log("═".repeat(80) + "\n");
  
  console.log(`   ✅ Successfully Added: ${successCount}`);
  console.log(`   ⏭️  Already Whitelisted: ${skippedCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log(`   📋 Total Tokens: ${Object.keys(tokenMints).length}`);

  if (successCount + skippedCount === Object.keys(tokenMints).length) {
    console.log("\n" + "🎉".repeat(30));
    console.log("✅ ALL TOKENS WHITELISTED SUCCESSFULLY!");
    console.log("🎉".repeat(30) + "\n");
  } else {
    console.log("\n⚠️  Some tokens were not whitelisted. Check the errors above.\n");
  }

  // Display all whitelisted tokens
  console.log("═".repeat(80));
  console.log("📋 WHITELISTED TOKENS");
  console.log("═".repeat(80) + "\n");

  for (let i = 0; i < Object.keys(tokenMints).length; i++) {
    const tokenMint = tokenMints[i];
    const tokenName = TOKEN_NAMES[i] || `TOKEN_${i}`;

    if (!tokenMint) continue;

    const [whitelistedTokenPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("whitelist_token_v2"), tokenMint.toBuffer()],
      program.programId
    );

    try {
      const whitelistedToken = await program.account.whitelistedToken.fetch(whitelistedTokenPda);
      const status = whitelistedToken.isActive ? "✅ Active" : "❌ Inactive";
      console.log(`   ${i.toString().padStart(2)}: ${tokenName.padEnd(10)} | ${status} | ${tokenMint.toString()}`);
    } catch {
      console.log(`   ${i.toString().padStart(2)}: ${tokenName.padEnd(10)} | ⚠️  Not Found`);
    }
  }

  console.log("\n");
}

main().catch(console.error);

