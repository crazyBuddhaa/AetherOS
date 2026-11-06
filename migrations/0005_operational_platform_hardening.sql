-- Migration 0005: Operational Platform Hardening, Capability-Aware Scheduling, Extended Task Lifecycle, Model Categories & Cybersecurity Agent
PRAGMA defer_foreign_keys = ON;

-- 1. Add capability & hardware discovery columns to compute_workers
ALTER TABLE compute_workers ADD COLUMN loaded_models TEXT NOT NULL DEFAULT '[]';
ALTER TABLE compute_workers ADD COLUMN gpu_devices_json TEXT NOT NULL DEFAULT '[]';

-- 2. Non-destructively upgrade tasks table to support full task lifecycle states, idempotency, retries, and workspace isolation
CREATE TABLE _mig5_task_steps AS SELECT * FROM task_steps;
CREATE TABLE _mig5_approvals AS SELECT * FROM approvals;
CREATE TABLE _mig5_files_tasks AS SELECT id, task_id FROM files WHERE task_id IS NOT NULL;
CREATE TABLE _mig5_logs_tasks AS SELECT id, task_id FROM activity_logs WHERE task_id IS NOT NULL;
CREATE TABLE _mig5_worker_tasks AS SELECT id, current_task_id FROM compute_workers WHERE current_task_id IS NOT NULL;

CREATE TABLE tasks_v5 (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT,
    idempotency_key TEXT,
    title TEXT NOT NULL,
    description TEXT,
    input_payload TEXT NOT NULL DEFAULT '{}',
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN (
        'pending',
        'queued',
        'validating',
        'scheduled',
        'assigned',
        'downloading',
        'loading_model',
        'running',
        'uploading',
        'processing_result',
        'waiting_approval',
        'completed',
        'failed',
        'cancelled',
        'paused',
        'expired',
        'retrying'
    )),
    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100),
    result_payload TEXT,
    error_message TEXT,
    external_runtime_task_id TEXT,
    claimed_by_worker TEXT,
    lease_expires_at TIMESTAMP DEFAULT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 2,
    timeout_seconds INTEGER NOT NULL DEFAULT 300,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tasks_v5 (
    id, agent_id, user_id, title, description, input_payload, priority, status,
    progress_percent, result_payload, error_message, external_runtime_task_id,
    claimed_by_worker, lease_expires_at, attempt_count, started_at, completed_at, created_at, updated_at
)
SELECT
    id, agent_id, user_id, title, description, input_payload, priority, status,
    progress_percent, result_payload, error_message, external_runtime_task_id,
    claimed_by_worker, lease_expires_at, COALESCE(attempt_count, 0), started_at, completed_at, created_at, updated_at
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_v5 RENAME TO tasks;

-- Restore child table references
INSERT OR IGNORE INTO task_steps SELECT * FROM _mig5_task_steps;
INSERT OR IGNORE INTO approvals SELECT * FROM _mig5_approvals;
UPDATE files
SET task_id = (SELECT task_id FROM _mig5_files_tasks WHERE _mig5_files_tasks.id = files.id)
WHERE id IN (SELECT id FROM _mig5_files_tasks);
UPDATE activity_logs
SET task_id = (SELECT task_id FROM _mig5_logs_tasks WHERE _mig5_logs_tasks.id = activity_logs.id)
WHERE id IN (SELECT id FROM _mig5_logs_tasks);
UPDATE compute_workers
SET current_task_id = (SELECT current_task_id FROM _mig5_worker_tasks WHERE _mig5_worker_tasks.id = compute_workers.id)
WHERE id IN (SELECT id FROM _mig5_worker_tasks);

