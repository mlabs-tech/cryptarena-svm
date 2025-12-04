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
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import https from "https";

// CoinMarketCap API configuration
const CMC_API_KEY = "ef3cc5e80cc848ceba20b3c7cba60d5d";
const CMC_API_URL = "pro-api.coinmarketcap.com";

// Asset configuration with CoinMarketCap symbols
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
  { index: 10, symbol: "tJTO", cmcSymbol: "JTO", decimals: 9 },
  { index: 11, symbol: "tKMNO", cmcSymbol: "KMNO", decimals: 9 },
  { index: 12, symbol: "tMET", cmcSymbol: "MET", decimals: 9 },
  { index: 13, symbol: "tW", cmcSymbol: "W", decimals: 9 },
];

const USD_VALUE = 500; // $500 worth of tokens

function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

const formatSOL = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch prices from CoinMarketCap
async function fetchPrices(symbols: string[]): Promise<{ [key: string]: number }> {
  return new Promise((resolve, reject) => {
    const symbolList = symbols.join(",");
    const options = {
      hostname: CMC_API_URL,
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
          if (json.status?.error_code !== 0) {
            console.log("CMC API Error:", json.status?.error_message);
            resolve({});
            return;
          }
          
          const prices: { [key: string]: number } = {};
          for (const symbol of symbols) {
            const tokenData = json.data?.[symbol];
            if (tokenData?.quote?.USD?.price) {
              prices[symbol] = tokenData.quote.USD.price;
            }
          }
          resolve(prices);
        } catch (e) {
          console.log("Parse error:", e);
          resolve({});
        }
      });
    });

    req.on("error", (e) => {
      console.log("Request error:", e);
      resolve({});
    });

    req.end();
  });
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("💰 CRYPTARENA - MINT TEST TOKENS (CoinMarketCap Live Prices)");
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

  // Fetch prices from CoinMarketCap
  console.log("=".repeat(80));
  console.log("📊 FETCHING LIVE PRICES FROM COINMARKETCAP");
  console.log("=".repeat(80));

  const cmcSymbols = ASSETS.map(a => a.cmcSymbol);
  console.log(`\n   Fetching: ${cmcSymbols.join(", ")}...\n`);
  
  const prices = await fetchPrices(cmcSymbols);
  
  if (Object.keys(prices).length === 0) {
    console.log("❌ Failed to fetch prices. Using fallback prices...\n");
  }

  // Display prices and calculate token amounts
  console.log("   Token        | Price (USD)    | Tokens for $500");
  console.log("   " + "-".repeat(55));
  
  const tokenAmounts: { [key: number]: { price: number; amount: number } } = {};
  
  // Fallback prices if CMC fails
  const fallbackPrices: { [key: string]: number } = {
    "SOL": 200, "TRUMP": 12, "PUMP": 0.015, "BONK": 0.00003,
    "JUP": 1.0, "PENGU": 0.025, "PYTH": 0.35, "HNT": 5.5,
    "FARTCOIN": 1.2, "RAY": 4.5, "JTO": 3.0, "KMNO": 0.12,
    "MET": 0.04, "W": 0.25
  };

  for (const asset of ASSETS) {
    const price = prices[asset.cmcSymbol] || fallbackPrices[asset.cmcSymbol] || 1;
    const amount = USD_VALUE / price;
    tokenAmounts[asset.index] = { price, amount };
    
    const priceStr = price < 0.01 ? price.toExponential(2) : price.toFixed(4);
    const amountStr = amount < 1 ? amount.toFixed(6) : amount.toFixed(2);
    const source = prices[asset.cmcSymbol] ? "✓" : "~";
    console.log(`   ${source} ${asset.symbol.padEnd(11)} | $${priceStr.padStart(12)} | ${amountStr.padStart(12)}`);
  }
  console.log("");

  // Load or create token mints
  const walletDir = path.join(__dirname, "../test-wallets");
  const mintsFilePath = path.join(walletDir, "token-mints-admin.json");

  if (!fs.existsSync(walletDir)) {
    fs.mkdirSync(walletDir, { recursive: true });
  }

  let tokenMints: { [key: number]: PublicKey } = {};

  console.log("=".repeat(80));
  console.log("🔧 LOADING/CREATING TOKEN MINTS");
  console.log("=".repeat(80));

  if (fs.existsSync(mintsFilePath)) {
    console.log("\n📂 Loading existing token mints...");
    const existingMints = JSON.parse(fs.readFileSync(mintsFilePath, "utf-8"));
    for (const [key, value] of Object.entries(existingMints)) {
      tokenMints[parseInt(key)] = new PublicKey(value as string);
      console.log(`   ✅ ${ASSETS[parseInt(key)].symbol}: ${(value as string).slice(0, 32)}...`);
    }
  } else {
    console.log("\n🔧 Creating new token mints...");
    
    for (const asset of ASSETS) {
      try {
        const mint = await createMint(
          connection,
          admin,
          admin.publicKey,
          null,
          asset.decimals,
        );
        
        tokenMints[asset.index] = mint;
        console.log(`   ✅ ${asset.symbol}: ${mint.toString()}`);
        await sleep(500);
      } catch (error: any) {
        console.log(`   ❌ ${asset.symbol}: ${error.message.slice(0, 40)}...`);
      }
    }

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

  // Mint tokens to each player
  console.log("=".repeat(80));
  console.log("💰 MINTING $500 WORTH OF EACH TOKEN TO ALL PLAYERS");
  console.log("=".repeat(80));

  for (let playerIdx = 0; playerIdx < players.length; playerIdx++) {
    const player = players[playerIdx];
    console.log(`\n👤 Player ${playerIdx + 1}: ${player.publicKey.toString().slice(0, 24)}...`);
    
    for (const asset of ASSETS) {
      const mint = tokenMints[asset.index];
      if (!mint) continue;

      const { price, amount } = tokenAmounts[asset.index];
      
      try {
        const rawAmount = BigInt(Math.floor(amount * Math.pow(10, asset.decimals)));

        const ata = await getOrCreateAssociatedTokenAccount(
          connection,
          admin,
          mint,
          player.publicKey,
        );

        const currentBalance = Number(ata.amount);
        const neededBalance = Number(rawAmount);

        if (currentBalance >= neededBalance * 0.9) { // 90% threshold
          const humanBalance = (currentBalance / Math.pow(10, asset.decimals)).toFixed(4);
          console.log(`   ✅ ${asset.symbol.padEnd(12)}: ${humanBalance} (funded)`);
        } else {
          await mintTo(
            connection,
            admin,
            mint,
            ata.address,
            admin,
            rawAmount,
          );
          
          console.log(`   💰 ${asset.symbol.padEnd(12)}: ${amount.toFixed(4)} tokens @ $${price.toFixed(4)}`);
        }
        
        await sleep(300);
      } catch (error: any) {
        console.log(`   ❌ ${asset.symbol.padEnd(12)}: ${error.message.slice(0, 40)}...`);
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 FINAL SUMMARY");
  console.log("=".repeat(80));
  
  console.log("\n📜 Token Mints Created:");
  for (const asset of ASSETS) {
    const mint = tokenMints[asset.index];
    const { price, amount } = tokenAmounts[asset.index];
    if (mint) {
      console.log(`   ${asset.symbol.padEnd(12)} $${price.toFixed(6).padStart(10)} | ${amount.toFixed(4).padStart(12)} tokens | ${mint.toString()}`);
    }
  }

  console.log("\n👥 All 10 Players funded with $500 worth of each token:");
  for (let i = 0; i < players.length; i++) {
    console.log(`   Player ${(i + 1).toString().padEnd(2)}: ${players[i].publicKey.toString()}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ MINTING COMPLETE! Ready for arena testing.");
  console.log("=".repeat(80) + "\n");
}

main().catch(console.error);

