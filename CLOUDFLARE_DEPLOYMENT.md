# AetherOS — Cloudflare Platform Architecture & Deployment Guide

This project is architected for the Cloudflare serverless ecosystem paired with distributed GPU compute nodes:
- **Cloudflare Workers**: High-performance edge API runtime (`worker/index.ts`) with strict security headers, rate limiting, WebAuthn FIDO2 passkey verification, and RFC 6238 TOTP authentication.
- **Cloudflare Workers Static Assets**: Fast edge delivery for the compiled React frontend (`dist/`).
- **Cloudflare D1 (SQLite)**: Authoritative relational database for users, passkeys, TOTP secrets, workspaces, agents, capability-scheduled tasks, worker leases, nonces, rate-limit buckets, and security audit events (`migrations/0001_initial_schema.sql` .. `migrations/0005_operational_platform_hardening.sql`).
- **Cloudflare R2**: Zero-egress S3-compatible object storage for workspace files, generated code/image/video/storyboard/screenplay artifacts, and defensive security audit reports (`worker/r2.ts`).
- **Kaggle T4×2 / Self-Hosted GPU Compute Worker (`worker-runtime/aether_worker.py`)**: Outbound-polling multi-GPU inference runtime with per-GPU hardware discovery, model availability reporting, Bearer + replay nonce protection, and capability-aware task execution.

---

## 1. Prerequisites

- [Node.js](https://nodejs.org) (v20 or v22)
- Cloudflare Account ([dash.cloudflare.com](https://dash.cloudflare.com))
- Cloudflare API Token with Workers, D1, and R2 permissions

---

## 2. Quickstart Deployment

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Log in to Cloudflare Wrangler
```bash
npx wrangler login
```

### Step 3: Create or Verify Cloudflare D1 Database
```bash
npx wrangler d1 create aetheros-d1-production
```
Ensure `wrangler.toml` has your D1 binding:
```toml
[[d1_databases]]
binding = "DB"
database_name = "aetheros-d1-production"
database_id = "be33e62f-e923-4ef8-aa84-d0efbbbcac84"
migrations_dir = "migrations"
```

### Step 4: Apply D1 Database Migrations (`0001` through `0005`)
Run all five D1 migrations (`0001_initial_schema.sql` through `0005_operational_platform_hardening.sql`):
```bash
# To Cloudflare production remote:
npm run d1:migrate:remote

# Or for local development emulator:
npm run d1:migrate:local
```

### Step 5: Create Cloudflare R2 Storage Bucket
```bash
npm run r2:create
# Or: npx wrangler r2 bucket create aetheros-agent-files
```

### Step 6: Configure Cloudflare Worker Secrets
Store your secrets securely in Cloudflare (never in Git or frontend code):
```bash
# Cryptographic HMAC pepper for hashing worker API keys in D1
npx wrangler secret put WORKER_AUTH_PEPPER

# Optional enrollment secret required on POST /api/workers/register
npx wrangler secret put WORKER_REGISTRATION_TOKEN

# Operator secret for credential revocation (/api/workers/:id/revoke)
npx wrangler secret put RUNTIME_API_KEY

# Master encryption & session secret (used for AES-GCM-256 TOTP & Kaggle key encryption)
npx wrangler secret put JWT_SECRET
```

### Step 7: Build and Deploy to Cloudflare
```bash
# Compiles React SPA to ./dist and deploys Worker + Assets
npm run deploy:worker
```

---

## 3. Connecting a Kaggle Dual-T4 GPU Compute Worker

Kaggle operates strictly as an **outbound-polling compute node** — no inbound ports or public tunnels are required on Kaggle.

1. Open [kaggle.com/code](https://www.kaggle.com/code) and import `notebooks/AetherOS_Kaggle_Worker.ipynb` (or copy `worker-runtime/kaggle_single_cell.py` into a cell).
2. In the Kaggle right sidebar under **Notebook options**:
   - Set **Accelerator** to **GPU T4 x2** (32 GB aggregate VRAM across `cuda:0` and `cuda:1`).
   - Toggle **Internet** to **Internet On**.
3. Optional **Add-ons -> Secrets** in Kaggle:
   - `AETHER_REGISTRATION_TOKEN`: Required if you configured `WORKER_REGISTRATION_TOKEN` on your Cloudflare Worker.
   - `AETHER_WORKER_ID` & `AETHER_WORKER_KEY`: Pre-registered worker credentials (such as `wrk_kaggle_464cc6bdb46da70260a1e849`).
   - `AETHER_PLATFORM_URL`: Your deployed Cloudflare Worker URL (e.g. `https://aetheros.cc.cd`).
4. Click **Run All**. The worker discovers both T4 GPUs (`gpu_devices`), reports individual GPU VRAM and `loaded_models`, authenticates with `Authorization: Bearer <key>` + replay nonces, claims only tasks whose VRAM/GPU/capability requirements it satisfies (`POST /api/workers/tasks/claim`), uploads artifacts to R2 (`POST /api/workers/tasks/:id/artifacts`), and reports verified outputs (`POST /api/workers/tasks/:id/result`).

---

## 4. Defensive Cybersecurity Agent (`agent_cybersec` / Aegis-0)

AetherOS includes a built-in, strictly defensive Cybersecurity Specialist (`agent_cybersec` / `/api/security/assess`) supporting:
- **HTTP Security-Header & Cookie Flag Analysis** (`Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `HttpOnly`/`Secure`/`SameSite`).
- **TLS & Transport Posture Verification**.
- **DNS Security Checks** (SPF, DMARC, CAA via Cloudflare DNS-over-HTTPS).
- **Dependency Vulnerability Auditing** (`package.json` CVE & unpinned range detection).
- **Static Source-Code & Configuration Auditing** (hardcoded credentials, `eval`, command injection, SQL concatenation, XSS sinks).
- **Structured Reporting**: Distinguishes `verified_finding` from `unverified_indicator` and archives Markdown + JSON reports directly in Cloudflare R2.

---

## 5. Verification & Automated Testing

```bash
# Run TypeScript typecheck
npm run lint

# Build production bundle
npm run build

# Run Node/D1/R2/WebAuthn/Scheduler/Cybersecurity test suite
npm test

# Run Python worker runtime unit tests
python3 -m unittest discover -s tests -p "test_*.py" -v
```
