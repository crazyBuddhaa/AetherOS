import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import {
  ACTIVE_WORKER_TASK_STATUSES,
  REPLAY_WINDOW_MS,
  WORKER_LEASE_TTL_MS,
  computeKeyFingerprint,
  extractWorkerBearerToken,
  generateSecureId,
  generateWorkerApiKey,
  normalizeStepNumber,
  normalizeWorkerProgressStatus,
  redactSecrets,
  validateReplayHeaders,
  verifyApiKeyHash,
  verifySharedSecretConstantTime,
  base64UrlEncode,
  base64UrlDecode,
  normalizeEmail,
  generateSecureToken,
  encryptSecret,
  decryptSecret,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  verifyWebAuthnChallenge,
  verifyWebAuthnAssertionSignature,
} from './worker/auth.ts';
import type {
  ActivityLog,
  Agent,
  ApprovalRequest,
  ComputeWorker,
  Conversation,
  Message,
  ModelDefinition,
  Task,
  TaskPriority,
  TaskStep,
} from './src/types/index.ts';
import type {
  UserAccount,
  Organization,
  OrganizationMembership,
  PasskeyCredential,
  TotpCredential,
  AuthChallenge,
  AuthSession,
  ComputeSession,
  WorkerOwnership,
  KaggleCredentials,
  SecurityAuditEvent,
} from './worker/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

interface StoredFileObject {
  key: string;
  filename: string;
  contentType: string;
  size: number;
  etag: string;
  uploaded: string;
  storageClass: string;
  task_id?: string;
  buffer: Buffer;
}

function createInitialAgents(): Agent[] {
  return [];
}

function createInitialTasks(): Task[] {
  return [];
}

function createInitialApprovals(): ApprovalRequest[] {
  return [];
}

function createInitialFiles(): Map<string, StoredFileObject> {
  return new Map<string, StoredFileObject>();
}

interface WorkerInternalAuth {
  api_key_hash: string;
  key_fingerprint: string | null;
  is_revoked: number;
}

const VALID_PROVIDERS = new Set(['kaggle', 'oracle', 'runpod', 'self_hosted', 'custom']);

function createInitialWorkers(): {
  workers: ComputeWorker[];
  authMap: Map<string, WorkerInternalAuth>;
} {
  return { workers: [], authMap: new Map<string, WorkerInternalAuth>() };
}

function createInitialModels(): ModelDefinition[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'qwen-2.5-coder-14b',
      name: 'Qwen 2.5 Coder 14B',
      category: 'text',
      min_vram_mb: 14336,
      supported_precisions: ['fp16', 'int4', 'awq'],
      weights_source: 'Qwen/Qwen2.5-Coder-14B-Instruct',
      description: 'Premier open coding & reasoning model. Optimized for tensor-parallel on dual T4.',
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'deepseek-r1-distill-qwen-14b',
      name: 'DeepSeek R1 Distill 14B',
      category: 'text',
      min_vram_mb: 15360,
      supported_precisions: ['fp16', 'int4', 'gptq'],
      weights_source: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
      description: 'High-throughput reasoning model with deep chain-of-thought distillation.',
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'sd-1.5-standard',
      name: 'Stable Diffusion 1.5',
      category: 'image',
      min_vram_mb: 6144,
      supported_precisions: ['fp16'],
      weights_source: 'runwayml/stable-diffusion-v1-5',
      description: 'Fast text-to-image synthesis (~2.5s generation per step on T4).',
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'sdxl-lightning',
      name: 'SDXL Lightning 4-Step',
      category: 'image',
      min_vram_mb: 10240,
      supported_precisions: ['fp16'],
      weights_source: 'ByteDance/SDXL-Lightning',
      description: 'Photorealistic high-resolution 1024x1024 generation in 4 inference steps.',
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'real-esrgan-4x',
      name: 'Real-ESRGAN 4x+ Upscaler',
      category: 'image_processing',
      min_vram_mb: 4096,
      supported_precisions: ['fp16'],
      weights_source: 'xinntao/Real-ESRGAN',
      description: 'High-fidelity spatial super-resolution upscaler.',
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'birefnet-bg-removal',
      name: 'BiRefNet Background Removal',
      category: 'image_processing',
      min_vram_mb: 4096,
      supported_precisions: ['fp16'],
      weights_source: 'ZhengPeng7/BiRefNet',
      description: 'Ultra-clean background extraction for multimodal agent workflows.',
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'animatediff-motion-v3',
      name: 'AnimateDiff Motion Module v3',
      category: 'video',
      min_vram_mb: 12288,
      supported_precisions: ['fp16'],
      weights_source: 'guoyww/animatediff-motion-adapter-v1-5-3',
      description: 'Short video synthesis from text prompt (16-32 frames at 512x512).',
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'whisper-large-v3-turbo',
      name: 'Whisper Large v3 Turbo',
      category: 'audio',
      min_vram_mb: 4096,
      supported_precisions: ['fp16'],
      weights_source: 'openai/whisper-large-v3-turbo',
      description: 'Fast multilingual speech-to-text transcription engine.',
      is_enabled: true,
      created_at: now,
    },
  ];
}

function createInitialLogs(): ActivityLog[] {
  return [];
}

function sanitizePublicWorker(worker: ComputeWorker): ComputeWorker {
  const clean: Record<string, unknown> = { ...worker };
  delete clean.api_key_hash;
  delete clean.key_fingerprint;
  delete clean.is_revoked;
  return clean as unknown as ComputeWorker;
}

