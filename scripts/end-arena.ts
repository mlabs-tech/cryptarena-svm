/**
 * End Arena
 * 
 * This script finds an Active arena, sets end prices,
 * and finalizes it to determine the winner.
 * 
 * Usage: npx ts-node scripts/end-arena.ts
 *        npx ts-node scripts/end-arena.ts --wait  (to wait for duration to complete)
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
const CMC_API_KEY = "ef3cc5e80cc848ceba20b3c7cba60d5d";

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
  console.log("🏁 END ARENA");
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
  
  // Find Active arena (status = 3)
  let targetArenaId: anchor.BN | null = null;
  let targetArenaPda: PublicKey | null = null;
  let targetArena: any = null;

  console.log("🔍 Searching for Active arena...\n");

  for (let id = globalState.currentArenaId.toNumber(); id >= 0; id--) {
    const tryArenaId = new anchor.BN(id);
    const [tryArenaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_v2"), tryArenaId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    
    try {
      const arena = await program.account.arena.fetch(tryArenaPda);
      if (arena.status === 3) { // Active status
        targetArenaId = tryArenaId;
        targetArenaPda = tryArenaPda;
        targetArena = arena;
        break;
      }
    } catch {}
  }

  if (!targetArenaId || !targetArenaPda || !targetArena) {
    console.log("⚠️  No Active arena found.\n");
    
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

  console.log(`📍 Found Active arena: ID ${targetArenaId.toString()}`);
  console.log(`   Status: ${ARENA_STATUS[targetArena.status]}`);
  console.log(`   Players: ${targetArena.playerCount}/10`);

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
        const startPrice = asset.startPrice.toNumber() / 1e8;
        console.log(`   - ${ASSET_NAMES[i]}: ${asset.playerCount} player(s) | Start: $${startPrice.toFixed(6)}`);
      }
    } catch {}
  }

  // Check if duration has passed
  const now = Math.floor(Date.now() / 1000);
  const remaining = targetArena.endTimestamp.toNumber() - now;
  
  if (remaining > 0) {
    console.log(`\n⏱️  Arena still running. ${remaining} seconds remaining.`);
    console.log(`   End time: ${new Date(targetArena.endTimestamp.toNumber() * 1000).toLocaleString()}`);
    
    const waitForEnd = process.argv.includes("--wait");
    
    if (waitForEnd) {
      console.log(`\n⏳ Waiting for arena to end...`);
      for (let i = remaining; i > 0; i -= 15) {
        console.log(`   ${i}s remaining...`);
        await sleep(Math.min(15000, i * 1000));
      }
      await sleep(2000); // Buffer
    } else {
      console.log(`\n💡 Run with --wait flag to wait for arena to end.`);
      console.log(`   Or wait and run this script again.\n`);
      return;
    }
  }

  // Set end prices
  console.log("\n" + "═".repeat(80));
  console.log("📉 SETTING END PRICES");
  console.log("═".repeat(80) + "\n");

  const endPrices = await fetchPrices(ASSET_NAMES);

  for (const assetIndex of assetsInArena) {
    const assetName = ASSET_NAMES[assetIndex];
    const price = endPrices[assetName] || 1;
    const onchainPrice = priceToOnchain(price);
    
    try {
      await program.methods
        .setEndPrice(onchainPrice)
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

  // Finalize arena
  console.log("\n" + "═".repeat(80));
  console.log("🎯 FINALIZING ARENA");
  console.log("═".repeat(80) + "\n");

  const remainingAccounts = assetsInArena.map(idx => ({
    pubkey: arenaAssetPdas[idx],
    isSigner: false,
    isWritable: false,
  }));

  try {
    await program.methods
      .finalizeArena()
      .accountsStrict({
        globalState: globalStatePda,
        arena: targetArenaPda,
        admin: admin.publicKey,
      })
      .remainingAccounts(remainingAccounts)
      .signers([admin])
      .rpc();
    
    console.log(`✅ Arena finalized successfully!`);
  } catch (error: any) {
    console.log(`❌ Error finalizing: ${error.message || error}`);
    return;
  }

  // Fetch final arena state
  targetArena = await program.account.arena.fetch(targetArenaPda);
  const winningAsset = targetArena.winningAsset;

  // Show volatility results
  console.log("\n" + "═".repeat(80));
  console.log("📊 FINAL RESULTS - TOKEN VOLATILITY");
  console.log("═".repeat(80) + "\n");
  
  const results: { asset: string; index: number; movement: number; playerCount: number }[] = [];
  
  for (const assetIndex of assetsInArena) {
    const assetName = ASSET_NAMES[assetIndex];
    try {
      const arenaAsset = await program.account.arenaAsset.fetch(arenaAssetPdas[assetIndex]);
      const movement = Number(arenaAsset.priceMovement);
      results.push({
        asset: assetName,
        index: assetIndex,
        movement,
        playerCount: arenaAsset.playerCount,
      });
    } catch {}
  }

  // Sort by movement (highest first)
  results.sort((a, b) => b.movement - a.movement);

  console.log("   Rank | Asset      | Movement (bps) | Players | Winner");
  console.log("   " + "─".repeat(60));

  results.forEach((r, idx) => {
    const isWinner = r.index === winningAsset;
    const prefix = isWinner ? "🏆" : "  ";
    const winnerStr = isWinner ? "  ✅" : "";
    const movementStr = r.movement >= 0 ? `+${r.movement}` : `${r.movement}`;
    console.log(`   ${prefix}${(idx + 1).toString().padStart(2)} | ${r.asset.padEnd(10)} | ${movementStr.padStart(14)} | ${r.playerCount.toString().padStart(7)} |${winnerStr}`);
  });

  console.log("\n" + "═".repeat(80));
  console.log(`🏆 WINNER: ${ASSET_NAMES[winningAsset]} (Asset Index: ${winningAsset})`);
  console.log("═".repeat(80));

  console.log(`\n📊 Arena Summary:`);
  console.log(`   Arena ID: ${targetArenaId.toString()}`);
  console.log(`   Status: ${ARENA_STATUS[targetArena.status]}`);
  console.log(`   Total Players: ${targetArena.playerCount}`);
  console.log(`   Winning Asset: ${ASSET_NAMES[winningAsset]}`);

  console.log("\n" + "🎉".repeat(30));
  console.log("✅ ARENA ENDED SUCCESSFULLY!");
  console.log("🎉".repeat(30) + "\n");
  
  console.log("💡 Winners can now claim their rewards using the claim scripts.\n");
}

main().catch(console.error);

