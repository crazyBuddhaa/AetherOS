-- Migration 0004: User Accounts, Passwordless Passkey/TOTP Authentication, Workspaces, and Kaggle Compute Session Management
PRAGMA defer_foreign_keys = ON;

-- 1. Ensure / update Users table with email verification and status
CREATE TABLE IF NOT EXISTS users_v4 (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'operator', 'member', 'viewer')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending_verification', 'active', 'suspended')),
    verification_token_hash TEXT,
    verification_expires_at TIMESTAMP,
    avatar_url TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Copy any existing users if present
INSERT OR IGNORE INTO users_v4 (id, email, name, role, status, avatar_url, created_at, updated_at)
SELECT id, email, name, role, 'active', avatar_url, created_at, updated_at FROM users;

-- 2. Organizations / Workspaces Table
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users_v4(id) ON DELETE CASCADE,
    is_personal INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Organization Memberships Table
CREATE TABLE IF NOT EXISTS organization_memberships (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users_v4(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, user_id)
);

-- 4. Passkey / WebAuthn Credentials Table
CREATE TABLE IF NOT EXISTS passkey_credentials (
    id TEXT PRIMARY KEY, -- Credential ID (base64url)
    user_id TEXT NOT NULL REFERENCES users_v4(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL, -- COSE public key in base64url or hex
    algorithm INTEGER NOT NULL DEFAULT -7, -- -7: ES256, -257: RS256
    sign_count INTEGER NOT NULL DEFAULT 0,
    device_name TEXT NOT NULL DEFAULT 'Passkey Authenticator',
    transports TEXT DEFAULT '["internal","hybrid"]', -- JSON array
    aaguid TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP
);

-- 5. TOTP Credentials Table (RFC 6238)
CREATE TABLE IF NOT EXISTS totp_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL REFERENCES users_v4(id) ON DELETE CASCADE,
    encrypted_secret TEXT NOT NULL,
    secret_iv TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'AetherOS Authenticator',
    is_active INTEGER NOT NULL DEFAULT 1,
    last_verified_counter INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Authentication Challenges Table (Strict 4-attempt lock & single-use)
CREATE TABLE IF NOT EXISTS auth_challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL, -- base64url
    purpose TEXT NOT NULL CHECK(purpose IN ('registration', 'login', 'passkey_enrollment')),
    user_id TEXT REFERENCES users_v4(id) ON DELETE CASCADE,
    email TEXT,
    origin TEXT NOT NULL,
    rp_id TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    is_used INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Authenticated Sessions Table
CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY, -- Session Token (base64url 256-bit)
    user_id TEXT NOT NULL REFERENCES users_v4(id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    ip_address TEXT,
    user_agent TEXT,
    is_revoked INTEGER NOT NULL DEFAULT 0,
    last_active_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8. Compute Sessions Table (Remote Kaggle Notebook Execution)
CREATE TABLE IF NOT EXISTS compute_sessions (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'kaggle' CHECK(provider IN ('kaggle', 'oracle', 'runpod', 'self_hosted')),
    user_id TEXT NOT NULL REFERENCES users_v4(id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    worker_id TEXT REFERENCES compute_workers(id) ON DELETE SET NULL,
    notebook_slug TEXT NOT NULL,
    kernel_session_id TEXT,
    status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN (
        'stopped',
        'starting',
        'initializing',
        'waiting_for_worker',
        'ready',
        'busy',
        'stopping',
        'failed',
        'unavailable'
    )),
    gpu_type TEXT NOT NULL DEFAULT '2x Tesla T4',
    started_at TIMESTAMP,
    stopped_at TIMESTAMP,
    last_poll_at TIMESTAMP,
    logs_snippet TEXT,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 9. Worker Ownership Table (Preserving wrk_kaggle_464cc6bdb46da70260a1e849)
CREATE TABLE IF NOT EXISTS worker_ownership (
    worker_id TEXT PRIMARY KEY REFERENCES compute_workers(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users_v4(id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    ownership_type TEXT NOT NULL DEFAULT 'personal' CHECK(ownership_type IN ('personal', 'organization', 'contributor')),
    claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 10. Kaggle Encrypted Credentials Table
CREATE TABLE IF NOT EXISTS kaggle_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users_v4(id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    kaggle_username TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    key_iv TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, kaggle_username)
);

-- 11. Security Audit Events Table
CREATE TABLE IF NOT EXISTS security_audit_events (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users_v4(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info', 'warning', 'critical')),
    details TEXT NOT NULL DEFAULT '{}',
    ip_address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create essential performance indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user ON auth_sessions(user_id, is_revoked, expires_at);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkey_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_challenges_exp ON auth_challenges(expires_at, is_used);
CREATE INDEX IF NOT EXISTS idx_compute_sessions_user ON compute_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_compute_sessions_worker ON compute_sessions(worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_ownership_owner ON worker_ownership(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_audit_events(user_id, created_at DESC);
