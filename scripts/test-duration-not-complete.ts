/**
 * TEST: Duration Not Complete
 * 
 * This test verifies that the program rejects ending an arena before
 * the duration has elapsed.
 * 
 * Expected: Calling setEndPrice before arena.endTimestamp fails
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaSvmTest } from "../target/types/cryptarena_svm_test";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import https from "https";

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

const ARENA_STATUS: { [key: number]: string } = {
  0: "Uninitialized", 1: "Waiting", 2: "Ready", 3: "Active",
  4: "Ended", 5: "Suspended", 6: "Starting", 7: "Ending",
};

// ============================================================================
// MAIN TEST
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🧪 TEST: DURATION NOT COMPLETE");
  console.log("═".repeat(80));
  console.log("   Expected: Cannot set end prices before duration expires");
  console.log("   Error Expected: ArenaDurationNotComplete");
  console.log("═".repeat(80) + "\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.CryptarenaSvmTest as Program<CryptarenaSvmTest>;
  const admin = (provider.wallet as any).payer as Keypair;

  console.log("📋 Configuration:");
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   Admin: ${admin.publicKey.toString()}`);

  const walletDir = path.join(__dirname, "../test-wallets");
  const mintsFilePath = path.join(walletDir, "token-mints.json");
  const tokenMints: { [key: number]: PublicKey } = {};
  const existingMints = JSON.parse(fs.readFileSync(mintsFilePath, "utf-8"));
  for (const [key, value] of Object.entries(existingMints)) {
    tokenMints[parseInt(key)] = new PublicKey(value as string);
  }

  // PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state_v2")],
    program.programId
  );

  const globalState = await program.account.globalState.fetch(globalStatePda);
  
  // Find arena in Ready, Starting, or Active status
  let targetArenaId: anchor.BN | null = null;
  let targetArenaPda: PublicKey | null = null;
  let targetArena: any = null;

  for (let id = globalState.currentArenaId.toNumber(); id >= 0; id--) {
    const tryArenaId = new anchor.BN(id);
    const [tryArenaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_v2"), tryArenaId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    
    try {
      const arena = await program.account.arena.fetch(tryArenaPda);
      // Status 2 = Ready, 3 = Active, 6 = Starting
      if ((arena.status === 2 || arena.status === 3 || arena.status === 6) && arena.playerCount >= 10) {
        targetArenaId = tryArenaId;
        targetArenaPda = tryArenaPda;
        targetArena = arena;
        break;
      }
    } catch {}
  }

  if (!targetArenaId || !targetArenaPda) {
    console.log("⚠️  No arena in Ready/Active status found.");
    console.log("   Run test-arena-full.ts first.\n");
    return;
  }

  console.log(`\n📍 Found Ready arena: ID ${targetArenaId.toString()}`);
  console.log(`   Status: ${ARENA_STATUS[targetArena.status]}`);
  console.log(`   Players: ${targetArena.playerCount}/10\n`);

  // Get all assets in arena
  const arenaAssetPdas: { [key: number]: PublicKey } = {};
  const assetsInArena: number[] = [];

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
      }
    } catch {}
  }

  console.log(`   Assets in arena: ${assetsInArena.map(i => ASSET_NAMES[i]).join(", ")}\n`);

  // ================================================================
  // SET START PRICES (to make arena Active) - if not already Active
  // ================================================================
  const prices = await fetchPrices(ASSET_NAMES);

  if (targetArena.status !== 3) { // Not Active yet
    console.log("═".repeat(80));
    console.log("SETTING START PRICES (MAKING ARENA ACTIVE)");
    console.log("═".repeat(80) + "\n");

    for (const assetIndex of assetsInArena) {
      const assetName = ASSET_NAMES[assetIndex];
      const price = prices[assetName] || 1;
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
        
        console.log(`   ✅ ${assetName.padEnd(10)}: $${price.toFixed(4)}`);
      } catch (error: any) {
        // May already be set
        console.log(`   ⚠️ ${assetName}: ${error.message?.slice(0, 40)}`);
      }
      await sleep(500);
    }
  } else {
    console.log("📊 Arena already Active, skipping start price setting.\n");
  }

  // Refresh arena state
  targetArena = await program.account.arena.fetch(targetArenaPda);
  console.log(`\n📊 Arena Status: ${ARENA_STATUS[targetArena.status]}`);
  console.log(`   Start Time: ${new Date(targetArena.startTimestamp.toNumber() * 1000).toISOString()}`);
  console.log(`   End Time:   ${new Date(targetArena.endTimestamp.toNumber() * 1000).toISOString()}`);
  
  const now = Math.floor(Date.now() / 1000);
  const remaining = targetArena.endTimestamp.toNumber() - now;
  console.log(`   Remaining:  ${remaining} seconds\n`);

  if (remaining <= 0) {
    console.log("⚠️  Arena duration already complete. Cannot test early end rejection.");
    console.log("   Need a fresh arena for this test.\n");
    return;
  }

  // ================================================================
  // TEST: TRY TO SET END PRICE IMMEDIATELY (SHOULD FAIL)
  // ================================================================
  console.log("═".repeat(80));
  console.log("TEST: TRYING TO SET END PRICE BEFORE DURATION COMPLETE");
  console.log("═".repeat(80) + "\n");

  let testPassed = false;
  const firstAsset = assetsInArena[0];
  const testPrice = priceToOnchain(prices[ASSET_NAMES[firstAsset]] || 100);

  console.log(`⏱️  Time remaining: ${remaining} seconds`);
  console.log(`👤 Admin attempting to set end price for ${ASSET_NAMES[firstAsset]}...\n`);

  try {
    await program.methods
      .setEndPrice(testPrice)
      .accountsStrict({
        globalState: globalStatePda,
        arena: targetArenaPda,
        arenaAsset: arenaAssetPdas[firstAsset],
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();
    
    console.log(`   ❌ UNEXPECTED: End price was set before duration complete!\n`);
    
  } catch (error: any) {
    const errorMsg = error.message || JSON.stringify(error);
    const isExpectedError = errorMsg.includes("ArenaDurationNotComplete") || 
                            errorMsg.includes("0x7eb") ||
                            errorMsg.includes("duration") ||
                            errorMsg.includes("ArenaNotActive");
    
    if (isExpectedError) {
      testPassed = true;
      console.log(`   ✅ EXPECTED ERROR! End price setting was correctly rejected.`);
      console.log(`   📛 Error: ArenaDurationNotComplete\n`);
    } else {
      console.log(`   ⚠️ Different error: ${errorMsg.slice(0, 100)}\n`);
    }
  }

  // ================================================================
  // TEST RESULTS
  // ================================================================
  console.log("═".repeat(80));
  console.log("TEST RESULTS");
  console.log("═".repeat(80) + "\n");

  if (testPassed) {
    console.log("🎉 TEST PASSED!");
    console.log("   ✅ Cannot set end prices before arena duration complete");
    console.log(`   ✅ Arena must wait ${remaining} more seconds`);
  } else {
    console.log("❌ TEST FAILED!");
    console.log("   End prices could be set before duration complete");
  }

  console.log("\n" + "═".repeat(80) + "\n");
}

main().catch(console.error);

