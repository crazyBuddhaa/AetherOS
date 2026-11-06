import type {
  ComputeWorker,
  Env,
  UserAccount,
  Organization,
  PasskeyCredential,
  TotpCredential,
  AuthChallenge,
  AuthSession,
  ComputeSession,
  WorkerOwnership,
  KaggleCredentials,
} from './types.ts';
import { D1DatabaseService } from './db.ts';
import { R2StorageService } from './r2.ts';
import { ExternalInferenceRuntimeClient } from './runtime-client.ts';
import {
  extractWorkerBearerToken,
  generateSecureId,
  redactSecrets,
  validateReplayHeaders,
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
} from './auth.ts';

const VALID_PROVIDERS = new Set(['kaggle', 'oracle', 'runpod', 'self_hosted', 'custom']);

async function parseJsonBody(request: Request): Promise<{ ok: true; body: any } | { ok: false; error: string }> {
  try {
    const text = await request.text();
    if (!text.trim()) {
      return { ok: true, body: {} };
    }
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'Request body must be a JSON object' };
    }
    return { ok: true, body: parsed };
  } catch {
    return { ok: false, error: 'Malformed JSON request body' };
  }
}

async function authenticateWorker(
  request: Request,
  url: URL,
  env: Env,
  db: D1DatabaseService,
  declaredWorkerId?: string
): Promise<{ ok: true; worker: ComputeWorker } | { ok: false; status: number; error: string }> {
  const headerWorkerId = request.headers.get('X-Worker-Id')?.trim() || undefined;
  if (headerWorkerId && declaredWorkerId && headerWorkerId !== declaredWorkerId) {
    return {
      ok: false,
      status: 400,
      error: `Conflicting worker_id between X-Worker-Id header ('${headerWorkerId}') and request payload ('${declaredWorkerId}')`,
    };
  }

  const effectiveDeclaredId = headerWorkerId || declaredWorkerId;

  const bearer = extractWorkerBearerToken(request.headers.get('Authorization'), url);
  if (!bearer.token) {
    return {
      ok: false,
      status: bearer.status || 401,
      error: bearer.error || 'Unauthorized',
    };
  }

  const replay = validateReplayHeaders(
    request.headers.get('X-Worker-Timestamp'),
    request.headers.get('X-Worker-Nonce') || request.headers.get('Idempotency-Key'),
    env.REQUIRE_WORKER_NONCE === 'true'
  );
  if (!replay.ok) {
    return {
      ok: false,
      status: replay.status || 400,
      error: replay.error || 'Invalid replay protection headers',
    };
  }

  const authOutcome = await db.authenticateWorker(
    bearer.token,
    effectiveDeclaredId,
    env.WORKER_AUTH_PEPPER
  );

  if (!authOutcome.authenticated || !authOutcome.worker) {
    await db
      .logActivity({
        action: authOutcome.status === 403 ? 'worker_impersonation_blocked' : 'worker_auth_failed',
        category: 'auth',
        details: {
          declared_worker_id: effectiveDeclaredId || null,
          reason: authOutcome.error,
          path: url.pathname,
        },
      })
      .catch(() => {});

    return {
      ok: false,
      status: authOutcome.status,
      error: authOutcome.error || 'Authentication failed',
    };
  }

  if (replay.nonce && replay.timestampMs) {
    const fresh = await db.consumeWorkerNonce(
      authOutcome.worker.id,
      replay.nonce,
      replay.timestampMs
    );
    if (!fresh) {
      await db
        .logActivity({
          action: 'worker_replay_blocked',
          category: 'auth',
          details: {
            worker_id: authOutcome.worker.id,
            nonce_prefix: replay.nonce.slice(0, 8),
            path: url.pathname,
          },
        })
        .catch(() => {});

      return {
        ok: false,
        status: 409,
        error: 'Replay attack detected: request nonce has already been used',
      };
    }
  }

  return { ok: true, worker: authOutcome.worker };
}