DROP TABLE _mig5_task_steps;
DROP TABLE _mig5_approvals;
DROP TABLE _mig5_files_tasks;
DROP TABLE _mig5_logs_tasks;
DROP TABLE _mig5_worker_tasks;

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_worker_lease ON tasks(claimed_by_worker, status, lease_expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_user_idempotency ON tasks(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id, created_at DESC);

-- 3. Upgrade model_registry to support all 8 model categories & rich hardware capability metadata
CREATE TABLE model_registry_v5 (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN (
        'text',
        'coding',
        'vision',
        'image',
        'video',
        'image_processing',
        'audio',
        'speech',
        'embedding',
        'specialized'
    )),
    min_vram_mb INTEGER NOT NULL,
    min_system_ram_mb INTEGER NOT NULL DEFAULT 8192,
    supported_precisions TEXT NOT NULL DEFAULT '["fp16"]',
    capabilities TEXT NOT NULL DEFAULT '["text"]',
    weights_source TEXT NOT NULL,
    parameter_count TEXT,
    context_window INTEGER DEFAULT 8192,
    default_timeout_seconds INTEGER NOT NULL DEFAULT 120,
    description TEXT,
    execution_constraints TEXT DEFAULT '{}',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO model_registry_v5 (
    id, name, category, min_vram_mb, supported_precisions, weights_source, description, execution_constraints, is_enabled, created_at
)
SELECT
    id, name, category, min_vram_mb, supported_precisions, weights_source, description, execution_constraints, is_enabled, created_at
FROM model_registry;

DROP TABLE model_registry;
ALTER TABLE model_registry_v5 RENAME TO model_registry;

CREATE INDEX IF NOT EXISTS idx_model_registry_category ON model_registry(category, is_enabled);

-- Update existing models with accurate categories, capabilities, and RAM requirements, and seed full 8-category catalog
UPDATE model_registry
SET category = 'coding',
    min_system_ram_mb = 16384,
    capabilities = '["text","code","coding","sql","python","typescript"]',
    parameter_count = '14.7B',
    context_window = 32768,
    default_timeout_seconds = 180
WHERE id = 'qwen-2.5-coder-14b';

UPDATE model_registry
SET category = 'text',
    min_system_ram_mb = 16384,
    capabilities = '["text","reasoning","code","analysis","screenplay","storyboard"]',
    parameter_count = '14.8B',
    context_window = 32768,
    default_timeout_seconds = 180
WHERE id = 'deepseek-r1-distill-qwen-14b';

UPDATE model_registry
SET capabilities = '["image","text_to_image","diffusion"]',
    min_system_ram_mb = 12288,
    parameter_count = '2.6B',
    default_timeout_seconds = 90
WHERE id = 'sdxl-lightning';

UPDATE model_registry
SET capabilities = '["image","text_to_image","diffusion"]',
    min_system_ram_mb = 8192,
    parameter_count = '0.98B',
    default_timeout_seconds = 60
WHERE id = 'sd-1.5-standard';

UPDATE model_registry
SET capabilities = '["video","text_to_video","keyframe_animation"]',
    min_system_ram_mb = 16384,
    parameter_count = '1.5B',
    default_timeout_seconds = 240
WHERE id = 'animatediff-motion-v3';

UPDATE model_registry
SET category = 'speech',
    capabilities = '["audio","speech","transcription","speech_to_text"]',
    min_system_ram_mb = 8192,
    parameter_count = '0.8B',
    default_timeout_seconds = 90
WHERE id = 'whisper-large-v3-turbo';

UPDATE model_registry
SET capabilities = '["image_processing","upscale"]',
    min_system_ram_mb = 8192,
    parameter_count = '16.7M',
    default_timeout_seconds = 60
WHERE id = 'real-esrgan-4x';

UPDATE model_registry
SET capabilities = '["image_processing","background_removal","segmentation"]',
    min_system_ram_mb = 8192,
    parameter_count = '215M',
    default_timeout_seconds = 60
WHERE id = 'birefnet-bg-removal';

INSERT OR IGNORE INTO model_registry (
    id, name, category, min_vram_mb, min_system_ram_mb, supported_precisions, capabilities,
    weights_source, parameter_count, context_window, default_timeout_seconds, description, execution_constraints
) VALUES
    (
        'qwen-2-vl-7b-instruct',
        'Qwen2-VL 7B Vision-Language',
        'vision',
        10240,
        12288,
        '["fp16","int4"]',
        '["vision","multimodal","image_understanding","ocr","text"]',
        'Qwen/Qwen2-VL-7B-Instruct',
        '7.6B',
        32768,
        120,
        'Multimodal vision-language model for optical frame inspection, diagram parsing, and visual QA.',
        '{"requires_vision_tower":true}'
    ),
    (
        'bge-large-en-v1.5',
        'BGE Large English v1.5 Embeddings',
        'embedding',
        2048,
        4096,
        '["fp16","fp32"]',
        '["embedding","semantic_search","retrieval"]',
        'BAAI/bge-large-en-v1.5',
        '335M',
        512,
        30,
        'High-dimensional dense vector embedding model for semantic code, document, and artifact indexing.',
        '{"embedding_dimensions":1024}'
    ),
    (
        'cybersec-defensive-analyzer-v1',
        'AetherSec Defensive Audit Engine v1',
        'specialized',
        0,
        2048,
        '["fp32","fp16"]',
        '["security_audit","header_analysis","tls_check","dns_check","dependency_audit","static_code_scan"]',
        'aetheros/cybersec-defensive-analyzer-v1',
        'Rule+AST',
        65536,
        60,
        'Deterministic defensive security analyzer for HTTP headers, TLS posture, DNS SPF/DMARC/CAA, dependencies, and static code auditing.',
        '{"defensive_only":true,"requires_target_authorization":true}'
    );

-- 4. Seed Studio & Cybersecurity Specialist Agents so foreign keys and orchestrator routing always succeed
INSERT OR IGNORE INTO agents (
    id, name, description, model, system_instructions, temperature, max_tokens, permitted_tools, is_enabled, avatar_color, created_by
) VALUES
    (
        'agent_code_architect',
        'Code Architect & Systems Engineer',
        'Full-stack systems architect for Cloudflare Workers, D1 SQLite migrations, TypeScript APIs, and PyTorch GPU inference modules.',
        'qwen-2.5-coder-14b',
        'You are the AetherOS Code Architect. Produce production-grade, secure TypeScript, SQL, and Python implementations.',
        0.15,
        8192,
        '[]',
        1,
        '#2563EB',
        'usr_admin'
    ),
    (
        'agent_cybersec',
        'Cybersecurity & Defensive Audit Specialist',
        'Authorized defensive security operations: HTTP security-header analysis, TLS posture checks, DNS SPF/DMARC/CAA verification, dependency vulnerability auditing, static source-code security scanning, and CVSS-prioritized remediation reporting.',
        'cybersec-defensive-analyzer-v1',
        'You are the AetherOS Cybersecurity & Defensive Audit Specialist. Operate strictly within authorized defensive boundaries. Never fabricate findings, never perform destructive or offensive actions, clearly distinguish verified findings from unverified indicators, and provide concrete remediation guidance.',
        0.1,
        8192,
        '[{"id":"tool_http_headers","name":"http_security_header_audit","description":"Inspect HTTP response security headers and cookie flags on authorized targets","category":"network","requires_approval":false,"risk_level":"low"},{"id":"tool_dns_security","name":"dns_spf_dmarc_caa_check","description":"Verify DNS SPF, DMARC, and CAA records via Cloudflare DoH","category":"network","requires_approval":false,"risk_level":"low"},{"id":"tool_dep_audit","name":"dependency_vulnerability_audit","description":"Audit package manifests for vulnerable or unpinned dependencies","category":"execution","requires_approval":false,"risk_level":"low"},{"id":"tool_static_code_audit","name":"static_code_security_scanner","description":"Scan source code and configuration files for secrets, injection sinks, and misconfigurations","category":"execution","requires_approval":false,"risk_level":"low"}]',
        1,
        '#DC2626',
        'usr_admin'
    ),
    (
        'agent_visual_synth',
        'Visual Synthesis Director',
        'High-resolution image synthesis, SDXL Lightning rendering, Real-ESRGAN 4x upscaling, and BiRefNet segmentation.',
        'sdxl-lightning',
        'You are the AetherOS Visual Synthesis Director. Formulate optically precise prompts and conditioning pipelines for high-resolution image synthesis on GPU compute nodes.',
        0.5,
        2048,
        '[]',
        1,
        '#0284C7',
        'usr_admin'
    ),
    (
        'agent_motion_studio',
        'Motion & Video Director',
        'Temporal motion synthesis, camera trajectory planning, and keyframe-conditioned AnimateDiff video generation.',
        'animatediff-motion-v3',
        'You are the AetherOS Motion & Video Director. Orchestrate temporal consistency, focal length transitions, and multi-frame motion modules on GPU compute nodes.',
        0.4,
        2048,
        '[]',
        1,
        '#4F46E5',
        'usr_admin'
    ),
    (
        'agent_storyboard',
        'Storyboard & Continuity Architect',
        'Sequential visual narrative planning, camera blocking, lens selection, and animatic pacing.',
        'deepseek-r1-distill-qwen-14b',
        'You are the AetherOS Storyboard & Continuity Architect. Translate narrative beats into structured shot lists with lens focal lengths, camera movement, and visual composition notes.',
        0.3,
        4096,
        '[]',
        1,
        '#0D9488',
        'usr_admin'
    ),
    (
        'agent_screenwriter',
        'Screenplay & Narrative Dramaturg',
        'Industry-standard screenplay formatting, dialogue polish, structural beat sheets, and scene breakdown.',
        'deepseek-r1-distill-qwen-14b',
        'You are the AetherOS Screenplay & Narrative Dramaturg. Write crisp, industry-standard fountain/screenplay scenes with sharp subtext, visual action lines, and structural pacing.',
        0.6,
        4096,
        '[]',
        1,
        '#D97706',
        'usr_admin'
    );

-- 5. Rate Limiting Ledger Table for Edge Authentication & API Protection
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket_key TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL DEFAULT 1,
    window_expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_exp ON auth_rate_limits(window_expires_at);
