/**
 * FULL FLOW TEST - Cryptarena SOL
 * 
 * Complete arena lifecycle test:
 * 1. 10 players enter with different tokens
 * 2. Admin starts arena and sets start prices (from CMC)
 * 3. Wait for arena duration (3 minutes)
 * 4. Admin sets end prices and ends arena
 * 5. Winner claims 90% rewards
 * 6. Treasury claims 10% fee
 * 
 * Usage: npx ts-node scripts/full-flow-test-sol.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Connection,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import https from "https";

// ============================================================================
// CONFIG
// ============================================================================

const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const WALLET_PATH = process.env.ANCHOR_WALLET || path.join(os.homedir(), ".config/solana/id.json");
const PROGRAM_ID = new PublicKey("GX4gVWUtVgq6XxL8oHYy6psoN9KFdJhwnds2T3NHe5na");

const CMC_API_KEY = "ef3cc5e80cc848ceba20b3c7cba60d5d";

// Token symbols for the 10 players (matching whitelist indices 0-9)
// Using symbols that CoinMarketCap API recognizes
const ASSET_SYMBOLS = ["SOL", "TRUMP", "BONK", "JUP", "PENGU", "PYTH", "HNT", "RAY", "JTO", "W"];
const ASSET_INDICES = [0, 1, 3, 4, 5, 6, 7, 9, 10, 13]; // Skipping PUMP(2), FARTCOIN(8), KMNO(11), MET(12) - not on CMC

// ============================================================================
// HELPERS
// ============================================================================

function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

// PDA helpers
function getGlobalStatePda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("global_state")],
    PROGRAM_ID
  )[0];
}

function getArenaPda(arenaId: number): PublicKey {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(arenaId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("arena"), idBuffer],
    PROGRAM_ID
  )[0];
}

function getArenaVaultPda(arenaId: number): PublicKey {
  const idBuffer = Buffer.alloc(8);
  idBuffer.writeBigUInt64LE(BigInt(arenaId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("arena_vault"), idBuffer],
    PROGRAM_ID
  )[0];
}

function getPlayerEntryPda(arenaPda: PublicKey, player: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("player_entry"), arenaPda.toBuffer(), player.toBuffer()],
    PROGRAM_ID
  )[0];
}

function getWhitelistTokenPda(assetIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist_token"), Buffer.from([assetIndex])],
    PROGRAM_ID
  )[0];
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🏟️  CRYPTARENA SOL - FULL FLOW TEST");
  console.log("═".repeat(80) + "\n");

  // Setup connection and wallet
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair(WALLET_PATH);
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  // Load program
  const idlPath = path.join(__dirname, "../../target/idl/cryptarena_sol.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider) as any;

  // Load test wallets
  const walletDir = path.join(__dirname, "../../test-wallets");
  const players: Keypair[] = [];
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    if (fs.existsSync(walletPath)) {
      players.push(loadKeypair(walletPath));
    }
  }

  console.log(`📋 Program ID: ${PROGRAM_ID.toString()}`);
  console.log(`👤 Admin: ${admin.publicKey.toString()}`);
  console.log(`📁 Loaded ${players.length} test wallets`);
  console.log(`🌐 Cluster: ${connection.rpcEndpoint}\n`);

  const globalStatePda = getGlobalStatePda();
  const globalState = await program.account.globalState.fetch(globalStatePda);
  
  console.log("📊 Protocol Config:");
  console.log(`   Entry Fee: ${globalState.entryFee.toNumber() / 1e9} SOL`);
  console.log(`   Arena Duration: ${globalState.arenaDuration.toNumber()} seconds`);
  console.log(`   Current Arena ID: ${globalState.currentArenaId.toNumber()}\n`);

  const arenaId = globalState.currentArenaId.toNumber();
  const arenaPda = getArenaPda(arenaId);
  const arenaVaultPda = getArenaVaultPda(arenaId);

  // =========================================================================
  // STEP 1: 10 PLAYERS ENTER ARENA
  // =========================================================================
  console.log("═".repeat(80));
  console.log("📥 STEP 1: Players entering arena...");
  console.log("═".repeat(80) + "\n");

  const playerEntries: { player: Keypair; assetIndex: number; symbol: string; entryPda: PublicKey }[] = [];

  for (let i = 0; i < Math.min(players.length, 10); i++) {
    const player = players[i];
    const assetIndex = ASSET_INDICES[i];
    const symbol = ASSET_SYMBOLS[i];
    const playerEntryPda = getPlayerEntryPda(arenaPda, player.publicKey);
    const whitelistPda = getWhitelistTokenPda(assetIndex);

    try {
      // Check player balance
      const balance = await connection.getBalance(player.publicKey);
      console.log(`   Player ${i + 1}: ${player.publicKey.toString().slice(0, 8)}... | Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL | Token: ${symbol}`);

      if (balance < globalState.entryFee.toNumber() + 10000000) {
        console.log(`   ⚠️  Insufficient balance, skipping...`);
        continue;
      }

      await program.methods
        .enterArena(assetIndex)
        .accounts({
          globalState: globalStatePda,
          arena: arenaPda,
          arenaVault: arenaVaultPda,
          playerEntry: playerEntryPda,
          whitelistedToken: whitelistPda,
          player: player.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc();

      playerEntries.push({ player, assetIndex, symbol, entryPda: playerEntryPda });
      console.log(`   ✅ Player ${i + 1} entered with ${symbol} (index ${assetIndex})`);
    } catch (error: any) {
      console.log(`   ❌ Player ${i + 1} failed: ${error.message?.slice(0, 60) || error}`);
    }

    await sleep(500);
  }

  const arena = await program.account.arena.fetch(arenaPda);
  console.log(`\n📊 Arena ${arenaId} Status: ${arena.playerCount} players | Pool: ${arena.totalPool.toNumber() / 1e9} SOL\n`);

  if (playerEntries.length < 1) {
    console.log("❌ No players entered. Exiting.");
    return;
  }

  // =========================================================================
  // STEP 2: START ARENA & SET START PRICES
  // =========================================================================
  console.log("═".repeat(80));
  console.log("🚀 STEP 2: Starting arena and setting start prices...");
  console.log("═".repeat(80) + "\n");

  // Fetch current prices from CoinMarketCap
  const symbolsInArena = playerEntries.map(p => p.symbol);
  console.log(`   Fetching prices for: ${symbolsInArena.join(", ")}`);
  
  const startPrices = await fetchPrices(symbolsInArena);
  console.log("\n   📈 START PRICES:");
  for (const [symbol, price] of Object.entries(startPrices)) {
    console.log(`      ${symbol}: $${price.toFixed(6)}`);
  }

  // Start arena
  console.log("\n   Starting arena...");
  await program.methods
    .startArena()
    .accounts({
      globalState: globalStatePda,
      arena: arenaPda,
      admin: admin.publicKey,
    })
    .signers([admin])
    .rpc();

  const arenaAfterStart = await program.account.arena.fetch(arenaPda);
  console.log(`   ✅ Arena started! Status: Active | End time: ${new Date(arenaAfterStart.endTimestamp.toNumber() * 1000).toLocaleTimeString()}`);

  // Set start prices for each player
  console.log("\n   Setting start prices...");
  for (const entry of playerEntries) {
    const price = startPrices[entry.symbol];
    if (price) {
      await program.methods
        .setStartPrice(priceToOnchain(price))
        .accounts({
          globalState: globalStatePda,
          arena: arenaPda,
          playerEntry: entry.entryPda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
      console.log(`   ✅ ${entry.symbol} start price set: $${price.toFixed(6)}`);
    }
    await sleep(300);
  }

  // =========================================================================
  // STEP 3: WAIT FOR ARENA DURATION
  // =========================================================================
  const durationSeconds = globalState.arenaDuration.toNumber();
  console.log("\n" + "═".repeat(80));
  console.log(`⏳ STEP 3: Waiting ${durationSeconds} seconds for arena duration...`);
  console.log("═".repeat(80) + "\n");

  // Wait with countdown
  for (let remaining = durationSeconds; remaining > 0; remaining -= 30) {
    console.log(`   ⏱️  ${remaining} seconds remaining...`);
    await sleep(Math.min(remaining, 30) * 1000);
  }

  console.log("   ✅ Arena duration complete!\n");

  // =========================================================================
  // STEP 4: SET END PRICES & END ARENA
  // =========================================================================
  console.log("═".repeat(80));
  console.log("🏁 STEP 4: Setting end prices and ending arena...");
  console.log("═".repeat(80) + "\n");

  // Fetch end prices
  console.log(`   Fetching end prices...`);
  const endPrices = await fetchPrices(symbolsInArena);
  
  console.log("\n   📉 END PRICES & MOVEMENTS:");
  const movements: { symbol: string; movement: number; player: Keypair; entryPda: PublicKey }[] = [];
  
  for (const entry of playerEntries) {
    const startPrice = startPrices[entry.symbol];
    const endPrice = endPrices[entry.symbol];
    if (startPrice && endPrice) {
      const movement = ((endPrice - startPrice) / startPrice) * 10000; // basis points
      movements.push({ symbol: entry.symbol, movement, player: entry.player, entryPda: entry.entryPda });
      console.log(`      ${entry.symbol}: $${startPrice.toFixed(6)} → $${endPrice.toFixed(6)} | ${movement >= 0 ? '+' : ''}${movement.toFixed(0)}bps`);
      
      await program.methods
        .setEndPrice(priceToOnchain(endPrice))
        .accounts({
          globalState: globalStatePda,
          arena: arenaPda,
          playerEntry: entry.entryPda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
    }
    await sleep(300);
  }

  // Sort by movement to find winner
  movements.sort((a, b) => b.movement - a.movement);
  const winner = movements[0];
  
  console.log(`\n   🏆 EXPECTED WINNER: ${winner.symbol} with ${winner.movement >= 0 ? '+' : ''}${winner.movement.toFixed(0)}bps`);

  // End arena
  console.log("\n   Ending arena...");
  const remainingAccounts = playerEntries.map(entry => ({
    pubkey: entry.entryPda,
    isWritable: false,
    isSigner: false,
  }));

  await program.methods
    .endArena()
    .accounts({
      globalState: globalStatePda,
      arena: arenaPda,
      admin: admin.publicKey,
    })
    .remainingAccounts(remainingAccounts)
    .signers([admin])
    .rpc();

  const arenaAfterEnd = await program.account.arena.fetch(arenaPda);
  const winningAsset = arenaAfterEnd.winningAsset;
  const isCanceled = arenaAfterEnd.isCanceled;

  if (isCanceled) {
    console.log("\n   ⚠️ ARENA CANCELED (TIE DETECTED)");
    console.log("   All players can claim refunds.\n");
    return;
  }

  const actualWinner = playerEntries.find(e => e.assetIndex === winningAsset);
  console.log(`\n   ✅ Arena ended! Winning asset index: ${winningAsset}`);
  console.log(`   🏆 WINNER: ${actualWinner?.symbol || 'Unknown'} (Player: ${actualWinner?.player.publicKey.toString().slice(0, 8)}...)`);

  // =========================================================================
  // STEP 5: CLAIM WINNER REWARDS (90%)
  // =========================================================================
  console.log("\n" + "═".repeat(80));
  console.log("💰 STEP 5: Winner claiming rewards (90%)...");
  console.log("═".repeat(80) + "\n");

  if (actualWinner) {
    const totalPool = arenaAfterEnd.totalPool.toNumber();
    const winnerReward = Math.floor((totalPool * 9000) / 10000);
    
    console.log(`   Total Pool: ${totalPool / 1e9} SOL`);
    console.log(`   Winner Reward (90%): ${winnerReward / 1e9} SOL`);

    const winnerBalanceBefore = await connection.getBalance(actualWinner.player.publicKey);

    await program.methods
      .claimWinnerRewards()
      .accounts({
        arena: arenaPda,
        arenaVault: arenaVaultPda,
        playerEntry: actualWinner.entryPda,
        winner: actualWinner.player.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([actualWinner.player])
      .rpc();

    const winnerBalanceAfter = await connection.getBalance(actualWinner.player.publicKey);
    console.log(`\n   ✅ Winner claimed rewards!`);
    console.log(`   Balance: ${winnerBalanceBefore / 1e9} → ${winnerBalanceAfter / 1e9} SOL (+${(winnerBalanceAfter - winnerBalanceBefore) / 1e9} SOL)`);
  }

  // =========================================================================
  // STEP 6: CLAIM TREASURY FEE (10%)
  // =========================================================================
  console.log("\n" + "═".repeat(80));
  console.log("🏦 STEP 6: Treasury claiming fee (10%)...");
  console.log("═".repeat(80) + "\n");

  const totalPool = arenaAfterEnd.totalPool.toNumber();
  const treasuryFee = Math.floor((totalPool * 1000) / 10000);
  console.log(`   Treasury Fee (10%): ${treasuryFee / 1e9} SOL`);

  const treasuryWallet = globalState.treasuryWallet;
  const treasuryBalanceBefore = await connection.getBalance(treasuryWallet);

  await program.methods
    .claimTreasuryFee()
    .accounts({
      globalState: globalStatePda,
      arena: arenaPda,
      arenaVault: arenaVaultPda,
      treasuryWallet: treasuryWallet,
      admin: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc();

  const treasuryBalanceAfter = await connection.getBalance(treasuryWallet);
  console.log(`\n   ✅ Treasury fee claimed!`);
  console.log(`   Treasury Balance: ${treasuryBalanceBefore / 1e9} → ${treasuryBalanceAfter / 1e9} SOL (+${(treasuryBalanceAfter - treasuryBalanceBefore) / 1e9} SOL)`);

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log("\n" + "═".repeat(80));
  console.log("📊 FINAL SUMMARY");
  console.log("═".repeat(80) + "\n");

  console.log(`   Arena ID: ${arenaId}`);
  console.log(`   Players: ${playerEntries.length}`);
  console.log(`   Total Pool: ${totalPool / 1e9} SOL`);
  console.log(`   Winner: ${actualWinner?.symbol || 'N/A'} (${actualWinner?.player.publicKey.toString().slice(0, 8)}...)`);
  console.log(`   Winner Reward: ${Math.floor((totalPool * 9000) / 10000) / 1e9} SOL`);
  console.log(`   Treasury Fee: ${treasuryFee / 1e9} SOL`);
  
  console.log("\n   🎉 FULL FLOW TEST COMPLETE!\n");
}

main().catch(console.error);

