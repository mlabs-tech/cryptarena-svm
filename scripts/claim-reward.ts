import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaSvmTest } from "../target/types/cryptarena_svm_test";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("🏆 CLAIM WINNER REWARD");
  console.log("═".repeat(70) + "\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const program = anchor.workspace.CryptarenaSvmTest as Program<CryptarenaSvmTest>;

  // Load winner wallet (Player 9)
  const walletDir = path.join(__dirname, "../test-wallets");
  const winnerKey = JSON.parse(fs.readFileSync(path.join(walletDir, "player9.json"), "utf-8"));
  const winner = Keypair.fromSecretKey(Uint8Array.from(winnerKey));

  // Load token mints
  const mints = JSON.parse(fs.readFileSync(path.join(walletDir, "token-mints-admin.json"), "utf-8"));
  const ASSET_NAMES = ["SOL", "TRUMP", "PUMP", "BONK", "JUP", "PENGU", "PYTH", "HNT", "FARTCOIN", "RAY"];

  console.log("👤 WINNER INFO");
  console.log("─".repeat(70));
  console.log(`   Address: ${winner.publicKey.toString()}`);
  console.log(`   Asset:   FARTCOIN (Asset 8)`);

  // Get PDAs
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state")],
    program.programId
  );
  
  const globalState = await program.account.globalState.fetch(globalStatePda);

  // Arena 3 was the completed arena
  const arenaId = new anchor.BN(3);
  const [arenaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena"), arenaId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );

  const [playerEntryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("player_entry"), arenaPda.toBuffer(), winner.publicKey.toBuffer()],
    program.programId
  );

  // Fetch arena and player entry
  const arena = await program.account.arena.fetch(arenaPda);
  const playerEntry = await program.account.playerEntry.fetch(playerEntryPda);

  console.log(`\n📦 ON-CHAIN STATE (Before Claim)`);
  console.log("─".repeat(70));
  console.log(`   Arena Status:    ${arena.status} (4 = Ended)`);
  console.log(`   Winning Asset:   ${arena.winningAsset} (${ASSET_NAMES[arena.winningAsset]})`);
  console.log(`   Player Asset:    ${playerEntry.assetIndex} (${ASSET_NAMES[playerEntry.assetIndex]})`);
  console.log(`   Is Winner:       ${playerEntry.assetIndex === arena.winningAsset}`);
  console.log(`   Reward Claimed:  ${playerEntry.rewardClaimed}`);
  console.log(`   Total Pool:      $${(arena.totalPool.toNumber() / 1_000_000).toFixed(2)}`);

  // Calculate reward
  const totalPool = arena.totalPool.toNumber();
  const treasuryFee = Math.floor(totalPool * 10 / 100); // 10%
  const winnerReward = totalPool - treasuryFee;
  
  console.log(`\n💰 REWARD CALCULATION`);
  console.log("─".repeat(70));
  console.log(`   Total Pool:      $${(totalPool / 1_000_000).toFixed(2)}`);
  console.log(`   Treasury (10%):  $${(treasuryFee / 1_000_000).toFixed(2)}`);
  console.log(`   Winner Reward:   $${(winnerReward / 1_000_000).toFixed(2)}`);

  // Check winner's FARTCOIN balance before
  const winningAssetMint = new PublicKey(mints[arena.winningAsset.toString()]);
  const winnerAta = await getAssociatedTokenAddress(winningAssetMint, winner.publicKey);
  const arenaVault = await getAssociatedTokenAddress(winningAssetMint, arenaPda, true);

  let balanceBefore = BigInt(0);
  try {
    const account = await getAccount(connection, winnerAta);
    balanceBefore = account.amount;
  } catch {}

  let vaultBalance = BigInt(0);
  try {
    const vaultAccount = await getAccount(connection, arenaVault);
    vaultBalance = vaultAccount.amount;
  } catch {}

  console.log(`\n📊 TOKEN BALANCES (Before Claim)`);
  console.log("─".repeat(70));
  console.log(`   Winner FARTCOIN: ${(Number(balanceBefore) / 1e9).toFixed(6)}`);
  console.log(`   Arena Vault:     ${(Number(vaultBalance) / 1e9).toFixed(6)}`);

  // Claim reward
  console.log(`\n🎯 CLAIMING REWARD...`);
  console.log("─".repeat(70));

  try {
    const tx = await program.methods
      .claimReward()
      .accountsStrict({
        arena: arenaPda,
        playerEntry: playerEntryPda,
        arenaVault: arenaVault,
        winnerTokenAccount: winnerAta,
        winner: winner.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([winner])
      .rpc();

    console.log(`   ✅ Claimed! TX: ${tx}`);

    // Check balances after
    const accountAfter = await getAccount(connection, winnerAta);
    const balanceAfter = accountAfter.amount;

    let vaultAfter = BigInt(0);
    try {
      const vaultAccountAfter = await getAccount(connection, arenaVault);
      vaultAfter = vaultAccountAfter.amount;
    } catch {}

    console.log(`\n📊 TOKEN BALANCES (After Claim)`);
    console.log("─".repeat(70));
    console.log(`   Winner FARTCOIN: ${(Number(balanceAfter) / 1e9).toFixed(6)}`);
    console.log(`   Arena Vault:     ${(Number(vaultAfter) / 1e9).toFixed(6)}`);
    console.log(`   Tokens Received: ${((Number(balanceAfter) - Number(balanceBefore)) / 1e9).toFixed(6)}`);

    // Verify on-chain
    const playerEntryAfter = await program.account.playerEntry.fetch(playerEntryPda);
    console.log(`\n📦 ON-CHAIN STATE (After Claim)`);
    console.log("─".repeat(70));
    console.log(`   Reward Claimed:  ${playerEntryAfter.rewardClaimed}`);

  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message || error}`);
    console.log(`\n   Full error:`, error.logs || error);
  }

  console.log("\n" + "═".repeat(70));
  console.log("✅ CLAIM COMPLETE!");
  console.log("═".repeat(70) + "\n");
}

main().catch(console.error);
