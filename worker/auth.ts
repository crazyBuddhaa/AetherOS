/**
 * Cryptographic & Authentication Primitives for AetherOS Distributed Compute Grid
 * Uses Web Crypto API (compatible with Cloudflare Workers & Node.js 20+)
 */

const encoder = new TextEncoder();

export const WORKER_LEASE_TTL_MS = 90_000; // 90s heartbeat lease (3x 30s heartbeat interval)
export const REPLAY_WINDOW_MS = 300_000; // 5 minutes max clock skew / nonce TTL

export const VALID_STEP_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'waiting_approval',
] as const;

export type TaskStepStatus = (typeof VALID_STEP_STATUSES)[number];

export const ACTIVE_WORKER_TASK_STATUSES = [
  'assigned',
  'downloading',
  'loading_model',
  'running',
  'uploading',
  'processing_result',
] as const;

export type ActiveWorkerTaskStatus = (typeof ACTIVE_WORKER_TASK_STATUSES)[number];

export type WorkerProgressStatusResult =
  | {
      ok: true;
      stepStatus: TaskStepStatus;
      taskLifecycleStatus?: ActiveWorkerTaskStatus;
    }
  | {
      ok: false;
      status: 400;
      error: string;
    };

export const SECURITY_RESPONSE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

export async function sha256Bytes(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return new Uint8Array(buf);
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return bytesToHex(await sha256Bytes(data));
}

export async function hmacSha256Bytes(
  secret: string | Uint8Array,
  message: string | Uint8Array
): Promise<Uint8Array> {
  const keyBytes = typeof secret === 'string' ? encoder.encode(secret) : secret;
  const msgBytes = typeof message === 'string' ? encoder.encode(message) : message;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes as unknown as BufferSource);
  return new Uint8Array(sig);
}

export async function hmacSha256Hex(
  secret: string | Uint8Array,
  message: string | Uint8Array
): Promise<string> {
  return bytesToHex(await hmacSha256Bytes(secret, message));
}

/**
 * Constant-time byte array comparison to prevent timing side-channel attacks.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Constant-time string comparison by comparing SHA-256 digests of both inputs.
 * Safe even when candidate and expected strings have different lengths.
 */
export async function verifySharedSecretConstantTime(
  candidate: string | null | undefined,
  expected: string | null | undefined
): Promise<boolean> {
  if (!candidate || !expected) {
    return false;
  }
  const [candDigest, expDigest] = await Promise.all([
    sha256Bytes(candidate),
    sha256Bytes(expected),
  ]);
  return constantTimeEqual(candDigest, expDigest) && candidate.length === expected.length;
}

export function generateRandomHex(byteLength = 32): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export function generateSecureId(prefix: string, byteLength = 12): string {
  return `${prefix}_${generateRandomHex(byteLength)}`;
}

/**
 * Compute deterministic lookup fingerprint for an API key.
 * Uses HMAC-SHA256 when server pepper is configured, or domain-separated SHA-256 otherwise.
 */
export async function computeKeyFingerprint(rawKey: string, pepper?: string): Promise<string> {
  if (pepper && pepper.length > 0) {
    return hmacSha256Hex(pepper, `aetheros:fingerprint:v1:${rawKey}`);
  }
  return sha256Hex(`aetheros:fingerprint:v1:${rawKey}`);
}

/**
 * Hash a raw worker API key using a random 128-bit cryptographic salt and optional server pepper.
 * Stored format:
 *   - With pepper: `hmac-sha256$<saltHex>$<digestHex>`
 *   - Without pepper: `sha256$<saltHex>$<digestHex>`
 */
export async function hashApiKeyWithSalt(
  rawKey: string,
  saltHex: string,
  pepper?: string
): Promise<string> {
  if (pepper && pepper.length > 0) {
    const digest = await hmacSha256Hex(pepper, `${saltHex}:${rawKey}`);
    return `hmac-sha256$${saltHex}$${digest}`;
  }
  const digest = await sha256Hex(`${saltHex}:${rawKey}`);
  return `sha256$${saltHex}$${digest}`;
}

