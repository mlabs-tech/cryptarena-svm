import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaFaucet } from "../target/types/cryptarena_faucet";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Asset configuration
const ASSETS = [
  { index: 0, name: "Solana", symbol: "tSOL", decimals: 9 },
  { index: 1, name: "Official Trump", symbol: "tTRUMP", decimals: 9 },
  { index: 2, name: "Pump.fun", symbol: "tPUMP", decimals: 9 },
  { index: 3, name: "Bonk", symbol: "tBONK", decimals: 9 },
  { index: 4, name: "Jupiter", symbol: "tJUP", decimals: 9 },
  { index: 5, name: "Pudgy Penguin", symbol: "tPENGU", decimals: 9 },
  { index: 6, name: "Pyth Network", symbol: "tPYTH", decimals: 9 },
  { index: 7, name: "Helium", symbol: "tHNT", decimals: 9 },
  { index: 8, name: "Fartcoin", symbol: "tFARTCOIN", decimals: 9 },
  { index: 9, name: "Raydium", symbol: "tRAY", decimals: 9 },
  { index: 10, name: "Jito", symbol: "tJTO", decimals: 9 },
  { index: 11, name: "Kamino", symbol: "tKMNO", decimals: 9 },
  { index: 12, name: "Meteora", symbol: "tMET", decimals: 9 },
  { index: 13, name: "Wormhole", symbol: "tW", decimals: 9 },
];

// Load keypair from file
function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

// Format SOL amount
const formatSOL = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🚰 CRYPTARENA - TEST TOKEN SETUP & DISTRIBUTION");
  console.log("=".repeat(80) + "\n");

  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const admin = (provider.wallet as any).payer as Keypair;

  console.log("📋 Configuration:");
  console.log(`   Admin: ${admin.publicKey.toString()}`);
  console.log(`   Cluster: ${connection.rpcEndpoint}`);
  
  const adminBalance = await connection.getBalance(admin.publicKey);
  console.log(`   Admin Balance: ${formatSOL(adminBalance)} SOL`);
  console.log("");

  // Step 1: Create Test Token Mints (admin as mint authority for testing)
  console.log("=".repeat(80));
  console.log("STEP 1: Create Test Token Mints");
  console.log("=".repeat(80));

  const tokenMints: { [key: number]: PublicKey } = {};
  const walletDir = path.join(__dirname, "../test-wallets");
  const mintsFilePath = path.join(walletDir, "token-mints.json");

  // Ensure directory exists
  if (!fs.existsSync(walletDir)) {
    fs.mkdirSync(walletDir, { recursive: true });
  }

  // Check if mints already exist
  if (fs.existsSync(mintsFilePath)) {
    console.log("📂 Loading existing token mints...");
    const existingMints = JSON.parse(fs.readFileSync(mintsFilePath, "utf-8"));
    for (const [key, value] of Object.entries(existingMints)) {
      tokenMints[parseInt(key)] = new PublicKey(value as string);
      console.log(`   ✅ ${ASSETS[parseInt(key)].symbol}: ${value}`);
    }
  } else {
    console.log("🔧 Creating new token mints (admin as mint authority)...\n");
    
    for (const asset of ASSETS) {
      try {
        console.log(`   Creating ${asset.symbol}...`);
        
        const mint = await createMint(
          connection,
          admin,
          admin.publicKey, // Admin is mint authority for testing
          null, // No freeze authority
          asset.decimals,
        );
        
        tokenMints[asset.index] = mint;
        console.log(`   ✅ ${asset.symbol}: ${mint.toString()}`);
        
      } catch (error: any) {
        console.log(`   ❌ Error creating ${asset.symbol}: ${error.message}`);
      }
    }

    // Save mints to file
    const mintsToSave: { [key: number]: string } = {};
    for (const [key, value] of Object.entries(tokenMints)) {
      mintsToSave[parseInt(key)] = value.toString();
    }
    fs.writeFileSync(mintsFilePath, JSON.stringify(mintsToSave, null, 2));
    console.log(`\n📁 Token mints saved to ${mintsFilePath}`);
  }
  console.log("");

  // Step 2: Load Player Wallets
  console.log("=".repeat(80));
  console.log("STEP 2: Load Player Wallets");
  console.log("=".repeat(80));

  const players: Keypair[] = [];
  
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    if (fs.existsSync(walletPath)) {
      const player = loadKeypair(walletPath);
      players.push(player);
      
      const balance = await connection.getBalance(player.publicKey);
      console.log(`   Player ${i}: ${player.publicKey.toString().slice(0, 20)}... | ${formatSOL(balance)} SOL`);
    } else {
      console.log(`   ❌ Player ${i} wallet not found`);
    }
  }
  console.log("");

  // Step 3: Distribute Tokens to Each Player
  console.log("=".repeat(80));
  console.log("STEP 3: Mint Test Tokens to All Players");
  console.log("=".repeat(80));

  const TOKENS_PER_PLAYER = BigInt(1000 * 1e9); // 1000 tokens with 9 decimals

  for (let playerIdx = 0; playerIdx < players.length; playerIdx++) {
    const player = players[playerIdx];
    console.log(`\n👤 Player ${playerIdx + 1}: ${player.publicKey.toString().slice(0, 20)}...`);
    
    for (const asset of ASSETS) {
      const mint = tokenMints[asset.index];
      if (!mint) {
        console.log(`   ⚠️ Skipping ${asset.symbol} - mint not found`);
        continue;
      }

      try {
        // Get or create associated token account
        const ata = await getOrCreateAssociatedTokenAccount(
          connection,
          admin, // Payer
          mint,
          player.publicKey,
        );

        // Check current balance
        const currentBalance = ata.amount;
        
        if (currentBalance >= TOKENS_PER_PLAYER) {
          console.log(`   ✅ ${asset.symbol.padEnd(10)}: ${(Number(currentBalance) / 1e9).toFixed(0)} tokens (already funded)`);
        } else {
          // Mint tokens
          await mintTo(
            connection,
            admin,
            mint,
            ata.address,
            admin, // Mint authority
            TOKENS_PER_PLAYER,
          );
          console.log(`   💰 ${asset.symbol.padEnd(10)}: Minted 1000 tokens`);
        }
        
      } catch (error: any) {
        console.log(`   ❌ ${asset.symbol.padEnd(10)}: ${error.message.slice(0, 50)}...`);
      }
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("📊 SETUP SUMMARY");
  console.log("=".repeat(80));
  
  console.log("\n📜 Token Mints Created:");
  for (const asset of ASSETS) {
    const mint = tokenMints[asset.index];
    if (mint) {
      console.log(`   ${asset.symbol.padEnd(12)} ${mint.toString()}`);
    }
  }
  
  console.log("\n👥 Players Funded (1000 of each token):");
  for (let i = 0; i < players.length; i++) {
    console.log(`   Player ${(i + 1).toString().padEnd(2)}: ${players[i].publicKey.toString()}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ TOKEN SETUP COMPLETE!");
  console.log("=".repeat(80) + "\n");
}

main().catch(console.error);
