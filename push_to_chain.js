const { MeshWallet, Transaction, BlockfrostProvider } = require("@meshsdk/core");
const fs = require("fs");

const { BLOCKFROST_KEY, MNEMONIC } = require("./secrets");



async function main() {
  const record = JSON.parse(fs.readFileSync("record.json", "utf-8"));
  const fingerprint = record.fingerprint;
  console.log("Fingerprint to push:", fingerprint);

  const blockchainProvider = new BlockfrostProvider(BLOCKFROST_KEY);

  const wallet = new MeshWallet({
    networkId: 0,
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
    key: {
      type: "mnemonic",
      words: MNEMONIC,
    },
  });

  await wallet.init();

  const tx = new Transaction({ initiator: wallet });
  tx.sendLovelace(
    { address: await wallet.getChangeAddress() },
    "1000000"
  );
  tx.setMetadata(674, { fingerprint: fingerprint, exam: record.exam_name });

  const unsignedTx = await tx.build();
  const signedTx = await wallet.signTx(unsignedTx);
  const txHash = await wallet.submitTx(signedTx);

  console.log("SUCCESS. Transaction hash:", txHash);
  console.log("View it at: https://preprod.cardanoscan.io/transaction/" + txHash);
}

main().catch(console.error);
