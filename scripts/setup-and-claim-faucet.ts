import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaFaucet } from "../target/types/cryptarena_faucet";
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
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Pyth Price Feed IDs for devnet (these are the same as mainnet)
const PYTH_FEEDS: { [key: number]: string } = {
  0: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", // SOL/USD
  1: "0x879551021853eec7a7dc827578e8e69da7e4fa8148339aa0d3d5296405be4b1a", // TRUMP
  2: "0x7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9", // PUMP
  3: "0x72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419", // BONK
  4: "0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996", // JUP
  5: "0xbed3097008b9b5e3c93bec20be79cb43986b85a996475589351a21e67bae9b61", // PENGU
  6: "0x0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff", // PYTH
  7: "0x649fdd7ec08e8e2a20f425729854e90293dcbe2376abc47197a14da6ff339756", // HNT
  8: "0x058cd29ef0e714c5affc44f269b2c1899a52da416d7acc147b9da692e6953608", // FARTCOIN
  9: "0x91568baa8beb53db23eb3fb7f22c6e8bd303d103919e19733f2bb642d3e7987a", // RAY
  10: "0xb43660a5f790c69354b0729a5ef9d50d68f1df92107540210b9cccba1f947cc2", // JTO
  11: "0xb17e5bc5de742a8a378b54c9c75442b7d51e30ada63f28d9bd28d3c0e26511a0", // KMNO
  12: "0x0292e0f405bcd4a496d34e48307f6787349ad2bcd8505c3d3a9f77d81a67a682", // MET
  13: "0xeff7446475e218517566ea99e72a4abec2e1bd8498b43b7d8331e29dcb059389", // W
};

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

// Pyth Solana Receiver Program on devnet
const PYTH_RECEIVER_PROGRAM = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

// Load keypair from file
function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

// Format SOL amount
const formatSOL = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);

