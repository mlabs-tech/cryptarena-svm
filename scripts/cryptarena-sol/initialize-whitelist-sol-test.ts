/**
 * Initialize Whitelist for Cryptarena SOL TEST
 * 
 * Sets up all tokens with real mainnet addresses for the TEST program:
 * - 14 Solana tokens
 * - 5 EVM tokens (ETH, UNI, LINK, PEPE, SHIB)
 * 
 * Usage: npx ts-node scripts/cryptarena-sol/initialize-whitelist-sol-test.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Connection,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ============================================================================
// CONFIG - TEST PROGRAM
// ============================================================================

const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET_PATH = process.env.ANCHOR_WALLET || path.join(os.homedir(), ".config/solana/id.json");
const PROGRAM_ID = new PublicKey("J1HvjpKh1tUQQFJ3Fm5ZM7h4GSrvivdWTwzQ3UALfT9T"); // TEST PROGRAM

// Chain types
const CHAIN_SOLANA = 0;
const CHAIN_EVM = 1;

// ============================================================================
// TOKEN DEFINITIONS - Real Mainnet Addresses
// ============================================================================

// Solana Mainnet Token Addresses
const SOLANA_TOKENS = [
  { index: 0, symbol: "SOL", address: "So11111111111111111111111111111111111111112" }, // Wrapped SOL
  { index: 1, symbol: "TRUMP", address: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN" },
  { index: 2, symbol: "PUMP", address: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn" },
  { index: 3, symbol: "BONK", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { index: 4, symbol: "JUP", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { index: 5, symbol: "PENGU", address: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv" },
  { index: 6, symbol: "PYTH", address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  { index: 7, symbol: "HNT", address: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux" },
  { index: 8, symbol: "FARTCOIN", address: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump" },
  { index: 9, symbol: "RAY", address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  { index: 10, symbol: "JTO", address: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL" },
  { index: 11, symbol: "KMNO", address: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS" },
  { index: 12, symbol: "MET", address: "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL" },
  { index: 13, symbol: "W", address: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ" },
];

// EVM Mainnet Token Addresses (Ethereum)
const EVM_TOKENS = [
  { index: 14, symbol: "ETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" }, // WETH
  { index: 15, symbol: "UNI", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" }, // Uniswap
  { index: 16, symbol: "LINK", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA" }, // Chainlink
  { index: 17, symbol: "PEPE", address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933" }, // Pepe
  { index: 18, symbol: "SHIB", address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE" }, // Shiba Inu
];

// ============================================================================
// HELPERS
// ============================================================================

function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function symbolToBytes(symbol: string): number[] {
  const bytes = new Array(10).fill(0);
  const encoded = Buffer.from(symbol);
  for (let i = 0; i < Math.min(encoded.length, 10); i++) {
    bytes[i] = encoded[i];
  }
  return bytes;
}

function solanaAddressToBytes(address: string): number[] {
  const pubkey = new PublicKey(address);
  return Array.from(pubkey.toBytes());
}

function evmAddressToBytes(address: string): number[] {
  const bytes = new Array(32).fill(0);
  const hex = address.startsWith("0x") ? address.slice(2) : address;
  const addressBytes = Buffer.from(hex, "hex");
  // EVM addresses are 20 bytes, pad to 32
  for (let i = 0; i < addressBytes.length; i++) {
    bytes[i] = addressBytes[i];
  }
  return bytes;
}

function getWhitelistTokenPda(assetIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist_token"), Buffer.from([assetIndex])],
    PROGRAM_ID
  )[0];
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🪙 INITIALIZE WHITELIST - Cryptarena SOL TEST");
  console.log("═".repeat(80) + "\n");

  // Setup connection and wallet
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair(WALLET_PATH);
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  // Load program
  const idlPath = path.join(__dirname, "../../target/idl/cryptarena_sol_test.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  console.log(`📋 Program ID: ${PROGRAM_ID.toString()}`);
  console.log(`👤 Admin: ${admin.publicKey.toString()}`);
  console.log(`🌐 Cluster: ${connection.rpcEndpoint}\n`);

  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state")],
    PROGRAM_ID
  );

  let added = 0;
  let skipped = 0;
  let errors = 0;

  // =========================================================================
  // ADD SOLANA TOKENS
  // =========================================================================
  console.log("═".repeat(80));
  console.log("🔶 SOLANA TOKENS");
  console.log("═".repeat(80) + "\n");

  for (const token of SOLANA_TOKENS) {
    const whitelistPda = getWhitelistTokenPda(token.index);

    try {
      // Check if already exists
      const accountInfo = await connection.getAccountInfo(whitelistPda);
      if (accountInfo !== null) {
        console.log(`⏭️  ${token.index.toString().padStart(2)}: ${token.symbol.padEnd(10)} | Already exists`);
        skipped++;
        continue;
      }

      // Add token
      await program.methods
        .addWhitelistedToken(
          token.index,
          CHAIN_SOLANA,
          solanaAddressToBytes(token.address),
          symbolToBytes(token.symbol)
        )
        .accounts({
          globalState: globalStatePda,
          whitelistedToken: whitelistPda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`✅ ${token.index.toString().padStart(2)}: ${token.symbol.padEnd(10)} | ${token.address.slice(0, 20)}...`);
      added++;
      await sleep(500);
    } catch (error: any) {
      console.log(`❌ ${token.index.toString().padStart(2)}: ${token.symbol.padEnd(10)} | Error: ${error.message?.slice(0, 50) || error}`);
      errors++;
    }
  }

  // =========================================================================
  // ADD EVM TOKENS
  // =========================================================================
  console.log("\n" + "═".repeat(80));
  console.log("🔷 EVM TOKENS (Ethereum)");
  console.log("═".repeat(80) + "\n");

  for (const token of EVM_TOKENS) {
    const whitelistPda = getWhitelistTokenPda(token.index);

    try {
      // Check if already exists
      const accountInfo = await connection.getAccountInfo(whitelistPda);
      if (accountInfo !== null) {
        console.log(`⏭️  ${token.index.toString().padStart(2)}: ${token.symbol.padEnd(10)} | Already exists`);
        skipped++;
        continue;
      }

      // Add token
      await program.methods
        .addWhitelistedToken(
          token.index,
          CHAIN_EVM,
          evmAddressToBytes(token.address),
          symbolToBytes(token.symbol)
        )
        .accounts({
          globalState: globalStatePda,
          whitelistedToken: whitelistPda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`✅ ${token.index.toString().padStart(2)}: ${token.symbol.padEnd(10)} | ${token.address}`);
      added++;
      await sleep(500);
    } catch (error: any) {
      console.log(`❌ ${token.index.toString().padStart(2)}: ${token.symbol.padEnd(10)} | Error: ${error.message?.slice(0, 50) || error}`);
      errors++;
    }
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log("\n" + "═".repeat(80));
  console.log("📊 SUMMARY");
  console.log("═".repeat(80) + "\n");

  console.log(`   ✅ Added:   ${added}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors:  ${errors}`);
  console.log(`   📋 Total:   ${SOLANA_TOKENS.length + EVM_TOKENS.length}\n`);

  if (errors === 0) {
    console.log("🎉 WHITELIST INITIALIZED SUCCESSFULLY FOR TEST PROGRAM!\n");
  } else {
    console.log("⚠️  Some tokens failed to add. Check errors above.\n");
  }

  // Show all tokens
  console.log("═".repeat(80));
  console.log("📋 ALL WHITELISTED TOKENS");
  console.log("═".repeat(80) + "\n");

  console.log("Index | Symbol     | Chain   | Address");
  console.log("-".repeat(70));

  for (const token of SOLANA_TOKENS) {
    console.log(`  ${token.index.toString().padStart(2)}  | ${token.symbol.padEnd(10)} | Solana  | ${token.address.slice(0, 44)}`);
  }
  for (const token of EVM_TOKENS) {
    console.log(`  ${token.index.toString().padStart(2)}  | ${token.symbol.padEnd(10)} | EVM     | ${token.address}`);
  }

  console.log("\n");
}

main().catch(console.error);
