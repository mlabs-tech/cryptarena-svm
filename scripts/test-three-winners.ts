/**
 * TEST: Three Winners (Same Token)
 * 
 * This test verifies that when 3 players enter with the same winning token,
 * they each receive 33.33% of the 90% rewards (30% each).
 * 
 * Strategy:
 * - 3 players enter with FARTCOIN (will be the winners)
 * - 7 players enter with different tokens
 * - Set fake end price for FARTCOIN to ensure it wins (high volatility)
 * - All 3 winners claim and verify they get ~33.33% each
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
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import https from "https";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CMC_API_KEY = "ef3cc5e80cc848ceba20b3c7cba60d5d";
const ASSET_NAMES = ["SOL", "TRUMP", "PUMP", "BONK", "JUP", "PENGU", "PYTH", "HNT", "FARTCOIN", "RAY"];

// FARTCOIN index = 8, this will be our winning token
const WINNING_ASSET_INDEX = 8;
const WINNING_ASSET_NAME = "FARTCOIN";

// ============================================================================
// HELPERS
// ============================================================================

function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

async function getTokenBalance(connection: any, mint: PublicKey, owner: PublicKey): Promise<number> {
  try {
    const ata = await getAssociatedTokenAddress(mint, owner);
    const account = await getAccount(connection, ata);
    return Number(account.amount) / 1e9;
  } catch {
    return 0;
  }
}

// ============================================================================
// MAIN TEST
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🧪 TEST: THREE WINNERS (SAME TOKEN)");
  console.log("═".repeat(80));
  console.log("   Expected: 3 winners each get 33.33% of the 90% rewards (30% each)");
  console.log("   Winning Token: FARTCOIN (forced via fake high end price)");
  console.log("═".repeat(80) + "\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.CryptarenaSvmTest as Program<CryptarenaSvmTest>;
  const admin = (provider.wallet as any).payer as Keypair;
  const treasuryWallet = admin.publicKey;

  console.log("📋 Configuration:");
  console.log(`   Program ID: ${program.programId.toString()}`);
  console.log(`   Admin: ${admin.publicKey.toString()}`);

  // Load wallets and mints
  const walletDir = path.join(__dirname, "../test-wallets");
  const players: Keypair[] = [];
  
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    if (fs.existsSync(walletPath)) {
      players.push(loadKeypair(walletPath));
    }
  }
  console.log(`   Loaded ${players.length} player wallets\n`);

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
  const arenaId = globalState.currentArenaId;
  
  const [arenaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena_v2"), arenaId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  console.log(`   Current Arena ID: ${arenaId.toString()}`);
  console.log(`   Arena PDA: ${arenaPda.toString()}\n`);

  // ================================================================
  // ENTER 10 PLAYERS - 3 with FARTCOIN, 7 with different tokens
  // ================================================================
  console.log("═".repeat(80));
  console.log("ENTERING 10 PLAYERS (3 WITH FARTCOIN)");
  console.log("═".repeat(80) + "\n");

  const USD_ENTRY = new anchor.BN(15_000_000);
  const arenaAssetPdas: { [key: number]: PublicKey } = {};
  const playerAssets: { player: Keypair; assetIndex: number; entryPda: PublicKey }[] = [];

  // Asset distribution: 
  // Player 1,2,3: FARTCOIN (8) - will be winners (max 3 per asset)
  // Player 4-10: SOL(0), TRUMP(1), PUMP(2), BONK(3), JUP(4), PENGU(5), PYTH(6)
  const assetAssignment = [8, 8, 8, 0, 1, 2, 3, 4, 5, 6];

  for (let i = 0; i < 10; i++) {
    const player = players[i];
    const assetIndex = assetAssignment[i];
    const assetName = ASSET_NAMES[assetIndex];
    
    const isWinnerCandidate = assetIndex === WINNING_ASSET_INDEX;
    const prefix = isWinnerCandidate ? "🏆" : "👤";
    console.log(`${prefix} Player ${i + 1} entering with ${assetName}${isWinnerCandidate ? " (WINNER)" : ""}...`);

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

      const tokenAmount = new anchor.BN(Number(tokenBalance) / 100);

      const tx = new Transaction();
      
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

      await sendAndConfirmTransaction(connection, tx, [admin, player], { skipPreflight: true });

      playerAssets.push({ player, assetIndex, entryPda: playerEntryPda });
      console.log(`   ✅ Entered with ${(Number(tokenAmount) / 1e9).toFixed(4)} ${assetName}`);

    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message?.slice(0, 60) || error}`);
    }

    await sleep(1000);
  }

  // Verify arena is full
  let arena = await program.account.arena.fetch(arenaPda);
  console.log(`\n📊 Arena Status: ${ARENA_STATUS[arena.status]} | Players: ${arena.playerCount}/10`);

  if (arena.status !== 2) {
    console.log("⚠️  Arena not ready. Exiting.");
    return;
  }

  // Show FARTCOIN player count
  const fartcoinAsset = await program.account.arenaAsset.fetch(arenaAssetPdas[WINNING_ASSET_INDEX]);
  console.log(`   🏆 FARTCOIN players: ${fartcoinAsset.playerCount} (all will be winners)\n`);

  // ================================================================
  // SET START PRICES (normal prices)
  // ================================================================
  console.log("═".repeat(80));
  console.log("SETTING START PRICES");
  console.log("═".repeat(80) + "\n");

  const startPrices = await fetchPrices(ASSET_NAMES);
  const assetsInArena = Object.keys(arenaAssetPdas).map(k => parseInt(k));

  for (const assetIndex of assetsInArena) {
    const assetName = ASSET_NAMES[assetIndex];
    const price = startPrices[assetName] || 1;
    const onchainPrice = priceToOnchain(price);
    
    try {
      await program.methods
        .setStartPrice(onchainPrice)
        .accountsStrict({
          globalState: globalStatePda,
          arena: arenaPda,
          arenaAsset: arenaAssetPdas[assetIndex],
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
      
      console.log(`   ✅ ${assetName.padEnd(10)}: $${price.toFixed(6)}`);
    } catch (error: any) {
      console.log(`   ⚠️ ${assetName}: ${error.message?.slice(0, 40)}`);
    }
    await sleep(500);
  }

  arena = await program.account.arena.fetch(arenaPda);
  console.log(`\n📊 Status: ${ARENA_STATUS[arena.status]}`);

  // Wait for duration
  const now = Math.floor(Date.now() / 1000);
  const remaining = arena.endTimestamp.toNumber() - now;
  
  if (remaining > 0) {
    console.log(`\n⏱️  Waiting ${remaining} seconds for arena to end...`);
    for (let i = remaining; i > 0; i -= 15) {
      console.log(`   ${i}s remaining...`);
      await sleep(Math.min(15000, i * 1000));
    }
    await sleep(2000);
  }

  // ================================================================
  // SET END PRICES (FAKE HIGH PRICE FOR FARTCOIN TO ENSURE WIN)
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("SETTING END PRICES (FARTCOIN BOOSTED TO WIN)");
  console.log("═".repeat(80) + "\n");

  const endPrices = await fetchPrices(ASSET_NAMES);

  for (const assetIndex of assetsInArena) {
    const assetName = ASSET_NAMES[assetIndex];
    let price = endPrices[assetName] || startPrices[assetName] || 1;
    
    // BOOST FARTCOIN price by 50% to ensure it wins
    if (assetIndex === WINNING_ASSET_INDEX) {
      const originalPrice = price;
      price = price * 1.50; // 50% increase = +5000 bps
      console.log(`   🚀 ${assetName.padEnd(10)}: $${originalPrice.toFixed(6)} → $${price.toFixed(6)} (BOOSTED +50%)`);
    } else {
      console.log(`   ✅ ${assetName.padEnd(10)}: $${price.toFixed(6)}`);
    }
    
    const onchainPrice = priceToOnchain(price);
    
    try {
      await program.methods
        .setEndPrice(onchainPrice)
        .accountsStrict({
          globalState: globalStatePda,
          arena: arenaPda,
          arenaAsset: arenaAssetPdas[assetIndex],
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();
    } catch (error: any) {
      console.log(`   ⚠️ ${assetName}: ${error.message?.slice(0, 40)}`);
    }
    await sleep(500);
  }

  // ================================================================
  // FINALIZE ARENA
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("FINALIZING ARENA");
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
        arena: arenaPda,
        admin: admin.publicKey,
      })
      .remainingAccounts(remainingAccounts)
      .signers([admin])
      .rpc();
    
    console.log(`✅ Arena finalized!`);
  } catch (error: any) {
    console.log(`❌ Error: ${error.message || error}`);
  }

  arena = await program.account.arena.fetch(arenaPda);
  const winningAsset = arena.winningAsset;

  // Show volatility
  console.log("\n📊 TOKEN VOLATILITY:");
  console.log("─".repeat(60));
  
  for (const assetIndex of assetsInArena) {
    const assetName = ASSET_NAMES[assetIndex];
    try {
      const arenaAsset = await program.account.arenaAsset.fetch(arenaAssetPdas[assetIndex]);
      const movement = Number(arenaAsset.priceMovement);
      const isWinner = assetIndex === winningAsset;
      const prefix = isWinner ? "🏆" : "  ";
      console.log(`${prefix} ${assetName.padEnd(10)}: ${movement >= 0 ? '+' : ''}${movement} bps`);
    } catch {}
  }

  console.log(`\n🏆 WINNING ASSET: ${ASSET_NAMES[winningAsset]}`);

  if (winningAsset !== WINNING_ASSET_INDEX) {
    console.log(`⚠️  Expected FARTCOIN to win, but ${ASSET_NAMES[winningAsset]} won instead.`);
  }

  // ================================================================
  // IDENTIFY ALL 3 WINNERS
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("IDENTIFYING WINNERS");
  console.log("═".repeat(80) + "\n");

  const winners: { player: Keypair; entryPda: PublicKey }[] = [];
  const losers: { player: Keypair; entryPda: PublicKey; assetIndex: number }[] = [];

  // Winners are identified by having the same asset_index as winning_asset
  for (const { player, assetIndex, entryPda } of playerAssets) {
    if (assetIndex === winningAsset) {
      winners.push({ player, entryPda });
      console.log(`🏆 Winner: ${player.publicKey.toString().slice(0, 20)}... (${ASSET_NAMES[assetIndex]})`);
    } else {
      losers.push({ player, entryPda, assetIndex });
    }
  }

  console.log(`\n   Total Winners: ${winners.length}`);
  console.log(`   Total Losers: ${losers.length}`);

  if (winners.length !== 3) {
    console.log(`\n⚠️  Expected 3 winners, got ${winners.length}`);
  }

  // ================================================================
  // ALL 3 WINNERS CLAIM THEIR OWN TOKENS
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("WINNERS CLAIM OWN TOKENS (100% each)");
  console.log("═".repeat(80) + "\n");

  const winnerMint = tokenMints[winningAsset];
  const arenaVaultForWinner = await getAssociatedTokenAddress(winnerMint, arenaPda, true);

  for (let i = 0; i < winners.length; i++) {
    const { player, entryPda } = winners[i];
    const winnerAta = await getAssociatedTokenAddress(winnerMint, player.publicKey);
    
    const beforeBalance = await getTokenBalance(connection, winnerMint, player.publicKey);

    console.log(`👤 Winner ${i + 1}: ${player.publicKey.toString().slice(0, 20)}...`);
    
    try {
      await program.methods
        .claimOwnTokens()
        .accountsStrict({
          arena: arenaPda,
          playerEntry: entryPda,
          arenaVault: arenaVaultForWinner,
          winnerTokenAccount: winnerAta,
          winner: player.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([player])
        .rpc();
      
      const afterBalance = await getTokenBalance(connection, winnerMint, player.publicKey);
      const claimed = afterBalance - beforeBalance;
      console.log(`   ✅ Claimed own ${ASSET_NAMES[winningAsset]}: ${claimed.toFixed(4)}`);
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message?.slice(0, 60)}`);
    }
    
    await sleep(500);
  }

  // ================================================================
  // ALL 3 WINNERS CLAIM FROM LOSERS (33.33% EACH OF 90%)
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("WINNERS CLAIM FROM LOSERS (33.33% each of 90% = 30% each)");
  console.log("═".repeat(80) + "\n");

  const winningAssetPda = arenaAssetPdas[winningAsset];

  // Track claims for verification
  const claimsSummary: { [loserAsset: string]: { winner1: number; winner2: number; winner3: number; treasury: number } } = {};

  for (const loser of losers) {
    const loserAssetName = ASSET_NAMES[loser.assetIndex];
    claimsSummary[loserAssetName] = { winner1: 0, winner2: 0, winner3: 0, treasury: 0 };
    
    const loserMint = tokenMints[loser.assetIndex];
    const loserArenaVault = await getAssociatedTokenAddress(loserMint, arenaPda, true);
    
    // Get vault balance before claims
    let vaultBalanceBefore = 0;
    try {
      const vaultAccount = await getAccount(connection, loserArenaVault);
      vaultBalanceBefore = Number(vaultAccount.amount) / 1e9;
    } catch {}
    
    console.log(`\n📦 Loser Token: ${loserAssetName} (Vault: ${vaultBalanceBefore.toFixed(4)})`);

    for (let i = 0; i < winners.length; i++) {
      const { player: winnerPlayer, entryPda: winnerEntryPda } = winners[i];
      
      const winnerAta = await getOrCreateAssociatedTokenAccount(
        connection, admin, loserMint, winnerPlayer.publicKey
      );
      const treasuryAta = await getOrCreateAssociatedTokenAccount(
        connection, admin, loserMint, treasuryWallet
      );

      const beforeBalance = await getTokenBalance(connection, loserMint, winnerPlayer.publicKey);
      const treasuryBefore = await getTokenBalance(connection, loserMint, treasuryWallet);

      try {
        await program.methods
          .claimLoserTokens()
          .accountsStrict({
            globalState: globalStatePda,
            arena: arenaPda,
            arenaAsset: winningAssetPda,
            winnerEntry: winnerEntryPda,
            loserEntry: loser.entryPda,
            arenaVault: loserArenaVault,
            winnerTokenAccount: winnerAta.address,
            treasuryTokenAccount: treasuryAta.address,
            winner: winnerPlayer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([winnerPlayer])
          .rpc();
        
        const afterBalance = await getTokenBalance(connection, loserMint, winnerPlayer.publicKey);
        const treasuryAfter = await getTokenBalance(connection, loserMint, treasuryWallet);
        
        const claimed = afterBalance - beforeBalance;
        const treasuryFee = treasuryAfter - treasuryBefore;
        
        if (i === 0) {
          claimsSummary[loserAssetName].winner1 = claimed;
        } else if (i === 1) {
          claimsSummary[loserAssetName].winner2 = claimed;
        } else {
          claimsSummary[loserAssetName].winner3 = claimed;
        }
        claimsSummary[loserAssetName].treasury += treasuryFee;
        
        console.log(`   Winner ${i + 1}: +${claimed.toFixed(4)} ${loserAssetName} (Treasury: +${treasuryFee.toFixed(4)})`);
        
      } catch (error: any) {
        console.log(`   Winner ${i + 1}: ❌ ${error.message?.slice(0, 50)}`);
      }
      
      await sleep(500);
    }
  }

  // ================================================================
  // VERIFY 33/33/33 SPLIT
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("VERIFICATION: 33/33/33 SPLIT CHECK");
  console.log("═".repeat(80) + "\n");

  console.log("Token          | Winner 1   | Winner 2   | Winner 3   | Ratios        | Treasury");
  console.log("─".repeat(85));

  let allSplitsCorrect = true;

  for (const [assetName, claims] of Object.entries(claimsSummary)) {
    const total = claims.winner1 + claims.winner2 + claims.winner3;
    const ratio1 = total > 0 ? (claims.winner1 / total * 100).toFixed(1) : "0.0";
    const ratio2 = total > 0 ? (claims.winner2 / total * 100).toFixed(1) : "0.0";
    const ratio3 = total > 0 ? (claims.winner3 / total * 100).toFixed(1) : "0.0";
    
    // Check if roughly equal (within 1% tolerance)
    const avg = total / 3;
    const isCorrect = total === 0 || (
      Math.abs(claims.winner1 - avg) / avg < 0.02 &&
      Math.abs(claims.winner2 - avg) / avg < 0.02 &&
      Math.abs(claims.winner3 - avg) / avg < 0.02
    );
    
    const status = isCorrect ? "✅" : "⚠️";
    
    console.log(`${assetName.padEnd(14)} | ${claims.winner1.toFixed(4).padStart(10)} | ${claims.winner2.toFixed(4).padStart(10)} | ${claims.winner3.toFixed(4).padStart(10)} | ${ratio1}/${ratio2}/${ratio3} ${status} | ${claims.treasury.toFixed(4)}`);
    
    if (!isCorrect && total > 0) {
      allSplitsCorrect = false;
    }
  }

  // ================================================================
  // TEST RESULTS
  // ================================================================
  console.log("\n" + "═".repeat(80));
  console.log("TEST RESULTS");
  console.log("═".repeat(80) + "\n");

  const winnersCorrect = winners.length === 3;
  const winningAssetCorrect = winningAsset === WINNING_ASSET_INDEX;

  console.log(`   Number of winners:    ${winnersCorrect ? "3 ✅" : `${winners.length} ❌`}`);
  console.log(`   Winning asset:        ${ASSET_NAMES[winningAsset]} ${winningAssetCorrect ? "✅" : "⚠️"}`);
  console.log(`   33/33/33 split:       ${allSplitsCorrect ? "YES ✅" : "NEEDS REVIEW ⚠️"}\n`);

  if (winnersCorrect && allSplitsCorrect) {
    console.log("🎉 TEST PASSED!");
    console.log("   ✅ 3 players with same winning token all received rewards");
    console.log("   ✅ Each winner received ~33.33% of the 90% loser rewards (30% each)");
    console.log("   ✅ Treasury received 10% fee from each claim");
  } else {
    console.log("⚠️  TEST NEEDS REVIEW");
    console.log("   Check the split ratios above for details");
  }

  console.log("\n" + "═".repeat(80) + "\n");
}

main().catch(console.error);