// Sleep helper
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🚰 CRYPTARENA FAUCET - SETUP & TOKEN DISTRIBUTION");
  console.log("   Using Pyth Price Feeds to mint $15 worth of each token");
  console.log("=".repeat(80) + "\n");

  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.CryptarenaFaucet as Program<CryptarenaFaucet>;
  const admin = (provider.wallet as any).payer as Keypair;

  console.log("📋 Configuration:");
  console.log(`   Faucet Program ID: ${program.programId.toString()}`);
  console.log(`   Admin: ${admin.publicKey.toString()}`);
  console.log(`   Cluster: ${connection.rpcEndpoint}`);
  
  const adminBalance = await connection.getBalance(admin.publicKey);
  console.log(`   Admin Balance: ${formatSOL(adminBalance)} SOL`);
  console.log("");

  // Derive Faucet State PDA
  const [faucetStatePda, faucetBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_state")],
    program.programId
  );
  console.log(`   Faucet State PDA: ${faucetStatePda.toString()}`);
  console.log("");

  // ================================================================
  // STEP 1: Initialize Faucet
  // ================================================================
  console.log("=".repeat(80));
  console.log("STEP 1: Initialize Faucet");
  console.log("=".repeat(80));

  let faucetState;
  try {
    faucetState = await program.account.faucetState.fetch(faucetStatePda);
    console.log("✅ Faucet already initialized");
    console.log(`   Admin: ${faucetState.admin.toString()}`);
    console.log(`   Is Active: ${faucetState.isActive}`);
  } catch (e) {
    console.log("🔧 Initializing faucet...");
    
    try {
      const tx = await program.methods
        .initialize()
        .accountsStrict({
          faucetState: faucetStatePda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      
      console.log(`   Transaction: ${tx}`);
      faucetState = await program.account.faucetState.fetch(faucetStatePda);
      console.log("✅ Faucet initialized!");
    } catch (initError: any) {
      console.log(`❌ Init error: ${initError.message}`);
      return;
    }
  }
  console.log("");

  // ================================================================
  // STEP 2: Create Token Mints with Faucet PDA as Mint Authority
  // ================================================================
  console.log("=".repeat(80));
  console.log("STEP 2: Create Token Mints (Faucet PDA as Mint Authority)");
  console.log("=".repeat(80));

  const walletDir = path.join(__dirname, "../test-wallets");
  const mintsFilePath = path.join(walletDir, "token-mints.json");

  // Ensure directory exists
  if (!fs.existsSync(walletDir)) {
    fs.mkdirSync(walletDir, { recursive: true });
  }

  const tokenMints: { [key: number]: PublicKey } = {};

  // Check if mints already exist
  if (fs.existsSync(mintsFilePath)) {
    console.log("📂 Loading existing token mints...");
    const existingMints = JSON.parse(fs.readFileSync(mintsFilePath, "utf-8"));
    for (const [key, value] of Object.entries(existingMints)) {
      tokenMints[parseInt(key)] = new PublicKey(value as string);
      console.log(`   ✅ ${ASSETS[parseInt(key)].symbol}: ${value}`);
    }
  } else {
    console.log("🔧 Creating new token mints...\n");
    
    for (const asset of ASSETS) {
      try {
        console.log(`   Creating ${asset.symbol}...`);
        
        // Create mint with faucet PDA as mint authority
        const mint = await createMint(
          connection,
          admin,
          faucetStatePda, // Faucet PDA is mint authority (so faucet can mint)
          null, // No freeze authority
          asset.decimals,
        );
        
        tokenMints[asset.index] = mint;
        console.log(`   ✅ ${asset.symbol}: ${mint.toString()}`);
        
        // Small delay to avoid rate limiting
        await sleep(500);
        
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

  // ================================================================
  // STEP 3: Register Tokens with Faucet
  // ================================================================
  console.log("=".repeat(80));
  console.log("STEP 3: Register Tokens with Faucet");
  console.log("=".repeat(80));

  // Reload faucet state to check registered mints
  faucetState = await program.account.faucetState.fetch(faucetStatePda);
  
  for (const asset of ASSETS) {
    const mint = tokenMints[asset.index];
    if (!mint) continue;

    const registeredMint = faucetState.tokenMints[asset.index];
    
    if (registeredMint && !registeredMint.equals(PublicKey.default)) {
      console.log(`   ✅ ${asset.symbol} already registered: ${registeredMint.toString().slice(0, 20)}...`);
    } else {
      try {
        console.log(`   Registering ${asset.symbol}...`);
        
        const tx = await program.methods
          .registerToken(asset.index)
          .accountsStrict({
            faucetState: faucetStatePda,
            tokenMint: mint,
            admin: admin.publicKey,
          })
          .signers([admin])
          .rpc();
        
        console.log(`   ✅ ${asset.symbol} registered! TX: ${tx.slice(0, 20)}...`);
        await sleep(500);
        
      } catch (error: any) {
        console.log(`   ❌ Error registering ${asset.symbol}: ${error.message.slice(0, 50)}...`);
      }
    }
  }
  console.log("");

  // ================================================================
  // STEP 4: Load Player Wallets
  // ================================================================
  console.log("=".repeat(80));
  console.log("STEP 4: Load Player Wallets");
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

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log("=".repeat(80));
  console.log("📊 SETUP SUMMARY");
  console.log("=".repeat(80));
  
  console.log("\n✅ Faucet State PDA: " + faucetStatePda.toString());
  console.log("\n📜 Token Mints (Faucet PDA is mint authority):");
  for (const asset of ASSETS) {
    const mint = tokenMints[asset.index];
    if (mint) {
      console.log(`   ${asset.symbol.padEnd(12)} ${mint.toString()}`);
    }
  }
  
  console.log("\n👥 Player Wallets:");
  for (let i = 0; i < players.length; i++) {
    console.log(`   Player ${(i + 1).toString().padEnd(2)}: ${players[i].publicKey.toString()}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("⚠️  NEXT STEP: Run claim-tokens.ts to claim $15 worth of each token");
  console.log("   The claim function will use Pyth price feeds to calculate amounts");
  console.log("=".repeat(80) + "\n");
}

main().catch(console.error);