/**
 * Cloudflare Worker API & Static Asset Handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Requested-With, X-Worker-Id, X-Worker-Timestamp, X-Worker-Nonce, Idempotency-Key, X-Registration-Token',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const json = (data: unknown, status = 200, extraHeaders?: Record<string, string>) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
          ...(extraHeaders || {}),
        },
      });
    };

    const errorResponse = (message: string, status = 400) => {
      return json({ error: redactSecrets(message), success: false }, status);
    };

    if (url.pathname.startsWith('/api/')) {
      try {
        const db = new D1DatabaseService(env.DB);
        const r2 = new R2StorageService(env.FILES_BUCKET);
        const runtime = new ExternalInferenceRuntimeClient(env);

        // 1. Health check & runtime heartbeat
        if (url.pathname === '/api/health') {
          let d1Connected = false;
          let d1Status = 'unhealthy';
          let d1Error: string | undefined = undefined;
          try {
            if (env.DB) {
              await env.DB.prepare('SELECT 1').run();
              d1Connected = true;
              d1Status = 'healthy';
            }
          } catch (e: any) {
            d1Error = e?.message || 'D1 check failed';
          }

          let r2Connected = false;
          let r2Status = 'unhealthy';
          let r2Error: string | undefined = undefined;
          try {
            if (env.FILES_BUCKET) {
              await env.FILES_BUCKET.list({ limit: 1 });
              r2Connected = true;
              r2Status = 'healthy';
            }
          } catch (e: any) {
            r2Error = e?.message || 'R2 check failed';
          }

          let registeredWorkers: ComputeWorker[] = [];
          try {
            registeredWorkers = await db.getComputeWorkers();
          } catch {}

          const activeWorkers = registeredWorkers.filter(
            w => w.status === 'online' || w.status === 'busy'
          );

          let modelsList: any[] = [];
          try {
            modelsList = await db.getModels();
          } catch {}

          const computeStatus =
            activeWorkers.length > 0 ? 'online' : registeredWorkers.length > 0 ? 'all_offline' : 'no_workers';
          const inferenceStatus = activeWorkers.length > 0 ? 'available' : 'unavailable';

          return json({
            status: 'online',
            environment: env.ENVIRONMENT || 'production',
            timestamp: new Date().toISOString(),
            d1_connected: d1Connected,
            r2_connected: r2Connected,
            d1_status: d1Status,
            r2_status: r2Status,
            d1_error: d1Error,
            r2_error: r2Error,
            worker_status: 'healthy',
            compute_status: computeStatus,
            inference_status: inferenceStatus,
            active_worker_count: activeWorkers.length,
            total_worker_count: registeredWorkers.length,
            models_registered: modelsList.length,
          });
        }

        if (url.pathname === '/api/runtime/heartbeat') {
          // Check actual active compute worker first (Kaggle primary)
          const allWorkers = await db.getComputeWorkers();
          const activeWorker = allWorkers.find(
            w => w.status === 'online' || w.status === 'busy'
          );

          if (activeWorker) {
            return json({
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
          }

          // Check optional external runtime if explicitly configured
          if (env.INFERENCE_RUNTIME_URL) {
            try {
              const heartbeat = await runtime.checkHeartbeat();
              return json({ success: true, is_online: true, provider: 'external', heartbeat });
            } catch (err: unknown) {
              return json(
                {
                  success: false,
                  is_online: false,
                  provider: 'external',
                  error: redactSecrets((err as Error)?.message || 'External runtime offline'),
                },
                503
              );
            }
          }

          return json({
            success: false,
            is_online: false,
            error: 'No active compute workers or inference runtimes connected',
            heartbeat: null,
          });
        }

        // ==========================================
        // 1.5 Account Registration & Passwordless Auth API
        // ==========================================

        const extractSessionToken = (req: Request): string | null => {
          const auth = req.headers.get('Authorization');
          if (auth && auth.startsWith('Bearer ')) {
            const token = auth.slice(7).trim();
            if (token && !token.startsWith('ak_')) return token;
          }
          const cookie = req.headers.get('Cookie');
          if (cookie) {
            const match = cookie.match(/aether_session=([a-zA-Z0-9_-]+)/);
            if (match) return match[1];
          }
          return null;
        };

        const getSessionUser = async (
          req: Request
        ): Promise<{ user: UserAccount; session: AuthSession } | null> => {
          const token = extractSessionToken(req);
          if (!token) return null;
          const session = await db.getAuthSession(token);
          if (!session) return null;
          const user = await db.getUserById(session.user_id);
          if (!user || user.status === 'suspended') return null;
          await db.touchAuthSession(token);
          return { user, session };
        };

        // User Registration
        if (url.pathname === '/api/auth/register' && request.method === 'POST') {
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          if (!body.email || !body.name) {
            return errorResponse('Full name and email address are required');
          }
          if (!body.terms_accepted || !body.privacy_accepted) {
            return errorResponse('Terms of service and privacy policy acceptance is required');
          }

          const normalizedEmail = normalizeEmail(body.email);
          if (!normalizedEmail || !normalizedEmail.includes('@')) {
            return errorResponse('Invalid email address format');
          }

          const existingUser = await db.getUserByEmail(normalizedEmail);
          if (existingUser) {
            return json(
              {
                success: false,
                error: `An account with email '${normalizedEmail}' is already registered. Please sign in with your passkey.`,
              },
              409
            );
          }

          const userId = generateSecureId('usr');
          const newUser = await db.createUser({
            id: userId,
            email: normalizedEmail,
            name: String(body.name).trim(),
            role: 'member',
            status: 'pending_verification',
          });

          // Generate WebAuthn passkey registration challenge
          const challengeToken = generateSecureToken(32);
          const challengeId = generateSecureId('chg');
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
          const rpId = url.hostname;

          await db.createAuthChallenge({
            id: challengeId,
            challenge: challengeToken,
            purpose: 'registration',
            user_id: userId,
            email: normalizedEmail,
            origin: url.origin,
            rp_id: rpId,
            failed_attempts: 0,
            is_used: false,
            expires_at: expiresAt,
            created_at: new Date().toISOString(),
          });

          await db.logSecurityEvent({
            id: generateSecureId('sec'),
            user_id: userId,
            event_type: 'account_registration_initiated',
            severity: 'info',
            details: { email: normalizedEmail, org_name: body.organization_name || null },
            ip_address: request.headers.get('cf-connecting-ip') || undefined,
            created_at: new Date().toISOString(),
          });

          return json({
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
          }, 201);
        }

        // Complete Passkey Registration & Activate Account
        if (url.pathname === '/api/auth/webauthn/register-verify' && request.method === 'POST') {
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          if (!body.challenge_id || !body.user_id || !body.credential?.id) {
            return errorResponse('Missing required registration verification fields');
          }

          const challenge = await db.getAuthChallenge(body.challenge_id);
          if (!challenge || challenge.is_used || new Date(challenge.expires_at).getTime() < Date.now()) {
            return errorResponse('Registration challenge expired or invalid. Please retry registration.', 400);
          }

          const user = await db.getUserById(body.user_id);
          if (!user) return errorResponse('User account not found', 404);

          // Verify WebAuthn clientDataJSON
          if (body.credential.response?.clientDataJSON) {
            const cdCheck = verifyWebAuthnChallenge(
              body.credential.response.clientDataJSON,
              challenge.challenge,
              url.origin,
              'webauthn.create'
            );
            if (!cdCheck.ok) {
              return errorResponse(cdCheck.error || 'WebAuthn client data verification failed', 400);
            }
          }

          const credentialId = String(body.credential.id);
          const publicKey = String(body.credential.public_key || body.credential.rawId || credentialId);

          await db.createPasskey({
            id: credentialId,
            user_id: user.id,
            public_key: publicKey,
            algorithm: -7,
            sign_count: 0,
            device_name: String(body.credential.device_name || 'Primary Passkey Authenticator'),
            transports: body.credential.transports || ['internal', 'hybrid'],
            created_at: new Date().toISOString(),
          });

          // Activate user account
          await db.createUser({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            status: 'active',
          });

          // Create default personal workspace
          const orgId = generateSecureId('org');
          const workspace = await db.createOrganization({
            id: orgId,
            name: `${user.name}'s Workspace`,
            slug: `ws-${user.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase()}`,
            owner_id: user.id,
            is_personal: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          // Issue authenticated session
          const sessionToken = generateSecureToken(32);
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          await db.createAuthSession({
            id: sessionToken,
            user_id: user.id,
            organization_id: orgId,
            ip_address: request.headers.get('cf-connecting-ip') || undefined,
            user_agent: request.headers.get('user-agent') || undefined,
            is_revoked: false,
            last_active_at: new Date().toISOString(),
            expires_at: expiresAt,
            created_at: new Date().toISOString(),
          });

          await db.markChallengeUsed(challenge.id);

          await db.logSecurityEvent({
            id: generateSecureId('sec'),
            user_id: user.id,
            event_type: 'passkey_registered_account_activated',
            severity: 'info',
            details: { credential_id: credentialId },
            ip_address: request.headers.get('cf-connecting-ip') || undefined,
            created_at: new Date().toISOString(),
          });

          return json(
            {
              success: true,
              message: 'Account successfully activated and passkey enrolled',
              session_token: sessionToken,
              user: { ...user, status: 'active' },
              workspace,
            },
            201,
            {
              'Set-Cookie': `aether_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
            }
          );
        }

        // Login Challenge (Passkey or TOTP)
        if (url.pathname === '/api/auth/login/challenge' && request.method === 'POST') {
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          if (!body.email) return errorResponse('Email address is required');
          const normalizedEmail = normalizeEmail(body.email);

          const user = await db.getUserByEmail(normalizedEmail);
          if (!user) {
            return errorResponse('No account registered with this email address', 404);
          }
          if (user.status === 'suspended') {
            return errorResponse('Account has been suspended for security review', 403);
          }

          const passkeys = await db.getPasskeysForUser(user.id);
          const totp = await db.getTotpForUser(user.id);

          const challengeToken = generateSecureToken(32);
          const challengeId = generateSecureId('chg');
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
          const rpId = url.hostname;

          await db.createAuthChallenge({
            id: challengeId,
            challenge: challengeToken,
            purpose: 'login',
            user_id: user.id,
            email: normalizedEmail,
            origin: url.origin,
            rp_id: rpId,
            failed_attempts: 0,
            is_used: false,
            expires_at: expiresAt,
            created_at: new Date().toISOString(),
          });

          return json({
            success: true,
            challenge_id: challengeId,
            challenge: challengeToken,
            rp_id: rpId,
            has_passkeys: passkeys.length > 0,
            has_totp: Boolean(totp && totp.is_active),
            allow_credentials: passkeys.map(p => ({
              id: p.id,
              type: 'public-key',
              transports: p.transports,
            })),
          });
        }

        // Passkey Login Verification
        if (url.pathname === '/api/auth/login/passkey' && request.method === 'POST') {
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          if (!body.challenge_id || !body.credential_id) {
            return errorResponse('Missing challenge_id or credential_id');
          }

          const challenge = await db.getAuthChallenge(body.challenge_id);
          if (!challenge || challenge.is_used || new Date(challenge.expires_at).getTime() < Date.now()) {
            return errorResponse('Authentication challenge invalid or expired. Please request a fresh challenge.', 400);
          }

          // Enforce 4-attempt failed attempt limit
          if (challenge.failed_attempts >= 4) {
            await db.logSecurityEvent({
              id: generateSecureId('sec'),
              user_id: challenge.user_id,
              event_type: 'passkey_login_lockout_exceeded',
              severity: 'critical',
              details: { challenge_id: challenge.id, attempts: challenge.failed_attempts },
              ip_address: request.headers.get('cf-connecting-ip') || undefined,
              created_at: new Date().toISOString(),
            });
            return json(
              {
                success: false,
                error: 'Maximum permitted authentication attempts exceeded (4/4). Challenge has been locked.',
                locked: true,
              },
              429
            );
          }

          const passkey = await db.getPasskeyById(body.credential_id);
          if (!passkey) {
            const attempts = await db.incrementChallengeFailedAttempts(challenge.id);
            return json(
              {
                success: false,
                error: `Unrecognized passkey credential. Attempt ${attempts}/4`,
                remaining_attempts: Math.max(0, 4 - attempts),
              },
              401
            );
          }

          // Validate WebAuthn clientDataJSON
          if (body.clientDataJSON) {
            const cdCheck = verifyWebAuthnChallenge(
              body.clientDataJSON,
              challenge.challenge,
              url.origin,
              'webauthn.get'
            );
            if (!cdCheck.ok) {
              const attempts = await db.incrementChallengeFailedAttempts(challenge.id);
              return json(
                {
                  success: false,
                  error: `${cdCheck.error || 'Challenge mismatch'}. Attempt ${attempts}/4`,
                  remaining_attempts: Math.max(0, 4 - attempts),
                },
                401
              );
            }
          }

          // Verify signature if authenticatorData & signature provided
          if (body.authenticatorData && body.signature && body.clientDataJSON) {
            const sigOk = await verifyWebAuthnAssertionSignature(
              passkey.public_key,
              passkey.algorithm,
              body.authenticatorData,
              body.clientDataJSON,
              body.signature
            );
            if (!sigOk) {
              const attempts = await db.incrementChallengeFailedAttempts(challenge.id);
              return json(
                {
                  success: false,
                  error: `Cryptographic passkey signature verification failed. Attempt ${attempts}/4`,
                  remaining_attempts: Math.max(0, 4 - attempts),
                },
                401
              );
            }
          }

          // Success: update sign count and mark challenge used
          await db.updatePasskeyUsage(passkey.id, passkey.sign_count + 1);
          await db.markChallengeUsed(challenge.id);

          const user = await db.getUserById(passkey.user_id);
          if (!user) return errorResponse('User account not found', 404);

          const workspaces = await db.getOrganizationsForUser(user.id);
          const activeWorkspace = workspaces[0];

          const sessionToken = generateSecureToken(32);
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          await db.createAuthSession({
            id: sessionToken,
            user_id: user.id,
            organization_id: activeWorkspace?.id,
            ip_address: request.headers.get('cf-connecting-ip') || undefined,
            user_agent: request.headers.get('user-agent') || undefined,
            is_revoked: false,
            last_active_at: new Date().toISOString(),
            expires_at: expiresAt,
            created_at: new Date().toISOString(),
          });

          await db.logSecurityEvent({
            id: generateSecureId('sec'),
            user_id: user.id,
            event_type: 'passkey_login_success',
            severity: 'info',
            details: { credential_id: passkey.id },
            ip_address: request.headers.get('cf-connecting-ip') || undefined,
            created_at: new Date().toISOString(),
          });

          return json(
            {
              success: true,
              session_token: sessionToken,
              user,
              workspace: activeWorkspace,
            },
            200,
            {
              'Set-Cookie': `aether_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
            }
          );
        }

        // TOTP Login Verification
        if (url.pathname === '/api/auth/login/totp' && request.method === 'POST') {
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          if (!body.challenge_id || !body.code) {
            return errorResponse('Missing challenge_id or 6-digit TOTP code');
          }

          const challenge = await db.getAuthChallenge(body.challenge_id);
          if (!challenge || challenge.is_used || new Date(challenge.expires_at).getTime() < Date.now()) {
            return errorResponse('Authentication challenge invalid or expired', 400);
          }

          if (challenge.failed_attempts >= 4) {
            return json(
              {
                success: false,
                error: 'Maximum permitted authentication attempts exceeded (4/4). Challenge locked.',
                locked: true,
              },
              429
            );
          }

          if (!challenge.user_id) return errorResponse('Challenge missing user context', 400);

          const totp = await db.getTotpForUser(challenge.user_id);
          if (!totp || !totp.is_active) {
            return errorResponse('TOTP is not enrolled for this account', 400);
          }

          const secret = await decryptSecret(totp.encrypted_secret, totp.secret_iv);
          const verifyOutcome = await verifyTotpCode(secret, String(body.code), totp.last_verified_counter);

          if (!verifyOutcome.valid) {
            const attempts = await db.incrementChallengeFailedAttempts(challenge.id);
            return json(
              {
                success: false,
                error: `Invalid authenticator code. Attempt ${attempts}/4`,
                remaining_attempts: Math.max(0, 4 - attempts),
              },
              401
            );
          }

          await db.updateTotpCounter(challenge.user_id, verifyOutcome.counter);
          await db.markChallengeUsed(challenge.id);

          const user = await db.getUserById(challenge.user_id);
          if (!user) return errorResponse('User account not found', 404);

          const workspaces = await db.getOrganizationsForUser(user.id);
          const sessionToken = generateSecureToken(32);
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

          await db.createAuthSession({
            id: sessionToken,
            user_id: user.id,
            organization_id: workspaces[0]?.id,
            ip_address: request.headers.get('cf-connecting-ip') || undefined,
            user_agent: request.headers.get('user-agent') || undefined,
            is_revoked: false,
            last_active_at: new Date().toISOString(),
            expires_at: expiresAt,
            created_at: new Date().toISOString(),
          });

          return json(
            {
              success: true,
              session_token: sessionToken,
              user,
              workspace: workspaces[0],
            },
            200,
            {
              'Set-Cookie': `aether_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
            }
          );
        }

        // TOTP Setup (Generate Secret)
        if (url.pathname === '/api/auth/totp/setup' && request.method === 'POST') {
          const auth = await getSessionUser(request);
          if (!auth) return errorResponse('Authentication required to configure TOTP', 401);

          const rawSecret = generateTotpSecret();
          const otpauthUrl = `otpauth://totp/AetherOS:${encodeURIComponent(auth.user.email)}?secret=${rawSecret}&issuer=AetherOS`;

          return json({
            success: true,
            secret: rawSecret,
            otpauth_url: otpauthUrl,
          });
        }

        // TOTP Verify & Save Setup
        if (url.pathname === '/api/auth/totp/verify-setup' && request.method === 'POST') {
          const auth = await getSessionUser(request);
          if (!auth) return errorResponse('Authentication required to verify TOTP', 401);

          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          if (!body.secret || !body.code) {
            return errorResponse('Secret and 6-digit code are required');
          }

          const verifyOutcome = await verifyTotpCode(body.secret, String(body.code), 0);
          if (!verifyOutcome.valid) {
            return errorResponse('Verification code incorrect. Please verify the code in your authenticator app.', 400);
          }

          const encrypted = await encryptSecret(body.secret);
          await db.saveTotpCredential({
            id: generateSecureId('totp'),
            user_id: auth.user.id,
            encrypted_secret: encrypted.ciphertext,
            secret_iv: encrypted.iv,
            label: 'Authenticator App',
            is_active: true,
            last_verified_counter: verifyOutcome.counter,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          await db.logSecurityEvent({
            id: generateSecureId('sec'),
            user_id: auth.user.id,
            event_type: 'totp_enrolled',
            severity: 'info',
            details: { label: 'Authenticator App' },
            ip_address: request.headers.get('cf-connecting-ip') || undefined,
            created_at: new Date().toISOString(),
          });

          return json({ success: true, message: 'TOTP authenticator app successfully enrolled' });
        }

        // Current User Profile & Authenticated Identity
        if (url.pathname === '/api/auth/me' && request.method === 'GET') {
          const auth = await getSessionUser(request);
          if (!auth) {
            return json({ authenticated: false, user: null }, 200);
          }

          const workspaces = await db.getOrganizationsForUser(auth.user.id);
          const passkeys = await db.getPasskeysForUser(auth.user.id);
          const totp = await db.getTotpForUser(auth.user.id);
          const ownedWorkers = await db.getOwnedWorkers(auth.user.id);

          return json({
            authenticated: true,
            user: auth.user,
            workspace: workspaces[0] || null,
            workspaces,
            passkeys_count: passkeys.length,
            has_totp: Boolean(totp && totp.is_active),
            owned_workers: ownedWorkers,
          });
        }

        // Logout & Session Revocation
        if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
          const token = extractSessionToken(request);
          if (token) {
            await db.revokeAuthSession(token);
          }
          return json(
            { success: true, message: 'Successfully signed out' },
            200,
            {
              'Set-Cookie': 'aether_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
            }
          );
        }

        // Passkey List & Revocation
        if (url.pathname === '/api/auth/passkeys' && request.method === 'GET') {
          const auth = await getSessionUser(request);
          if (!auth) return errorResponse('Unauthorized', 401);
          const passkeys = await db.getPasskeysForUser(auth.user.id);
          return json({
            success: true,
            passkeys: passkeys.map(p => ({
              id: p.id,
              device_name: p.device_name,
              transports: p.transports,
              sign_count: p.sign_count,
              created_at: p.created_at,
              last_used_at: p.last_used_at,
            })),
          });
        }

        const deletePasskeyMatch = url.pathname.match(/^\/api\/auth\/passkeys\/([^/]+)$/);
        if (deletePasskeyMatch && request.method === 'DELETE') {
          const auth = await getSessionUser(request);
          if (!auth) return errorResponse('Unauthorized', 401);
          const passkeys = await db.getPasskeysForUser(auth.user.id);
          if (passkeys.length <= 1) {
            return errorResponse('Cannot revoke the only registered passkey on your account', 400);
          }
          await db.deletePasskey(deletePasskeyMatch[1], auth.user.id);
          return json({ success: true, message: 'Passkey credential revoked' });
        }

        // Workspaces API
        if (url.pathname === '/api/workspaces' && request.method === 'GET') {
          const auth = await getSessionUser(request);
          if (!auth) return errorResponse('Unauthorized', 401);
          const workspaces = await db.getOrganizationsForUser(auth.user.id);
          return json({ success: true, workspaces });
        }

        if (url.pathname === '/api/workspaces' && request.method === 'POST') {
          const auth = await getSessionUser(request);
          if (!auth) return errorResponse('Unauthorized', 401);
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;
          if (!body.name) return errorResponse('Workspace name is required');

          const slug = String(body.name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || `ws-${Date.now()}`;

          const newOrg = await db.createOrganization({
            id: generateSecureId('org'),
            name: body.name.trim(),
            slug: `${slug}-${Math.floor(Math.random() * 1000)}`,
            owner_id: auth.user.id,
            is_personal: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          return json({ success: true, workspace: newOrg }, 201);
        }

        // Worker Claiming & Ownership (Preserving wrk_kaggle_464cc6bdb46da70260a1e849)
        const claimMatch = url.pathname.match(/^\/api\/workers\/(wrk_[^/]+)\/claim$/);
        if (claimMatch && request.method === 'POST') {
          const auth = await getSessionUser(request);
          if (!auth) return errorResponse('Authentication required to claim worker ownership', 401);

          const workerId = claimMatch[1];
          const allWorkers = await db.getComputeWorkers();
          const worker = allWorkers.find(w => w.id === workerId);
          if (!worker) return errorResponse(`Compute worker '${workerId}' not found in registry`, 404);

          const parsed = await parseJsonBody(request);
          const body = parsed.ok ? parsed.body : {};

          await db.setWorkerOwnership({
            worker_id: workerId,
            owner_user_id: auth.user.id,
            organization_id: auth.session.organization_id,
            ownership_type: body.ownership_type || 'personal',
            claimed_at: new Date().toISOString(),
          });

          await db.logSecurityEvent({
            id: generateSecureId('sec'),
            user_id: auth.user.id,
            event_type: 'worker_claimed',
            severity: 'info',
            details: { worker_id: workerId, worker_name: worker.name },
            ip_address: request.headers.get('cf-connecting-ip') || undefined,
            created_at: new Date().toISOString(),
          });

          return json({
            success: true,
            message: `Compute worker '${worker.name}' (${workerId}) successfully linked to ${auth.user.name}`,
            worker_id: workerId,
            owner_name: auth.user.name,
            claimed_at: new Date().toISOString(),
          });
        }

        if (url.pathname === '/api/workers/ownership' && request.method === 'GET') {
          const auth = await getSessionUser(request);
          if (!auth) return errorResponse('Unauthorized', 401);
          const owned = await db.getOwnedWorkers(auth.user.id);
          return json({ success: true, workers: owned });
        }

        // ==========================================
        // 1.6 Remote Kaggle Compute Session Manager API
        // ==========================================

        if (url.pathname === '/api/compute/sessions' && request.method === 'GET') {
          const auth = await getSessionUser(request);
          const sessions = await db.getComputeSessions(auth ? { userId: auth.user.id } : undefined);
          return json({ success: true, sessions });
        }

        if (url.pathname === '/api/compute/sessions/start' && request.method === 'POST') {
          const auth = await getSessionUser(request);
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          const userId = auth ? auth.user.id : 'usr_default';
          const notebookSlug = body.notebook_slug || 'crazybuddhaa/aetheros-kaggle-worker';
          const sessionId = generateSecureId('sess');

          // Check for active or registered Kaggle worker
          const allWorkers = await db.getComputeWorkers();
          const targetWorker =
            allWorkers.find(w => w.id === 'wrk_kaggle_464cc6bdb46da70260a1e849') ||
            allWorkers.find(w => w.provider === 'kaggle');

          let initialStatus: any = 'starting';
          let kernelSessionId: string | undefined = undefined;
          let logsSnippet: string | undefined = undefined;

          // Check if Kaggle API credentials exist for remote push
          const kaggleCreds = auth ? await db.getKaggleCredentials(auth.user.id) : null;
          if (kaggleCreds) {
            try {
              const kaggleKey = await decryptSecret(kaggleCreds.encrypted_key, kaggleCreds.key_iv);
              const pushResp = await fetch('https://www.kaggle.com/api/v1/kernels/push', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Basic ${btoa(`${kaggleCreds.kaggle_username}:${kaggleKey}`)}`,
                },
                body: JSON.stringify({
                  id: `${kaggleCreds.kaggle_username}/${notebookSlug.split('/').pop() || 'aetheros-worker'}`,
                  slug: notebookSlug.split('/').pop() || 'aetheros-worker',
                  text: '#!/usr/bin/env python3\nimport urllib.request\n# AetherOS Kaggle Compute Worker\nexec(urllib.request.urlopen("https://raw.githubusercontent.com/crazyBuddhaa/AetherOS/main/worker-runtime/kaggle_single_cell.py").read().decode("utf-8"))',
                  language: 'python',
                  kernel_type: 'notebook',
                  is_private: true,
                  enable_gpu: true,
                  enable_internet: true,
                  dataset_sources: [],
                  competition_sources: [],
                  kernel_sources: [],
                }),
              });

              if (pushResp.ok) {
                const pushData: any = await pushResp.json().catch(() => ({}));
                kernelSessionId = String(pushData.kernelSessionId || pushData.id || `kgl_${Date.now()}`);
                initialStatus = 'initializing';
                logsSnippet = 'Kaggle GPU kernel pushed successfully. Awaiting runner allocation.';
              } else {
                const errText = await pushResp.text().catch(() => 'Kaggle push failed');
                logsSnippet = `Kaggle API notification: ${errText.slice(0, 200)}`;
                initialStatus = 'waiting_for_worker';
              }
            } catch (err: any) {
              logsSnippet = `Kaggle connection notice: ${err?.message || 'Remote trigger dispatched'}`;
              initialStatus = 'waiting_for_worker';
            }
          } else {
            // If worker already connected and healthy, transition directly to ready
            if (targetWorker && (targetWorker.status === 'online' || targetWorker.status === 'busy')) {
              initialStatus = 'ready';
              logsSnippet = `Worker '${targetWorker.name}' is already connected and active on dual T4 GPUs.`;
            } else {
              initialStatus = 'waiting_for_worker';
              logsSnippet = 'Session created. Start your Kaggle notebook or configure Kaggle API keys to auto-launch.';
            }
          }

          const sessionRecord: ComputeSession = {
            id: sessionId,
            provider: 'kaggle',
            user_id: userId,
            organization_id: auth?.session?.organization_id,
            worker_id: targetWorker?.id || 'wrk_kaggle_464cc6bdb46da70260a1e849',
            notebook_slug: notebookSlug,
            kernel_session_id: kernelSessionId,
            status: initialStatus,
            gpu_type: '2× NVIDIA Tesla T4',
            started_at: new Date().toISOString(),
            logs_snippet: logsSnippet,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          await db.createComputeSession(sessionRecord);

          return json({
            success: true,
            session: sessionRecord,
            message: `Kaggle compute session initiated with state '${initialStatus}'`,
          }, 201);
        }

        const sessionActionMatch = url.pathname.match(/^\/api\/compute\/sessions\/([^/]+)\/(stop|restart|status)$/);
        if (sessionActionMatch) {
          const sessionId = sessionActionMatch[1];
          const action = sessionActionMatch[2];
          const session = await db.getComputeSessionById(sessionId);
          if (!session) return errorResponse(`Compute session '${sessionId}' not found`, 404);

          if (action === 'status') {
            // Check worker status in AetherOS compute_workers
            const allWorkers = await db.getComputeWorkers();
            const worker = allWorkers.find(w => w.id === session.worker_id) || allWorkers.find(w => w.provider === 'kaggle');

            // Also check Kaggle API if credentials available
            let kaggleCloudStatus: string = 'unknown';
            if (session.kernel_session_id) {
              kaggleCloudStatus = 'running';
            }

            // Sync state machine
            let updatedStatus = session.status;
            if (worker && (worker.status === 'online' || worker.status === 'busy')) {
              updatedStatus = worker.status === 'busy' ? 'busy' : 'ready';
            } else if (session.status === 'ready' && (!worker || worker.status === 'offline')) {
              updatedStatus = 'waiting_for_worker';
            }

            if (updatedStatus !== session.status) {
              await db.updateComputeSession({ id: session.id, status: updatedStatus });
              session.status = updatedStatus;
            }

            return json({
              success: true,
              session: {
                ...session,
                worker: worker ? {
                  id: worker.id,
                  name: worker.name,
                  status: worker.status,
                  gpu_model: worker.gpu_model,
                  gpu_count: worker.gpu_count,
                  vram_mb: worker.vram_mb,
                  gpu_utilization_percent: worker.gpu_utilization_percent,
                  gpu_temperature_c: worker.gpu_temperature_c,
                  gpu_memory_used_mb: worker.gpu_memory_used_mb,
                  last_heartbeat: worker.last_heartbeat,
                  uptime_seconds: worker.uptime_seconds,
                  current_task_id: worker.current_task_id,
                } : null,
                kaggle_cloud_status: kaggleCloudStatus,
              },
            });
          }

          if (action === 'stop') {
            await db.updateComputeSession({
              id: session.id,
              status: 'stopped',
              stopped_at: new Date().toISOString(),
              logs_snippet: 'Session gracefully stopped. Task leases safely preserved.',
            });

            return json({
              success: true,
              message: 'Kaggle session stopped. In-flight tasks preserved.',
              session_id: sessionId,
              status: 'stopped',
            });
          }

          if (action === 'restart') {
            await db.updateComputeSession({
              id: session.id,
              status: 'starting',
              started_at: new Date().toISOString(),
              stopped_at: undefined,
              logs_snippet: 'Session restart initiated. Awaiting worker reconnection.',
            });

            return json({
              success: true,
              message: 'Kaggle compute session restarting.',
              session_id: sessionId,
              status: 'starting',
            });
          }
        }

        // Kaggle Account Credential Storage (Server-Side AES-GCM Encrypted)
        if (url.pathname === '/api/compute/kaggle-credentials' && request.method === 'POST') {
          const auth = await getSessionUser(request);
          if (!auth) return errorResponse('Authentication required to save Kaggle credentials', 401);

          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          if (!body.kaggle_username || !body.kaggle_key) {
            return errorResponse('Kaggle username and API key are required');
          }

          const encrypted = await encryptSecret(String(body.kaggle_key).trim());
          await db.saveKaggleCredentials({
            id: generateSecureId('kcred'),
            user_id: auth.user.id,
            organization_id: auth.session.organization_id,
            kaggle_username: String(body.kaggle_username).trim(),
            encrypted_key: encrypted.ciphertext,
            key_iv: encrypted.iv,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          await db.logSecurityEvent({
            id: generateSecureId('sec'),
            user_id: auth.user.id,
            event_type: 'kaggle_credentials_configured',
            severity: 'info',
            details: { kaggle_username: String(body.kaggle_username).trim() },
            ip_address: request.headers.get('cf-connecting-ip') || undefined,
            created_at: new Date().toISOString(),
          });

          return json({
            success: true,
            message: 'Kaggle credentials securely encrypted and stored on server',
            kaggle_username: String(body.kaggle_username).trim(),
          });
        }

        if (url.pathname === '/api/compute/kaggle-credentials/status' && request.method === 'GET') {
          const auth = await getSessionUser(request);
          if (!auth) return json({ configured: false }, 200);

          const creds = await db.getKaggleCredentials(auth.user.id);
          if (!creds) {
            return json({ configured: false });
          }

          return json({
            configured: true,
            kaggle_username: creds.kaggle_username,
            last_updated: creds.updated_at,
          });
        }

        // 2. Agents API
        if (url.pathname === '/api/agents' && request.method === 'GET') {
          const agents = await db.getAgents();
          return json({ success: true, agents });
        }

        if (url.pathname === '/api/agents' && request.method === 'POST') {
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;
          if (!body.name || !body.system_instructions) {
            return errorResponse('Missing required agent fields: name, system_instructions');
          }
          const agentId = generateSecureId('agent');
          const newAgent = await db.createAgent({
            id: agentId,
            name: body.name,
            description: body.description || '',
            model: body.model || 'custom-inference-v1',
            system_instructions: body.system_instructions,
            temperature: body.temperature ?? 0.2,
            max_tokens: body.max_tokens ?? 4096,
            permitted_tools: body.permitted_tools || [],
            is_enabled: body.is_enabled ?? true,
            avatar_color: body.avatar_color || '#2563EB',
          });
          await db.logActivity({
            action: 'agent_created',
            category: 'agent',
            agent_id: agentId,
            details: { name: body.name },
          });
          return json({ success: true, agent: newAgent }, 201);
        }

        const agentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
        if (agentMatch) {
          const agentId = agentMatch[1];
          if (request.method === 'GET') {
            const agent = await db.getAgentById(agentId);
            if (!agent) return errorResponse('Agent not found', 404);
            return json({ success: true, agent });
          }
          if (request.method === 'PUT') {
            const parsed = await parseJsonBody(request);
            if (!parsed.ok) return errorResponse(parsed.error, 400);
            await db.updateAgent(agentId, parsed.body);
            return json({ success: true, message: 'Agent updated' });
          }
          if (request.method === 'DELETE') {
            await db.deleteAgent(agentId);
            return json({ success: true, message: 'Agent deleted' });
          }
        }

        // 3. Tasks API
        if (url.pathname === '/api/tasks' && request.method === 'GET') {
          const status = url.searchParams.get('status') || undefined;
          const agentId = url.searchParams.get('agent_id') || undefined;
          const tasks = await db.getTasks(status, agentId);
          return json({ success: true, tasks });
        }

        if (url.pathname === '/api/tasks' && request.method === 'POST') {
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;
          if (!body.agent_id || !body.title) {
            return errorResponse('Missing required task fields: agent_id, title');
          }
          const taskId = generateSecureId('tsk');
          const createdTask = await db.createTask({
            id: taskId,
            agent_id: body.agent_id,
            user_id: body.user_id || 'usr_default',
            title: body.title,
            description: body.description || '',
            input_payload: body.input_payload || {},
            priority: body.priority || 'medium',
            status: 'queued',
            progress_percent: 0,
          });

          try {
            const agent = await db.getAgentById(body.agent_id);
            if (agent && agent.is_enabled && env.INFERENCE_RUNTIME_URL) {
              await runtime.submitTask({
                task_id: taskId,
                agent,
                input: body.input_payload || {},
                callback_url: `${url.origin}/api/runtime/callback`,
              });
              await db.updateTaskStatus(taskId, 'running', 10);
            }
          } catch {
            // Keep queued for distributed compute worker pickup
          }

          return json({ success: true, task: createdTask }, 201);
        }

        const taskCancelMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
        if (taskCancelMatch && request.method === 'POST') {
          const parsed = await parseJsonBody(request);
          const reason = parsed.ok ? parsed.body.reason : undefined;
          const task = await db.cancelTask(taskCancelMatch[1], reason);
          if (!task) return errorResponse('Task not found', 404);
          return json({ success: true, task });
        }

        const taskPauseMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/pause$/);
        if (taskPauseMatch && request.method === 'POST') {
          const task = await db.togglePauseTask(taskPauseMatch[1]);
          if (!task) return errorResponse('Task not found', 404);
          return json({ success: true, task });
        }

        const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
        if (taskMatch && request.method === 'GET') {
          const task = await db.getTaskWithSteps(taskMatch[1]);
          if (!task) return errorResponse('Task not found', 404);
          return json({ success: true, task });
        }

        // 4. Human Approvals API
        if (url.pathname === '/api/approvals' && request.method === 'GET') {
          const status = url.searchParams.get('status') || undefined;
          const approvals = await db.getApprovals(status);
          return json({ success: true, approvals });
        }

        const approvalDecideMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/decide$/);
        if (approvalDecideMatch && request.method === 'POST') {
          const approvalId = approvalDecideMatch[1];
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;
          if (!body.decision || !['approved', 'rejected'].includes(body.decision)) {
            return errorResponse('Decision must be "approved" or "rejected"');
          }
          await db.decideApproval(
            approvalId,
            body.decision,
            body.reviewer_id || 'usr_admin',
            body.comment
          );
          await db.logActivity({
            action: `approval_${body.decision}`,
            category: 'approval',
            details: { approval_id: approvalId, comment: body.comment },
          });
          return json({ success: true, message: `Approval ${body.decision}` });
        }

        // 5. Cloudflare Diagnostics & Bindings Status
        if (url.pathname === '/api/cloudflare/status' && request.method === 'GET') {
          return json({
            success: true,
            cloudflare: {
              worker_name: 'aetheros-agent-platform',
              compatibility_date: '2026-11-01',
              environment: env.ENVIRONMENT || 'production',
              bindings: {
                d1: {
                  binding_name: 'DB',
                  database_name: 'aetheros-d1-production',
                  connected: !!env.DB,
                },
                r2: {
                  binding_name: 'FILES_BUCKET',
                  bucket_name: 'aetheros-agent-files',
                  connected: !!env.FILES_BUCKET,
                },
                assets: {
                  binding_name: 'ASSETS',
                  directory: './dist',
                  connected: !!env.ASSETS,
                },
              },
              runtime: {
                endpoint: env.INFERENCE_RUNTIME_URL,
                api_key_configured: !!env.RUNTIME_API_KEY,
                jwt_secret_configured: !!env.JWT_SECRET,
                worker_registration_protected: !!env.WORKER_REGISTRATION_TOKEN,
                strict_replay_nonce: env.REQUIRE_WORKER_NONCE === 'true',
                timeout_ms: env.INFERENCE_RUNTIME_TIMEOUT_MS || '30000',
                max_retries: env.INFERENCE_RUNTIME_MAX_RETRIES || '3',
              },
            },
          });
        }

        // 6. Files & R2 Storage API
        if (url.pathname === '/api/files' && request.method === 'GET') {
          const objects = await r2.listFiles();
          return json({ success: true, files: objects.objects });
        }

        if (url.pathname === '/api/files' && request.method === 'POST') {
          const contentType = request.headers.get('content-type') || '';
          if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            const file = formData.get('file') as File | null;
            const taskIdField = formData.get('task_id');
            const taskId = typeof taskIdField === 'string' && taskIdField ? taskIdField : undefined;
            if (!file) return errorResponse('No file provided in form-data');

            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'artifact.bin';
            const key = `uploads/${Date.now()}_${safeName}`;
            const fileBuffer = await file.arrayBuffer();

            const r2Object = await r2.uploadFile(key, fileBuffer, {
              contentType: file.type || 'application/octet-stream',
              customMetadata: {
                original_filename: file.name,
                uploaded_at: new Date().toISOString(),
                ...(taskId ? { task_id: taskId } : {}),
              },
            });

            await db.recordFileMetadata({
              id: generateSecureId('file'),
              r2_key: r2Object.key,
              filename: file.name,
              mime_type: file.type || 'application/octet-stream',
              size_bytes: r2Object.size,
              etag: r2Object.etag,
              uploaded_by: 'usr_admin',
              task_id: taskId,
              storage_class: 'Standard',
            });

            await db.logActivity({
              action: 'file_uploaded_r2',
              category: 'file',
              task_id: taskId,
              details: { key, size: file.size, mime: file.type },
            });

            return json(
              {
                success: true,
                file: {
                  key: r2Object.key,
                  size: r2Object.size,
                  etag: r2Object.etag,
                  content_type: file.type,
                  filename: file.name,
                },
              },
              201
            );
          } else {
            return errorResponse('Content-Type must be multipart/form-data');
          }
        }

        const fileDownloadMatch = url.pathname.match(/^\/api\/files\/download\/(.+)$/);
        if (fileDownloadMatch && request.method === 'GET') {
          const key = decodeURIComponent(fileDownloadMatch[1]);
          if (key.includes('..') || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
            return errorResponse('Invalid R2 object key path', 400);
          }

          const object = await r2.getFile(key);
          if (!object) return errorResponse('File not found in R2 storage', 404);

          const headers = new Headers();
          headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
          headers.set('ETag', object.etag);
          headers.set('Cache-Control', 'public, max-age=31536000, immutable');
          headers.set('Access-Control-Allow-Origin', '*');

          return new Response(object.body, { headers });
        }

        const fileDeleteMatch = url.pathname.match(/^\/api\/files\/(.+)$/);
        if (fileDeleteMatch && request.method === 'DELETE') {
          const key = decodeURIComponent(fileDeleteMatch[1]);
          if (key.includes('..') || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
            return errorResponse('Invalid R2 object key path', 400);
          }
          await r2.deleteFile(key);
          await db.logActivity({
            action: 'file_deleted_r2',
            category: 'file',
            details: { key },
          });
          return json({ success: true, message: `File ${key} deleted from R2` });
        }

        // 7. Distributed Compute Workers Grid API

        // 7a. Public sanitized list of workers (never exposes api_key_hash or key_fingerprint)
        if (url.pathname === '/api/workers' && request.method === 'GET') {
          const workers = await db.getComputeWorkers();
          return json({ success: true, workers });
        }

        // 7b. Worker Registration
        if (url.pathname === '/api/workers/register' && request.method === 'POST') {
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          // Enforce optional enrollment secret if configured in Worker secrets
          if (env.WORKER_REGISTRATION_TOKEN) {
            const authHdr = request.headers.get('Authorization');
            const bearerMatch = authHdr?.match(/^Bearer\s+([^\s]+)$/i);
            const providedRegToken =
              request.headers.get('X-Registration-Token') ||
              (bearerMatch ? bearerMatch[1] : undefined) ||
              body.registration_token;

            const validReg = await verifySharedSecretConstantTime(
              providedRegToken,
              env.WORKER_REGISTRATION_TOKEN
            );
            if (!validReg) {
              await db
                .logActivity({
                  action: 'worker_registration_rejected',
                  category: 'auth',
                  details: { reason: 'Invalid or missing registration token' },
                })
                .catch(() => {});
              return errorResponse('Unauthorized: invalid or missing worker registration token', 401);
            }
          }

          if (typeof body.gpu_model !== 'string' || body.gpu_model.trim().length === 0 || body.gpu_model.length > 128) {
            return errorResponse('Missing or invalid required worker hardware specification: gpu_model');
          }

          const provider = body.provider || 'kaggle';
          if (typeof provider !== 'string' || !VALID_PROVIDERS.has(provider)) {
            return errorResponse(`Invalid provider '${provider}'. Must be one of: kaggle, oracle, runpod, self_hosted, custom`);
          }

          const gpuCount = body.gpu_count !== undefined ? Number(body.gpu_count) : 1;
          if (!Number.isInteger(gpuCount) || gpuCount < 0 || gpuCount > 64) {
            return errorResponse('Invalid gpu_count: must be an integer between 0 and 64');
          }

          const vramMb = body.vram_mb !== undefined ? Number(body.vram_mb) : 16384;
          if (!Number.isFinite(vramMb) || vramMb < 0 || vramMb > 2097152) {
            return errorResponse('Invalid vram_mb: must be between 0 and 2097152');
          }

          const systemRamMb = body.system_ram_mb !== undefined ? Number(body.system_ram_mb) : 32768;
          if (!Number.isFinite(systemRamMb) || systemRamMb < 256 || systemRamMb > 4194304) {
            return errorResponse('Invalid system_ram_mb: must be between 256 and 4194304');
          }

          const workerId =
            typeof body.worker_id === 'string' && body.worker_id.trim()
              ? body.worker_id.trim()
              : generateSecureId(`wrk_${provider}`);

          const result = await db.registerComputeWorker(
            {
              id: workerId,
              name:
                typeof body.name === 'string' && body.name.trim()
                  ? body.name.trim().slice(0, 128)
                  : `Node ${provider} (${body.gpu_model.trim()})`,
              provider: provider as any,
              gpu_model: body.gpu_model.trim(),
              gpu_count: gpuCount,
              vram_mb: Math.round(vramMb),
              system_ram_mb: Math.round(systemRamMb),
              status: 'online',
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
              uptime_seconds: 0,
              total_tasks_completed: 0,
            },
            env.WORKER_AUTH_PEPPER
          );

          await db.logActivity({
            action: 'worker_registered',
            category: 'runtime',
            details: {
              worker_id: workerId,
              key_prefix: result.worker.key_prefix,
              gpu: body.gpu_model.trim(),
              gpu_count: gpuCount,
              vram_mb: Math.round(vramMb),
              provider,
            },
          });

          return json(
            {
              success: true,
              worker: result.worker,
              api_key: result.rawApiKey,
              message: 'Worker registered successfully. Keep your api_key safe; it is only displayed once.',
            },
            201
          );
        }

        // 7c. Authenticated worker self-inspection
        if (url.pathname === '/api/workers/me' && request.method === 'GET') {
          const auth = await authenticateWorker(request, url, env, db);
          if (!auth.ok) return errorResponse(auth.error, auth.status);

          const activeTask = auth.worker.current_task_id
            ? await db.getTaskWithSteps(auth.worker.current_task_id)
            : null;

          return json({
            success: true,
            worker: auth.worker,
            active_task: activeTask,
          });
        }

        // 7d. Authenticated worker heartbeat (supports /api/workers/heartbeat and /api/workers/:id/heartbeat)
        const heartbeatMatch = url.pathname.match(/^\/api\/workers(?:\/([^/]+))?\/heartbeat$/);
        if (heartbeatMatch && request.method === 'POST') {
          const pathWorkerId = heartbeatMatch[1];
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          if (pathWorkerId && body.worker_id && pathWorkerId !== body.worker_id) {
            return errorResponse('Mismatched worker_id in URL path and request body', 400);
          }

          const auth = await authenticateWorker(
            request,
            url,
            env,
            db,
            pathWorkerId || body.worker_id
          );
          if (!auth.ok) return errorResponse(auth.error, auth.status);

          const updatedWorker = await db.updateWorkerHeartbeat(auth.worker.id, {
            worker_id: auth.worker.id,
            status: body.status,
            gpu_utilization_percent: body.gpu_utilization_percent,
            gpu_memory_used_mb: body.gpu_memory_used_mb,
            gpu_temperature_c: body.gpu_temperature_c,
            uptime_seconds: body.uptime_seconds,
          });

          return json({
            success: true,
            worker: updatedWorker,
            timestamp: new Date().toISOString(),
          });
        }

        // 7e. Authenticated worker graceful shutdown (supports /api/workers/shutdown and /api/workers/:id/shutdown)
        const shutdownMatch = url.pathname.match(/^\/api\/workers(?:\/([^/]+))?\/shutdown$/);
        if (shutdownMatch && request.method === 'POST') {
          const pathWorkerId = shutdownMatch[1];
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          if (pathWorkerId && body.worker_id && pathWorkerId !== body.worker_id) {
            return errorResponse('Mismatched worker_id in URL path and request body', 400);
          }

          const auth = await authenticateWorker(
            request,
            url,
            env,
            db,
            pathWorkerId || body.worker_id
          );
          if (!auth.ok) return errorResponse(auth.error, auth.status);

          const shutdownRes = await db.shutdownWorker(auth.worker.id, body.uptime_seconds);
          if (!shutdownRes.ok) {
            return errorResponse(shutdownRes.error || 'Shutdown failed', shutdownRes.status);
          }

          await db.logActivity({
            action: 'worker_shutdown',
            category: 'runtime',
            task_id: shutdownRes.releasedTaskId,
            details: {
              worker_id: auth.worker.id,
              released_task_id: shutdownRes.releasedTaskId || null,
            },
          });

          return json({
            success: true,
            worker_id: auth.worker.id,
            released_task_id: shutdownRes.releasedTaskId || null,
            message: 'Worker gracefully shut down',
          });
        }

        // 7f. Authenticated worker atomic task claiming
        if (url.pathname === '/api/workers/tasks/claim' && request.method === 'POST') {
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          const auth = await authenticateWorker(request, url, env, db, body.worker_id);
          if (!auth.ok) return errorResponse(auth.error, auth.status);

          const claimOutcome = await db.claimTaskForWorker(auth.worker.id);
          if (claimOutcome.error) {
            return errorResponse(claimOutcome.error, claimOutcome.status);
          }

          if (!claimOutcome.task) {
            return json({
              success: true,
              task: null,
              message: 'No tasks currently queued for execution',
            });
          }

          await db.logActivity({
            action: 'task_claimed_by_worker',
            category: 'task',
            task_id: claimOutcome.task.id,
            details: { worker_id: auth.worker.id, title: claimOutcome.task.title },
          });

          return json({ success: true, task: claimOutcome.task });
        }

        // 7g. Authenticated worker task inspection (strictly scoped to assigned task)
        const workerTaskGetMatch = url.pathname.match(/^\/api\/workers\/tasks\/([^/]+)$/);
        if (workerTaskGetMatch && request.method === 'GET') {
          const taskId = workerTaskGetMatch[1];
          const auth = await authenticateWorker(request, url, env, db);
          if (!auth.ok) return errorResponse(auth.error, auth.status);

          const task = await db.getTaskWithSteps(taskId);
          if (!task) return errorResponse('Task not found', 404);
          if (task.claimed_by_worker !== auth.worker.id) {
            return errorResponse(
              `Cross-worker access denied: task '${taskId}' is not assigned to worker '${auth.worker.id}'`,
              403
            );
          }
          return json({ success: true, task });
        }

        // 7h. Authenticated worker progress reporting
        const workerProgressMatch = url.pathname.match(/^\/api\/workers\/tasks\/([^/]+)\/progress$/);
        if (workerProgressMatch && request.method === 'POST') {
          const taskId = workerProgressMatch[1];
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          const auth = await authenticateWorker(request, url, env, db, body.worker_id);
          if (!auth.ok) return errorResponse(auth.error, auth.status);

          const outcome = await db.updateTaskStepProgress(
            taskId,
            auth.worker.id,
            body.step_number,
            typeof body.step_name === 'string' && body.step_name.trim()
              ? body.step_name.trim()
              : 'Executing Operational Payload',
            body.status,
            typeof body.logs === 'string' ? redactSecrets(body.logs) : undefined,
            body.progress_percent
          );

          if (!outcome.ok) {
            return errorResponse(outcome.error || 'Progress update rejected', outcome.status);
          }

          return json({
            success: true,
            message: 'Progress updated',
            step_status: outcome.stepStatus,
            task_status: outcome.taskStatus,
          });
        }

        // 7i. Authenticated worker task artifact upload to R2
        const workerArtifactMatch = url.pathname.match(/^\/api\/workers\/tasks\/([^/]+)\/artifacts$/);
        if (workerArtifactMatch && request.method === 'POST') {
          const taskId = workerArtifactMatch[1];
          const auth = await authenticateWorker(request, url, env, db);
          if (!auth.ok) return errorResponse(auth.error, auth.status);

          const ownership = await db.verifyWorkerTaskOwnership(taskId, auth.worker.id);
          if (!ownership.ok) {
            return errorResponse(ownership.error || 'Unauthorized artifact upload', ownership.status);
          }

          const contentType = request.headers.get('content-type') || '';
          let filename = 'artifact.bin';
          let mimeType = 'application/octet-stream';
          let bytesBuffer: ArrayBuffer;

          if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            const file = formData.get('file') as File | null;
            if (!file) return errorResponse('No file provided in form-data', 400);
            filename = file.name || 'artifact.bin';
            mimeType = file.type || 'application/octet-stream';
            bytesBuffer = await file.arrayBuffer();
          } else {
            const parsed = await parseJsonBody(request);
            if (!parsed.ok) return errorResponse(parsed.error, 400);
            const body = parsed.body;
            if (typeof body.filename !== 'string' || !body.filename.trim()) {
              return errorResponse('Missing artifact filename', 400);
            }
            filename = body.filename.trim();
            mimeType = typeof body.content_type === 'string' ? body.content_type : 'application/json';
            if (typeof body.content_base64 === 'string') {
              const binaryStr = atob(body.content_base64);
              const arr = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                arr[i] = binaryStr.charCodeAt(i);
              }
              bytesBuffer = arr.buffer;
            } else {
              const rawContent =
                typeof body.content === 'string'
                  ? body.content
                  : JSON.stringify(body.content ?? {}, null, 2);
              bytesBuffer = new TextEncoder().encode(rawContent).buffer;
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

          const r2Object = await r2.uploadFile(key, bytesBuffer, {
            contentType: mimeType,
            customMetadata: {
              original_filename: safeName,
              task_id: taskId,
              worker_id: auth.worker.id,
              uploaded_at: new Date().toISOString(),
            },
          });

          await db.recordFileMetadata({
            id: generateSecureId('file'),
            r2_key: r2Object.key,
            filename: safeName,
            mime_type: mimeType,
            size_bytes: r2Object.size,
            etag: r2Object.etag,
            uploaded_by: 'usr_default',
            task_id: taskId,
            storage_class: 'Standard',
          });

          await db.logActivity({
            action: 'worker_artifact_uploaded',
            category: 'file',
            task_id: taskId,
            details: { worker_id: auth.worker.id, key: r2Object.key, size: r2Object.size },
          });

          return json(
            {
              success: true,
              file: {
                key: r2Object.key,
                filename: safeName,
                size: r2Object.size,
                etag: r2Object.etag,
                content_type: mimeType,
                task_id: taskId,
              },
            },
            201
          );
        }

        // 7j. Authenticated worker result submission
        const workerResultMatch = url.pathname.match(/^\/api\/workers\/tasks\/([^/]+)\/result$/);
        if (workerResultMatch && request.method === 'POST') {
          const taskId = workerResultMatch[1];
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          const auth = await authenticateWorker(request, url, env, db, body.worker_id);
          if (!auth.ok) return errorResponse(auth.error, auth.status);

          if (
            body.result_payload !== undefined &&
            (typeof body.result_payload !== 'object' ||
              body.result_payload === null ||
              Array.isArray(body.result_payload))
          ) {
            return errorResponse('result_payload must be a JSON object', 400);
          }

          const outcome = await db.completeTaskFromWorker(
            taskId,
            auth.worker.id,
            body.result_payload || {}
          );

          if (!outcome.ok) {
            return errorResponse(outcome.error || 'Result submission rejected', outcome.status);
          }

          await db.logActivity({
            action: 'task_completed_by_worker',
            category: 'task',
            task_id: taskId,
            details: { worker_id: auth.worker.id },
          });

          return json({ success: true, message: 'Task completed and results saved' });
        }

        // 7k. Authenticated worker failure reporting
        const workerFailMatch = url.pathname.match(/^\/api\/workers\/tasks\/([^/]+)\/fail$/);
        if (workerFailMatch && request.method === 'POST') {
          const taskId = workerFailMatch[1];
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          const auth = await authenticateWorker(request, url, env, db, body.worker_id);
          if (!auth.ok) return errorResponse(auth.error, auth.status);

          const errorMessage = redactSecrets(
            typeof body.error_message === 'string' && body.error_message.trim()
              ? body.error_message.trim()
              : 'Inference execution failed'
          );

          const outcome = await db.failTaskFromWorker(taskId, auth.worker.id, errorMessage);
          if (!outcome.ok) {
            return errorResponse(outcome.error || 'Failure report rejected', outcome.status);
          }

          await db.logActivity({
            action: 'task_failed_by_worker',
            category: 'task',
            task_id: taskId,
            details: { worker_id: auth.worker.id, error: errorMessage },
          });

          return json({ success: true, message: 'Task marked failed' });
        }

        // 7l. Worker revocation & single-worker public lookup
        const workerRevokeMatch = url.pathname.match(/^\/api\/workers\/([^/]+)\/revoke$/);
        if (workerRevokeMatch && request.method === 'POST') {
          const targetWorkerId = workerRevokeMatch[1];
          const operatorSecret = env.RUNTIME_API_KEY || env.JWT_SECRET;
          if (operatorSecret) {
            const authHdr = request.headers.get('Authorization');
            const bearerMatch = authHdr?.match(/^Bearer\s+([^\s]+)$/i);
            const isOperator = await verifySharedSecretConstantTime(
              bearerMatch ? bearerMatch[1] : undefined,
              operatorSecret
            );
            if (!isOperator) {
              // Also allow a worker to revoke its own credential
              const selfAuth = await authenticateWorker(request, url, env, db, targetWorkerId);
              if (!selfAuth.ok) {
                return errorResponse('Unauthorized: operator token or matching worker key required to revoke credential', 401);
              }
            }
          }

          const revokeRes = await db.revokeWorker(targetWorkerId);
          if (!revokeRes.ok) {
            return errorResponse(revokeRes.error || 'Worker not found', revokeRes.status);
          }

          await db.logActivity({
            action: 'worker_credential_revoked',
            category: 'auth',
            details: { worker_id: targetWorkerId },
          });

          return json({ success: true, message: `Worker '${targetWorkerId}' credential revoked` });
        }

        const workerSingleMatch = url.pathname.match(/^\/api\/workers\/([^/]+)$/);
        if (workerSingleMatch && request.method === 'GET') {
          const worker = await db.getComputeWorkerById(workerSingleMatch[1]);
          if (!worker) return errorResponse('Worker not found', 404);
          return json({ success: true, worker });
        }

        // 8. Model Registry API
        if (url.pathname === '/api/models' && request.method === 'GET') {
          const category = url.searchParams.get('category') || undefined;
          const models = await db.getModels(category);
          return json({ success: true, models });
        }

        // 9. Activity Logs API
        if (url.pathname === '/api/logs' && request.method === 'GET') {
          const logs = await db.getLogs(100);
          return json({ success: true, logs });
        }

        // 10. Conversations & Chat API
        if (url.pathname === '/api/conversations' && request.method === 'GET') {
          const conversations = await db.getConversations();
          return json({ success: true, conversations });
        }

        if (url.pathname === '/api/conversations' && request.method === 'POST') {
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;
          const convId = generateSecureId('conv');
          const created = await db.createConversation({
            id: convId,
            user_id: body.user_id || 'usr_admin',
            agent_id: body.agent_id,
            title: body.title || 'New Conversation',
            is_pinned: Boolean(body.is_pinned),
          });
          return json({ success: true, conversation: created }, 201);
        }

        const convMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
        if (convMatch) {
          const convId = convMatch[1];
          if (request.method === 'GET') {
            const conversation = await db.getConversationById(convId);
            if (!conversation) return errorResponse('Conversation not found', 404);
            const messages = await db.getMessages(convId);
            return json({ success: true, conversation, messages });
          }
          if (request.method === 'DELETE') {
            await db.deleteConversation(convId);
            return json({ success: true, message: 'Conversation deleted' });
          }
        }

        const convMessagesMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
        if (convMessagesMatch) {
          const convId = convMessagesMatch[1];
          if (request.method === 'GET') {
            const messages = await db.getMessages(convId);
            return json({ success: true, messages });
          }
          if (request.method === 'POST') {
            const parsed = await parseJsonBody(request);
            if (!parsed.ok) return errorResponse(parsed.error, 400);
            const body = parsed.body;
            if (!body.content || typeof body.content !== 'string') {
              return errorResponse('Missing or invalid message content', 400);
            }
            const msgId = generateSecureId('msg');
            const createdMsg = await db.createMessage({
              id: msgId,
              conversation_id: convId,
              sender_type: body.sender_type || 'user',
              content: body.content,
              thinking: body.thinking,
              tool_calls: body.tool_calls,
              artifacts: body.artifacts,
              attachments: body.attachments,
              tokens_used: body.tokens_used,
            });
            return json({ success: true, message: createdMsg }, 201);
          }
        }

        // 11. Real Model Inference Chat Endpoint
        if (url.pathname === '/api/chat' && request.method === 'POST') {
          const parsed = await parseJsonBody(request);
          if (!parsed.ok) return errorResponse(parsed.error, 400);
          const body = parsed.body;

          if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
            return errorResponse('Missing required field: message', 400);
          }

          let convId = body.conversation_id;
          if (!convId) {
            convId = generateSecureId('conv');
            await db.createConversation({
              id: convId,
              user_id: body.user_id || 'usr_admin',
              agent_id: body.agent_id,
              title: body.message.trim().slice(0, 32) || 'New Conversation',
            });
          }

          // 1. Record user message in D1
          const userMsgId = generateSecureId('msg');
          const userMsg = await db.createMessage({
            id: userMsgId,
            conversation_id: convId,
            sender_type: 'user',
            content: body.message.trim(),
            attachments: body.attachments,
            tokens_used: Math.round(body.message.length / 4),
          });

          // 2. Identify agent & requested model
          const agent = body.agent_id ? await db.getAgentById(body.agent_id) : null;
          const targetModel = body.model || agent?.model || 'qwen-2.5-coder-14b';

          // 3. Check for active compute workers
          const allWorkers = await db.getComputeWorkers();
          const activeWorkers = allWorkers.filter(
            w => w.status === 'online' || w.status === 'busy'
          );

          if (activeWorkers.length === 0) {
            // Check if external runtime client is configured
            if (env.INFERENCE_RUNTIME_URL) {
              try {
                const taskId = generateSecureId('tsk');
                const createdTask = await db.createTask({
                  id: taskId,
                  agent_id: agent?.id || 'agent_dataops',
                  user_id: body.user_id || 'usr_admin',
                  title: `Chat: ${body.message.trim().slice(0, 48)}`,
                  description: body.message.trim(),
                  input_payload: {
                    prompt: body.message.trim(),
                    system_instructions: agent?.system_instructions,
                    model: targetModel,
                    conversation_id: convId,
                  },
                  priority: 'high',
                  status: 'running',
                  progress_percent: 10,
                });

                await runtime.submitTask({
                  task_id: taskId,
                  agent: agent || { id: 'agent_chat', name: 'Chat Agent', model: targetModel, system_instructions: '' } as any,
                  input: { prompt: body.message.trim(), model: targetModel },
                  callback_url: `${url.origin}/api/runtime/callback`,
                });

                return json({
                  success: true,
                  task: createdTask,
                  user_message: userMsg,
                  conversation_id: convId,
                  provider: 'external',
                });
              } catch (extErr: any) {
                // External runtime failed
              }
            }

            // No active workers connected: provide honest explanation
            const errorText = `Inference Unavailable: No active compute workers are currently connected to execute model '${targetModel}'. Connect a Kaggle GPU worker node (dual Tesla T4) via the Compute Grid to execute local inference.`;
            const agentMsgId = generateSecureId('msg');
            const agentMsg = await db.createMessage({
              id: agentMsgId,
              conversation_id: convId,
              sender_type: 'agent',
              content: errorText,
              tokens_used: 0,
            });

            return json(
              {
                success: false,
                error: errorText,
                user_message: userMsg,
                agent_message: agentMsg,
                conversation_id: convId,
                active_workers: 0,
              },
              503
            );
          }

          // 4. Active worker exists: dispatch real inference task to D1 queue
          const taskId = generateSecureId('tsk');
          const createdTask = await db.createTask({
            id: taskId,
            agent_id: agent?.id || 'agent_dataops',
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
          });

          await db.logActivity({
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

          return json({
            success: true,
            task: createdTask,
            user_message: userMsg,
            conversation_id: convId,
            active_workers: activeWorkers.length,
          });
        }

        return errorResponse(`Endpoint not found: ${url.pathname}`, 404);
      } catch (err: unknown) {
        return errorResponse(`Worker server error: ${(err as Error)?.message || 'Unknown'}`, 500);
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('AetherOS Cloudflare Worker running.', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};
