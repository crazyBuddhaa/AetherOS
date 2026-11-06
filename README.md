# AetherOS — Distributed AI Agent & Multimodal Compute Platform

AetherOS is an operational distributed AI agent, creative studio, and defensive cybersecurity platform powered by **Cloudflare Workers**, **Cloudflare D1 (SQLite)**, **Cloudflare R2 Object Storage**, and **Kaggle T4×2 / Self-Hosted GPU Compute Workers**.

---

## Core Architecture

1. **Passwordless Security & Onboarding (`worker/auth.ts`, `worker/index.ts`, `server.ts`)**
   - WebAuthn FIDO2 Passkey registration & authentication with cryptographic challenge validation (`clientDataJSON`, CBOR `attestationObject`, RP ID hash, user presence flag, COSE P-256/RS256 public key extraction, and monotonic `signCount` replay protection).
   - RFC 6238 TOTP two-factor / alternative authentication encrypted at rest via AES-GCM-256.
   - Strict 4-attempt challenge lockout, sliding-window rate limiting (`auth_rate_limits`), `HttpOnly; SameSite=Lax; Secure` session cookies, and non-bypassable account activation.

2. **Cloudflare Infrastructure (`wrangler.toml`, `migrations/0001..0005`)**
   - **Cloudflare Workers**: Authoritative edge API backend (`worker/index.ts`).
   - **Cloudflare D1**: Persistent relational database (`worker/db.ts`) storing accounts, workspaces, agents, 8-category model registry, tasks, steps, worker leases, nonces, and security audit logs.
   - **Cloudflare R2**: Artifact & file storage (`worker/r2.ts`) with 50 MB upload validation, path traversal prevention, and D1 metadata indexing.
   - **Real Health Probing (`/api/health`)**: Executes live `SELECT 1` D1 queries and `FILES_BUCKET.list({ limit: 1 })` R2 probes along with real worker heartbeat inspection.

3. **Kaggle T4×2 Distributed Compute & Capability-Aware Scheduler (`worker-runtime/aether_worker.py`, `worker/db.ts`)**
   - Detects individual GPUs (`gpu_devices` array with per-GPU VRAM total/used/free), system RAM, `loaded_models`, and supported capabilities (`coding`, `text`, `vision`, `image`, `image_processing`, `video`, `speech`, `embedding`, `specialized`).
   - **Capability-Aware Scheduling**: `claimTaskForWorker` verifies that a worker satisfies `require_gpu`, `min_gpu_count`, `min_vram_mb`, `min_system_ram_mb`, `required_capability`, and `loaded_models` before assigning a task.
   - **Reliable Task Lifecycle**: `queued` → `assigned` → `downloading` / `loading_model` / `running` / `uploading` / `processing_result` → `completed` (or `retrying` / `failed` / `cancelled`), with idempotency key deduplication (`idempotency_key`) and non-empty result payload validation.

4. **Modular Studio Workspaces (`src/components/workspaces/`)**
   - **Code Generation Studio**: Dispatches real tasks to `agent_code_architect` (`qwen-2.5-coder-14b`), tracks live task state, and persists source artifacts to Cloudflare R2.
   - **Image Generation Studio**: Dispatches diffusion tasks (`sdxl-lightning`, `sd-1.5-standard`, `real-esrgan-4x`, `birefnet-bg-removal`) to `agent_visual_synth` and syncs R2 plates.
   - **Video Generation Studio**: Dispatches temporal motion tasks (`animatediff-motion-v3`) to `agent_motion_studio` and exports sequence manifests to R2.
   - **Storyboard & Continuity Studio**: Sequential shot continuity inspector with GPU shot-plate rendering (`agent_storyboard`) and R2 JSON export.
   - **Screenwriter Studio**: Fountain screenplay authoring with GPU dramaturg beat synthesis (`agent_screenwriter`) and `.fountain` R2 export.

5. **Defensive Cybersecurity Specialist (`agent_cybersec` / `worker/cybersecurity.ts`)**
   - Requires explicit operator authorization (`authorization_confirmed: true`) and enforces SSRF protection against private, loopback, and cloud metadata IPs.
   - Performs read-only HTTP security-header analysis, TLS transport checks, DNS SPF/DMARC/CAA verification via Cloudflare DoH, dependency vulnerability auditing (`package.json`), and static source-code / configuration security scanning.
   - Clearly separates `verified_finding` from `unverified_indicator` and archives Markdown + JSON reports in Cloudflare R2.

---

## Development & Verification Commands

```bash
# Install dependencies
npm install

# Run local Express + Vite development server (with disk persistence in .data/)
npm run dev

# Run Cloudflare Worker + D1 local emulator
npm run dev:worker

# Run TypeScript compiler verification
npm run lint

# Build production bundle
npm run build

# Run automated verification suite (Node + SQLite D1 + R2 + WebAuthn + Scheduler + Cybersecurity)
npm test

# Run Python GPU worker runtime unit tests
python3 -m unittest discover -s tests -p "test_*.py" -v
```

See [CLOUDFLARE_DEPLOYMENT.md](./CLOUDFLARE_DEPLOYMENT.md) for step-by-step Cloudflare D1, R2, Worker secret, and Kaggle T4×2 setup instructions.
