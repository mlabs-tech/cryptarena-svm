/**
 * FILL ARENA SCRIPT
 * 
 * Quickly fills an existing arena with test wallets.
 * Use this when you've manually entered as a user and need to fill remaining slots.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { CryptarenaSvmTest } from "../target/types/cryptarena_svm_test";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  Connection,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import https from "https";

// Load default wallet
function loadDefaultWallet(): Keypair {
  const walletPath = process.env.ANCHOR_WALLET || path.join(os.homedir(), ".config/solana/id.json");
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

// Setup provider
function setupProvider(): { provider: AnchorProvider; admin: Keypair } {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  const admin = loadDefaultWallet();
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  return { provider, admin };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CMC_API_KEY = process.env.CMC_API_KEY || "";
const ASSET_NAMES = ["SOL", "TRUMP", "PUMP", "BONK", "JUP", "PENGU", "PYTH", "HNT", "FARTCOIN", "RAY", "JTO", "KMNO", "MET", "W"];

const ARENA_STATUS: { [key: number]: string } = {
  0: "Uninitialized", 1: "Waiting", 2: "Ready", 3: "Active",
  4: "Ended", 5: "Suspended", 6: "Starting", 7: "Ending",
};

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

async function airdropTokens(
  connection: Connection,
  admin: Keypair,
  recipient: PublicKey,
  mint: PublicKey,
  assetName: string,
  targetUSD: number,
  currentPrice: number,
  decimals: number
): Promise<boolean> {
  try {
    console.log(`   💸 Airdropping $${targetUSD} worth of ${assetName}...`);
    
    // Get or create ATA
    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      mint,
      recipient
    );

    // Calculate amount with decimals to reach target USD value
    const tokensNeeded = (targetUSD / currentPrice) * Math.pow(10, decimals);
    const amountWithDecimals = BigInt(Math.floor(tokensNeeded));

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
    const balance = Number(accountInfo.amount) / Math.pow(10, decimals);

    console.log(`   ✅ Airdropped ${(tokensNeeded / Math.pow(10, decimals)).toFixed(9)} ${assetName}`);
    console.log(`   💰 New balance: ${balance.toLocaleString()} ${assetName} ≈ $${(balance * currentPrice).toFixed(2)}`);

    return true;
  } catch (error: any) {
    console.log(`   ❌ Airdrop failed: ${error.message?.slice(0, 80) || error}`);
    return false;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("🏟️  FILL ARENA - Quick arena filler");
  console.log("═".repeat(70) + "\n");

  const { provider, admin } = setupProvider();
  const connection = provider.connection;

  // Load program IDL
  const idlPath = path.join(__dirname, "../target/idl/cryptarena_svm_test.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const programId = new PublicKey("2LsREShXRB5GMera37czrEKwe5xt9FUnKAjwpW183ce9");
  const program = new Program(idl, provider) as Program<CryptarenaSvmTest>;

  // Load wallets and mints
  const walletDir = path.join(__dirname, "../test-wallets");
  const players: Keypair[] = [];
  
  for (let i = 1; i <= 10; i++) {
    const walletPath = path.join(walletDir, `player${i}.json`);
    if (fs.existsSync(walletPath)) {
      players.push(loadKeypair(walletPath));
    }
  }
  console.log(`📁 Loaded ${players.length} test wallets`);

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
  
  // Find the current waiting arena
  let arenaId: anchor.BN | null = null;
  let arenaPda: PublicKey | null = null;
  let arena: any = null;

  for (let tryId = globalState.currentArenaId.toNumber(); tryId >= 0; tryId--) {
    const tryArenaId = new anchor.BN(tryId);
    const [tryArenaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_v2"), tryArenaId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    
    try {
      arena = await program.account.arena.fetch(tryArenaPda);
      if (arena.status === 1 || arena.status === 2) { // Waiting or Ready
        arenaId = tryArenaId;
        arenaPda = tryArenaPda;
        console.log(`📍 Found arena: ID ${tryId} (${ARENA_STATUS[arena.status]})`);
        break;
      }
    } catch {
      continue;
    }
  }

  if (!arena || !arenaPda || !arenaId) {
    console.log("❌ No waiting/ready arena found.");
    return;
  }

  console.log(`\n📊 CURRENT ARENA STATE:`);
  console.log(`   Arena ID: ${arena.id.toString()}`);
  console.log(`   Status: ${ARENA_STATUS[arena.status]}`);
  console.log(`   Players: ${arena.playerCount}/10`);
  console.log(`   Total Pool: $${(arena.totalPool.toNumber() / 1_000_000).toFixed(2)}`);

  // Get existing assets in arena
  const existingAssets = new Set<number>();
  const arenaAssetPdas: { [key: number]: PublicKey } = {};
  const existingPlayers = new Set<string>();

  for (let i = 0; i < 14; i++) {
    const [assetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena_asset_v2"), arenaPda.toBuffer(), Buffer.from([i])],
      program.programId
    );
    
    try {
      const assetData = await program.account.arenaAsset.fetch(assetPda);
      if (assetData.playerCount > 0) {
        existingAssets.add(i);
        arenaAssetPdas[i] = assetPda;
      }
    } catch {}
  }

  // Check which test players are already in the arena
  for (const player of players) {
    const [entryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("player_entry_v2"), arenaPda.toBuffer(), player.publicKey.toBuffer()],
      program.programId
    );
    
    try {
      await program.account.playerEntry.fetch(entryPda);
      existingPlayers.add(player.publicKey.toString());
    } catch {}
  }

  console.log(`   Existing assets: ${[...existingAssets].map(i => ASSET_NAMES[i]).join(", ") || "none"}`);
  console.log(`   Test wallets already in arena: ${existingPlayers.size}`);

  // ================================================================
  // ADD PLAYERS
  // ================================================================
  const playersNeeded = 10 - arena.playerCount;
  
  if (playersNeeded <= 0) {
    console.log("\n✅ Arena is already full!");
  } else {
    console.log("\n" + "─".repeat(70));
    console.log(`ADDING ${playersNeeded} PLAYERS TO FILL ARENA`);
    console.log("─".repeat(70) + "\n");

    const USD_ENTRY = new anchor.BN(10_000_000); // $10
    
    // Fetch current prices from CoinMarketCap
    console.log("📡 Fetching current prices from CoinMarketCap...\n");
    const currentPrices = await fetchPrices(ASSET_NAMES);
    
    if (Object.keys(currentPrices).length === 0) {
      console.log("❌ Failed to fetch prices. Cannot calculate proper entry amounts.");
      return;
    }
    
    // Available assets for new players (avoid assets with 3+ players)
    const availableAssets = ASSET_NAMES.map((_, i) => i).filter(i => !existingAssets.has(i));
    
    let addedCount = 0;
    let assetIdx = 0;

    for (const player of players) {
      if (addedCount >= playersNeeded) break;
      if (existingPlayers.has(player.publicKey.toString())) continue;
      
      // Pick an asset
      let assetIndex: number;
      if (availableAssets.length > 0) {
        assetIndex = availableAssets[assetIdx % availableAssets.length];
        assetIdx++;
      } else {
        // Fall back to any asset
        assetIndex = assetIdx % 14;
        assetIdx++;
      }
      
      const assetName = ASSET_NAMES[assetIndex];
      const mint = tokenMints[assetIndex];
      
      if (!mint) {
        console.log(`   ⚠️ No mint for ${assetName}, skipping`);
        continue;
      }
      
      const playerAta = await getAssociatedTokenAddress(mint, player.publicKey);
      
      let tokenBalance = BigInt(0);
      let needsAirdrop = false;
      
      try {
        const tokenAccount = await getAccount(connection, playerAta);
        tokenBalance = tokenAccount.amount;
      } catch {
        console.log(`   ⚠️ Player ${player.publicKey.toString().slice(0, 8)}... has no ${assetName}`);
        needsAirdrop = true;
      }

      if (tokenBalance === BigInt(0) && !needsAirdrop) {
        console.log(`   ⚠️ Player has 0 ${assetName}`);
        needsAirdrop = true;
      }

      console.log(`👤 Adding player with ${assetName}...`);

      try {
        const arenaVault = await getAssociatedTokenAddress(mint, arenaPda, true);
        
        const [playerEntryPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("player_entry_v2"), arenaPda.toBuffer(), player.publicKey.toBuffer()],
          program.programId
        );

        const [arenaAssetPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("arena_asset_v2"), arenaPda.toBuffer(), Buffer.from([assetIndex])],
          program.programId
        );

        const [whitelistedTokenPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("whitelist_token_v2"), mint.toBuffer()],
          program.programId
        );

        // Calculate token amount based on current price to equal $10 USD
        const currentPrice = currentPrices[assetName] || 1;
        const targetUSD = 10; // $10 entry value
        const decimals = 9; // Most SPL tokens use 9 decimals
        const tokenAmountForTargetUSD = (targetUSD / currentPrice) * Math.pow(10, decimals);
        const tokenAmount = new anchor.BN(Math.floor(tokenAmountForTargetUSD));
        
        console.log(`   💰 ${assetName} price: $${currentPrice.toFixed(6)}`);
        console.log(`   📊 Entering with ${(tokenAmountForTargetUSD / Math.pow(10, decimals)).toFixed(9)} ${assetName} ≈ $${targetUSD}`);
        
        // Check if player has enough tokens, if not airdrop $5000 worth
        if (needsAirdrop || tokenBalance < BigInt(tokenAmount.toString())) {
          console.log(`   ⚠️ Insufficient balance. Has: ${Number(tokenBalance) / Math.pow(10, decimals)} ${assetName}, needs: ${tokenAmountForTargetUSD / Math.pow(10, decimals)} ${assetName}`);
          
          // Airdrop $5000 worth of the token
          const airdropSuccess = await airdropTokens(
            connection,
            admin,
            player.publicKey,
            mint,
            assetName,
            5000, // $5000 target
            currentPrice,
            decimals
          );
          
          if (!airdropSuccess) {
            console.log(`   ⚠️ Failed to airdrop tokens, skipping player`);
            continue;
          }
          
          // Refresh token balance after airdrop
          try {
            const tokenAccount = await getAccount(connection, playerAta);
            tokenBalance = tokenAccount.amount;
          } catch {
            console.log(`   ⚠️ Failed to get balance after airdrop, skipping player`);
            continue;
          }
          
          // Verify we now have enough
          if (tokenBalance < BigInt(tokenAmount.toString())) {
            console.log(`   ⚠️ Still insufficient balance after airdrop, skipping player`);
            continue;
          }
        }

        const tx = new Transaction();
        
        // Create arena vault ATA if needed
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
            whitelistedToken: whitelistedTokenPda,
            player: player.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([player])
          .instruction();
        
        tx.add(enterIx);

        await sendAndConfirmTransaction(connection, tx, [admin, player], { skipPreflight: true });
        
        addedCount++;
        console.log(`   ✅ Entered! (${arena.playerCount + addedCount}/10)`);
        
        arenaAssetPdas[assetIndex] = arenaAssetPda;

      } catch (error: any) {
        console.log(`   ❌ Error: ${error.message?.slice(0, 80) || error}`);
      }

      await sleep(1500);
    }
  }

  // Refresh arena state
  arena = await program.account.arena.fetch(arenaPda);
  console.log(`\n📊 Arena Status: ${ARENA_STATUS[arena.status]} | Players: ${arena.playerCount}/10`);

  if (arena.status === 2) { // Ready
    console.log("\n🏁 Arena is READY with 10 players!");
    console.log("💡 The indexer will automatically start it and set prices.");
  }

  console.log("\n" + "═".repeat(70));
  console.log("✅ DONE!");
  console.log("═".repeat(70) + "\n");
}

main().catch(console.error);

