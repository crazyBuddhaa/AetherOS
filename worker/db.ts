import type {
  Agent,
  Task,
  TaskStep,
  ApprovalRequest,
  R2FileRecord,
  ActivityLog,
  D1Database,
  ComputeWorker,
  ModelDefinition,
  WorkerHeartbeatPayload,
  Conversation,
  Message,
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
} from './types.ts';
import {
  ACTIVE_WORKER_TASK_STATUSES,
  REPLAY_WINDOW_MS,
  WORKER_LEASE_TTL_MS,
  type TaskStepStatus,
  computeKeyFingerprint,
  generateSecureId,
  generateWorkerApiKey,
  normalizeStepNumber,
  normalizeWorkerProgressStatus,
  verifyApiKeyHash,
} from './auth.ts';

export interface WorkerAuthOutcome {
  authenticated: boolean;
  status: number;
  error?: string;
  worker?: ComputeWorker;
}

export interface ClaimTaskOutcome {
  status: number;
  task: Task | null;
  error?: string;
}

export interface TaskMutationOutcome {
  ok: boolean;
  status: number;
  error?: string;
  stepStatus?: TaskStepStatus;
  taskStatus?: string;
}

const PUBLIC_WORKER_COLUMNS = `
  w.id,
  w.name,
  w.provider,
  w.gpu_model,
  w.gpu_count,
  w.vram_mb,
  w.system_ram_mb,
  w.status,
  w.key_prefix,
  w.capabilities,
  w.contributor_name,
  w.contributor_email,
  w.current_task_id,
  w.last_heartbeat,
  w.lease_expires_at,
  w.shutdown_at,
  w.uptime_seconds,
  w.total_tasks_completed,
  w.created_at,
  w.updated_at
`;

/**
 * Cloudflare D1 Database Repository & Queries
 */
