import { 
  Agent, 
  Task, 
  TaskStep, 
  ApprovalRequest, 
  Conversation, 
  Message, 
  AttachedFile, 
  ActivityLog, 
  RuntimeConfig, 
  SystemStats 
} from '../types';

const STORAGE_KEYS = {
  AGENTS: 'aetheros_agents',
  TASKS: 'aetheros_tasks',
  APPROVALS: 'aetheros_approvals',
  CONVERSATIONS: 'aetheros_conversations',
  MESSAGES: 'aetheros_messages',
  FILES: 'aetheros_files',
  LOGS: 'aetheros_logs',
  RUNTIME_CONFIG: 'aetheros_runtime_config',
};

const DEFAULT_AGENTS: Agent[] = [];
const DEFAULT_TASKS: Task[] = [];
const DEFAULT_APPROVALS: ApprovalRequest[] = [];
const DEFAULT_CONVERSATIONS: Conversation[] = [];
const DEFAULT_MESSAGES: Message[] = [];
const DEFAULT_FILES: AttachedFile[] = [];
const DEFAULT_LOGS: ActivityLog[] = [];

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  endpoint_url: '',
  api_key_configured: false,
  timeout_seconds: 30,
  max_retries: 3,
  heartbeat_interval_seconds: 15,
  is_online: false,
  last_ping_latency_ms: 0,
  node_id: '',
  active_jobs: 0,
  capacity_percent: 0,
  engine_version: '',
};

// --- Storage Helper Class ---
class StorageService {
  private getItem<T>(key: string, defaultValue: T): T {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private setItem<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Storage save failed:', e);
    }
  }

  // AGENTS
  getAgents(): Agent[] {
    return this.getItem<Agent[]>(STORAGE_KEYS.AGENTS, DEFAULT_AGENTS);
  }

  saveAgent(agent: Agent): void {
    const agents = this.getAgents();
    const idx = agents.findIndex(a => a.id === agent.id);
    if (idx >= 0) {
      agents[idx] = { ...agent, updated_at: new Date().toISOString() };
    } else {
      agents.unshift({ ...agent, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    this.setItem(STORAGE_KEYS.AGENTS, agents);
  }

  deleteAgent(id: string): void {
    const agents = this.getAgents().filter(a => a.id !== id);
    this.setItem(STORAGE_KEYS.AGENTS, agents);
  }

  // TASKS
  getTasks(): Task[] {
    return this.getItem<Task[]>(STORAGE_KEYS.TASKS, DEFAULT_TASKS);
  }

  getTask(id: string): Task | undefined {
    return this.getTasks().find(t => t.id === id);
  }

  saveTask(task: Task): void {
    const tasks = this.getTasks();
    const idx = tasks.findIndex(t => t.id === task.id);
    if (idx >= 0) {
      tasks[idx] = { ...task, updated_at: new Date().toISOString() };
    } else {
      tasks.unshift({ ...task, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    this.setItem(STORAGE_KEYS.TASKS, tasks);
  }

  // APPROVALS
  getApprovals(): ApprovalRequest[] {
    return this.getItem<ApprovalRequest[]>(STORAGE_KEYS.APPROVALS, DEFAULT_APPROVALS);
  }

  saveApproval(approval: ApprovalRequest): void {
    const approvals = this.getApprovals();
    const idx = approvals.findIndex(a => a.id === approval.id);
    if (idx >= 0) {
      approvals[idx] = approval;
    } else {
      approvals.unshift(approval);
    }
    this.setItem(STORAGE_KEYS.APPROVALS, approvals);
  }

  // CONVERSATIONS & MESSAGES
  getConversations(): Conversation[] {
    return this.getItem<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, DEFAULT_CONVERSATIONS);
  }

  saveConversation(conv: Conversation): void {
    const list = this.getConversations();
    const idx = list.findIndex(c => c.id === conv.id);
    if (idx >= 0) {
      list[idx] = { ...conv, updated_at: new Date().toISOString() };
    } else {
      list.unshift({ ...conv, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    this.setItem(STORAGE_KEYS.CONVERSATIONS, list);
  }

  getMessages(conversationId: string): Message[] {
    const all = this.getItem<Message[]>(STORAGE_KEYS.MESSAGES, DEFAULT_MESSAGES);
    return all.filter(m => m.conversation_id === conversationId);
  }

  addMessage(msg: Message): void {
    const all = this.getItem<Message[]>(STORAGE_KEYS.MESSAGES, DEFAULT_MESSAGES);
    all.push(msg);
    this.setItem(STORAGE_KEYS.MESSAGES, all);
  }

  // FILES (Cloudflare R2)
  getFiles(): AttachedFile[] {
    return this.getItem<AttachedFile[]>(STORAGE_KEYS.FILES, DEFAULT_FILES);
  }

  saveFile(file: AttachedFile): void {
    const files = this.getFiles();
    files.unshift(file);
    this.setItem(STORAGE_KEYS.FILES, files);
  }

  deleteFile(id: string): void {
    const files = this.getFiles().filter(f => f.id !== id);
    this.setItem(STORAGE_KEYS.FILES, files);
  }

  // LOGS
  getLogs(): ActivityLog[] {
    return this.getItem<ActivityLog[]>(STORAGE_KEYS.LOGS, DEFAULT_LOGS);
  }

  addLog(log: Omit<ActivityLog, 'id' | 'created_at'>): void {
    const logs = this.getLogs();
    const newLog: ActivityLog = {
      ...log,
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      created_at: new Date().toISOString(),
    };
    logs.unshift(newLog);
    this.setItem(STORAGE_KEYS.LOGS, logs.slice(0, 100));
  }

  // RUNTIME CONFIG
  getRuntimeConfig(): RuntimeConfig {
    return this.getItem<RuntimeConfig>(STORAGE_KEYS.RUNTIME_CONFIG, DEFAULT_RUNTIME_CONFIG);
  }

  saveRuntimeConfig(config: RuntimeConfig): void {
    this.setItem(STORAGE_KEYS.RUNTIME_CONFIG, config);
  }

  // STATS
  getStats(): SystemStats {
    const agents = this.getAgents();
    const tasks = this.getTasks();
    const approvals = this.getApprovals();
    const files = this.getFiles();
    const runtime = this.getRuntimeConfig();

    const bytes = files.reduce((acc, f) => acc + f.size_bytes, 0);

    return {
      total_agents: agents.length,
      active_agents: agents.filter(a => a.is_enabled).length,
      total_tasks: tasks.length,
      running_tasks: tasks.filter(t => t.status === 'running' || t.status === 'queued').length,
      pending_approvals: approvals.filter(a => a.status === 'pending').length,
      total_files: files.length,
      storage_bytes_used: bytes,
      runtime_status: runtime.is_online ? 'healthy' : 'offline',
    };
  }

  resetToDefaults(): void {
    localStorage.removeItem(STORAGE_KEYS.AGENTS);
    localStorage.removeItem(STORAGE_KEYS.TASKS);
    localStorage.removeItem(STORAGE_KEYS.APPROVALS);
    localStorage.removeItem(STORAGE_KEYS.CONVERSATIONS);
    localStorage.removeItem(STORAGE_KEYS.MESSAGES);
    localStorage.removeItem(STORAGE_KEYS.FILES);
    localStorage.removeItem(STORAGE_KEYS.LOGS);
    localStorage.removeItem(STORAGE_KEYS.RUNTIME_CONFIG);
  }
}

export const dbStorage = new StorageService();
