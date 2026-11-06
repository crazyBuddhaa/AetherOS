import { 
  Agent, 
  Task, 
  ApprovalRequest, 
  Conversation, 
  Message, 
  AttachedFile, 
  ActivityLog, 
  RuntimeConfig, 
  SystemStats 
} from '../types';

const STORAGE_KEYS = {
  AGENTS: 'aetheros_agents_v2',
  TASKS: 'aetheros_tasks',
  APPROVALS: 'aetheros_approvals',
  CONVERSATIONS: 'aetheros_conversations',
  MESSAGES: 'aetheros_messages',
  FILES: 'aetheros_files',
  LOGS: 'aetheros_logs',
  RUNTIME_CONFIG: 'aetheros_runtime_config',
};

const nowIso = new Date().toISOString();

const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'agent_dataops',
    name: 'Code & Systems Architect',
    description: 'Full-stack TypeScript, Python, SQL/D1 schema engineering, and Cloudflare Worker synthesis.',
    model: 'qwen-2.5-coder-14b',
    system_instructions: 'You are the AetherOS Code & Systems Architect. Produce clean, modular, strongly-typed production code, parameterized SQL migrations, and deterministic system architectures.',
    temperature: 0.2,
    max_tokens: 4096,
    permitted_tools: [
      {
        id: 'tool_d1_query',
        name: 'd1_sql_inspector',
        description: 'Validate and benchmark Cloudflare D1 SQLite queries',
        category: 'database',
        requires_approval: false,
        risk_level: 'low',
        parameters_schema: { query: 'string' },
      },
      {
        id: 'tool_r2_write',
        name: 'r2_artifact_writer',
        description: 'Write compiled code artifacts to Cloudflare R2 bucket',
        category: 'filesystem',
        requires_approval: false,
        risk_level: 'low',
        parameters_schema: { filename: 'string', content: 'string' },
      },
    ],
    is_enabled: true,
    avatar_color: '#2563EB',
    created_at: nowIso,
    updated_at: nowIso,
  },
  {
    id: 'agent_visual_synth',
    name: 'Visual Synthesis Director',
    description: 'High-resolution image synthesis, SDXL Lightning rendering, Real-ESRGAN 4x upscaling, and BiRefNet segmentation.',
    model: 'sdxl-lightning',
    system_instructions: 'You are the AetherOS Visual Synthesis Director. Formulate optically precise, lighting-calibrated prompts and conditioning pipelines for high-resolution image synthesis.',
    temperature: 0.5,
    max_tokens: 2048,
    permitted_tools: [
      {
        id: 'tool_upscale',
        name: 'real_esrgan_upscale',
        description: '4x spatial super-resolution pass on generated frames',
        category: 'execution',
        requires_approval: false,
        risk_level: 'low',
        parameters_schema: { scale: 'number' },
      },
    ],
    is_enabled: true,
    avatar_color: '#0284C7',
    created_at: nowIso,
    updated_at: nowIso,
  },
  {
    id: 'agent_motion_studio',
    name: 'Motion & Video Director',
    description: 'Temporal motion synthesis, camera trajectory planning, and keyframe-conditioned AnimateDiff video generation.',
    model: 'animatediff-motion-v3',
    system_instructions: 'You are the AetherOS Motion & Video Director. Orchestrate temporal consistency, focal length transitions, and multi-frame motion modules.',
    temperature: 0.4,
    max_tokens: 2048,
    permitted_tools: [],
    is_enabled: true,
    avatar_color: '#4F46E5',
    created_at: nowIso,
    updated_at: nowIso,
  },
  {
    id: 'agent_storyboard',
    name: 'Storyboard & Continuity Architect',
    description: 'Sequential visual narrative planning, camera blocking, lens selection, and animatic pacing.',
    model: 'deepseek-r1-distill-qwen-14b',
    system_instructions: 'You are the AetherOS Storyboard & Continuity Architect. Translate narrative beats into structured shot lists with lens focal lengths, camera movement, and visual composition notes.',
    temperature: 0.3,
    max_tokens: 4096,
    permitted_tools: [],
    is_enabled: true,
    avatar_color: '#0D9488',
    created_at: nowIso,
    updated_at: nowIso,
  },
  {
    id: 'agent_screenwriter',
    name: 'Screenplay & Narrative Dramaturg',
    description: 'Industry-standard screenplay formatting, dialogue polish, structural beat sheets, and scene breakdown.',
    model: 'deepseek-r1-distill-qwen-14b',
    system_instructions: 'You are the AetherOS Screenplay & Narrative Dramaturg. Write crisp, industry-standard fountain/screenplay scenes with sharp subtext, visual action lines, and structural pacing.',
    temperature: 0.6,
    max_tokens: 4096,
    permitted_tools: [],
    is_enabled: true,
    avatar_color: '#D97706',
    created_at: nowIso,
    updated_at: nowIso,
  },
];

const DEFAULT_TASKS: Task[] = [];
const DEFAULT_APPROVALS: ApprovalRequest[] = [];
const DEFAULT_CONVERSATIONS: Conversation[] = [];
const DEFAULT_MESSAGES: Message[] = [];
const DEFAULT_FILES: AttachedFile[] = [];
const DEFAULT_LOGS: ActivityLog[] = [];

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  endpoint_url: 'https://aetheros-agent-platform.trileaf.workers.dev',
  api_key_configured: true,
  timeout_seconds: 30,
  max_retries: 3,
  heartbeat_interval_seconds: 15,
  is_online: false,
  last_ping_latency_ms: 0,
  node_id: '',
  active_jobs: 0,
  capacity_percent: 0,
  engine_version: 'AetherOS Worker v1',
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
    const stored = this.getItem<Agent[]>(STORAGE_KEYS.AGENTS, DEFAULT_AGENTS);
    return stored.length > 0 ? stored : DEFAULT_AGENTS;
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
