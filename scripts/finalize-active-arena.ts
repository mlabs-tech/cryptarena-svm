/**
 * Finalize Active Arena
 * 
 * This script waits for an active arena to complete its duration,
 * then sets end prices and finalizes it.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaSvmTest } from "../target/types/cryptarena_svm_test";
import {
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
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
const CMC_API_KEY = "ef3cc5e80cc848ceba20b3c7cba60d5d";

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
    const { value } = await connection.getTokenAccountBalance(ata);
    return parseFloat(value.uiAmount || "0");
  } catch {
    return 0;
  }
}

const ARENA_STATUS: { [key: number]: string } = {
  0: "Uninitialized", 1: "Waiting", 2: "Ready", 3: "Active",
  4: "Ended", 5: "Suspended", 6: "Starting", 7: "Ending",
};

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(80));
  console.log("🏁 FINALIZE ACTIVE ARENA");
  console.log("═".repeat(80) + "\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const program = anchor.workspace.CryptarenaSvmTest as Program<CryptarenaSvmTest>;
  const admin = (provider.wallet as any).payer as Keypair;
  const treasuryWallet = admin.publicKey;

  const walletDir = path.join(__dirname, "../test-wallets");
  const players: Keypair[] = [];
  
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    if (fs.existsSync(walletPath)) {
      players.push(loadKeypair(walletPath));
    }
  }

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
  
  // Find Active arena
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
      if (arena.status === 3) { // Active
        targetArenaId = tryArenaId;
        targetArenaPda = tryArenaPda;
        targetArena = arena;
        break;
      }
    } catch {}
  }

  if (!targetArenaId || !targetArenaPda) {
    console.log("⚠️  No Active arena found.\n");
    return;
  }

  console.log(`📍 Found Active arena: ID ${targetArenaId.toString()}`);
  console.log(`   Status: ${ARENA_STATUS[targetArena.status]}`);
  console.log(`   Players: ${targetArena.playerCount}/10`);

  // Get assets in arena
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

  // Wait for duration
  const now = Math.floor(Date.now() / 1000);
  const remaining = targetArena.endTimestamp.toNumber() - now;
  
  if (remaining > 0) {
    console.log(`\n⏱️  Waiting ${remaining} seconds for arena to end...`);
    for (let i = remaining; i > 0; i -= 15) {
      console.log(`   ${i}s remaining...`);
      await sleep(Math.min(15000, i * 1000));
    }
    await sleep(2000); // Buffer
  }

  // Set end prices
  console.log("\n" + "═".repeat(80));
  console.log("SETTING END PRICES");
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
      
      console.log(`   ✅ ${assetName.padEnd(10)}: $${price.toFixed(4)}`);
    } catch (error: any) {
      console.log(`   ⚠️ ${assetName}: ${error.message?.slice(0, 40)}`);
    }
    await sleep(500);
  }

  // Finalize
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
        arena: targetArenaPda,
        admin: admin.publicKey,
      })
      .remainingAccounts(remainingAccounts)
      .signers([admin])
      .rpc();
    
    console.log(`✅ Arena finalized!`);
  } catch (error: any) {
    console.log(`❌ Error: ${error.message || error}`);
  }

  targetArena = await program.account.arena.fetch(targetArenaPda);
  const winningAsset = targetArena.winningAsset;

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

  console.log(`\n🏆 WINNER: ${ASSET_NAMES[winningAsset]} (Asset ${winningAsset})`);

  // Find winner and claim
  let winnerPlayer: Keypair | null = null;
  let winnerEntryPda: PublicKey | null = null;

  for (const player of players) {
    const [entryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_entry_v2"), targetArenaPda.toBuffer(), player.publicKey.toBuffer()],
      program.programId
    );
    
    try {
      const entry = await program.account.playerEntry.fetch(entryPda);
      if (entry.assetIndex === winningAsset) {
        winnerPlayer = player;
        winnerEntryPda = entryPda;
        break;
      }
    } catch {}
  }

  if (winnerPlayer && winnerEntryPda) {
    console.log(`   Winner Wallet: ${winnerPlayer.publicKey.toString()}`);

    // Claim own tokens
    console.log("\n📥 Claiming own tokens...");
    const winnerMint = tokenMints[winningAsset];
    const winnerAta = await getAssociatedTokenAddress(winnerMint, winnerPlayer.publicKey);
    const winnerArenaVault = await getAssociatedTokenAddress(winnerMint, targetArenaPda, true);

    try {
      await program.methods
        .claimOwnTokens()
        .accountsStrict({
          arena: targetArenaPda,
          playerEntry: winnerEntryPda,
          arenaVault: winnerArenaVault,
          winnerTokenAccount: winnerAta,
          winner: winnerPlayer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([winnerPlayer])
        .rpc();
      console.log(`   ✅ Own tokens claimed`);
    } catch (error: any) {
      console.log(`   ⚠️ ${error.message?.slice(0, 50)}`);
    }

    // Claim from losers
    console.log("\n📥 Claiming from losers...");
    const winningArenaAssetPda = arenaAssetPdas[winningAsset];

    for (const player of players) {
      const [loserEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player_entry_v2"), targetArenaPda.toBuffer(), player.publicKey.toBuffer()],
        program.programId
      );
      
      try {
        const loserEntry = await program.account.playerEntry.fetch(loserEntryPda);
        if (loserEntry.assetIndex === winningAsset) continue;
        
        const loserMint = tokenMints[loserEntry.assetIndex];
        const winnerLoserAta = await getOrCreateAssociatedTokenAccount(
          connection, admin, loserMint, winnerPlayer.publicKey
        );
        const treasuryAta = await getOrCreateAssociatedTokenAccount(
          connection, admin, loserMint, treasuryWallet
        );
        const loserArenaVault = await getAssociatedTokenAddress(loserMint, targetArenaPda, true);

        await program.methods
          .claimLoserTokens()
          .accountsStrict({
            globalState: globalStatePda,
            arena: targetArenaPda,
            arenaAsset: winningArenaAssetPda,
            winnerEntry: winnerEntryPda,
            loserEntry: loserEntryPda,
            arenaVault: loserArenaVault,
            winnerTokenAccount: winnerLoserAta.address,
            treasuryTokenAccount: treasuryAta.address,
            winner: winnerPlayer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([winnerPlayer])
          .rpc();
        
        console.log(`   ✅ ${ASSET_NAMES[loserEntry.assetIndex]} claimed`);
      } catch {}
      
      await sleep(300);
    }
  }

  console.log("\n" + "═".repeat(80));
  console.log("✅ ARENA COMPLETED!");
  console.log("═".repeat(80) + "\n");
}

main().catch(console.error);

