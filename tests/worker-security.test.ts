import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import workerHandler from '../worker/index.ts';
import {
  computeKeyFingerprint,
  constantTimeEqual,
  generateSecureId,
  generateWorkerApiKey,
  normalizeStepNumber,
  normalizeWorkerProgressStatus,
  redactSecrets,
  sha256Bytes,
  verifyApiKeyHash,
  verifySharedSecretConstantTime,
  encryptSecret,
  decryptSecret,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  base64UrlEncode,
  base64UrlDecode,
} from '../worker/auth.ts';
import type {
  D1Database,
  D1PreparedStatement,
  Env,
  R2Bucket,
  R2Object,
  R2ObjectBody,
  R2Objects,
} from '../worker/types.ts';
import { createAetherApp } from '../server.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function loadMigrationSql(filename: string): string {
  return fs.readFileSync(path.join(ROOT_DIR, 'migrations', filename), 'utf-8');
}

/**
 * Faithful Cloudflare D1 adapter backed by Node 22 built-in node:sqlite DatabaseSync.
 */
class SqliteD1Adapter implements D1Database {
  public readonly sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
  }

  prepare(sql: string): D1PreparedStatement {
    return new SqliteD1PreparedStatement(this.sqlite, sql, []);
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<any[]> {
    const out: any[] = [];
    for (const stmt of statements) {
      out.push(await stmt.all<T>());
    }
    return out;
  }

  async exec(query: string): Promise<any> {
    this.sqlite.exec(query);
    return { count: 1, duration: 1 };
  }
}

class SqliteD1PreparedStatement implements D1PreparedStatement {
  private readonly sqlite: DatabaseSync;
  private readonly sql: string;
  private readonly params: unknown[];

  constructor(sqlite: DatabaseSync, sql: string, params: unknown[]) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1PreparedStatement(
      this.sqlite,
      this.sql,
      values.map((v) => (v === undefined ? null : v))
    );
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const stmt = this.sqlite.prepare(this.sql);
    const row = stmt.get(...(this.params as any[])) as Record<string, any> | undefined;
    if (!row) return null;
    if (colName) {
      return (row[colName] as T) ?? null;
    }
    return { ...row } as T;
  }

  async run<T = unknown>(): Promise<{ success: boolean; results: T[]; meta: Record<string, any> }> {
    const stmt = this.sqlite.prepare(this.sql);
    const res = stmt.run(...(this.params as any[]));
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(res.changes ?? 0),
        last_row_id: Number(res.lastInsertRowid ?? 0),
      },
    };
  }

  async all<T = unknown>(): Promise<{ success: boolean; results: T[]; meta: Record<string, any> }> {
    const stmt = this.sqlite.prepare(this.sql);
    const rows = stmt.all(...(this.params as any[])) as T[];
    return {
      success: true,
      results: rows.map((r: any) => ({ ...r })),
      meta: {},
    };
  }
}

interface StoredR2Entry {
  key: string;
  bytes: Uint8Array;
  etag: string;
  uploaded: Date;
  httpMetadata: { contentType?: string };
  customMetadata: Record<string, string>;
}

/**
 * In-memory Cloudflare R2Bucket test double with full body, metadata, and prefix listing support.
 */
class MemoryR2Bucket implements R2Bucket {
  private readonly objects = new Map<string, StoredR2Entry>();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | null,
    options?: any
  ): Promise<R2Object> {
    let bytes: Uint8Array;
    if (value === null) {
      bytes = new Uint8Array(0);
    } else if (typeof value === 'string') {
      bytes = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else {
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        if (chunk) chunks.push(chunk);
      }
      const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
      bytes = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
      }
    }

    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    const etag = `w/"${Buffer.from(digest).toString('hex').slice(0, 16)}"`;
    const entry: StoredR2Entry = {
      key,
      bytes,
      etag,
      uploaded: new Date(),
      httpMetadata: options?.httpMetadata || {},
      customMetadata: options?.customMetadata || {},
    };
    this.objects.set(key, entry);
    return this.toR2ObjectBody(entry);
  }

  private toR2ObjectBody(entry: StoredR2Entry): R2ObjectBody {
    return {
      key: entry.key,
      version: 'v1',
      size: entry.bytes.byteLength,
      etag: entry.etag,
      httpMetadata: entry.httpMetadata,
      customMetadata: entry.customMetadata,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(entry.bytes);
          controller.close();
        },
      }),
      arrayBuffer: async () =>
        entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength) as ArrayBuffer,
      text: async () => new TextDecoder().decode(entry.bytes),
      json: async <T>() => JSON.parse(new TextDecoder().decode(entry.bytes)) as T,
    };
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const entry = this.objects.get(key);
    return entry ? this.toR2ObjectBody(entry) : null;
  }

  async delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) {
      this.objects.delete(k);
    }
  }

  async list(options?: { prefix?: string; limit?: number }): Promise<R2Objects> {
    const prefix = options?.prefix || '';
    const limit = options?.limit ?? 1000;
    const matched: R2Object[] = [];
    for (const entry of this.objects.values()) {
      if (entry.key.startsWith(prefix)) {
        matched.push(this.toR2ObjectBody(entry));
        if (matched.length >= limit) break;
      }
    }
    return { objects: matched, truncated: false };
  }
}

function createMigratedWorkerEnv(extraEnv: Partial<Env> = {}): {
  env: Env;
  sqlite: DatabaseSync;
  r2: MemoryR2Bucket;
} {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(loadMigrationSql('0001_initial_schema.sql'));
  sqlite.exec(loadMigrationSql('0002_distributed_compute.sql'));
  sqlite.exec(loadMigrationSql('0003_worker_security.sql'));
  sqlite.exec(loadMigrationSql('0004_accounts_and_sessions.sql'));

  const db = new SqliteD1Adapter(sqlite);
  const r2 = new MemoryR2Bucket();

  const env: Env = {
    DB: db,
    FILES_BUCKET: r2,
    ENVIRONMENT: 'test',
    INFERENCE_RUNTIME_URL: '',
    RUNTIME_API_KEY: 'operator_secret_key_for_testing_123456',
    JWT_SECRET: 'jwt_test_secret_1234567890',
    WORKER_AUTH_PEPPER: 'test_pepper_32_bytes_minimum_entropy_key',
    REQUIRE_WORKER_NONCE: 'true',
    ...extraEnv,
  };

  return { env, sqlite, r2 };
}

let nonceCounter = 0;
function workerHeaders(
  apiKey: string,
  workerId?: string,
  overrides: Record<string, string> = {}
): Record<string, string> {
  nonceCounter += 1;
  return {
    Authorization: `Bearer ${apiKey}`,
    'X-Worker-Timestamp': String(Date.now()),
    'X-Worker-Nonce': `nonce_${nonceCounter}_${crypto.randomUUID()}`,
    ...(workerId ? { 'X-Worker-Id': workerId } : {}),
    'Content-Type': 'application/json',
    ...overrides,
  };
}

