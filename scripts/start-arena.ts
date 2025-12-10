/**
 * Start Arena
 * 
 * This script finds an arena with 10 players in Ready status
 * and sets start prices to activate it.
 * 
 * Usage: npx ts-node scripts/start-arena.ts
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
import https from "https";

// ============================================================================
// CONFIG - Uses devnet by default
// ============================================================================

const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET_PATH = process.env.ANCHOR_WALLET || path.join(require("os").homedir(), ".config/solana/id.json");

// ============================================================================
// HELPERS
// ============================================================================

function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ASSET_NAMES = ["SOL", "TRUMP", "PUMP", "BONK", "JUP", "PENGU", "PYTH", "HNT", "FARTCOIN", "RAY", "JTO", "KMNO", "MET", "W"];
const CMC_API_KEY = process.env.CMC_API_KEY || "";

const ARENA_STATUS: { [key: number]: string } = {
  0: "Uninitialized", 1: "Waiting", 2: "Ready", 3: "Active",
  4: "Ended", 5: "Suspended", 6: "Starting", 7: "Ending",
};

async function fetchPrices(symbols: string[]): Promise<{ [key: string]: number }> {
  return new Promise((resolve) => {
    const symbolList = symbols.join(",");
    const options = {
      hostname: "pro-api.coinmarketcap.com",
      path: `/v1/cryptocurrency/quotes/latest?symbol=${symbolList}`,
      method: "GET",
      headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY, "Accept": "application/json" },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const prices: { [key: string]: number } = {};
          for (const symbol of symbols) {
            if (json.data?.[symbol]?.quote?.USD?.price) {
              prices[symbol] = json.data[symbol].quote.USD.price;
            }
          }
          resolve(prices);
        } catch { resolve({}); }
      });
    });
    req.on("error", () => resolve({}));
    req.end();
  });
}

function priceToOnchain(price: number): anchor.BN {
  return new anchor.BN(Math.floor(price * 1e8));
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🚀 START ARENA");
  console.log("═".repeat(80) + "\n");

  // Setup connection and wallet
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair(WALLET_PATH);
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = anchor.workspace.CryptarenaSvmTest as Program<CryptarenaSvmTest>;

  console.log(`📋 Program ID: ${program.programId.toString()}`);
  console.log(`👤 Admin: ${admin.publicKey.toString()}`);
  console.log(`🌐 Cluster: ${connection.rpcEndpoint}\n`);

  // PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state_v2")],
    program.programId
  );

  const globalState = await program.account.globalState.fetch(globalStatePda);
  
  // Find Ready (status = 2) or Starting (status = 6) arena with 10 players
  let targetArenaId: anchor.BN | null = null;
  let targetArenaPda: PublicKey | null = null;
  let targetArena: any = null;

  console.log("🔍 Searching for arena ready to start (Ready or Starting status)...\n");

  for (let id = globalState.currentArenaId.toNumber(); id >= 0; id--) {
    const tryArenaId = new anchor.BN(id);
    const [tryArenaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_v2"), tryArenaId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    
    try {
      const arena = await program.account.arena.fetch(tryArenaPda);
      // Ready (2) or Starting (6) status with 10 players
      if (arena.status === 2 || arena.status === 6) {
        targetArenaId = tryArenaId;
        targetArenaPda = tryArenaPda;
        targetArena = arena;
        break;
      }
    } catch {}
  }

  if (!targetArenaId || !targetArenaPda || !targetArena) {
    console.log("⚠️  No arena ready to start found (needs Ready or Starting status).\n");
    
    // Show current arenas for debugging
    console.log("📊 Current arenas:");
    for (let id = globalState.currentArenaId.toNumber(); id >= Math.max(0, globalState.currentArenaId.toNumber() - 5); id--) {
      const tryArenaId = new anchor.BN(id);
      const [tryArenaPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("arena_v2"), tryArenaId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      try {
        const arena = await program.account.arena.fetch(tryArenaPda);
        console.log(`   Arena ${id}: ${ARENA_STATUS[arena.status]} (${arena.playerCount}/10 players)`);
      } catch {}
    }
    return;
  }

  console.log(`📍 Found Ready arena: ID ${targetArenaId.toString()}`);
  console.log(`   Status: ${ARENA_STATUS[targetArena.status]}`);
  console.log(`   Players: ${targetArena.playerCount}/10`);
  console.log(`   Duration: ${targetArena.duration} seconds`);

  // Get assets in arena
  const arenaAssetPdas: { [key: number]: PublicKey } = {};
  const assetsInArena: number[] = [];

  console.log("\n📊 Assets in arena:");
  for (let i = 0; i < 14; i++) {
    const [assetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_asset_v2"), targetArenaPda.toBuffer(), Buffer.from([i])],
      program.programId
    );
    
    try {
      const asset = await program.account.arenaAsset.fetch(assetPda);
      if (asset.playerCount > 0) {
        assetsInArena.push(i);
        arenaAssetPdas[i] = assetPda;
        console.log(`   - ${ASSET_NAMES[i]}: ${asset.playerCount} player(s)`);
      }
    } catch {}
  }

  // Set start prices
  console.log("\n" + "═".repeat(80));
  console.log("📈 SETTING START PRICES");
  console.log("═".repeat(80) + "\n");

  const startPrices = await fetchPrices(ASSET_NAMES);

  for (const assetIndex of assetsInArena) {
    const assetName = ASSET_NAMES[assetIndex];
    const price = startPrices[assetName] || 1;
    const onchainPrice = priceToOnchain(price);
    
    try {
      await program.methods
        .setStartPrice(onchainPrice)
        .accountsStrict({
          globalState: globalStatePda,
          arena: targetArenaPda,
          arenaAsset: arenaAssetPdas[assetIndex],
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
      
      console.log(`   ✅ ${assetName.padEnd(10)}: $${price.toFixed(6)}`);
    } catch (error: any) {
      console.log(`   ⚠️ ${assetName}: ${error.message?.slice(0, 50)}`);
    }
    await sleep(500);
  }

  // Verify arena is now Active
  targetArena = await program.account.arena.fetch(targetArenaPda);

  console.log("\n" + "═".repeat(80));
  console.log("📊 ARENA STATUS");
  console.log("═".repeat(80));
  
  console.log(`\n   Arena ID: ${targetArenaId.toString()}`);
  console.log(`   Status: ${ARENA_STATUS[targetArena.status]}`);
  
  if (targetArena.status === 3) {
    const startTime = new Date(targetArena.startTimestamp.toNumber() * 1000);
    const endTime = new Date(targetArena.endTimestamp.toNumber() * 1000);
    
    console.log(`   Start Time: ${startTime.toLocaleString()}`);
    console.log(`   End Time: ${endTime.toLocaleString()}`);
    console.log(`   Duration: ${targetArena.duration} seconds`);
    
    console.log("\n" + "🎮".repeat(30));
    console.log("🏁 ARENA STARTED SUCCESSFULLY!");
    console.log("🎮".repeat(30) + "\n");
  } else {
    console.log(`\n⚠️  Arena did not transition to Active. Current status: ${ARENA_STATUS[targetArena.status]}`);
  }
}

main().catch(console.error);

