/**
 * Cryptographic Worker Authentication, Salted Key Hashing, Constant-Time Comparison,
 * Replay Attack Protection, and Secret Redaction.
 *
 * Uses standard Web Crypto APIs so it runs identically in Cloudflare Workers and Node.js 22+.
 */

export const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const WORKER_LEASE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const ACTIVE_WORKER_TASK_STATUSES = [
  'assigned',
  'downloading',
  'loading_model',
  'running',
  'uploading',
] as const;

export const TERMINAL_TASK_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export const WORKER_ACTIVE_LIFECYCLE_STAGES = [
  'downloading',
  'loading_model',
  'running',
  'uploading',
] as const;

export type WorkerActiveLifecycleStage = (typeof WORKER_ACTIVE_LIFECYCLE_STAGES)[number];

export const VALID_TASK_STEP_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'waiting_approval',
] as const;

export type TaskStepStatus = (typeof VALID_TASK_STEP_STATUSES)[number];

export interface NormalizedProgressStatus {
  ok: true;
  /** Normalized status permitted by task_steps.status CHECK constraint */
  stepStatus: TaskStepStatus;
  /** Lifecycle stage to apply to main tasks.status when transitioning active execution phase */
  taskLifecycleStatus?: WorkerActiveLifecycleStage;
}

export interface InvalidProgressStatus {
  ok: false;
  status: 400;
  error: string;
}

export type ProgressStatusResolution = NormalizedProgressStatus | InvalidProgressStatus;

const STEP_STATUS_NORMALIZATION_MAP: Readonly<Record<string, TaskStepStatus>> = {
  downloading: 'running',
  loading_model: 'running',
  uploading: 'running',
  running: 'running',
  pending: 'pending',
  completed: 'completed',
  failed: 'failed',
  skipped: 'skipped',
  waiting_approval: 'waiting_approval',
};

const ACTIVE_LIFECYCLE_STAGE_SET: ReadonlySet<string> = new Set(WORKER_ACTIVE_LIFECYCLE_STAGES);

export interface GeneratedWorkerKey {
  rawKey: string;
  keyPrefix: string;
  storedHash: string;
  keyFingerprint: string;
}

export interface BearerExtractionResult {
  token?: string;
  error?: string;
  status?: number;
}

export interface ReplayHeaderValidationResult {
  ok: boolean;
  status?: number;
  error?: string;
  timestampMs?: number;
  nonce?: string;
}

const textEncoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Constant-time comparison of two equal-length byte arrays.
 * Uses native `crypto.subtle.timingSafeEqual` when available (Cloudflare Workers)
 * and a fixed-iteration bitwise XOR accumulator fallback otherwise.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength === 0 || a.byteLength !== b.byteLength) {
    return false;
  }

  const subtleAny = crypto.subtle as unknown as {
    timingSafeEqual?: (x: BufferSource, y: BufferSource) => boolean;
  };
  if (typeof subtleAny.timingSafeEqual === 'function') {
    return subtleAny.timingSafeEqual(a as unknown as BufferSource, b as unknown as BufferSource);
  }

  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function sha256Bytes(input: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof input === 'string' ? textEncoder.encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data as any);
  return new Uint8Array(digest);
}

export async function hmacSha256Bytes(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(message));
  return new Uint8Array(sig);
}

/**
 * Generate a cryptographically random identifier with prefix (96 bits of entropy).
 */