async function callWorker(
  env: Env,
  method: string,
  pathWithQuery: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any; rawText: string }> {
  const url = `https://aetheros-test.workers.dev${pathWithQuery}`;
  const init: RequestInit = {
    method,
    headers: {
      ...(body !== undefined && typeof body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : typeof body === 'string' || body instanceof FormData
        ? (body as BodyInit)
        : JSON.stringify(body),
  };
  if (body !== undefined && typeof body !== 'string' && !(body instanceof FormData)) {
    (init.headers as Record<string, string>)['Content-Type'] ??= 'application/json';
  }
  const req = new Request(url, init);
  const res = await workerHandler.fetch(req, env);
  const rawText = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = rawText;
  }
  return { status: res.status, data, rawText };
}

describe('1. Cryptographic Primitives & Key Hashing (worker/auth.ts)', () => {
  it('generates 256-bit salted worker API keys and verifies in constant time with/without pepper', async () => {
    const pepper = 'prod_hmac_pepper_secret_v1';
    const generated = await generateWorkerApiKey(pepper);

    assert.match(generated.rawKey, /^ak_live_[0-9a-f]{64}$/);
    assert.equal(generated.keyPrefix, generated.rawKey.slice(0, 16));
    assert.ok(generated.storedHash.startsWith('hmac-sha256$'));
    assert.equal(generated.keyFingerprint.length, 64);

    assert.equal(await verifyApiKeyHash(generated.rawKey, generated.storedHash, pepper), true);
    assert.equal(await verifyApiKeyHash(generated.rawKey, generated.storedHash, 'wrong_pepper'), false);
    assert.equal(await verifyApiKeyHash(generated.rawKey + '00', generated.storedHash, pepper), false);
    assert.equal(await verifyApiKeyHash(generated.rawKey, `revoked$00$00`, pepper), false);

    // Unpeppered salted SHA-256 mode
    const unpeppered = await generateWorkerApiKey();
    assert.ok(unpeppered.storedHash.startsWith('sha256$'));
    assert.equal(await verifyApiKeyHash(unpeppered.rawKey, unpeppered.storedHash), true);
    assert.equal(
      await computeKeyFingerprint(generated.rawKey, pepper),
      generated.keyFingerprint
    );
  });

  it('compares byte arrays and shared secrets accurately without length exceptions', async () => {
    const [d1, d2, d3] = await Promise.all([
      sha256Bytes('super_secret_registration_token'),
      sha256Bytes('super_secret_registration_token'),
      sha256Bytes('super_secret_registration_tokem'),
    ]);
    assert.equal(constantTimeEqual(d1, d2), true);
    assert.equal(constantTimeEqual(d1, d3), false);
    assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);

    assert.equal(await verifySharedSecretConstantTime('token_abc_123', 'token_abc_123'), true);
    assert.equal(await verifySharedSecretConstantTime('short', 'very_long_expected_secret'), false);
    assert.equal(await verifySharedSecretConstantTime(undefined, 'secret'), false);
  });

  it('redacts raw worker keys, bearer headers, and salted hashes from log strings', () => {
    const sample =
      'Auth failed for Authorization: Bearer ak_live_1234567890abcdef1234567890abcdef hash=hmac-sha256$aabbccdd$112233445566';
    const cleaned = redactSecrets(sample);
    assert.ok(!cleaned.includes('1234567890abcdef'));
    assert.ok(!cleaned.includes('112233445566'));
    assert.ok(cleaned.includes('[REDACTED]'));
  });

  it('normalizes worker progress stages for task_steps while preserving granular tasks lifecycle statuses and rejecting invalid states', () => {
    for (const stage of ['downloading', 'loading_model', 'running', 'uploading'] as const) {
      const res = normalizeWorkerProgressStatus(stage);
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.stepStatus, 'running');
        assert.equal(res.taskLifecycleStatus, stage);
      }
    }

    for (const stepOnly of ['pending', 'completed', 'failed', 'skipped', 'waiting_approval'] as const) {
      const res = normalizeWorkerProgressStatus(stepOnly);
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.stepStatus, stepOnly);
        assert.equal(res.taskLifecycleStatus, undefined);
      }
    }

    // Undefined/null defaults cleanly to running
    assert.deepEqual(normalizeWorkerProgressStatus(undefined), {
      ok: true,
      stepStatus: 'running',
      taskLifecycleStatus: 'running',
    });

    // Invalid lifecycle states must be rejected with 400 and never silently converted
    for (const invalid of ['invalid_stage', 'bogus_status', 'queued', 'assigned', 'cancelled', 'paused', 'RUNNING', '', 123, {}]) {
      const res = normalizeWorkerProgressStatus(invalid);
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.status, 400);
        assert.ok(res.error.includes('Invalid task progress status'));
      }
    }

    assert.deepEqual(normalizeStepNumber(undefined), { ok: true, stepNumber: 1 });
    assert.deepEqual(normalizeStepNumber(3), { ok: true, stepNumber: 3 });
    assert.equal(normalizeStepNumber(0).ok, false);
    assert.equal(normalizeStepNumber(-2).ok, false);
    assert.equal(normalizeStepNumber('not_a_number').ok, false);
  });
});

describe('2. Non-Destructive D1 Migration 0003 Integrity', () => {
  it('preserves existing tasks, steps, approvals, files, and logs while revoking weak seed hashes', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(loadMigrationSql('0001_initial_schema.sql'));
    sqlite.exec(loadMigrationSql('0002_distributed_compute.sql'));

    // Insert pre-existing task, step, approval, file, and log BEFORE applying migration 0003
    sqlite.exec(`
      INSERT INTO users (id, email, name, role) VALUES ('usr_legacy', 'legacy@test.io', 'Legacy User', 'operator');
      INSERT INTO agents (id, name, system_instructions) VALUES ('agent_legacy', 'Legacy Agent', 'Run safely');
      INSERT INTO tasks (id, agent_id, user_id, title, status, progress_percent)
        VALUES ('tsk_legacy_1', 'agent_legacy', 'usr_legacy', 'Pre-migration task', 'queued', 0);
      INSERT INTO task_steps (id, task_id, step_number, step_name, status)
        VALUES ('stp_legacy_1', 'tsk_legacy_1', 1, 'Initial Step', 'pending');
      INSERT INTO approvals (id, task_id, agent_id, action_name, action_type, payload, risk_level, status)
        VALUES ('appr_legacy_1', 'tsk_legacy_1', 'agent_legacy', 'Approve Op', 'database_write', '{"table":"users"}', 'high', 'pending');
      INSERT INTO files (id, r2_key, filename, mime_type, size_bytes, uploaded_by, task_id)
        VALUES ('file_legacy_1', 'uploads/legacy.txt', 'legacy.txt', 'text/plain', 42, 'usr_legacy', 'tsk_legacy_1');
      INSERT INTO activity_logs (id, user_id, agent_id, task_id, action, category)
        VALUES ('log_legacy_1', 'usr_legacy', 'agent_legacy', 'tsk_legacy_1', 'created', 'task');
    `);

    // Apply migration 0003
    sqlite.exec(loadMigrationSql('0003_worker_security.sql'));

    // Verify zero foreign-key violations
    const fkErrors = sqlite.prepare('PRAGMA foreign_key_check;').all();
    assert.equal(fkErrors.length, 0);

    // Verify all legacy rows survived intact
    assert.equal((sqlite.prepare('SELECT COUNT(*) as c FROM tasks WHERE id = ?').get('tsk_legacy_1') as any).c, 1);
    assert.equal((sqlite.prepare('SELECT COUNT(*) as c FROM task_steps WHERE id = ?').get('stp_legacy_1') as any).c, 1);
    assert.equal((sqlite.prepare('SELECT COUNT(*) as c FROM approvals WHERE id = ?').get('appr_legacy_1') as any).c, 1);
    assert.equal(
      (sqlite.prepare('SELECT task_id FROM files WHERE id = ?').get('file_legacy_1') as any).task_id,
      'tsk_legacy_1'
    );
    assert.equal(
      (sqlite.prepare('SELECT task_id FROM activity_logs WHERE id = ?').get('log_legacy_1') as any).task_id,
      'tsk_legacy_1'
    );

    // Verify distributed worker statuses ('assigned', 'downloading', 'loading_model', 'running', 'uploading') are permitted
    sqlite.exec(`
      UPDATE tasks SET status = 'downloading' WHERE id = 'tsk_legacy_1';
      UPDATE tasks SET status = 'loading_model' WHERE id = 'tsk_legacy_1';
      UPDATE tasks SET status = 'uploading' WHERE id = 'tsk_legacy_1';
      UPDATE tasks SET status = 'queued' WHERE id = 'tsk_legacy_1';
    `);

    // Verify default weak seed hashes ('test' and 'password') were revoked
    const seedWorkers = sqlite
      .prepare("SELECT id, status, is_revoked, api_key_hash FROM compute_workers WHERE id IN ('worker_admin_kaggle_01', 'worker_community_t4_02')")
      .all() as any[];
    assert.equal(seedWorkers.length, 2);
    for (const sw of seedWorkers) {
      assert.equal(sw.is_revoked, 1);
      assert.equal(sw.status, 'offline');
      assert.ok(String(sw.api_key_hash).startsWith('revoked$'));
    }
  });
});

