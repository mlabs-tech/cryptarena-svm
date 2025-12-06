/**
 * Check Whitelist
 * 
 * This script checks the current whitelist status for all tokens.
 * 
 * Usage: npx ts-node scripts/check-whitelist.ts
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

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("📋 CHECK TOKEN WHITELIST");
  console.log("═".repeat(80) + "\n");

  // Setup connection and wallet
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair(WALLET_PATH);
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.CryptarenaSvmTest as Program<CryptarenaSvmTest>;

  console.log(`📋 Program ID: ${program.programId.toString()}`);
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

  console.log("═".repeat(80));
  console.log("📊 WHITELISTED TOKENS");
  console.log("═".repeat(80) + "\n");

  let activeCount = 0;
  let inactiveCount = 0;
  let notFoundCount = 0;

  for (let i = 0; i < Object.keys(tokenMints).length; i++) {
    const tokenMint = tokenMints[i];
    const tokenName = TOKEN_NAMES[i] || `TOKEN_${i}`;

    if (!tokenMint) {
      console.log(`   ${i.toString().padStart(2)}: ${tokenName.padEnd(10)} | ⚠️  Mint not configured`);
      notFoundCount++;
      continue;
    }

    const [whitelistedTokenPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("whitelist_token_v2"), tokenMint.toBuffer()],
      program.programId
    );

    try {
      const whitelistedToken = await program.account.whitelistedToken.fetch(whitelistedTokenPda);
      const status = whitelistedToken.isActive ? "✅ Active  " : "❌ Inactive";
      
      console.log(`   ${i.toString().padStart(2)}: ${tokenName.padEnd(10)} | ${status} | Index: ${whitelistedToken.assetIndex}`);
      
      if (whitelistedToken.isActive) {
        activeCount++;
      } else {
        inactiveCount++;
      }
    } catch {
      console.log(`   ${i.toString().padStart(2)}: ${tokenName.padEnd(10)} | ⚠️  Not Found (not whitelisted yet)`);
      notFoundCount++;
    }
  }

  console.log("\n" + "═".repeat(80));
  console.log("📊 SUMMARY");
  console.log("═".repeat(80) + "\n");
  
  console.log(`   ✅ Active: ${activeCount}`);
  console.log(`   ❌ Inactive: ${inactiveCount}`);
  console.log(`   ⚠️  Not Whitelisted: ${notFoundCount}`);
  console.log(`   📋 Total Tokens: ${Object.keys(tokenMints).length}\n`);

  if (activeCount === Object.keys(tokenMints).length) {
    console.log("🎉 All tokens are whitelisted and active!\n");
  } else if (activeCount + inactiveCount === Object.keys(tokenMints).length) {
    console.log("⚠️  All tokens are whitelisted, but some are inactive.\n");
  } else {
    console.log("⚠️  Some tokens need to be whitelisted. Run: npx ts-node scripts/initialize-whitelist.ts\n");
  }
}

main().catch(console.error);

