# AetherOS - Cloudflare Platform Architecture & Deployment Guide

This project is fully architected for the Cloudflare serverless ecosystem:
- **Cloudflare Workers**: High-performance edge API runtime (`worker/index.ts`)
- **Cloudflare Workers Static Assets**: Fast edge delivery for the compiled React frontend (`dist/`)
- **Cloudflare D1 (SQLite)**: Serverless relational database for agents, tasks, conversations, worker leases, nonces, and audit logs (`migrations/0001_initial_schema.sql` .. `migrations/0003_worker_security.sql`)
- **Cloudflare R2**: Zero-egress S3-compatible object storage for file attachments and task output artifacts
- **Kaggle / Self-Hosted Compute Worker (`worker-runtime/aether_worker.py`)**: Outbound-polling GPU inference runtime with Bearer + replay protection

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

### Step 3: Create Cloudflare D1 Database
Create the production D1 database:
```bash
npx wrangler d1 create aetheros-d1-production
```
The command will output your database ID. Open `wrangler.toml` and update the `database_id`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "aetheros-d1-production"
database_id = "<YOUR_D1_DATABASE_ID>"
migrations_dir = "migrations"
```

### Step 4: Apply D1 Database Migrations
Run the D1 migrations (`0001_initial_schema.sql`, `0002_distributed_compute.sql`, and `0003_worker_security.sql`):
```bash
# To Cloudflare production remote:
npm run d1:migrate:remote

# Or for local development emulator:
npm run d1:migrate:local
```

### Step 5: Create Cloudflare R2 Storage Bucket
Create the R2 bucket for file uploads and artifacts:
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
# (If set, pass via X-Registration-Token or Kaggle Secret AETHER_REGISTRATION_TOKEN)
npx wrangler secret put WORKER_REGISTRATION_TOKEN

# Operator secret for credential revocation (/api/workers/:id/revoke)
npx wrangler secret put RUNTIME_API_KEY

# User session / JWT signing key
npx wrangler secret put JWT_SECRET
```

Optional Worker variable in `wrangler.toml`:
- `REQUIRE_WORKER_NONCE = "true"`: Require `X-Worker-Timestamp` (within ±300s) and single-use `X-Worker-Nonce` headers on every authenticated worker request. (`worker-runtime/aether_worker.py` always sends both headers automatically.)

### Step 7: Build and Deploy to Cloudflare
```bash
# Compiles React SPA to ./dist and deploys Worker + Assets
npm run deploy:worker
```

Once completed, Wrangler will output your live URL (e.g. `https://aetheros-agent-platform.<your-subdomain>.workers.dev`).

---

## 3. Connecting a Kaggle Dual-T4 GPU Compute Worker

Kaggle operates strictly as an **outbound-polling compute node** — no inbound ports, ngrok tunnels, or public servers are required on Kaggle.

1. Open [kaggle.com/code](https://www.kaggle.com/code) and import `notebooks/AetherOS_Kaggle_Worker.ipynb` (or copy `worker-runtime/kaggle_single_cell.py` into a cell).
2. In the Kaggle right sidebar under **Notebook options**:
   - Set **Accelerator** to **GPU T4 x2** (32 GB aggregate VRAM).
   - Toggle **Internet** to **Internet On** (requires phone-verified Kaggle account).
3. Optional **Add-ons -> Secrets** in Kaggle:
   - `AETHER_REGISTRATION_TOKEN`: Required if you configured `WORKER_REGISTRATION_TOKEN` on your Cloudflare Worker.
   - `AETHER_WORKER_ID` & `AETHER_WORKER_KEY`: Optional pre-registered worker credentials if you generated a key via the AetherOS UI instead of auto-registering.
   - `AETHER_PLATFORM_URL`: Override if hosting on a custom Workers domain.
4. Click **Run All**. The notebook installs `worker-runtime/requirements.txt`, verifies `/api/health`, authenticates via `Authorization: Bearer <key>` + replay nonces, polls `POST /api/workers/tasks/claim`, executes real PyTorch / HuggingFace `transformers` inference across both T4 GPUs, uploads output artifacts to `/api/workers/tasks/:id/artifacts` (R2), and gracefully calls `POST /api/workers/shutdown` when interrupted.

---

## 4. GitHub Actions CI/CD Deployment

A production-ready GitHub Actions workflow is provided at `cloudflare/deploy-workflow.yml`.

To enable continuous deployment on push to `main`:
1. Move or add `cloudflare/deploy-workflow.yml` into `.github/workflows/deploy.yml` (via GitHub web UI or git with `workflow` PAT scope).
2. Go to your repository **Settings** -> **Secrets and variables** -> **Actions**.
3. Add the following repository secrets:
   - `CLOUDFLARE_API_TOKEN`: Cloudflare API token with `Worker Scripts:Edit`, `D1:Edit`, and `R2 Storage:Edit`.
   - `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID found in the dashboard URL or Workers overview.

Every push to `main` will build the frontend, execute pending D1 migrations, and deploy the Worker automatically.

---

## 5. Local Development & Security Tests

To run the local development server with Vite:
```bash
npm run dev
```

To run the full Cloudflare Worker and D1 local emulation:
```bash
npm run dev:worker
```

To run the security and lifecycle test suites:
```bash
node --test tests/worker-security.test.ts
python3 -m unittest discover -s tests -p "test_*.py" -v
```
