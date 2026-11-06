-- Migration 0001: Initial schema for AetherOS AI Agent Platform on Cloudflare D1 (SQLite)
   
-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'operator', 'member', 'viewer')),
    api_key_hash TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Agents Table
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    model TEXT NOT NULL DEFAULT 'custom-inference-v1',
    system_instructions TEXT NOT NULL,
    temperature REAL NOT NULL DEFAULT 0.2,
    max_tokens INTEGER NOT NULL DEFAULT 4096,
    permitted_tools TEXT NOT NULL DEFAULT '[]', -- JSON array of enabled tool definitions with approval requirements
    is_enabled INTEGER NOT NULL DEFAULT 1,
    avatar_color TEXT NOT NULL DEFAULT '#2563EB',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT 'New Conversation',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Messages Table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK(sender_type IN ('user', 'agent', 'system', 'tool')),
    content TEXT NOT NULL,
    tool_calls TEXT, -- JSON array of tool execution records
    attachments TEXT, -- JSON array of attached file IDs
    tokens_used INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Tasks Table
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    input_payload TEXT NOT NULL DEFAULT '{}', -- JSON object containing task instructions & params
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled', 'paused')),
    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100),
    result_payload TEXT, -- JSON object containing execution outputs
    error_message TEXT,
    external_runtime_task_id TEXT, -- ID returned by self-hosted inference engine
    claimed_by_worker TEXT, -- Identifier of worker process handling execution
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Task Execution Steps Table
CREATE TABLE IF NOT EXISTS task_steps (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    step_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'waiting_approval')),
    input_data TEXT, -- JSON input data for this step
    output_data TEXT, -- JSON result data for this step
    logs TEXT, -- Raw execution console output
    duration_ms INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Human Approvals Table (Consequential Action Authorization)
CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    step_id TEXT REFERENCES task_steps(id) ON DELETE SET NULL,
    action_name TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('shell_execution', 'file_modification', 'database_write', 'external_api_call', 'financial_transaction', 'cloud_deployment')),
    payload TEXT NOT NULL, -- JSON detailed payload of proposed command/diff
    risk_level TEXT NOT NULL DEFAULT 'medium' CHECK(risk_level IN ('low', 'medium', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'expired')),
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TIMESTAMP,
    decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    review_comment TEXT
);

-- 8. Cloudflare R2 Files Table
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    r2_key TEXT UNIQUE NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    etag TEXT,
    uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    storage_class TEXT NOT NULL DEFAULT 'Standard',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 9. Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('auth', 'agent', 'task', 'approval', 'file', 'system', 'runtime')),
    details TEXT, -- JSON object
    ip_address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for high-performance querying
CREATE INDEX IF NOT EXISTS idx_agents_enabled ON agents(is_enabled);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_task_steps_task ON task_steps(task_id, step_number ASC);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_user ON files(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);
