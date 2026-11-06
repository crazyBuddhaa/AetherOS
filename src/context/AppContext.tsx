import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { 
  Agent, 
  Task, 
  ApprovalRequest, 
  Conversation, 
  AttachedFile, 
  ActivityLog, 
  RuntimeConfig, 
  SystemStats,
  ComputeWorker,
  ModelDefinition,
  UserAccount,
  Organization,
  PasskeyItem,
  ComputeSession,
  WorkerOwnershipInfo,
  KaggleCredentialsStatus
} from '../types';
import { dbStorage } from '../services/db-storage';
import { runtimeEngine } from '../services/runtime-engine';
import { apiClient } from '../services/api-client';

export type NavTab = 'dashboard' | 'chat' | 'agents' | 'tasks' | 'approvals' | 'files' | 'compute' | 'sessions' | 'settings';

interface AppContextType {
  // Navigation
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;

  // Theme
  theme: 'dark' | 'light';
  toggleTheme: () => void;

  // Authentication & Identity
  user: UserAccount | null;
  workspace: Organization | null;
  workspaces: Organization[];
  isAuthenticated: boolean;
  passkeys: PasskeyItem[];
  hasTotp: boolean;
  isAuthModalOpen: boolean;
  authModalMode: 'login' | 'register';
  setIsAuthModalOpen: (open: boolean) => void;
  setAuthModalMode: (mode: 'login' | 'register') => void;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
  enrollPasskey: (credentialName?: string) => Promise<void>;
  deletePasskey: (id: string) => Promise<void>;
  setupTotp: () => Promise<{ secret: string; otpauth_url: string; account_email: string }>;
  verifyTotpSetup: (code: string) => Promise<void>;

  // Workspaces & Worker Ownership
  workerOwnerships: Record<string, WorkerOwnershipInfo>;
  claimWorkerOwnership: (workerId: string, ownershipType?: 'personal' | 'organization') => Promise<void>;

  // Kaggle & Compute Session Management
  computeSessions: ComputeSession[];
  activeComputeSession: ComputeSession | null;
  kaggleCredentialsStatus: KaggleCredentialsStatus;
  refreshComputeSessions: () => Promise<void>;
  startComputeSession: (notebookSlug?: string) => Promise<ComputeSession>;
  stopComputeSession: (sessionId: string) => Promise<ComputeSession>;
  restartComputeSession: (sessionId: string) => Promise<ComputeSession>;
  saveKaggleCredentials: (username: string, key: string) => Promise<void>;

  // Domain Entities
  agents: Agent[];
  tasks: Task[];
  approvals: ApprovalRequest[];
  conversations: Conversation[];
  files: AttachedFile[];
  logs: ActivityLog[];
  runtimeConfig: RuntimeConfig;
  stats: SystemStats;
  workers: ComputeWorker[];
  models: ModelDefinition[];

  // Active Selection
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
  selectedConversationId: string | null;
  setSelectedConversationId: (id: string | null) => void;

  // Actions
  refreshAll: () => Promise<void>;
  createAgent: (agent: Agent) => Promise<void>;
  updateAgent: (agent: Agent) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  submitTask: (params: {
    agentId: string;
    title: string;
    description: string;
    inputPayload: Record<string, unknown>;
    priority: 'low' | 'medium' | 'high' | 'critical';
  }) => Promise<Task>;
  cancelTask: (taskId: string, reason?: string) => void;
  togglePauseTask: (taskId: string) => void;
  decideApproval: (approvalId: string, decision: 'approved' | 'rejected', comment?: string) => Promise<void>;
  uploadFile: (file: File, taskId?: string, conversationId?: string) => Promise<AttachedFile>;
  deleteFile: (id: string) => Promise<void>;
  pingRuntime: () => Promise<void>;
  updateRuntimeConfig: (config: RuntimeConfig) => void;
  registerWorker: (payload: {
    name: string;
    provider: 'kaggle' | 'oracle' | 'runpod' | 'self_hosted' | 'custom';
    gpu_model: string;
    gpu_count: number;
    vram_mb: number;
    system_ram_mb: number;
    contributor_name?: string;
  }) => Promise<{ worker: ComputeWorker; apiKey: string }>;