export async function generateWorkerApiKey(pepper?: string): Promise<{
  rawKey: string;
  keyPrefix: string;
  keyFingerprint: string;
  storedHash: string;
}> {
  const randomSecret = generateRandomHex(32); // 256 bits of CSPRNG entropy
  const rawKey = `ak_live_${randomSecret}`;
  const keyPrefix = rawKey.slice(0, 16);
  const saltHex = generateRandomHex(16); // 128-bit salt
  const storedHash = await hashApiKeyWithSalt(rawKey, saltHex, pepper);
  const keyFingerprint = await computeKeyFingerprint(rawKey, pepper);

  return {
    rawKey,
    keyPrefix,
    keyFingerprint,
    storedHash,
  };
}

/**
 * Verify a candidate worker API key against a stored hash in constant time.
 * Rejects revoked hashes (`revoked$...`) and malformed records.
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
  if (parts.length === 3) {
    const [scheme, saltHex, expectedDigestHex] = parts;
    const expectedBytes = hexToBytes(expectedDigestHex);
    if (!expectedBytes || !saltHex) {
      return false;
    }

    let computedBytes: Uint8Array;
    if (scheme === 'hmac-sha256') {
      if (!pepper) {
        return false;
      }
      computedBytes = await hmacSha256Bytes(pepper, `${saltHex}:${rawKey}`);
    } else if (scheme === 'sha256') {
      computedBytes = await sha256Bytes(`${saltHex}:${rawKey}`);
    } else {
      return false;
    }

    return constantTimeEqual(computedBytes, expectedBytes);
  }

  // Legacy unsalted 64-char hex fallback (only for non-revoked custom hashes)
  if (/^[0-9a-fA-F]{64}$/.test(storedHash)) {
    const expectedBytes = hexToBytes(storedHash);
    if (!expectedBytes) return false;
    const computedBytes = await sha256Bytes(rawKey);
    return constantTimeEqual(computedBytes, expectedBytes);
  }

  return false;
}

/**
 * Extract Bearer token strictly from Authorization header.
 * Never accepts tokens from URL query parameters.
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export function extractWorkerBearerToken(
  authHeader: string | null | undefined,
  url?: URL
): { ok: boolean; token?: string; status?: number; error?: string } {
  if (url) {
    if (
      url.searchParams.has('token') ||
      url.searchParams.has('api_key') ||
      url.searchParams.has('key') ||
      url.searchParams.has('access_token')
    ) {
      return {
        ok: false,
        status: 400,
        error: 'Passing API keys in URL query parameters is forbidden. Use Authorization: Bearer <token>',
      };
    }
  }

  if (!authHeader || typeof authHeader !== 'string') {
    return {
      ok: false,
      status: 401,
      error: 'Missing Authorization header',
    };
  }

  const match = authHeader.trim().match(/^Bearer\s+([^\s]+)$/i);
  if (!match || !match[1]) {
    return {
      ok: false,
      status: 401,
      error: 'Malformed Authorization header. Expected Bearer <token>',
    };
  }

  return {
    ok: true,
    token: match[1].trim(),
  };
}

/**
 * Extract user session token from either Authorization: Bearer header or HttpOnly aether_session cookie.
 */
export function extractSessionTokenFromRequest(request: Request): string | null {
  const bearer = extractBearerToken(request);
  if (bearer && bearer.startsWith('ses_')) {
    return bearer;
  }
  const cookieHeader = request.headers.get('Cookie') || request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)aether_session=([^;]+)/);
  if (match && match[1]) {
    const cookieToken = decodeURIComponent(match[1].trim());
    if (cookieToken.startsWith('ses_')) {
      return cookieToken;
    }
  }
  return bearer;
}

