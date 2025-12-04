import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;

  const programId = new PublicKey("2LsREShXRB5GMera37czrEKwe5xt9FUnKAjwpW183ce9");

  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_state")],
    programId
  );

  console.log("GlobalState PDA:", globalStatePda.toString());

  const accountInfo = await connection.getAccountInfo(globalStatePda);
  if (accountInfo) {
    console.log("Account exists!");
    console.log("Data length:", accountInfo.data.length);
    console.log("Expected for old GlobalState (treasury): 8 + 32 + 32 + 8 + 8 + 1 + 1 = 90");
    console.log("Expected for new GlobalState (treasury_wallet): 8 + 32 + 32 + 8 + 8 + 1 + 1 = 90");
    console.log("(Same size, but field name changed from treasury to treasury_wallet)");
  } else {
    console.log("Account does not exist");
  }
}
main();
