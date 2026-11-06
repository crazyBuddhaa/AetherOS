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
  }): Promise<Task> {
    const data = await this.request<{ success: boolean; task: Task }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: params.agentId,
        title: params.title,
        description: params.description,
        input_payload: params.inputPayload,
        priority: params.priority,
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
  async getFiles(): Promise<AttachedFile[]> {
    const data = await this.request<{ success: boolean; files: any[] }>('/api/files');
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

    const res = await fetch('/api/files', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`File upload failed: ${res.statusText}`);
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
    user: UserAccount;
    organization: Organization;
    challenge: {
      id: string;
      challenge: string;
      rp: { id: string; name: string };
      user: { id: string; name: string; displayName: string };
      pubKeyCredParams: { type: string; alg: number }[];
      timeout: number;
      authenticatorSelection: Record<string, unknown>;
    };
  }> {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async verifyWebAuthnRegister(params: {
    challenge_id: string;
    credential: any;
    credential_name?: string;
  }): Promise<{
    success: boolean;
    session_token: string;
    user: UserAccount;
    organization: Organization;
    passkey: PasskeyItem;
  }> {
    const res = await this.request<{
      success: boolean;
      session_token: string;
      user: UserAccount;
      organization: Organization;
      passkey: PasskeyItem;
    }>('/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (res.session_token) {
      this.setSessionToken(res.session_token);
    }
    return res;
  }

  async getLoginChallenge(email: string): Promise<{
    success: boolean;
    challenge: {
      id: string;
      challenge: string;
      rpId: string;
      allowCredentials: { id: string; type: string }[];
      timeout: number;
      has_totp: boolean;
      passkey_count: number;
    };
  }> {
    return this.request('/api/auth/login/challenge', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async loginPasskey(params: {
    challenge_id: string;
    credential: any;
  }): Promise<{
    success: boolean;
    session_token: string;
    user: UserAccount;
    organization: Organization;
  }> {
    const res = await this.request<{
      success: boolean;
      session_token: string;
      user: UserAccount;
      organization: Organization;
    }>('/api/auth/login/passkey', {
      method: 'POST',
      body: JSON.stringify(params),
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
    organization: Organization;
  }> {
    const res = await this.request<{
      success: boolean;
      session_token: string;
      user: UserAccount;
      organization: Organization;
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
    success: boolean;
    user: UserAccount;
    session: { id: string; organization_id?: string; expires_at: string };
    organizations: Organization[];
    current_organization?: Organization;
    has_totp: boolean;
    passkeys: PasskeyItem[];
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

  async setupTotp(): Promise<{
    success: boolean;
    secret: string;
    otpauth_url: string;
    account_email: string;
  }> {
    return this.request('/api/auth/totp/setup', { method: 'POST' });
  }

  async verifyTotpSetup(code: string): Promise<{ success: boolean }> {
    return this.request('/api/auth/totp/verify-setup', {
      method: 'POST',
      body: JSON.stringify({ code }),
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
    const data = await this.request<{ success: boolean; ownerships: WorkerOwnershipInfo[] }>('/api/workers/ownership');
    return data.ownerships || [];
  }

  async claimWorker(workerId: string, ownershipType: 'personal' | 'organization' = 'personal'): Promise<WorkerOwnershipInfo> {
    const data = await this.request<{ success: boolean; ownership: WorkerOwnershipInfo }>(`/api/workers/${workerId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ ownership_type: ownershipType }),
    });
    return data.ownership;
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
}

export const apiClient = new ApiClient();
