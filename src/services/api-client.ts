import { 
  Agent, 
  Task, 
  ApprovalRequest, 
  AttachedFile, 
  ActivityLog, 
  ComputeWorker, 
  ModelDefinition,
  Conversation,
  Message,
  UserAccount,
  Organization,
  PasskeyItem,
  ComputeSession,
  WorkerOwnershipInfo,
  KaggleCredentialsStatus
} from '../types';

class ApiClient {
  private baseUrl = '';
  private sessionToken: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.sessionToken = localStorage.getItem('aetheros_session_token');
    }
  }

  setSessionToken(token: string | null) {
    this.sessionToken = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('aetheros_session_token', token);
      } else {
        localStorage.removeItem('aetheros_session_token');
      }
    }
  }

  getSessionToken(): string | null {
    return this.sessionToken;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.sessionToken && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${this.sessionToken}`;
    }

    try {
      const res = await fetch(url, {
        ...options,
        headers,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown server error');
        let parsedMessage = errorText;
        try {
          const json = JSON.parse(errorText);
          parsedMessage = json.error || json.message || errorText;
        } catch {
          // ignore
        }
        throw new Error(parsedMessage);
      }

      return (await res.json()) as T;
    } catch (err) {
      console.warn(`[ApiClient] Request failed for ${endpoint}:`, err);
      throw err;
    }
  }

  // --- AGENTS ---
  async getAgents(): Promise<Agent[]> {
    const data = await this.request<{ success: boolean; agents: Agent[] }>('/api/agents');
    return data.agents || [];
  }

  async createAgent(agent: Agent): Promise<Agent> {
    const data = await this.request<{ success: boolean; agent: Agent }>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(agent),
    });
    return data.agent;
  }

  async updateAgent(agent: Agent): Promise<void> {
    await this.request<{ success: boolean }>(`/api/agents/${agent.id}`, {
      method: 'PUT',
      body: JSON.stringify(agent),
    });
  }

  async deleteAgent(id: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/agents/${id}`, {
      method: 'DELETE',
    });
  }

  // --- TASKS ---
  async getTasks(status?: string, agentId?: string): Promise<Task[]> {
    const params = new URLSearchParams();
    if (status && status !== 'all') params.append('status', status);
    if (agentId) params.append('agent_id', agentId);
    const query = params.toString() ? `?${params.toString()}` : '';

    const data = await this.request<{ success: boolean; tasks: Task[] }>(`/api/tasks${query}`);
    return data.tasks || [];
  }

  async getTask(id: string): Promise<Task | null> {
    const data = await this.request<{ success: boolean; task: Task }>(`/api/tasks/${id}`);
    return data.task || null;
  }

  async submitTask(params: {
    agentId: string;
    title: string;
    description: string;
    inputPayload: Record<string, unknown>;
    priority: 'low' | 'medium' | 'high' | 'critical';
    idempotencyKey?: string;
    workspaceId?: string;
  }): Promise<Task> {
    const data = await this.request<{ success: boolean; task: Task }>('/api/tasks', {
      method: 'POST',
      headers: params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : undefined,
      body: JSON.stringify({
        agent_id: params.agentId,
        title: params.title,
        description: params.description,
        input_payload: params.inputPayload,
        priority: params.priority,
        idempotency_key: params.idempotencyKey,
        workspace_id: params.workspaceId,
      }),
    });
    return data.task;
  }

  async cancelTask(id: string, reason?: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/tasks/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async togglePauseTask(id: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/tasks/${id}/pause`, {
      method: 'POST',
    });
  }

  // --- APPROVALS ---
  async getApprovals(status?: string): Promise<ApprovalRequest[]> {
    const query = status && status !== 'all' ? `?status=${status}` : '';
    const data = await this.request<{ success: boolean; approvals: ApprovalRequest[] }>(`/api/approvals${query}`);
    return data.approvals || [];
  }

  async decideApproval(id: string, decision: 'approved' | 'rejected', comment?: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/approvals/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment }),
    });
  }

  // --- FILES (R2 STORAGE) ---
  async getFiles(taskId?: string): Promise<AttachedFile[]> {
    const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : '';
    const data = await this.request<{ success: boolean; files: any[] }>(`/api/files${query}`);
    return (data.files || []).map(f => ({
      id: f.key,
      r2_key: f.key,
      filename: f.key.split('/').pop() || f.key,
      size: `${Math.round((f.size || 0) / 1024)} KB`,
      size_bytes: f.size || 0,
      mime_type: f.httpMetadata?.contentType || 'application/octet-stream',
      uploaded_by: 'usr_admin',
      task_id: f.task_id,
      created_at: f.uploaded || new Date().toISOString(),
      etag: f.etag,
      storage_class: f.storageClass || 'Standard',
    }));
  }

  async uploadFile(file: File, taskId?: string): Promise<AttachedFile> {
    const formData = new FormData();
    formData.append('file', file);
    if (taskId) formData.append('task_id', taskId);

    const headers: Record<string, string> = {};
    if (this.sessionToken) {
      headers['Authorization'] = `Bearer ${this.sessionToken}`;
    }

    const res = await fetch('/api/files', {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`File upload failed: ${errText}`);
    }

    const data = await res.json() as any;
    const fileObj = data.file;

    return {
      id: fileObj.key,
      r2_key: fileObj.key,
      filename: fileObj.filename || file.name,
      size: `${Math.round((fileObj.size || file.size) / 1024)} KB`,
      size_bytes: fileObj.size || file.size,
      mime_type: fileObj.content_type || file.type,
      uploaded_by: 'usr_admin',
      created_at: new Date().toISOString(),
      etag: fileObj.etag,
      storage_class: 'Standard',
      task_id: taskId,
    };
  }

  async deleteFile(key: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/files/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  }

  // --- DISTRIBUTED COMPUTE WORKERS ---
  async getWorkers(): Promise<ComputeWorker[]> {
    const data = await this.request<{ success: boolean; workers: ComputeWorker[] }>('/api/workers');
    return data.workers || [];
  }

  async registerWorker(payload: {
    name: string;
    provider: 'kaggle' | 'oracle' | 'runpod' | 'self_hosted' | 'custom';
    gpu_model: string;
    gpu_count: number;
    vram_mb: number;
    system_ram_mb: number;
    contributor_name?: string;
  }): Promise<{ worker: ComputeWorker; apiKey: string }> {
    const data = await this.request<{ success: boolean; worker: ComputeWorker; api_key: string }>('/api/workers/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return {
      worker: data.worker,
      apiKey: data.api_key,
    };
  }

  // --- MODEL REGISTRY ---
  async getModels(category?: string): Promise<ModelDefinition[]> {
    const query = category ? `?category=${category}` : '';
    const data = await this.request<{ success: boolean; models: ModelDefinition[] }>(`/api/models${query}`);
    return data.models || [];
  }

  // --- ACTIVITY LOGS & SYSTEM ---
  async getLogs(): Promise<ActivityLog[]> {
    const data = await this.request<{ success: boolean; logs: ActivityLog[] }>('/api/logs');
    return data.logs || [];
  }

  async getHealth(): Promise<{
    status: string;
    environment: string;
    timestamp: string;
    d1_connected: boolean;
    r2_connected: boolean;
    d1_status: string;
    r2_status: string;
    compute_status: string;
    inference_status: string;
    active_worker_count: number;
    total_worker_count: number;
    models_registered: number;
  }> {
    return this.request('/api/health');
  }

  async getRuntimeHeartbeat(): Promise<{
    success: boolean;
    is_online: boolean;
    provider?: string;
    error?: string;
    heartbeat: {
      node_id: string;
      name: string;
      provider: string;
      status: string;
      gpu_model: string;
      gpu_count: number;
      vram_mb: number;
      gpu_utilization_percent?: number;
      gpu_memory_used_mb?: number;
      gpu_temperature_c?: number;
      uptime_seconds?: number;
      last_heartbeat?: string;
      engine_version?: string;
    } | null;
  }> {
    return this.request('/api/runtime/heartbeat');
  }

  // --- CONVERSATIONS & CHAT ---
  async getConversations(): Promise<Conversation[]> {
    const data = await this.request<{ success: boolean; conversations: Conversation[] }>('/api/conversations');
    return data.conversations || [];
  }

  async createConversation(title?: string, agentId?: string): Promise<Conversation> {
    const data = await this.request<{ success: boolean; conversation: Conversation }>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title, agent_id: agentId }),
    });
    return data.conversation;
  }

  async getConversation(id: string): Promise<{ conversation: Conversation; messages: Message[] }> {
    return this.request<{ success: boolean; conversation: Conversation; messages: Message[] }>(`/api/conversations/${id}`);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/conversations/${id}`, {
      method: 'DELETE',
    });
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    const data = await this.request<{ success: boolean; messages: Message[] }>(`/api/conversations/${conversationId}/messages`);
    return data.messages || [];
  }

  async createMessage(conversationId: string, content: string, senderType: 'user' | 'agent' = 'user'): Promise<Message> {
    const data = await this.request<{ success: boolean; message: Message }>(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, sender_type: senderType }),
    });
    return data.message;
  }

  async sendChatMessage(params: {
    message: string;
    conversation_id?: string;
    agent_id?: string;
    model?: string;
    attachments?: string[];
  }): Promise<{
    success: boolean;
    task?: Task;
    user_message: Message;
    agent_message?: Message;
    conversation_id: string;
    active_workers?: number;
    error?: string;
  }> {
    return this.request('/api/chat', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async resetData(): Promise<void> {
    await this.request<{ success: boolean }>('/api/reset', {
      method: 'POST',
    });
  }

  // --- PASSWORDLESS IDENTITY & AUTH ---
  async register(params: {
    name: string;
    email: string;
    organization_name?: string;
    terms_accepted: boolean;
    privacy_accepted: boolean;
  }): Promise<{
    success: boolean;
    user_id: string;
    challenge_id: string;
    user: { id: string; email?: string; name?: string };
    challenge: {
      id: string;
      challenge: string;
      rpId: string;
      rp?: { id: string; name: string };
      user?: { id: string; name: string; displayName: string };
      pubKeyCredParams?: { type: string; alg: number }[];
      timeout?: number;
      authenticatorSelection?: Record<string, unknown>;
    };
    options: {
      challenge: string;
      rp: { id: string; name: string };
      user: { id: string; name: string; displayName: string };
      pubKeyCredParams: { type: string; alg: number }[];
      timeout: number;
      authenticatorSelection: Record<string, unknown>;
    };
  }> {
    const res = await this.request<any>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    const chgObj =
      res.challenge && typeof res.challenge === 'object'
        ? res.challenge
        : {
            id: res.challenge_id,
            challenge: res.options?.challenge || res.challenge || '',
            rpId: res.options?.rp?.id || res.rp_id || window.location.hostname,
            ...(res.options || {}),
          };
    return {
      ...res,
      user: res.user || { id: res.user_id, email: params.email, name: params.name },
      challenge: chgObj,
    };
  }

  async verifyWebAuthnRegister(params: {
    challenge_id: string;
    user_id?: string;
    credential_name?: string;
    credential: any;
  }): Promise<{
    success: boolean;
    session_token: string;
    user: UserAccount;
    workspace: Organization;
  }> {
    const res = await this.request<{
      success: boolean;
      session_token: string;
      user: UserAccount;
      workspace: Organization;
    }>('/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (res.session_token) {
      this.setSessionToken(res.session_token);
    }
    return res;
  }

  async enrollPasskeyChallenge(): Promise<{
    success: boolean;
    user_id: string;
    challenge_id: string;
    options: Record<string, any>;
    challenge: {
      id: string;
      challenge: string;
      rpId: string;
      user?: { id: string; name: string; displayName: string };
      timeout?: number;
    };
  }> {
    const res = await this.request<any>('/api/auth/passkeys/enroll-challenge', {
      method: 'POST',
    });
    const chgObj =
      res.challenge && typeof res.challenge === 'object'
        ? res.challenge
        : {
            id: res.challenge_id,
            challenge: res.options?.challenge || res.challenge || '',
            rpId: res.options?.rp?.id || window.location.hostname,
            user: res.options?.user,
            timeout: res.options?.timeout || 60000,
          };
    return {
      ...res,
      challenge: chgObj,
    };
  }

  async getLoginChallenge(email: string): Promise<{
    success: boolean;
    challenge_id: string;
    rp_id: string;
    has_passkeys: boolean;
    has_totp: boolean;
    allow_credentials: { id: string; type: string; transports?: string[] }[];
    challenge: {
      id: string;
      challenge: string;
      rpId: string;
      allowCredentials: { id: string; type: string; transports?: string[] }[];
      timeout: number;
    };
  }> {
    const res = await this.request<any>('/api/auth/login/challenge', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    const allowList = (res.allow_credentials || []).map((c: any) =>
      typeof c === 'string' ? { id: c, type: 'public-key' } : c
    );
    const chgObj =
      res.challenge && typeof res.challenge === 'object'
        ? res.challenge
        : {
            id: res.challenge_id,
            challenge: String(res.challenge || ''),
            rpId: res.rp_id || window.location.hostname,
            allowCredentials: allowList,
            timeout: 60000,
          };
    return {
      ...res,
      allow_credentials: allowList,
      challenge: chgObj,
    };
  }

  async loginPasskey(params: {
    challenge_id: string;
    credential_id?: string;
    clientDataJSON?: string;
    authenticatorData?: string;
    signature?: string;
    credential?: any;
  }): Promise<{
    success: boolean;
    session_token: string;
    user: UserAccount;
    workspace: Organization;
  }> {
    const payload = {
      ...params,
      credential_id: params.credential_id || params.credential?.id,
      clientDataJSON:
        params.clientDataJSON ||
        params.credential?.response?.clientDataJSON ||
        params.credential?.clientDataJSON,
      authenticatorData:
        params.authenticatorData ||
        params.credential?.response?.authenticatorData ||
        params.credential?.authenticatorData,
      signature:
        params.signature ||
        params.credential?.response?.signature ||
        params.credential?.signature,
    };
    const res = await this.request<{
      success: boolean;
      session_token: string;
      user: UserAccount;
      workspace: Organization;
    }>('/api/auth/login/passkey', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.session_token) {
      this.setSessionToken(res.session_token);
    }
    return res;
  }

  async loginTotp(params: {
    challenge_id: string;
    code: string;
  }): Promise<{
    success: boolean;
    session_token: string;
    user: UserAccount;
    workspace: Organization;
  }> {
    const res = await this.request<{
      success: boolean;
      session_token: string;
      user: UserAccount;
      workspace: Organization;
    }>('/api/auth/login/totp', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (res.session_token) {
      this.setSessionToken(res.session_token);
    }
    return res;
  }

  async getMe(): Promise<{
    authenticated: boolean;
    user: UserAccount | null;
    workspace?: Organization | null;
    active_workspace?: Organization | null;
    current_organization?: Organization | null;
    workspaces?: Organization[];
    organizations?: Organization[];
    has_totp?: boolean;
    totp_enabled?: boolean;
    passkeys?: PasskeyItem[];
    passkeys_count?: number;
    owned_workers?: WorkerOwnershipInfo[];
  }> {
    return this.request('/api/auth/me');
  }

  async logout(): Promise<void> {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } finally {
      this.setSessionToken(null);
    }
  }

  async getPasskeys(): Promise<PasskeyItem[]> {
    const data = await this.request<{ success: boolean; passkeys: PasskeyItem[] }>('/api/auth/passkeys');
    return data.passkeys || [];
  }

  async deletePasskey(id: string): Promise<void> {
    await this.request(`/api/auth/passkeys/${id}`, { method: 'DELETE' });
  }

  private lastTotpSetupSecret: string | null = null;

  async setupTotp(): Promise<{
    success: boolean;
    secret: string;
    otpauth_url: string;
    account_email: string;
  }> {
    const res = await this.request<{
      success: boolean;
      secret: string;
      otpauth_url: string;
      account_email?: string;
    }>('/api/auth/totp/setup', { method: 'POST' });
    this.lastTotpSetupSecret = res.secret;
    return {
      ...res,
      account_email: res.account_email || 'operator@aetheros.dev',
    };
  }

  async verifyTotpSetup(secretOrCode: string, maybeCode?: string): Promise<{ success: boolean }> {
    const secret = maybeCode ? secretOrCode : (this.lastTotpSetupSecret || '');
    const code = maybeCode ? maybeCode : secretOrCode;
    return this.request('/api/auth/totp/verify-setup', {
      method: 'POST',
      body: JSON.stringify({ secret, code }),
    });
  }

  // --- WORKSPACES & WORKER OWNERSHIP ---
  async getWorkspaces(): Promise<Organization[]> {
    const data = await this.request<{ success: boolean; workspaces: Organization[] }>('/api/workspaces');
    return data.workspaces || [];
  }

  async createWorkspace(name: string, slug?: string): Promise<Organization> {
    const data = await this.request<{ success: boolean; workspace: Organization }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name, slug }),
    });
    return data.workspace;
  }

  async getWorkerOwnership(): Promise<WorkerOwnershipInfo[]> {
    const data = await this.request<{ success: boolean; ownerships?: WorkerOwnershipInfo[]; workers?: WorkerOwnershipInfo[] }>('/api/workers/ownership');
    return data.ownerships || data.workers || [];
  }

  async claimWorker(workerId: string, ownershipType: 'personal' | 'organization' = 'personal'): Promise<any> {
    return this.request(`/api/workers/${workerId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ ownership_type: ownershipType }),
    });
  }

  // --- COMPUTE SESSIONS & KAGGLE MANAGER ---
  async getComputeSessions(): Promise<ComputeSession[]> {
    const data = await this.request<{ success: boolean; sessions: ComputeSession[] }>('/api/compute/sessions');
    return data.sessions || [];
  }

  async startComputeSession(params: {
    provider?: string;
    notebook_slug?: string;
    worker_id?: string;
  }): Promise<ComputeSession> {
    const data = await this.request<{ success: boolean; session: ComputeSession }>('/api/compute/sessions/start', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return data.session;
  }

  async stopComputeSession(sessionId: string): Promise<ComputeSession> {
    const data = await this.request<{ success: boolean; session: ComputeSession }>(`/api/compute/sessions/${sessionId}/stop`, {
      method: 'POST',
    });
    return data.session;
  }

  async restartComputeSession(sessionId: string): Promise<ComputeSession> {
    const data = await this.request<{ success: boolean; session: ComputeSession }>(`/api/compute/sessions/${sessionId}/restart`, {
      method: 'POST',
    });
    return data.session;
  }

  async getComputeSessionStatus(sessionId: string): Promise<{
    session: ComputeSession;
    worker: ComputeWorker | null;
    kaggle_cloud_status?: string;
  }> {
    return this.request(`/api/compute/sessions/${sessionId}/status`);
  }

  async saveKaggleCredentials(params: { kaggle_username: string; kaggle_key: string }): Promise<void> {
    await this.request('/api/compute/kaggle-credentials', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getKaggleCredentialsStatus(): Promise<KaggleCredentialsStatus> {
    return this.request('/api/compute/kaggle-credentials/status');
  }

  // --- DEFENSIVE CYBERSECURITY AGENT (PHASE 10) ---
  async assessSecurity(params: {
    scope: 'website_headers_tls' | 'dns_security' | 'dependency_audit' | 'source_code_audit' | 'full_audit';
    target_url?: string;
    domain?: string;
    package_json?: string | Record<string, unknown>;
    source_code?: string;
    source_filename?: string;
    authorization_confirmed: boolean;
    authorized_scope_note?: string;
  }): Promise<{
    success: boolean;
    report: any;
    artifacts: { markdown_key: string; json_key: string };
  }> {
    return this.request('/api/security/assess', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getSecurityEvents(): Promise<any[]> {
    const data = await this.request<{ success: boolean; events: any[] }>('/api/security/events');
    return data.events || [];
  }

  // --- WEB INTELLIGENCE AGENT (AetherEye) ---
  async investigateWebTarget(params: {
    target: string;
    timeout_ms?: number;
  }): Promise<{
    success: boolean;
    report: any;
    report_file_id?: string;
    artifacts: { json_key: string };
  }> {
    return this.request('/api/intelligence/investigate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // --- REPO & GIT OPERATIONS ---
  async getRepoTree(depth = 4): Promise<any[]> {
    const res = await this.request<{ success: boolean; tree: any[] }>(`/api/repo/tree?depth=${depth}`);
    return res.tree || [];
  }

  async readRepoFile(filePath: string): Promise<{
    path: string;
    content: string;
    size: number;
    isBinary: boolean;
    language: string;
  }> {
    const res = await this.request<{ success: boolean; file: any }>(
      `/api/repo/file?path=${encodeURIComponent(filePath)}`
    );
    return res.file;
  }

  async writeRepoFile(filePath: string, content: string): Promise<{ success: boolean; path: string; size: number }> {
    return this.request('/api/repo/file', {
      method: 'POST',
      body: JSON.stringify({ path: filePath, content }),
    });
  }

  async getGitStatus(): Promise<any> {
    const res = await this.request<{ success: boolean; status: any }>('/api/repo/git/status');
    return res.status;
  }

  async getGitDiff(filePath?: string): Promise<{ diff: string }> {
    const url = filePath ? `/api/repo/git/diff?path=${encodeURIComponent(filePath)}` : '/api/repo/git/diff';
    return this.request(url);
  }

  async commitGit(message: string, stageAll = true): Promise<any> {
    return this.request('/api/repo/git/commit', {
      method: 'POST',
      body: JSON.stringify({ message, stage_all: stageAll }),
    });
  }

  async pushGit(params: { branch?: string; remote?: string; token?: string }): Promise<any> {
    return this.request('/api/repo/git/push', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // --- MODEL CONTEXT PROTOCOL (MCP) ---
  async getMcpServers(): Promise<any[]> {
    const res = await this.request<{ success: boolean; servers: any[] }>('/api/mcp/servers');
    return res.servers || [];
  }

  async getMcpTemplates(): Promise<any[]> {
    const res = await this.request<{ success: boolean; templates: any[] }>('/api/mcp/templates');
    return res.templates || [];
  }

  async addMcpServer(params: {
    name?: string;
    description?: string;
    endpoint?: string;
    transport?: string;
    provider?: string;
    category?: string;
    templateId?: string;
    config?: Record<string, string>;
  }): Promise<any> {
    return this.request('/api/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async configureMcpServer(id: string, config: Record<string, string>): Promise<any> {
    return this.request(`/api/mcp/servers/${id}/configure`, {
      method: 'POST',
      body: JSON.stringify({ config }),
    });
  }

  async toggleMcpServer(id: string, enabled: boolean): Promise<any> {
    return this.request(`/api/mcp/servers/${id}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  }

  async removeMcpServer(id: string): Promise<any> {
    return this.request(`/api/mcp/servers/${id}`, {
      method: 'DELETE',
    });
  }

  async getMcpTools(): Promise<any[]> {
    const res = await this.request<{ success: boolean; tools: any[] }>('/api/mcp/tools');
    return res.tools || [];
  }

  async executeMcpTool(tool: string, args: Record<string, any> = {}): Promise<any> {
    return this.request('/api/mcp/tools/execute', {
      method: 'POST',
      body: JSON.stringify({ tool, arguments: args }),
    });
  }

  // --- AETHEROS CODING ASSISTANT & MANUAL API ---
  async getAiModels(): Promise<{ models: any[]; manual_api_config?: any }> {
    return this.request('/api/ai/models');
  }

  async saveManualApiConfig(config: {
    format?: string;
    endpoint?: string;
    apiKey?: string;
    authHeaderName?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<any> {
    return this.request('/api/ai/manual-config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async testManualApiConnection(config: {
    format?: string;
    endpoint?: string;
    apiKey?: string;
    authHeaderName?: string;
    model?: string;
  }): Promise<{
    success: boolean;
    latency_ms: number;
    model_tested: string;
    endpoint: string;
    message: string;
  }> {
    return this.request('/api/ai/test-connection', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async sendAiStudioChat(params: {
    message: string;
    model?: string;
    externalApi?: any;
    currentFile?: any;
    enabledMcpServers?: string[];
    history?: any[];
  }): Promise<any> {
    return this.request('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }
}

export const apiClient = new ApiClient();

