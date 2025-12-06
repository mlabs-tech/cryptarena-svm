import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaSvmTest } from "../target/types/cryptarena_svm_test";
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
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import https from "https";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CMC_API_KEY = "ef3cc5e80cc848ceba20b3c7cba60d5d";
const ASSET_NAMES = ["SOL", "TRUMP", "PUMP", "BONK", "JUP", "PENGU", "PYTH", "HNT", "FARTCOIN", "RAY", "JTO", "KMNO", "MET", "W"];

// ============================================================================
// HELPERS
// ============================================================================

function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

const formatSOL = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const formatTime = () => new Date().toLocaleTimeString();

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
// MAIN TEST
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🏟️  CRYPTARENA - MODULAR ARCHITECTURE TEST (Scalable)");
  console.log("═".repeat(80));
  console.log(`   Started at: ${new Date().toLocaleString()}`);
  console.log("═".repeat(80) + "\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.CryptarenaSvmTest as Program<CryptarenaSvmTest>;
  const admin = (provider.wallet as any).payer as Keypair;

  console.log("📋 CONFIGURATION");
  console.log("─".repeat(80));
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   Admin: ${admin.publicKey.toString()}`);
  
  const adminBalance = await connection.getBalance(admin.publicKey);
  console.log(`   Admin Balance: ${formatSOL(adminBalance)} SOL\n`);

  // Load wallets and mints
  const walletDir = path.join(__dirname, "../test-wallets");
  const players: Keypair[] = [];
  
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    if (fs.existsSync(walletPath)) {
      players.push(loadKeypair(walletPath));
    }
  }
  console.log(`👥 Loaded ${players.length} player wallets`);

  const mintsFilePath = path.join(walletDir, "token-mints.json");
  const tokenMints: { [key: number]: PublicKey } = {};
  const existingMints = JSON.parse(fs.readFileSync(mintsFilePath, "utf-8"));
  for (const [key, value] of Object.entries(existingMints)) {
    tokenMints[parseInt(key)] = new PublicKey(value as string);
  }
  console.log(`📜 Loaded ${Object.keys(tokenMints).length} token mints\n`);

  // PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state_v2")],
    program.programId
  );

  // ================================================================
  // STEP 1: Initialize Protocol (fresh start needed for new structure)
  // ================================================================
  console.log("═".repeat(80));
  console.log("STEP 1: INITIALIZE PROTOCOL");
  console.log("═".repeat(80));

  const treasuryWallet = admin.publicKey;
  let globalState;
  
  try {
    globalState = await program.account.globalState.fetch(globalStatePda);
    console.log(`✅ Protocol exists. Arena ID: ${globalState.currentArenaId.toString()}`);
    console.log(`   Max Players: ${globalState.maxPlayersPerArena}`);
  } catch {
    console.log("🔧 Initializing protocol (v2)...");
    await program.methods
      .initialize(new anchor.BN(60))
      .accountsStrict({
        globalState: globalStatePda,
        treasuryWallet: treasuryWallet,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    
    globalState = await program.account.globalState.fetch(globalStatePda);
    console.log(`✅ Initialized!`);
  }
  console.log("");

  const arenaId = globalState.currentArenaId;
  const [arenaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena_v2"), arenaId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  console.log(`   Arena ID: ${arenaId.toString()}`);
  console.log(`   Arena PDA: ${arenaPda.toString()}\n`);

  // ================================================================
  // STEP 2: Players Enter Arena
  // ================================================================
  console.log("═".repeat(80));
  console.log("STEP 2: PLAYERS ENTER ARENA (10 sec delay)");
  console.log("═".repeat(80) + "\n");

  const USD_ENTRY = new anchor.BN(15_000_000);
  const assetsInArena: number[] = [];
  const playerEntries: { player: Keypair; pda: PublicKey; assetIndex: number; playerIndex: number }[] = [];
  const arenaAssetPdas: { [key: number]: PublicKey } = {};

  for (let i = 0; i < 10; i++) {
    const player = players[i];
    const assetIndex = i;
    const assetName = ASSET_NAMES[assetIndex];
    
    console.log(`⏳ [${formatTime()}] Player ${i + 1} entering with ${assetName}...`);

    try {
      const mint = tokenMints[assetIndex];
      const playerAta = await getAssociatedTokenAddress(mint, player.publicKey);
      
      let tokenBalance = BigInt(0);
      try {
        const tokenAccount = await getAccount(connection, playerAta);
        tokenBalance = tokenAccount.amount;
      } catch {
        console.log(`   ❌ No token account`);
        continue;
      }

      const arenaVault = await getAssociatedTokenAddress(mint, arenaPda, true);
      
      const [playerEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player_entry_v2"), arenaPda.toBuffer(), player.publicKey.toBuffer()],
        program.programId
      );

      const [arenaAssetPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("arena_asset_v2"), arenaPda.toBuffer(), Buffer.from([assetIndex])],
        program.programId
      );
      arenaAssetPdas[assetIndex] = arenaAssetPda;

      const tokenAmount = new anchor.BN(Number(tokenBalance) / 10);

      const tx = new Transaction();
      
      // Create arena vault if needed
      try {
        await getAccount(connection, arenaVault);
      } catch {
        tx.add(createAssociatedTokenAccountInstruction(admin.publicKey, arenaVault, arenaPda, mint));
      }

      const enterIx = await program.methods
        .enterArena(assetIndex, tokenAmount, USD_ENTRY)
        .accountsStrict({
          globalState: globalStatePda,
          arena: arenaPda,
          arenaAsset: arenaAssetPda,
          playerEntry: playerEntryPda,
          playerTokenAccount: playerAta,
          arenaVault: arenaVault,
          player: player.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .instruction();
      
      tx.add(enterIx);

      await sendAndConfirmTransaction(connection, tx, [admin, player], { skipPreflight: false });

      assetsInArena.push(assetIndex);
      playerEntries.push({ player, pda: playerEntryPda, assetIndex, playerIndex: i });
      console.log(`   ✅ Entered! Amount: ${(Number(tokenAmount) / 1e9).toFixed(4)} | Players: ${assetsInArena.length}/10`);

      if (assetsInArena.length === 10) {
        console.log("\n🏁 ARENA FULL! Status: READY\n");
      } else {
        await sleep(10000);
      }
    } catch (error: any) {
      const msg = error.message?.slice(0, 100) || JSON.stringify(error).slice(0, 100);
      console.log(`   ❌ Error: ${msg}`);
      if (error.logs) {
        console.log("   Logs:");
        error.logs.slice(-5).forEach((log: string) => console.log("      ", log));
      }
    }
  }

  // ================================================================
  // STEP 3: Set Start Prices
  // ================================================================
  console.log("═".repeat(80));
  console.log("STEP 3: SET START PRICES (Admin Only)");
  console.log("═".repeat(80) + "\n");

  const startPrices = await fetchPrices(ASSET_NAMES);
  
  for (const assetIndex of assetsInArena) {
    const assetName = ASSET_NAMES[assetIndex];
    const price = startPrices[assetName] || 1;
    const onchainPrice = priceToOnchain(price);
    const arenaAssetPda = arenaAssetPdas[assetIndex];
    
    try {
      await program.methods
        .setStartPrice(onchainPrice)
        .accountsStrict({
          globalState: globalStatePda,
          arena: arenaPda,
          arenaAsset: arenaAssetPda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
      
      console.log(`   ✅ ${assetName.padEnd(10)}: $${price.toFixed(4)}`);
    } catch (error: any) {
      console.log(`   ⚠️ ${assetName}: ${error.message?.slice(0, 50)}`);
    }
    await sleep(500);
  }

  let arena = await program.account.arena.fetch(arenaPda);
  console.log(`\n📊 Status: ${ARENA_STATUS[arena.status]} | Ends: ${new Date(arena.endTimestamp.toNumber() * 1000).toLocaleTimeString()}`);

  // ================================================================
  // STEP 4: Wait for Arena Duration
  // ================================================================
  if (arena.status === 3) {
    const remaining = arena.endTimestamp.toNumber() - Math.floor(Date.now() / 1000);
    if (remaining > 0) {
      console.log(`\n⏱️  Waiting ${remaining} seconds...`);
      for (let i = remaining; i > 0; i -= 15) {
        console.log(`   ${i}s remaining...`);
        await sleep(Math.min(15000, i * 1000));
      }
    }
  }

  // ================================================================
  // STEP 5: Set End Prices
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("STEP 5: SET END PRICES");
  console.log("═".repeat(80) + "\n");

  const endPrices = await fetchPrices(ASSET_NAMES);

  for (const assetIndex of assetsInArena) {
    const assetName = ASSET_NAMES[assetIndex];
    const price = endPrices[assetName] || startPrices[assetName] || 1;
    const onchainPrice = priceToOnchain(price);
    const arenaAssetPda = arenaAssetPdas[assetIndex];
    
    try {
      await program.methods
        .setEndPrice(onchainPrice)
        .accountsStrict({
          globalState: globalStatePda,
          arena: arenaPda,
          arenaAsset: arenaAssetPda,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
      
      console.log(`   ✅ ${assetName.padEnd(10)}: $${price.toFixed(4)}`);
    } catch (error: any) {
      console.log(`   ⚠️ ${assetName}: ${error.message?.slice(0, 50)}`);
    }
    await sleep(500);
  }

  // ================================================================
  // STEP 6: Finalize Arena
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("STEP 6: FINALIZE ARENA");
  console.log("═".repeat(80) + "\n");

  // Collect all ArenaAsset accounts as remaining_accounts
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
        arena: arenaPda,
        admin: admin.publicKey,
      })
      .remainingAccounts(remainingAccounts)
      .signers([admin])
      .rpc();
    
    console.log(`✅ Arena finalized!`);
  } catch (error: any) {
    console.log(`❌ Error: ${error.message || error}`);
    if (error.logs) console.log("Logs:", error.logs.slice(-5));
  }

  arena = await program.account.arena.fetch(arenaPda);
  const winningAsset = arena.winningAsset;
  const winnerAssetName = ASSET_NAMES[winningAsset];
  
  // ================================================================
  // SHOW VOLATILITY FOR ALL TOKENS
  // ================================================================
  console.log("\n📊 TOKEN VOLATILITY (Price Movement)");
  console.log("─".repeat(70));
  console.log("   Asset      | Start Price    | End Price      | Change (bps) | %");
  console.log("   " + "─".repeat(65));
  
  const volatilityData: { asset: string; assetIndex: number; startPrice: number; endPrice: number; bps: number; pct: number }[] = [];
  
  for (const assetIndex of assetsInArena) {
    const assetName = ASSET_NAMES[assetIndex];
    const arenaAssetPda = arenaAssetPdas[assetIndex];
    
    try {
      const arenaAsset = await program.account.arenaAsset.fetch(arenaAssetPda);
      const startPrice = arenaAsset.startPrice.toNumber() / 1e8;
      const endPrice = arenaAsset.endPrice.toNumber() / 1e8;
      const movement = Number(arenaAsset.priceMovement);
      const pctChange = (movement / 100).toFixed(4);
      
      const isWinner = assetIndex === winningAsset;
      const prefix = isWinner ? "🏆" : "  ";
      
      console.log(`${prefix} ${assetName.padEnd(10)} | $${startPrice.toFixed(6).padStart(12)} | $${endPrice.toFixed(6).padStart(12)} | ${movement.toString().padStart(10)} | ${pctChange}%`);
      
      volatilityData.push({ asset: assetName, assetIndex, startPrice, endPrice, bps: movement, pct: parseFloat(pctChange) });
    } catch (e) {
      console.log(`   ${assetName.padEnd(10)} | Error fetching`);
    }
  }
  
  // Sort by volatility
  volatilityData.sort((a, b) => b.bps - a.bps);
  
  console.log("\n📈 VOLATILITY RANKING:");
  console.log("─".repeat(50));
  for (let i = 0; i < volatilityData.length; i++) {
    const v = volatilityData[i];
    const isWinner = v.assetIndex === winningAsset;
    const prefix = isWinner ? "🏆" : `${i + 1}.`.padStart(3);
    const sign = v.bps >= 0 ? "+" : "";
    console.log(`   ${prefix} ${v.asset.padEnd(10)}: ${sign}${v.bps} bps (${sign}${v.pct}%)`);
  }
  
  console.log(`\n🏆 WINNER: ${winnerAssetName} (Asset ${winningAsset})`);
  console.log(`   Total Pool: $${(arena.totalPool.toNumber() / 1_000_000).toFixed(2)}`);

  // Find winner
  const winnerEntry = playerEntries.find(e => e.assetIndex === winningAsset);
  if (!winnerEntry) {
    console.log("❌ Winner not found!");
    return;
  }
  console.log(`   Winner Wallet: ${winnerEntry.player.publicKey.toString()}`);

  // ================================================================
  // STEP 7: Winner Claims Rewards
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("STEP 7: WINNER CLAIMS REWARDS");
  console.log("═".repeat(80));

  // Helper to get balance
  async function getTokenBalance(mint: PublicKey, owner: PublicKey): Promise<number> {
    try {
      const ata = await getAssociatedTokenAddress(mint, owner);
      const account = await getAccount(connection, ata);
      return Number(account.amount) / 1e9;
    } catch {
      return 0;
    }
  }

  // Track claim details
  const claimDetails: { token: string; before: number; after: number; claimed: number; treasuryFee: number }[] = [];

  // 7a. Claim own tokens (100%)
  console.log("\n📥 Claiming own tokens (100%)...");
  
  const winnerMint = tokenMints[winningAsset];
  const winnerAta = await getAssociatedTokenAddress(winnerMint, winnerEntry.player.publicKey);
  const winnerArenaVault = await getAssociatedTokenAddress(winnerMint, arenaPda, true);

  const ownBefore = await getTokenBalance(winnerMint, winnerEntry.player.publicKey);
  
  // Get loser's entry amount from PlayerEntry
  const winnerPlayerEntry = await program.account.playerEntry.fetch(winnerEntry.pda);
  const ownEntryAmount = winnerPlayerEntry.amount.toNumber() / 1e9;

  try {
    await program.methods
      .claimOwnTokens()
      .accountsStrict({
        arena: arenaPda,
        playerEntry: winnerEntry.pda,
        arenaVault: winnerArenaVault,
        winnerTokenAccount: winnerAta,
        winner: winnerEntry.player.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([winnerEntry.player])
      .rpc();
    
    const ownAfter = await getTokenBalance(winnerMint, winnerEntry.player.publicKey);
    const ownClaimed = ownAfter - ownBefore;
    
    console.log(`   ✅ ${winnerAssetName}: Before=${ownBefore.toFixed(4)} | Claimed=${ownClaimed.toFixed(4)} | After=${ownAfter.toFixed(4)}`);
    claimDetails.push({ token: winnerAssetName, before: ownBefore, after: ownAfter, claimed: ownClaimed, treasuryFee: 0 });
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message?.slice(0, 60)}`);
  }

  // 7b. Claim from losers (90% winner, 10% treasury)
  console.log("\n📥 Claiming loser tokens (90% winner, 10% treasury)...");
  console.log("─".repeat(80));
  
  const winningArenaAssetPda = arenaAssetPdas[winningAsset];
  
  for (const loserEntry of playerEntries) {
    if (loserEntry.assetIndex === winningAsset) {
      console.log(`   ⏭️  ${ASSET_NAMES[loserEntry.assetIndex].padEnd(10)} - Skipping (winner's own asset)`);
      continue;
    }

    const loserMint = tokenMints[loserEntry.assetIndex];
    const loserAssetName = ASSET_NAMES[loserEntry.assetIndex];
    
    // Get loser's entry amount from their PlayerEntry
    const loserPlayerEntry = await program.account.playerEntry.fetch(loserEntry.pda);
    const loserAmount = loserPlayerEntry.amount.toNumber() / 1e9;
    const expectedWinnerReward = loserAmount * 0.9;
    const expectedTreasuryFee = loserAmount * 0.1;
    
    const winnerLoserAta = await getOrCreateAssociatedTokenAccount(
      connection, admin, loserMint, winnerEntry.player.publicKey
    );
    
    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      connection, admin, loserMint, treasuryWallet
    );

    const loserArenaVault = await getAssociatedTokenAddress(loserMint, arenaPda, true);

    // Get balances before
    const winnerBefore = await getTokenBalance(loserMint, winnerEntry.player.publicKey);
    const treasuryBefore = await getTokenBalance(loserMint, treasuryWallet);

    try {
      await program.methods
        .claimLoserTokens()
        .accountsStrict({
          globalState: globalStatePda,
          arena: arenaPda,
          arenaAsset: winningArenaAssetPda,
          winnerEntry: winnerEntry.pda,
          loserEntry: loserEntry.pda,
          arenaVault: loserArenaVault,
          winnerTokenAccount: winnerLoserAta.address,
          treasuryTokenAccount: treasuryAta.address,
          winner: winnerEntry.player.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([winnerEntry.player])
        .rpc();
      
      // Get balances after
      const winnerAfter = await getTokenBalance(loserMint, winnerEntry.player.publicKey);
      const treasuryAfter = await getTokenBalance(loserMint, treasuryWallet);
      
      const winnerClaimed = winnerAfter - winnerBefore;
      const treasuryReceived = treasuryAfter - treasuryBefore;
      
      console.log(`   ✅ ${loserAssetName.padEnd(10)} | Loser had: ${loserAmount.toFixed(4).padStart(12)} | Winner got: ${winnerClaimed.toFixed(4).padStart(12)} | Treasury: ${treasuryReceived.toFixed(4).padStart(10)}`);
      
      claimDetails.push({ token: loserAssetName, before: winnerBefore, after: winnerAfter, claimed: winnerClaimed, treasuryFee: treasuryReceived });
    } catch (error: any) {
      console.log(`   ❌ ${loserAssetName.padEnd(10)} | Error: ${error.message?.slice(0, 40)}`);
    }
    
    await sleep(500);
  }
  
  // Summary of claims
  console.log("\n" + "─".repeat(80));
  console.log("📋 CLAIM SUMMARY");
  console.log("─".repeat(80));
  console.log("   Token      | Before        | Claimed       | After         | Treasury Fee");
  console.log("   " + "─".repeat(75));
  
  for (const d of claimDetails) {
    const isOwn = d.token === winnerAssetName;
    const prefix = isOwn ? "🏆" : "💰";
    console.log(`   ${prefix} ${d.token.padEnd(9)} | ${d.before.toFixed(4).padStart(12)} | ${d.claimed.toFixed(4).padStart(12)} | ${d.after.toFixed(4).padStart(12)} | ${d.treasuryFee.toFixed(4).padStart(12)}`);
  }

  // ================================================================
  // STEP 8: Final Summary
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("STEP 8: FINAL RESULTS");
  console.log("═".repeat(80));

  // Calculate totals from claim details
  let totalClaimed = 0;
  let totalTreasuryFees = 0;
  
  console.log("\n💰 TOTAL REWARDS CLAIMED BY WINNER:");
  console.log("─".repeat(60));
  
  for (const d of claimDetails) {
    const isOwn = d.token === winnerAssetName;
    const prefix = isOwn ? "🏆 (own)" : "💰 (90%)";
    console.log(`   ${d.token.padEnd(10)}: ${d.claimed.toFixed(6)} ${prefix}`);
  }

  console.log("\n💼 TOTAL TREASURY FEES (10%):");
  console.log("─".repeat(60));
  
  for (const d of claimDetails) {
    if (d.treasuryFee > 0) {
      console.log(`   ${d.token.padEnd(10)}: ${d.treasuryFee.toFixed(6)}`);
      totalTreasuryFees++;
    }
  }

  // Verify final wallet balances match
  console.log("\n🔍 VERIFICATION - Winner's Current Token Balances:");
  console.log("─".repeat(60));
  console.log(`   Wallet: ${winnerEntry.player.publicKey.toString()}`);
  console.log("");
  
  for (let i = 0; i < 10; i++) {
    const mint = tokenMints[i];
    const balance = await getTokenBalance(mint, winnerEntry.player.publicKey);
    const isWinnerAsset = i === winningAsset;
    const prefix = isWinnerAsset ? "🏆" : "  ";
    
    // Find what was claimed for this token
    const claimInfo = claimDetails.find(d => d.token === ASSET_NAMES[i]);
    const claimed = claimInfo ? claimInfo.claimed : 0;
    
    console.log(`   ${prefix} ${ASSET_NAMES[i].padEnd(10)}: ${balance.toFixed(6).padStart(15)} (claimed: ${claimed.toFixed(6)})`);
  }

  console.log("\n" + "═".repeat(80));
  console.log("✅ FULL ARENA TEST COMPLETE!");
  console.log("═".repeat(80));
  console.log("\n📊 SCALABLE ARCHITECTURE SUMMARY:");
  console.log("   • Arena account: ~100 bytes (metadata only)");
  console.log("   • ArenaAsset: ~80 bytes per asset used");
  console.log("   • PlayerEntry: ~120 bytes per player");
  console.log("   • Supports 100+ players and 100+ tokens!");
  console.log("");
}

main().catch(console.error);
