# Exam Guard

Exam Guard checks whether an exam paper has been tampered with. The official paper's SHA-256 hash is recorded on the Cardano blockchain before the paper goes out, and anyone can later drop a copy into the web page to see if its hash still matches. We built it as Team Pragmatic for the IndiaCodeX'26 Cardano Hackathon.

Live demo: https://exam-guard-omega.vercel.app/

Demo video: https://drive.google.com/file/d/1sXR9mOqK5YMvGcDiGwAs2gK5gdVEfdBQ/view?usp=sharing
Project explanation: https://drive.google.com/file/d/1-dGr4JPrZXWST7tjCecA-65Whl8Ph4X3/view?usp=sharing

## Why

Paper leaks, unauthorised edits and fake question papers are a real problem for colleges, and checking a paper usually means trusting whoever runs the central database. With the hash on a public chain, a matching hash is something anyone can check for themselves.

## How it works

```
Official Exam Paper
        │
        ▼
Generate SHA-256 Hash
        │
        ▼
Store Hash on Cardano Blockchain
        │
        ▼
User uploads paper
        │
        ▼
Generate SHA-256 Again
        │
        ▼
Compare Hashes
        │
        ▼
Authentic   or   Tampered
```

- `hash_check.py` hashes `sample_exam.pdf`, builds a record with the exam name, fingerprint and timestamp, and runs two checks: the real file against its own fingerprint, and the file against a wrong fingerprint.
- `record.json` holds the exam name and fingerprint for the sample paper ("Physics Mid-Sem 2026").
- `push_to_chain.js` reads `record.json` and submits a Cardano preprod transaction (1 ADA back to the wallet's own address) with the fingerprint and exam name in metadata label 674, using Mesh and Blockfrost. It prints the transaction hash and a Cardanoscan link.
- `index.html` is the verification page. It hashes the dropped file in the browser with `crypto.subtle` (nothing is uploaded) and compares it with the sample paper's fingerprint. On a match it links to the preprod transaction on Cardanoscan.

## Running it

```bash
python3 hash_check.py      # needs Python 3.11+ (uses datetime.UTC)

npm install
node push_to_chain.js      # needs secrets.js, see below
```

`push_to_chain.js` expects a `secrets.js` next to it that exports `BLOCKFROST_KEY` and `MNEMONIC` for a preprod wallet. It is in `.gitignore`, so don't commit it. `index.html` is a single static file and can be opened directly or deployed as is (the live demo is on Vercel).

## Files

```
index.html                  verification page
hash_check.py               hashing and local verification
push_to_chain.js            writes the fingerprint to Cardano preprod
record.json                 sample exam record
sample_exam.pdf             sample paper
ExamGuard Presentation.pdf  hackathon presentation
package.json                Mesh and Blockfrost dependencies
```

## Limitations

- The page checks against one sample paper. Its fingerprint and transaction hash are written into `index.html` rather than read from the chain at verify time.
- Everything runs on the preprod testnet.

## Ideas we didn't get to

- Institution dashboard and multi-university support
- QR code verification
- NFT-based certificate authentication
- AI-assisted fraud detection
- Mobile app
- Smart contract automation

## Why Cardano

Low transaction costs and immutable record keeping, which is what a verification record needs.

## Team Pragmatic

- Victor Isaac
- Manasa
- Samhika

For questions, open an issue.
