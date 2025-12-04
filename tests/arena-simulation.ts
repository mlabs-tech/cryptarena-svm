import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaSvm } from "../target/types/cryptarena_svm";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Connection,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Asset names for logging
const ASSET_NAMES = [
  "SOL", "TRUMP", "PUMP", "BONK", "JUP", "PENGU", "PYTH",
  "HNT", "FARTCOIN", "RAY", "JTO", "KMNO", "MET", "W"
];

// Load keypair from file
function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

// Sleep helper
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Format timestamp
const formatTime = (timestamp: number) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString();
};

// Format SOL amount
const formatSOL = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🏟️  CRYPTARENA - FULL ARENA SIMULATION TEST");
  console.log("=".repeat(80) + "\n");

  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.CryptarenaSvm as Program<CryptarenaSvm>;
  const admin = (provider.wallet as any).payer as Keypair;

  console.log("📋 Configuration:");
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   Admin: ${admin.publicKey.toString()}`);
  console.log(`   Cluster: ${connection.rpcEndpoint}`);
  console.log("");

  // Load player wallets
  const walletDir = path.join(__dirname, "../test-wallets");
  const players: Keypair[] = [];
  
  console.log("👥 Loading player wallets...");
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    const player = loadKeypair(walletPath);
    players.push(player);
    
    const balance = await connection.getBalance(player.publicKey);
    console.log(`   Player ${i}: ${player.publicKey.toString()} | Balance: ${formatSOL(balance)} SOL`);
  }
  console.log("");

  // Derive PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state")],
    program.programId
  );

  // Check if protocol is initialized
  let globalState;
  try {
    globalState = await program.account.globalState.fetch(globalStatePda);
    console.log("✅ Protocol already initialized");
    console.log(`   Current Arena ID: ${globalState.currentArenaId.toString()}`);
    console.log(`   Arena Duration: ${globalState.arenaDuration.toString()} seconds`);
    console.log(`   Is Paused: ${globalState.isPaused}`);
  } catch (e) {
    console.log("🔧 Initializing protocol...");
    const treasury = Keypair.generate();
    
    await program.methods
      .initialize(new anchor.BN(120)) // 2 minutes for testing
      .accounts({
        globalState: globalStatePda,
        treasury: treasury.publicKey,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    
    globalState = await program.account.globalState.fetch(globalStatePda);
    console.log("✅ Protocol initialized!");
    console.log(`   Arena Duration: ${globalState.arenaDuration.toString()} seconds`);
  }
  console.log("");

  // Get current arena ID
  const arenaId = globalState.currentArenaId;
  const [arenaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena"), arenaId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  console.log("=".repeat(80));
  console.log(`🎮 STARTING ARENA #${arenaId.toString()}`);
  console.log("=".repeat(80) + "\n");

  // Track prices for each asset
  const startPrices: { [key: number]: number } = {};
  const endPrices: { [key: number]: number } = {};
  const playerAssets: { [key: string]: number } = {};

  // Each player enters with a different asset
  // For this simulation, we'll use mock entries since we don't have actual tokens
  // In production, you'd need SPL tokens and Pyth price feeds
  
  console.log("📊 PLAYER ENTRIES (10 seconds between each):");
  console.log("-".repeat(80));

  for (let i = 0; i < 10; i++) {
    const player = players[i];
    const assetIndex = i; // Each player picks a different asset (0-9)
    const assetName = ASSET_NAMES[assetIndex];
    
    console.log(`\n⏳ [${new Date().toLocaleTimeString()}] Player ${i + 1} entering with ${assetName}...`);
    
    try {
      // Derive player entry PDA
      const [playerEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player_entry"), arenaPda.toBuffer(), player.publicKey.toBuffer()],
        program.programId
      );

      // For simulation, we'll track the intended entry
      playerAssets[player.publicKey.toString()] = assetIndex;
      
      // Mock price (in production this comes from Pyth)
      const mockPrice = 100 + Math.random() * 50; // Random price between 100-150
      startPrices[assetIndex] = mockPrice;
      
      console.log(`   ✅ Player ${i + 1} (${player.publicKey.toString().slice(0, 8)}...) entered!`);
      console.log(`      Asset: ${assetName}`);
      console.log(`      Entry Price: $${mockPrice.toFixed(2)}`);
      console.log(`      Players in arena: ${i + 1}/10`);
      
      if (i + 1 === 10) {
        console.log("\n" + "🚀".repeat(20));
        console.log("🏁 ARENA STARTED! 10th player entered!");
        console.log("🚀".repeat(20));
        
        const arenaStartTime = Math.floor(Date.now() / 1000);
        const arenaEndTime = arenaStartTime + Number(globalState.arenaDuration);
        
        console.log(`\n   Start Time: ${formatTime(arenaStartTime)}`);
        console.log(`   End Time: ${formatTime(arenaEndTime)}`);
        console.log(`   Duration: ${globalState.arenaDuration.toString()} seconds`);
      }
      
    } catch (error: any) {
      console.log(`   ❌ Entry failed: ${error.message}`);
    }

    // Wait 10 seconds between entries (except after the last one)
    if (i < 9) {
      console.log(`\n   ⏰ Waiting 10 seconds before next entry...`);
      await sleep(10000);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("⏱️  ARENA COUNTDOWN");
  console.log("=".repeat(80));

  const arenaDuration = Number(globalState.arenaDuration);
  const countdownStart = Date.now();
  let elapsed = 0;

  // Log every 30 seconds during countdown (for 2 min test)
  while (elapsed < arenaDuration * 1000) {
    const remaining = Math.ceil((arenaDuration * 1000 - elapsed) / 1000);
    console.log(`\n⏱️  [${new Date().toLocaleTimeString()}] Time remaining: ${remaining} seconds`);
    
    // Simulate price changes
    console.log("   📈 Current price movements:");
    for (let i = 0; i < 10; i++) {
      const assetName = ASSET_NAMES[i];
      const startPrice = startPrices[i] || 100;
      // Simulate random price movement (-10% to +15%)
      const change = (Math.random() * 0.25) - 0.10;
      const currentPrice = startPrice * (1 + change);
      const changePercent = ((currentPrice - startPrice) / startPrice * 100).toFixed(2);
      const arrow = parseFloat(changePercent) >= 0 ? "🟢" : "🔴";
      console.log(`      ${arrow} ${assetName}: $${currentPrice.toFixed(2)} (${changePercent}%)`);
      
      // Store as end price (will be overwritten until final)
      endPrices[i] = currentPrice;
    }
    
    await sleep(30000); // Wait 30 seconds
    elapsed = Date.now() - countdownStart;
  }

  console.log("\n" + "=".repeat(80));
  console.log("🏁 ARENA ENDED - DETERMINING WINNER");
  console.log("=".repeat(80));

  // Calculate final results
  console.log("\n📊 FINAL PRICE MOVEMENTS:");
  console.log("-".repeat(60));
  
  let bestMovement = -Infinity;
  let winningAsset = 0;
  const movements: { asset: string; movement: number; startPrice: number; endPrice: number }[] = [];

  for (let i = 0; i < 10; i++) {
    const assetName = ASSET_NAMES[i];
    const startPrice = startPrices[i] || 100;
    const endPrice = endPrices[i] || startPrice * (1 + (Math.random() * 0.2 - 0.05));
    const movement = ((endPrice - startPrice) / startPrice) * 100;
    
    movements.push({ asset: assetName, movement, startPrice, endPrice });
    
    if (movement > bestMovement) {
      bestMovement = movement;
      winningAsset = i;
    }
  }

  // Sort by movement descending
  movements.sort((a, b) => b.movement - a.movement);

  console.log("\n   Rank | Asset     | Start Price | End Price  | Change");
  console.log("   " + "-".repeat(56));
  movements.forEach((m, idx) => {
    const isWinner = m.asset === ASSET_NAMES[winningAsset];
    const prefix = isWinner ? "🏆" : "  ";
    const changeStr = m.movement >= 0 ? `+${m.movement.toFixed(2)}%` : `${m.movement.toFixed(2)}%`;
    console.log(`   ${prefix}${(idx + 1).toString().padStart(2)} | ${m.asset.padEnd(9)} | $${m.startPrice.toFixed(2).padStart(8)} | $${m.endPrice.toFixed(2).padStart(8)} | ${changeStr}`);
  });

  console.log("\n" + "=".repeat(80));
  console.log("🏆 WINNER ANNOUNCEMENT");
  console.log("=".repeat(80));

  const winningAssetName = ASSET_NAMES[winningAsset];
  const winningPlayer = players.find((p, idx) => idx === winningAsset);
  
  console.log(`\n   🎉 WINNING ASSET: ${winningAssetName}`);
  console.log(`   📈 Price Movement: +${bestMovement.toFixed(2)}%`);
  console.log(`   👤 Winner: Player ${winningAsset + 1} (${winningPlayer?.publicKey.toString().slice(0, 8)}...)`);
  
  // Calculate rewards (mock)
  const totalPool = 150; // $150 total (10 players * $15 avg entry)
  const treasuryFee = totalPool * 0.10; // 10%
  const winnerReward = totalPool - treasuryFee;
  
  console.log(`\n   💰 REWARD DISTRIBUTION:`);
  console.log(`      Total Pool: $${totalPool.toFixed(2)}`);
  console.log(`      Treasury Fee (10%): $${treasuryFee.toFixed(2)}`);
  console.log(`      Winner Reward (90%): $${winnerReward.toFixed(2)}`);

  console.log("\n" + "=".repeat(80));
  console.log("📊 FINAL STATISTICS");
  console.log("=".repeat(80));
  
  console.log(`\n   Arena ID: ${arenaId.toString()}`);
  console.log(`   Total Players: 10`);
  console.log(`   Arena Duration: ${arenaDuration} seconds`);
  console.log(`   Winning Asset: ${winningAssetName}`);
  console.log(`   Best Movement: +${bestMovement.toFixed(2)}%`);
  
  console.log("\n   📈 Asset Performance Summary:");
  const positive = movements.filter(m => m.movement > 0).length;
  const negative = movements.filter(m => m.movement < 0).length;
  const avgMovement = movements.reduce((sum, m) => sum + m.movement, 0) / movements.length;
  console.log(`      Positive: ${positive} assets`);
  console.log(`      Negative: ${negative} assets`);
  console.log(`      Avg Movement: ${avgMovement.toFixed(2)}%`);

  console.log("\n" + "=".repeat(80));
  console.log("✅ ARENA SIMULATION COMPLETE!");
  console.log("=".repeat(80) + "\n");
}

main().catch(console.error);

