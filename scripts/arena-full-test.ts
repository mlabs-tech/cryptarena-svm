import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaSvm } from "../target/types/cryptarena_svm";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import https from "https";

// CoinMarketCap API
const CMC_API_KEY = "ef3cc5e80cc848ceba20b3c7cba60d5d";

// Asset configuration
const ASSETS = [
  { index: 0, symbol: "tSOL", cmcSymbol: "SOL", decimals: 9 },
  { index: 1, symbol: "tTRUMP", cmcSymbol: "TRUMP", decimals: 9 },
  { index: 2, symbol: "tPUMP", cmcSymbol: "PUMP", decimals: 9 },
  { index: 3, symbol: "tBONK", cmcSymbol: "BONK", decimals: 9 },
  { index: 4, symbol: "tJUP", cmcSymbol: "JUP", decimals: 9 },
  { index: 5, symbol: "tPENGU", cmcSymbol: "PENGU", decimals: 9 },
  { index: 6, symbol: "tPYTH", cmcSymbol: "PYTH", decimals: 9 },
  { index: 7, symbol: "tHNT", cmcSymbol: "HNT", decimals: 9 },
  { index: 8, symbol: "tFARTCOIN", cmcSymbol: "FARTCOIN", decimals: 9 },
  { index: 9, symbol: "tRAY", cmcSymbol: "RAY", decimals: 9 },
];

const USD_ENTRY = 15; // $15 entry

function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

const formatSOL = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const formatTime = () => new Date().toLocaleTimeString();

