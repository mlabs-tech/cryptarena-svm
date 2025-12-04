import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CryptarenaSvmTest } from "../target/types/cryptarena_svm_test";
import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  
  const program = anchor.workspace.CryptarenaSvmTest as Program<CryptarenaSvmTest>;
  const admin = (provider.wallet as any).payer as Keypair;

  const walletDir = path.join(__dirname, "../test-wallets");
  const player1Key = JSON.parse(fs.readFileSync(path.join(walletDir, "player1.json"), "utf-8"));
  const player1 = Keypair.fromSecretKey(Uint8Array.from(player1Key));

  const mints = JSON.parse(fs.readFileSync(path.join(walletDir, "token-mints.json"), "utf-8"));
  const mint = new PublicKey(mints["0"]); // SOL token

  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state")],
    program.programId
  );

  console.log("Fetching global state...");
  const globalState = await program.account.globalState.fetch(globalStatePda);
  console.log("Current Arena ID:", globalState.currentArenaId.toString());

  const [arenaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("arena"), globalState.currentArenaId.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  console.log("Arena PDA:", arenaPda.toString());

  const [playerEntryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("player_entry"), arenaPda.toBuffer(), player1.publicKey.toBuffer()],
    program.programId
  );
  console.log("Player Entry PDA:", playerEntryPda.toString());

  const playerAta = await getAssociatedTokenAddress(mint, player1.publicKey);
  const arenaVault = await getAssociatedTokenAddress(mint, arenaPda, true);

  const tokenAccount = await getAccount(connection, playerAta);
  console.log("Player token balance:", Number(tokenAccount.amount) / 1e9);

  const tokenAmount = new anchor.BN(Number(tokenAccount.amount) / 10);
  const usdValue = new anchor.BN(15_000_000);

  console.log("\nTrying to enter arena...");
  
  try {
    const tx = new Transaction();
    
    // Create arena vault if needed
    try {
      await getAccount(connection, arenaVault);
      console.log("Arena vault exists");
    } catch {
      console.log("Creating arena vault...");
      tx.add(createAssociatedTokenAccountInstruction(admin.publicKey, arenaVault, arenaPda, mint));
    }

    const enterIx = await program.methods
      .enterArena(0, tokenAmount, usdValue)
      .accountsStrict({
        globalState: globalStatePda,
        arena: arenaPda,
        playerEntry: playerEntryPda,
        playerTokenAccount: playerAta,
        arenaVault: arenaVault,
        player: player1.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player1])
      .instruction();
    
    tx.add(enterIx);

    const sig = await sendAndConfirmTransaction(connection, tx, [admin, player1], {
      skipPreflight: false,
    });
    
    console.log("SUCCESS! TX:", sig);
  } catch (error: any) {
    console.log("\nERROR:", error.message);
    if (error.logs) {
      console.log("\nLogs:");
      error.logs.forEach((log: string) => console.log("  ", log));
    }
  }
}
main();
