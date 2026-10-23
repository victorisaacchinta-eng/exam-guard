<div align="center">

# 🛡️ Exam Guard

### Secure • Verify • Trust

**A Cardano-powered blockchain solution for tamper-proof examination paper verification.**

[![Cardano](https://img.shields.io/badge/Built%20on-Cardano-0033AD?style=for-the-badge&logo=cardano&logoColor=white)](https://cardano.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6-yellow?style=for-the-badge&logo=javascript)](https://developer.mozilla.org/)
[![Python](https://img.shields.io/badge/Python-3.x-blue?style=for-the-badge&logo=python)](https://python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-Mesh_%2B_Blockfrost-green?style=for-the-badge&logo=node.js)](https://nodejs.org/)

### 🌐 Live Demo
https://exam-guard-omega.vercel.app/

### 🎥 Demo Video
**Google Drive:** https://drive.google.com/file/d/1sXR9mOqK5YMvGcDiGwAs2gK5gdVEfdBQ/view?usp=sharing
project explanation: https://drive.google.com/file/d/1-dGr4JPrZXWST7tjCecA-65Whl8Ph4X3/view?usp=sharing

</div>

---

# 📖 Overview

**Exam Guard** is a blockchain-based verification platform designed to eliminate examination paper tampering.

Instead of trusting a centralized database, every official examination paper is converted into a **SHA-256 cryptographic hash** and permanently recorded on the **Cardano Blockchain**.

Whenever someone wants to verify an examination paper, Exam Guard generates a new hash from the uploaded file and compares it with the immutable blockchain record.

If both hashes match:

> ✅ The document is authentic.

Otherwise:

> ❌ The document has been altered.

---

# ❗ Problem Statement

Educational institutions continuously struggle with:

- Examination paper leaks
- Unauthorized modifications
- Fake question papers
- Lack of transparent verification
- Centralized systems vulnerable to manipulation

Current verification systems rely on trust.

Exam Guard replaces trust with **cryptographic proof.**

---

# 💡 Our Solution

Exam Guard uses the immutability of the **Cardano Blockchain** as the trusted record for verification.

### Workflow

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
Authentic ✅   or   Tampered ❌
```

---

# ✨ Features

- 🔒 SHA-256 Document Hashing
- ⛓️ Cardano Blockchain Integration
- 📄 PDF Verification
- ⚡ Instant Authenticity Check
- 🌐 Clean Web Interface
- 🛡️ Immutable Proof of Integrity
- 📚 Educational Institution Ready

---

# 🏗️ Project Architecture

```
                  User
                    │
                    ▼
             Upload Exam PDF
                    │
                    ▼
             SHA-256 Generator
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
 Cardano Blockchain      Uploaded PDF
 Stored Hash             Generated Hash
        │                       │
        └───────────┬───────────┘
                    ▼
             Verification Engine
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
     Authentic ✅         Tampered ❌
```

---

# ⚙️ Tech Stack

| Technology | Purpose |
|------------|---------|
| HTML | Frontend UI |
| JavaScript | Client Logic |
| Python | Hash Verification |
| Node.js | Cardano transaction script (`push_to_chain.js`) |
| SHA-256 | Cryptographic Hashing |
| Cardano | Immutable Storage |
| Vercel | Deployment |

---

# 📂 Repository Structure

```
Exam Guard
│
├── index.html
├── hash_check.py
├── push_to_chain.js
├── package.json
├── sample_exam.pdf
├── record.json
└── README.md
```

---

# 🚀 How It Works

### Step 1

Upload the official examination paper.

### Step 2

Generate its SHA-256 hash.

### Step 3

Store the hash securely on Cardano.

### Step 4

Later, upload another version of the paper.

### Step 5

Generate a new SHA-256 hash.

### Step 6

Compare both hashes.

Matching hashes indicate authenticity.

---

# 🌍 Future Scope

- Institution Dashboard
- Multi-University Support
- QR Code Verification
- NFT-based Certificate Authentication
- AI-assisted Fraud Detection
- Mobile Application
- Smart Contract Automation

---

# 👥 Team Pragmatic

**Members**

- Victor Isaac
- Manasa
- Samhika

---

# 🏆 Built For

**IndiaCodeX'26 Cardano Hackathon**

Developed to demonstrate how blockchain technology can improve trust, transparency, and integrity in educational systems.

---

# ❤️ Why Cardano?

Cardano was selected because it provides:

- Secure blockchain infrastructure
- Immutable record keeping
- Low transaction costs
- High reliability
- Sustainability
- Strong academic research foundation
- Enterprise-grade decentralization

These qualities make Cardano an ideal platform for storing tamper-proof verification records.

---

# 📬 Contact

For questions or collaboration, please open an issue in this repository.

---

<div align="center">

## ⭐ If you like this project, consider giving it a star!

**Building trust in education through blockchain technology.**

🛡️ **Exam Guard**

</div>
