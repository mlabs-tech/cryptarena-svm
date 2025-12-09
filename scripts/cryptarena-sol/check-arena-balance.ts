import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("GX4gVWUtVgq6XxL8oHYy6psoN9KFdJhwnds2T3NHe5na");

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx ts-node scripts/cryptarena-sol/check-arena-balance.ts <arena_id>");
    console.error("Example: npx ts-node scripts/cryptarena-sol/check-arena-balance.ts 5");
    process.exit(1);
  }

  const arenaId = parseInt(args[0]);
  if (isNaN(arenaId)) {
    console.error("Error: arena_id must be a number");
    process.exit(1);
  }

  // Derive arena vault PDA
  const arenaIdBuffer = Buffer.alloc(8);
  arenaIdBuffer.writeBigUInt64LE(BigInt(arenaId));
  const [arenaVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena_vault"), arenaIdBuffer],
    PROGRAM_ID
  );

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const balance = await connection.getBalance(arenaVaultPDA);
  
  console.log("=".repeat(50));
  console.log("Arena Pool Balance Check");
  console.log("=".repeat(50));
  console.log(`Arena ID:        ${arenaId}`);
  console.log(`Arena Vault PDA: ${arenaVaultPDA.toBase58()}`);
  console.log(`Balance:         ${balance / LAMPORTS_PER_SOL} SOL`);
  console.log(`Balance:         ${balance} lamports`);
  console.log("=".repeat(50));
}

main().catch(console.error);