describe('3. Cloudflare Worker API Security, Isolation & Lifecycle', () => {
  let env: Env;
  let sqlite: DatabaseSync;

  beforeEach(() => {
    const setup = createMigratedWorkerEnv();
    env = setup.env;
    sqlite = setup.sqlite;
  });

  it('enforces optional WORKER_REGISTRATION_TOKEN and never leaks key hashes on public endpoints', async () => {
    const { env: protectedEnv } = createMigratedWorkerEnv({
      WORKER_REGISTRATION_TOKEN: 'enroll_secret_9988776655',
    });

    const hwSpec = {
      name: 'Kaggle Dual T4 Secure Node',
      provider: 'kaggle',
      gpu_model: 'NVIDIA Tesla T4',
      gpu_count: 2,
      vram_mb: 30720,
      system_ram_mb: 32768,
      contributor_name: 'Alice',
    };

    // Unauthenticated registration rejected
    const unauth = await callWorker(protectedEnv, 'POST', '/api/workers/register', hwSpec);
    assert.equal(unauth.status, 401);

    // Wrong token rejected
    const wrongTok = await callWorker(protectedEnv, 'POST', '/api/workers/register', hwSpec, {
      'X-Registration-Token': 'wrong_token_000',
    });
    assert.equal(wrongTok.status, 401);

    // Valid token succeeds
    const okReg = await callWorker(protectedEnv, 'POST', '/api/workers/register', hwSpec, {
      'X-Registration-Token': 'enroll_secret_9988776655',
    });
    assert.equal(okReg.status, 201);
    assert.equal(okReg.data.success, true);
    assert.ok(okReg.data.worker.id.startsWith('wrk_kaggle_'));
    assert.ok(okReg.data.api_key.startsWith('ak_live_'));
    assert.equal('api_key_hash' in okReg.data.worker, false);
    assert.equal('key_fingerprint' in okReg.data.worker, false);

    // Public list and single GET never expose hashes or raw API key
    const listRes = await callWorker(protectedEnv, 'GET', '/api/workers');
    assert.equal(listRes.status, 200);
    assert.ok(!listRes.rawText.includes(okReg.data.api_key));
    assert.ok(!listRes.rawText.includes('api_key_hash'));
    assert.ok(!listRes.rawText.includes('key_fingerprint'));

    const singleRes = await callWorker(protectedEnv, 'GET', `/api/workers/${okReg.data.worker.id}`);
    assert.equal(singleRes.status, 200);
    assert.equal(singleRes.data.worker.id, okReg.data.worker.id);
    assert.equal('api_key_hash' in singleRes.data.worker, false);
  });

  it('rejects unauthenticated, malformed, query-param, and legacy weak credentials across all worker endpoints', async () => {
    // Missing Authorization header
    assert.equal((await callWorker(env, 'GET', '/api/workers/me')).status, 401);
    assert.equal((await callWorker(env, 'POST', '/api/workers/heartbeat', {})).status, 401);
    assert.equal((await callWorker(env, 'POST', '/api/workers/shutdown', {})).status, 401);
    assert.equal((await callWorker(env, 'POST', '/api/workers/tasks/claim', {})).status, 401);
    assert.equal((await callWorker(env, 'GET', '/api/workers/tasks/tsk_1')).status, 401);
    assert.equal((await callWorker(env, 'POST', '/api/workers/tasks/tsk_1/progress', {})).status, 401);
    assert.equal((await callWorker(env, 'POST', '/api/workers/tasks/tsk_1/artifacts', { filename: 'x.txt', content: 'hi' })).status, 401);
    assert.equal((await callWorker(env, 'POST', '/api/workers/tasks/tsk_1/result', {})).status, 401);
    assert.equal((await callWorker(env, 'POST', '/api/workers/tasks/tsk_1/fail', {})).status, 401);

    // Credentials in query string must be rejected with 400
    const qpRes = await callWorker(
      env,
      'POST',
      '/api/workers/tasks/claim?api_key=ak_live_1234567890abcdef123456',
      {}
    );
    assert.equal(qpRes.status, 400);

    // Legacy weak seed credentials ('test' / 'password') must fail
    const weakSeedAttempt = await callWorker(
      env,
      'GET',
      '/api/workers/me',
      undefined,
      workerHeaders('test', 'worker_admin_kaggle_01')
    );
    assert.equal(weakSeedAttempt.status, 401);
  });

  it('enforces strict cross-worker isolation and anti-impersonation', async () => {
    const regA = await callWorker(env, 'POST', '/api/workers/register', {
      name: 'Worker Alpha',
      provider: 'kaggle',
      gpu_model: 'NVIDIA Tesla T4',
      gpu_count: 2,
      vram_mb: 30720,
      system_ram_mb: 32768,
    });
    const regB = await callWorker(env, 'POST', '/api/workers/register', {
      name: 'Worker Beta',
      provider: 'kaggle',
      gpu_model: 'NVIDIA Tesla T4',
      gpu_count: 2,
      vram_mb: 30720,
      system_ram_mb: 32768,
    });

    const workerA = regA.data.worker;
    const keyA = regA.data.api_key;
    const workerB = regB.data.worker;
    const keyB = regB.data.api_key;

    // Worker B tries to impersonate Worker A via body worker_id, X-Worker-Id header, or URL path
    const impBody = await callWorker(
      env,
      'POST',
      '/api/workers/heartbeat',
      { worker_id: workerA.id, status: 'online' },
      workerHeaders(keyB)
    );
    assert.equal(impBody.status, 403);

    const impPath = await callWorker(
      env,
      'POST',
      `/api/workers/${workerA.id}/heartbeat`,
      { status: 'online' },
      workerHeaders(keyB)
    );
    assert.equal(impPath.status, 403);

    const impShutdown = await callWorker(
      env,
      'POST',
      '/api/workers/shutdown',
      { worker_id: workerA.id },
      workerHeaders(keyB)
    );
    assert.equal(impShutdown.status, 403);

    // Conflicting X-Worker-Id header vs body worker_id returns 400
    const conflict = await callWorker(
      env,
      'POST',
      '/api/workers/heartbeat',
      { worker_id: workerA.id },
      workerHeaders(keyB, workerB.id)
    );
    assert.equal(conflict.status, 400);

    // Create task and let Worker A claim it
    const taskRes = await callWorker(env, 'POST', '/api/tasks', {
      agent_id: 'agent_dataops',
      title: 'Isolated GPU Inference Task',
      input_payload: { model: 'qwen-2.5-coder-14b', prompt: 'SELECT 1;' },
      priority: 'high',
    });
    assert.equal(taskRes.status, 201);
    const taskId = taskRes.data.task.id;

    const claimA = await callWorker(
      env,
      'POST',
      '/api/workers/tasks/claim',
      { worker_id: workerA.id },
      workerHeaders(keyA, workerA.id)
    );
    assert.equal(claimA.status, 200);
    assert.equal(claimA.data.task.id, taskId);

    // Worker B tries to read, update progress, upload artifact, complete, or fail Worker A's task
    assert.equal(
      (await callWorker(env, 'GET', `/api/workers/tasks/${taskId}`, undefined, workerHeaders(keyB, workerB.id))).status,
      403
    );
    assert.equal(
      (
        await callWorker(
          env,
          'POST',
          `/api/workers/tasks/${taskId}/progress`,
          { worker_id: workerB.id, step_number: 1, step_name: 'Hijack', status: 'running', progress_percent: 50 },
          workerHeaders(keyB, workerB.id)
        )
      ).status,
      403
    );
    assert.equal(
      (
        await callWorker(
          env,
          'POST',
          `/api/workers/tasks/${taskId}/artifacts`,
          { filename: 'hijack.json', content: { pwned: true } },
          workerHeaders(keyB, workerB.id)
        )
      ).status,
      403
    );
    assert.equal(
      (
        await callWorker(
          env,
          'POST',
          `/api/workers/tasks/${taskId}/result`,
          { worker_id: workerB.id, result_payload: { status: 'success' } },
          workerHeaders(keyB, workerB.id)
        )
      ).status,
      403
    );
    assert.equal(
      (
        await callWorker(
          env,
          'POST',
          `/api/workers/tasks/${taskId}/fail`,
          { worker_id: workerB.id, error_message: 'Injected failure' },
          workerHeaders(keyB, workerB.id)
        )
      ).status,
      403
    );

    // Verify task is still untouched and assigned to Worker A
    const checkTask = await callWorker(env, 'GET', `/api/workers/tasks/${taskId}`, undefined, workerHeaders(keyA, workerA.id));
    assert.equal(checkTask.status, 200);
    assert.equal(checkTask.data.task.claimed_by_worker, workerA.id);
    assert.equal(checkTask.data.task.status, 'assigned');
  });

  it('blocks replay attacks (reused nonces, expired timestamps, missing required nonces) and duplicate task claims', async () => {
    const reg = await callWorker(env, 'POST', '/api/workers/register', {
      name: 'Replay Test Worker',
      provider: 'kaggle',
      gpu_model: 'NVIDIA Tesla T4',
      gpu_count: 2,
      vram_mb: 30720,
      system_ram_mb: 32768,
    });
    const workerId = reg.data.worker.id;
    const apiKey = reg.data.api_key;

    // Missing replay headers when REQUIRE_WORKER_NONCE === 'true' -> 400
    const noReplayHdrs = await callWorker(env, 'GET', '/api/workers/me', undefined, {
      Authorization: `Bearer ${apiKey}`,
    });
    assert.equal(noReplayHdrs.status, 400);

    // Stale timestamp (> 300s ago) -> 401
    const staleHdrs = await callWorker(env, 'GET', '/api/workers/me', undefined, {
      Authorization: `Bearer ${apiKey}`,
      'X-Worker-Timestamp': String(Date.now() - 400_000),
      'X-Worker-Nonce': `stale_${crypto.randomUUID()}`,
    });
    assert.equal(staleHdrs.status, 401);

    // Valid timestamp + nonce succeeds once, then exact replay is blocked with 409
    const fixedHeaders = {
      Authorization: `Bearer ${apiKey}`,
      'X-Worker-Id': workerId,
      'X-Worker-Timestamp': String(Date.now()),
      'X-Worker-Nonce': `single_use_${crypto.randomUUID()}`,
    };
    const firstTry = await callWorker(env, 'GET', '/api/workers/me', undefined, fixedHeaders);
    assert.equal(firstTry.status, 200);

    const replayTry = await callWorker(env, 'GET', '/api/workers/me', undefined, fixedHeaders);
    assert.equal(replayTry.status, 409);

    // Concurrent claim race across 5 workers for a single task -> only 1 winner
    const swarm = await Promise.all(
      [1, 2, 3, 4, 5].map((idx) =>
        callWorker(env, 'POST', '/api/workers/register', {
          name: `Swarm Node ${idx}`,
          provider: 'kaggle',
          gpu_model: 'NVIDIA Tesla T4',
          gpu_count: 2,
          vram_mb: 30720,
          system_ram_mb: 32768,
        })
      )
    );

    const singleTask = await callWorker(env, 'POST', '/api/tasks', {
      agent_id: 'agent_scout',
      title: 'Atomic Single-Claim Task',
      priority: 'critical',
    });
    const singleTaskId = singleTask.data.task.id;

    const claimAttempts = await Promise.all(
      swarm.map((s) =>
        callWorker(
          env,
          'POST',
          '/api/workers/tasks/claim',
          { worker_id: s.data.worker.id },
          workerHeaders(s.data.api_key, s.data.worker.id)
        )
      )
    );

    const winners = claimAttempts.filter((r) => r.status === 200 && r.data.task !== null);
    assert.equal(winners.length, 1);
    assert.equal(winners[0].data.task.id, singleTaskId);
    assert.equal(winners[0].data.task.attempt_count, 1);

    // Winning worker cannot claim a second task while holding an active task (409)
    await callWorker(env, 'POST', '/api/tasks', {
      agent_id: 'agent_scout',
      title: 'Second Queued Task',
    });
    const winnerCredential = swarm.find(
      (s) => s.data.worker.id === winners[0].data.task.claimed_by_worker
    )!;
    const busyClaim = await callWorker(
      env,
      'POST',
      '/api/workers/tasks/claim',
      { worker_id: winnerCredential.data.worker.id },
      workerHeaders(winnerCredential.data.api_key, winnerCredential.data.worker.id)
    );
    assert.equal(busyClaim.status, 409);
  });

  it('executes complete lifecycle (progress, R2 artifact upload, completion, shutdown) & blocks duplicate result submission', async () => {
    const reg = await callWorker(env, 'POST', '/api/workers/register', {
      name: 'Lifecycle Node 01',
      provider: 'kaggle',
      gpu_model: 'NVIDIA Tesla T4',
      gpu_count: 2,
      vram_mb: 30720,
      system_ram_mb: 32768,
      contributor_name: 'Dr. Ada',
    });
    const workerId = reg.data.worker.id;
    const apiKey = reg.data.api_key;

    // 1. Self-inspect via /api/workers/me
    const meRes = await callWorker(env, 'GET', '/api/workers/me', undefined, workerHeaders(apiKey, workerId));
    assert.equal(meRes.status, 200);
    assert.equal(meRes.data.worker.id, workerId);
    assert.equal(meRes.data.worker.status, 'online');

    // 2. Heartbeat telemetry update
    const hbRes = await callWorker(
      env,
      'POST',
      '/api/workers/heartbeat',
      {
        worker_id: workerId,
        status: 'online',
        gpu_utilization_percent: 12.5,
        gpu_memory_used_mb: 512,
        gpu_temperature_c: 41.0,
        uptime_seconds: 15,
      },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(hbRes.status, 200);
    assert.equal(hbRes.data.worker.gpu_utilization_percent, 12.5);

    // 3. Dispatch task & claim it
    const taskRes = await callWorker(env, 'POST', '/api/tasks', {
      agent_id: 'agent_dataops',
      title: 'Full Pipeline Verification',
      input_payload: { task_type: 'hardware_diagnostic', matrix_dim: 256 },
    });
    const taskId = taskRes.data.task.id;

    const claimRes = await callWorker(
      env,
      'POST',
      '/api/workers/tasks/claim',
      { worker_id: workerId },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(claimRes.status, 200);
    assert.equal(claimRes.data.task.id, taskId);
    assert.equal(claimRes.data.task.status, 'assigned');

    // 4. Report step progress (including sensitive string that must be scrubbed in DB logs)
    const progRes = await callWorker(
      env,
      'POST',
      `/api/workers/tasks/${taskId}/progress`,
      {
        worker_id: workerId,
        step_number: 1,
        step_name: 'Execute Local PyTorch Compute',
        status: 'running',
        logs: `Running with Authorization: Bearer ${apiKey} on cuda:0`,
        progress_percent: 65,
      },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(progRes.status, 200);

    // 5. Upload R2 output artifact & download it
    const artRes = await callWorker(
      env,
      'POST',
      `/api/workers/tasks/${taskId}/artifacts`,
      {
        filename: 'diagnostic_report.json',
        content_type: 'application/json',
        content: { verified: true, gflops: 1420.5 },
      },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(artRes.status, 201);
    const artifactKey = artRes.data.file.key;
    assert.ok(artifactKey.startsWith(`tasks/${taskId}/`));

    const dlRes = await callWorker(env, 'GET', `/api/files/download/${encodeURIComponent(artifactKey)}`);
    assert.equal(dlRes.status, 200);
    assert.equal(dlRes.data.verified, true);

    // Path traversal blocked
    const travRes = await callWorker(env, 'GET', '/api/files/download/..%2F..%2Fetc%2Fpasswd');
    assert.equal(travRes.status, 400);

    // 6. Submit task completion result
    const doneRes = await callWorker(
      env,
      'POST',
      `/api/workers/tasks/${taskId}/result`,
      {
        worker_id: workerId,
        result_payload: {
          status: 'success',
          executed_by: workerId,
          artifact_r2_key: artifactKey,
        },
      },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(doneRes.status, 200);

    // Duplicate result submission rejected with 409 Conflict
    const dupDoneRes = await callWorker(
      env,
      'POST',
      `/api/workers/tasks/${taskId}/result`,
      {
        worker_id: workerId,
        result_payload: { status: 'success' },
      },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(dupDoneRes.status, 409);

    // Verify public task state & scrubbed logs
    const taskCheck = await callWorker(env, 'GET', `/api/tasks/${taskId}`);
    assert.equal(taskCheck.status, 200);
    assert.equal(taskCheck.data.task.status, 'completed');
    assert.equal(taskCheck.data.task.progress_percent, 100);
    assert.ok(!taskCheck.rawText.includes(apiKey));

    // Verify worker total_tasks_completed is strictly 1 (not double-counted)
    const workerCheck = await callWorker(env, 'GET', `/api/workers/${workerId}`);
    assert.equal(workerCheck.data.worker.status, 'online');
    assert.equal(workerCheck.data.worker.total_tasks_completed, 1);

    // 7. Graceful shutdown marks worker offline
    const shutRes = await callWorker(
      env,
      'POST',
      '/api/workers/shutdown',
      { worker_id: workerId, uptime_seconds: 120 },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(shutRes.status, 200);
    assert.equal((await callWorker(env, 'GET', `/api/workers/${workerId}`)).data.worker.status, 'offline');
  });

  it('releases in-flight task upon worker shutdown, reaps expired leases, and enforces credential revocation', async () => {
    const reg1 = await callWorker(env, 'POST', '/api/workers/register', {
      name: 'Graceful Shutdown Worker',
      provider: 'kaggle',
      gpu_model: 'NVIDIA Tesla T4',
      gpu_count: 1,
      vram_mb: 16384,
      system_ram_mb: 16384,
    });
    const reg2 = await callWorker(env, 'POST', '/api/workers/register', {
      name: 'Backup Dual T4 Worker',
      provider: 'kaggle',
      gpu_model: 'NVIDIA Tesla T4',
      gpu_count: 2,
      vram_mb: 30720,
      system_ram_mb: 32768,
    });

    const w1 = reg1.data.worker.id;
    const k1 = reg1.data.api_key;
    const w2 = reg2.data.worker.id;
    const k2 = reg2.data.api_key;

    // Create a high-VRAM task (requires 24 GB VRAM) — w1 (16 GB) should NOT claim it; w2 (30 GB) SHOULD
    const heavyTask = await callWorker(env, 'POST', '/api/tasks', {
      agent_id: 'agent_dataops',
      title: 'High VRAM 14B Model Task',
      input_payload: { require_gpu: true, min_vram_mb: 24576 },
    });
    const heavyId = heavyTask.data.task.id;

    const w1AttemptHeavy = await callWorker(
      env,
      'POST',
      '/api/workers/tasks/claim',
      { worker_id: w1 },
      workerHeaders(k1, w1)
    );
    assert.equal(w1AttemptHeavy.data.task, null);

    // Create a standard task that w1 claims (higher priority so w2 also claims it first after release)
    const stdTask = await callWorker(env, 'POST', '/api/tasks', {
      agent_id: 'agent_scout',
      title: 'Interruptible Standard Task',
      priority: 'high',
      input_payload: { min_vram_mb: 4096 },
    });
    const stdId = stdTask.data.task.id;

    const w1Claim = await callWorker(
      env,
      'POST',
      '/api/workers/tasks/claim',
      { worker_id: w1 },
      workerHeaders(k1, w1)
    );
    assert.equal(w1Claim.data.task.id, stdId);

    // Worker 1 shuts down gracefully mid-task -> task is automatically released back to 'queued'
    const shutRes = await callWorker(
      env,
      'POST',
      '/api/workers/shutdown',
      { worker_id: w1 },
      workerHeaders(k1, w1)
    );
    assert.equal(shutRes.status, 200);
    assert.equal(shutRes.data.released_task_id, stdId);

    const releasedTask = await callWorker(env, 'GET', `/api/tasks/${stdId}`);
    assert.equal(releasedTask.data.task.status, 'queued');
    assert.equal(releasedTask.data.task.claimed_by_worker, null);

    // Offline worker cannot claim tasks until sending online heartbeat
    const offlineClaim = await callWorker(
      env,
      'POST',
      '/api/workers/tasks/claim',
      { worker_id: w1 },
      workerHeaders(k1, w1)
    );
    assert.equal(offlineClaim.status, 403);

    // Worker 2 claims stdId, then we simulate Worker 2 lease expiration (crash)
    const w2Claim = await callWorker(
      env,
      'POST',
      '/api/workers/tasks/claim',
      { worker_id: w2 },
      workerHeaders(k2, w2)
    );
    assert.equal(w2Claim.data.task.id, stdId);

    const expiredIso = new Date(Date.now() - 60_000).toISOString();
    sqlite
      .prepare('UPDATE tasks SET lease_expires_at = ? WHERE id = ?')
      .run(expiredIso, stdId);
    sqlite
      .prepare('UPDATE compute_workers SET lease_expires_at = ? WHERE id = ?')
      .run(expiredIso, w2);

    // Worker 1 comes back online via heartbeat and reclaims the expired task
    await callWorker(
      env,
      'POST',
      '/api/workers/heartbeat',
      { worker_id: w1, status: 'online' },
      workerHeaders(k1, w1)
    );
    const w1Reclaim = await callWorker(
      env,
      'POST',
      '/api/workers/tasks/claim',
      { worker_id: w1 },
      workerHeaders(k1, w1)
    );
    assert.equal(w1Reclaim.data.task.id, stdId);
    assert.equal(w1Reclaim.data.task.attempt_count, 3);
    assert.equal((await callWorker(env, 'GET', `/api/workers/${w2}`)).data.worker.status, 'offline');

    // Operator revokes Worker 1 credential -> subsequent authenticated requests return 403
    const revokeRes = await callWorker(
      env,
      'POST',
      `/api/workers/${w1}/revoke`,
      {},
      { Authorization: `Bearer ${env.RUNTIME_API_KEY}` }
    );
    assert.equal(revokeRes.status, 200);

    const postRevokeMe = await callWorker(
      env,
      'GET',
      '/api/workers/me',
      undefined,
      workerHeaders(k1, w1)
    );
    assert.equal(postRevokeMe.status, 403);

    // Task held by revoked worker was also safely released to 'queued'
    const afterRevokeTask = await callWorker(env, 'GET', `/api/tasks/${stdId}`);
    assert.equal(afterRevokeTask.data.task.status, 'queued');
  });

  it('normalizes downloading/loading_model/uploading for task_steps while preserving tasks.status and rejecting invalid statuses', async () => {
    const reg = await callWorker(env, 'POST', '/api/workers/register', {
      name: 'Multistage Inference Node',
      provider: 'kaggle',
      gpu_model: 'NVIDIA Tesla T4',
      gpu_count: 2,
      vram_mb: 30720,
      system_ram_mb: 32768,
    });
    const workerId = reg.data.worker.id;
    const apiKey = reg.data.api_key;

    const created = await callWorker(env, 'POST', '/api/tasks', {
      agent_id: 'agent_dataops',
      title: 'Multistage LLM Execution',
      input_payload: { model: 'qwen-2.5-coder-14b', prompt: 'Hello' },
    });
    const taskId = created.data.task.id;

    const claimed = await callWorker(
      env,
      'POST',
      '/api/workers/tasks/claim',
      { worker_id: workerId },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(claimed.status, 200);
    const initialLease = claimed.data.task.lease_expires_at;

    // 1. Step 1 starts in 'pending' -> task_steps.status='pending', tasks.status stays 'assigned'
    const p1 = await callWorker(
      env,
      'POST',
      `/api/workers/tasks/${taskId}/progress`,
      {
        worker_id: workerId,
        step_number: 1,
        step_name: 'Preflight Hardware Check & Input Context',
        status: 'pending',
        logs: 'Queued preflight verification',
        progress_percent: 5,
      },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(p1.status, 200);
    assert.equal(p1.data.step_status, 'pending');
    assert.equal(p1.data.task_status, 'assigned');

    // 2. Active worker lifecycle stages ('downloading', 'loading_model', 'running', 'uploading')
    const stageAssertions = [
      { step: 1, name: 'Preflight Hardware Check & Input Context', stage: 'downloading', pct: 12 },
      { step: 2, name: 'Load Model Weights into Local VRAM', stage: 'loading_model', pct: 35 },
      { step: 3, name: 'Execute Local Tensor Inference', stage: 'running', pct: 68 },
      { step: 4, name: 'Upload Output Artifact to Cloudflare R2', stage: 'uploading', pct: 92 },
    ] as const;

    for (const item of stageAssertions) {
      const res = await callWorker(
        env,
        'POST',
        `/api/workers/tasks/${taskId}/progress`,
        {
          worker_id: workerId,
          step_number: item.step,
          step_name: item.name,
          status: item.stage,
          logs: `Stage ${item.stage} active on T4x2`,
          progress_percent: item.pct,
        },
        workerHeaders(apiKey, workerId)
      );
      assert.equal(res.status, 200, `Expected stage ${item.stage} to succeed without CHECK constraint failure`);
      assert.equal(res.data.step_status, 'running');
      assert.equal(res.data.task_status, item.stage);

      const snapshot = await callWorker(env, 'GET', `/api/tasks/${taskId}`);
      assert.equal(snapshot.data.task.status, item.stage);
      assert.equal(snapshot.data.task.progress_percent, item.pct);

      const stepRow = sqlite
        .prepare('SELECT status, step_name, logs FROM task_steps WHERE task_id = ? AND step_number = ?')
        .get(taskId, item.step) as any;
      assert.equal(stepRow.status, 'running');
      assert.equal(stepRow.step_name, item.name);
      assert.ok(stepRow.logs.includes(`Stage ${item.stage}`));
    }

    // 3. Step completion ('completed') preserves task_steps.status='completed' while keeping main task active in 'uploading'
    const stepDone = await callWorker(
      env,
      'POST',
      `/api/workers/tasks/${taskId}/progress`,
      {
        worker_id: workerId,
        step_number: 4,
        step_name: 'Upload Output Artifact to Cloudflare R2',
        status: 'completed',
        logs: 'Artifact upload verified',
        progress_percent: 98,
      },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(stepDone.status, 200);
    assert.equal(stepDone.data.step_status, 'completed');
    assert.equal(stepDone.data.task_status, 'uploading');

    const step4Row = sqlite
      .prepare('SELECT status FROM task_steps WHERE task_id = ? AND step_number = 4')
      .get(taskId) as any;
    assert.equal(step4Row.status, 'completed');

    // Verify lease was renewed
    const updatedTaskRow = sqlite.prepare('SELECT status, lease_expires_at FROM tasks WHERE id = ?').get(taskId) as any;
    assert.equal(updatedTaskRow.status, 'uploading');
    assert.ok(updatedTaskRow.lease_expires_at >= initialLease);

    // 4. Invalid task lifecycle status returns 400 without corrupting tasks or task_steps
    const invalidRes = await callWorker(
      env,
      'POST',
      `/api/workers/tasks/${taskId}/progress`,
      {
        worker_id: workerId,
        step_number: 4,
        step_name: 'Upload Output Artifact to Cloudflare R2',
        status: 'not_a_valid_lifecycle_state',
        progress_percent: 99,
      },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(invalidRes.status, 400);
    assert.equal(invalidRes.data.success, false);
    assert.ok(invalidRes.data.error.includes('Invalid task progress status'));

    const afterInvalid = sqlite.prepare('SELECT status, progress_percent FROM tasks WHERE id = ?').get(taskId) as any;
    assert.equal(afterInvalid.status, 'uploading');
    assert.equal(afterInvalid.progress_percent, 98);

    // 5. Final task completion works after all progress transitions
    const finalize = await callWorker(
      env,
      'POST',
      `/api/workers/tasks/${taskId}/result`,
      { worker_id: workerId, result_payload: { status: 'success' } },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(finalize.status, 200);
    assert.equal((await callWorker(env, 'GET', `/api/tasks/${taskId}`)).data.task.status, 'completed');
  });

  it('remains compatible when tasks table uses legacy pre-0003 CHECK constraint by falling back task status to running while normalizing steps', async () => {
    const legacySqlite = new DatabaseSync(':memory:');
    legacySqlite.exec('PRAGMA foreign_keys = ON;');
    legacySqlite.exec(loadMigrationSql('0001_initial_schema.sql'));
    legacySqlite.exec(loadMigrationSql('0002_distributed_compute.sql'));
    // Add worker columns without altering legacy tasks CHECK constraint
    legacySqlite.exec(`
      ALTER TABLE compute_workers ADD COLUMN key_prefix TEXT;
      ALTER TABLE compute_workers ADD COLUMN key_fingerprint TEXT;
      ALTER TABLE compute_workers ADD COLUMN is_revoked INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE compute_workers ADD COLUMN capabilities TEXT NOT NULL DEFAULT '["text","code"]';
      ALTER TABLE compute_workers ADD COLUMN lease_expires_at TIMESTAMP DEFAULT NULL;
      ALTER TABLE compute_workers ADD COLUMN shutdown_at TIMESTAMP DEFAULT NULL;
      ALTER TABLE tasks ADD COLUMN lease_expires_at TIMESTAMP DEFAULT NULL;
      ALTER TABLE tasks ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE worker_nonces (worker_id TEXT NOT NULL, nonce TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (worker_id, nonce));
      INSERT INTO users (id, email, name, role) VALUES ('usr_default', 'op@aether.test', 'Operator', 'operator');
      INSERT INTO agents (id, name, system_instructions) VALUES ('agent_dataops', 'DataOps', 'Run');
    `);

    const legacyEnv: Env = {
      DB: new SqliteD1Adapter(legacySqlite),
      FILES_BUCKET: new MemoryR2Bucket(),
      ENVIRONMENT: 'test',
      INFERENCE_RUNTIME_URL: '',
      REQUIRE_WORKER_NONCE: 'true',
    };

    const reg = await callWorker(legacyEnv, 'POST', '/api/workers/register', {
      name: 'Legacy Schema Node',
      provider: 'kaggle',
      gpu_model: 'NVIDIA Tesla T4',
      gpu_count: 1,
      vram_mb: 16384,
      system_ram_mb: 16384,
    });
    const workerId = reg.data.worker.id;
    const apiKey = reg.data.api_key;

    const created = await callWorker(legacyEnv, 'POST', '/api/tasks', {
      agent_id: 'agent_dataops',
      title: 'Legacy Schema Progress Check',
    });
    const taskId = created.data.task.id;

    // Seed an 'assigned' active status on pre-0003 tasks table (status='running' before claim update)
    legacySqlite.prepare("UPDATE tasks SET claimed_by_worker = ?, status = 'running' WHERE id = ?").run(workerId, taskId);
    legacySqlite.prepare("UPDATE compute_workers SET current_task_id = ?, status = 'busy' WHERE id = ?").run(taskId, workerId);

    const prog = await callWorker(
      legacyEnv,
      'POST',
      `/api/workers/tasks/${taskId}/progress`,
      {
        worker_id: workerId,
        step_number: 1,
        step_name: 'Download Weights',
        status: 'downloading',
        progress_percent: 15,
      },
      workerHeaders(apiKey, workerId)
    );
    assert.equal(prog.status, 200);
    assert.equal(prog.data.step_status, 'running');
    assert.equal(prog.data.task_status, 'running');
  });
});

describe('4. Local Express Server (server.ts) End-to-End HTTP Security & Lifecycle', () => {
  it('enforces authentication, replay protection, isolation, artifact upload, failure reporting, and shutdown over live HTTP', async () => {
    const app = await createAetherApp({ disableVite: true });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // 1. Register two workers
      const reg1Res = await fetch(`${baseUrl}/api/workers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Express HTTP Node A',
          provider: 'kaggle',
          gpu_model: 'NVIDIA Tesla T4',
          gpu_count: 2,
          vram_mb: 30720,
          system_ram_mb: 32768,
        }),
      });
      assert.equal(reg1Res.status, 201);
      const reg1 = (await reg1Res.json()) as any;
      assert.ok(reg1.api_key.startsWith('ak_live_'));
      assert.equal('api_key_hash' in reg1.worker, false);

      const reg2Res = await fetch(`${baseUrl}/api/workers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Express HTTP Node B',
          provider: 'kaggle',
          gpu_model: 'NVIDIA Tesla T4',
          gpu_count: 2,
          vram_mb: 30720,
          system_ram_mb: 32768,
        }),
      });
      const reg2 = (await reg2Res.json()) as any;

      // 2. Submit a new task — verify it stays 'queued' with no synthetic auto-claim
      const taskCreateRes = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: 'agent_dataops',
          title: 'Live HTTP Server Worker Test Task',
          input_payload: { task_type: 'hardware_diagnostic', matrix_dim: 128 },
          priority: 'high',
        }),
      });
      assert.equal(taskCreateRes.status, 201);
      const createdTask = ((await taskCreateRes.json()) as any).task;
      assert.equal(createdTask.status, 'queued');
      assert.equal(createdTask.claimed_by_worker, undefined);

      // 3. Unauthenticated claim fails (401)
      const unauthClaim = await fetch(`${baseUrl}/api/workers/tasks/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: reg1.worker.id }),
      });
      assert.equal(unauthClaim.status, 401);

      // 4. Worker A claims the task
      const claimA = await fetch(`${baseUrl}/api/workers/tasks/claim`, {
        method: 'POST',
        headers: workerHeaders(reg1.api_key, reg1.worker.id),
        body: JSON.stringify({ worker_id: reg1.worker.id }),
      });
      assert.equal(claimA.status, 200);
      const claimed = ((await claimA.json()) as any).task;
      assert.equal(claimed.id, createdTask.id);
      assert.equal(claimed.claimed_by_worker, reg1.worker.id);

      // 5. Worker B cannot submit result for Worker A's task (403)
      const crossResult = await fetch(`${baseUrl}/api/workers/tasks/${createdTask.id}/result`, {
        method: 'POST',
        headers: workerHeaders(reg2.api_key, reg2.worker.id),
        body: JSON.stringify({ worker_id: reg2.worker.id, result_payload: { hacked: true } }),
      });
      assert.equal(crossResult.status, 403);

      // 6. Worker A reports multi-stage progress ('downloading', 'loading_model', 'running', 'uploading', 'completed' step)
      for (const stage of ['downloading', 'loading_model', 'running', 'uploading'] as const) {
        const progRes = await fetch(`${baseUrl}/api/workers/tasks/${createdTask.id}/progress`, {
          method: 'POST',
          headers: workerHeaders(reg1.api_key, reg1.worker.id),
          body: JSON.stringify({
            worker_id: reg1.worker.id,
            step_number: 1,
            step_name: `Stage ${stage}`,
            status: stage,
            progress_percent: 45,
          }),
        });
        assert.equal(progRes.status, 200);
        const progData = (await progRes.json()) as any;
        assert.equal(progData.step_status, 'running');
        assert.equal(progData.task_status, stage);
      }

      // Invalid status rejected with 400 on Express server
      const badProgRes = await fetch(`${baseUrl}/api/workers/tasks/${createdTask.id}/progress`, {
        method: 'POST',
        headers: workerHeaders(reg1.api_key, reg1.worker.id),
        body: JSON.stringify({
          worker_id: reg1.worker.id,
          step_number: 1,
          step_name: 'Bad Stage',
          status: 'invalid_state',
        }),
      });
      assert.equal(badProgRes.status, 400);

      // 7. Worker A uploads multipart artifact & completes task
      const form = new FormData();
      form.append('file', new Blob(['{"status":"ok"}'], { type: 'application/json' }), 'output.json');
      const artHeaders = workerHeaders(reg1.api_key, reg1.worker.id);
      delete artHeaders['Content-Type'];
      const artUpload = await fetch(`${baseUrl}/api/workers/tasks/${createdTask.id}/artifacts`, {
        method: 'POST',
        headers: artHeaders,
        body: form,
      });
      assert.equal(artUpload.status, 201);

      const failReport = await fetch(`${baseUrl}/api/workers/tasks/${createdTask.id}/fail`, {
        method: 'POST',
        headers: workerHeaders(reg1.api_key, reg1.worker.id),
        body: JSON.stringify({
          worker_id: reg1.worker.id,
          error_message: 'CUDA out of memory while allocating KV cache',
        }),
      });
      assert.equal(failReport.status, 200);

      // 8. Replayed /fail request on already-finalized task is rejected with 409
      const dupFail = await fetch(`${baseUrl}/api/workers/tasks/${createdTask.id}/fail`, {
        method: 'POST',
        headers: workerHeaders(reg1.api_key, reg1.worker.id),
        body: JSON.stringify({
          worker_id: reg1.worker.id,
          error_message: 'Duplicate fail',
        }),
      });
      assert.equal(dupFail.status, 409);

      // 9. Graceful shutdown
      const shutdownRes = await fetch(`${baseUrl}/api/workers/shutdown`, {
        method: 'POST',
        headers: workerHeaders(reg1.api_key, reg1.worker.id),
        body: JSON.stringify({ worker_id: reg1.worker.id, uptime_seconds: 60 }),
      });
      assert.equal(shutdownRes.status, 200);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });
});

describe('5. Passwordless Authentication, WebAuthn, TOTP & Kaggle Compute Session Manager', () => {
  it('encrypts secrets with AES-GCM-256 and validates RFC 6238 TOTP with replay counter protection', async () => {
    const rawSecret = generateTotpSecret();
    assert.ok(rawSecret.length >= 16);

    // Test AES-GCM encryption & decryption
    const encrypted = await encryptSecret(rawSecret, 'test_pepper_key');
    assert.ok(encrypted.ciphertext.length > 0);
    assert.ok(encrypted.iv.length > 0);

    const decrypted = await decryptSecret(encrypted.ciphertext, encrypted.iv, 'test_pepper_key');
    assert.equal(decrypted, rawSecret);

    // Test TOTP code generation & validation
    const code = await generateTotpCode(rawSecret);
    assert.equal(code.length, 6);
    assert.match(code, /^\d{6}$/);

    const validCheck = await verifyTotpCode(rawSecret, code, 0);
    assert.equal(validCheck.valid, true);
    assert.ok(validCheck.counter > 0);

    // Replay attack prevention: same counter must be rejected
    const replayCheck = await verifyTotpCode(rawSecret, code, validCheck.counter);
    assert.equal(replayCheck.valid, false);

    // Invalid codes rejected
    const invalidCheck = await verifyTotpCode(rawSecret, '000000', 0);
    if (code !== '000000') {
      assert.equal(invalidCheck.valid, false);
    }
  });

  it('executes full passwordless account registration, passkey activation, and workspace creation', async () => {
    const { env } = createMigratedWorkerEnv();

    // 1. Register account
    const regRes = await workerHandler.fetch(
      new Request('https://aetheros.test/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Sarah Connor',
          email: 'sarah.connor@sky.net',
          terms_accepted: true,
          privacy_accepted: true,
        }),
      }),
      env
    );
    assert.equal(regRes.status, 201);
    const regData: any = await regRes.json();
    assert.equal(regData.success, true);
    assert.ok(regData.challenge_id);
    assert.ok(regData.user_id);
    assert.ok(regData.options.challenge);

    // Duplicate registration rejected
    const dupRes = await workerHandler.fetch(
      new Request('https://aetheros.test/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Sarah Duplicate',
          email: 'SARAH.CONNOR@SKY.NET', // Test case-insensitive email normalization
          terms_accepted: true,
          privacy_accepted: true,
        }),
      }),
      env
    );
    assert.equal(dupRes.status, 409);

    // 2. Complete WebAuthn passkey registration
    const credId = 'cred_webauthn_sarah_01';
    const clientDataJSON = base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: regData.options.challenge,
          origin: 'https://aetheros.test',
        })
      )
    );

    const verifyRes = await workerHandler.fetch(
      new Request('https://aetheros.test/api/auth/webauthn/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: regData.challenge_id,
          user_id: regData.user_id,
          credential: {
            id: credId,
            public_key: 'pk_es256_mock_key',
            device_name: 'MacBook TouchID',
            response: { clientDataJSON },
          },
        }),
      }),
      env
    );
    assert.equal(verifyRes.status, 201);
    const verifyData: any = await verifyRes.json();
    assert.equal(verifyData.success, true);
    assert.ok(verifyData.session_token);
    assert.equal(verifyData.user.status, 'active');
    assert.ok(verifyData.workspace);

    // 3. Inspect authenticated identity with session token
    const meRes = await workerHandler.fetch(
      new Request('https://aetheros.test/api/auth/me', {
        headers: { Authorization: `Bearer ${verifyData.session_token}` },
      }),
      env
    );
    assert.equal(meRes.status, 200);
    const meData: any = await meRes.json();
    assert.equal(meData.authenticated, true);
    assert.equal(meData.user.email, 'sarah.connor@sky.net');
    assert.equal(meData.passkeys_count, 1);
  });

  it('enforces 4-attempt limit lockout policy on authentication challenges', async () => {
    const { env } = createMigratedWorkerEnv();

    // Register user
    const regRes = await workerHandler.fetch(
      new Request('https://aetheros.test/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'John Connor',
          email: 'john.connor@resistance.org',
          terms_accepted: true,
          privacy_accepted: true,
        }),
      }),
      env
    );
    const regData: any = await regRes.json();

    const credId = 'cred_webauthn_john_01';
    await workerHandler.fetch(
      new Request('https://aetheros.test/api/auth/webauthn/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: regData.challenge_id,
          user_id: regData.user_id,
          credential: { id: credId, public_key: 'pk_test' },
        }),
      }),
      env
    );

    // Request login challenge
    const chalRes = await workerHandler.fetch(
      new Request('https://aetheros.test/api/auth/login/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'john.connor@resistance.org' }),
      }),
      env
    );
    assert.equal(chalRes.status, 200);
    const chalData: any = await chalRes.json();

    // 4 failed attempts with invalid credential IDs
    for (let attempt = 1; attempt <= 4; attempt++) {
      const failRes = await workerHandler.fetch(
        new Request('https://aetheros.test/api/auth/login/passkey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challenge_id: chalData.challenge_id,
            credential_id: 'unknown_credential_id',
          }),
        }),
        env
      );
      assert.equal(failRes.status, 401);
      const failData: any = await failRes.json();
      assert.equal(failData.remaining_attempts, 4 - attempt);
    }

    // 5th attempt is locked out with 429
    const lockRes = await workerHandler.fetch(
      new Request('https://aetheros.test/api/auth/login/passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: chalData.challenge_id,
          credential_id: credId,
        }),
      }),
      env
    );
    assert.equal(lockRes.status, 429);
    const lockData: any = await lockRes.json();
    assert.equal(lockData.locked, true);
  });

  it('manages Kaggle worker ownership claiming and remote compute sessions', async () => {
    const { env } = createMigratedWorkerEnv();

    // Register & sign in user
    const regRes = await workerHandler.fetch(
      new Request('https://aetheros.test/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Kaggle Operator',
          email: 'operator@kaggle-cluster.ai',
          terms_accepted: true,
          privacy_accepted: true,
        }),
      }),
      env
    );
    const regData: any = await regRes.json();
    const verifyRes = await workerHandler.fetch(
      new Request('https://aetheros.test/api/auth/webauthn/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: regData.challenge_id,
          user_id: regData.user_id,
          credential: { id: 'cred_op_01', public_key: 'pk_op_01' },
        }),
      }),
      env
    );
    const authData: any = await verifyRes.json();
    const token = authData.session_token;

    // 1. Claim existing registered Kaggle worker wrk_kaggle_464cc6bdb46da70260a1e849
    // First register a worker to claim
    const workerReg = await workerHandler.fetch(
      new Request('https://aetheros.test/api/workers/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worker_id: 'wrk_kaggle_464cc6bdb46da70260a1e849',
          name: 'Primary Kaggle 2x Tesla T4',
          provider: 'kaggle',
          gpu_model: 'NVIDIA Tesla T4',
          gpu_count: 2,
          vram_mb: 29500,
          system_ram_mb: 32768,
        }),
      }),
      env
    );
    assert.equal(workerReg.status, 201);

    const claimRes = await workerHandler.fetch(
      new Request('https://aetheros.test/api/workers/wrk_kaggle_464cc6bdb46da70260a1e849/claim', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ownership_type: 'personal' }),
      }),
      env
    );
    assert.equal(claimRes.status, 200);
    const claimData: any = await claimRes.json();
    assert.equal(claimData.success, true);
    assert.equal(claimData.owner_name, 'Kaggle Operator');

    // 2. Start compute session
    const startRes = await workerHandler.fetch(
      new Request('https://aetheros.test/api/compute/sessions/start', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          notebook_slug: 'crazybuddhaa/aetheros-kaggle-worker',
        }),
      }),
      env
    );
    assert.equal(startRes.status, 201);
    const startData: any = await startRes.json();
    assert.equal(startData.success, true);
    assert.ok(startData.session.id);
    assert.equal(startData.session.provider, 'kaggle');

    // 3. Inspect status
    const statusRes = await workerHandler.fetch(
      new Request(`https://aetheros.test/api/compute/sessions/${startData.session.id}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env
    );
    assert.equal(statusRes.status, 200);
    const statusData: any = await statusRes.json();
    assert.equal(statusData.success, true);
    assert.ok(statusData.session.worker);
    assert.equal(statusData.session.worker.id, 'wrk_kaggle_464cc6bdb46da70260a1e849');

    // 4. Stop session
    const stopRes = await workerHandler.fetch(
      new Request(`https://aetheros.test/api/compute/sessions/${startData.session.id}/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      env
    );
    assert.equal(stopRes.status, 200);
    const stopData: any = await stopRes.json();
    assert.equal(stopData.status, 'stopped');

    // 5. Restart session
    const restartRes = await workerHandler.fetch(
      new Request(`https://aetheros.test/api/compute/sessions/${startData.session.id}/restart`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
      env
    );
    assert.equal(restartRes.status, 200);
    const restartData: any = await restartRes.json();
    assert.equal(restartData.status, 'starting');
  });
});

