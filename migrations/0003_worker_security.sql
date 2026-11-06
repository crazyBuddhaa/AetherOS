-- Migration 0003: Worker Authentication, Replay Protection, Task Lease Integrity & Non-Destructive Schema Hardening

PRAGMA defer_foreign_keys = ON;

-- 1. Add security, lease, and lifecycle columns to compute_workers (non-destructive)
ALTER TABLE compute_workers ADD COLUMN key_prefix TEXT;
ALTER TABLE compute_workers ADD COLUMN key_fingerprint TEXT;
ALTER TABLE compute_workers ADD COLUMN is_revoked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE compute_workers ADD COLUMN capabilities TEXT NOT NULL DEFAULT '["text","code"]';
ALTER TABLE compute_workers ADD COLUMN lease_expires_at TIMESTAMP DEFAULT NULL;
ALTER TABLE compute_workers ADD COLUMN shutdown_at TIMESTAMP DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workers_key_fingerprint ON compute_workers(key_fingerprint);
CREATE INDEX IF NOT EXISTS idx_workers_lease ON compute_workers(status, lease_expires_at);

-- 2. Revoke weak default seed hashes ('test' / 'password') from 0002 so no guessable credentials exist
UPDATE compute_workers
SET
  api_key_hash = 'revoked$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000',
  key_prefix = 'revoked',
  key_fingerprint = NULL,
  is_revoked = 1,
  status = 'offline'
WHERE id IN ('worker_admin_kaggle_01', 'worker_community_t4_02')
  AND api_key_hash IN (
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'
  );

-- 3. Non-destructively upgrade tasks table to support distributed compute lifecycle statuses and execution leases
-- Snapshot referencing tables so ON DELETE CASCADE / SET NULL during DROP TABLE tasks never loses existing rows
CREATE TABLE _mig_task_steps AS SELECT * FROM task_steps;
CREATE TABLE _mig_approvals AS SELECT * FROM approvals;
CREATE TABLE _mig_files_tasks AS SELECT id, task_id FROM files WHERE task_id IS NOT NULL;
CREATE TABLE _mig_logs_tasks AS SELECT id, task_id FROM activity_logs WHERE task_id IS NOT NULL;
CREATE TABLE _mig_worker_tasks AS SELECT id, current_task_id FROM compute_workers WHERE current_task_id IS NOT NULL;

CREATE TABLE tasks_v3 (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    input_payload TEXT NOT NULL DEFAULT '{}',
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN (
        'pending',
        'queued',
        'assigned',
        'downloading',
        'loading_model',
        'running',
        'uploading',
        'waiting_approval',
        'completed',
        'failed',
        'cancelled',
        'paused'
    )),
    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100),
    result_payload TEXT,
    error_message TEXT,
    external_runtime_task_id TEXT,
    claimed_by_worker TEXT,
    lease_expires_at TIMESTAMP DEFAULT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tasks_v3 (
    id, agent_id, user_id, title, description, input_payload, priority, status,
    progress_percent, result_payload, error_message, external_runtime_task_id,
    claimed_by_worker, started_at, completed_at, created_at, updated_at
)
SELECT
    id, agent_id, user_id, title, description, input_payload, priority, status,
    progress_percent, result_payload, error_message, external_runtime_task_id,
    claimed_by_worker, started_at, completed_at, created_at, updated_at
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_v3 RENAME TO tasks;

-- Restore child table references
INSERT OR IGNORE INTO task_steps SELECT * FROM _mig_task_steps;
INSERT OR IGNORE INTO approvals SELECT * FROM _mig_approvals;
UPDATE files
SET task_id = (SELECT task_id FROM _mig_files_tasks WHERE _mig_files_tasks.id = files.id)
WHERE id IN (SELECT id FROM _mig_files_tasks);
UPDATE activity_logs
SET task_id = (SELECT task_id FROM _mig_logs_tasks WHERE _mig_logs_tasks.id = activity_logs.id)
WHERE id IN (SELECT id FROM _mig_logs_tasks);
UPDATE compute_workers
SET current_task_id = (SELECT current_task_id FROM _mig_worker_tasks WHERE _mig_worker_tasks.id = compute_workers.id)
WHERE id IN (SELECT id FROM _mig_worker_tasks);

DROP TABLE _mig_task_steps;
DROP TABLE _mig_approvals;
DROP TABLE _mig_files_tasks;
DROP TABLE _mig_logs_tasks;
DROP TABLE _mig_worker_tasks;

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_worker_lease ON tasks(claimed_by_worker, status, lease_expires_at);

-- 4. Replay protection nonce ledger for authenticated worker requests
CREATE TABLE IF NOT EXISTS worker_nonces (
    worker_id TEXT NOT NULL REFERENCES compute_workers(id) ON DELETE CASCADE,
    nonce TEXT NOT NULL,
    timestamp_ms INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (worker_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_worker_nonces_expires ON worker_nonces(expires_at);

-- 5. Ensure default baseline user & agent rows exist so foreign key constraints never fail on task creation
INSERT OR IGNORE INTO users (id, email, name, role)
VALUES
    ('usr_default', 'operator@aetheros.internal', 'AetherOS Operator', 'operator'),
    ('usr_admin', 'admin@aetheros.internal', 'Alex Vance (Lead Architect)', 'admin');

INSERT OR IGNORE INTO agents (id, name, description, model, system_instructions, temperature, max_tokens, is_enabled, avatar_color, created_by)
VALUES
    (
        'agent_dataops',
        'DataOps & ETL Architect',
        'Autonomous data pipeline engineer. Manages database migrations, data normalization, parquet processing, and analytics synchronization.',
        'qwen-2.5-coder-14b',
        'You are a senior DataOps architect. Build clean, resilient data pipelines.',
        0.1,
        4096,
        1,
        '#10B981',
        'usr_admin'
    ),
    (
        'agent_sentinel',
        'Cloud Infrastructure Sentinel',
        'DevOps and infrastructure specialist. Monitors cluster health, provisions Cloudflare Worker routes, and conducts incident triage.',
        'deepseek-r1-distill-qwen-14b',
        'You are Cloud Infrastructure Sentinel. Conduct infrastructure monitoring and incident mitigation.',
        0.2,
        8192,
        1,
        '#0D9488',
        'usr_admin'
    ),
    (
        'agent_scout',
        'Research & Intelligence Scout',
        'Autonomous research specialist. Crawls technical documentation, benchmarks papers, and generates comparative executive briefs.',
        'deepseek-r1-distill-qwen-14b',
        'You are a meticulous research analyst. Synthesize technical data into actionable intelligence.',
        0.4,
        4096,
        1,
        '#8B5CF6',
        'usr_admin'
    );