export function generateSecureId(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}_${bytesToHex(bytes)}`;
}

/**
 * Compute an indexed lookup fingerprint for a raw worker API key.
 * Plaintext keys are never stored; lookup uses this one-way cryptographic digest
 * followed by full constant-time verification against the salted hash.
 */
export async function computeKeyFingerprint(rawKey: string, pepper?: string): Promise<string> {
  if (pepper && pepper.length > 0) {
    return bytesToHex(await hmacSha256Bytes(pepper, `fp:${rawKey}`));
  }
  return bytesToHex(await sha256Bytes(rawKey));
}

/**
 * Generate a 256-bit CSPRNG worker API key and its per-worker salted cryptographic hash.
 */
export async function generateWorkerApiKey(pepper?: string): Promise<GeneratedWorkerKey> {
  const secretBytes = new Uint8Array(32);
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(secretBytes);
  crypto.getRandomValues(saltBytes);

  const rawKey = `ak_live_${bytesToHex(secretBytes)}`;
  const keyPrefix = rawKey.slice(0, 16);
  const saltHex = bytesToHex(saltBytes);

  let storedHash: string;
  if (pepper && pepper.length > 0) {
    const digest = await hmacSha256Bytes(pepper, `${saltHex}:${rawKey}`);
    storedHash = `hmac-sha256$${saltHex}$${bytesToHex(digest)}`;
  } else {
    const digest = await sha256Bytes(`${saltHex}:${rawKey}`);
    storedHash = `sha256$${saltHex}$${bytesToHex(digest)}`;
  }

  const keyFingerprint = await computeKeyFingerprint(rawKey, pepper);

  return {
    rawKey,
    keyPrefix,
    storedHash,
    keyFingerprint,
  };
}

/**
 * Verify a candidate raw worker API key against a stored hash in constant time.
 */
export async function verifyApiKeyHash(
  rawKey: string,
  storedHash: string,
  pepper?: string
): Promise<boolean> {
  if (!rawKey || !storedHash || storedHash.startsWith('revoked$')) {
    return false;
  }

  const parts = storedHash.split('$');
  if (parts.length === 3 && parts[0] === 'hmac-sha256') {
    const [, saltHex, expectedHex] = parts;
    if (!pepper || !saltHex) return false;
    const expectedBytes = hexToBytes(expectedHex);
    if (!expectedBytes || expectedBytes.byteLength !== 32) return false;
    const actualBytes = await hmacSha256Bytes(pepper, `${saltHex}:${rawKey}`);
    return constantTimeEqual(actualBytes, expectedBytes);
  }

  if (parts.length === 3 && parts[0] === 'sha256') {
    const [, saltHex, expectedHex] = parts;
    if (!saltHex) return false;
    const expectedBytes = hexToBytes(expectedHex);
    if (!expectedBytes || expectedBytes.byteLength !== 32) return false;
    const actualBytes = await sha256Bytes(`${saltHex}:${rawKey}`);
    return constantTimeEqual(actualBytes, expectedBytes);
  }

  if (parts.length === 1 && storedHash.length === 64) {
    const expectedBytes = hexToBytes(storedHash);
    if (!expectedBytes || expectedBytes.byteLength !== 32) return false;
    const actualBytes = await sha256Bytes(rawKey);
    return constantTimeEqual(actualBytes, expectedBytes);
  }

  return false;
}

/**
 * Constant-time verification of a shared secret (such as WORKER_REGISTRATION_TOKEN)
 * by comparing fixed 32-byte SHA-256 digests so input length cannot leak.
 */
export async function verifySharedSecretConstantTime(
  provided: string | undefined | null,
  expected: string | undefined | null
): Promise<boolean> {
  if (!provided || !expected) {
    return false;
  }
  const [providedDigest, expectedDigest] = await Promise.all([
    sha256Bytes(provided),
    sha256Bytes(expected),
  ]);
  return constantTimeEqual(providedDigest, expectedDigest);
}

/**
 * Extract Bearer token from Authorization header and reject credentials in URL query params.
 */
export function extractWorkerBearerToken(
  authHeader: string | null,
  url: URL
): BearerExtractionResult {
  const forbiddenParams = ['api_key', 'worker_key', 'token', 'access_token'];
  for (const param of forbiddenParams) {
    if (url.searchParams.has(param)) {
      return {
        status: 400,
        error: `Credentials must not be passed in URL query parameter '${param}'; use Authorization: Bearer <api_key>`,
      };
    }
  }

  if (!authHeader) {
    return {
      status: 401,
      error: 'Missing Authorization header (expected Authorization: Bearer <worker_api_key>)',
    };
  }

  const match = authHeader.trim().match(/^Bearer\s+([^\s]+)$/i);
  if (!match || !match[1]) {
    return {
      status: 401,
      error: 'Malformed Authorization header (expected Bearer <worker_api_key>)',
    };
  }

  const token = match[1];
  if (token.length < 16 || token.length > 256 || /[\x00-\x1f\x7f]/.test(token)) {
    return {
      status: 401,
      error: 'Invalid worker API key format',
    };
  }

  return { token };
}

/**
 * Validate timestamp freshness and nonce format to prevent replay attacks.
 */
export function validateReplayHeaders(
  timestampHeader: string | null,
  nonceHeader: string | null,
  requireNonce = false,
  nowMs = Date.now()
): ReplayHeaderValidationResult {
  if (timestampHeader === null && nonceHeader === null) {
    if (requireNonce) {
      return {
        ok: false,
        status: 400,
        error: 'Missing required replay-protection headers: X-Worker-Timestamp and X-Worker-Nonce',
      };
    }
    return { ok: true };
  }

  if (timestampHeader === null || nonceHeader === null) {
    return {
      ok: false,
      status: 400,
      error: 'Both X-Worker-Timestamp and X-Worker-Nonce headers must be supplied together',
    };
  }

  const trimmedTs = timestampHeader.trim();
  let timestampMs: number;
  if (/^\d+$/.test(trimmedTs)) {
    const numeric = Number(trimmedTs);
    // Support both seconds (10 digits) and milliseconds (13 digits)
    timestampMs = numeric < 1e12 ? numeric * 1000 : numeric;
  } else {
    timestampMs = Date.parse(trimmedTs);
  }

  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid X-Worker-Timestamp header value',
    };
  }

  if (Math.abs(nowMs - timestampMs) > REPLAY_WINDOW_MS) {
    return {
      ok: false,
      status: 401,
      error: 'Request timestamp expired or outside allowed 300s clock skew window',
    };
  }

  const trimmedNonce = nonceHeader.trim();
  if (!/^[a-zA-Z0-9._-]{12,128}$/.test(trimmedNonce)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid X-Worker-Nonce header (expected 12-128 alphanumeric, dot, underscore, or hyphen characters)',
    };
  }

  return {
    ok: true,
    timestampMs,
    nonce: trimmedNonce,
  };
}

/**
 * Redact any secret keys or bearer tokens from strings before logging or returning error details.
 */
export function redactSecrets(input: string): string {
  return input
    .replace(/ak_live_[a-zA-Z0-9_-]{8,}/g, 'ak_live_[REDACTED]')
    .replace(/(Bearer\s+)[a-zA-Z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/((?:hmac-)?sha256\$[0-9a-fA-F]+\$)[0-9a-fA-F]+/g, '$1[REDACTED]');
}

/**
 * Separates task_steps status normalization from main tasks lifecycle status handling.
 * - Maps active worker sub-stages ('downloading', 'loading_model', 'uploading') to 'running'
 *   for task_steps.status while preserving the exact lifecycle stage for tasks.status.
 * - Preserves valid task_steps statuses ('pending', 'running', 'completed', 'failed', 'skipped', 'waiting_approval').
 * - Rejects invalid/unrecognized statuses with HTTP 400 instead of silently coercing them.
 */
export function normalizeWorkerProgressStatus(rawStatus: unknown): ProgressStatusResolution {
  if (rawStatus === undefined || rawStatus === null) {
    return {
      ok: true,
      stepStatus: 'running',
      taskLifecycleStatus: 'running',
    };
  }

  if (typeof rawStatus !== 'string') {
    return {
      ok: false,
      status: 400,
      error: `Invalid task progress status: expected a string, received ${typeof rawStatus}`,
    };
  }

  const trimmed = rawStatus.trim();
  if (!trimmed) {
    return {
      ok: false,
      status: 400,
      error:
        "Invalid task progress status '': expected one of downloading, loading_model, running, uploading, pending, completed, failed, skipped, waiting_approval",
    };
  }

  const mappedStepStatus = STEP_STATUS_NORMALIZATION_MAP[trimmed];
  if (!mappedStepStatus) {
    return {
      ok: false,
      status: 400,
      error: `Invalid task progress status '${trimmed}': expected one of downloading, loading_model, running, uploading, pending, completed, failed, skipped, waiting_approval`,
    };
  }

  return {
    ok: true,
    stepStatus: mappedStepStatus,
    taskLifecycleStatus: ACTIVE_LIFECYCLE_STAGE_SET.has(trimmed)
      ? (trimmed as WorkerActiveLifecycleStage)
      : undefined,
  };
}

/**
 * Validate and normalize step_number for task progress updates.
 */
export function normalizeStepNumber(
  rawStepNumber: unknown
): { ok: true; stepNumber: number } | { ok: false; status: 400; error: string } {
  if (rawStepNumber === undefined || rawStepNumber === null) {
    return { ok: true, stepNumber: 1 };
  }

  if (typeof rawStepNumber === 'number') {
    if (!Number.isInteger(rawStepNumber) || rawStepNumber < 1) {
      return {
        ok: false,
        status: 400,
        error: `Invalid step_number '${rawStepNumber}': expected a positive integer >= 1`,
      };
    }
    return { ok: true, stepNumber: rawStepNumber };
  }

  if (typeof rawStepNumber === 'string' && /^\d+$/.test(rawStepNumber.trim())) {
    const parsed = Number(rawStepNumber.trim());
    if (Number.isInteger(parsed) && parsed >= 1) {
      return { ok: true, stepNumber: parsed };
    }
  }

  return {
    ok: false,
    status: 400,
    error: 'Invalid step_number: expected a positive integer >= 1',
  };
}

// ==========================================
// Base64URL & General Cryptographic Helpers
// ==========================================

export function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function normalizeEmail(email: string): string {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

export function generateSecureToken(bytesLen = 32): string {
  const bytes = new Uint8Array(bytesLen);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// ==========================================
// AES-GCM-256 Secret Encryption (TOTP & Kaggle)
// ==========================================

const DEFAULT_SECRET_PEPPER = 'aetheros_platform_encryption_key_v1';

async function deriveAesKey(secretPepper?: string): Promise<CryptoKey> {
  const pepper = secretPepper || DEFAULT_SECRET_PEPPER;
  const hash = await sha256Bytes(pepper);
  return crypto.subtle.importKey(
    'raw',
    hash as any,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSecret(
  plaintext: string,
  secretPepper?: string
): Promise<{ ciphertext: string; iv: string }> {
  const key = await deriveAesKey(secretPepper);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encoded = textEncoder.encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as any },
    key,
    encoded as any
  );
  return {
    ciphertext: base64UrlEncode(new Uint8Array(cipherBuffer)),
    iv: base64UrlEncode(iv),
  };
}

export async function decryptSecret(
  ciphertext: string,
  iv: string,
  secretPepper?: string
): Promise<string> {
  const key = await deriveAesKey(secretPepper);
  const cipherBytes = base64UrlDecode(ciphertext);
  const ivBytes = base64UrlDecode(iv);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes as any },
    key,
    cipherBytes as any
  );
  return new TextDecoder().decode(decrypted);
}

// ==========================================
// TOTP (RFC 6238 / RFC 4226) Implementation
// ==========================================

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(str: string): Uint8Array {
  const cleaned = str.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const val = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (val === -1) continue;
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

export function generateTotpSecret(): string {
  const randomBytes = new Uint8Array(20); // 160 bits RFC recommend
  crypto.getRandomValues(randomBytes);
  return base32Encode(randomBytes);
}

export async function generateTotpCode(
  secretBase32: string,
  counter?: number
): Promise<string> {
  const timeStep = 30;
  const effectiveCounter =
    counter !== undefined ? counter : Math.floor(Date.now() / 1000 / timeStep);
  const secretBytes = base32Decode(secretBase32);

  const counterBytes = new Uint8Array(8);
  let tempCounter = effectiveCounter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = tempCounter & 0xff;
    tempCounter = Math.floor(tempCounter / 256);
  }

  const hmacKey = await crypto.subtle.importKey(
    'raw',
    secretBytes as any,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, counterBytes as any));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

export async function verifyTotpCode(
  secretBase32: string,
  token: string,
  lastVerifiedCounter = 0
): Promise<{ valid: boolean; counter: number }> {
  const cleanedToken = token.trim().replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleanedToken)) {
    return { valid: false, counter: 0 };
  }

  const currentCounter = Math.floor(Date.now() / 1000 / 30);
  // Allow window of -1, 0, +1 to accommodate minor clock drift
  for (let skew = -1; skew <= 1; skew++) {
    const testCounter = currentCounter + skew;
    if (testCounter <= lastVerifiedCounter) {
      continue; // Replay attack prevention: strictly reject reuse of past counters
    }
    const expected = await generateTotpCode(secretBase32, testCounter);
    if (constantTimeEqual(textEncoder.encode(expected), textEncoder.encode(cleanedToken))) {
      return { valid: true, counter: testCounter };
    }
  }

  return { valid: false, counter: 0 };
}

// ==========================================
// WebAuthn / Passkey Primitives & Verifier
// ==========================================

export interface WebAuthnClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

export function parseWebAuthnClientData(clientDataJSONBase64: string): WebAuthnClientData {
  const decodedBytes = base64UrlDecode(clientDataJSONBase64);
  const jsonStr = new TextDecoder().decode(decodedBytes);
  return JSON.parse(jsonStr) as WebAuthnClientData;
}

export function verifyWebAuthnChallenge(
  clientDataJSON: string,
  expectedChallenge: string,
  expectedOrigin: string,
  expectedType: 'webauthn.create' | 'webauthn.get'
): { ok: boolean; error?: string } {
  try {
    const clientData = parseWebAuthnClientData(clientDataJSON);
    if (clientData.type !== expectedType) {
      return { ok: false, error: `Invalid WebAuthn type: got '${clientData.type}', expected '${expectedType}'` };
    }
    if (clientData.challenge !== expectedChallenge) {
      return { ok: false, error: 'WebAuthn challenge mismatch' };
    }
    if (expectedOrigin && clientData.origin && !clientData.origin.startsWith(expectedOrigin) && !expectedOrigin.startsWith(clientData.origin)) {
      // Allow localhost / preview ports or exact origin match
      const urlA = new URL(clientData.origin);
      const urlB = new URL(expectedOrigin);
      if (urlA.hostname !== urlB.hostname) {
        return { ok: false, error: `WebAuthn origin mismatch: got '${clientData.origin}', expected '${expectedOrigin}'` };
      }
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `Failed to parse WebAuthn clientDataJSON: ${err.message}` };
  }
}

/**
 * Verifies WebAuthn assertion signature (ES256 or RS256) using Web Crypto.
 */
export async function verifyWebAuthnAssertionSignature(
  publicKeyHexOrBase64: string,
  algorithm: number,
  authenticatorDataBase64: string,
  clientDataJSONBase64: string,
  signatureBase64: string
): Promise<boolean> {
  try {
    const authDataBytes = base64UrlDecode(authenticatorDataBase64);
    const clientDataBytes = base64UrlDecode(clientDataJSONBase64);
    const clientDataHash = await sha256Bytes(clientDataBytes);

    // signedData = authenticatorData || sha256(clientDataJSON)
    const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length);
    signedData.set(authDataBytes, 0);
    signedData.set(clientDataHash, authDataBytes.length);

    const sigBytes = base64UrlDecode(signatureBase64);
    const rawKeyBytes = base64UrlDecode(publicKeyHexOrBase64);

    let cryptoKey: CryptoKey;
    if (algorithm === -7) {
      // ES256 (P-256 ECDSA)
      cryptoKey = await crypto.subtle.importKey(
        'spki',
        rawKeyBytes as any,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );

      // WebAuthn ECDSA signature is ASN.1 DER sequence; convert to IEEE P1363 if needed, or verify
      let ieeeSig = sigBytes;
      if (sigBytes.length > 64 && sigBytes[0] === 0x30) {
        ieeeSig = derToRawEcdsaSignature(sigBytes);
      }

      return await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        cryptoKey,
        ieeeSig as any,
        signedData as any
      );
    } else {
      // RS256
      cryptoKey = await crypto.subtle.importKey(
        'spki',
        rawKeyBytes as any,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      );
      return await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        sigBytes as any,
        signedData as any
      );
    }
  } catch (err) {
    return false;
  }
}

function derToRawEcdsaSignature(der: Uint8Array): Uint8Array {
  // Convert ASN.1 DER signature (30 <len> 02 <lenR> R 02 <lenS> S) to 64-byte raw (R || S)
  let offset = 2; // Skip 0x30 and seq length
  if (der[1] & 0x80) {
    offset += (der[1] & 0x7f);
  }

  // R
  offset += 1; // 0x02
  let rLen = der[offset++];
  let rBytes = der.slice(offset, offset + rLen);
  offset += rLen;

  // S
  offset += 1; // 0x02
  let sLen = der[offset++];
  let sBytes = der.slice(offset, offset + sLen);

  // Strip leading 0x00 padding
  while (rBytes.length > 32 && rBytes[0] === 0) rBytes = rBytes.slice(1);
  while (sBytes.length > 32 && sBytes[0] === 0) sBytes = sBytes.slice(1);

  const raw = new Uint8Array(64);
  raw.set(rBytes, 32 - rBytes.length);
  raw.set(sBytes, 64 - sBytes.length);
  return raw;
}
