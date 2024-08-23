import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    TransactionMessage,
    VersionedTransaction,
  } from "@solana/web3.js";
  import bs58 from "bs58";
  import * as dotenv from "dotenv";
  import path from "path";
  import * as multisig from "@sqds/multisig";
  
  dotenv.config();
  
  const RPC = process.env.RPC;
  if (!RPC) {
    throw new Error("RPC is not defined in the .env file");
  }
  const connection = new Connection(RPC, "confirmed");
  
  // Retrieve and decode the private key from the .env file
  const base58PrivateKey = process.env.CREATOR_KEYPAIR;
  if (!base58PrivateKey) {
    throw new Error("CREATOR_KEYPAIR is not defined in the .env file");
  }
  const decodedPrivateKey = bs58.decode(base58PrivateKey);
  const creator = Keypair.fromSecretKey(new Uint8Array(decodedPrivateKey));
  
  const secondMember = Keypair.generate();
  
  // Specify the recipient address here
  const recipientAddress = new PublicKey('ByzxzJLuH9pfe6pnKBDFfFnEPxiPkvppPr4pjbwte9Sx'); // Address to send the SOL
  async function main() {
    const { Permission, Permissions } = multisig.types;
  
    // Derive the multisig account PDA
    const [multisigPda] = multisig.getMultisigPda({
      createKey: creator.publicKey,
    });
  
    // Fetch or create multisigPDA
    try {
      await connection.requestAirdrop(
        secondMember.publicKey,
        1 * LAMPORTS_PER_SOL
      );
    } catch (e) {
      console.log("Airdrop failed");
  
      const tx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: creator.publicKey,
          recentBlockhash: await (
            await connection.getLatestBlockhash()
          ).blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: creator.publicKey,
              toPubkey: secondMember.publicKey,
              lamports: 1_000_000,
            }),
          ],
        }).compileToV0Message()
      );
  
      tx.sign([creator]);
  
      console.log("✨ Sending SOL...");
      await connection.sendTransaction(tx);
      console.log("✅ SOL sent.");
    }
  
    try {
      const programConfigPda = multisig.getProgramConfigPda({})[0];
  
      console.log("✨ Program Config PDA:", programConfigPda.toBase58());
  
      const programConfig =
        await multisig.accounts.ProgramConfig.fromAccountAddress(
          connection,
          programConfigPda
        );
  
      const configTreasury = programConfig.treasury;
  
      console.log("✨ Creating Squad if it doesn't exist...");
      const signature = await multisig.rpc.multisigCreateV2({
        connection,
        createKey: creator,
        creator,
        multisigPda,
        configAuthority: null,
        timeLock: 0,
        members: [
          {
            key: creator.publicKey,
            permissions: Permissions.all(),
          },
          {
            key: secondMember.publicKey,
            permissions: Permissions.fromPermissions([Permission.Vote]),
          },
        ],
        threshold: 2,
        rentCollector: null,
        treasury: configTreasury,
        sendOptions: { skipPreflight: true },
      });
  
      const block = await connection.getLatestBlockhash("confirmed");
      const result = await connection.confirmTransaction(
        {
          signature,
          ...block,
        },
        "confirmed"
      );
  
      const error = result.value.err;
      if (error) {
        throw Error(error.toString());
      }
  
      console.log("✅ Squad Created or Fetched:", signature);
  
      // Get vaultPDA
      const [vaultPda] = multisig.getVaultPda({
        multisigPda,
        index: 0,
      });
  
      // Specify the amount to send in lamports (1 SOL = 1,000,000,000 lamports)
      const amountToSend = 3_000_000; // Lamports0
      // Create a TransactionMessage
      const instruction = SystemProgram.transfer({
        fromPubkey: vaultPda,
        toPubkey: recipientAddress,
        lamports: amountToSend,
      });
  
      const transferMessage = new TransactionMessage({
        payerKey: vaultPda,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: [instruction],
      });
  
      // Get current index and increment
      const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
        connection,
        multisigPda
      );
  
      const currentTransactionIndex = Number(multisigInfo.transactionIndex);
      const newTransactionIndex = BigInt(currentTransactionIndex + 1);
  
      console.log("✨ Creating vault transaction...");
      const vaultTransactionSignature = await multisig.rpc.vaultTransactionCreate({
        connection,
        feePayer: creator,
        multisigPda,
        transactionIndex: newTransactionIndex,
        creator: creator.publicKey,
        vaultIndex: 0,
        ephemeralSigners: 0,
        transactionMessage: transferMessage,
        memo: `Transfer ${amountToSend / LAMPORTS_PER_SOL} SOL to recipient`,
      });
  
      await connection.confirmTransaction(vaultTransactionSignature);
      console.log("✅ Vault Transaction created:", vaultTransactionSignature);
  
      console.log("✨ Creating proposal...");
      const proposalSignature = await multisig.rpc.proposalCreate({
        connection,
        feePayer: creator,
        multisigPda,
        transactionIndex: newTransactionIndex,
        creator,
      });
  
      await connection.confirmTransaction(proposalSignature);
      console.log("✅ Proposal created:", proposalSignature);
    } catch (err: any) { // Ensure err is of type any to handle different types of errors
      throw new Error(err.toString());
    }
  }
  
  main().catch((err) => {
    console.error(err);
  });
  
