import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import os from "os";

// Token mints from token-mints.json
const TOKEN_INFO: { [key: number]: { symbol: string; decimals: number } } = {
  0: { symbol: "tSOL", decimals: 9 },
  1: { symbol: "tTRUMP", decimals: 9 },
  2: { symbol: "tPUMP", decimals: 9 },
  3: { symbol: "tBONK", decimals: 9 },
  4: { symbol: "tJUP", decimals: 9 },
  5: { symbol: "tPENGU", decimals: 9 },
  6: { symbol: "tPYTH", decimals: 9 },
  7: { symbol: "tHNT", decimals: 9 },
  8: { symbol: "tFARTCOIN", decimals: 9 },
  9: { symbol: "tRAY", decimals: 9 },
  10: { symbol: "tJTO", decimals: 9 },
  11: { symbol: "tKMNO", decimals: 9 },
  12: { symbol: "tMET", decimals: 9 },
  13: { symbol: "tW", decimals: 9 },
};

function printUsage() {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                    CRYPTARENA - AIRDROP TEST TOKENS                        ║
╠════════════════════════════════════════════════════════════════════════════╣
║                                                                            ║
║  Usage:                                                                    ║
║    npx ts-node scripts/airdrop-token.ts --to=<ADDRESS> --token=<INDEX>     ║
║                                          --amount=<TOKENS>                 ║
║                                                                            ║
║  Options:                                                                  ║
║    --to      Recipient wallet address (required)                           ║
║    --token   Token index 0-13 (required)                                   ║
║    --amount  Number of tokens (default: 1000)                              ║
║    --all     Airdrop all tokens (ignores --token)                          ║
║                                                                            ║
║  Token Indices:                                                            ║
║    0=tSOL, 1=tTRUMP, 2=tPUMP, 3=tBONK, 4=tJUP, 5=tPENGU, 6=tPYTH,          ║
║    7=tHNT, 8=tFARTCOIN, 9=tRAY, 10=tJTO, 11=tKMNO, 12=tMET, 13=tW          ║
║                                                                            ║
║  Examples:                                                                 ║
║    npx ts-node scripts/airdrop-token.ts --to=ABC...XYZ --token=0           ║
║    npx ts-node scripts/airdrop-token.ts --to=ABC...XYZ --token=3 \\         ║
║                                         --amount=1000000                   ║
║    npx ts-node scripts/airdrop-token.ts --to=ABC...XYZ --all --amount=100  ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
  `);
}

async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const toArg = args.find(a => a.startsWith("--to="));
  const tokenArg = args.find(a => a.startsWith("--token="));
  const amountArg = args.find(a => a.startsWith("--amount="));
  const allFlag = args.includes("--all");

  if (!toArg) {
    printUsage();
    console.log("❌ Error: --to=<ADDRESS> is required\n");
    return;
  }

  const recipientAddress = toArg.split("=")[1];
  const tokenIndex = tokenArg ? parseInt(tokenArg.split("=")[1]) : null;
  const amount = amountArg ? parseFloat(amountArg.split("=")[1]) : 1000;

  if (!allFlag && tokenIndex === null) {
    printUsage();
    console.log("❌ Error: --token=<INDEX> or --all is required\n");
    return;
  }

  // Validate recipient address
  let recipient: PublicKey;
  try {
    recipient = new PublicKey(recipientAddress);
  } catch {
    console.log(`❌ Error: Invalid recipient address: ${recipientAddress}\n`);
    return;
  }

  console.log("\n" + "=".repeat(70));
  console.log("💰 CRYPTARENA - AIRDROP TEST TOKENS");
  console.log("=".repeat(70) + "\n");

  // Connect to devnet
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  // Load admin wallet from default Solana keypair location
  const adminKeyPath = process.env.ANCHOR_WALLET || 
    path.join(os.homedir(), ".config", "solana", "id.json");
  
  if (!fs.existsSync(adminKeyPath)) {
    console.log(`❌ Admin wallet not found at: ${adminKeyPath}`);
    return;
  }
  
  const adminSecretKey = JSON.parse(fs.readFileSync(adminKeyPath, "utf-8"));
  const admin = Keypair.fromSecretKey(Uint8Array.from(adminSecretKey));

  console.log(`📋 Configuration:`);
  console.log(`   Admin: ${admin.publicKey.toString()}`);
  console.log(`   Recipient: ${recipient.toString()}`);
  console.log(`   Cluster: ${connection.rpcEndpoint}`);
  console.log(`   Amount per token: ${amount.toLocaleString()}\n`);

  // Load token mints
  const walletDir = path.join(__dirname, "../test-wallets");
  const mintsFilePath = path.join(walletDir, "token-mints.json");

  if (!fs.existsSync(mintsFilePath)) {
    console.log("❌ Token mints not found at:", mintsFilePath);
    return;
  }

  const tokenMints: { [key: number]: PublicKey } = {};
  const existingMints = JSON.parse(fs.readFileSync(mintsFilePath, "utf-8"));
  for (const [key, value] of Object.entries(existingMints)) {
    tokenMints[parseInt(key)] = new PublicKey(value as string);
  }

  // Determine which tokens to airdrop
  const tokensToAirdrop = allFlag 
    ? Object.keys(TOKEN_INFO).map(k => parseInt(k))
    : [tokenIndex!];

  console.log("─".repeat(70));
  console.log("🚀 AIRDROPPING TOKENS");
  console.log("─".repeat(70) + "\n");

  for (const idx of tokensToAirdrop) {
    const info = TOKEN_INFO[idx];
    const mint = tokenMints[idx];

    if (!info || !mint) {
      console.log(`   ⚠️  Token index ${idx}: Not found`);
      continue;
    }

    try {
      // Get or create ATA
      const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        admin,
        mint,
        recipient
      );

      // Calculate amount with decimals
      const amountWithDecimals = BigInt(Math.floor(amount * Math.pow(10, info.decimals)));

      // Mint tokens
      await mintTo(
        connection,
        admin,
        mint,
        ata.address,
        admin, // admin is mint authority
        amountWithDecimals
      );

      // Get new balance
      const accountInfo = await getAccount(connection, ata.address);
      const balance = Number(accountInfo.amount) / Math.pow(10, info.decimals);

      console.log(`   ✅ ${info.symbol.padEnd(10)} | Minted: ${amount.toLocaleString().padStart(15)} | Balance: ${balance.toLocaleString()}`);

    } catch (error: any) {
      console.log(`   ❌ ${info.symbol.padEnd(10)} | Error: ${error.message.slice(0, 50)}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("✅ AIRDROP COMPLETE!");
  console.log("=".repeat(70) + "\n");
}

main().catch(console.error);