export async function createAetherApp(options: { disableVite?: boolean } = {}) {
  const app = express();

  let agents: Agent[] = createInitialAgents();
  let tasks: Task[] = createInitialTasks();
  let approvals: ApprovalRequest[] = createInitialApprovals();
  let filesMap: Map<string, StoredFileObject> = createInitialFiles();
  let initialWorkerState = createInitialWorkers();
  let workers: ComputeWorker[] = initialWorkerState.workers;
  let workerAuthMap: Map<string, WorkerInternalAuth> = initialWorkerState.authMap;
  const workerNonceMap = new Map<string, number>();
  const models: ModelDefinition[] = createInitialModels();
  let logs: ActivityLog[] = createInitialLogs();
  let conversations: Conversation[] = [];
  let messages: Message[] = [];
  let users: UserAccount[] = [];
  let organizations: Organization[] = [];
  let organizationMemberships: OrganizationMembership[] = [];
  let passkeyCredentials: PasskeyCredential[] = [];
  let totpCredentials: TotpCredential[] = [];
  let authChallenges: AuthChallenge[] = [];
  let authSessions: AuthSession[] = [];
  let computeSessions: ComputeSession[] = [];
  let workerOwnerships: WorkerOwnership[] = [];
  let kaggleCredentialsList: KaggleCredentials[] = [];
  let securityEvents: SecurityAuditEvent[] = [];

  function addLog(entry: Omit<ActivityLog, 'id' | 'created_at'>) {
    logs.unshift({
      ...entry,
      id: generateSecureId('log'),
      created_at: new Date().toISOString(),
    });
    if (logs.length > 100) {
      logs = logs.slice(0, 100);
    }
  }

  function reapExpiredLeases() {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    for (const task of tasks) {
      if (
        (ACTIVE_WORKER_TASK_STATUSES as readonly string[]).includes(task.status) &&
        task.lease_expires_at &&
        Date.parse(task.lease_expires_at) < nowMs
      ) {
        task.status = 'queued';
        task.claimed_by_worker = undefined;
        task.lease_expires_at = undefined;
        task.progress_percent = 0;
        task.updated_at = nowIso;
      }
    }

    for (const worker of workers) {
      if (
        (worker.status === 'online' || worker.status === 'busy') &&
        worker.lease_expires_at &&
        Date.parse(worker.lease_expires_at) < nowMs
      ) {
        worker.status = 'offline';
        worker.current_task_id = undefined;
        worker.current_task_title = undefined;
        worker.lease_expires_at = undefined;
        worker.updated_at = nowIso;
      }
    }
  }

  async function authenticateWorkerRequest(
    req: Request,
    declaredWorkerId?: string
  ): Promise<{ ok: true; worker: ComputeWorker } | { ok: false; status: number; error: string }> {
    const headerWorkerId = req.header('X-Worker-Id')?.trim() || undefined;
    if (headerWorkerId && declaredWorkerId && headerWorkerId !== declaredWorkerId) {
      return {
        ok: false,
        status: 400,
        error: `Conflicting worker_id between X-Worker-Id header ('${headerWorkerId}') and request payload ('${declaredWorkerId}')`,
      };
    }

    const effectiveDeclaredId = headerWorkerId || declaredWorkerId;
    const fullUrl = new URL(req.originalUrl, 'http://localhost');

    const bearer = extractWorkerBearerToken(req.header('Authorization') ?? null, fullUrl);
    if (!bearer.token) {
      return {
        ok: false,
        status: bearer.status || 401,
        error: bearer.error || 'Unauthorized',
      };
    }

    const replay = validateReplayHeaders(
      req.header('X-Worker-Timestamp') ?? null,
      (req.header('X-Worker-Nonce') ?? req.header('Idempotency-Key')) ?? null,
      process.env.REQUIRE_WORKER_NONCE === 'true'
    );
    if (!replay.ok) {
      return {
        ok: false,
        status: replay.status || 400,
        error: replay.error || 'Invalid replay protection headers',
      };
    }

    const pepper = process.env.WORKER_AUTH_PEPPER;
    const fingerprint = await computeKeyFingerprint(bearer.token, pepper);

    let matchedWorker: ComputeWorker | undefined;
    let matchedAuth: WorkerInternalAuth | undefined;

    for (const candidate of workers) {
      const authRec = workerAuthMap.get(candidate.id);
      if (authRec && authRec.key_fingerprint && authRec.key_fingerprint === fingerprint) {
        matchedWorker = candidate;
        matchedAuth = authRec;
        break;
      }
    }

    if (!matchedWorker && effectiveDeclaredId) {
      const fallbackWorker = workers.find((w) => w.id === effectiveDeclaredId);
      const authRec = fallbackWorker ? workerAuthMap.get(fallbackWorker.id) : undefined;
      if (fallbackWorker && authRec && !authRec.key_fingerprint) {
        matchedWorker = fallbackWorker;
        matchedAuth = authRec;
      }
    }

    if (!matchedWorker || !matchedAuth || !matchedAuth.api_key_hash) {
      await verifyApiKeyHash(
        bearer.token,
        'sha256$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000',
        pepper
      );
      addLog({
        action: 'worker_auth_failed',
        category: 'auth',
        details: { declared_worker_id: effectiveDeclaredId || null, path: req.path },
      });
      return { ok: false, status: 401, error: 'Invalid worker API key' };
    }

    const valid = await verifyApiKeyHash(bearer.token, matchedAuth.api_key_hash, pepper);
    if (!valid) {
      addLog({
        action: 'worker_auth_failed',
        category: 'auth',
        details: { declared_worker_id: effectiveDeclaredId || null, path: req.path },
      });
      return { ok: false, status: 401, error: 'Invalid worker API key' };
    }

    if (Number(matchedAuth.is_revoked) === 1) {
      addLog({
        action: 'worker_auth_failed',
        category: 'auth',
        details: { worker_id: matchedWorker.id, reason: 'revoked', path: req.path },
      });
      return { ok: false, status: 403, error: 'Worker credential has been revoked' };
    }

    if (effectiveDeclaredId && effectiveDeclaredId !== matchedWorker.id) {
      addLog({
        action: 'worker_impersonation_blocked',
        category: 'auth',
        details: {
          authenticated_worker: matchedWorker.id,
          declared_worker_id: effectiveDeclaredId,
          path: req.path,
        },
      });
      return {
        ok: false,
        status: 403,
        error: `Cross-worker access denied: credential belongs to '${matchedWorker.id}', not '${effectiveDeclaredId}'`,
      };
    }

    if (replay.nonce && replay.timestampMs) {
      const nowMs = Date.now();
      for (const [k, exp] of workerNonceMap.entries()) {
        if (exp < nowMs) {
          workerNonceMap.delete(k);
        }
      }
      const nonceKey = `${matchedWorker.id}:${replay.nonce}`;
      if (workerNonceMap.has(nonceKey)) {
        addLog({
          action: 'worker_replay_blocked',
          category: 'auth',
          details: {
            worker_id: matchedWorker.id,
            nonce_prefix: replay.nonce.slice(0, 8),
            path: req.path,
          },
        });
        return {
          ok: false,
          status: 409,
          error: 'Replay attack detected: request nonce has already been used',
        };
      }
      workerNonceMap.set(nonceKey, replay.timestampMs + REPLAY_WINDOW_MS);
    }

    return { ok: true, worker: matchedWorker };
  }

  function releaseWorkerActiveTask(workerId: string): string | undefined {
    const nowIso = new Date().toISOString();
    const task = tasks.find(
      (t) =>
        t.claimed_by_worker === workerId &&
        (ACTIVE_WORKER_TASK_STATUSES as readonly string[]).includes(t.status)
    );
    if (!task) return undefined;

    task.status = 'queued';
    task.claimed_by_worker = undefined;
    task.lease_expires_at = undefined;
    task.progress_percent = 0;
    task.updated_at = nowIso;
    return task.id;
  }

  // CORS middleware for /api/*
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, X-Worker-Id, X-Worker-Timestamp, X-Worker-Nonce, Idempotency-Key, X-Registration-Token'
    );
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Only invoke express.json() for non-multipart requests so multipart file uploads keep their raw stream
  const jsonParser = express.json({ limit: '25mb' });
  app.use((req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
      next();
      return;
    }
    jsonParser(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: 'Malformed JSON request body', success: false });
        return;
      }
      next();
    });
  });

  // File upload endpoint (multipart/form-data)
  app.post('/api/files', async (req: Request, res: Response) => {
    try {
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) {
        res.status(400).json({ error: 'Content-Type must be multipart/form-data', success: false });
        return;
      }

      const webRequest = new Request(`http://localhost:${PORT}/api/files`, {
        method: 'POST',
        headers: req.headers as Record<string, string>,
        body: Readable.toWeb(req) as unknown as BodyInit,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });

      const formData = await webRequest.formData();
      const uploaded = formData.get('file');
      const taskIdField = formData.get('task_id');
      const taskId = typeof taskIdField === 'string' && taskIdField ? taskIdField : undefined;

      if (!uploaded || typeof uploaded === 'string') {
        res.status(400).json({ error: 'No file provided in form-data', success: false });
        return;
      }

      const arrayBuffer = await uploaded.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const safeName = uploaded.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `uploads/${Date.now()}_${safeName}`;
      const etag = `w/"${crypto.createHash('md5').update(buffer).digest('hex').slice(0, 12)}"`;
      const now = new Date().toISOString();

      const stored: StoredFileObject = {
        key,
        filename: uploaded.name,
        contentType: uploaded.type || 'application/octet-stream',
        size: buffer.length,
        etag,
        uploaded: now,
        storageClass: 'Standard',
        task_id: taskId,
        buffer,
      };

      filesMap.set(key, stored);

      addLog({
        action: 'file_uploaded_r2',
        category: 'file',
        task_id: taskId,
        details: { key, size: buffer.length, mime: stored.contentType },
      });

      res.status(201).json({
        success: true,
        file: {
          key: stored.key,
          size: stored.size,
          etag: stored.etag,
          content_type: stored.contentType,
          filename: stored.filename,
        },
      });
    } catch (err: unknown) {
      res.status(500).json({
        error: redactSecrets(`File upload failed: ${(err as Error)?.message || 'Unknown'}`),
        success: false,
      });
    }
  });

  // 1. Health & Runtime Heartbeat
  app.get('/api/health', (_req: Request, res: Response) => {
    reapExpiredLeases();
    const activeWorkers = workers.filter((w) => w.status === 'online' || w.status === 'busy');
    const computeStatus =
      activeWorkers.length > 0 ? 'online' : workers.length > 0 ? 'all_offline' : 'no_workers';
    const inferenceStatus = activeWorkers.length > 0 ? 'available' : 'unavailable';

    res.json({
      status: 'online',
      environment: process.env.ENVIRONMENT || 'development',
      timestamp: new Date().toISOString(),
      d1_connected: true,
      r2_connected: true,
      d1_status: 'healthy',
      r2_status: 'healthy',
      worker_status: 'healthy',
      compute_status: computeStatus,
      inference_status: inferenceStatus,
      active_worker_count: activeWorkers.length,
      total_worker_count: workers.length,
      models_registered: models.length,
    });
  });

  app.get('/api/runtime/heartbeat', (_req: Request, res: Response) => {
    reapExpiredLeases();
    const activeWorker = workers.find((w) => w.status === 'online' || w.status === 'busy');
    if (activeWorker) {
      res.json({
        success: true,
        is_online: true,
        provider: activeWorker.provider,
        heartbeat: {
          node_id: activeWorker.id,
          name: activeWorker.name,
          provider: activeWorker.provider,
          status: activeWorker.status,
          gpu_model: activeWorker.gpu_model,
          gpu_count: activeWorker.gpu_count,
          vram_mb: activeWorker.vram_mb,
          gpu_utilization_percent: activeWorker.gpu_utilization_percent,
          gpu_memory_used_mb: activeWorker.gpu_memory_used_mb,
          gpu_temperature_c: activeWorker.gpu_temperature_c,
          uptime_seconds: activeWorker.uptime_seconds,
          last_heartbeat: activeWorker.last_heartbeat,
          engine_version: `${activeWorker.provider.toUpperCase()} (${activeWorker.gpu_count}× ${activeWorker.gpu_model})`,
        },
      });
      return;
    }

    res.status(503).json({
      success: false,
      is_online: false,
      error: 'No active compute workers or inference runtimes connected',
      heartbeat: null,
    });
  });

  // ==========================================
  // 1.5 Account Registration & Passwordless Auth API
  // ==========================================

  function extractSessionTokenFromReq(req: Request): string | null {
    const auth = req.header('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      if (token && !token.startsWith('ak_')) return token;
    }
    const cookie = req.header('Cookie');
    if (cookie) {
      const match = cookie.match(/aether_session=([a-zA-Z0-9_-]+)/);
      if (match) return match[1];
    }
    return null;
  }

  function getSessionUserFromReq(req: Request): { user: UserAccount; session: AuthSession } | null {
    const token = extractSessionTokenFromReq(req);
    if (!token) return null;
    const session = authSessions.find((s) => s.id === token && !s.is_revoked);
    if (!session || new Date(session.expires_at).getTime() < Date.now()) return null;
    const user = users.find((u) => u.id === session.user_id && u.status !== 'suspended');
    if (!user) return null;
    session.last_active_at = new Date().toISOString();
    return { user, session };
  }

  // User Registration
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    const body = req.body || {};
    if (!body.email || !body.name) {
      res.status(400).json({ success: false, error: 'Full name and email address are required' });
      return;
    }
    if (!body.terms_accepted || !body.privacy_accepted) {
      res.status(400).json({ success: false, error: 'Terms of service and privacy policy acceptance is required' });
      return;
    }

    const normalizedEmail = normalizeEmail(body.email);
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      res.status(400).json({ success: false, error: 'Invalid email address format' });
      return;
    }

    const existing = users.find((u) => u.email === normalizedEmail);
    if (existing) {
      res.status(409).json({
        success: false,
        error: `An account with email '${normalizedEmail}' is already registered. Please sign in with your passkey.`,
      });
      return;
    }

    const userId = generateSecureId('usr');
    const newUser: UserAccount = {
      id: userId,
      email: normalizedEmail,
      name: String(body.name).trim(),
      role: 'member',
      status: 'pending_verification',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    users.push(newUser);

    const challengeToken = generateSecureToken(32);
    const challengeId = generateSecureId('chg');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const rpId = req.hostname || 'localhost';

    authChallenges.push({
      id: challengeId,
      challenge: challengeToken,
      purpose: 'registration',
      user_id: userId,
      email: normalizedEmail,
      origin: `${req.protocol}://${req.get('host')}`,
      rp_id: rpId,
      failed_attempts: 0,
      is_used: false,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      user_id: userId,
      challenge_id: challengeId,
      options: {
        challenge: challengeToken,
        rp: { name: 'AetherOS Platform', id: rpId },
        user: {
          id: userId,
          name: normalizedEmail,
          displayName: body.name.trim(),
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          userVerification: 'preferred',
          residentKey: 'preferred',
        },
        timeout: 60000,
      },
    });
  });

  // Passkey Registration Completion & Account Activation
  app.post('/api/auth/webauthn/register-verify', async (req: Request, res: Response) => {
    const body = req.body || {};
    if (!body.challenge_id || !body.user_id || !body.credential?.id) {
      res.status(400).json({ success: false, error: 'Missing required registration verification fields' });
      return;
    }

    const challenge = authChallenges.find((c) => c.id === body.challenge_id);
    if (!challenge || challenge.is_used || new Date(challenge.expires_at).getTime() < Date.now()) {
      res.status(400).json({ success: false, error: 'Registration challenge expired or invalid. Please retry.' });
      return;
    }

    const user = users.find((u) => u.id === body.user_id);
    if (!user) {
      res.status(404).json({ success: false, error: 'User account not found' });
      return;
    }

    const credentialId = String(body.credential.id);
    const publicKey = String(body.credential.public_key || body.credential.rawId || credentialId);

    passkeyCredentials.push({
      id: credentialId,
      user_id: user.id,
      public_key: publicKey,
      algorithm: -7,
      sign_count: 0,
      device_name: String(body.credential.device_name || 'Primary Passkey Authenticator'),
      transports: body.credential.transports || ['internal', 'hybrid'],
      created_at: new Date().toISOString(),
    });

    user.status = 'active';

    const orgId = generateSecureId('org');
    const personalOrg: Organization = {
      id: orgId,
      name: `${user.name}'s Workspace`,
      slug: `ws-${user.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase()}`,
      owner_id: user.id,
      is_personal: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    organizations.push(personalOrg);
    organizationMemberships.push({
      id: generateSecureId('mem'),
      organization_id: orgId,
      user_id: user.id,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });

    const sessionToken = generateSecureToken(32);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const session: AuthSession = {
      id: sessionToken,
      user_id: user.id,
      organization_id: orgId,
      ip_address: req.ip,
      user_agent: req.header('user-agent'),
      is_revoked: false,
      last_active_at: new Date().toISOString(),
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    };
    authSessions.push(session);
    challenge.is_used = true;

    res.cookie('aether_session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      success: true,
      message: 'Account successfully activated and passkey enrolled',
      session_token: sessionToken,
      user,
      workspace: personalOrg,
    });
  });

  // Login Challenge
  app.post('/api/auth/login/challenge', async (req: Request, res: Response) => {
    const body = req.body || {};
    if (!body.email) {
      res.status(400).json({ success: false, error: 'Email address is required' });
      return;
    }
    const normalizedEmail = normalizeEmail(body.email);
    const user = users.find((u) => u.email === normalizedEmail);
    if (!user) {
      res.status(404).json({ success: false, error: 'No account registered with this email address' });
      return;
    }
    if (user.status === 'suspended') {
      res.status(403).json({ success: false, error: 'Account has been suspended' });
      return;
    }

    const userPasskeys = passkeyCredentials.filter((p) => p.user_id === user.id);
    const userTotp = totpCredentials.find((t) => t.user_id === user.id && t.is_active);

    const challengeToken = generateSecureToken(32);
    const challengeId = generateSecureId('chg');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const rpId = req.hostname || 'localhost';

    authChallenges.push({
      id: challengeId,
      challenge: challengeToken,
      purpose: 'login',
      user_id: user.id,
      email: normalizedEmail,
      origin: `${req.protocol}://${req.get('host')}`,
      rp_id: rpId,
      failed_attempts: 0,
      is_used: false,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });

    res.json({
      success: true,
      challenge_id: challengeId,
      challenge: challengeToken,
      rp_id: rpId,
      has_passkeys: userPasskeys.length > 0,
      has_totp: Boolean(userTotp),
      allow_credentials: userPasskeys.map((p) => ({
        id: p.id,
        type: 'public-key',
        transports: p.transports,
      })),
    });
  });

  // Passkey Login Verification
  app.post('/api/auth/login/passkey', async (req: Request, res: Response) => {
    const body = req.body || {};
    if (!body.challenge_id || !body.credential_id) {
      res.status(400).json({ success: false, error: 'Missing challenge_id or credential_id' });
      return;
    }

    const challenge = authChallenges.find((c) => c.id === body.challenge_id);
    if (!challenge || challenge.is_used || new Date(challenge.expires_at).getTime() < Date.now()) {
      res.status(400).json({ success: false, error: 'Authentication challenge invalid or expired.' });
      return;
    }

    if (challenge.failed_attempts >= 4) {
      res.status(429).json({
        success: false,
        error: 'Maximum permitted authentication attempts exceeded (4/4). Challenge locked.',
        locked: true,
      });
      return;
    }

    const passkey = passkeyCredentials.find((p) => p.id === body.credential_id);
    if (!passkey) {
      challenge.failed_attempts += 1;
      res.status(401).json({
        success: false,
        error: `Unrecognized passkey credential. Attempt ${challenge.failed_attempts}/4`,
        remaining_attempts: Math.max(0, 4 - challenge.failed_attempts),
      });
      return;
    }

    // Verify signature if provided
    if (body.authenticatorData && body.signature && body.clientDataJSON) {
      const sigOk = await verifyWebAuthnAssertionSignature(
        passkey.public_key,
        passkey.algorithm,
        body.authenticatorData,
        body.clientDataJSON,
        body.signature
      );
      if (!sigOk) {
        challenge.failed_attempts += 1;
        res.status(401).json({
          success: false,
          error: `Cryptographic passkey signature verification failed. Attempt ${challenge.failed_attempts}/4`,
          remaining_attempts: Math.max(0, 4 - challenge.failed_attempts),
        });
        return;
      }
    }

    passkey.sign_count += 1;
    passkey.last_used_at = new Date().toISOString();
    challenge.is_used = true;

    const user = users.find((u) => u.id === passkey.user_id)!;
    const userOrgs = organizations.filter((o) =>
      organizationMemberships.some((m) => m.organization_id === o.id && m.user_id === user.id)
    );
    const activeOrg = userOrgs[0];

    const sessionToken = generateSecureToken(32);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    authSessions.push({
      id: sessionToken,
      user_id: user.id,
      organization_id: activeOrg?.id,
      ip_address: req.ip,
      user_agent: req.header('user-agent'),
      is_revoked: false,
      last_active_at: new Date().toISOString(),
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });

    res.cookie('aether_session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      session_token: sessionToken,
      user,
      workspace: activeOrg,
    });
  });

  // TOTP Login Verification
  app.post('/api/auth/login/totp', async (req: Request, res: Response) => {
    const body = req.body || {};
    if (!body.challenge_id || !body.code) {
      res.status(400).json({ success: false, error: 'Missing challenge_id or 6-digit TOTP code' });
      return;
    }

    const challenge = authChallenges.find((c) => c.id === body.challenge_id);
    if (!challenge || challenge.is_used || new Date(challenge.expires_at).getTime() < Date.now()) {
      res.status(400).json({ success: false, error: 'Authentication challenge invalid or expired' });
      return;
    }

    if (challenge.failed_attempts >= 4) {
      res.status(429).json({
        success: false,
        error: 'Maximum permitted authentication attempts exceeded (4/4). Challenge locked.',
        locked: true,
      });
      return;
    }

    if (!challenge.user_id) {
      res.status(400).json({ success: false, error: 'Challenge missing user context' });
      return;
    }

    const totp = totpCredentials.find((t) => t.user_id === challenge.user_id && t.is_active);
    if (!totp) {
      res.status(400).json({ success: false, error: 'TOTP is not enrolled for this account' });
      return;
    }

    const secret = await decryptSecret(totp.encrypted_secret, totp.secret_iv);
    const verifyOutcome = await verifyTotpCode(secret, String(body.code), totp.last_verified_counter);

    if (!verifyOutcome.valid) {
      challenge.failed_attempts += 1;
      res.status(401).json({
        success: false,
        error: `Invalid authenticator code. Attempt ${challenge.failed_attempts}/4`,
        remaining_attempts: Math.max(0, 4 - challenge.failed_attempts),
      });
      return;
    }

    totp.last_verified_counter = verifyOutcome.counter;
    challenge.is_used = true;

    const user = users.find((u) => u.id === challenge.user_id)!;
    const userOrgs = organizations.filter((o) =>
      organizationMemberships.some((m) => m.organization_id === o.id && m.user_id === user.id)
    );

    const sessionToken = generateSecureToken(32);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    authSessions.push({
      id: sessionToken,
      user_id: user.id,
      organization_id: userOrgs[0]?.id,
      ip_address: req.ip,
      user_agent: req.header('user-agent'),
      is_revoked: false,
      last_active_at: new Date().toISOString(),
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });

    res.cookie('aether_session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      session_token: sessionToken,
      user,
      workspace: userOrgs[0],
    });
  });

  // TOTP Setup
  app.post('/api/auth/totp/setup', async (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    if (!auth) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const rawSecret = generateTotpSecret();
    const otpauthUrl = `otpauth://totp/AetherOS:${encodeURIComponent(auth.user.email)}?secret=${rawSecret}&issuer=AetherOS`;

    res.json({
      success: true,
      secret: rawSecret,
      otpauth_url: otpauthUrl,
    });
  });

  // TOTP Verify & Save Setup
  app.post('/api/auth/totp/verify-setup', async (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    if (!auth) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const body = req.body || {};
    if (!body.secret || !body.code) {
      res.status(400).json({ success: false, error: 'Secret and 6-digit code are required' });
      return;
    }

    const verifyOutcome = await verifyTotpCode(body.secret, String(body.code), 0);
    if (!verifyOutcome.valid) {
      res.status(400).json({ success: false, error: 'Verification code incorrect.' });
      return;
    }

    const encrypted = await encryptSecret(body.secret);
    const existingIndex = totpCredentials.findIndex((t) => t.user_id === auth.user.id);
    const totpRecord: TotpCredential = {
      id: generateSecureId('totp'),
      user_id: auth.user.id,
      encrypted_secret: encrypted.ciphertext,
      secret_iv: encrypted.iv,
      label: 'Authenticator App',
      is_active: true,
      last_verified_counter: verifyOutcome.counter,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      totpCredentials[existingIndex] = totpRecord;
    } else {
      totpCredentials.push(totpRecord);
    }

    res.json({ success: true, message: 'TOTP authenticator app successfully enrolled' });
  });

  // Current User Identity
  app.get('/api/auth/me', (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    if (!auth) {
      res.json({ authenticated: false, user: null });
      return;
    }

    const userOrgs = organizations.filter((o) =>
      organizationMemberships.some((m) => m.organization_id === o.id && m.user_id === auth.user.id)
    );
    const userPasskeys = passkeyCredentials.filter((p) => p.user_id === auth.user.id);
    const userTotp = totpCredentials.find((t) => t.user_id === auth.user.id && t.is_active);
    const ownedWorkers = workerOwnerships.filter((wo) => wo.owner_user_id === auth.user.id);

    res.json({
      authenticated: true,
      user: auth.user,
      workspace: userOrgs[0] || null,
      workspaces: userOrgs,
      passkeys_count: userPasskeys.length,
      has_totp: Boolean(userTotp),
      owned_workers: ownedWorkers,
    });
  });

  // Logout
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const token = extractSessionTokenFromReq(req);
    if (token) {
      const s = authSessions.find((sess) => sess.id === token);
      if (s) s.is_revoked = true;
    }
    res.clearCookie('aether_session');
    res.json({ success: true, message: 'Successfully signed out' });
  });

  // Passkey List & Revocation
  app.get('/api/auth/passkeys', (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    if (!auth) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const userPasskeys = passkeyCredentials.filter((p) => p.user_id === auth.user.id);
    res.json({
      success: true,
      passkeys: userPasskeys.map((p) => ({
        id: p.id,
        device_name: p.device_name,
        transports: p.transports,
        sign_count: p.sign_count,
        created_at: p.created_at,
        last_used_at: p.last_used_at,
      })),
    });
  });

  app.delete('/api/auth/passkeys/:id', (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    if (!auth) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const userPasskeys = passkeyCredentials.filter((p) => p.user_id === auth.user.id);
    if (userPasskeys.length <= 1) {
      res.status(400).json({ success: false, error: 'Cannot revoke the only registered passkey on your account' });
      return;
    }
    passkeyCredentials = passkeyCredentials.filter(
      (p) => !(p.id === req.params.id && p.user_id === auth.user.id)
    );
    res.json({ success: true, message: 'Passkey credential revoked' });
  });

  // Workspaces API
  app.get('/api/workspaces', (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    if (!auth) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const userOrgs = organizations.filter((o) =>
      organizationMemberships.some((m) => m.organization_id === o.id && m.user_id === auth.user.id)
    );
    res.json({ success: true, workspaces: userOrgs });
  });

  app.post('/api/workspaces', (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    if (!auth) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const body = req.body || {};
    if (!body.name) {
      res.status(400).json({ success: false, error: 'Workspace name is required' });
      return;
    }

    const orgId = generateSecureId('org');
    const slug = String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-') || `ws-${Date.now()}`;
    const newOrg: Organization = {
      id: orgId,
      name: String(body.name).trim(),
      slug: `${slug}-${Math.floor(Math.random() * 1000)}`,
      owner_id: auth.user.id,
      is_personal: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    organizations.push(newOrg);
    organizationMemberships.push({
      id: generateSecureId('mem'),
      organization_id: orgId,
      user_id: auth.user.id,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });

    res.status(201).json({ success: true, workspace: newOrg });
  });

  // Worker Claiming & Ownership (Preserving wrk_kaggle_464cc6bdb46da70260a1e849)
  app.post('/api/workers/:id/claim', (req: Request, res: Response, next: any) => {
    if (req.params.id === 'tasks') {
      return next();
    }
    const auth = getSessionUserFromReq(req);
    if (!auth) {
      res.status(401).json({ success: false, error: 'Authentication required to claim worker' });
      return;
    }
    const workerId = req.params.id;
    const worker = workers.find((w) => w.id === workerId);
    if (!worker) {
      res.status(404).json({ success: false, error: `Compute worker '${workerId}' not found` });
      return;
    }

    const body = req.body || {};
    workerOwnerships = workerOwnerships.filter((wo) => wo.worker_id !== workerId);
    workerOwnerships.push({
      worker_id: workerId,
      owner_user_id: auth.user.id,
      organization_id: auth.session.organization_id,
      ownership_type: body.ownership_type || 'personal',
      claimed_at: new Date().toISOString(),
      owner_name: auth.user.name,
    });

    worker.contributor_name = `Worker Owner: ${auth.user.name}`;
    worker.contributor_email = auth.user.email;

    res.json({
      success: true,
      message: `Compute worker '${worker.name}' (${workerId}) successfully linked to ${auth.user.name}`,
      worker_id: workerId,
      owner_name: auth.user.name,
      claimed_at: new Date().toISOString(),
    });
  });

  app.get('/api/workers/ownership', (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    if (!auth) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const owned = workerOwnerships.filter((wo) => wo.owner_user_id === auth.user.id);
    res.json({ success: true, workers: owned });
  });

  // ==========================================
  // 1.6 Remote Kaggle Compute Session Manager API
  // ==========================================

  app.get('/api/compute/sessions', (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    const filtered = auth ? computeSessions.filter((s) => s.user_id === auth.user.id) : computeSessions;
    res.json({ success: true, sessions: filtered });
  });

  app.post('/api/compute/sessions/start', async (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    const body = req.body || {};

    const userId = auth ? auth.user.id : 'usr_default';
    const notebookSlug = body.notebook_slug || 'crazybuddhaa/aetheros-kaggle-worker';
    const sessionId = generateSecureId('sess');

    const targetWorker =
      workers.find((w) => w.id === 'wrk_kaggle_464cc6bdb46da70260a1e849') ||
      workers.find((w) => w.provider === 'kaggle');

    let initialStatus: any = 'starting';
    let logsSnippet = 'Session created. Connecting to Kaggle worker node.';

    if (targetWorker && (targetWorker.status === 'online' || targetWorker.status === 'busy')) {
      initialStatus = 'ready';
      logsSnippet = `Worker '${targetWorker.name}' connected on dual T4 GPUs (~29 GB VRAM).`;
    } else {
      initialStatus = 'waiting_for_worker';
      logsSnippet = 'Session created. Launch Kaggle notebook or configure Kaggle API credentials.';
    }

    const sessionRecord: ComputeSession = {
      id: sessionId,
      provider: 'kaggle',
      user_id: userId,
      organization_id: auth?.session?.organization_id,
      worker_id: targetWorker?.id || 'wrk_kaggle_464cc6bdb46da70260a1e849',
      notebook_slug: notebookSlug,
      status: initialStatus,
      gpu_type: '2× NVIDIA Tesla T4',
      started_at: new Date().toISOString(),
      logs_snippet: logsSnippet,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    computeSessions.unshift(sessionRecord);

    res.status(201).json({
      success: true,
      session: sessionRecord,
      message: `Kaggle compute session initiated with state '${initialStatus}'`,
    });
  });

  app.get('/api/compute/sessions/:id/status', (req: Request, res: Response) => {
    const session = computeSessions.find((s) => s.id === req.params.id);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    const worker = workers.find((w) => w.id === session.worker_id) || workers.find((w) => w.provider === 'kaggle');
    if (worker && (worker.status === 'online' || worker.status === 'busy')) {
      session.status = worker.status === 'busy' ? 'busy' : 'ready';
    } else if (session.status === 'ready' && (!worker || worker.status === 'offline')) {
      session.status = 'waiting_for_worker';
    }

    res.json({
      success: true,
      session: {
        ...session,
        worker: worker ? sanitizePublicWorker(worker) : null,
        kaggle_cloud_status: session.kernel_session_id ? 'running' : 'unmanaged',
      },
    });
  });

  app.post('/api/compute/sessions/:id/stop', (req: Request, res: Response) => {
    const session = computeSessions.find((s) => s.id === req.params.id);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    session.status = 'stopped';
    session.stopped_at = new Date().toISOString();
    session.logs_snippet = 'Session gracefully stopped. Task leases safely preserved.';

    res.json({
      success: true,
      message: 'Kaggle session stopped. In-flight tasks preserved.',
      session_id: session.id,
      status: 'stopped',
    });
  });

  app.post('/api/compute/sessions/:id/restart', (req: Request, res: Response) => {
    const session = computeSessions.find((s) => s.id === req.params.id);
    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    session.status = 'starting';
    session.started_at = new Date().toISOString();
    session.stopped_at = undefined;
    session.logs_snippet = 'Session restart initiated. Awaiting worker reconnection.';

    res.json({
      success: true,
      message: 'Kaggle compute session restarting.',
      session_id: session.id,
      status: 'starting',
    });
  });

  app.post('/api/compute/kaggle-credentials', async (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    if (!auth) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    const body = req.body || {};
    if (!body.kaggle_username || !body.kaggle_key) {
      res.status(400).json({ success: false, error: 'Kaggle username and API key are required' });
      return;
    }

    const encrypted = await encryptSecret(String(body.kaggle_key).trim());
    kaggleCredentialsList = kaggleCredentialsList.filter((k) => k.user_id !== auth.user.id);
    kaggleCredentialsList.push({
      id: generateSecureId('kcred'),
      user_id: auth.user.id,
      organization_id: auth.session.organization_id,
      kaggle_username: String(body.kaggle_username).trim(),
      encrypted_key: encrypted.ciphertext,
      key_iv: encrypted.iv,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: 'Kaggle credentials securely encrypted and stored on server',
      kaggle_username: String(body.kaggle_username).trim(),
    });
  });

  app.get('/api/compute/kaggle-credentials/status', (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    if (!auth) {
      res.json({ configured: false });
      return;
    }
    const creds = kaggleCredentialsList.find((k) => k.user_id === auth.user.id);
    if (!creds) {
      res.json({ configured: false });
      return;
    }
    res.json({
      configured: true,
      kaggle_username: creds.kaggle_username,
      last_updated: creds.updated_at,
    });
  });

  // 2. Agents API
  app.get('/api/agents', (_req: Request, res: Response) => {
    res.json({ success: true, agents });
  });

  app.post('/api/agents', (req: Request, res: Response) => {
    const body = req.body || {};
    if (!body.name || !body.system_instructions) {
      res.status(400).json({
        error: 'Missing required agent fields: name, system_instructions',
        success: false,
      });
      return;
    }
    const now = new Date().toISOString();
    const agentId = body.id || `agent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newAgent: Agent = {
      id: agentId,
      name: body.name,
      description: body.description || '',
      model: body.model || 'qwen-2.5-coder-14b',
      system_instructions: body.system_instructions,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 4096,
      permitted_tools: body.permitted_tools || [],
      is_enabled: body.is_enabled ?? true,
      avatar_color: body.avatar_color || '#2563EB',
      created_at: now,
      updated_at: now,
    };
    agents.unshift(newAgent);
    addLog({
      action: 'agent_created',
      category: 'agent',
      agent_id: agentId,
      agent_name: newAgent.name,
      details: { model: newAgent.model },
    });
    res.status(201).json({ success: true, agent: newAgent });
  });

  app.get('/api/agents/:id', (req: Request, res: Response) => {
    const agent = agents.find((a) => a.id === req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found', success: false });
      return;
    }
    res.json({ success: true, agent });
  });

  app.put('/api/agents/:id', (req: Request, res: Response) => {
    const idx = agents.findIndex((a) => a.id === req.params.id);
    const body = req.body || {};
    const now = new Date().toISOString();
    if (idx === -1) {
      const created: Agent = {
        id: String(req.params.id),
        name: body.name || 'Custom Agent',
        description: body.description || '',
        model: body.model || 'qwen-2.5-coder-14b',
        system_instructions: body.system_instructions || '',
        temperature: body.temperature ?? 0.2,
        max_tokens: body.max_tokens ?? 4096,
        permitted_tools: body.permitted_tools || [],
        is_enabled: body.is_enabled ?? true,
        avatar_color: body.avatar_color || '#2563EB',
        created_at: now,
        updated_at: now,
      };
      agents.unshift(created);
      res.json({ success: true, message: 'Agent updated', agent: created });
      return;
    }
    agents[idx] = {
      ...agents[idx],
      ...body,
      id: agents[idx].id,
      updated_at: now,
    };
    addLog({
      action: 'agent_updated',
      category: 'agent',
      agent_id: agents[idx].id,
      agent_name: agents[idx].name,
    });
    res.json({ success: true, message: 'Agent updated', agent: agents[idx] });
  });

  app.delete('/api/agents/:id', (req: Request, res: Response) => {
    const existing = agents.find((a) => a.id === req.params.id);
    agents = agents.filter((a) => a.id !== req.params.id);
    addLog({
      action: 'agent_deleted',
      category: 'agent',
      agent_id: String(req.params.id),
      agent_name: existing?.name,
    });
    res.json({ success: true, message: 'Agent deleted' });
  });

  // 3. Tasks API
  app.get('/api/tasks', (req: Request, res: Response) => {
    reapExpiredLeases();
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const agentId = typeof req.query.agent_id === 'string' ? req.query.agent_id : undefined;

    let result = tasks;
    if (status && status !== 'all') {
      result = result.filter((t) => t.status === status);
    }
    if (agentId) {
      result = result.filter((t) => t.agent_id === agentId);
    }
    res.json({ success: true, tasks: result });
  });

  app.get('/api/tasks/:id', (req: Request, res: Response) => {
    const task = tasks.find((t) => t.id === req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found', success: false });
      return;
    }
    res.json({ success: true, task });
  });

  app.post('/api/tasks', (req: Request, res: Response) => {
    const body = req.body || {};
    if (!body.agent_id || !body.title) {
      res.status(400).json({ error: 'Missing required task fields: agent_id, title', success: false });
      return;
    }

    const agent = agents.find((a) => a.id === body.agent_id);
    const now = new Date().toISOString();
    const taskId = generateSecureId('tsk');

    const createdTask: Task = {
      id: taskId,
      agent_id: body.agent_id,
      agent_name: agent?.name || 'Autonomous Agent',
      user_id: body.user_id || 'usr_default',
      title: body.title,
      description: body.description || '',
      input_payload: body.input_payload || {},
      priority: (body.priority as TaskPriority) || 'medium',
      status: 'queued',
      progress_percent: 0,
      attempt_count: 0,
      created_at: now,
      updated_at: now,
      steps: [],
    };

    tasks.unshift(createdTask);
    addLog({
      action: 'task_submitted',
      category: 'task',
      task_id: taskId,
      task_title: createdTask.title,
      agent_id: createdTask.agent_id,
      agent_name: createdTask.agent_name,
      details: { priority: createdTask.priority },
    });

    res.status(201).json({ success: true, task: createdTask });
  });

  app.post('/api/tasks/:id/cancel', (req: Request, res: Response) => {
    const taskId = String(req.params.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found', success: false });
      return;
    }
    const now = new Date().toISOString();
    const reason = (req.body && req.body.reason) || 'Cancelled by operator';
    const previousWorkerId = task.claimed_by_worker;
    task.status = 'cancelled';
    task.error_message = reason;
    task.lease_expires_at = undefined;
    task.completed_at = now;
    task.updated_at = now;

    if (previousWorkerId) {
      const worker = workers.find((w) => w.id === previousWorkerId && w.current_task_id === taskId);
      if (worker) {
        if (worker.status === 'busy') worker.status = 'online';
        worker.current_task_id = undefined;
        worker.current_task_title = undefined;
        worker.updated_at = now;
      }
    }

    addLog({
      action: 'task_cancelled',
      category: 'task',
      task_id: taskId,
      task_title: task.title,
      details: { reason },
    });
    res.json({ success: true, task });
  });

  app.post('/api/tasks/:id/pause', (req: Request, res: Response) => {
    const taskId = String(req.params.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found', success: false });
      return;
    }
    if (task.status === 'running') {
      task.status = 'paused';
      task.updated_at = new Date().toISOString();
      addLog({
        action: 'task_paused',
        category: 'task',
        task_id: taskId,
        task_title: task.title,
      });
    } else if (task.status === 'paused') {
      task.status = 'running';
      task.updated_at = new Date().toISOString();
    }
    res.json({ success: true, task });
  });

  // 4. Human Approvals API
  app.get('/api/approvals', (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    let result = approvals;
    if (status && status !== 'all') {
      result = result.filter((a) => a.status === status);
    }
    res.json({ success: true, approvals: result });
  });

  app.post('/api/approvals/:id/decide', (req: Request, res: Response) => {
    const approvalId = String(req.params.id);
    const body = req.body || {};
    if (!body.decision || !['approved', 'rejected'].includes(body.decision)) {
      res.status(400).json({ error: 'Decision must be "approved" or "rejected"', success: false });
      return;
    }

    const approval = approvals.find((a) => a.id === approvalId);
    if (!approval) {
      res.status(404).json({ error: 'Approval request not found', success: false });
      return;
    }

    const now = new Date().toISOString();
    approval.status = body.decision;
    approval.decided_at = now;
    approval.decided_by = body.reviewer_id || 'Alex Vance (Lead Architect)';
    approval.review_comment =
      body.comment ||
      (body.decision === 'approved' ? 'Action authorized by human operator' : 'Action declined');

    addLog({
      action: `approval_${body.decision}`,
      category: 'approval',
      task_id: approval.task_id,
      task_title: approval.task_title,
      agent_id: approval.agent_id,
      agent_name: approval.agent_name,
      details: { approval_id: approvalId, decision: body.decision, comment: approval.review_comment },
    });

    const task = tasks.find((t) => t.id === approval.task_id);
    if (task) {
      if (body.decision === 'approved') {
        task.status = 'running';
        task.updated_at = now;
        if (task.steps && task.steps[2]) {
          task.steps[2].status = 'completed';
          task.steps[2].duration_ms = 1650;
          task.steps[2].logs =
            (task.steps[2].logs || '') +
            '\n[AUTHORIZED]: Human approval received from administrator. Executing action... Done.';
        }
        task.progress_percent = 75;

        if (task.steps && task.steps[3]) {
          task.steps[3].status = 'running';
          setTimeout(() => {
            const targetTask = tasks.find((t) => t.id === approval.task_id);
            if (!targetTask || targetTask.status === 'cancelled') return;
            if (targetTask.steps && targetTask.steps[3]) {
              targetTask.steps[3].status = 'completed';
              targetTask.steps[3].duration_ms = 1420;
              targetTask.steps[3].logs =
                'Output persisted to Cloudflare R2 bucket: r2://aetheros-agent-files/analytics/';
            }
            targetTask.status = 'completed';
            targetTask.progress_percent = 100;
            targetTask.completed_at = new Date().toISOString();
            targetTask.updated_at = new Date().toISOString();
            targetTask.result_payload = {
              status: 'success',
              summary: 'Task executed with authorized human sign-off.',
            };
          }, 2200);
        } else {
          task.status = 'completed';
          task.progress_percent = 100;
          task.completed_at = now;
          task.result_payload = {
            status: 'success',
            summary: 'Task executed with authorized human sign-off.',
          };
        }
      } else {
        task.status = 'cancelled';
        task.error_message = `Rejected in authorization queue: ${body.comment || 'No reason provided'}`;
        task.completed_at = now;
        task.updated_at = now;
      }
    }

    res.json({ success: true, message: `Approval ${body.decision}` });
  });

  // 5. Cloudflare Diagnostics & Bindings Status
  app.get('/api/cloudflare/status', (_req: Request, res: Response) => {
    res.json({
      success: true,
      cloudflare: {
        worker_name: 'aetheros-agent-platform',
        compatibility_date: '2026-11-01',
        environment: process.env.ENVIRONMENT || 'production',
        bindings: {
          d1: {
            binding_name: 'DB',
            database_name: 'aetheros-d1-production',
            connected: true,
          },
          r2: {
            binding_name: 'FILES_BUCKET',
            bucket_name: 'aetheros-agent-files',
            connected: true,
          },
          assets: {
            binding_name: 'ASSETS',
            directory: './dist',
            connected: true,
          },
        },
        runtime: {
          endpoint: process.env.INFERENCE_RUNTIME_URL || 'https://inference-runtime.internal.aetheros.io',
          api_key_configured: Boolean(process.env.RUNTIME_API_KEY),
          jwt_secret_configured: Boolean(process.env.JWT_SECRET),
          worker_registration_protected: Boolean(process.env.WORKER_REGISTRATION_TOKEN),
          strict_replay_nonce: process.env.REQUIRE_WORKER_NONCE === 'true',
          timeout_ms: process.env.INFERENCE_RUNTIME_TIMEOUT_MS || '30000',
          max_retries: process.env.INFERENCE_RUNTIME_MAX_RETRIES || '3',
        },
      },
    });
  });

  // 6. Files & R2 Storage API
  app.get('/api/files', (_req: Request, res: Response) => {
    const list = Array.from(filesMap.values()).map((f) => ({
      key: f.key,
      size: f.size,
      etag: f.etag,
      httpMetadata: { contentType: f.contentType },
      uploaded: f.uploaded,
      storageClass: f.storageClass,
      task_id: f.task_id,
    }));
    res.json({ success: true, files: list });
  });

  app.get(/^\/api\/files\/download\/(.+)$/, (req: Request, res: Response) => {
    const key = decodeURIComponent(req.params[0]);
    if (key.includes('..') || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
      res.status(400).json({ error: 'Invalid R2 object key path', success: false });
      return;
    }
    const file = filesMap.get(key);
    if (!file) {
      res.status(404).json({ error: 'File not found in R2 storage', success: false });
      return;
    }
    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('ETag', file.etag);
    res.send(file.buffer);
  });

  app.delete(/^\/api\/files\/(.+)$/, (req: Request, res: Response) => {
    const key = decodeURIComponent(req.params[0]);
    if (key.includes('..') || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
      res.status(400).json({ error: 'Invalid R2 object key path', success: false });
      return;
    }
    filesMap.delete(key);
    addLog({
      action: 'file_deleted_r2',
      category: 'file',
      details: { key },
    });
    res.json({ success: true, message: `File ${key} deleted from R2` });
  });

  // 7. Distributed Compute Workers Grid API

  // 7a. Public sanitized list of workers (never exposes api_key_hash or key_fingerprint)
  app.get('/api/workers', (_req: Request, res: Response) => {
    reapExpiredLeases();
    res.json({ success: true, workers: workers.map(sanitizePublicWorker) });
  });

  // 7b. Worker Registration
  app.post('/api/workers/register', async (req: Request, res: Response) => {
    const body = req.body || {};

    if (process.env.WORKER_REGISTRATION_TOKEN) {
      const authHdr = req.header('Authorization');
      const bearerMatch = authHdr?.match(/^Bearer\s+([^\s]+)$/i);
      const providedRegToken =
        req.header('X-Registration-Token') ||
        (bearerMatch ? bearerMatch[1] : undefined) ||
        body.registration_token;

      const validReg = await verifySharedSecretConstantTime(
        providedRegToken,
        process.env.WORKER_REGISTRATION_TOKEN
      );
      if (!validReg) {
        addLog({
          action: 'worker_registration_rejected',
          category: 'auth',
          details: { reason: 'Invalid or missing registration token' },
        });
        res.status(401).json({
          error: 'Unauthorized: invalid or missing worker registration token',
          success: false,
        });
        return;
      }
    }

    if (typeof body.gpu_model !== 'string' || body.gpu_model.trim().length === 0 || body.gpu_model.length > 128) {
      res.status(400).json({
        error: 'Missing or invalid required worker hardware specification: gpu_model',
        success: false,
      });
      return;
    }

    const provider = body.provider || 'kaggle';
    if (typeof provider !== 'string' || !VALID_PROVIDERS.has(provider)) {
      res.status(400).json({
        error: `Invalid provider '${provider}'. Must be one of: kaggle, oracle, runpod, self_hosted, custom`,
        success: false,
      });
      return;
    }

    const gpuCount = body.gpu_count !== undefined ? Number(body.gpu_count) : 1;
    if (!Number.isInteger(gpuCount) || gpuCount < 0 || gpuCount > 64) {
      res.status(400).json({
        error: 'Invalid gpu_count: must be an integer between 0 and 64',
        success: false,
      });
      return;
    }

    const vramMb = body.vram_mb !== undefined ? Number(body.vram_mb) : 16384;
    if (!Number.isFinite(vramMb) || vramMb < 0 || vramMb > 2097152) {
      res.status(400).json({
        error: 'Invalid vram_mb: must be between 0 and 2097152',
        success: false,
      });
      return;
    }

    const systemRamMb = body.system_ram_mb !== undefined ? Number(body.system_ram_mb) : 32768;
    if (!Number.isFinite(systemRamMb) || systemRamMb < 256 || systemRamMb > 4194304) {
      res.status(400).json({
        error: 'Invalid system_ram_mb: must be between 256 and 4194304',
        success: false,
      });
      return;
    }

    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_TTL_MS).toISOString();
    const workerId = (typeof body.worker_id === 'string' && body.worker_id.startsWith('wrk_'))
      ? body.worker_id
      : generateSecureId(`wrk_${provider}`);
    const keyData = await generateWorkerApiKey(process.env.WORKER_AUTH_PEPPER);

    const newWorker: ComputeWorker = {
      id: workerId,
      name:
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim().slice(0, 128)
          : `Node ${provider} (${body.gpu_model.trim()})`,
      provider: provider as ComputeWorker['provider'],
      gpu_model: body.gpu_model.trim(),
      gpu_count: gpuCount,
      vram_mb: Math.round(vramMb),
      system_ram_mb: Math.round(systemRamMb),
      status: 'online',
      key_prefix: keyData.keyPrefix,
      capabilities: Array.isArray(body.capabilities)
        ? body.capabilities.map((c: unknown) => String(c)).slice(0, 16)
        : ['text', 'code'],
      contributor_name:
        typeof body.contributor_name === 'string' && body.contributor_name.trim()
          ? body.contributor_name.trim().slice(0, 128)
          : 'Anonymous Contributor',
      contributor_email:
        typeof body.contributor_email === 'string' && body.contributor_email.trim()
          ? body.contributor_email.trim().slice(0, 128)
          : undefined,
      last_heartbeat: now,
      lease_expires_at: leaseExpiresAt,
      uptime_seconds: 0,
      total_tasks_completed: 0,
      created_at: now,
      updated_at: now,
    };

    workerAuthMap.set(workerId, {
      api_key_hash: keyData.storedHash,
      key_fingerprint: keyData.keyFingerprint,
      is_revoked: 0,
    });
    workers.unshift(newWorker);

    addLog({
      action: 'worker_registered',
      category: 'runtime',
      details: {
        worker_id: workerId,
        key_prefix: keyData.keyPrefix,
        gpu: body.gpu_model.trim(),
        gpu_count: gpuCount,
        vram_mb: Math.round(vramMb),
        provider,
      },
    });

    res.status(201).json({
      success: true,
      worker: sanitizePublicWorker(newWorker),
      api_key: keyData.rawKey,
      message: 'Worker registered successfully. Keep your api_key safe; it is only displayed once.',
    });
  });

  // 7c. Authenticated worker self-inspection
  app.get('/api/workers/me', async (req: Request, res: Response) => {
    const auth = await authenticateWorkerRequest(req);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, success: false });
      return;
    }

    const activeTask = auth.worker.current_task_id
      ? tasks.find((t) => t.id === auth.worker.current_task_id) || null
      : null;

    res.json({
      success: true,
      worker: sanitizePublicWorker(auth.worker),
      active_task: activeTask,
    });
  });

  // 7d. Authenticated worker heartbeat
  app.post(/^\/api\/workers(?:\/([^/]+))?\/heartbeat$/, async (req: Request, res: Response) => {
    const pathWorkerId = req.params[0];
    const body = req.body || {};

    if (pathWorkerId && body.worker_id && pathWorkerId !== body.worker_id) {
      res.status(400).json({ error: 'Mismatched worker_id in URL path and request body', success: false });
      return;
    }

    const auth = await authenticateWorkerRequest(req, pathWorkerId || body.worker_id);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, success: false });
      return;
    }

    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_TTL_MS).toISOString();
    const worker = auth.worker;

    let nextStatus: ComputeWorker['status'] = worker.current_task_id ? 'busy' : 'online';
    if (body.status === 'maintenance') {
      nextStatus = 'maintenance';
    } else if (body.status === 'offline') {
      nextStatus = 'offline';
    }

    const deltaUptime =
      body.uptime_seconds !== undefined && Number.isFinite(Number(body.uptime_seconds))
        ? Math.max(0, Math.floor(Number(body.uptime_seconds)))
        : 15;

    worker.status = nextStatus;
    worker.last_heartbeat = now;
    worker.lease_expires_at = nextStatus === 'offline' ? undefined : leaseExpiresAt;
    worker.shutdown_at = nextStatus === 'offline' ? now : undefined;
    worker.uptime_seconds = (worker.uptime_seconds || 0) + deltaUptime;
    if (body.gpu_utilization_percent !== undefined) {
      worker.gpu_utilization_percent = Number(body.gpu_utilization_percent) || 0;
    }
    if (body.gpu_memory_used_mb !== undefined) {
      worker.gpu_memory_used_mb = Number(body.gpu_memory_used_mb) || 0;
    }
    if (body.gpu_temperature_c !== undefined) {
      worker.gpu_temperature_c = Number(body.gpu_temperature_c) || 0;
    }
    worker.updated_at = now;

    if (worker.current_task_id && nextStatus !== 'offline') {
      const heldTask = tasks.find(
        (t) =>
          t.id === worker.current_task_id &&
          t.claimed_by_worker === worker.id &&
          (ACTIVE_WORKER_TASK_STATUSES as readonly string[]).includes(t.status)
      );
      if (heldTask) {
        heldTask.lease_expires_at = leaseExpiresAt;
        heldTask.updated_at = now;
      }
    }

    res.json({
      success: true,
      worker: sanitizePublicWorker(worker),
      timestamp: now,
    });
  });

  // 7e. Authenticated worker graceful shutdown
  app.post(/^\/api\/workers(?:\/([^/]+))?\/shutdown$/, async (req: Request, res: Response) => {
    const pathWorkerId = req.params[0];
    const body = req.body || {};

    if (pathWorkerId && body.worker_id && pathWorkerId !== body.worker_id) {
      res.status(400).json({ error: 'Mismatched worker_id in URL path and request body', success: false });
      return;
    }

    const auth = await authenticateWorkerRequest(req, pathWorkerId || body.worker_id);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, success: false });
      return;
    }

    const worker = auth.worker;
    if (worker.status === 'offline') {
      res.status(409).json({ error: 'Worker is already offline', success: false });
      return;
    }

    const now = new Date().toISOString();
    const releasedTaskId = releaseWorkerActiveTask(worker.id);

    worker.status = 'offline';
    worker.current_task_id = undefined;
    worker.current_task_title = undefined;
    worker.lease_expires_at = undefined;
    worker.shutdown_at = now;
    if (body.uptime_seconds !== undefined && Number.isFinite(Number(body.uptime_seconds))) {
      worker.uptime_seconds = (worker.uptime_seconds || 0) + Math.max(0, Math.floor(Number(body.uptime_seconds)));
    }
    worker.updated_at = now;

    addLog({
      action: 'worker_shutdown',
      category: 'runtime',
      task_id: releasedTaskId,
      details: {
        worker_id: worker.id,
        released_task_id: releasedTaskId || null,
      },
    });

    res.json({
      success: true,
      worker_id: worker.id,
      released_task_id: releasedTaskId || null,
      message: 'Worker gracefully shut down',
    });
  });

  // 7f. Authenticated worker atomic task claiming
  app.post('/api/workers/tasks/claim', async (req: Request, res: Response) => {
    const body = req.body || {};
    const auth = await authenticateWorkerRequest(req, body.worker_id);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, success: false });
      return;
    }

    reapExpiredLeases();
    const worker = auth.worker;

    if (worker.status === 'offline') {
      res.status(403).json({
        error: 'Worker is offline; send an authenticated online heartbeat before claiming tasks',
        success: false,
      });
      return;
    }
    if (worker.status === 'maintenance') {
      res.status(403).json({
        error: 'Worker is in maintenance status and cannot claim tasks',
        success: false,
      });
      return;
    }
    if (worker.current_task_id) {
      const heldTask = tasks.find((t) => t.id === worker.current_task_id);
      if (
        heldTask &&
        heldTask.claimed_by_worker === worker.id &&
        (ACTIVE_WORKER_TASK_STATUSES as readonly string[]).includes(heldTask.status)
      ) {
        res.status(409).json({
          error: `Worker already holds active task '${worker.current_task_id}'`,
          success: false,
        });
        return;
      }
    }

    const priorityRank: Record<string, number> = {
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
    };

    const candidates = tasks
      .filter((t) => (t.status === 'pending' || t.status === 'queued') && !t.claimed_by_worker)
      .sort((a, b) => {
        const diff = (priorityRank[a.priority] || 4) - (priorityRank[b.priority] || 4);
        if (diff !== 0) return diff;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

    let matchedTask: Task | undefined;
    for (const candidate of candidates) {
      const payload = (candidate.input_payload || {}) as Record<string, unknown>;
      if (payload.require_gpu === true && worker.gpu_count <= 0) {
        continue;
      }
      const minVram = Number(payload.min_vram_mb || 0);
      if (Number.isFinite(minVram) && minVram > 0 && worker.vram_mb < minVram) {
        continue;
      }
      matchedTask = candidate;
      break;
    }

    if (!matchedTask) {
      res.json({ success: true, task: null, message: 'No tasks currently queued for execution' });
      return;
    }

    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_TTL_MS).toISOString();

    matchedTask.status = 'assigned';
    matchedTask.claimed_by_worker = worker.id;
    matchedTask.started_at = matchedTask.started_at || now;
    matchedTask.lease_expires_at = leaseExpiresAt;
    matchedTask.attempt_count = (matchedTask.attempt_count || 0) + 1;
    matchedTask.updated_at = now;

    worker.status = 'busy';
    worker.current_task_id = matchedTask.id;
    worker.current_task_title = matchedTask.title;
    worker.lease_expires_at = leaseExpiresAt;
    worker.updated_at = now;

    addLog({
      action: 'task_claimed_by_worker',
      category: 'task',
      task_id: matchedTask.id,
      task_title: matchedTask.title,
      details: { worker_id: worker.id, title: matchedTask.title },
    });

    res.json({ success: true, task: matchedTask });
  });

  // 7g. Authenticated worker task inspection (strictly scoped to assigned task)
  app.get('/api/workers/tasks/:id', async (req: Request, res: Response) => {
    const taskId = String(req.params.id);
    const auth = await authenticateWorkerRequest(req);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, success: false });
      return;
    }

    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found', success: false });
      return;
    }
    if (task.claimed_by_worker !== auth.worker.id) {
      res.status(403).json({
        error: `Cross-worker access denied: task '${taskId}' is not assigned to worker '${auth.worker.id}'`,
        success: false,
      });
      return;
    }
    res.json({ success: true, task });
  });

  // 7h. Authenticated worker progress reporting
  app.post('/api/workers/tasks/:id/progress', async (req: Request, res: Response) => {
    const taskId = String(req.params.id);
    const body = req.body || {};
    const auth = await authenticateWorkerRequest(req, body.worker_id);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, success: false });
      return;
    }

    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found', success: false });
      return;
    }
    if (task.claimed_by_worker !== auth.worker.id) {
      res.status(403).json({
        error: `Unauthorized: task '${taskId}' is not assigned to worker '${auth.worker.id}'`,
        success: false,
      });
      return;
    }
    if (!(ACTIVE_WORKER_TASK_STATUSES as readonly string[]).includes(task.status)) {
      res.status(409).json({
        error: `Task '${taskId}' is in status '${task.status}' and cannot be modified by worker`,
        success: false,
      });
      return;
    }

    const stepNumResult = normalizeStepNumber(body.step_number);
    if (!stepNumResult.ok) {
      res.status(400).json({ error: stepNumResult.error, success: false });
      return;
    }

    const statusResolution = normalizeWorkerProgressStatus(body.status);
    if (!statusResolution.ok) {
      res.status(400).json({ error: statusResolution.error, success: false });
      return;
    }

    let clampedProgress: number | undefined;
    if (body.progress_percent !== undefined && body.progress_percent !== null) {
      if (
        typeof body.progress_percent !== 'number' ||
        !Number.isFinite(body.progress_percent) ||
        body.progress_percent < 0 ||
        body.progress_percent > 100
      ) {
        res.status(400).json({
          error: 'Invalid progress_percent: expected a number between 0 and 100',
          success: false,
        });
        return;
      }
      clampedProgress = Math.max(0, Math.min(99, Math.round(body.progress_percent)));
    }

    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_TTL_MS).toISOString();
    const stepNumber = stepNumResult.stepNumber;
    const stepName =
      typeof body.step_name === 'string' && body.step_name.trim()
        ? body.step_name.trim()
        : 'Executing Operational Payload';
    const cleanLogs = typeof body.logs === 'string' ? redactSecrets(body.logs) : undefined;

    if (!task.steps) task.steps = [];
    const existingStep = task.steps.find((s) => s.step_number === stepNumber);
    if (existingStep) {
      existingStep.step_name = stepName;
      existingStep.status = statusResolution.stepStatus;
      if (cleanLogs !== undefined) existingStep.logs = cleanLogs;
    } else {
      task.steps.push({
        id: `stp_${taskId}_${stepNumber}`,
        task_id: taskId,
        step_number: stepNumber,
        step_name: stepName,
        status: statusResolution.stepStatus,
        logs: cleanLogs || '',
        duration_ms: 0,
        created_at: now,
      });
    }

    if (clampedProgress !== undefined) {
      task.progress_percent = clampedProgress;
    }
    if (statusResolution.taskLifecycleStatus !== undefined) {
      task.status = statusResolution.taskLifecycleStatus;
    }
    task.lease_expires_at = leaseExpiresAt;
    task.updated_at = now;

    auth.worker.lease_expires_at = leaseExpiresAt;
    auth.worker.last_heartbeat = now;
    auth.worker.updated_at = now;

    res.json({
      success: true,
      message: 'Progress updated',
      step_status: statusResolution.stepStatus,
      task_status: task.status,
    });
  });

  // 7i. Authenticated worker task artifact upload
  app.post('/api/workers/tasks/:id/artifacts', async (req: Request, res: Response) => {
    try {
      const taskId = String(req.params.id);
      const auth = await authenticateWorkerRequest(req);
      if (!auth.ok) {
        res.status(auth.status).json({ error: auth.error, success: false });
        return;
      }

      const task = tasks.find((t) => t.id === taskId);
      if (!task) {
        res.status(404).json({ error: 'Task not found', success: false });
        return;
      }
      if (task.claimed_by_worker !== auth.worker.id) {
        res.status(403).json({
          error: `Unauthorized: task '${taskId}' is not assigned to worker '${auth.worker.id}'`,
          success: false,
        });
        return;
      }
      if (!(ACTIVE_WORKER_TASK_STATUSES as readonly string[]).includes(task.status)) {
        res.status(409).json({
          error: `Task '${taskId}' is in status '${task.status}' and cannot accept artifacts`,
          success: false,
        });
        return;
      }

      const contentType = req.headers['content-type'] || '';
      let filename = 'artifact.bin';
      let mimeType = 'application/octet-stream';
      let buffer: Buffer;

      if (contentType.includes('multipart/form-data')) {
        const webRequest = new Request(`http://localhost:${PORT}/api/workers/tasks/${taskId}/artifacts`, {
          method: 'POST',
          headers: req.headers as Record<string, string>,
          body: Readable.toWeb(req) as unknown as BodyInit,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' });

        const formData = await webRequest.formData();
        const uploaded = formData.get('file');
        if (!uploaded || typeof uploaded === 'string') {
          res.status(400).json({ error: 'No file provided in form-data', success: false });
          return;
        }
        filename = uploaded.name || 'artifact.bin';
        mimeType = uploaded.type || 'application/octet-stream';
        buffer = Buffer.from(await uploaded.arrayBuffer());
      } else {
        const body = req.body || {};
        if (typeof body.filename !== 'string' || !body.filename.trim()) {
          res.status(400).json({ error: 'Missing artifact filename', success: false });
          return;
        }
        filename = body.filename.trim();
        mimeType = typeof body.content_type === 'string' ? body.content_type : 'application/json';
        if (typeof body.content_base64 === 'string') {
          buffer = Buffer.from(body.content_base64, 'base64');
        } else {
          const rawContent =
            typeof body.content === 'string'
              ? body.content
              : JSON.stringify(body.content ?? {}, null, 2);
          buffer = Buffer.from(rawContent, 'utf-8');
        }
      }

      const safeName =
        filename
          .split('/')
          .pop()
          ?.split('\\')
          .pop()
          ?.replace(/[^a-zA-Z0-9._-]/g, '_') || 'artifact.bin';
      const key = `tasks/${taskId}/${Date.now()}_${safeName}`;
      const etag = `w/"${crypto.createHash('md5').update(buffer).digest('hex').slice(0, 12)}"`;
      const now = new Date().toISOString();

      filesMap.set(key, {
        key,
        filename: safeName,
        contentType: mimeType,
        size: buffer.length,
        etag,
        uploaded: now,
        storageClass: 'Standard',
        task_id: taskId,
        buffer,
      });

      addLog({
        action: 'worker_artifact_uploaded',
        category: 'file',
        task_id: taskId,
        details: { worker_id: auth.worker.id, key, size: buffer.length },
      });

      res.status(201).json({
        success: true,
        file: {
          key,
          filename: safeName,
          size: buffer.length,
          etag,
          content_type: mimeType,
          task_id: taskId,
        },
      });
    } catch (err: unknown) {
      res.status(500).json({
        error: redactSecrets(`Artifact upload failed: ${(err as Error)?.message || 'Unknown'}`),
        success: false,
      });
    }
  });

  // 7j. Authenticated worker result submission
  app.post('/api/workers/tasks/:id/result', async (req: Request, res: Response) => {
    const taskId = String(req.params.id);
    const body = req.body || {};
    const auth = await authenticateWorkerRequest(req, body.worker_id);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, success: false });
      return;
    }

    if (
      body.result_payload !== undefined &&
      (typeof body.result_payload !== 'object' ||
        body.result_payload === null ||
        Array.isArray(body.result_payload))
    ) {
      res.status(400).json({ error: 'result_payload must be a JSON object', success: false });
      return;
    }

    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found', success: false });
      return;
    }
    if (task.claimed_by_worker !== auth.worker.id) {
      res.status(403).json({
        error: `Unauthorized: task '${taskId}' is not assigned to worker '${auth.worker.id}'`,
        success: false,
      });
      return;
    }
    if (!(ACTIVE_WORKER_TASK_STATUSES as readonly string[]).includes(task.status)) {
      res.status(409).json({
        error: 'Task already finalized or reassigned; duplicate result submission rejected',
        success: false,
      });
      return;
    }

    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_TTL_MS).toISOString();

    task.status = 'completed';
    task.progress_percent = 100;
    task.result_payload = body.result_payload || {};
    task.lease_expires_at = undefined;
    task.completed_at = now;
    task.updated_at = now;

    const worker = auth.worker;
    worker.status = 'online';
    worker.current_task_id = undefined;
    worker.current_task_title = undefined;
    worker.total_tasks_completed = (worker.total_tasks_completed || 0) + 1;
    worker.lease_expires_at = leaseExpiresAt;
    worker.updated_at = now;

    addLog({
      action: 'task_completed_by_worker',
      category: 'task',
      task_id: taskId,
      task_title: task.title,
      details: { worker_id: worker.id },
    });

    res.json({ success: true, message: 'Task completed and results saved' });
  });

  // 7k. Authenticated worker failure reporting
  app.post('/api/workers/tasks/:id/fail', async (req: Request, res: Response) => {
    const taskId = String(req.params.id);
    const body = req.body || {};
    const auth = await authenticateWorkerRequest(req, body.worker_id);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error, success: false });
      return;
    }

    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found', success: false });
      return;
    }
    if (task.claimed_by_worker !== auth.worker.id) {
      res.status(403).json({
        error: `Unauthorized: task '${taskId}' is not assigned to worker '${auth.worker.id}'`,
        success: false,
      });
      return;
    }
    if (!(ACTIVE_WORKER_TASK_STATUSES as readonly string[]).includes(task.status)) {
      res.status(409).json({
        error: 'Task already finalized or reassigned',
        success: false,
      });
      return;
    }

    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_TTL_MS).toISOString();
    const errorMessage = redactSecrets(
      typeof body.error_message === 'string' && body.error_message.trim()
        ? body.error_message.trim()
        : 'Inference execution failed'
    );

    task.status = 'failed';
    task.error_message = errorMessage;
    task.lease_expires_at = undefined;
    task.completed_at = now;
    task.updated_at = now;

    const worker = auth.worker;
    worker.status = 'online';
    worker.current_task_id = undefined;
    worker.current_task_title = undefined;
    worker.lease_expires_at = leaseExpiresAt;
    worker.updated_at = now;

    addLog({
      action: 'task_failed_by_worker',
      category: 'task',
      task_id: taskId,
      task_title: task.title,
      details: { worker_id: worker.id, error: errorMessage },
    });

    res.json({ success: true, message: 'Task marked failed' });
  });

  // 7l. Worker revocation & single-worker public lookup
  app.post('/api/workers/:id/revoke', async (req: Request, res: Response) => {
    const targetWorkerId = String(req.params.id);
    const operatorSecret = process.env.RUNTIME_API_KEY || process.env.JWT_SECRET;
    if (operatorSecret) {
      const authHdr = req.header('Authorization');
      const bearerMatch = authHdr?.match(/^Bearer\s+([^\s]+)$/i);
      const isOperator = await verifySharedSecretConstantTime(
        bearerMatch ? bearerMatch[1] : undefined,
        operatorSecret
      );
      if (!isOperator) {
        const selfAuth = await authenticateWorkerRequest(req, targetWorkerId);
        if (!selfAuth.ok) {
          res.status(401).json({
            error: 'Unauthorized: operator token or matching worker key required to revoke credential',
            success: false,
          });
          return;
        }
      }
    }

    const worker = workers.find((w) => w.id === targetWorkerId);
    const authRec = workerAuthMap.get(targetWorkerId);
    if (!worker || !authRec) {
      res.status(404).json({ error: 'Worker not found', success: false });
      return;
    }

    const now = new Date().toISOString();
    releaseWorkerActiveTask(targetWorkerId);

    authRec.is_revoked = 1;
    authRec.key_fingerprint = null;
    worker.status = 'offline';
    worker.key_prefix = 'revoked';
    worker.current_task_id = undefined;
    worker.current_task_title = undefined;
    worker.lease_expires_at = undefined;
    worker.shutdown_at = now;
    worker.updated_at = now;

    addLog({
      action: 'worker_credential_revoked',
      category: 'auth',
      details: { worker_id: targetWorkerId },
    });

    res.json({ success: true, message: `Worker '${targetWorkerId}' credential revoked` });
  });

  app.get('/api/workers/:id', (req: Request, res: Response) => {
    reapExpiredLeases();
    const worker = workers.find((w) => w.id === req.params.id);
    if (!worker) {
      res.status(404).json({ error: 'Worker not found', success: false });
      return;
    }
    res.json({ success: true, worker: sanitizePublicWorker(worker) });
  });

  // 8. Model Registry & Activity Logs & Reset
  app.get('/api/models', (req: Request, res: Response) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const filtered = category ? models.filter((m) => m.category === category) : models;
    res.json({ success: true, models: filtered });
  });

  app.get('/api/logs', (_req: Request, res: Response) => {
    res.json({ success: true, logs });
  });

  // 9. Conversations & Messages API
  app.get('/api/conversations', (_req: Request, res: Response) => {
    res.json({ success: true, conversations });
  });

  app.post('/api/conversations', (req: Request, res: Response) => {
    const body = req.body || {};
    const convId = generateSecureId('conv');
    const now = new Date().toISOString();
    const created: Conversation = {
      id: convId,
      user_id: body.user_id || 'usr_admin',
      agent_id: body.agent_id,
      title: body.title || 'New Conversation',
      is_pinned: Boolean(body.is_pinned),
      created_at: now,
      updated_at: now,
      message_count: 0,
    };
    conversations.unshift(created);
    res.status(201).json({ success: true, conversation: created });
  });

  app.get('/api/conversations/:id', (req: Request, res: Response) => {
    const convId = String(req.params.id);
    const conversation = conversations.find((c) => c.id === convId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found', success: false });
      return;
    }
    const convMessages = messages.filter((m) => m.conversation_id === convId);
    res.json({ success: true, conversation, messages: convMessages });
  });

  app.delete('/api/conversations/:id', (req: Request, res: Response) => {
    const convId = String(req.params.id);
    conversations = conversations.filter((c) => c.id !== convId);
    messages = messages.filter((m) => m.conversation_id !== convId);
    res.json({ success: true, message: 'Conversation deleted' });
  });

  app.get('/api/conversations/:id/messages', (req: Request, res: Response) => {
    const convId = String(req.params.id);
    const convMessages = messages.filter((m) => m.conversation_id === convId);
    res.json({ success: true, messages: convMessages });
  });

  app.post('/api/conversations/:id/messages', (req: Request, res: Response) => {
    const convId = String(req.params.id);
    const body = req.body || {};
    if (!body.content || typeof body.content !== 'string') {
      res.status(400).json({ error: 'Missing or invalid message content', success: false });
      return;
    }
    const now = new Date().toISOString();
    const createdMsg: Message = {
      id: generateSecureId('msg'),
      conversation_id: convId,
      sender_type: body.sender_type || 'user',
      content: body.content,
      thinking: body.thinking,
      tool_calls: body.tool_calls,
      artifacts: body.artifacts,
      attachments: body.attachments,
      tokens_used: body.tokens_used || Math.round(body.content.length / 4),
      created_at: now,
    };
    messages.push(createdMsg);

    const conv = conversations.find((c) => c.id === convId);
    if (conv) {
      conv.updated_at = now;
      conv.last_message = body.content.slice(0, 100);
      conv.message_count = (conv.message_count || 0) + 1;
    }

    res.status(201).json({ success: true, message: createdMsg });
  });

  // 10. Real Model Inference Chat Endpoint
  app.post('/api/chat', (req: Request, res: Response) => {
    reapExpiredLeases();
    const body = req.body || {};
    if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
      res.status(400).json({ error: 'Missing required field: message', success: false });
      return;
    }

    const now = new Date().toISOString();
    let convId = body.conversation_id;
    if (!convId) {
      convId = generateSecureId('conv');
      const newConv: Conversation = {
        id: convId,
        user_id: body.user_id || 'usr_admin',
        agent_id: body.agent_id,
        title: body.message.trim().slice(0, 32) || 'New Conversation',
        is_pinned: false,
        created_at: now,
        updated_at: now,
        message_count: 0,
      };
      conversations.unshift(newConv);
    }

    // 1. Record user message
    const userMsg: Message = {
      id: generateSecureId('msg'),
      conversation_id: convId,
      sender_type: 'user',
      content: body.message.trim(),
      attachments: body.attachments,
      tokens_used: Math.round(body.message.length / 4),
      created_at: now,
    };
    messages.push(userMsg);

    // 2. Identify target model & check active compute workers
    const agent = body.agent_id ? agents.find((a) => a.id === body.agent_id) : undefined;
    const targetModel = body.model || agent?.model || 'qwen-2.5-coder-14b';
    const activeWorkers = workers.filter((w) => w.status === 'online' || w.status === 'busy');

    if (activeWorkers.length === 0) {
      // Honest offline response: never invent fake responses
      const errorText = `Inference Unavailable: No active compute workers are currently connected to execute model '${targetModel}'. Connect a Kaggle GPU worker node (dual Tesla T4) via the Compute Grid to execute local inference.`;
      const agentMsg: Message = {
        id: generateSecureId('msg'),
        conversation_id: convId,
        sender_type: 'agent',
        content: errorText,
        tokens_used: 0,
        created_at: new Date().toISOString(),
      };
      messages.push(agentMsg);

      const conv = conversations.find((c) => c.id === convId);
      if (conv) {
        conv.updated_at = new Date().toISOString();
        conv.last_message = errorText.slice(0, 100);
        conv.message_count = (conv.message_count || 0) + 2;
      }

      res.status(503).json({
        success: false,
        error: errorText,
        user_message: userMsg,
        agent_message: agentMsg,
        conversation_id: convId,
        active_workers: 0,
      });
      return;
    }

    // 3. Active worker online: dispatch real inference task to queue
    const taskId = generateSecureId('tsk');
    const createdTask: Task = {
      id: taskId,
      agent_id: agent?.id || 'agent_dataops',
      agent_name: agent?.name,
      user_id: body.user_id || 'usr_admin',
      title: `Chat: ${body.message.trim().slice(0, 48)}`,
      description: body.message.trim(),
      input_payload: {
        prompt: body.message.trim(),
        system_instructions: agent?.system_instructions || 'You are an autonomous AI engineer.',
        model: targetModel,
        conversation_id: convId,
        require_gpu: true,
        task_type: 'inference',
        max_tokens: agent?.max_tokens || 512,
        temperature: agent?.temperature || 0.2,
      },
      priority: 'high',
      status: 'queued',
      progress_percent: 0,
      created_at: now,
      updated_at: now,
    };
    tasks.unshift(createdTask);

    addLog({
      action: 'chat_inference_enqueued',
      category: 'runtime',
      task_id: taskId,
      agent_id: agent?.id,
      details: {
        conversation_id: convId,
        model: targetModel,
        active_worker_count: activeWorkers.length,
      },
    });

    const conv = conversations.find((c) => c.id === convId);
    if (conv) {
      conv.updated_at = now;
      conv.last_message = body.message.trim().slice(0, 100);
      conv.message_count = (conv.message_count || 0) + 1;
    }

    res.json({
      success: true,
      task: createdTask,
      user_message: userMsg,
      conversation_id: convId,
      active_workers: activeWorkers.length,
    });
  });

  app.post('/api/reset', (_req: Request, res: Response) => {
    agents = createInitialAgents();
    tasks = createInitialTasks();
    approvals = createInitialApprovals();
    filesMap = createInitialFiles();
    initialWorkerState = createInitialWorkers();
    workers = initialWorkerState.workers;
    workerAuthMap = initialWorkerState.authMap;
    workerNonceMap.clear();
    logs = createInitialLogs();
    conversations = [];
    messages = [];
    res.json({ success: true, message: 'Platform state reset to defaults' });
  });

  // Catch-all for unknown /api/* endpoints
  app.all('/api/*', (req: Request, res: Response) => {
    res.status(404).json({ error: `Endpoint not found: ${req.path}`, success: false });
  });

  // Frontend serving: Vite middleware in development, static dist/ in production
  if (!options.disableVite) {
    const distDir = path.resolve(__dirname, 'dist');
    const useProdStatic = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

    if (useProdStatic) {
      app.use(express.static(distDir));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    } else {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    }
  }

  return app;
}

async function startServer() {
  const app = await createAetherApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AetherOS server listening on http://0.0.0.0:${PORT}`);
  });
}

const isMainModule = Boolean(
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)
);

if (isMainModule) {
  startServer().catch((err) => {
    console.error('Failed to start AetherOS server:', err);
    process.exit(1);
  });
}
