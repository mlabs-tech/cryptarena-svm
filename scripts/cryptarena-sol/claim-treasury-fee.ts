import * as anchor from "@coral-xyz/anchor";
import { Program, BN, Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Program ID for cryptarena-sol
const PROGRAM_ID = new PublicKey("GX4gVWUtVgq6XxL8oHYy6psoN9KFdJhwnds2T3NHe5na");

// Default wallet path (same as other scripts)
const WALLET_PATH = process.env.ANCHOR_WALLET || path.join(os.homedir(), ".config/solana/id.json");

// Account data interfaces
interface GlobalStateData {
  admin: PublicKey;
  treasuryWallet: PublicKey;
  arenaDuration: anchor.BN;
  entryFee: anchor.BN;
  currentArenaId: anchor.BN;
  isPaused: boolean;
  bump: number;
}

interface ArenaData {
  id: anchor.BN;
  status: number;
  playerCount: number;
  winningAsset: number;
  isCanceled: boolean;
  treasuryClaimed: boolean;
  bump: number;
  startTimestamp: anchor.BN;
  endTimestamp: anchor.BN;
  totalPool: anchor.BN;
  tokenSlots: number[];
  playerAddresses: PublicKey[];
}

// Load keypair from file
function loadKeypair(filePath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

// PDA derivation functions
function getGlobalStatePDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("global_state")],
    PROGRAM_ID
  );
}

function getArenaPDA(arenaId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("arena"), arenaId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
}

function getArenaVaultPDA(arenaId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("arena_vault"), arenaId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx ts-node scripts/cryptarena-sol/claim-treasury-fee.ts <arena_id>");
    console.error("Example: npx ts-node scripts/cryptarena-sol/claim-treasury-fee.ts 5");
    process.exit(1);
  }

  const arenaId = parseInt(args[0]);
  if (isNaN(arenaId)) {
    console.error("Error: arena_id must be a number");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("CRYPTARENA-SOL: Claim Treasury Fee");
  console.log("=".repeat(60));
  console.log(`Arena ID: ${arenaId}`);

  // Setup connection
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Load admin wallet
  const adminWallet = loadKeypair(WALLET_PATH);
  console.log(`Admin wallet: ${adminWallet.publicKey.toBase58()}`);

  // Create anchor provider
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(adminWallet),
    { commitment: "confirmed" }
  );

  // Load IDL
  const idlPath = path.join(__dirname, "../../target/idl/cryptarena_sol.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  // Derive PDAs
  const [globalStatePDA] = getGlobalStatePDA();
  const arenaIdBN = new BN(arenaId);
  const [arenaPDA] = getArenaPDA(arenaIdBN);
  const [arenaVaultPDA] = getArenaVaultPDA(arenaIdBN);

  console.log("\nPDAs:");
  console.log(`  Global State: ${globalStatePDA.toBase58()}`);
  console.log(`  Arena: ${arenaPDA.toBase58()}`);
  console.log(`  Arena Vault: ${arenaVaultPDA.toBase58()}`);

  try {
    // Fetch global state to get treasury wallet
    const globalState = await (program.account as any).globalState.fetch(globalStatePDA) as GlobalStateData;
    const treasuryWallet = globalState.treasuryWallet;
    console.log(`\nTreasury Wallet: ${treasuryWallet.toBase58()}`);

    // Fetch arena to check status
    const arena = await (program.account as any).arena.fetch(arenaPDA) as ArenaData;
    console.log(`\nArena Status: ${arena.status}`);
    console.log(`Arena Total Pool: ${Number(arena.totalPool) / LAMPORTS_PER_SOL} SOL`);
    console.log(`Treasury Already Claimed: ${arena.treasuryClaimed}`);

    // ArenaStatus enum: Waiting=1, Active=2, Ended=3, Canceled=4
    if (arena.status !== 3) {
      console.error("\nError: Arena must be in 'Ended' status (3) to claim treasury fee");
      console.error(`Current status: ${arena.status}`);
      process.exit(1);
    }

    if (arena.treasuryClaimed) {
      console.error("\nError: Treasury fee has already been claimed for this arena");
      process.exit(1);
    }

    // Calculate treasury fee (10% of total pool)
    const totalPool = Number(arena.totalPool);
    const treasuryFee = Math.floor((totalPool * 1000) / 10000); // 10%
    console.log(`\nTreasury Fee to Claim: ${treasuryFee / LAMPORTS_PER_SOL} SOL (${treasuryFee} lamports)`);

    // Get vault balance before
    const vaultBalanceBefore = await connection.getBalance(arenaVaultPDA);
    const treasuryBalanceBefore = await connection.getBalance(treasuryWallet);
    console.log(`\nVault Balance Before: ${vaultBalanceBefore / LAMPORTS_PER_SOL} SOL`);
    console.log(`Treasury Balance Before: ${treasuryBalanceBefore / LAMPORTS_PER_SOL} SOL`);

    // Call claim_treasury_fee
    console.log("\nClaiming treasury fee...");
    
    const tx = await program.methods
      .claimTreasuryFee()
      .accounts({
        globalState: globalStatePDA,
        arena: arenaPDA,
        arenaVault: arenaVaultPDA,
        treasuryWallet: treasuryWallet,
        admin: adminWallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([adminWallet])
      .rpc();

    console.log(`\n✅ Treasury fee claimed successfully!`);
    console.log(`Transaction: ${tx}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);

    // Get balances after
    const vaultBalanceAfter = await connection.getBalance(arenaVaultPDA);
    const treasuryBalanceAfter = await connection.getBalance(treasuryWallet);
    console.log(`\nVault Balance After: ${vaultBalanceAfter / LAMPORTS_PER_SOL} SOL`);
    console.log(`Treasury Balance After: ${treasuryBalanceAfter / LAMPORTS_PER_SOL} SOL`);
    console.log(`\nTreasury Received: ${(treasuryBalanceAfter - treasuryBalanceBefore) / LAMPORTS_PER_SOL} SOL`);

  } catch (error) {
    console.error("\n❌ Error claiming treasury fee:", error);
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
}

main().catch(console.error);