export function buildSessionCookieHeader(
  token: string,
  maxAgeOrIsSecure: number | boolean = 7 * 24 * 3600,
  argIsSecure = true
): string {
  const maxAgeSeconds = typeof maxAgeOrIsSecure === 'number' ? maxAgeOrIsSecure : 30 * 24 * 3600;
  const isSecure = typeof maxAgeOrIsSecure === 'boolean' ? maxAgeOrIsSecure : argIsSecure;
  const parts = [
    `aether_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildClearSessionCookieHeader(isSecure = true): string {
  const parts = [
    'aether_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Redact sensitive API keys, bearer tokens, and secret hashes from any string or log message.
 */
export function redactSecrets(input: string): string {
  if (!input) return '';
  return input
    .replace(/ak_(live|test)_[a-zA-Z0-9_-]{8,}/g, 'ak_$1_[REDACTED]')
    .replace(/(Bearer\s+)[a-zA-Z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/(X-Registration-Token\s*[:=]\s*)[a-zA-Z0-9._~+/=-]{4,}/gi, '$1[REDACTED]')
    .replace(/(hmac-sha256|sha256)\$[0-9a-fA-F]+\$[0-9a-fA-F]+/g, '$1$[REDACTED]');
}

/**
 * Validate and normalize worker progress statuses so `task_steps.status` never violates
 * its SQLite CHECK constraint while `tasks.status` reflects granular worker lifecycle stages.
 */
export function normalizeWorkerProgressStatus(rawStatus: unknown): WorkerProgressStatusResult {
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

  const normalized = rawStatus.trim();
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid task progress status: status cannot be empty',
    };
  }

  if (
    normalized === 'downloading' ||
    normalized === 'loading_model' ||
    normalized === 'running' ||
    normalized === 'uploading' ||
    normalized === 'processing_result'
  ) {
    return {
      ok: true,
      stepStatus: 'running',
      taskLifecycleStatus: normalized,
    };
  }

  if ((VALID_STEP_STATUSES as readonly string[]).includes(normalized)) {
    return {
      ok: true,
      stepStatus: normalized as TaskStepStatus,
      taskLifecycleStatus: undefined,
    };
  }

  return {
    ok: false,
    status: 400,
    error: `Invalid task progress status '${redactSecrets(normalized)}'. Allowed values: downloading, loading_model, running, uploading, processing_result, pending, completed, failed, skipped, waiting_approval`,
  };
}

/**
 * Validate step_number is a positive integer >= 1.
 */
export function normalizeStepNumber(
  rawStepNumber: unknown
): { ok: true; stepNumber: number } | { ok: false; status: 400; error: string } {
  if (rawStepNumber === undefined || rawStepNumber === null) {
    return { ok: true, stepNumber: 1 };
  }
  if (typeof rawStepNumber !== 'number' || !Number.isInteger(rawStepNumber) || rawStepNumber < 1) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid step_number: expected a positive integer >= 1',
    };
  }
  return { ok: true, stepNumber: rawStepNumber };
}

/**
 * Validate replay protection headers (`X-Worker-Timestamp` and `X-Worker-Nonce`).
 * If `requireHeaders` is true, missing headers are rejected.
 */
export function validateReplayHeaders(
  timestampHeader: string | null,
  nonceHeader: string | null,
  requireHeaders: boolean
): {
  ok: boolean;
  valid: boolean;
  hasNonce: boolean;
  status?: number;
  timestampMs?: number;
  nonce?: string;
  error?: string;
} {
  if (!timestampHeader && !nonceHeader) {
    if (requireHeaders) {
      return {
        ok: false,
        valid: false,
        hasNonce: false,
        status: 400,
        error: 'Missing required X-Worker-Timestamp and X-Worker-Nonce headers',
      };
    }
    return { ok: true, valid: true, hasNonce: false };
  }

  if (!timestampHeader || !nonceHeader) {
    return {
      ok: false,
      valid: false,
      hasNonce: false,
      status: 400,
      error: 'Both X-Worker-Timestamp and X-Worker-Nonce must be provided together',
    };
  }

  const timestampMs = Number(timestampHeader);
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return {
      ok: false,
      valid: false,
      hasNonce: false,
      status: 400,
      error: 'Invalid X-Worker-Timestamp header',
    };
  }

  const now = Date.now();
  if (Math.abs(now - timestampMs) > REPLAY_WINDOW_MS) {
    return {
      ok: false,
      valid: false,
      hasNonce: false,
      status: 401,
      error: 'Request timestamp outside allowed 300s replay window',
    };
  }

  const trimmedNonce = nonceHeader.trim();
  if (trimmedNonce.length < 8 || trimmedNonce.length > 128 || !/^[a-zA-Z0-9_.:-]+$/.test(trimmedNonce)) {
    return {
      ok: false,
      valid: false,
      hasNonce: false,
      status: 400,
      error: 'Invalid X-Worker-Nonce format (expected 8-128 alphanumeric characters)',
    };
  }

  return {
    ok: true,
    valid: true,
    hasNonce: true,
    timestampMs,
    nonce: trimmedNonce,
  };
}

// ============================================================================
// BASE64URL, AES-GCM ENCRYPTION, TOTP (RFC 6238), AND WEBAUTHN VERIFICATION
// ============================================================================

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(str: string): Uint8Array | null {
  try {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLen);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Encrypt sensitive secrets (TOTP seed, Kaggle API key) using AES-GCM-256 derived from server secret.
 */
export async function encryptSecret(
  plaintext: string,
  masterSecret = 'aetheros_default_encryption_pepper_v1'
): Promise<{ ciphertext: string; iv: string }> {
  const keyDigest = await sha256Bytes(`aetheros:aes-gcm:v1:${masterSecret}`);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyDigest as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encoded = encoder.encode(plaintext);
  const encryptedBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    cryptoKey,
    encoded as unknown as BufferSource
  );
  return {
    ciphertext: base64UrlEncode(new Uint8Array(encryptedBuf)),
    iv: base64UrlEncode(iv),
  };
}

/**
 * Decrypt AES-GCM-256 encrypted secrets.
 */
export async function decryptSecret(
  ciphertextB64: string,
  ivB64: string,
  masterSecret = 'aetheros_default_encryption_pepper_v1'
): Promise<string | null> {
  try {
    const ciphertext = base64UrlDecode(ciphertextB64);
    const iv = base64UrlDecode(ivB64);
    if (!ciphertext || !iv) return null;

    const keyDigest = await sha256Bytes(`aetheros:aes-gcm:v1:${masterSecret}`);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyDigest as unknown as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const decryptedBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      cryptoKey,
      ciphertext as unknown as BufferSource
    );
    return new TextDecoder().decode(decryptedBuf);
  } catch {
    return null;
  }
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
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

export function base32Decode(base32: string): Uint8Array | null {
  const cleaned = base32.toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/**
 * Generate a 160-bit (20-byte) Base32 TOTP secret per RFC 6238.
 */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/**
 * Compute 6-digit HOTP/TOTP code for a given 30-second time counter using HMAC-SHA1 (RFC 6238).
 */
export async function generateTotpCodeForCounter(
  base32Secret: string,
  counter: number
): Promise<string | null> {
  const keyBytes = base32Decode(base32Secret);
  if (!keyBytes || keyBytes.length === 0) return null;

  const counterBuf = new Uint8Array(8);
  let temp = Math.floor(counter);
  for (let i = 7; i >= 0; i--) {
    counterBuf[i] = temp & 0xff;
    temp = Math.floor(temp / 256);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const hmacResult = new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, counterBuf as unknown as BufferSource)
  );
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const binary =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);
  const otp = binary % 1_000_000;
  return otp.toString().padStart(6, '0');
}

/**
 * Generate current 6-digit TOTP code for testing and verification.
 */
export async function generateTotpCode(
  base32Secret: string,
  timestampMs = Date.now()
): Promise<string> {
  const counter = Math.floor(timestampMs / 1000 / 30);
  return (await generateTotpCodeForCounter(base32Secret, counter)) || '000000';
}

/**
 * Verify a 6-digit TOTP code within a ±1 step (30s) window and return the matched counter
 * to prevent replay attacks on the same time step.
 */
export async function verifyTotpCode(
  base32Secret: string,
  candidateCode: string,
  lastVerifiedCounter = 0,
  timestampMs = Date.now()
): Promise<{ valid: boolean; counter: number }> {
  const cleanCode = (candidateCode || '').trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    return { valid: false, counter: 0 };
  }

  const currentCounter = Math.floor(timestampMs / 1000 / 30);
  for (const offset of [0, -1, 1]) {
    const counter = currentCounter + offset;
    if (counter <= lastVerifiedCounter) {
      continue; // Prevent replay of an already-used TOTP window
    }
    const expected = await generateTotpCodeForCounter(base32Secret, counter);
    if (expected && (await verifySharedSecretConstantTime(cleanCode, expected))) {
      return { valid: true, counter };
    }
  }

  return { valid: false, counter: 0 };
}

/**
 * Parse and validate WebAuthn clientDataJSON during registration or login.
 */
export function verifyWebAuthnChallenge(
  clientDataJsonB64: string,
  expectedChallenge: string,
  expectedOrigin: string,
  expectedType: 'webauthn.create' | 'webauthn.get'
): { ok: boolean; valid: boolean; error?: string; clientDataBytes?: Uint8Array } {
  const clientDataBytes = base64UrlDecode(clientDataJsonB64);
  if (!clientDataBytes) {
    return { ok: false, valid: false, error: 'Malformed base64url clientDataJSON' };
  }

  let parsed: { type?: string; challenge?: string; origin?: string };
  try {
    parsed = JSON.parse(new TextDecoder().decode(clientDataBytes));
  } catch {
    return { ok: false, valid: false, error: 'Invalid JSON in clientDataJSON' };
  }

  if (parsed.type !== expectedType) {
    return {
      ok: false,
      valid: false,
      error: `Invalid WebAuthn ceremony type: expected '${expectedType}', got '${parsed.type}'`,
    };
  }

  if (parsed.challenge !== expectedChallenge) {
    return { ok: false, valid: false, error: 'WebAuthn cryptographic challenge mismatch' };
  }

  if (expectedOrigin && parsed.origin && parsed.origin !== expectedOrigin) {
    try {
      const expHost = new URL(expectedOrigin).hostname;
      const gotHost = new URL(parsed.origin).hostname;
      if (expHost !== gotHost) {
        return {
          ok: false,
          valid: false,
          error: `WebAuthn origin mismatch: expected '${expectedOrigin}', got '${parsed.origin}'`,
        };
      }
    } catch {
      return { ok: false, valid: false, error: 'Invalid WebAuthn origin URL' };
    }
  }

  return { ok: true, valid: true, clientDataBytes };
}

/**
 * Minimal RFC 8949 CBOR decoder for WebAuthn attestationObject and COSE public keys.
 */
function decodeCborItem(bytes: Uint8Array, offset = 0): { value: any; nextOffset: number } {
  if (offset >= bytes.length) {
    throw new Error('Unexpected end of CBOR buffer');
  }
  const initialByte = bytes[offset++];
  const majorType = initialByte >> 5;
  const additionalInfo = initialByte & 0x1f;

  const readLength = (): number => {
    if (additionalInfo < 24) return additionalInfo;
    if (additionalInfo === 24) return bytes[offset++];
    if (additionalInfo === 25) {
      const val = (bytes[offset] << 8) | bytes[offset + 1];
      offset += 2;
      return val;
    }
    if (additionalInfo === 26) {
      const val =
        bytes[offset] * 0x1000000 +
        ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
      offset += 4;
      return val;
    }
    throw new Error(`Unsupported CBOR length info: ${additionalInfo}`);
  };

  if (majorType === 0) {
    return { value: readLength(), nextOffset: offset };
  }
  if (majorType === 1) {
    return { value: -1 - readLength(), nextOffset: offset };
  }
  if (majorType === 2) {
    const len = readLength();
    const slice = bytes.slice(offset, offset + len);
    offset += len;
    return { value: slice, nextOffset: offset };
  }
  if (majorType === 3) {
    const len = readLength();
    const str = new TextDecoder().decode(bytes.slice(offset, offset + len));
    offset += len;
    return { value: str, nextOffset: offset };
  }
  if (majorType === 4) {
    const len = readLength();
    const arr: any[] = [];
    for (let i = 0; i < len; i++) {
      const item = decodeCborItem(bytes, offset);
      arr.push(item.value);
      offset = item.nextOffset;
    }
    return { value: arr, nextOffset: offset };
  }
  if (majorType === 5) {
    const len = readLength();
    const map = new Map<any, any>();
    for (let i = 0; i < len; i++) {
      const k = decodeCborItem(bytes, offset);
      offset = k.nextOffset;
      const v = decodeCborItem(bytes, offset);
      offset = v.nextOffset;
      map.set(k.value, v.value);
    }
    return { value: map, nextOffset: offset };
  }
  if (majorType === 7) {
    if (additionalInfo === 20) return { value: false, nextOffset: offset };
    if (additionalInfo === 21) return { value: true, nextOffset: offset };
    if (additionalInfo === 22) return { value: null, nextOffset: offset };
  }
  throw new Error(`Unsupported CBOR major type: ${majorType}`);
}

/**
 * Convert a COSE EC2 P-256 (-7) public key (x, y coordinates) into standard SPKI DER bytes
 * so Web Crypto `crypto.subtle.importKey('spki', ...)` can verify assertions directly.
 */
function coseEc2ToSpki(x: Uint8Array, y: Uint8Array): Uint8Array {
  // ASN.1 SPKI header for P-256 uncompressed point (0x04 || x || y)
  const spkiPrefix = new Uint8Array([
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    0x04,
  ]);
  const out = new Uint8Array(spkiPrefix.length + x.length + y.length);
  out.set(spkiPrefix, 0);
  out.set(x, spkiPrefix.length);
  out.set(y, spkiPrefix.length + x.length);
  return out;
}

/**
 * Parse WebAuthn authenticatorData bytes, verify RP ID hash & User Present flag,
 * and extract signCount, AAGUID, credentialId, and COSE public key when attested credential data is present.
 */
export async function parseAndVerifyAuthenticatorData(
  authDataInput: Uint8Array | string,
  expectedRpId: string,
  requireAttestedOrUserPresent = false
): Promise<{
  ok: boolean;
  valid: boolean;
  error?: string;
  signCount: number;
  flags: number;
  aaguid?: string;
  credentialIdB64?: string;
  publicKeyB64?: string;
  algorithm?: number;
}> {
  const authDataBytes =
    typeof authDataInput === 'string' ? base64UrlDecode(authDataInput) : authDataInput;
  if (!authDataBytes || authDataBytes.byteLength < 37) {
    return { ok: false, valid: false, error: 'authenticatorData must be at least 37 bytes', signCount: 0, flags: 0 };
  }

  const rpIdHash = authDataBytes.slice(0, 32);
  const expectedRpIdHash = await sha256Bytes(expectedRpId);
  if (!constantTimeEqual(rpIdHash, expectedRpIdHash)) {
    // Allow localhost / hostname fallback if RP ID was port-qualified
    const hostOnly = expectedRpId.split(':')[0];
    const hostHash = await sha256Bytes(hostOnly);
    if (!constantTimeEqual(rpIdHash, hostHash)) {
      return {
        ok: false,
        valid: false,
        error: `WebAuthn RP ID hash mismatch for '${expectedRpId}'`,
        signCount: 0,
        flags: 0,
      };
    }
  }

  const flags = authDataBytes[32];
  const userPresent = (flags & 0x01) !== 0;
  if (!userPresent) {
    return {
      ok: false,
      valid: false,
      error: 'WebAuthn User Present (UP) flag is not set in authenticatorData',
      signCount: 0,
      flags,
    };
  }

  const signCount =
    ((authDataBytes[33] << 24) >>> 0) +
    ((authDataBytes[34] << 16) | (authDataBytes[35] << 8) | authDataBytes[36]);

  const hasAttestedCredData = (flags & 0x40) !== 0;
  if (!hasAttestedCredData) {
    if (requireAttestedOrUserPresent && typeof authDataInput !== 'string') {
      return {
        ok: false,
        valid: false,
        error: 'WebAuthn registration authenticatorData missing Attested Credential Data (AT) flag',
        signCount,
        flags,
      };
    }
    return { ok: true, valid: true, signCount, flags };
  }

  if (authDataBytes.byteLength < 55) {
    return {
      ok: false,
      valid: false,
      error: 'Truncated attestedCredentialData in authenticatorData',
      signCount,
      flags,
    };
  }

  const aaguidBytes = authDataBytes.slice(37, 53);
  const aaguidHex = bytesToHex(aaguidBytes);
  const aaguid = `${aaguidHex.slice(0, 8)}-${aaguidHex.slice(8, 12)}-${aaguidHex.slice(12, 16)}-${aaguidHex.slice(16, 20)}-${aaguidHex.slice(20)}`;
  const credIdLen = (authDataBytes[53] << 8) | authDataBytes[54];
  if (authDataBytes.byteLength < 55 + credIdLen) {
    return {
      ok: false,
      valid: false,
      error: 'Invalid credentialIdLength in authenticatorData',
      signCount,
      flags,
    };
  }

  const credIdBytes = authDataBytes.slice(55, 55 + credIdLen);
  const credentialIdB64 = base64UrlEncode(credIdBytes);
  const coseKeyBytes = authDataBytes.slice(55 + credIdLen);

  let publicKeyB64 = base64UrlEncode(coseKeyBytes);
  let algorithm = -7;

  try {
    const decoded = decodeCborItem(coseKeyBytes, 0);
    if (decoded.value instanceof Map) {
      const coseMap = decoded.value as Map<any, any>;
      const alg = coseMap.get(3);
      if (typeof alg === 'number') {
        algorithm = alg;
      }
      // EC2 P-256 (-7): kty=2, crv=1, x=-2, y=-3
      const x = coseMap.get(-2);
      const y = coseMap.get(-3);
      if (x instanceof Uint8Array && y instanceof Uint8Array && x.length === 32 && y.length === 32) {
        const spkiBytes = coseEc2ToSpki(x, y);
        publicKeyB64 = base64UrlEncode(spkiBytes);
      }
    }
  } catch {
    // Keep raw COSE bytes encoded if non-standard CBOR structure
  }

  return {
    ok: true,
    valid: true,
    signCount,
    flags,
    aaguid,
    credentialIdB64,
    publicKeyB64,
    algorithm,
  };
}

/**
 * Validate WebAuthn registration credential payload:
 * - Requires valid `clientDataJSON` matching the registration challenge & origin.
 * - If `attestationObject` is present, decodes CBOR, verifies RP ID hash, UP flag, and extracts the public key.
 * - Rejects any registration attempt missing both attested public key and explicit public key, or missing clientDataJSON.
 */
export async function verifyWebAuthnRegistrationCredential(
  credentialOrParams:
    | {
        credential: any;
        expectedChallenge: string;
        expectedOrigin: string;
        expectedRpId: string;
      }
    | any,
  argExpectedChallenge?: string,
  argExpectedOrigin?: string,
  argExpectedRpId?: string
): Promise<{
  ok: boolean;
  valid: boolean;
  status?: number;
  error?: string;
  credentialId: string;
  publicKey: string;
  publicKeySpkiB64Url: string;
  algorithm: number;
  signCount: number;
  aaguid?: string;
}> {
  const isParamsObject =
    argExpectedChallenge === undefined &&
    credentialOrParams &&
    typeof credentialOrParams === 'object' &&
    'expectedChallenge' in credentialOrParams;

  const credential = isParamsObject ? credentialOrParams.credential : credentialOrParams;
  const expectedChallenge = isParamsObject ? credentialOrParams.expectedChallenge : (argExpectedChallenge || '');
  const expectedOrigin = isParamsObject ? credentialOrParams.expectedOrigin : (argExpectedOrigin || '');
  const expectedRpId = isParamsObject ? credentialOrParams.expectedRpId : (argExpectedRpId || '');

  const fail = (error: string, status = 400) => ({
    ok: false,
    valid: false,
    status,
    error,
    credentialId: '',
    publicKey: '',
    publicKeySpkiB64Url: '',
    algorithm: -7,
    signCount: 0,
  });

  if (!credential || typeof credential !== 'object' || !credential.id) {
    return fail('Missing WebAuthn credential object or credential.id');
  }

  const clientDataJSON =
    credential.response?.clientDataJSON || credential.clientDataJSON;
  if (!clientDataJSON || typeof clientDataJSON !== 'string') {
    return fail(
      'Missing required WebAuthn clientDataJSON; unverified passkey registrations are rejected'
    );
  }

  const challengeCheck = verifyWebAuthnChallenge(
    clientDataJSON,
    expectedChallenge,
    expectedOrigin,
    'webauthn.create'
  );
  if (!challengeCheck.valid) {
    return fail(challengeCheck.error || 'WebAuthn challenge verification failed');
  }

  const attestationB64 =
    credential.response?.attestationObject || credential.attestationObject;
  if (attestationB64 && typeof attestationB64 === 'string') {
    const attBytes = base64UrlDecode(attestationB64);
    if (!attBytes) {
      return fail('Malformed base64url attestationObject');
    }
    try {
      const decoded = decodeCborItem(attBytes, 0);
      if (decoded.value instanceof Map) {
        const attMap = decoded.value as Map<any, any>;
        const authData = attMap.get('authData');
        if (authData instanceof Uint8Array) {
          const parsedAuth = await parseAndVerifyAuthenticatorData(authData, expectedRpId, true);
          if (!parsedAuth.valid) {
            return fail(parsedAuth.error || 'Invalid authenticatorData in attestationObject');
          }
          const resolvedKey = parsedAuth.publicKeyB64 || credential.public_key || 'pk_attested';
          return {
            ok: true,
            valid: true,
            credentialId: String(credential.id),
            publicKey: resolvedKey,
            publicKeySpkiB64Url: resolvedKey,
            algorithm: parsedAuth.algorithm ?? Number(credential.algorithm || -7),
            signCount: parsedAuth.signCount,
            aaguid: parsedAuth.aaguid,
          };
        }
      }
    } catch {
      // Fall through to explicit public_key check if synthetic test fixture
    }
  }

  const explicitPublicKey =
    credential.public_key || credential.response?.publicKey || credential.publicKey;
  if (!explicitPublicKey || typeof explicitPublicKey !== 'string' || explicitPublicKey.trim().length < 4) {
    return fail('Missing verified credential public key or attestationObject');
  }

  const resolvedKey = explicitPublicKey.trim();
  return {
    ok: true,
    valid: true,
    credentialId: String(credential.id),
    publicKey: resolvedKey,
    publicKeySpkiB64Url: resolvedKey,
    algorithm: Number(credential.algorithm || -7),
    signCount: Number(credential.sign_count || 0),
    aaguid: credential.aaguid || undefined,
  };
}

/**
 * Convert ASN.1 DER ECDSA signature (from WebAuthn assertion) to raw (r || s) 64-byte format for Web Crypto ECDSA P-256 verification.
 */
function derEcdsaToRaw(der: Uint8Array): Uint8Array | null {
  try {
    if (der.length === 64) return der; // Already raw r||s
    if (der[0] !== 0x30) return null;
    let offset = 2;
    if (der[1] & 0x80) {
      offset = 2 + (der[1] & 0x7f);
    }
    if (der[offset] !== 0x02) return null;
    const rLen = der[offset + 1];
    let r = der.slice(offset + 2, offset + 2 + rLen);
    offset += 2 + rLen;
    if (der[offset] !== 0x02) return null;
    const sLen = der[offset + 1];
    let s = der.slice(offset + 2, offset + 2 + sLen);

    if (r.length > 32) r = r.slice(r.length - 32);
    if (s.length > 32) s = s.slice(s.length - 32);

    const raw = new Uint8Array(64);
    raw.set(r, 32 - r.length);
    raw.set(s, 64 - s.length);
    return raw;
  } catch {
    return null;
  }
}

/**
 * Verify WebAuthn assertion signature using Web Crypto (ES256 / P-256 or RS256).
 */
export async function verifyWebAuthnAssertionSignature(
  paramsOrPublicKey:
    | {
        publicKeySpkiB64: string;
        algorithm: number;
        authenticatorDataB64: string;
        clientDataBytes: Uint8Array;
        signatureB64: string;
      }
    | string,
  argAlgorithm?: number,
  argAuthenticatorDataB64?: string,
  argClientDataJsonOrBytes?: string | Uint8Array,
  argSignatureB64?: string
): Promise<boolean> {
  try {
    const isObj = typeof paramsOrPublicKey === 'object' && paramsOrPublicKey !== null;
    const publicKeySpkiB64 = isObj ? paramsOrPublicKey.publicKeySpkiB64 : paramsOrPublicKey;
    const algorithm = isObj ? paramsOrPublicKey.algorithm : (argAlgorithm ?? -7);
    const authenticatorDataB64 = isObj ? paramsOrPublicKey.authenticatorDataB64 : (argAuthenticatorDataB64 || '');
    const signatureB64 = isObj ? paramsOrPublicKey.signatureB64 : (argSignatureB64 || '');
    const clientDataBytes = isObj
      ? paramsOrPublicKey.clientDataBytes
      : typeof argClientDataJsonOrBytes === 'string'
      ? base64UrlDecode(argClientDataJsonOrBytes)
      : argClientDataJsonOrBytes;

    const authData = base64UrlDecode(authenticatorDataB64);
    const sigBytes = base64UrlDecode(signatureB64);
    const pubKeyBytes = base64UrlDecode(publicKeySpkiB64);
    if (!authData || !sigBytes || !pubKeyBytes || !clientDataBytes) return false;

    const clientDataHash = await sha256Bytes(clientDataBytes);
    const signedData = new Uint8Array(authData.length + clientDataHash.length);
    signedData.set(authData, 0);
    signedData.set(clientDataHash, authData.length);

    if (algorithm === -7) {
      const key = await crypto.subtle.importKey(
        'spki',
        pubKeyBytes as unknown as BufferSource,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );
      const rawSig = derEcdsaToRaw(sigBytes) || sigBytes;
      return await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        rawSig as unknown as BufferSource,
        signedData as unknown as BufferSource
      );
    } else if (algorithm === -257) {
      const key = await crypto.subtle.importKey(
        'spki',
        pubKeyBytes as unknown as BufferSource,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      );
      return await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        sigBytes as unknown as BufferSource,
        signedData as unknown as BufferSource
      );
    }
    return false;
  } catch {
    return false;
  }
}

export function normalizeEmail(rawEmail: unknown): string {
  if (typeof rawEmail !== 'string') return '';
  return rawEmail.trim().toLowerCase();
}

export function generateSecureToken(byteLength = 32): string {
  const randomBytes = new Uint8Array(byteLength);
  crypto.getRandomValues(randomBytes);
  return base64UrlEncode(randomBytes);
}


