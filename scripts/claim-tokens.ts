import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaFaucet } from "../target/types/cryptarena_faucet";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
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

// Pyth Price Feed IDs (hex without 0x prefix)
const PYTH_FEED_IDS: { [key: number]: string } = {
  0: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", // SOL
  1: "879551021853eec7a7dc827578e8e69da7e4fa8148339aa0d3d5296405be4b1a", // TRUMP
  2: "7a01fca212788bba7c5bf8c9efd576a8a722f070d2c17596ff7bb609b8d5c3b9", // PUMP
  3: "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419", // BONK
  4: "0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996", // JUP
  5: "bed3097008b9b5e3c93bec20be79cb43986b85a996475589351a21e67bae9b61", // PENGU
  6: "0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff", // PYTH
  7: "649fdd7ec08e8e2a20f425729854e90293dcbe2376abc47197a14da6ff339756", // HNT
  8: "058cd29ef0e714c5affc44f269b2c1899a52da416d7acc147b9da692e6953608", // FARTCOIN
  9: "91568baa8beb53db23eb3fb7f22c6e8bd303d103919e19733f2bb642d3e7987a", // RAY
  10: "b43660a5f790c69354b0729a5ef9d50d68f1df92107540210b9cccba1f947cc2", // JTO
  11: "b17e5bc5de742a8a378b54c9c75442b7d51e30ada63f28d9bd28d3c0e26511a0", // KMNO
  12: "0292e0f405bcd4a496d34e48307f6787349ad2bcd8505c3d3a9f77d81a67a682", // MET
  13: "eff7446475e218517566ea99e72a4abec2e1bd8498b43b7d8331e29dcb059389", // W
};

// Pyth Receiver program ID
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

// Derive Price Update PDA from feed ID
function derivePriceUpdatePDA(feedIdHex: string): PublicKey {
  const feedIdBytes = Buffer.from(feedIdHex, "hex");
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("price_update"), feedIdBytes],
    PYTH_RECEIVER_PROGRAM
  );
  return pda;
}

