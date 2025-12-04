import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Asset configuration with mock USD prices for $15 value calculation
const ASSETS = [
  { index: 0, symbol: "tSOL", decimals: 9, mockPrice: 200 },      // $200/SOL -> 0.075 tokens
  { index: 1, symbol: "tTRUMP", decimals: 9, mockPrice: 15 },     // $15 -> 1 token
  { index: 2, symbol: "tPUMP", decimals: 9, mockPrice: 0.02 },    // $0.02 -> 750 tokens
  { index: 3, symbol: "tBONK", decimals: 9, mockPrice: 0.00003 }, // -> 500,000 tokens
  { index: 4, symbol: "tJUP", decimals: 9, mockPrice: 1.2 },      // $1.2 -> 12.5 tokens
  { index: 5, symbol: "tPENGU", decimals: 9, mockPrice: 0.03 },   // -> 500 tokens
  { index: 6, symbol: "tPYTH", decimals: 9, mockPrice: 0.40 },    // -> 37.5 tokens
  { index: 7, symbol: "tHNT", decimals: 9, mockPrice: 6 },        // -> 2.5 tokens
  { index: 8, symbol: "tFARTCOIN", decimals: 9, mockPrice: 1.5 }, // -> 10 tokens
  { index: 9, symbol: "tRAY", decimals: 9, mockPrice: 5 },        // -> 3 tokens
  { index: 10, symbol: "tJTO", decimals: 9, mockPrice: 3.5 },     // -> 4.3 tokens
  { index: 11, symbol: "tKMNO", decimals: 9, mockPrice: 0.15 },   // -> 100 tokens
  { index: 12, symbol: "tMET", decimals: 9, mockPrice: 0.05 },    // -> 300 tokens
  { index: 13, symbol: "tW", decimals: 9, mockPrice: 0.30 },      // -> 50 tokens
];

const USD_VALUE = 15; // $15 worth of tokens

function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

const formatSOL = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("💰 CRYPTARENA - MINT TEST TOKENS ($15 worth each)");
  console.log("=".repeat(80) + "\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const admin = (provider.wallet as any).payer as Keypair;

  console.log("📋 Configuration:");
  console.log(`   Admin: ${admin.publicKey.toString()}`);
  console.log(`   Cluster: ${connection.rpcEndpoint}`);
  
  const adminBalance = await connection.getBalance(admin.publicKey);
  console.log(`   Admin Balance: ${formatSOL(adminBalance)} SOL\n`);

  // Load or create token mints
  const walletDir = path.join(__dirname, "../test-wallets");
  const mintsFilePath = path.join(walletDir, "token-mints.json");

  if (!fs.existsSync(walletDir)) {
    fs.mkdirSync(walletDir, { recursive: true });
  }

  let tokenMints: { [key: number]: PublicKey } = {};

  // Check if mints already exist
  if (fs.existsSync(mintsFilePath)) {
    console.log("📂 Loading existing admin-controlled token mints...");
    const existingMints = JSON.parse(fs.readFileSync(mintsFilePath, "utf-8"));
    for (const [key, value] of Object.entries(existingMints)) {
      tokenMints[parseInt(key)] = new PublicKey(value as string);
      console.log(`   ✅ ${ASSETS[parseInt(key)].symbol}: ${value}`);
    }
  } else {
    console.log("🔧 Creating new token mints (admin as mint authority)...\n");
    
    for (const asset of ASSETS) {
      try {
        const mint = await createMint(
          connection,
          admin,
          admin.publicKey, // Admin is mint authority
          null,
          asset.decimals,
        );
        
        tokenMints[asset.index] = mint;
        console.log(`   ✅ ${asset.symbol}: ${mint.toString()}`);
        await sleep(300);
      } catch (error: any) {
        console.log(`   ❌ ${asset.symbol}: ${error.message}`);
      }
    }

    // Save mints
    const mintsToSave: { [key: number]: string } = {};
    for (const [key, value] of Object.entries(tokenMints)) {
      mintsToSave[parseInt(key)] = value.toString();
    }
    fs.writeFileSync(mintsFilePath, JSON.stringify(mintsToSave, null, 2));
    console.log(`\n📁 Saved to ${mintsFilePath}`);
  }
  console.log("");

  // Load player wallets
  const players: Keypair[] = [];
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    if (fs.existsSync(walletPath)) {
      players.push(loadKeypair(walletPath));
    }
  }
  console.log(`👥 Loaded ${players.length} player wallets\n`);

  // Mint $15 worth of each token to each player
  console.log("=".repeat(80));
  console.log("MINTING $15 WORTH OF EACH TOKEN TO ALL PLAYERS");
  console.log("=".repeat(80));

  for (let playerIdx = 0; playerIdx < players.length; playerIdx++) {
    const player = players[playerIdx];
    console.log(`\n👤 Player ${playerIdx + 1}: ${player.publicKey.toString().slice(0, 24)}...`);
    
    for (const asset of ASSETS) {
      const mint = tokenMints[asset.index];
      if (!mint) continue;

      try {
        // Calculate $15 worth of tokens
        const tokenAmount = USD_VALUE / asset.mockPrice;
        const rawAmount = BigInt(Math.floor(tokenAmount * Math.pow(10, asset.decimals)));

        // Get or create ATA
        const ata = await getOrCreateAssociatedTokenAccount(
          connection,
          admin,
          mint,
          player.publicKey,
        );

        // Check current balance
        const currentBalance = Number(ata.amount);
        const neededBalance = Number(rawAmount);

        if (currentBalance >= neededBalance) {
          const humanBalance = (currentBalance / Math.pow(10, asset.decimals)).toFixed(2);
          console.log(`   ✅ ${asset.symbol.padEnd(12)}: ${humanBalance} tokens (already funded)`);
        } else {
          // Mint tokens
          await mintTo(
            connection,
            admin,
            mint,
            ata.address,
            admin,
            rawAmount,
          );
          
          const humanAmount = tokenAmount.toFixed(4);
          console.log(`   💰 ${asset.symbol.padEnd(12)}: Minted ${humanAmount} tokens ($${USD_VALUE} @ $${asset.mockPrice})`);
        }
        
        await sleep(200);
      } catch (error: any) {
        console.log(`   ❌ ${asset.symbol.padEnd(12)}: ${error.message.slice(0, 40)}...`);
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 SUMMARY");
  console.log("=".repeat(80));
  
  console.log("\n📜 Token Mints:");
  for (const asset of ASSETS) {
    const mint = tokenMints[asset.index];
    if (mint) {
      const tokensPer15 = (USD_VALUE / asset.mockPrice).toFixed(4);
      console.log(`   ${asset.symbol.padEnd(12)} ${mint.toString()} | $${asset.mockPrice} | ${tokensPer15} tokens = $15`);
    }
  }

  console.log("\n👥 Players funded with $15 worth of each token:");
  for (let i = 0; i < players.length; i++) {
    console.log(`   Player ${(i + 1).toString().padEnd(2)}: ${players[i].publicKey.toString()}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ MINTING COMPLETE! Players are ready for arena testing.");
  console.log("=".repeat(80) + "\n");
}

main().catch(console.error);