export class D1DatabaseService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  private mapPublicWorker(row: any): ComputeWorker {
    let parsedCapabilities: string[] = ['text', 'code'];
    if (Array.isArray(row.capabilities)) {
      parsedCapabilities = row.capabilities;
    } else if (typeof row.capabilities === 'string' && row.capabilities.length > 0) {
      try {
        const parsed = JSON.parse(row.capabilities);
        if (Array.isArray(parsed)) parsedCapabilities = parsed;
      } catch {
        parsedCapabilities = ['text', 'code'];
      }
    }

    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      gpu_model: row.gpu_model,
      gpu_count: Number(row.gpu_count ?? 0),
      vram_mb: Number(row.vram_mb ?? 0),
      system_ram_mb: Number(row.system_ram_mb ?? 0),
      status: row.status,
      key_prefix: row.key_prefix || undefined,
      capabilities: parsedCapabilities,
      contributor_name: row.contributor_name || undefined,
      contributor_email: row.contributor_email || undefined,
      current_task_id: row.current_task_id || undefined,
      current_task_title: row.current_task_title || undefined,
      last_heartbeat: row.last_heartbeat || undefined,
      lease_expires_at: row.lease_expires_at || undefined,
      shutdown_at: row.shutdown_at || undefined,
      uptime_seconds: Number(row.uptime_seconds ?? 0),
      total_tasks_completed: Number(row.total_tasks_completed ?? 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
      gpu_utilization_percent:
        row.gpu_utilization_percent !== undefined && row.gpu_utilization_percent !== null
          ? Number(row.gpu_utilization_percent)
          : undefined,
      gpu_memory_used_mb:
        row.gpu_memory_used_mb !== undefined && row.gpu_memory_used_mb !== null
          ? Number(row.gpu_memory_used_mb)
          : undefined,
      gpu_temperature_c:
        row.gpu_temperature_c !== undefined && row.gpu_temperature_c !== null
          ? Number(row.gpu_temperature_c)
          : undefined,
    };
  }

  // --- AGENTS ---
  async getAgents(): Promise<Agent[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM agents ORDER BY created_at DESC')
      .all<any>();

    return (results || []).map((row: any) => ({
      ...row,
      permitted_tools: JSON.parse(row.permitted_tools || '[]'),
      is_enabled: Boolean(row.is_enabled),
    }));
  }

  async getAgentById(id: string): Promise<Agent | null> {
    const row = await this.db
      .prepare('SELECT * FROM agents WHERE id = ?')
      .bind(id)
      .first<any>();

    if (!row) return null;
    return {
      ...row,
      permitted_tools: JSON.parse(row.permitted_tools || '[]'),
      is_enabled: Boolean(row.is_enabled),
    };
  }

  async createAgent(agent: Omit<Agent, 'created_at' | 'updated_at'>): Promise<Agent> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT INTO agents (id, name, description, model, system_instructions, temperature, max_tokens, permitted_tools, is_enabled, avatar_color, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        agent.id,
        agent.name,
        agent.description || '',
        agent.model,
        agent.system_instructions,
        agent.temperature,
        agent.max_tokens,
        JSON.stringify(agent.permitted_tools || []),
        agent.is_enabled ? 1 : 0,
        agent.avatar_color,
        agent.created_by || null,
        now,
        now
      )
      .run();

    return { ...agent, created_at: now, updated_at: now };
  }

  async updateAgent(id: string, updates: Partial<Agent>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.model !== undefined) { fields.push('model = ?'); values.push(updates.model); }
    if (updates.system_instructions !== undefined) { fields.push('system_instructions = ?'); values.push(updates.system_instructions); }
    if (updates.temperature !== undefined) { fields.push('temperature = ?'); values.push(updates.temperature); }
    if (updates.permitted_tools !== undefined) { fields.push('permitted_tools = ?'); values.push(JSON.stringify(updates.permitted_tools)); }
    if (updates.is_enabled !== undefined) { fields.push('is_enabled = ?'); values.push(updates.is_enabled ? 1 : 0); }
    if (updates.avatar_color !== undefined) { fields.push('avatar_color = ?'); values.push(updates.avatar_color); }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await this.db
      .prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  async deleteAgent(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM agents WHERE id = ?').bind(id).run();
  }

  // --- TASKS ---
  async getTasks(status?: string, agentId?: string): Promise<Task[]> {
    await this.reapExpiredLeases();

    let query = `
      SELECT t.*, a.name as agent_name 
      FROM tasks t 
      LEFT JOIN agents a ON t.agent_id = a.id
    `;
    const conditions: string[] = [];
    const params: any[] = [];

    if (status && status !== 'all') {
      conditions.push('t.status = ?');
      params.push(status);
    }
    if (agentId) {
      conditions.push('t.agent_id = ?');
      params.push(agentId);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ' ORDER BY t.created_at DESC LIMIT 100';

    const { results } = await this.db.prepare(query).bind(...params).all<any>();

    return (results || []).map((row: any) => ({
      ...row,
      input_payload: JSON.parse(row.input_payload || '{}'),
      result_payload: row.result_payload ? JSON.parse(row.result_payload) : undefined,
    }));
  }

  async getTaskWithSteps(id: string): Promise<Task | null> {
    const taskRow = await this.db
      .prepare('SELECT t.*, a.name as agent_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id WHERE t.id = ?')
      .bind(id)
      .first<any>();

    if (!taskRow) return null;

    const { results: stepRows } = await this.db
      .prepare('SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_number ASC')
      .bind(id)
      .all<any>();

    const steps: TaskStep[] = (stepRows || []).map((s: any) => ({
      ...s,
      input_data: s.input_data ? JSON.parse(s.input_data) : undefined,
      output_data: s.output_data ? JSON.parse(s.output_data) : undefined,
    }));

    return {
      ...taskRow,
      input_payload: JSON.parse(taskRow.input_payload || '{}'),
      result_payload: taskRow.result_payload ? JSON.parse(taskRow.result_payload) : undefined,
      steps,
    };
  }

  async createTask(task: Omit<Task, 'created_at' | 'updated_at'>): Promise<Task> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT INTO tasks (id, agent_id, user_id, title, description, input_payload, priority, status, progress_percent, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        task.id,
        task.agent_id,
        task.user_id,
        task.title,
        task.description || '',
        JSON.stringify(task.input_payload || {}),
        task.priority,
        task.status,
        task.progress_percent || 0,
        now,
        now
      )
      .run();

    return { ...task, created_at: now, updated_at: now };
  }

  async updateTaskStatus(
    id: string,
    status: string,
    progress: number,
    resultPayload?: Record<string, unknown>,
    errorMessage?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        UPDATE tasks 
        SET status = ?, progress_percent = ?, result_payload = ?, error_message = ?, updated_at = ?
        WHERE id = ?
      `)
      .bind(
        status,
        progress,
        resultPayload ? JSON.stringify(resultPayload) : null,
        errorMessage || null,
        now,
        id
      )
      .run();
  }

  async cancelTask(id: string, reason = 'Cancelled by operator'): Promise<Task | null> {
    const existing = await this.getTaskWithSteps(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    await this.db
      .prepare(`
        UPDATE tasks
        SET status = 'cancelled', error_message = ?, lease_expires_at = NULL, completed_at = ?, updated_at = ?
        WHERE id = ? AND status NOT IN ('completed', 'cancelled')
      `)
      .bind(reason, now, now, id)
      .run();

    if (existing.claimed_by_worker) {
      await this.db
        .prepare(`
          UPDATE compute_workers
          SET status = CASE WHEN status = 'busy' THEN 'online' ELSE status END,
              current_task_id = NULL,
              updated_at = ?
          WHERE id = ? AND current_task_id = ?
        `)
        .bind(now, existing.claimed_by_worker, id)
        .run();
    }

    return this.getTaskWithSteps(id);
  }

  async togglePauseTask(id: string): Promise<Task | null> {
    const existing = await this.getTaskWithSteps(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    if (existing.status === 'running') {
      await this.db
        .prepare("UPDATE tasks SET status = 'paused', updated_at = ? WHERE id = ?")
        .bind(now, id)
        .run();
    } else if (existing.status === 'paused') {
      await this.db
        .prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?")
        .bind(now, id)
        .run();
    }
    return this.getTaskWithSteps(id);
  }

  // --- APPROVALS ---
  async getApprovals(status?: string): Promise<ApprovalRequest[]> {
    let query = `
      SELECT ap.*, a.name as agent_name, t.title as task_title 
      FROM approvals ap
      LEFT JOIN agents a ON ap.agent_id = a.id
      LEFT JOIN tasks t ON ap.task_id = t.id
    `;
    const params: any[] = [];
    if (status && status !== 'all') {
      query += ' WHERE ap.status = ?';
      params.push(status);
    }
    query += ' ORDER BY ap.requested_at DESC';

    const { results } = await this.db.prepare(query).bind(...params).all<any>();
    return (results || []).map((row: any) => ({
      ...row,
      payload: JSON.parse(row.payload || '{}'),
    }));
  }

  async decideApproval(
    id: string,
    decision: 'approved' | 'rejected',
    reviewerId: string,
    comment?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        UPDATE approvals 
        SET status = ?, decided_at = ?, decided_by = ?, review_comment = ? 
        WHERE id = ?
      `)
      .bind(decision, now, reviewerId, comment || '', id)
      .run();
  }

  // --- FILES METADATA ---
  async recordFileMetadata(record: Omit<R2FileRecord, 'created_at'>): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT OR IGNORE INTO files (id, r2_key, filename, mime_type, size_bytes, etag, uploaded_by, conversation_id, task_id, storage_class, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        record.id,
        record.r2_key,
        record.filename,
        record.mime_type,
        record.size_bytes,
        record.etag || null,
        record.uploaded_by,
        record.conversation_id || null,
        record.task_id || null,
        record.storage_class || 'Standard',
        now
      )
      .run();
  }

  // --- ACTIVITY LOGS ---
  async logActivity(log: Omit<ActivityLog, 'id' | 'created_at'>): Promise<void> {
    const id = generateSecureId('act');
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT INTO activity_logs (id, user_id, agent_id, task_id, action, category, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        log.user_id || null,
        log.agent_id || null,
        log.task_id || null,
        log.action,
        log.category,
        log.details ? JSON.stringify(log.details) : null,
        log.ip_address || null,
        now
      )
      .run();
  }

  async getLogs(limit = 100): Promise<ActivityLog[]> {
    const res = await this.db
      .prepare(`
        SELECT * FROM activity_logs
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .bind(limit)
      .all<any>();

    return (res.results || []).map((r: any) => ({
      ...r,
      details: r.details
        ? typeof r.details === 'string'
          ? (() => {
              try {
                return JSON.parse(r.details);
              } catch {
                return r.details;
              }
            })()
          : r.details
        : undefined,
    }));
  }

  // --- CONVERSATIONS & CHAT MESSAGES ---
  async getConversations(userId = 'usr_admin'): Promise<Conversation[]> {
    const res = await this.db
      .prepare(`
        SELECT c.*, a.name as agent_name, a.avatar_color as agent_avatar_color,
               (SELECT count(*) FROM messages WHERE conversation_id = c.id) as message_count,
               (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
        FROM conversations c
        LEFT JOIN agents a ON c.agent_id = a.id
        WHERE c.user_id = ? OR ? = ''
        ORDER BY c.updated_at DESC
      `)
      .bind(userId, userId)
      .all<any>();

    return (res.results || []).map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      agent_id: r.agent_id || undefined,
      agent_name: r.agent_name || undefined,
      agent_avatar_color: r.agent_avatar_color || undefined,
      title: r.title,
      is_pinned: Boolean(r.is_pinned),
      created_at: r.created_at,
      updated_at: r.updated_at,
      last_message: r.last_message || undefined,
      message_count: Number(r.message_count) || 0,
    }));
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    const res = await this.db
      .prepare(`
        SELECT c.*, a.name as agent_name, a.avatar_color as agent_avatar_color
        FROM conversations c
        LEFT JOIN agents a ON c.agent_id = a.id
        WHERE c.id = ?
      `)
      .bind(id)
      .first<any>();

    if (!res) return null;
    return {
      id: res.id,
      user_id: res.user_id,
      agent_id: res.agent_id || undefined,
      agent_name: res.agent_name || undefined,
      agent_avatar_color: res.agent_avatar_color || undefined,
      title: res.title,
      is_pinned: Boolean(res.is_pinned),
      created_at: res.created_at,
      updated_at: res.updated_at,
    };
  }

  async createConversation(conv: {
    id: string;
    user_id?: string;
    agent_id?: string;
    title: string;
    is_pinned?: boolean;
  }): Promise<Conversation> {
    const now = new Date().toISOString();
    const userId = conv.user_id || 'usr_admin';

    await this.db
      .prepare(`INSERT OR IGNORE INTO users (id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(userId, 'operator@aetheros.internal', 'Lead Operator', 'admin', now, now)
      .run()
      .catch(() => {});

    await this.db
      .prepare(`
        INSERT INTO conversations (id, user_id, agent_id, title, is_pinned, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        conv.id,
        userId,
        conv.agent_id || null,
        conv.title || 'New Conversation',
        conv.is_pinned ? 1 : 0,
        now,
        now
      )
      .run();

    return {
      id: conv.id,
      user_id: userId,
      agent_id: conv.agent_id,
      title: conv.title || 'New Conversation',
      is_pinned: Boolean(conv.is_pinned),
      created_at: now,
      updated_at: now,
      message_count: 0,
    };
  }

  async deleteConversation(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(id).run().catch(() => {});
    await this.db.prepare('DELETE FROM conversations WHERE id = ?').bind(id).run();
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    const res = await this.db
      .prepare(`
        SELECT * FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      `)
      .bind(conversationId)
      .all<any>();

    return (res.results || []).map((r: any) => {
      let toolCalls: any = undefined;
      let thinking: string | undefined = undefined;
      let artifacts: any = undefined;

      if (r.tool_calls) {
        try {
          const parsed = JSON.parse(r.tool_calls);
          if (Array.isArray(parsed)) {
            toolCalls = parsed;
          } else if (typeof parsed === 'object' && parsed !== null) {
            toolCalls = parsed.tools;
            thinking = parsed.thinking;
            artifacts = parsed.artifacts;
          }
        } catch {}
      }

      let attachments: string[] | undefined = undefined;
      if (r.attachments) {
        try {
          attachments = JSON.parse(r.attachments);
        } catch {}
      }

      return {
        id: r.id,
        conversation_id: r.conversation_id,
        sender_type: r.sender_type,
        content: r.content,
        thinking,
        tool_calls: toolCalls,
        artifacts,
        attachments,
        tokens_used: Number(r.tokens_used) || 0,
        created_at: r.created_at,
      };
    });
  }

  async createMessage(msg: {
    id: string;
    conversation_id: string;
    sender_type: 'user' | 'agent' | 'system' | 'tool';
    content: string;
    thinking?: string;
    tool_calls?: any[];
    artifacts?: any[];
    attachments?: string[];
    tokens_used?: number;
  }): Promise<Message> {
    const now = new Date().toISOString();

    const toolCallsPayload = msg.thinking || msg.artifacts
      ? JSON.stringify({ tools: msg.tool_calls || [], thinking: msg.thinking, artifacts: msg.artifacts })
      : msg.tool_calls
      ? JSON.stringify(msg.tool_calls)
      : null;

    const attachmentsPayload = msg.attachments ? JSON.stringify(msg.attachments) : null;

    await this.db
      .prepare(`
        INSERT INTO messages (id, conversation_id, sender_type, content, tool_calls, attachments, tokens_used, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        msg.id,
        msg.conversation_id,
        msg.sender_type,
        msg.content,
        toolCallsPayload,
        attachmentsPayload,
        msg.tokens_used || 0,
        now
      )
      .run();

    await this.db
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .bind(now, msg.conversation_id)
      .run()
      .catch(() => {});

    return {
      id: msg.id,
      conversation_id: msg.conversation_id,
      sender_type: msg.sender_type,
      content: msg.content,
      tool_calls: msg.tool_calls,
      attachments: msg.attachments,
      tokens_used: msg.tokens_used || 0,
      created_at: now,
    };
  }

  // --- DISTRIBUTED COMPUTE WORKERS & LEASE MANAGEMENT ---

  /**
   * Automatically release expired worker/task leases so crashed nodes never lock tasks indefinitely.
   */
  async reapExpiredLeases(): Promise<void> {
    const now = new Date().toISOString();
    try {
      await this.db
        .prepare(`
          UPDATE tasks
          SET status = 'queued',
              claimed_by_worker = NULL,
              lease_expires_at = NULL,
              progress_percent = 0,
              updated_at = ?
          WHERE status IN ('assigned', 'downloading', 'loading_model', 'running', 'uploading')
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < ?
        `)
        .bind(now, now)
        .run();

      await this.db
        .prepare(`
          UPDATE compute_workers
          SET status = 'offline',
              current_task_id = NULL,
              lease_expires_at = NULL,
              updated_at = ?
          WHERE status IN ('online', 'busy')
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < ?
        `)
        .bind(now, now)
        .run();
    } catch {
      // Ignore if migration 0003 columns have not been applied yet on an unmigrated instance
    }
  }

  async getComputeWorkers(): Promise<ComputeWorker[]> {
    await this.reapExpiredLeases();

    const query = `
      SELECT ${PUBLIC_WORKER_COLUMNS},
             t.title as current_task_title,
             (SELECT gpu_utilization_percent FROM worker_metrics wm WHERE wm.worker_id = w.id ORDER BY wm.recorded_at DESC, wm.rowid DESC LIMIT 1) as gpu_utilization_percent,
             (SELECT gpu_memory_used_mb FROM worker_metrics wm WHERE wm.worker_id = w.id ORDER BY wm.recorded_at DESC, wm.rowid DESC LIMIT 1) as gpu_memory_used_mb,
             (SELECT gpu_temperature_c FROM worker_metrics wm WHERE wm.worker_id = w.id ORDER BY wm.recorded_at DESC, wm.rowid DESC LIMIT 1) as gpu_temperature_c
      FROM compute_workers w
      LEFT JOIN tasks t ON w.current_task_id = t.id
      ORDER BY w.status = 'online' DESC, w.status = 'busy' DESC, w.last_heartbeat DESC
    `;
    const { results } = await this.db.prepare(query).all<any>();
    return (results || []).map((row: any) => this.mapPublicWorker(row));
  }

  async getComputeWorkerById(id: string): Promise<ComputeWorker | null> {
    const row = await this.db
      .prepare(`
        SELECT ${PUBLIC_WORKER_COLUMNS},
               t.title as current_task_title,
               (SELECT gpu_utilization_percent FROM worker_metrics wm WHERE wm.worker_id = w.id ORDER BY wm.recorded_at DESC, wm.rowid DESC LIMIT 1) as gpu_utilization_percent,
               (SELECT gpu_memory_used_mb FROM worker_metrics wm WHERE wm.worker_id = w.id ORDER BY wm.recorded_at DESC, wm.rowid DESC LIMIT 1) as gpu_memory_used_mb,
               (SELECT gpu_temperature_c FROM worker_metrics wm WHERE wm.worker_id = w.id ORDER BY wm.recorded_at DESC, wm.rowid DESC LIMIT 1) as gpu_temperature_c
        FROM compute_workers w
        LEFT JOIN tasks t ON w.current_task_id = t.id
        WHERE w.id = ?
      `)
      .bind(id)
      .first<any>();
    return row ? this.mapPublicWorker(row) : null;
  }

  async registerComputeWorker(
    workerInput: Omit<ComputeWorker, 'created_at' | 'updated_at'>,
    pepper?: string
  ): Promise<{ worker: ComputeWorker; rawApiKey: string }> {
    const keyData = await generateWorkerApiKey(pepper);
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_TTL_MS).toISOString();
    const capabilitiesJson = JSON.stringify(workerInput.capabilities || ['text', 'code']);

    await this.db
      .prepare(`
        INSERT INTO compute_workers (
          id, name, provider, gpu_model, gpu_count, vram_mb, system_ram_mb,
          status, api_key_hash, key_prefix, key_fingerprint, is_revoked, capabilities,
          contributor_name, contributor_email,
          last_heartbeat, lease_expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        workerInput.id,
        workerInput.name,
        workerInput.provider,
        workerInput.gpu_model,
        workerInput.gpu_count,
        workerInput.vram_mb,
        workerInput.system_ram_mb,
        workerInput.status || 'online',
        keyData.storedHash,
        keyData.keyPrefix,
        keyData.keyFingerprint,
        capabilitiesJson,
        workerInput.contributor_name || 'Anonymous Contributor',
        workerInput.contributor_email || null,
        now,
        leaseExpiresAt,
        now,
        now
      )
      .run();

    const sanitized = await this.getComputeWorkerById(workerInput.id);
    if (!sanitized) {
      throw new Error('Failed to persist registered worker in D1');
    }

    return {
      worker: sanitized,
      rawApiKey: keyData.rawKey,
    };
  }

  /**
   * Authenticate a worker request using its Bearer API key and constant-time hash comparison.
   * Enforces revocation status and strict worker_id isolation.
   */
  async authenticateWorker(
    rawKey: string,
    declaredWorkerId?: string,
    pepper?: string
  ): Promise<WorkerAuthOutcome> {
    if (!rawKey) {
      return { authenticated: false, status: 401, error: 'Missing worker API key' };
    }

    const fingerprint = await computeKeyFingerprint(rawKey, pepper);

    let row = await this.db
      .prepare('SELECT * FROM compute_workers WHERE key_fingerprint = ? LIMIT 1')
      .bind(fingerprint)
      .first<any>();

    if (!row && declaredWorkerId) {
      row = await this.db
        .prepare('SELECT * FROM compute_workers WHERE id = ? AND key_fingerprint IS NULL LIMIT 1')
        .bind(declaredWorkerId)
        .first<any>();
    }

    if (!row || !row.api_key_hash) {
      // Constant-time dummy check to prevent timing side channels on unknown keys
      await verifyApiKeyHash(
        rawKey,
        'sha256$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000',
        pepper
      );
      return { authenticated: false, status: 401, error: 'Invalid worker API key' };
    }

    const valid = await verifyApiKeyHash(rawKey, row.api_key_hash, pepper);
    if (!valid) {
      return { authenticated: false, status: 401, error: 'Invalid worker API key' };
    }

    if (Number(row.is_revoked) === 1) {
      return { authenticated: false, status: 403, error: 'Worker credential has been revoked' };
    }

    if (declaredWorkerId && declaredWorkerId !== row.id) {
      return {
        authenticated: false,
        status: 403,
        error: `Cross-worker access denied: credential belongs to '${row.id}', not '${declaredWorkerId}'`,
      };
    }

    return {
      authenticated: true,
      status: 200,
      worker: this.mapPublicWorker(row),
    };
  }

  /**
   * Record and verify a single-use cryptographic nonce for replay protection.
   * Returns false if the nonce was already consumed within the replay window.
   */
  async consumeWorkerNonce(workerId: string, nonce: string, timestampMs: number): Promise<boolean> {
    const nowMs = Date.now();
    await this.db
      .prepare('DELETE FROM worker_nonces WHERE expires_at < ?')
      .bind(nowMs)
      .run();

    const expiresAt = timestampMs + REPLAY_WINDOW_MS;
    const res = await this.db
      .prepare(`
        INSERT OR IGNORE INTO worker_nonces (worker_id, nonce, timestamp_ms, expires_at)
        VALUES (?, ?, ?, ?)
      `)
      .bind(workerId, nonce, timestampMs, expiresAt)
      .run();

    if (res.meta && typeof res.meta.changes === 'number') {
      return res.meta.changes === 1;
    }
    return true;
  }

  async updateWorkerHeartbeat(workerId: string, payload: WorkerHeartbeatPayload): Promise<ComputeWorker | null> {
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_TTL_MS).toISOString();

    const existing = await this.getComputeWorkerById(workerId);
    if (!existing) return null;

    let nextStatus = existing.current_task_id ? 'busy' : 'online';
    if (payload.status === 'maintenance') {
      nextStatus = 'maintenance';
    } else if (payload.status === 'offline') {
      nextStatus = 'offline';
    }

    const deltaUptime =
      payload.uptime_seconds !== undefined && Number.isFinite(Number(payload.uptime_seconds))
        ? Math.max(0, Math.floor(Number(payload.uptime_seconds)))
        : 15;

    await this.db
      .prepare(`
        UPDATE compute_workers
        SET 
          status = ?,
          last_heartbeat = ?,
          lease_expires_at = ?,
          shutdown_at = CASE WHEN ? = 'offline' THEN ? ELSE NULL END,
          uptime_seconds = COALESCE(uptime_seconds, 0) + ?,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(
        nextStatus,
        now,
        nextStatus === 'offline' ? null : leaseExpiresAt,
        nextStatus,
        now,
        deltaUptime,
        now,
        workerId
      )
      .run();

    // Refresh execution lease on any active task owned by this worker
    if (existing.current_task_id && nextStatus !== 'offline') {
      await this.db
        .prepare(`
          UPDATE tasks
          SET lease_expires_at = ?, updated_at = ?
          WHERE id = ?
            AND claimed_by_worker = ?
            AND status IN ('assigned', 'downloading', 'loading_model', 'running', 'uploading')
        `)
        .bind(leaseExpiresAt, now, existing.current_task_id, workerId)
        .run();
    }

    if (payload.gpu_utilization_percent !== undefined) {
      const metricId = generateSecureId('met');
      await this.db
        .prepare(`
          INSERT INTO worker_metrics (id, worker_id, gpu_utilization_percent, gpu_memory_used_mb, gpu_temperature_c, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .bind(
          metricId,
          workerId,
          Number(payload.gpu_utilization_percent) || 0,
          Number(payload.gpu_memory_used_mb) || 0,
          Number(payload.gpu_temperature_c) || 0,
          now
        )
        .run();
    }

    return this.getComputeWorkerById(workerId);
  }

  /**
   * Graceful worker shutdown: marks worker offline and releases any active claimed task back to 'queued'.
   */
  async shutdownWorker(
    workerId: string,
    uptimeSeconds?: number
  ): Promise<{ ok: boolean; status: number; releasedTaskId?: string; error?: string }> {
    const existing = await this.getComputeWorkerById(workerId);
    if (!existing) {
      return { ok: false, status: 404, error: 'Worker not found' };
    }
    if (existing.status === 'offline') {
      return { ok: false, status: 409, error: 'Worker is already offline' };
    }

    const now = new Date().toISOString();
    let releasedTaskId: string | undefined;

    if (existing.current_task_id) {
      const releaseRes = await this.db
        .prepare(`
          UPDATE tasks
          SET status = 'queued',
              claimed_by_worker = NULL,
              lease_expires_at = NULL,
              progress_percent = 0,
              updated_at = ?
          WHERE id = ?
            AND claimed_by_worker = ?
            AND status IN ('assigned', 'downloading', 'loading_model', 'running', 'uploading')
        `)
        .bind(now, existing.current_task_id, workerId)
        .run();

      if (releaseRes.meta && releaseRes.meta.changes === 1) {
        releasedTaskId = existing.current_task_id;
      }
    }

    await this.db
      .prepare(`
        UPDATE compute_workers
        SET status = 'offline',
            current_task_id = NULL,
            lease_expires_at = NULL,
            shutdown_at = ?,
            uptime_seconds = COALESCE(uptime_seconds, 0) + ?,
            updated_at = ?
        WHERE id = ?
      `)
      .bind(
        now,
        uptimeSeconds !== undefined && Number.isFinite(Number(uptimeSeconds))
          ? Math.max(0, Math.floor(Number(uptimeSeconds)))
          : 0,
        now,
        workerId
      )
      .run();

    return { ok: true, status: 200, releasedTaskId };
  }

  /**
   * Revoke a worker credential permanently and release any claimed task.
   */
  async revokeWorker(workerId: string): Promise<{ ok: boolean; status: number; error?: string }> {
    const existing = await this.getComputeWorkerById(workerId);
    if (!existing) {
      return { ok: false, status: 404, error: 'Worker not found' };
    }

    const now = new Date().toISOString();
    if (existing.current_task_id) {
      await this.db
        .prepare(`
          UPDATE tasks
          SET status = 'queued',
              claimed_by_worker = NULL,
              lease_expires_at = NULL,
              progress_percent = 0,
              updated_at = ?
          WHERE id = ?
            AND claimed_by_worker = ?
            AND status IN ('assigned', 'downloading', 'loading_model', 'running', 'uploading')
        `)
        .bind(now, existing.current_task_id, workerId)
        .run();
    }

    await this.db
      .prepare(`
        UPDATE compute_workers
        SET is_revoked = 1,
            status = 'offline',
            key_fingerprint = NULL,
            current_task_id = NULL,
            lease_expires_at = NULL,
            shutdown_at = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .bind(now, now, workerId)
      .run();

    return { ok: true, status: 200 };
  }

  /**
   * Atomic task claiming for authenticated distributed worker.
   * Enforces worker readiness, VRAM constraints, and atomic single-worker assignment with lease TTL.
   */
  async claimTaskForWorker(workerId: string): Promise<ClaimTaskOutcome> {
    await this.reapExpiredLeases();

    const worker = await this.getComputeWorkerById(workerId);
    if (!worker) {
      return { status: 404, task: null, error: 'Worker not found' };
    }
    if (worker.status === 'offline') {
      return {
        status: 403,
        task: null,
        error: 'Worker is offline; send an authenticated online heartbeat before claiming tasks',
      };
    }
    if (worker.status === 'maintenance') {
      return {
        status: 403,
        task: null,
        error: 'Worker is in maintenance status and cannot claim tasks',
      };
    }
    if (worker.current_task_id) {
      const heldTask = await this.getTaskWithSteps(worker.current_task_id);
      if (
        heldTask &&
        heldTask.claimed_by_worker === workerId &&
        (ACTIVE_WORKER_TASK_STATUSES as readonly string[]).includes(heldTask.status)
      ) {
        return {
          status: 409,
          task: null,
          error: `Worker already holds active task '${worker.current_task_id}'`,
        };
      }
    }

    const { results: candidates } = await this.db
      .prepare(`
        SELECT t.*, a.name as agent_name 
        FROM tasks t
        LEFT JOIN agents a ON t.agent_id = a.id
        WHERE t.status IN ('pending', 'queued')
          AND (t.claimed_by_worker IS NULL OR t.claimed_by_worker = '')
        ORDER BY 
          CASE t.priority
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            ELSE 4
          END ASC,
          t.created_at ASC
        LIMIT 10
      `)
      .all<any>();

    if (!candidates || candidates.length === 0) {
      return { status: 200, task: null };
    }

    for (const candidate of candidates) {
      let inputPayload: Record<string, any> = {};
      try {
        inputPayload = JSON.parse(candidate.input_payload || '{}');
      } catch {
        inputPayload = {};
      }

      if (inputPayload.require_gpu === true && worker.gpu_count <= 0) {
        continue;
      }
      const minVram = Number(inputPayload.min_vram_mb || 0);
      if (Number.isFinite(minVram) && minVram > 0 && worker.vram_mb < minVram) {
        continue;
      }

      const now = new Date().toISOString();
      const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_TTL_MS).toISOString();

      const updateResult = await this.db
        .prepare(`
          UPDATE tasks 
          SET status = 'assigned',
              claimed_by_worker = ?,
              started_at = COALESCE(started_at, ?),
              lease_expires_at = ?,
              attempt_count = COALESCE(attempt_count, 0) + 1,
              updated_at = ?
          WHERE id = ?
            AND status IN ('pending', 'queued')
            AND (claimed_by_worker IS NULL OR claimed_by_worker = '')
        `)
        .bind(workerId, now, leaseExpiresAt, now, candidate.id)
        .run();

      if (updateResult.meta && updateResult.meta.changes === 0) {
        // Another worker claimed this task concurrently; try next candidate
        continue;
      }

      await this.db
        .prepare(`
          UPDATE compute_workers
          SET status = 'busy',
              current_task_id = ?,
              lease_expires_at = ?,
              updated_at = ?
          WHERE id = ?
        `)
        .bind(candidate.id, leaseExpiresAt, now, workerId)
        .run();

      const fullTask = await this.getTaskWithSteps(candidate.id);
      return { status: 200, task: fullTask };
    }

    return { status: 200, task: null };
  }

  /**
   * Verify that the authenticated worker currently owns the task in an active execution state.
   */
  async verifyWorkerTaskOwnership(
    taskId: string,
    workerId: string
  ): Promise<{ ok: boolean; status: number; error?: string; task?: Task }> {
    const task = await this.getTaskWithSteps(taskId);
    if (!task) {
      return { ok: false, status: 404, error: 'Task not found' };
    }
    if (task.claimed_by_worker !== workerId) {
      return {
        ok: false,
        status: 403,
        error: `Unauthorized: task '${taskId}' is not assigned to worker '${workerId}'`,
      };
    }
    if (!(ACTIVE_WORKER_TASK_STATUSES as readonly string[]).includes(task.status)) {
      return {
        ok: false,
        status: 409,
        error: `Task '${taskId}' is in status '${task.status}' and cannot be modified by worker`,
      };
    }
    return { ok: true, status: 200, task };
  }

  async updateTaskStepProgress(
    taskId: string,
    workerId: string,
    rawStepNumber: unknown,
    stepName: string,
    rawStatus: unknown,
    logs?: string,
    progressPercent?: unknown
  ): Promise<TaskMutationOutcome> {
    const ownership = await this.verifyWorkerTaskOwnership(taskId, workerId);
    if (!ownership.ok || !ownership.task) {
      return { ok: false, status: ownership.status, error: ownership.error };
    }

    const stepNumResult = normalizeStepNumber(rawStepNumber);
    if (!stepNumResult.ok) {
      return { ok: false, status: 400, error: stepNumResult.error };
    }

    const statusResolution = normalizeWorkerProgressStatus(rawStatus);
    if (!statusResolution.ok) {
      return { ok: false, status: 400, error: statusResolution.error };
    }

    let clampedProgress: number | undefined;
    if (progressPercent !== undefined && progressPercent !== null) {
      if (
        typeof progressPercent !== 'number' ||
        !Number.isFinite(progressPercent) ||
        progressPercent < 0 ||
        progressPercent > 100
      ) {
        return {
          ok: false,
          status: 400,
          error: 'Invalid progress_percent: expected a number between 0 and 100',
        };
      }
      clampedProgress = Math.max(0, Math.min(99, Math.round(progressPercent)));
    }

    const stepNumber = stepNumResult.stepNumber;
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_TTL_MS).toISOString();
    const stepId = `stp_${taskId}_${stepNumber}`;

    await this.db
      .prepare(`
        INSERT INTO task_steps (id, task_id, step_number, step_name, status, logs, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET 
          status = excluded.status,
          logs = COALESCE(excluded.logs, task_steps.logs),
          step_name = excluded.step_name
      `)
      .bind(stepId, taskId, stepNumber, stepName, statusResolution.stepStatus, logs ?? null, now)
      .run();

    const buildTaskUpdateQuery = (lifecycleStatus?: string) => {
      const updates: string[] = ['updated_at = ?', 'lease_expires_at = ?'];
      const values: any[] = [now, leaseExpiresAt];
      if (clampedProgress !== undefined) {
        updates.push('progress_percent = ?');
        values.push(clampedProgress);
      }
      if (lifecycleStatus !== undefined) {
        updates.push('status = ?');
        values.push(lifecycleStatus);
      }
      values.push(taskId, workerId);
      return {
        sql: `
          UPDATE tasks
          SET ${updates.join(', ')}
          WHERE id = ?
            AND claimed_by_worker = ?
            AND status IN ('assigned', 'downloading', 'loading_model', 'running', 'uploading')
        `,
        values,
      };
    };

    let appliedTaskStatus = statusResolution.taskLifecycleStatus || ownership.task.status;
    const primaryUpdate = buildTaskUpdateQuery(statusResolution.taskLifecycleStatus);

    let updateRes: { success: boolean; meta?: any };
    try {
      updateRes = await this.db
        .prepare(primaryUpdate.sql)
        .bind(...primaryUpdate.values)
        .run();
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (
        msg.includes('CHECK constraint failed') &&
        statusResolution.taskLifecycleStatus &&
        statusResolution.taskLifecycleStatus !== 'running'
      ) {
        // Fallback when running against a pre-0003 tasks table whose CHECK constraint only allows 'running'
        const fallbackUpdate = buildTaskUpdateQuery('running');
        appliedTaskStatus = 'running';
        updateRes = await this.db
          .prepare(fallbackUpdate.sql)
          .bind(...fallbackUpdate.values)
          .run();
      } else {
        throw err;
      }
    }

    if (updateRes.meta && updateRes.meta.changes === 0) {
      return { ok: false, status: 409, error: 'Task state changed concurrently' };
    }

    await this.db
      .prepare('UPDATE compute_workers SET lease_expires_at = ?, last_heartbeat = ?, updated_at = ? WHERE id = ?')
      .bind(leaseExpiresAt, now, now, workerId)
      .run();

    return {
      ok: true,
      status: 200,
      stepStatus: statusResolution.stepStatus,
      taskStatus: appliedTaskStatus,
    };
  }

  async completeTaskFromWorker(
    taskId: string,
    workerId: string,
    resultPayload: Record<string, unknown>
  ): Promise<TaskMutationOutcome> {
    const ownership = await this.verifyWorkerTaskOwnership(taskId, workerId);
    if (!ownership.ok) {
      return { ok: false, status: ownership.status, error: ownership.error };
    }

    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_TTL_MS).toISOString();

    const updateRes = await this.db
      .prepare(`
        UPDATE tasks 
        SET status = 'completed',
            progress_percent = 100,
            result_payload = ?,
            lease_expires_at = NULL,
            completed_at = ?,
            updated_at = ?
        WHERE id = ?
          AND claimed_by_worker = ?
          AND status IN ('assigned', 'downloading', 'loading_model', 'running', 'uploading')
      `)
      .bind(JSON.stringify(resultPayload), now, now, taskId, workerId)
      .run();

    if (updateRes.meta && updateRes.meta.changes === 0) {
      return {
        ok: false,
        status: 409,
        error: 'Task already finalized or reassigned; duplicate result submission rejected',
      };
    }

    await this.db
      .prepare(`
        UPDATE compute_workers 
        SET status = 'online',
            current_task_id = NULL,
            total_tasks_completed = COALESCE(total_tasks_completed, 0) + 1,
            lease_expires_at = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .bind(leaseExpiresAt, now, workerId)
      .run();

    return { ok: true, status: 200 };
  }

  async failTaskFromWorker(
    taskId: string,
    workerId: string,
    errorMessage: string
  ): Promise<TaskMutationOutcome> {
    const ownership = await this.verifyWorkerTaskOwnership(taskId, workerId);
    if (!ownership.ok) {
      return { ok: false, status: ownership.status, error: ownership.error };
    }

    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_TTL_MS).toISOString();

    const updateRes = await this.db
      .prepare(`
        UPDATE tasks 
        SET status = 'failed',
            error_message = ?,
            lease_expires_at = NULL,
            completed_at = ?,
            updated_at = ?
        WHERE id = ?
          AND claimed_by_worker = ?
          AND status IN ('assigned', 'downloading', 'loading_model', 'running', 'uploading')
      `)
      .bind(errorMessage, now, now, taskId, workerId)
      .run();

    if (updateRes.meta && updateRes.meta.changes === 0) {
      return {
        ok: false,
        status: 409,
        error: 'Task already finalized or reassigned',
      };
    }

    await this.db
      .prepare(`
        UPDATE compute_workers
        SET status = 'online',
            current_task_id = NULL,
            lease_expires_at = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .bind(leaseExpiresAt, now, workerId)
      .run();

    return { ok: true, status: 200 };
  }

  // --- MODEL REGISTRY ---

  async getModels(category?: string): Promise<ModelDefinition[]> {
    let query = 'SELECT * FROM model_registry WHERE is_enabled = 1';
    const params: any[] = [];
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    query += ' ORDER BY category ASC, min_vram_mb ASC';

    const { results } = await this.db.prepare(query).bind(...params).all<any>();
    return (results || []).map((row: any) => ({
      ...row,
      supported_precisions: JSON.parse(row.supported_precisions || '["fp16"]'),
      execution_constraints: JSON.parse(row.execution_constraints || '{}'),
      is_enabled: Boolean(row.is_enabled),
    }));
  }

  // --- USER ACCOUNTS & WORKSPACES ---

  async getUserByEmail(email: string): Promise<UserAccount | null> {
    const normalized = email.trim().toLowerCase();
    const row = await this.db
      .prepare('SELECT * FROM users_v4 WHERE email = ?')
      .bind(normalized)
      .first<any>();
    if (!row) {
      // Fallback check in users if migration pending
      const legacyRow = await this.db
        .prepare('SELECT * FROM users WHERE email = ?')
        .bind(normalized)
        .first<any>()
        .catch(() => null);
      if (!legacyRow) return null;
      return {
        id: legacyRow.id,
        email: legacyRow.email,
        name: legacyRow.name,
        role: legacyRow.role || 'member',
        status: 'active',
        avatar_url: legacyRow.avatar_url,
        created_at: legacyRow.created_at,
        updated_at: legacyRow.updated_at,
      };
    }
    return row as UserAccount;
  }

  async getUserById(id: string): Promise<UserAccount | null> {
    const row = await this.db
      .prepare('SELECT * FROM users_v4 WHERE id = ?')
      .bind(id)
      .first<any>();
    if (!row) {
      const legacyRow = await this.db
        .prepare('SELECT * FROM users WHERE id = ?')
        .bind(id)
        .first<any>()
        .catch(() => null);
      if (!legacyRow) return null;
      return {
        id: legacyRow.id,
        email: legacyRow.email,
        name: legacyRow.name,
        role: legacyRow.role || 'member',
        status: 'active',
        avatar_url: legacyRow.avatar_url,
        created_at: legacyRow.created_at,
        updated_at: legacyRow.updated_at,
      };
    }
    return row as UserAccount;
  }

  async createUser(user: {
    id: string;
    email: string;
    name: string;
    role?: 'admin' | 'operator' | 'member' | 'viewer';
    status?: 'pending_verification' | 'active' | 'suspended';
    avatar_url?: string;
  }): Promise<UserAccount> {
    const now = new Date().toISOString();
    const normalizedEmail = user.email.trim().toLowerCase();
    const status = user.status || 'active';
    const role = user.role || 'member';

    await this.db
      .prepare(`
        INSERT INTO users_v4 (id, email, name, role, status, avatar_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(user.id, normalizedEmail, user.name, role, status, user.avatar_url || null, now, now)
      .run()
      .catch(async () => {
        // Compatibility write to legacy users table
        await this.db
          .prepare(`
            INSERT INTO users (id, email, name, role, avatar_url, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(user.id, normalizedEmail, user.name, role, user.avatar_url || null, now, now)
          .run();
      });

    return {
      id: user.id,
      email: normalizedEmail,
      name: user.name,
      role,
      status,
      avatar_url: user.avatar_url,
      created_at: now,
      updated_at: now,
    };
  }

  async createOrganization(org: Organization): Promise<Organization> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT INTO organizations (id, name, slug, owner_id, is_personal, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(org.id, org.name, org.slug, org.owner_id, org.is_personal ? 1 : 0, now, now)
      .run();

    await this.addOrganizationMember(org.id, org.owner_id, 'owner');
    return org;
  }

  async getOrganizationById(id: string): Promise<Organization | null> {
    const row = await this.db
      .prepare('SELECT * FROM organizations WHERE id = ?')
      .bind(id)
      .first<any>();
    if (!row) return null;
    return {
      ...row,
      is_personal: Boolean(row.is_personal),
    };
  }

  async getOrganizationsForUser(userId: string): Promise<Organization[]> {
    const res = await this.db
      .prepare(`
        SELECT o.* FROM organizations o
        JOIN organization_memberships m ON o.id = m.organization_id
        WHERE m.user_id = ?
        ORDER BY o.is_personal DESC, o.created_at ASC
      `)
      .bind(userId)
      .all<any>();
    return (res.results || []).map((r: any) => ({
      ...r,
      is_personal: Boolean(r.is_personal),
    }));
  }

  async addOrganizationMember(
    orgId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member' = 'member'
  ): Promise<void> {
    const id = generateSecureId('mem');
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT OR REPLACE INTO organization_memberships (id, organization_id, user_id, role, joined_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(id, orgId, userId, role, now)
      .run();
  }

  // --- PASSKEYS (WEBAUTHN) ---

  async createPasskey(passkey: PasskeyCredential): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT INTO passkey_credentials (id, user_id, public_key, algorithm, sign_count, device_name, transports, aaguid, created_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        passkey.id,
        passkey.user_id,
        passkey.public_key,
        passkey.algorithm,
        passkey.sign_count || 0,
        passkey.device_name || 'Passkey Device',
        JSON.stringify(passkey.transports || ['internal']),
        passkey.aaguid || null,
        now,
        now
      )
      .run();
  }

  async getPasskeysForUser(userId: string): Promise<PasskeyCredential[]> {
    const res = await this.db
      .prepare('SELECT * FROM passkey_credentials WHERE user_id = ? ORDER BY created_at DESC')
      .bind(userId)
      .all<any>();
    return (res.results || []).map((r: any) => ({
      ...r,
      transports: r.transports ? JSON.parse(r.transports) : ['internal'],
    }));
  }

  async getPasskeyById(id: string): Promise<PasskeyCredential | null> {
    const row = await this.db
      .prepare('SELECT * FROM passkey_credentials WHERE id = ?')
      .bind(id)
      .first<any>();
    if (!row) return null;
    return {
      ...row,
      transports: row.transports ? JSON.parse(row.transports) : ['internal'],
    };
  }

  async deletePasskey(id: string, userId: string): Promise<boolean> {
    const res = await this.db
      .prepare('DELETE FROM passkey_credentials WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();
    return Boolean(res.meta && res.meta.changes > 0);
  }

  async updatePasskeyUsage(id: string, signCount: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE passkey_credentials SET sign_count = ?, last_used_at = ? WHERE id = ?')
      .bind(signCount, now, id)
      .run();
  }

  // --- TOTP CREDENTIALS ---

  async getTotpForUser(userId: string): Promise<TotpCredential | null> {
    const row = await this.db
      .prepare('SELECT * FROM totp_credentials WHERE user_id = ? AND is_active = 1')
      .bind(userId)
      .first<any>();
    if (!row) return null;
    return {
      ...row,
      is_active: Boolean(row.is_active),
    };
  }

  async saveTotpCredential(totp: TotpCredential): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT OR REPLACE INTO totp_credentials (id, user_id, encrypted_secret, secret_iv, label, is_active, last_verified_counter, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        totp.id,
        totp.user_id,
        totp.encrypted_secret,
        totp.secret_iv,
        totp.label,
        totp.is_active ? 1 : 0,
        totp.last_verified_counter || 0,
        now,
        now
      )
      .run();
  }

  async updateTotpCounter(userId: string, counter: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE totp_credentials SET last_verified_counter = ?, updated_at = ? WHERE user_id = ?')
      .bind(counter, now, userId)
      .run();
  }

  async deleteTotp(userId: string): Promise<void> {
    await this.db.prepare('DELETE FROM totp_credentials WHERE user_id = ?').bind(userId).run();
  }

  // --- AUTH CHALLENGES (MAX 4 ATTEMPTS & SINGLE-USE) ---

  async createAuthChallenge(challenge: AuthChallenge): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO auth_challenges (id, challenge, purpose, user_id, email, origin, rp_id, failed_attempts, is_used, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        challenge.id,
        challenge.challenge,
        challenge.purpose,
        challenge.user_id || null,
        challenge.email || null,
        challenge.origin,
        challenge.rp_id,
        challenge.failed_attempts || 0,
        challenge.is_used ? 1 : 0,
        challenge.expires_at,
        challenge.created_at
      )
      .run();
  }

  async getAuthChallenge(id: string): Promise<AuthChallenge | null> {
    const row = await this.db
      .prepare('SELECT * FROM auth_challenges WHERE id = ?')
      .bind(id)
      .first<any>();
    if (!row) return null;
    return {
      ...row,
      is_used: Boolean(row.is_used),
    };
  }

  async incrementChallengeFailedAttempts(id: string): Promise<number> {
    await this.db
      .prepare('UPDATE auth_challenges SET failed_attempts = failed_attempts + 1 WHERE id = ?')
      .bind(id)
      .run();
    const updated = await this.getAuthChallenge(id);
    return updated ? updated.failed_attempts : 4;
  }

  async markChallengeUsed(id: string): Promise<void> {
    await this.db.prepare('UPDATE auth_challenges SET is_used = 1 WHERE id = ?').bind(id).run();
  }

  // --- AUTH SESSIONS ---

  async createAuthSession(session: AuthSession): Promise<void> {
    await this.db
      .prepare(`
        INSERT INTO auth_sessions (id, user_id, organization_id, ip_address, user_agent, is_revoked, last_active_at, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        session.id,
        session.user_id,
        session.organization_id || null,
        session.ip_address || null,
        session.user_agent || null,
        session.is_revoked ? 1 : 0,
        session.last_active_at,
        session.expires_at,
        session.created_at
      )
      .run();
  }

  async getAuthSession(token: string): Promise<AuthSession | null> {
    const row = await this.db
      .prepare('SELECT * FROM auth_sessions WHERE id = ? AND is_revoked = 0')
      .bind(token)
      .first<any>();
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return null;
    }
    return {
      ...row,
      is_revoked: Boolean(row.is_revoked),
    };
  }

  async touchAuthSession(token: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE auth_sessions SET last_active_at = ? WHERE id = ?')
      .bind(now, token)
      .run();
  }

  async revokeAuthSession(token: string): Promise<void> {
    await this.db.prepare('UPDATE auth_sessions SET is_revoked = 1 WHERE id = ?').bind(token).run();
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.db.prepare('UPDATE auth_sessions SET is_revoked = 1 WHERE user_id = ?').bind(userId).run();
  }

  // --- WORKER OWNERSHIP & CLAIMING ---

  async getWorkerOwnership(workerId: string): Promise<WorkerOwnership | null> {
    const row = await this.db
      .prepare(`
        SELECT wo.*, u.name as owner_name, o.name as organization_name
        FROM worker_ownership wo
        JOIN users_v4 u ON wo.owner_user_id = u.id
        LEFT JOIN organizations o ON wo.organization_id = o.id
        WHERE wo.worker_id = ?
      `)
      .bind(workerId)
      .first<any>();
    if (!row) return null;
    return row as WorkerOwnership;
  }

  async setWorkerOwnership(ownership: WorkerOwnership): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT OR REPLACE INTO worker_ownership (worker_id, owner_user_id, organization_id, ownership_type, claimed_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(
        ownership.worker_id,
        ownership.owner_user_id,
        ownership.organization_id || null,
        ownership.ownership_type || 'personal',
        now
      )
      .run();

    // Also update compute_workers contributor field to owner's name
    const user = await this.getUserById(ownership.owner_user_id);
    if (user) {
      await this.db
        .prepare('UPDATE compute_workers SET contributor_name = ?, contributor_email = ? WHERE id = ?')
        .bind(`Worker Owner: ${user.name}`, user.email, ownership.worker_id)
        .run();
    }
  }

  async getOwnedWorkers(userId: string): Promise<WorkerOwnership[]> {
    const res = await this.db
      .prepare(`
        SELECT wo.*, u.name as owner_name, o.name as organization_name
        FROM worker_ownership wo
        JOIN users_v4 u ON wo.owner_user_id = u.id
        LEFT JOIN organizations o ON wo.organization_id = o.id
        WHERE wo.owner_user_id = ?
      `)
      .bind(userId)
      .all<any>();
    return (res.results || []) as WorkerOwnership[];
  }

  // --- COMPUTE SESSIONS (KAGGLE NOTEBOOKS) ---

  async createComputeSession(session: ComputeSession): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT INTO compute_sessions (
          id, provider, user_id, organization_id, worker_id, notebook_slug,
          kernel_session_id, status, gpu_type, started_at, stopped_at,
          last_poll_at, logs_snippet, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        session.id,
        session.provider,
        session.user_id,
        session.organization_id || null,
        session.worker_id || null,
        session.notebook_slug,
        session.kernel_session_id || null,
        session.status,
        session.gpu_type || '2x Tesla T4',
        session.started_at || null,
        session.stopped_at || null,
        session.last_poll_at || null,
        session.logs_snippet || null,
        session.error_message || null,
        now,
        now
      )
      .run();
  }

  async getComputeSessionById(id: string): Promise<ComputeSession | null> {
    const row = await this.db
      .prepare('SELECT * FROM compute_sessions WHERE id = ?')
      .bind(id)
      .first<any>();
    if (!row) return null;
    return row as ComputeSession;
  }

  async getComputeSessions(filter?: { userId?: string; organizationId?: string }): Promise<ComputeSession[]> {
    let query = 'SELECT * FROM compute_sessions';
    const params: any[] = [];
    if (filter?.userId) {
      query += ' WHERE user_id = ?';
      params.push(filter.userId);
    } else if (filter?.organizationId) {
      query += ' WHERE organization_id = ?';
      params.push(filter.organizationId);
    }
    query += ' ORDER BY created_at DESC';

    const res = await this.db.prepare(query).bind(...params).all<any>();
    return (res.results || []) as ComputeSession[];
  }

  async updateComputeSession(session: Partial<ComputeSession> & { id: string }): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.getComputeSessionById(session.id);
    if (!existing) return;

    await this.db
      .prepare(`
        UPDATE compute_sessions
        SET status = ?,
            kernel_session_id = ?,
            worker_id = ?,
            started_at = ?,
            stopped_at = ?,
            last_poll_at = ?,
            logs_snippet = ?,
            error_message = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .bind(
        session.status || existing.status,
        session.kernel_session_id !== undefined ? session.kernel_session_id : existing.kernel_session_id,
        session.worker_id !== undefined ? session.worker_id : existing.worker_id,
        session.started_at !== undefined ? session.started_at : existing.started_at,
        session.stopped_at !== undefined ? session.stopped_at : existing.stopped_at,
        session.last_poll_at || now,
        session.logs_snippet !== undefined ? session.logs_snippet : existing.logs_snippet,
        session.error_message !== undefined ? session.error_message : existing.error_message,
        now,
        session.id
      )
      .run();
  }

  // --- KAGGLE CREDENTIALS STORAGE ---

  async saveKaggleCredentials(creds: KaggleCredentials): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT OR REPLACE INTO kaggle_credentials (id, user_id, organization_id, kaggle_username, encrypted_key, key_iv, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        creds.id,
        creds.user_id,
        creds.organization_id || null,
        creds.kaggle_username,
        creds.encrypted_key,
        creds.key_iv,
        now,
        now
      )
      .run();
  }

  async getKaggleCredentials(userId: string): Promise<KaggleCredentials | null> {
    const row = await this.db
      .prepare('SELECT * FROM kaggle_credentials WHERE user_id = ?')
      .bind(userId)
      .first<any>();
    if (!row) return null;
    return row as KaggleCredentials;
  }

  async deleteKaggleCredentials(userId: string): Promise<void> {
    await this.db.prepare('DELETE FROM kaggle_credentials WHERE user_id = ?').bind(userId).run();
  }

  // --- SECURITY AUDIT LOGGING ---

  async logSecurityEvent(event: SecurityAuditEvent): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`
        INSERT INTO security_audit_events (id, user_id, event_type, severity, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        event.id,
        event.user_id || null,
        event.event_type,
        event.severity || 'info',
        JSON.stringify(event.details || {}),
        event.ip_address || null,
        now
      )
      .run()
      .catch(() => {});
  }
}