async function main() {
  // Parse command line args
  const args = process.argv.slice(2);
  const playerArg = args.find(a => a.startsWith("--player="));
  const assetArg = args.find(a => a.startsWith("--asset="));
  
  const targetPlayer = playerArg ? parseInt(playerArg.split("=")[1]) : null;
  const targetAsset = assetArg ? parseInt(assetArg.split("=")[1]) : null;

  console.log("\n" + "=".repeat(80));
  console.log("🚰 CRYPTARENA FAUCET - CLAIM TOKENS ($15 worth via Pyth)");
  console.log("=".repeat(80) + "\n");

  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.CryptarenaFaucet as Program<CryptarenaFaucet>;
  const admin = (provider.wallet as any).payer as Keypair;

  console.log("📋 Configuration:");
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   Cluster: ${connection.rpcEndpoint}`);
  if (targetPlayer) console.log(`   Target Player: ${targetPlayer}`);
  if (targetAsset !== null) console.log(`   Target Asset: ${ASSETS[targetAsset]?.symbol || targetAsset}`);
  console.log("");

  // Derive Faucet State PDA
  const [faucetStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("faucet_state")],
    program.programId
  );

  // Load faucet state
  const faucetState = await program.account.faucetState.fetch(faucetStatePda);
  console.log(`✅ Faucet loaded: ${faucetStatePda.toString()}`);
  console.log(`   Is Active: ${faucetState.isActive}`);
  console.log("");

  // Load token mints
  const walletDir = path.join(__dirname, "../test-wallets");
  const mintsFilePath = path.join(walletDir, "token-mints.json");
  
  if (!fs.existsSync(mintsFilePath)) {
    console.log("❌ Token mints not found. Run setup-and-claim-faucet.ts first!");
    return;
  }
  
  const tokenMints: { [key: number]: PublicKey } = {};
  const existingMints = JSON.parse(fs.readFileSync(mintsFilePath, "utf-8"));
  for (const [key, value] of Object.entries(existingMints)) {
    tokenMints[parseInt(key)] = new PublicKey(value as string);
  }
  console.log(`📜 Loaded ${Object.keys(tokenMints).length} token mints`);
  console.log("");

  // Load player wallets
  const players: Keypair[] = [];
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    if (fs.existsSync(walletPath)) {
      players.push(loadKeypair(walletPath));
    }
  }
  console.log(`👥 Loaded ${players.length} player wallets`);
  console.log("");

  // ================================================================
  // CLAIM TOKENS FOR PLAYERS
  // ================================================================
  console.log("=".repeat(80));
  console.log("CLAIMING TOKENS (Each claim = $15 worth based on Pyth price)");
  console.log("=".repeat(80));

  const assetsToProcess = targetAsset !== null ? [ASSETS[targetAsset]] : ASSETS;
  const playersToProcess = targetPlayer 
    ? [{ player: players[targetPlayer - 1], idx: targetPlayer }]
    : players.map((p, i) => ({ player: p, idx: i + 1 }));

  for (const { player, idx: playerIdx } of playersToProcess) {
    if (!player) continue;
    
    console.log(`\n👤 Player ${playerIdx}: ${player.publicKey.toString().slice(0, 20)}...`);
    
    // Initialize user faucet state if needed
    const [userFaucetStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_faucet_state"), player.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.account.userFaucetState.fetch(userFaucetStatePda);
      console.log("   ✅ User faucet state exists");
    } catch {
      console.log("   🔧 Initializing user faucet state...");
      try {
        const tx = await program.methods
          .initUserState()
          .accountsStrict({
            userFaucetState: userFaucetStatePda,
            user: player.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([player])
          .rpc();
        console.log(`   ✅ Initialized: ${tx.slice(0, 20)}...`);
      } catch (e: any) {
        console.log(`   ❌ Init failed: ${e.message.slice(0, 50)}...`);
        continue;
      }
    }

    // Claim each asset
    for (const asset of assetsToProcess) {
      const mint = tokenMints[asset.index];
      if (!mint) {
        console.log(`   ⚠️ ${asset.symbol}: Mint not found`);
        continue;
      }

      const registeredMint = faucetState.tokenMints[asset.index];
      if (!registeredMint || registeredMint.equals(PublicKey.default)) {
        console.log(`   ⚠️ ${asset.symbol}: Not registered with faucet`);
        continue;
      }

      try {
        // Get or create ATA
        const ata = await getAssociatedTokenAddress(mint, player.publicKey);
        
        // Check if ATA exists
        let ataExists = false;
        try {
          await getAccount(connection, ata);
          ataExists = true;
        } catch {
          // Create ATA
          const createAtaIx = createAssociatedTokenAccountInstruction(
            admin.publicKey, // payer
            ata,
            player.publicKey,
            mint,
          );
          const tx = new Transaction().add(createAtaIx);
          await provider.sendAndConfirm(tx, [admin]);
          console.log(`   📦 ${asset.symbol}: Created token account`);
        }

        // Get Pyth price update account
        const feedId = PYTH_FEED_IDS[asset.index];
        const priceUpdatePda = derivePriceUpdatePDA(feedId);
        
        // Check if price feed exists on-chain
        const priceAccountInfo = await connection.getAccountInfo(priceUpdatePda);
        if (!priceAccountInfo) {
          console.log(`   ⚠️ ${asset.symbol}: Pyth price feed not available on devnet`);
          continue;
        }

        // Claim tokens
        console.log(`   🔄 ${asset.symbol}: Claiming $15 worth...`);
        
        const claimTx = await program.methods
          .claim(asset.index)
          .accountsStrict({
            faucetState: faucetStatePda,
            userFaucetState: userFaucetStatePda,
            tokenMint: mint,
            userTokenAccount: ata,
            priceUpdate: priceUpdatePda,
            user: player.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([player])
          .rpc();

        // Get balance after claim
        const tokenAccount = await getAccount(connection, ata);
        const balance = Number(tokenAccount.amount) / Math.pow(10, asset.decimals);
        
        console.log(`   ✅ ${asset.symbol}: Claimed! Balance: ${balance.toFixed(2)} tokens | TX: ${claimTx.slice(0, 15)}...`);
        
        await sleep(1000); // Rate limiting
        
      } catch (error: any) {
        const errMsg = error.message || error.toString();
        if (errMsg.includes("Cooldown")) {
          console.log(`   ⏳ ${asset.symbol}: On cooldown (6h between claims)`);
        } else {
          console.log(`   ❌ ${asset.symbol}: ${errMsg.slice(0, 60)}...`);
        }
      }
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ CLAIM PROCESS COMPLETE!");
  console.log("=".repeat(80) + "\n");
}

main().catch(console.error);

