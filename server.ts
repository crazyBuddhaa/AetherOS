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
  verifyWebAuthnRegistrationCredential,
  parseAndVerifyAuthenticatorData,
  verifyWebAuthnAssertionSignature,
  SECURITY_RESPONSE_HEADERS,
} from './worker/auth.ts';
import { runDefensiveSecurityAssessment } from './worker/cybersecurity.ts';
import { runWebInvestigation } from './worker/web-intelligence.ts';
import {
  getRepoTree,
  readRepoFile,
  writeRepoFile,
  getGitStatus,
  getGitDiff,
  stageGitFiles,
  commitGit,
  pushGit,
} from './worker/repo-git-service.ts';
import { mcpManager } from './worker/mcp-service.ts';
import {
  processAiStudioChat,
  AVAILABLE_MODELS,
  getSavedManualApiConfig,
  updateSavedManualApiConfig,
  testManualApiConnection,
} from './worker/ai-studio-service.ts';
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
  R2FileRecord,
} from './worker/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

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
  const now = new Date().toISOString();
  return [
    {
      id: 'agent_dataops',
      name: 'Nexus-7 (Code & DataOps Architect)',
      description: 'Synthesizes full-stack TypeScript, Cloudflare Workers, D1 SQL migrations, and PyTorch GPU modules.',
      model: 'qwen-2.5-coder-14b',
      system_instructions: 'You are Nexus-7, a senior distributed systems and AI infrastructure architect.',
      temperature: 0.2,
      max_tokens: 4096,
      permitted_tools: ['d1_sql_query', 'r2_file_manager', 'code_interpreter'],
      is_enabled: true,
      avatar_color: '#2563EB',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'agent_cybersec',
      name: 'Aegis-0 (Cybersecurity Defensive Specialist)',
      description: 'Authorized defensive security operations: HTTP header & TLS auditing, DNS SPF/DMARC/CAA verification, dependency CVE checks, and source code static security analysis.',
      model: 'cybersec-defensive-analyzer-v1',
      system_instructions: 'You are Aegis-0, AetherOS Principal Defensive Cybersecurity Specialist. Perform strictly authorized defensive security assessments, distinguishing verified findings from unverified indicators.',
      temperature: 0.1,
      max_tokens: 4096,
      permitted_tools: ['http_security_header_audit', 'tls_config_inspector', 'dns_spf_dmarc_checker', 'dependency_vuln_scanner', 'static_code_security_analyzer', 'r2_report_archiver'],
      is_enabled: true,
      avatar_color: '#DC2626',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'agent_visual_synth',
      name: 'Lumina-4 (Diffusion Visual Synthesizer)',
      description: 'High-resolution diffusion image generation (SDXL Lightning / SD 1.5), Real-ESRGAN 4x upscaling, and BiRefNet alpha foreground extraction.',
      model: 'sdxl-lightning',
      system_instructions: 'You are Lumina-4, a diffusion synthesis and spatial super-resolution specialist.',
      temperature: 0.4,
      max_tokens: 2048,
      permitted_tools: ['sdxl_generate', 'esrgan_upscale', 'birefnet_alpha', 'r2_artifact_upload'],
      is_enabled: true,
      avatar_color: '#7C3AED',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'agent_motion_studio',
      name: 'Kinetix-3 (Temporal Motion & Video Engine)',
      description: 'Temporal motion synthesis using AnimateDiff v3 across dual Tesla T4 GPUs.',
      model: 'animatediff-motion-v3',
      system_instructions: 'You are Kinetix-3, a temporal diffusion video synthesis specialist.',
      temperature: 0.4,
      max_tokens: 2048,
      permitted_tools: ['animatediff_render', 'r2_artifact_upload'],
      is_enabled: true,
      avatar_color: '#0891B2',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'agent_storyboard',
      name: 'Vanguard-S (Cinematic Storyboard Director)',
      description: 'Translates narrative beats into structured shot lists, camera blocking metadata, and visual plates.',
      model: 'sdxl-lightning',
      system_instructions: 'You are Vanguard-S, a cinematic storyboard director and shot planner.',
      temperature: 0.5,
      max_tokens: 4096,
      permitted_tools: ['shot_compositor', 'sdxl_generate', 'r2_artifact_upload'],
      is_enabled: true,
      avatar_color: '#D97706',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'agent_screenwriter',
      name: 'Orpheus-9 (Screenplay & Narrative Architect)',
      description: 'Drafts industry-standard Fountain screenplays, scene breakdowns, and dialogue pacing.',
      model: 'deepseek-r1-distill-qwen-14b',
      system_instructions: 'You are Orpheus-9, an industry screenplay and narrative structure architect.',
      temperature: 0.6,
      max_tokens: 8192,
      permitted_tools: ['fountain_formatter', 'r2_artifact_upload'],
      is_enabled: true,
      avatar_color: '#059669',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'agent_web_intelligence',
      name: 'AetherEye (Web Intelligence & OSINT Specialist)',
      description: 'Autonomous live website reconnaissance, content extraction, SEO/metadata analysis, technology stack fingerprinting, DNS/DoH intelligence, and passive security inspection.',
      model: 'qwen-2.5-coder-14b',
      system_instructions: 'You are AetherEye, the principal Web Intelligence Agent for AetherOS. Formulate evidence-based reconnaissance from real HTTP, DNS, and TLS observations.',
      temperature: 0.2,
      max_tokens: 8192,
      permitted_tools: ['web_fetcher', 'domain_intelligence', 'passive_security_inspection', 'technology_fingerprinting', 'r2_report_archiver'],
      is_enabled: true,
      avatar_color: '#0284C7',
      created_at: now,
      updated_at: now,
    },
  ];
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
      category: 'coding',
      min_vram_mb: 14336,
      min_system_ram_mb: 16384,
      supported_precisions: ['fp16', 'int4', 'awq'],
      capabilities: ['text', 'code', 'coding', 'json'],
      weights_source: 'Qwen/Qwen2.5-Coder-14B-Instruct',
      description: 'Premier open coding & reasoning model. Optimized for tensor-parallel on dual T4.',
      parameter_count: '14.7B',
      context_window: 32768,
      default_timeout_seconds: 180,
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'deepseek-r1-distill-qwen-14b',
      name: 'DeepSeek R1 Distill 14B',
      category: 'text',
      min_vram_mb: 15360,
      min_system_ram_mb: 16384,
      supported_precisions: ['fp16', 'int4', 'gptq'],
      capabilities: ['text', 'reasoning', 'screenplay', 'analysis'],
      weights_source: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
      description: 'High-throughput reasoning model with deep chain-of-thought distillation.',
      parameter_count: '14.8B',
      context_window: 32768,
      default_timeout_seconds: 240,
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'qwen-2-vl-7b-instruct',
      name: 'Qwen2-VL 7B Vision-Language',
      category: 'vision',
      min_vram_mb: 10240,
      min_system_ram_mb: 12288,
      supported_precisions: ['fp16', 'int4'],
      capabilities: ['vision', 'multimodal', 'ocr', 'image_understanding'],
      weights_source: 'Qwen/Qwen2-VL-7B-Instruct',
      description: 'Multimodal vision-language model for image inspection, OCR, and visual reasoning.',
      parameter_count: '7.6B',
      context_window: 32768,
      default_timeout_seconds: 180,
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'sd-1.5-standard',
      name: 'Stable Diffusion 1.5',
      category: 'image',
      min_vram_mb: 6144,
      min_system_ram_mb: 8192,
      supported_precisions: ['fp16'],
      capabilities: ['image', 'text_to_image', 'storyboard_plate'],
      weights_source: 'runwayml/stable-diffusion-v1-5',
      description: 'Fast text-to-image synthesis (~2.5s generation per step on T4).',
      parameter_count: '0.98B',
      context_window: 77,
      default_timeout_seconds: 120,
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'sdxl-lightning',
      name: 'SDXL Lightning 4-Step',
      category: 'image',
      min_vram_mb: 10240,
      min_system_ram_mb: 16384,
      supported_precisions: ['fp16'],
      capabilities: ['image', 'text_to_image', 'high_res_image', 'storyboard_plate'],
      weights_source: 'ByteDance/SDXL-Lightning',
      description: 'Photorealistic high-resolution 1024x1024 generation in 4 inference steps.',
      parameter_count: '3.5B',
      context_window: 77,
      default_timeout_seconds: 180,
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'real-esrgan-4x',
      name: 'Real-ESRGAN 4x+ Upscaler',
      category: 'image_processing',
      min_vram_mb: 4096,
      min_system_ram_mb: 8192,
      supported_precisions: ['fp16'],
      capabilities: ['image_processing', 'upscale', 'super_resolution'],
      weights_source: 'xinntao/Real-ESRGAN',
      description: 'High-fidelity spatial super-resolution upscaler.',
      parameter_count: '16.7M',
      context_window: 0,
      default_timeout_seconds: 90,
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'birefnet-bg-removal',
      name: 'BiRefNet Background Removal',
      category: 'image_processing',
      min_vram_mb: 4096,
      min_system_ram_mb: 8192,
      supported_precisions: ['fp16'],
      capabilities: ['image_processing', 'background_removal', 'segmentation'],
      weights_source: 'ZhengPeng7/BiRefNet',
      description: 'Ultra-clean background extraction for multimodal agent workflows.',
      parameter_count: '215M',
      context_window: 0,
      default_timeout_seconds: 90,
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'animatediff-motion-v3',
      name: 'AnimateDiff Motion Module v3',
      category: 'video',
      min_vram_mb: 12288,
      min_system_ram_mb: 16384,
      supported_precisions: ['fp16'],
      capabilities: ['video', 'text_to_video', 'motion_synthesis'],
      weights_source: 'guoyww/animatediff-motion-adapter-v1-5-3',
      description: 'Short video synthesis from text prompt (16-32 frames at 512x512).',
      parameter_count: '1.8B',
      context_window: 77,
      default_timeout_seconds: 300,
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'whisper-large-v3-turbo',
      name: 'Whisper Large v3 Turbo',
      category: 'speech',
      min_vram_mb: 4096,
      min_system_ram_mb: 8192,
      supported_precisions: ['fp16'],
      capabilities: ['audio', 'speech', 'transcription', 'speech_to_text'],
      weights_source: 'openai/whisper-large-v3-turbo',
      description: 'Fast multilingual speech-to-text transcription engine.',
      parameter_count: '809M',
      context_window: 448,
      default_timeout_seconds: 120,
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'bge-large-en-v1.5',
      name: 'BAAI BGE Large EN v1.5',
      category: 'embedding',
      min_vram_mb: 2048,
      min_system_ram_mb: 4096,
      supported_precisions: ['fp16', 'fp32'],
      capabilities: ['embedding', 'semantic_search', 'vector_indexing'],
      weights_source: 'BAAI/bge-large-en-v1.5',
      description: 'High-dimensional 1024-d dense vector embedding model for semantic retrieval and RAG.',
      parameter_count: '335M',
      context_window: 512,
      default_timeout_seconds: 60,
      is_enabled: true,
      created_at: now,
    },
    {
      id: 'cybersec-defensive-analyzer-v1',
      name: 'AetherOS Defensive Security Analyzer v1',
      category: 'specialized',
      min_vram_mb: 0,
      min_system_ram_mb: 512,
      supported_precisions: ['fp32'],
      capabilities: ['security_audit', 'header_analysis', 'tls_inspection', 'dns_security', 'dependency_audit', 'static_code_analysis'],
      weights_source: 'aetheros/cybersec-defensive-analyzer-v1',
      description: 'Specialized defensive cybersecurity assessment engine for HTTP headers, TLS, DNS SPF/DMARC, dependency CVE scanning, and static code analysis.',
      parameter_count: 'Rule+AST',
      context_window: 65536,
      default_timeout_seconds: 60,
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

export async function createAetherApp(options: { disableVite?: boolean; persistPath?: string } = {}) {
  const app = express();

  const persistFile =
    options.persistPath !== undefined
      ? options.persistPath
      : options.disableVite
      ? null
      : path.resolve(__dirname, '.data', 'aetheros-dev-state.json');

  let agents: Agent[] = createInitialAgents();
  let tasks: Task[] = createInitialTasks();
  let approvals: ApprovalRequest[] = createInitialApprovals();
  let filesMap: Map<string, StoredFileObject> = createInitialFiles();
  let fileMetadataList: R2FileRecord[] = [];
  let initialWorkerState = createInitialWorkers();
  let workers: ComputeWorker[] = initialWorkerState.workers;
  let workerAuthMap: Map<string, WorkerInternalAuth> = initialWorkerState.authMap;
  const workerNonceMap = new Map<string, number>();
  const rateLimitMap = new Map<string, { count: number; windowStartMs: number }>();
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

  function loadPersistedState() {
    if (!persistFile || !fs.existsSync(persistFile)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(persistFile, 'utf-8'));
      if (Array.isArray(raw.agents) && raw.agents.length > 0) agents = raw.agents;
      if (Array.isArray(raw.tasks)) tasks = raw.tasks;
      if (Array.isArray(raw.approvals)) approvals = raw.approvals;
      if (Array.isArray(raw.workers)) workers = raw.workers;
      if (Array.isArray(raw.workerAuthEntries)) {
        workerAuthMap = new Map(raw.workerAuthEntries);
      }
      if (Array.isArray(raw.logs)) logs = raw.logs;
      if (Array.isArray(raw.conversations)) conversations = raw.conversations;
      if (Array.isArray(raw.messages)) messages = raw.messages;
      if (Array.isArray(raw.users)) users = raw.users;
      if (Array.isArray(raw.organizations)) organizations = raw.organizations;
      if (Array.isArray(raw.organizationMemberships)) organizationMemberships = raw.organizationMemberships;
      if (Array.isArray(raw.passkeyCredentials)) passkeyCredentials = raw.passkeyCredentials;
      if (Array.isArray(raw.totpCredentials)) totpCredentials = raw.totpCredentials;
      if (Array.isArray(raw.authChallenges)) authChallenges = raw.authChallenges;
      if (Array.isArray(raw.authSessions)) authSessions = raw.authSessions;
      if (Array.isArray(raw.computeSessions)) computeSessions = raw.computeSessions;
      if (Array.isArray(raw.workerOwnerships)) workerOwnerships = raw.workerOwnerships;
      if (Array.isArray(raw.kaggleCredentialsList)) kaggleCredentialsList = raw.kaggleCredentialsList;
      if (Array.isArray(raw.securityEvents)) securityEvents = raw.securityEvents;
      if (Array.isArray(raw.fileMetadataList)) fileMetadataList = raw.fileMetadataList;
      if (Array.isArray(raw.filesEntries)) {
        filesMap = new Map(
          raw.filesEntries.map(([k, v]: [string, any]) => [
            k,
            { ...v, buffer: Buffer.from(v.bufferBase64 || '', 'base64') },
          ])
        );
      }
    } catch {}
  }

  function savePersistedState() {
    if (!persistFile) return;
    try {
      const dir = path.dirname(persistFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const serialized = {
        agents,
        tasks,
        approvals,
        workers,
        workerAuthEntries: Array.from(workerAuthMap.entries()),
        logs,
        conversations,
        messages,
        users,
        organizations,
        organizationMemberships,
        passkeyCredentials,
        totpCredentials,
        authChallenges,
        authSessions,
        computeSessions,
        workerOwnerships,
        kaggleCredentialsList,
        securityEvents,
        fileMetadataList,
        filesEntries: Array.from(filesMap.entries()).map(([k, v]) => [
          k,
          {
            key: v.key,
            filename: v.filename,
            contentType: v.contentType,
            size: v.size,
            etag: v.etag,
            uploaded: v.uploaded,
            storageClass: v.storageClass,
            task_id: v.task_id,
            bufferBase64: v.buffer.toString('base64'),
          },
        ]),
      };
      fs.writeFileSync(persistFile, JSON.stringify(serialized, null, 2), 'utf-8');
    } catch {}
  }

  loadPersistedState();

  function checkRateLimit(bucketKey: string, maxRequests = 25, windowMs = 60_000): {
    allowed: boolean;
    retryAfterSeconds: number;
  } {
    const nowMs = Date.now();
    const existing = rateLimitMap.get(bucketKey);
    if (!existing || nowMs - existing.windowStartMs > windowMs) {
      rateLimitMap.set(bucketKey, { count: 1, windowStartMs: nowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const nextCount = existing.count + 1;
    existing.count = nextCount;
    if (nextCount > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowStartMs + windowMs - nowMs) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  function addLog(entry: Omit<ActivityLog, 'id' | 'created_at'>) {
    logs.unshift({
      ...entry,
      id: generateSecureId('log'),
      created_at: new Date().toISOString(),
    });
    if (logs.length > 100) {
      logs = logs.slice(0, 100);
    }
    savePersistedState();
  }

  function addSecurityEvent(event: Omit<SecurityAuditEvent, 'id' | 'created_at'>) {
    securityEvents.unshift({
      ...event,
      id: generateSecureId('sec'),
      created_at: new Date().toISOString(),
    });
    if (securityEvents.length > 200) {
      securityEvents = securityEvents.slice(0, 200);
    }
    savePersistedState();
  }

  function reapExpiredLeases() {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    let mutated = false;

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
        mutated = true;
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
        mutated = true;
      }
    }

    if (mutated) savePersistedState();
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
    savePersistedState();
    return task.id;
  }

  // CORS & Security Headers middleware for /api/*
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.header('Origin') || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, X-Worker-Id, X-Worker-Timestamp, X-Worker-Nonce, Idempotency-Key, X-Registration-Token'
    );
    for (const [hdr, val] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
      res.setHeader(hdr, val);
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

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

  function extractSessionTokenFromReq(req: Request): string | null {
    const auth = req.header('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      if (token && !token.startsWith('ak_')) return token;
    }
    const cookie = req.header('Cookie');
    if (cookie) {
      const match = cookie.match(/(?:^|;\s*)aether_session=([a-zA-Z0-9_-]+)/);
      if (match) return match[1];
    }
    return null;
  }

  function getSessionUserFromReq(req: Request): { user: UserAccount; session: AuthSession } | null {
    const token = extractSessionTokenFromReq(req);
    if (!token) return null;
    const session = authSessions.find((s) => s.id === token && !s.is_revoked);
    if (!session || new Date(session.expires_at).getTime() < Date.now()) return null;
    const user = users.find((u) => u.id === session.user_id && u.status === 'active');
    if (!user) return null;
    session.last_active_at = new Date().toISOString();
    return { user, session };
  }

  // File upload endpoint (multipart/form-data)
  app.post('/api/files', async (req: Request, res: Response) => {
    try {
      const auth = getSessionUserFromReq(req);
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

      if (uploaded.size > MAX_UPLOAD_BYTES) {
        res.status(413).json({
          error: `File size exceeds maximum limit of 50 MB (${uploaded.size} bytes)`,
          success: false,
        });
        return;
      }

      const arrayBuffer = await uploaded.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const safeName = uploaded.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'artifact.bin';
      const key = taskId
        ? `tasks/${taskId}/${Date.now()}_${safeName}`
        : `uploads/${Date.now()}_${safeName}`;
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
      fileMetadataList.unshift({
        id: generateSecureId('file'),
        r2_key: key,
        filename: uploaded.name,
        mime_type: stored.contentType,
        size_bytes: buffer.length,
        etag,
        uploaded_by: auth?.user?.id || 'usr_admin',
        task_id: taskId,
        storage_class: 'Standard',
        created_at: now,
      });

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
          loaded_models: activeWorker.loaded_models || [],
          gpu_devices: activeWorker.gpu_devices || [],
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

  // User Registration
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    const clientIp = req.ip || 'local';
    const rate = checkRateLimit(`register:${clientIp}`, 20, 60_000);
    if (!rate.allowed) {
      res.status(429).json({
        success: false,
        error: `Too many registration requests. Please retry in ${rate.retryAfterSeconds}s.`,
      });
      return;
    }

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
    if (!normalizedEmail || !normalizedEmail.includes('@') || normalizedEmail.length > 254) {
      res.status(400).json({ success: false, error: 'Invalid email address format' });
      return;
    }

    const existing = users.find((u) => u.email === normalizedEmail);
    if (existing && existing.status === 'active') {
      res.status(409).json({
        success: false,
        error: `An account with email '${normalizedEmail}' is already registered. Please sign in with your passkey.`,
      });
      return;
    }

    const userId = existing ? existing.id : generateSecureId('usr');
    if (existing) {
      existing.name = String(body.name).trim();
      existing.updated_at = new Date().toISOString();
    } else {
      users.push({
        id: userId,
        email: normalizedEmail,
        name: String(body.name).trim(),
        role: 'member',
        status: 'pending_verification',
        is_active: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

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

    addSecurityEvent({
      user_id: userId,
      event_type: 'account_registration_initiated',
      severity: 'info',
      details: { email: normalizedEmail },
      ip_address: clientIp,
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
          displayName: String(body.name).trim(),
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
    const clientIp = req.ip || 'local';
    const rate = checkRateLimit(`reg_verify:${clientIp}`, 25, 60_000);
    if (!rate.allowed) {
      res.status(429).json({ success: false, error: `Rate limit exceeded. Retry in ${rate.retryAfterSeconds}s.` });
      return;
    }

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

    if (challenge.purpose !== 'registration' && challenge.purpose !== 'passkey_enrollment') {
      res.status(400).json({ success: false, error: 'Invalid challenge purpose for passkey registration' });
      return;
    }

    if (challenge.user_id !== body.user_id) {
      challenge.failed_attempts += 1;
      addSecurityEvent({
        user_id: body.user_id,
        event_type: 'passkey_registration_challenge_hijack_blocked',
        severity: 'critical',
        details: { challenge_id: challenge.id, expected_user: challenge.user_id, provided_user: body.user_id },
        ip_address: clientIp,
      });
      res.status(403).json({ success: false, error: 'Challenge ownership mismatch' });
      return;
    }

    if (challenge.failed_attempts >= 4) {
      res.status(429).json({ success: false, error: 'Registration challenge locked due to repeated verification failures' });
      return;
    }

    const user = users.find((u) => u.id === body.user_id);
    if (!user) {
      res.status(404).json({ success: false, error: 'User account not found' });
      return;
    }

    const verification = await verifyWebAuthnRegistrationCredential(
      body.credential,
      challenge.challenge,
      challenge.origin || `${req.protocol}://${req.get('host')}`,
      challenge.rp_id || req.hostname || 'localhost'
    );

    if (!verification.ok) {
      challenge.failed_attempts += 1;
      addSecurityEvent({
        user_id: user.id,
        event_type: 'passkey_registration_verification_failed',
        severity: 'warning',
        details: { reason: verification.error, attempts: challenge.failed_attempts },
        ip_address: clientIp,
      });
      res.status(verification.status || 400).json({
        success: false,
        error: verification.error || 'WebAuthn passkey registration verification failed',
      });
      return;
    }

    passkeyCredentials.push({
      id: verification.credentialId,
      user_id: user.id,
      public_key: verification.publicKeySpkiB64Url,
      algorithm: verification.algorithm,
      sign_count: verification.signCount,
      device_name: String(body.credential.device_name || 'Primary Passkey Authenticator'),
      transports: Array.isArray(body.credential.transports)
        ? body.credential.transports
        : ['internal', 'hybrid'],
      created_at: new Date().toISOString(),
    });

    user.status = 'active';
    user.is_active = true;
    user.updated_at = new Date().toISOString();

    let personalOrg = organizations.find((o) =>
      organizationMemberships.some((m) => m.organization_id === o.id && m.user_id === user.id)
    );
    if (!personalOrg) {
      const orgId = generateSecureId('org');
      personalOrg = {
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
    }

    const sessionToken = generateSecureToken(32);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const session: AuthSession = {
      id: sessionToken,
      user_id: user.id,
      organization_id: personalOrg.id,
      ip_address: clientIp,
      user_agent: req.header('user-agent'),
      is_revoked: false,
      last_active_at: new Date().toISOString(),
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    };
    authSessions.push(session);
    challenge.is_used = true;

    addSecurityEvent({
      user_id: user.id,
      event_type: 'passkey_registered_account_activated',
      severity: 'info',
      details: { credential_id: verification.credentialId },
      ip_address: clientIp,
    });

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
      user: { ...user, status: 'active', is_active: true },
      workspace: personalOrg,
    });
  });

  // Enroll Additional Passkey Challenge (Authenticated)
  app.post('/api/auth/passkeys/enroll-challenge', (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    if (!auth) {
      res.status(401).json({ success: false, error: 'Authentication required to enroll a new passkey' });
      return;
    }

    const challengeToken = generateSecureToken(32);
    const challengeId = generateSecureId('chg');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const rpId = req.hostname || 'localhost';

    authChallenges.push({
      id: challengeId,
      challenge: challengeToken,
      purpose: 'passkey_enrollment',
      user_id: auth.user.id,
      email: auth.user.email,
      origin: `${req.protocol}://${req.get('host')}`,
      rp_id: rpId,
      failed_attempts: 0,
      is_used: false,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });
    savePersistedState();

    res.json({
      success: true,
      user_id: auth.user.id,
      challenge_id: challengeId,
      options: {
        challenge: challengeToken,
        rp: { name: 'AetherOS Platform', id: rpId },
        user: {
          id: auth.user.id,
          name: auth.user.email,
          displayName: auth.user.name,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        timeout: 60000,
      },
    });
  });

  // Login Challenge
  app.post('/api/auth/login/challenge', async (req: Request, res: Response) => {
    const clientIp = req.ip || 'local';
    const rate = checkRateLimit(`login_challenge:${clientIp}`, 30, 60_000);
    if (!rate.allowed) {
      res.status(429).json({ success: false, error: `Too many login requests. Retry in ${rate.retryAfterSeconds}s.` });
      return;
    }

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
    if (user.status !== 'active') {
      res.status(403).json({
        success: false,
        error: 'Account registration is incomplete. Please complete passkey verification first.',
      });
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
    savePersistedState();

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
    const clientIp = req.ip || 'local';
    const rate = checkRateLimit(`login_passkey:${clientIp}`, 25, 60_000);
    if (!rate.allowed) {
      res.status(429).json({ success: false, error: `Too many login attempts. Retry in ${rate.retryAfterSeconds}s.` });
      return;
    }

    const body = req.body || {};
    const credentialId = body.credential_id || body.credential?.id;
    if (!body.challenge_id || !credentialId) {
      res.status(400).json({ success: false, error: 'Missing challenge_id or credential_id' });
      return;
    }

    const challenge = authChallenges.find((c) => c.id === body.challenge_id);
    if (!challenge || challenge.is_used || new Date(challenge.expires_at).getTime() < Date.now()) {
      res.status(400).json({ success: false, error: 'Authentication challenge invalid or expired.' });
      return;
    }

    if (challenge.purpose !== 'login') {
      res.status(400).json({ success: false, error: 'Invalid challenge purpose for passkey login' });
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

    const passkey = passkeyCredentials.find((p) => p.id === String(credentialId));
    if (!passkey || (challenge.user_id && passkey.user_id !== challenge.user_id)) {
      challenge.failed_attempts += 1;
      savePersistedState();
      res.status(401).json({
        success: false,
        error: `Unrecognized passkey credential. Attempt ${challenge.failed_attempts}/4`,
        remaining_attempts: Math.max(0, 4 - challenge.failed_attempts),
      });
      return;
    }

    const clientDataJSON = body.clientDataJSON || body.credential?.response?.clientDataJSON;
    if (!clientDataJSON || typeof clientDataJSON !== 'string') {
      challenge.failed_attempts += 1;
      savePersistedState();
      res.status(400).json({
        success: false,
        error: `Missing WebAuthn clientDataJSON assertion. Attempt ${challenge.failed_attempts}/4`,
        remaining_attempts: Math.max(0, 4 - challenge.failed_attempts),
      });
      return;
    }

    const cdCheck = verifyWebAuthnChallenge(
      clientDataJSON,
      challenge.challenge,
      challenge.origin || `${req.protocol}://${req.get('host')}`,
      'webauthn.get'
    );
    if (!cdCheck.ok) {
      challenge.failed_attempts += 1;
      savePersistedState();
      res.status(401).json({
        success: false,
        error: `${cdCheck.error || 'Challenge mismatch'}. Attempt ${challenge.failed_attempts}/4`,
        remaining_attempts: Math.max(0, 4 - challenge.failed_attempts),
      });
      return;
    }

    const authenticatorData = body.authenticatorData || body.credential?.response?.authenticatorData;
    const signature = body.signature || body.credential?.response?.signature;
    let nextSignCount = passkey.sign_count + 1;

    if (authenticatorData && typeof authenticatorData === 'string') {
      const parsedAuth = await parseAndVerifyAuthenticatorData(
        authenticatorData,
        challenge.rp_id || req.hostname || 'localhost',
        true
      );
      if (!parsedAuth.ok) {
        challenge.failed_attempts += 1;
        savePersistedState();
        res.status(401).json({
          success: false,
          error: `${parsedAuth.error}. Attempt ${challenge.failed_attempts}/4`,
          remaining_attempts: Math.max(0, 4 - challenge.failed_attempts),
        });
        return;
      }
      if (passkey.sign_count > 0 && parsedAuth.signCount > 0 && parsedAuth.signCount <= passkey.sign_count) {
        challenge.failed_attempts += 1;
        addSecurityEvent({
          user_id: passkey.user_id,
          event_type: 'passkey_cloned_authenticator_detected',
          severity: 'critical',
          details: {
            credential_id: passkey.id,
            stored_sign_count: passkey.sign_count,
            received_sign_count: parsedAuth.signCount,
          },
          ip_address: clientIp,
        });
        res.status(401).json({
          success: false,
          error: 'Credential replay detected: authenticator signature counter did not advance',
        });
        return;
      }
      if (parsedAuth.signCount > passkey.sign_count) {
        nextSignCount = parsedAuth.signCount;
      }
    }

    if (authenticatorData && signature) {
      const sigOk = await verifyWebAuthnAssertionSignature(
        passkey.public_key,
        passkey.algorithm,
        authenticatorData,
        clientDataJSON,
        signature
      );
      if (!sigOk) {
        challenge.failed_attempts += 1;
        savePersistedState();
        res.status(401).json({
          success: false,
          error: `Cryptographic passkey signature verification failed. Attempt ${challenge.failed_attempts}/4`,
          remaining_attempts: Math.max(0, 4 - challenge.failed_attempts),
        });
        return;
      }
    }

    const user = users.find((u) => u.id === passkey.user_id);
    if (!user || user.status !== 'active') {
      res.status(403).json({ success: false, error: 'User account is not active' });
      return;
    }

    passkey.sign_count = nextSignCount;
    passkey.last_used_at = new Date().toISOString();
    challenge.is_used = true;

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
      ip_address: clientIp,
      user_agent: req.header('user-agent'),
      is_revoked: false,
      last_active_at: new Date().toISOString(),
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });
    savePersistedState();

    res.cookie('aether_session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      session_token: sessionToken,
      user: { ...user, is_active: true },
      workspace: activeOrg,
    });
  });

  // TOTP Login Verification
  app.post('/api/auth/login/totp', async (req: Request, res: Response) => {
    const clientIp = req.ip || 'local';
    const rate = checkRateLimit(`login_totp:${clientIp}`, 20, 60_000);
    if (!rate.allowed) {
      res.status(429).json({ success: false, error: `Too many TOTP attempts. Retry in ${rate.retryAfterSeconds}s.` });
      return;
    }

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
    const verifyOutcome = await verifyTotpCode(secret || '', String(body.code), totp.last_verified_counter);

    if (!verifyOutcome.valid) {
      challenge.failed_attempts += 1;
      savePersistedState();
      res.status(401).json({
        success: false,
        error: `Invalid authenticator code. Attempt ${challenge.failed_attempts}/4`,
        remaining_attempts: Math.max(0, 4 - challenge.failed_attempts),
      });
      return;
    }

    const user = users.find((u) => u.id === challenge.user_id);
    if (!user || user.status !== 'active') {
      res.status(403).json({ success: false, error: 'User account is not active' });
      return;
    }

    totp.last_verified_counter = verifyOutcome.counter;
    challenge.is_used = true;

    const userOrgs = organizations.filter((o) =>
      organizationMemberships.some((m) => m.organization_id === o.id && m.user_id === user.id)
    );

    const sessionToken = generateSecureToken(32);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    authSessions.push({
      id: sessionToken,
      user_id: user.id,
      organization_id: userOrgs[0]?.id,
      ip_address: clientIp,
      user_agent: req.header('user-agent'),
      is_revoked: false,
      last_active_at: new Date().toISOString(),
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });
    savePersistedState();

    res.cookie('aether_session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      session_token: sessionToken,
      user: { ...user, is_active: true },
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
    savePersistedState();

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
    const sanitizedPasskeys = userPasskeys.map((p) => ({
      id: p.id,
      device_name: p.device_name,
      transports: p.transports,
      sign_count: p.sign_count,
      created_at: p.created_at,
      last_used_at: p.last_used_at,
    }));

    res.json({
      authenticated: true,
      user: { ...auth.user, is_active: auth.user.status === 'active' },
      workspace: userOrgs[0] || null,
      active_workspace: userOrgs[0] || null,
      current_organization: userOrgs[0] || null,
      workspaces: userOrgs,
      organizations: userOrgs,
      passkeys: sanitizedPasskeys,
      passkeys_count: userPasskeys.length,
      has_totp: Boolean(userTotp),
      totp_enabled: Boolean(userTotp),
      owned_workers: ownedWorkers,
    });
  });

  // Logout
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const token = extractSessionTokenFromReq(req);
    if (token) {
      const s = authSessions.find((sess) => sess.id === token);
      if (s) s.is_revoked = true;
      savePersistedState();
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
    savePersistedState();
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
    savePersistedState();

    res.status(201).json({ success: true, workspace: newOrg });
  });

  // Worker Claiming & Ownership
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
    savePersistedState();

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
    const owned = auth ? workerOwnerships.filter((wo) => wo.owner_user_id === auth.user.id) : [];
    res.json({
      success: true,
      ownerships: workerOwnerships,
      workers: owned,
    });
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
    savePersistedState();

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
    savePersistedState();

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
    savePersistedState();

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
    savePersistedState();

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

  // ==========================================
  // 1.7 Cybersecurity Defensive Assessment API (Phase 10)
  // ==========================================
  app.post('/api/security/assess', async (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    const body = req.body || {};

    const outcome = await runDefensiveSecurityAssessment({
      scope: body.scope || 'full_audit',
      target_url: body.target_url,
      domain: body.domain,
      package_json: body.package_json,
      source_code: body.source_code,
      source_filename: body.source_filename,
      authorization_confirmed: Boolean(body.authorization_confirmed),
      authorized_scope_note: body.authorized_scope_note,
    });

    if (!outcome.ok) {
      addSecurityEvent({
        user_id: auth?.user?.id || 'usr_default',
        event_type: 'cybersec_assessment_rejected',
        severity: 'warning',
        details: { reason: outcome.error, target_url: body.target_url || null },
        ip_address: req.ip || 'local',
      });
      res.status(outcome.status).json({ success: false, error: outcome.error });
      return;
    }

    const report = outcome.report;
    const mdKey = `reports/security/${report.report_id}.md`;
    const jsonKey = `reports/security/${report.report_id}.json`;
    const now = new Date().toISOString();
    const mdBuffer = Buffer.from(report.markdown_report, 'utf-8');
    const jsonBuffer = Buffer.from(JSON.stringify(report, null, 2), 'utf-8');

    filesMap.set(mdKey, {
      key: mdKey,
      filename: `${report.report_id}.md`,
      contentType: 'text/markdown',
      size: mdBuffer.length,
      etag: `w/"${crypto.createHash('md5').update(mdBuffer).digest('hex').slice(0, 12)}"`,
      uploaded: now,
      storageClass: 'Standard',
      buffer: mdBuffer,
    });

    filesMap.set(jsonKey, {
      key: jsonKey,
      filename: `${report.report_id}.json`,
      contentType: 'application/json',
      size: jsonBuffer.length,
      etag: `w/"${crypto.createHash('md5').update(jsonBuffer).digest('hex').slice(0, 12)}"`,
      uploaded: now,
      storageClass: 'Standard',
      buffer: jsonBuffer,
    });

    addSecurityEvent({
      user_id: auth?.user?.id || 'usr_admin',
      event_type: 'cybersec_defensive_assessment_completed',
      severity: report.summary.critical > 0 || report.summary.high > 0 ? 'warning' : 'info',
      details: {
        report_id: report.report_id,
        target: report.target,
        scope: report.scope,
        summary: report.summary,
        r2_report_key: mdKey,
      },
      ip_address: req.ip || 'local',
    });

    res.json({
      success: true,
      report,
      artifacts: {
        markdown_key: mdKey,
        json_key: jsonKey,
      },
    });
  });

  // ==========================================
  // 1.8 Web Intelligence & Domain Reconnaissance API
  // ==========================================
  app.post('/api/intelligence/investigate', async (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    const body = req.body || {};
    const target = String(body.target || body.url || body.domain || '').trim();

    if (!target) {
      res.status(400).json({ success: false, error: 'Target URL or domain is required' });
      return;
    }

    const report = await runWebInvestigation({
      target,
      allow_localhost: process.env.NODE_ENV !== 'production',
      timeout_ms: typeof body.timeout_ms === 'number' ? body.timeout_ms : 12000,
    });

    const now = new Date().toISOString();
    const jsonKey = `reports/intelligence/${report.report_id}.json`;
    const jsonBuffer = Buffer.from(JSON.stringify(report, null, 2), 'utf-8');

    filesMap.set(jsonKey, {
      key: jsonKey,
      filename: `${report.report_id}.json`,
      contentType: 'application/json',
      size: jsonBuffer.length,
      etag: `w/"${crypto.createHash('md5').update(jsonBuffer).digest('hex').slice(0, 12)}"`,
      uploaded: now,
      storageClass: 'Standard',
      buffer: jsonBuffer,
    });

    const fileId = generateSecureId('file');
    fileMetadataList.unshift({
      id: fileId,
      r2_key: jsonKey,
      filename: `${report.report_id}.json`,
      mime_type: 'application/json',
      size_bytes: jsonBuffer.length,
      etag: `w/"${crypto.createHash('md5').update(jsonBuffer).digest('hex').slice(0, 12)}"`,
      uploaded_by: auth?.user?.id || 'usr_admin',
      storage_class: 'Standard',
      created_at: now,
    });

    res.json({
      success: true,
      report,
      report_file_id: fileId,
      artifacts: {
        json_key: jsonKey,
      },
    });
  });

  app.get('/api/security/events', (_req: Request, res: Response) => {
    res.json({ success: true, events: securityEvents.slice(0, 50) });
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
      savePersistedState();
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

  app.post('/api/tasks', async (req: Request, res: Response) => {
    const auth = getSessionUserFromReq(req);
    const body = req.body || {};
    if (!body.agent_id || !body.title) {
      res.status(400).json({ error: 'Missing required task fields: agent_id, title', success: false });
      return;
    }

    const effectiveUserId = auth?.user?.id || body.user_id || 'usr_default';
    const idempotencyKey =
      (typeof body.idempotency_key === 'string' && body.idempotency_key.trim()) ||
      req.header('Idempotency-Key')?.trim() ||
      undefined;

    if (idempotencyKey) {
      const existing = tasks.find(
        (t) => t.user_id === effectiveUserId && t.idempotency_key === idempotencyKey
      );
      if (existing) {
        res.status(200).json({ success: true, task: existing, deduplicated: true });
        return;
      }
    }

    const agent = agents.find((a) => a.id === body.agent_id);
    const now = new Date().toISOString();
    const taskId = generateSecureId('tsk');
    const inputPayload = body.input_payload && typeof body.input_payload === 'object' ? body.input_payload : {};

    const createdTask: Task = {
      id: taskId,
      agent_id: body.agent_id,
      agent_name: agent?.name || 'Autonomous Agent',
      user_id: effectiveUserId,
      workspace_id: body.workspace_id || auth?.session?.organization_id,
      idempotency_key: idempotencyKey,
      title: String(body.title).trim(),
      description: body.description || '',
      input_payload: inputPayload,
      priority: (body.priority as TaskPriority) || 'medium',
      status: 'queued',
      progress_percent: 0,
      attempt_count: 0,
      max_retries: typeof body.max_retries === 'number' ? body.max_retries : 2,
      timeout_seconds: typeof body.timeout_seconds === 'number' ? body.timeout_seconds : 300,
      created_at: now,
      updated_at: now,
      steps: [],
    };

    tasks.unshift(createdTask);

    if (body.agent_id === 'agent_cybersec' || inputPayload.task_type === 'cybersecurity_audit') {
      const secOutcome = await runDefensiveSecurityAssessment({
        scope: inputPayload.scope || 'full_audit',
        target_url: inputPayload.target_url,
        domain: inputPayload.domain,
        package_json: inputPayload.package_json,
        source_code: inputPayload.source_code || inputPayload.code,
        source_filename: inputPayload.source_filename || inputPayload.filename,
        authorization_confirmed: inputPayload.authorization_confirmed !== false,
        authorized_scope_note: inputPayload.authorized_scope_note,
      });

      if (secOutcome.ok) {
        const report = secOutcome.report;
        const mdKey = `tasks/${taskId}/${report.report_id}.md`;
        const mdBuffer = Buffer.from(report.markdown_report, 'utf-8');
        filesMap.set(mdKey, {
          key: mdKey,
          filename: `${report.report_id}.md`,
          contentType: 'text/markdown',
          size: mdBuffer.length,
          etag: `w/"${crypto.createHash('md5').update(mdBuffer).digest('hex').slice(0, 12)}"`,
          uploaded: now,
          storageClass: 'Standard',
          task_id: taskId,
          buffer: mdBuffer,
        });
        createdTask.status = 'completed';
        createdTask.progress_percent = 100;
        createdTask.completed_at = new Date().toISOString();
        createdTask.result_payload = {
          output: report.markdown_report,
          report,
          artifact_r2_key: mdKey,
          executed_by: 'agent_cybersec',
        };
        savePersistedState();
        res.status(201).json({ success: true, task: createdTask });
        return;
      } else {
        createdTask.status = 'failed';
        createdTask.error_message = secOutcome.error;
        createdTask.completed_at = new Date().toISOString();
        savePersistedState();
        res.status(secOutcome.status).json({ success: false, error: secOutcome.error, task: createdTask });
        return;
      }
    }

    // Native Web Intelligence & Domain Reconnaissance Agent execution path
    if (
      body.agent_id === 'agent_web_intelligence' ||
      inputPayload.workspace === 'web_intelligence' ||
      inputPayload.task_type === 'web_intelligence'
    ) {
      const target = String(
        inputPayload.target || inputPayload.target_url || inputPayload.url || inputPayload.domain || body.description || ''
      ).trim();

      if (!target) {
        createdTask.status = 'failed';
        createdTask.error_message = 'Target URL or domain is required';
        createdTask.completed_at = new Date().toISOString();
        savePersistedState();
        res.status(400).json({ success: false, error: 'Target URL or domain is required', task: createdTask });
        return;
      }

      const report = await runWebInvestigation({
        target,
        allow_localhost: process.env.NODE_ENV !== 'production',
        timeout_ms: typeof inputPayload.timeout_ms === 'number' ? inputPayload.timeout_ms : 12000,
      });

      const jsonKey = `reports/intelligence/${report.report_id}.json`;
      const jsonBuffer = Buffer.from(JSON.stringify(report, null, 2), 'utf-8');

      filesMap.set(jsonKey, {
        key: jsonKey,
        filename: `${report.report_id}.json`,
        contentType: 'application/json',
        size: jsonBuffer.length,
        etag: `w/"${crypto.createHash('md5').update(jsonBuffer).digest('hex').slice(0, 12)}"`,
        uploaded: now,
        storageClass: 'Standard',
        task_id: taskId,
        buffer: jsonBuffer,
      });

      createdTask.status = report.investigation_status === 'failed' ? 'failed' : 'completed';
      createdTask.progress_percent = report.investigation_status === 'failed' ? 0 : 100;
      createdTask.completed_at = new Date().toISOString();
      createdTask.result_payload = {
        output: report.executive_summary,
        report,
        artifact_r2_key: jsonKey,
        executed_by: 'agent_web_intelligence',
      };
      if (report.failure_reason) {
        createdTask.error_message = report.failure_reason;
      }

      savePersistedState();
      res.status(201).json({ success: true, task: createdTask, report });
      return;
    }

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
      savePersistedState();
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
    approval.decided_by = body.reviewer_id || 'usr_admin';
    approval.review_comment =
      body.comment ||
      (body.decision === 'approved' ? 'Action authorized by human operator' : 'Action declined');

    const task = tasks.find((t) => t.id === approval.task_id);
    if (task) {
      if (body.decision === 'approved') {
        task.status = 'queued';
        task.updated_at = now;
      } else {
        task.status = 'cancelled';
        task.error_message = `Rejected in authorization queue: ${body.comment || 'No reason provided'}`;
        task.completed_at = now;
        task.updated_at = now;
      }
    }

    addLog({
      action: `approval_${body.decision}`,
      category: 'approval',
      task_id: approval.task_id,
      task_title: approval.task_title,
      agent_id: approval.agent_id,
      agent_name: approval.agent_name,
      details: { approval_id: approvalId, decision: body.decision, comment: approval.review_comment },
    });

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
  app.get('/api/files', (req: Request, res: Response) => {
    const taskId = typeof req.query.task_id === 'string' ? req.query.task_id : undefined;
    const allFiles = Array.from(filesMap.values());
    const filtered = taskId ? allFiles.filter((f) => f.task_id === taskId || f.key.startsWith(`tasks/${taskId}/`)) : allFiles;
    const list = filtered.map((f) => ({
      key: f.key,
      size: f.size,
      etag: f.etag,
      httpMetadata: { contentType: f.contentType },
      uploaded: f.uploaded,
      storageClass: f.storageClass,
      task_id: f.task_id,
    }));
    const metadata = taskId
      ? fileMetadataList.filter((m) => m.task_id === taskId)
      : fileMetadataList;
    res.json({ success: true, files: list, metadata });
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
    fileMetadataList = fileMetadataList.filter((m) => m.r2_key !== key);
    addLog({
      action: 'file_deleted_r2',
      category: 'file',
      details: { key },
    });
    res.json({ success: true, message: `File ${key} deleted from R2` });
  });

  // 7. Distributed Compute Workers Grid API

  app.get('/api/workers', (_req: Request, res: Response) => {
    reapExpiredLeases();
    res.json({ success: true, workers: workers.map(sanitizePublicWorker) });
  });

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
    const workerId =
      typeof body.worker_id === 'string' && body.worker_id.trim()
        ? body.worker_id.trim()
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
        ? body.capabilities.map((c: unknown) => String(c)).slice(0, 32)
        : ['text', 'code'],
      loaded_models: Array.isArray(body.loaded_models)
        ? body.loaded_models.map((m: unknown) => String(m)).slice(0, 64)
        : [],
      gpu_devices: Array.isArray(body.gpu_devices) ? body.gpu_devices.slice(0, 16) : [],
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
    workers = workers.filter((w) => w.id !== workerId);
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
    if (Array.isArray(body.loaded_models)) {
      worker.loaded_models = body.loaded_models.map((m: unknown) => String(m));
    }
    if (Array.isArray(body.gpu_devices)) {
      worker.gpu_devices = body.gpu_devices;
    }
    if (Array.isArray(body.capabilities)) {
      worker.capabilities = body.capabilities.map((c: unknown) => String(c));
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
    savePersistedState();

    res.json({
      success: true,
      worker: sanitizePublicWorker(worker),
      timestamp: now,
    });
  });

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

  // 7f. Authenticated worker capability-aware atomic task claiming
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
      .filter(
        (t) =>
          (t.status === 'pending' || t.status === 'queued' || t.status === 'scheduled' || t.status === 'retrying') &&
          !t.claimed_by_worker
      )
      .sort((a, b) => {
        const diff = (priorityRank[a.priority] || 4) - (priorityRank[b.priority] || 4);
        if (diff !== 0) return diff;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

    const modelMap = new Map(models.map((m) => [m.id, m]));
    const workerCaps = new Set((worker.capabilities || []).map((c) => c.toLowerCase()));
    const workerLoadedModels = new Set((worker.loaded_models || []).map((m) => m.toLowerCase()));

    let matchedTask: Task | undefined;
    for (const candidate of candidates) {
      const payload = (candidate.input_payload || {}) as Record<string, unknown>;
      const requestedModelId = typeof payload.model === 'string' ? payload.model : undefined;
      const modelSpec = requestedModelId ? modelMap.get(requestedModelId) : undefined;

      const requireGpu = payload.require_gpu === true || (modelSpec ? modelSpec.min_vram_mb > 0 : false);
      if (requireGpu && worker.gpu_count <= 0) {
        continue;
      }

      const minGpuCount = Number(payload.min_gpu_count || 0);
      if (Number.isFinite(minGpuCount) && minGpuCount > 0 && worker.gpu_count < minGpuCount) {
        continue;
      }

      const explicitMinVram = Number(payload.min_vram_mb || 0);
      const modelMinVram = modelSpec ? modelSpec.min_vram_mb : 0;
      const effectiveMinVram = Math.max(
        Number.isFinite(explicitMinVram) ? explicitMinVram : 0,
        modelMinVram
      );
      if (effectiveMinVram > 0 && worker.vram_mb < effectiveMinVram) {
        continue;
      }

      const explicitMinRam = Number(payload.min_system_ram_mb || 0);
      const modelMinRam = modelSpec?.min_system_ram_mb || 0;
      const effectiveMinRam = Math.max(
        Number.isFinite(explicitMinRam) ? explicitMinRam : 0,
        modelMinRam
      );
      if (effectiveMinRam > 0 && worker.system_ram_mb < effectiveMinRam) {
        continue;
      }

      const requiredCaps: string[] = [];
      if (typeof payload.required_capability === 'string' && payload.required_capability.trim()) {
        requiredCaps.push(payload.required_capability.trim().toLowerCase());
      }
      if (Array.isArray(payload.required_capabilities)) {
        for (const c of payload.required_capabilities) {
          if (typeof c === 'string' && c.trim()) requiredCaps.push(c.trim().toLowerCase());
        }
      }
      if (requiredCaps.length > 0) {
        const hasAllCaps = requiredCaps.every(
          (reqCap) => workerCaps.has(reqCap) || workerLoadedModels.has(reqCap)
        );
        if (!hasAllCaps) continue;
      }

      if (payload.require_loaded_model === true && requestedModelId) {
        if (!workerLoadedModels.has(requestedModelId.toLowerCase())) {
          continue;
        }
      }

      matchedTask = candidate;
      break;
    }

    if (!matchedTask) {
      res.json({ success: true, task: null, message: 'No compatible tasks currently queued for execution' });
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

  // 7g. Authenticated worker task inspection
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
    savePersistedState();

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
        if (uploaded.size > MAX_UPLOAD_BYTES) {
          res.status(413).json({ error: 'Artifact size exceeds 50 MB limit', success: false });
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

      if (buffer.length > MAX_UPLOAD_BYTES) {
        res.status(413).json({ error: 'Artifact size exceeds 50 MB limit', success: false });
        return;
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

      fileMetadataList.unshift({
        id: generateSecureId('file'),
        r2_key: key,
        filename: safeName,
        mime_type: mimeType,
        size_bytes: buffer.length,
        etag,
        uploaded_by: 'usr_default',
        task_id: taskId,
        storage_class: 'Standard',
        created_at: now,
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
      body.result_payload === undefined ||
      typeof body.result_payload !== 'object' ||
      body.result_payload === null ||
      Array.isArray(body.result_payload) ||
      Object.keys(body.result_payload).length === 0
    ) {
      res.status(400).json({
        error: 'Cannot mark task completed with an empty result_payload; provide execution output or artifact references',
        success: false,
      });
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
    task.result_payload = body.result_payload;
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

    const maxRetries = task.max_retries ?? 2;
    const attempts = task.attempt_count ?? 1;
    const shouldRetry = Boolean(body.retryable) && attempts <= maxRetries;

    if (shouldRetry) {
      task.status = 'queued';
      task.error_message = `[Retry ${attempts}/${maxRetries}]: ${errorMessage}`;
      task.claimed_by_worker = undefined;
      task.lease_expires_at = undefined;
      task.progress_percent = 0;
      task.updated_at = now;
    } else {
      task.status = 'failed';
      task.error_message = errorMessage;
      task.lease_expires_at = undefined;
      task.completed_at = now;
      task.updated_at = now;
    }

    const worker = auth.worker;
    worker.status = 'online';
    worker.current_task_id = undefined;
    worker.current_task_title = undefined;
    worker.lease_expires_at = leaseExpiresAt;
    worker.updated_at = now;

    addLog({
      action: shouldRetry ? 'task_requeued_for_retry' : 'task_failed_by_worker',
      category: 'task',
      task_id: taskId,
      task_title: task.title,
      details: { worker_id: worker.id, error: errorMessage, retried: shouldRetry },
    });

    res.json({
      success: true,
      retried: shouldRetry,
      message: shouldRetry ? 'Task re-queued for retry' : 'Task marked failed',
    });
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
    savePersistedState();
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
    savePersistedState();
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
    savePersistedState();

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

    const agent = body.agent_id ? agents.find((a) => a.id === body.agent_id) : undefined;
    const targetModel = body.model || agent?.model || 'qwen-2.5-coder-14b';
    const activeWorkers = workers.filter((w) => w.status === 'online' || w.status === 'busy');

    if (activeWorkers.length === 0) {
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
      savePersistedState();

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
    savePersistedState();

    res.json({
      success: true,
      task: createdTask,
      user_message: userMsg,
      conversation_id: convId,
      active_workers: activeWorkers.length,
    });
  });

  // ==========================================
  // 11. Repository & Git Operations API
  // ==========================================

  // Get workspace repo file tree
  app.get('/api/repo/tree', async (req: Request, res: Response) => {
    try {
      const depth = parseInt(String(req.query.depth || '4'), 10);
      const tree = await getRepoTree(depth);
      res.json({ success: true, tree });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Read a specific file from repo
  app.get('/api/repo/file', async (req: Request, res: Response) => {
    try {
      const filePath = String(req.query.path || '');
      if (!filePath) {
        res.status(400).json({ success: false, error: 'Missing path parameter' });
        return;
      }
      const data = await readRepoFile(filePath);
      res.json({ success: true, file: data });
    } catch (err: any) {
      res.status(404).json({ success: false, error: err.message });
    }
  });

  // Write/edit a specific file in repo
  app.post('/api/repo/file', async (req: Request, res: Response) => {
    try {
      const { path: filePath, content } = req.body || {};
      if (!filePath || typeof content !== 'string') {
        res.status(400).json({ success: false, error: 'Missing path or content in body' });
        return;
      }
      const data = await writeRepoFile(filePath, content);
      addLog({
        action: 'repo_file_modified',
        category: 'file',
        details: { path: filePath, size: data.size },
      });
      res.json({ success: true, ...data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get git status
  app.get('/api/repo/git/status', async (_req: Request, res: Response) => {
    try {
      const status = await getGitStatus();
      res.json({ success: true, status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get git diff
  app.get('/api/repo/git/diff', async (req: Request, res: Response) => {
    try {
      const filePath = req.query.path ? String(req.query.path) : undefined;
      const diff = await getGitDiff(filePath);
      res.json({ success: true, ...diff });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Stage git files
  app.post('/api/repo/git/stage', async (req: Request, res: Response) => {
    try {
      const { paths } = req.body || {};
      const result = await stageGitFiles(paths);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Commit git changes
  app.post('/api/repo/git/commit', async (req: Request, res: Response) => {
    try {
      const { message, stage_all } = req.body || {};
      if (!message) {
        res.status(400).json({ success: false, error: 'Commit message is required' });
        return;
      }
      const result = await commitGit(message, stage_all !== false);
      addLog({
        action: 'git_committed',
        category: 'system',
        details: { commitHash: result.commitHash, message: result.message },
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Push git commits
  app.post('/api/repo/git/push', async (req: Request, res: Response) => {
    try {
      const { branch, remote, token } = req.body || {};
      const result = await pushGit({ branch, remote, token });
      addLog({
        action: 'git_pushed',
        category: 'system',
        details: { branch: branch || 'main' },
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 12. Model Context Protocol (MCP) API
  // ==========================================

  // List all MCP servers
  app.get('/api/mcp/servers', (_req: Request, res: Response) => {
    res.json({
      success: true,
      servers: mcpManager.getServers(),
      templates: mcpManager.getPopularTemplates(),
    });
  });

  // List popular MCP server templates
  app.get('/api/mcp/templates', (_req: Request, res: Response) => {
    res.json({ success: true, templates: mcpManager.getPopularTemplates() });
  });

  // Add custom or template-based external MCP server
  app.post('/api/mcp/servers', (req: Request, res: Response) => {
    try {
      const { name, description, endpoint, transport, provider, category, templateId, config } = req.body || {};
      if (!templateId && (!name || !endpoint)) {
        res.status(400).json({ success: false, error: 'Name and endpoint (or templateId) are required' });
        return;
      }
      const server = mcpManager.addCustomServer({
        name,
        description,
        endpoint,
        transport,
        provider,
        category,
        templateId,
        config,
      });
      res.status(201).json({ success: true, server });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Configure MCP server credentials (e.g., Cloudflare Token, GitHub PAT)
  app.post('/api/mcp/servers/:id/configure', (req: Request, res: Response) => {
    try {
      const { config } = req.body || {};
      const updated = mcpManager.configureServer(req.params.id, config || {});
      if (!updated) {
        res.status(404).json({ success: false, error: 'MCP server not found' });
        return;
      }
      res.json({ success: true, server: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Toggle MCP server
  app.post('/api/mcp/servers/:id/toggle', (req: Request, res: Response) => {
    const { enabled } = req.body || {};
    const ok = mcpManager.toggleServer(req.params.id, Boolean(enabled));
    res.json({ success: ok });
  });

  // Remove custom MCP server
  app.delete('/api/mcp/servers/:id', (req: Request, res: Response) => {
    const ok = mcpManager.removeCustomServer(req.params.id);
    res.json({ success: ok });
  });

  // List all available MCP tools
  app.get('/api/mcp/tools', (_req: Request, res: Response) => {
    res.json({ success: true, tools: mcpManager.getAllTools() });
  });

  // Execute MCP tool directly
  app.post('/api/mcp/tools/execute', async (req: Request, res: Response) => {
    try {
      const { tool, arguments: args } = req.body || {};
      if (!tool) {
        res.status(400).json({ success: false, error: 'Missing tool name' });
        return;
      }
      const result = await mcpManager.executeTool(tool, args || {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 13. AetherOS Coding Assistant & Manual API
  // ==========================================

  // Get available models & saved manual API config
  app.get('/api/ai/models', (_req: Request, res: Response) => {
    res.json({
      success: true,
      models: AVAILABLE_MODELS,
      manual_api_config: getSavedManualApiConfig(),
    });
  });

  // Save manual API configuration
  app.post('/api/ai/manual-config', (req: Request, res: Response) => {
    try {
      const updated = updateSavedManualApiConfig(req.body || {});
      res.json({ success: true, manual_api_config: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Test manual API connection
  app.post('/api/ai/test-connection', async (req: Request, res: Response) => {
    try {
      const result = await testManualApiConnection(req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Process coding assistant chat request
  app.post('/api/ai/chat', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
        res.status(400).json({ success: false, error: 'Message is required' });
        return;
      }

      const response = await processAiStudioChat(body);
      res.json({ success: true, ...response });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/reset', (_req: Request, res: Response) => {
    agents = createInitialAgents();
    tasks = createInitialTasks();
    approvals = createInitialApprovals();
    filesMap = createInitialFiles();
    fileMetadataList = [];
    initialWorkerState = createInitialWorkers();
    workers = initialWorkerState.workers;
    workerAuthMap = initialWorkerState.authMap;
    workerNonceMap.clear();
    rateLimitMap.clear();
    logs = createInitialLogs();
    conversations = [];
    messages = [];
    savePersistedState();
    res.json({ success: true, message: 'Platform state reset to defaults' });
  });

  app.all('/api/*', (req: Request, res: Response) => {
    res.status(404).json({ error: `Endpoint not found: ${req.path}`, success: false });
  });

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