  // Notifications
  notification: { message: string; type: 'success' | 'info' | 'error' } | null;
  showNotification: (message: string, type?: 'success' | 'info' | 'error') => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const [agents, setAgents] = useState<Agent[]>(dbStorage.getAgents());
  const [tasks, setTasks] = useState<Task[]>(dbStorage.getTasks());
  const [approvals, setApprovals] = useState<ApprovalRequest[]>(dbStorage.getApprovals());
  const [conversations, setConversations] = useState<Conversation[]>(dbStorage.getConversations());
  const [files, setFiles] = useState<AttachedFile[]>(dbStorage.getFiles());
  const [logs, setLogs] = useState<ActivityLog[]>(dbStorage.getLogs());
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>(dbStorage.getRuntimeConfig());
  const [stats, setStats] = useState<SystemStats>(dbStorage.getStats());
  const [workers, setWorkers] = useState<ComputeWorker[]>([]);
  const [models, setModels] = useState<ModelDefinition[]>([]);

  // Auth & Identity State
  const [user, setUser] = useState<UserAccount | null>(null);
  const [workspace, setWorkspace] = useState<Organization | null>(null);
  const [workspaces, setWorkspaces] = useState<Organization[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [hasTotp, setHasTotp] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');

  // Ownership & Compute Sessions
  const [workerOwnerships, setWorkerOwnerships] = useState<Record<string, WorkerOwnershipInfo>>({});
  const [computeSessions, setComputeSessions] = useState<ComputeSession[]>([]);
  const [activeComputeSession, setActiveComputeSession] = useState<ComputeSession | null>(null);
  const [kaggleCredentialsStatus, setKaggleCredentialsStatus] = useState<KaggleCredentialsStatus>({ configured: false });

  const isAuthenticated = Boolean(user && user.is_active);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Sync theme to <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const showNotification = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(prev => (prev?.message === message ? null : prev));
    }, 3800);
  };

  const refreshUser = useCallback(async () => {
    try {
      if (!apiClient.getSessionToken()) {
        setUser(null);
        setWorkspace(null);
        setWorkspaces([]);
        setPasskeys([]);
        setHasTotp(false);
        return;
      }
      const data = await apiClient.getMe();
      if (data && data.user) {
        setUser(data.user);
        setWorkspace(data.current_organization || (data.organizations && data.organizations[0]) || null);
        setWorkspaces(data.organizations || []);
        setPasskeys(data.passkeys || []);
        setHasTotp(Boolean(data.has_totp));
      } else {
        setUser(null);
      }
    } catch {
      apiClient.setSessionToken(null);
      setUser(null);
      setWorkspace(null);
      setWorkspaces([]);
      setPasskeys([]);
      setHasTotp(false);
    }
  }, []);

  const refreshComputeSessions = useCallback(async () => {
    try {
      const [sessions, kaggleStatus] = await Promise.allSettled([
        apiClient.getComputeSessions(),
        apiClient.getKaggleCredentialsStatus(),
      ]);
      if (sessions.status === 'fulfilled') {
        setComputeSessions(sessions.value);
        if (sessions.value.length > 0) {
          const active = sessions.value.find(s => ['starting', 'initializing', 'waiting_for_worker', 'ready', 'busy'].includes(s.status)) || sessions.value[0];
          setActiveComputeSession(active);
        } else {
          setActiveComputeSession(null);
        }
      }
      if (kaggleStatus.status === 'fulfilled') {
        setKaggleCredentialsStatus(kaggleStatus.value);
      }
    } catch {
      // ignore
    }
  }, []);

  // Sync live backend with local state
  const refreshAll = useCallback(async () => {
    try {
      const [remoteAgents, remoteTasks, remoteApprovals, remoteFiles, remoteWorkers, remoteModels, remoteLogs, remoteConversations, remoteOwnerships] =
        await Promise.allSettled([
          apiClient.getAgents(),
          apiClient.getTasks(),
          apiClient.getApprovals(),
          apiClient.getFiles(),
          apiClient.getWorkers(),
          apiClient.getModels(),
          apiClient.getLogs(),
          apiClient.getConversations(),
          apiClient.getWorkerOwnership(),
        ]);

      const resolvedAgents =
        remoteAgents.status === 'fulfilled' ? remoteAgents.value : dbStorage.getAgents();
      const resolvedTasks =
        remoteTasks.status === 'fulfilled' ? remoteTasks.value : dbStorage.getTasks();
      const resolvedApprovals =
        remoteApprovals.status === 'fulfilled' ? remoteApprovals.value : dbStorage.getApprovals();
      const resolvedFiles =
        remoteFiles.status === 'fulfilled' ? remoteFiles.value : dbStorage.getFiles();
      const resolvedLogs =
        remoteLogs.status === 'fulfilled' ? remoteLogs.value : dbStorage.getLogs();
      const resolvedConversations =
        remoteConversations.status === 'fulfilled' ? remoteConversations.value : dbStorage.getConversations();

      setAgents(resolvedAgents);
      setTasks(resolvedTasks);
      setApprovals(resolvedApprovals);
      setFiles(resolvedFiles);
      setLogs(resolvedLogs);
      setConversations(resolvedConversations);

      if (remoteWorkers.status === 'fulfilled') {
        setWorkers(remoteWorkers.value);
      }

      if (remoteModels.status === 'fulfilled') {
        setModels(remoteModels.value);
      }

      if (remoteOwnerships.status === 'fulfilled') {
        const map: Record<string, WorkerOwnershipInfo> = {};
        for (const o of remoteOwnerships.value) {
          map[o.worker_id] = o;
        }
        setWorkerOwnerships(map);
      }

      const currentRuntime = dbStorage.getRuntimeConfig();
      setRuntimeConfig(currentRuntime);

      const totalBytes = resolvedFiles.reduce((acc, f) => acc + (f.size_bytes || 0), 0);
      setStats({
        total_agents: resolvedAgents.length,
        active_agents: resolvedAgents.filter(a => a.is_enabled).length,
        total_tasks: resolvedTasks.length,
        running_tasks: resolvedTasks.filter(t =>
          ['queued', 'assigned', 'downloading', 'loading_model', 'running', 'uploading'].includes(t.status)
        ).length,
        pending_approvals: resolvedApprovals.filter(a => a.status === 'pending').length,
        total_files: resolvedFiles.length,
        storage_bytes_used: totalBytes,
        runtime_status: currentRuntime.is_online ? 'healthy' : 'offline',
      });
    } catch {
      // Offline fallback
      setAgents(dbStorage.getAgents());
      setTasks(dbStorage.getTasks());
      setApprovals(dbStorage.getApprovals());
      setConversations(dbStorage.getConversations());
      setFiles(dbStorage.getFiles());
      setLogs(dbStorage.getLogs());
      setRuntimeConfig(dbStorage.getRuntimeConfig());
      setStats(dbStorage.getStats());
    }
  }, []);

  // Periodic polling for task updates & live worker heartbeats
  useEffect(() => {
    refreshUser();
    refreshComputeSessions();
    refreshAll();
    const interval = setInterval(() => {
      refreshAll();
      refreshComputeSessions();
    }, 3000);
    return () => clearInterval(interval);
  }, [refreshAll, refreshUser, refreshComputeSessions]);

  const createAgent = async (agent: Agent) => {
    try {
      await apiClient.createAgent(agent);
    } catch {
      // Fallback to local
    }
    dbStorage.saveAgent(agent);
    dbStorage.addLog({
      action: 'agent_created',
      category: 'agent',
      agent_id: agent.id,
      agent_name: agent.name,
      details: { model: agent.model },
    });
    await refreshAll();
    showNotification(`Agent "${agent.name}" created and synced`, 'success');
  };

  const updateAgent = async (agent: Agent) => {
    try {
      await apiClient.updateAgent(agent);
    } catch {
      // Fallback
    }
    dbStorage.saveAgent(agent);
    dbStorage.addLog({
      action: 'agent_updated',
      category: 'agent',
      agent_id: agent.id,
      agent_name: agent.name,
    });
    await refreshAll();
    showNotification(`Agent "${agent.name}" updated`, 'success');
  };

  const deleteAgent = async (id: string) => {
    const agent = agents.find(a => a.id === id);
    try {
      await apiClient.deleteAgent(id);
    } catch {
      // Fallback
    }
    dbStorage.deleteAgent(id);
    dbStorage.addLog({
      action: 'agent_deleted',
      category: 'agent',
      agent_id: id,
      agent_name: agent?.name,
    });
    await refreshAll();
    showNotification(`Agent removed`, 'info');
  };

  const submitTask = async (params: {
    agentId: string;
    title: string;
    description: string;
    inputPayload: Record<string, unknown>;
    priority: 'low' | 'medium' | 'high' | 'critical';
  }) => {
    try {
      const newTask = await apiClient.submitTask(params);
      dbStorage.saveTask(newTask);
      await refreshAll();
      setSelectedTaskId(newTask.id);
      showNotification(`Task "${newTask.title}" dispatched to distributed queue`, 'success');
      return newTask;
    } catch (err: any) {
      showNotification(`Failed to dispatch task: ${err?.message || 'Server error'}`, 'error');
      throw err;
    }
  };

  const cancelTask = (taskId: string, reason?: string) => {
    apiClient.cancelTask(taskId, reason).catch(() => {});
    runtimeEngine.cancelTask(taskId, reason);
    refreshAll();
    showNotification(`Task cancelled`, 'info');
  };

  const togglePauseTask = (taskId: string) => {
    apiClient.togglePauseTask(taskId).catch(() => {});
    runtimeEngine.toggleTaskPause(taskId);
    refreshAll();
  };

  const decideApproval = async (approvalId: string, decision: 'approved' | 'rejected', comment?: string) => {
    const approval = approvals.find(a => a.id === approvalId);
    if (!approval) return;

    let syncedRemote = false;
    try {
      await apiClient.decideApproval(approvalId, decision, comment);
      syncedRemote = true;
    } catch {
      // Fallback
    }

    const updatedApproval: ApprovalRequest = {
      ...approval,
      status: decision,
      decided_at: new Date().toISOString(),
      decided_by: 'Operator',
      review_comment: comment || (decision === 'approved' ? 'Action authorized by human operator' : 'Action declined'),
    };

    dbStorage.saveApproval(updatedApproval);
    dbStorage.addLog({
      action: `approval_${decision}`,
      category: 'approval',
      task_id: approval.task_id,
      task_title: approval.task_title,
      agent_id: approval.agent_id,
      agent_name: approval.agent_name,
      details: { decision, comment: updatedApproval.review_comment },
    });

    if (decision === 'approved') {
      if (!syncedRemote) {
        runtimeEngine.resumeTaskAfterApproval(approval.task_id);
      }
      showNotification(`Consequential action authorized. Task execution resumed.`, 'success');
    } else {
      if (!syncedRemote) {
        runtimeEngine.cancelTask(approval.task_id, `Rejected in authorization queue: ${comment || 'No reason provided'}`);
      }
      showNotification(`Action rejected. Task halted.`, 'info');
    }

    await refreshAll();
  };

  const uploadFile = async (file: File, taskId?: string, _conversationId?: string): Promise<AttachedFile> => {
    try {
      const uploadedFile = await apiClient.uploadFile(file, taskId);
      dbStorage.saveFile(uploadedFile);
      dbStorage.addLog({
        action: 'file_uploaded',
        category: 'file',
        details: { filename: file.name, size: file.size, key: uploadedFile.r2_key },
      });
      await refreshAll();
      showNotification(`File "${file.name}" uploaded to Cloudflare R2`, 'success');
      return uploadedFile;
    } catch (err: any) {
      showNotification(`File upload failed: ${err?.message || 'R2 upload failed'}`, 'error');
      throw err;
    }
  };

  const deleteFile = async (id: string) => {
    const file = files.find(f => f.id === id);
    if (file?.r2_key) {
      try {
        await apiClient.deleteFile(file.r2_key);
      } catch {
        // Fallback
      }
    }
    dbStorage.deleteFile(id);
    dbStorage.addLog({
      action: 'file_deleted',
      category: 'file',
      details: { filename: file?.filename },
    });
    await refreshAll();
    showNotification(`File removed from storage`, 'info');
  };

  const pingRuntime = async () => {
    const outcome = await runtimeEngine.pingRuntime();
    setRuntimeConfig(dbStorage.getRuntimeConfig());
    if (outcome.success) {
      showNotification(`Connected to ${outcome.nodeId || 'Worker Node'} (${outcome.latencyMs}ms)`, 'success');
    } else {
      showNotification(outcome.error || 'No active compute workers connected', 'error');
    }
  };

  const updateRuntimeConfig = (config: RuntimeConfig) => {
    dbStorage.saveRuntimeConfig(config);
    setRuntimeConfig(config);
  };

  const registerWorker = async (payload: {
    name: string;
    provider: 'kaggle' | 'oracle' | 'runpod' | 'self_hosted' | 'custom';
    gpu_model: string;
    gpu_count: number;
    vram_mb: number;
    system_ram_mb: number;
    contributor_name?: string;
  }) => {
    const res = await apiClient.registerWorker(payload);
    await refreshAll();
    showNotification(`Compute worker "${res.worker.name}" registered`, 'success');
    return res;
  };

  const logout = async () => {
    try {
      await apiClient.logout();
    } catch {
      // ignore
    } finally {
      apiClient.setSessionToken(null);
      setUser(null);
      setWorkspace(null);
      setWorkspaces([]);
      setPasskeys([]);
      setHasTotp(false);
      showNotification('Signed out successfully', 'info');
    }
  };

  const enrollPasskey = async (_credentialName?: string) => {
    showNotification('Passkey enrollment is active during registration and in Security settings', 'info');
  };

  const deletePasskey = async (id: string) => {
    try {
      await apiClient.deletePasskey(id);
      await refreshUser();
      showNotification('Passkey revoked', 'info');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to revoke passkey', 'error');
      throw err;
    }
  };

  const setupTotp = async () => {
    return apiClient.setupTotp();
  };

  const verifyTotpSetup = async (code: string) => {
    await apiClient.verifyTotpSetup(code);
    await refreshUser();
    showNotification('Authenticator app (TOTP) successfully enrolled', 'success');
  };

  const claimWorkerOwnership = async (workerId: string, ownershipType: 'personal' | 'organization' = 'personal') => {
    if (!user) {
      setAuthModalMode('login');
      setIsAuthModalOpen(true);
      showNotification('Please authenticate to claim worker ownership', 'info');
      return;
    }
    try {
      const claim = await apiClient.claimWorker(workerId, ownershipType);
      setWorkerOwnerships(prev => ({ ...prev, [workerId]: claim }));
      await refreshAll();
      showNotification(`Worker '${workerId}' claimed by ${claim.owner_name || user.name}`, 'success');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to claim worker', 'error');
      throw err;
    }
  };

  const startComputeSession = async (notebookSlug?: string) => {
    try {
      const session = await apiClient.startComputeSession({
        provider: 'kaggle',
        notebook_slug: notebookSlug,
        worker_id: 'wrk_kaggle_464cc6bdb46da70260a1e849',
      });
      await refreshComputeSessions();
      showNotification(`Kaggle compute session ${session.id} initiated`, 'success');
      return session;
    } catch (err: any) {
      showNotification(err?.message || 'Failed to start session', 'error');
      throw err;
    }
  };

  const stopComputeSession = async (sessionId: string) => {
    try {
      const session = await apiClient.stopComputeSession(sessionId);
      await refreshComputeSessions();
      showNotification(`Stopping Kaggle session ${sessionId} gracefully`, 'info');
      return session;
    } catch (err: any) {
      showNotification(err?.message || 'Failed to stop session', 'error');
      throw err;
    }
  };

  const restartComputeSession = async (sessionId: string) => {
    try {
      const session = await apiClient.restartComputeSession(sessionId);
      await refreshComputeSessions();
      showNotification(`Restarting Kaggle session ${sessionId}`, 'info');
      return session;
    } catch (err: any) {
      showNotification(err?.message || 'Failed to restart session', 'error');
      throw err;
    }
  };

  const saveKaggleCredentials = async (username: string, key: string) => {
    try {
      await apiClient.saveKaggleCredentials({ kaggle_username: username, kaggle_key: key });
      await refreshComputeSessions();
      showNotification('Kaggle API credentials encrypted and saved', 'success');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to save Kaggle credentials', 'error');
      throw err;
    }
  };

  return (
    <AppContext.Provider
      value={{
        activeTab,
        setActiveTab,
        theme,
        toggleTheme,
        user,
        workspace,
        workspaces,
        isAuthenticated,
        passkeys,
        hasTotp,
        isAuthModalOpen,
        authModalMode,
        setIsAuthModalOpen,
        setAuthModalMode,
        refreshUser,
        logout,
        enrollPasskey,
        deletePasskey,
        setupTotp,
        verifyTotpSetup,
        workerOwnerships,
        claimWorkerOwnership,
        computeSessions,
        activeComputeSession,
        kaggleCredentialsStatus,
        refreshComputeSessions,
        startComputeSession,
        stopComputeSession,
        restartComputeSession,
        saveKaggleCredentials,
        agents,
        tasks,
        approvals,
        conversations,
        files,
        logs,
        runtimeConfig,
        stats,
        workers,
        models,
        selectedTaskId,
        setSelectedTaskId,
        selectedAgentId,
        setSelectedAgentId,
        selectedConversationId,
        setSelectedConversationId,
        refreshAll,
        createAgent,
        updateAgent,
        deleteAgent,
        submitTask,
        cancelTask,
        togglePauseTask,
        decideApproval,
        uploadFile,
        deleteFile,
        pingRuntime,
        updateRuntimeConfig,
        registerWorker,
        notification,
        showNotification,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