// Fetch prices from CoinMarketCap
async function fetchPrices(symbols: string[]): Promise<{ [key: string]: number }> {
  return new Promise((resolve) => {
    const symbolList = symbols.join(",");
    const options = {
      hostname: "pro-api.coinmarketcap.com",
      path: `/v1/cryptocurrency/quotes/latest?symbol=${symbolList}`,
      method: "GET",
      headers: {
        "X-CMC_PRO_API_KEY": CMC_API_KEY,
        "Accept": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const prices: { [key: string]: number } = {};
          for (const symbol of symbols) {
            const tokenData = json.data?.[symbol];
            if (tokenData?.quote?.USD?.price) {
              prices[symbol] = tokenData.quote.USD.price;
            }
          }
          resolve(prices);
        } catch {
          resolve({});
        }
      });
    });
    req.on("error", () => resolve({}));
    req.end();
  });
}

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🏟️  CRYPTARENA - FULL ARENA SIMULATION TEST");
  console.log("═".repeat(80));
  console.log(`   Started at: ${new Date().toLocaleString()}`);
  console.log("═".repeat(80) + "\n");

  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.CryptarenaSvm as Program<CryptarenaSvm>;
  const admin = (provider.wallet as any).payer as Keypair;

  console.log("📋 CONFIGURATION");
  console.log("─".repeat(80));
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   Admin: ${admin.publicKey.toString()}`);
  console.log(`   Cluster: ${connection.rpcEndpoint}`);
  console.log("");

  // Load player wallets
  const walletDir = path.join(__dirname, "../test-wallets");
  const players: Keypair[] = [];
  
  console.log("👥 LOADING PLAYER WALLETS");
  console.log("─".repeat(80));
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    if (fs.existsSync(walletPath)) {
      const player = loadKeypair(walletPath);
      players.push(player);
      const balance = await connection.getBalance(player.publicKey);
      console.log(`   Player ${i.toString().padStart(2)}: ${player.publicKey.toString().slice(0, 24)}... | ${formatSOL(balance)} SOL`);
    }
  }
  console.log("");

  // Load token mints
  const mintsFilePath = path.join(walletDir, "token-mints.json");
  const tokenMints: { [key: number]: PublicKey } = {};
  
  if (fs.existsSync(mintsFilePath)) {
    const existingMints = JSON.parse(fs.readFileSync(mintsFilePath, "utf-8"));
    for (const [key, value] of Object.entries(existingMints)) {
      tokenMints[parseInt(key)] = new PublicKey(value as string);
    }
    console.log(`📜 Loaded ${Object.keys(tokenMints).length} token mints\n`);
  }

  // Fetch START PRICES
  console.log("═".repeat(80));
  console.log("📊 FETCHING START PRICES FROM COINMARKETCAP");
  console.log("═".repeat(80));
  
  const cmcSymbols = ASSETS.map(a => a.cmcSymbol);
  const startPrices = await fetchPrices(cmcSymbols);
  const startTime = Date.now();

  console.log("\n   Token       | Start Price     | $15 Entry Amount");
  console.log("   " + "─".repeat(55));
  
  const playerEntries: { player: Keypair; asset: typeof ASSETS[0]; price: number; amount: number }[] = [];
  
  for (let i = 0; i < 10; i++) {
    const asset = ASSETS[i];
    const price = startPrices[asset.cmcSymbol] || 1;
    const amount = USD_ENTRY / price;
    playerEntries.push({ player: players[i], asset, price, amount });
    
    const priceStr = price < 1 ? price.toFixed(6) : price.toFixed(4);
    console.log(`   ${asset.symbol.padEnd(11)} | $${priceStr.padStart(12)} | ${amount.toFixed(4)} tokens`);
  }
  console.log("");

  // SIMULATE ARENA ENTRIES
  console.log("═".repeat(80));
  console.log("🎮 ARENA ENTRIES (10 seconds between each)");
  console.log("═".repeat(80) + "\n");

  const arenaState = {
    players: [] as { address: string; asset: string; price: number; amount: number }[],
    totalPool: 0,
    status: "Waiting",
    startTimestamp: 0,
    endTimestamp: 0,
  };

  for (let i = 0; i < 10; i++) {
    const entry = playerEntries[i];
    const playerNum = i + 1;
    
    console.log(`⏳ [${formatTime()}] Player ${playerNum} entering with ${entry.asset.symbol}...`);
    
    // Simulate entry
    arenaState.players.push({
      address: entry.player.publicKey.toString().slice(0, 12) + "...",
      asset: entry.asset.symbol,
      price: entry.price,
      amount: entry.amount,
    });
    arenaState.totalPool += USD_ENTRY;

    console.log(`   ✅ Player ${playerNum} entered!`);
    console.log(`      Asset: ${entry.asset.symbol} (${entry.asset.cmcSymbol})`);
    console.log(`      Entry Price: $${entry.price.toFixed(6)}`);
    console.log(`      Token Amount: ${entry.amount.toFixed(4)}`);
    console.log(`      USD Value: $${USD_ENTRY}`);
    console.log(`      Players in arena: ${arenaState.players.length}/10`);
    console.log(`      Total Pool: $${arenaState.totalPool}`);

    if (playerNum === 10) {
      arenaState.status = "Active";
      arenaState.startTimestamp = Math.floor(Date.now() / 1000);
      arenaState.endTimestamp = arenaState.startTimestamp + 120; // 2 minute arena
      
      console.log("\n" + "🚀".repeat(30));
      console.log("🏁 ARENA STARTED! 10th player entered!");
      console.log("🚀".repeat(30));
      console.log(`\n   Arena Status: ACTIVE`);
      console.log(`   Start Time: ${new Date(arenaState.startTimestamp * 1000).toLocaleTimeString()}`);
      console.log(`   End Time: ${new Date(arenaState.endTimestamp * 1000).toLocaleTimeString()}`);
      console.log(`   Duration: 120 seconds (2 minutes)`);
      console.log(`   Total Pool: $${arenaState.totalPool}`);
    } else {
      console.log(`\n   ⏰ Waiting 10 seconds before next entry...\n`);
      await sleep(10000);
    }
  }

  // COUNTDOWN
  console.log("\n" + "═".repeat(80));
  console.log("⏱️  ARENA COUNTDOWN (Updates every 30 seconds)");
  console.log("═".repeat(80));

  const arenaDuration = 120; // 2 minutes
  let elapsed = 0;

  while (elapsed < arenaDuration * 1000) {
    const remaining = Math.ceil((arenaDuration * 1000 - elapsed) / 1000);
    console.log(`\n⏱️  [${formatTime()}] Time remaining: ${remaining} seconds`);
    
    // Fetch current prices for progress update
    const currentPrices = await fetchPrices(cmcSymbols);
    
    console.log("\n   Token       | Start Price     | Current Price   | Change");
    console.log("   " + "─".repeat(65));
    
    for (let i = 0; i < 10; i++) {
      const asset = ASSETS[i];
      const startPrice = startPrices[asset.cmcSymbol] || 1;
      const currentPrice = currentPrices[asset.cmcSymbol] || startPrice;
      const change = ((currentPrice - startPrice) / startPrice) * 100;
      const arrow = change >= 0 ? "🟢" : "🔴";
      const changeStr = change >= 0 ? `+${change.toFixed(4)}%` : `${change.toFixed(4)}%`;
      
      console.log(`   ${arrow} ${asset.symbol.padEnd(9)} | $${startPrice.toFixed(6).padStart(12)} | $${currentPrice.toFixed(6).padStart(12)} | ${changeStr}`);
    }
    
    await sleep(30000); // Wait 30 seconds
    elapsed = Date.now() - (arenaState.startTimestamp * 1000);
  }

  // ARENA END - Fetch final prices
  console.log("\n" + "═".repeat(80));
  console.log("🏁 ARENA ENDED - FETCHING FINAL PRICES");
  console.log("═".repeat(80));

  const endPrices = await fetchPrices(cmcSymbols);
  const endTime = Date.now();
  const actualDuration = (endTime - startTime) / 1000;

  console.log(`\n   Arena Duration: ${actualDuration.toFixed(0)} seconds`);
  console.log(`   Pool Size: $${arenaState.totalPool}\n`);

  // Calculate movements
  console.log("═".repeat(80));
  console.log("📊 FINAL PRICE MOVEMENTS");
  console.log("═".repeat(80));

  const movements: { asset: string; symbol: string; startPrice: number; endPrice: number; movement: number; player: string }[] = [];

  console.log("\n   Rank | Asset      | Start Price     | End Price       | Movement     | Player");
  console.log("   " + "─".repeat(85));

  for (let i = 0; i < 10; i++) {
    const asset = ASSETS[i];
    const startPrice = startPrices[asset.cmcSymbol] || 1;
    const endPrice = endPrices[asset.cmcSymbol] || startPrice;
    const movement = ((endPrice - startPrice) / startPrice) * 100;
    
    movements.push({
      asset: asset.symbol,
      symbol: asset.cmcSymbol,
      startPrice,
      endPrice,
      movement,
      player: `Player ${i + 1}`,
    });
  }

  // Sort by movement (highest = winner)
  movements.sort((a, b) => b.movement - a.movement);

  movements.forEach((m, idx) => {
    const isWinner = idx === 0;
    const prefix = isWinner ? "🏆" : "  ";
    const changeStr = m.movement >= 0 ? `+${m.movement.toFixed(4)}%` : `${m.movement.toFixed(4)}%`;
    console.log(`   ${prefix}${(idx + 1).toString().padStart(2)} | ${m.asset.padEnd(10)} | $${m.startPrice.toFixed(6).padStart(12)} | $${m.endPrice.toFixed(6).padStart(12)} | ${changeStr.padStart(12)} | ${m.player}`);
  });

  // WINNER ANNOUNCEMENT
  console.log("\n" + "═".repeat(80));
  console.log("🏆 WINNER ANNOUNCEMENT");
  console.log("═".repeat(80));

  const winner = movements[0];
  const treasuryFee = arenaState.totalPool * 0.10; // 10%
  const winnerReward = arenaState.totalPool - treasuryFee;

  console.log(`\n   🎉 WINNING ASSET: ${winner.asset} (${winner.symbol})`);
  console.log(`   📈 Price Movement: ${winner.movement >= 0 ? '+' : ''}${winner.movement.toFixed(4)}%`);
  console.log(`   👤 Winner: ${winner.player}`);
  console.log(`\n   💰 REWARD DISTRIBUTION:`);
  console.log(`      Total Pool:        $${arenaState.totalPool.toFixed(2)}`);
  console.log(`      Treasury Fee (10%): $${treasuryFee.toFixed(2)}`);
  console.log(`      Winner Reward (90%): $${winnerReward.toFixed(2)}`);

  // VOLATILITY ANALYSIS
  console.log("\n" + "═".repeat(80));
  console.log("📈 VOLATILITY ANALYSIS");
  console.log("═".repeat(80));

  const positiveMovers = movements.filter(m => m.movement > 0);
  const negativeMovers = movements.filter(m => m.movement < 0);
  const avgMovement = movements.reduce((sum, m) => sum + m.movement, 0) / movements.length;
  const maxVolatility = Math.max(...movements.map(m => Math.abs(m.movement)));
  const minVolatility = Math.min(...movements.map(m => Math.abs(m.movement)));

  console.log(`\n   Assets with positive movement: ${positiveMovers.length}`);
  console.log(`   Assets with negative movement: ${negativeMovers.length}`);
  console.log(`   Average movement: ${avgMovement >= 0 ? '+' : ''}${avgMovement.toFixed(4)}%`);
  console.log(`   Max volatility: ${maxVolatility.toFixed(4)}%`);
  console.log(`   Min volatility: ${minVolatility.toFixed(4)}%`);

  // TOP PERFORMERS
  console.log("\n   🏅 Top 3 Performers:");
  movements.slice(0, 3).forEach((m, idx) => {
    console.log(`      ${idx + 1}. ${m.asset} (${m.symbol}): ${m.movement >= 0 ? '+' : ''}${m.movement.toFixed(4)}%`);
  });

  console.log("\n   📉 Bottom 3 Performers:");
  movements.slice(-3).reverse().forEach((m, idx) => {
    console.log(`      ${idx + 1}. ${m.asset} (${m.symbol}): ${m.movement >= 0 ? '+' : ''}${m.movement.toFixed(4)}%`);
  });

  // VAULT BALANCES (Simulated)
  console.log("\n" + "═".repeat(80));
  console.log("💼 VAULT BALANCES (Simulated)");
  console.log("═".repeat(80));

  console.log("\n   Player    | Entry Asset | Entry Value | Won?   | Vault Balance");
  console.log("   " + "─".repeat(65));

  for (let i = 0; i < 10; i++) {
    const playerEntry = playerEntries[i];
    const isWinner = movements[0].asset === playerEntry.asset.symbol;
    const vaultBalance = isWinner ? winnerReward : 0;
    const wonStr = isWinner ? "✅ YES" : "❌ NO";
    
    console.log(`   Player ${(i + 1).toString().padStart(2)} | ${playerEntry.asset.symbol.padEnd(11)} | $${USD_ENTRY.toFixed(2).padStart(9)} | ${wonStr} | $${vaultBalance.toFixed(2)}`);
  }

  // FINAL SUMMARY
  console.log("\n" + "═".repeat(80));
  console.log("📊 FINAL SUMMARY");
  console.log("═".repeat(80));

  console.log(`
   🏟️  Arena Statistics:
      - Total Players: 10
      - Total Pool: $${arenaState.totalPool}
      - Arena Duration: ${actualDuration.toFixed(0)} seconds
      - Entry Fee: $${USD_ENTRY} per player
   
   🏆 Winner:
      - Asset: ${winner.asset} (${winner.symbol})
      - Movement: ${winner.movement >= 0 ? '+' : ''}${winner.movement.toFixed(4)}%
      - Player: ${winner.player}
      - Reward: $${winnerReward.toFixed(2)}
   
   💰 Treasury:
      - Fee Collected: $${treasuryFee.toFixed(2)}
`);

  console.log("═".repeat(80));
  console.log("✅ ARENA SIMULATION COMPLETE!");
  console.log("═".repeat(80) + "\n");
}

main().catch(console.error);

