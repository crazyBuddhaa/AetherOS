import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { apiClient } from '../../services/api-client';
import {
  Code2,
  Play,
  Copy,
  Check,
  Plus,
  FileCode,
  Terminal,
  Cpu,
  Sparkles,
  RefreshCw,
  GitBranch,
  UploadCloud,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Layers,
  Settings,
  Send,
  Sliders,
  X,
  Save,
  Wrench,
  CheckCircle2,
  AlertCircle,
  Database,
  Globe,
  Key,
  Plug,
  Trash2,
  Activity,
} from 'lucide-react';

interface OpenTab {
  path: string;
  name: string;
  content: string;
  language: string;
  isModified?: boolean;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  model?: string;
  provider?: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, any>;
    result: any;
    error?: string;
  }>;
  timestamp: string;
}

const MANUAL_API_PRESETS = [
  {
    id: 'openai',
    label: 'OpenAI Compatible',
    format: 'openai_compatible',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    authHeaderName: 'Authorization',
    model: 'gpt-4o',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Messages API',
    format: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    authHeaderName: 'x-api-key',
    model: 'claude-3-7-sonnet-latest',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    format: 'cloudflare_workers_ai',
    endpoint: 'https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/run/@cf/qwen/qwen1.5-14b-chat-awq',
    authHeaderName: 'Authorization',
    model: '@cf/qwen/qwen1.5-14b-chat-awq',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter Gateway',
    format: 'openai_compatible',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    authHeaderName: 'Authorization',
    model: 'qwen/qwen-2.5-coder-32b-instruct',
  },
  {
    id: 'groq',
    label: 'Groq Cloud LPU',
    format: 'openai_compatible',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    authHeaderName: 'Authorization',
    model: 'llama-3.3-70b-versatile',
  },
  {
    id: 'ollama',
    label: 'Local Ollama / vLLM',
    format: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    authHeaderName: 'Authorization',
    model: 'qwen2.5-coder:14b',
  },
];

export const CodeWorkspaceView: React.FC = () => {
  const { showNotification } = useApp();

  // --- Layout State ---
  const [layoutMode, setLayoutMode] = useState<'split' | 'editor' | 'chat'>('split');
  const [activeLeftTab, setActiveLeftTab] = useState<'files' | 'git' | 'mcp'>('files');

  // --- Repository Files State ---
  const [repoTree, setRepoTree] = useState<any[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src', 'worker']));
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string>('src/App.tsx');
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);

  // --- Git State ---
  const [gitStatus, setGitStatus] = useState<any>({
    branch: 'main',
    clean: true,
    staged: [],
    modified: [],
    untracked: [],
    ahead: 0,
    behind: 0,
  });
  const [gitDiff, setGitDiff] = useState<string>('');
  const [isGitDiffOpen, setIsGitDiffOpen] = useState(false);
  const [isPushModalOpen, setIsPushModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [isCommittingOrPushing, setIsCommittingOrPushing] = useState(false);

  // --- Model & Manual API Connection State ---
  const [models, setModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('qwen-2.5-coder-14b');
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [manualFormat, setManualFormat] = useState<string>(() => {
    try {
      return localStorage.getItem('aetheros_manual_api_format') || 'openai_compatible';
    } catch {
      return 'openai_compatible';
    }
  });
  const [externalEndpoint, setExternalEndpoint] = useState<string>(() => {
    try {
      return localStorage.getItem('aetheros_manual_api_endpoint') || 'https://api.openai.com/v1/chat/completions';
    } catch {
      return 'https://api.openai.com/v1/chat/completions';
    }
  });
  const [externalApiKey, setExternalApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('aetheros_manual_api_key') || '';
    } catch {
      return '';
    }
  });
  const [authHeaderName, setAuthHeaderName] = useState<string>(() => {
    try {
      return localStorage.getItem('aetheros_manual_api_header') || 'Authorization';
    } catch {
      return 'Authorization';
    }
  });
  const [externalModelName, setExternalModelName] = useState<string>(() => {
    try {
      return localStorage.getItem('aetheros_manual_api_model') || 'gpt-4o';
    } catch {
      return 'gpt-4o';
    }
  });
  const [temperature, setTemperature] = useState(0.3);
  const [maxTokens, setMaxTokens] = useState(3000);
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<{
    success: boolean;
    message: string;
    latency_ms?: number;
  } | null>(null);

  // --- MCP (Model Context Protocol) State ---
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [mcpTemplates, setMcpTemplates] = useState<any[]>([]);
  const [mcpTools, setMcpTools] = useState<any[]>([]);
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
  const [mcpModalTab, setMcpModalTab] = useState<'connected' | 'popular' | 'tools' | 'custom'>('connected');
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpProvider, setNewMcpProvider] = useState('Custom MCP');
  const [newMcpEndpoint, setNewMcpEndpoint] = useState('');
  const [newMcpTransport, setNewMcpTransport] = useState<'http' | 'sse'>('http');
  const [newMcpApiKey, setNewMcpApiKey] = useState('');
  const [configuringServerId, setConfiguringServerId] = useState<string | null>(null);
  const [serverConfigValues, setServerConfigValues] = useState<Record<string, string>>({});
  const [toolExecutionOutput, setToolExecutionOutput] = useState<{
    tool: string;
    result: any;
    error?: string;
  } | null>(null);
  const [isExecutingMcpTool, setIsExecutingMcpTool] = useState(false);

  // --- Coding Assistant Chat State ---
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      content: `Welcome to **AetherOS Code Studio**!\n\n- **Distributed GPU Runtime:** \`qwen-2.5-coder-14b\` (Kaggle T4×2)\n- **Manual API Connection:** Connect OpenAI, Anthropic, Cloudflare Workers AI, OpenRouter, Groq, or Local Ollama/vLLM endpoints\n- **Connected MCP Servers:** Cloudflare (Workers/D1/R2), GitHub, Filesystem, Git Operations, Web Recon & Host Telemetry\n\nSelect a file from the explorer, test an MCP tool, or ask me to inspect and refactor your repository.`,
      model: 'qwen-2.5-coder-14b',
      provider: 'kaggle',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [userInput, setUserInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [includeActiveFileInContext, setIncludeActiveFileInContext] = useState(true);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // --- Initial Data Loading ---
  useEffect(() => {
    loadRepositoryTree();
    loadGitStatus();
    loadMcpData();
    loadAvailableModels();
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isGenerating]);

  // Load models from server
  const loadAvailableModels = async () => {
    try {
      const res = await apiClient.getAiModels();
      if (res.models) {
        setModels(res.models);
      }
      if (res.manual_api_config) {
        const cfg = res.manual_api_config;
        if (cfg.endpoint && !localStorage.getItem('aetheros_manual_api_endpoint')) {
          setExternalEndpoint(cfg.endpoint);
        }
        if (cfg.model && !localStorage.getItem('aetheros_manual_api_model')) {
          setExternalModelName(cfg.model);
        }
      }
    } catch {
      setModels([
        { id: 'qwen-2.5-coder-14b', name: 'Qwen 2.5 Coder 14B (Kaggle T4×2 GPU)' },
        { id: 'deepseek-coder-v2-16b', name: 'DeepSeek Coder V2 16B Lite (Kaggle GPU)' },
        { id: 'manual-api', name: 'Manual API Connection (OpenAI / Anthropic / Cloudflare / Custom)' },
      ]);
    }
  };

  // Load repo tree
  const loadRepositoryTree = async () => {
    try {
      const tree = await apiClient.getRepoTree(4);
      setRepoTree(tree);
      if (openTabs.length === 0) {
        await handleOpenFile('src/App.tsx');
      }
    } catch (err: any) {
      console.error('Failed to load repo tree:', err);
    }
  };

  // Load git status & diff
  const loadGitStatus = async () => {
    try {
      const status = await apiClient.getGitStatus();
      setGitStatus(status);
      const diffRes = await apiClient.getGitDiff();
      setGitDiff(diffRes.diff);
    } catch (err: any) {
      console.error('Failed to load git status:', err);
    }
  };

  // Load MCP servers, templates & tools
  const loadMcpData = async () => {
    try {
      const [servers, templates, tools] = await Promise.all([
        apiClient.getMcpServers(),
        apiClient.getMcpTemplates(),
        apiClient.getMcpTools(),
      ]);
      setMcpServers(servers);
      setMcpTemplates(templates);
      setMcpTools(tools);
    } catch (err: any) {
      console.error('Failed to load MCP servers:', err);
    }
  };

  // Open file in editor tab
  const handleOpenFile = async (filePath: string) => {
    const existing = openTabs.find((t) => t.path === filePath);
    if (existing) {
      setActiveTabPath(filePath);
      return;
    }

    setIsLoadingFile(true);
    try {
      const fileData = await apiClient.readRepoFile(filePath);
      const newTab: OpenTab = {
        path: filePath,
        name: filePath.split('/').pop() || filePath,
        content: fileData.content,
        language: fileData.language || 'typescript',
      };
      setOpenTabs((prev) => [...prev, newTab]);
      setActiveTabPath(filePath);
    } catch (err: any) {
      showNotification(`Failed to open file: ${err.message}`, 'error');
    } finally {
      setIsLoadingFile(false);
    }
  };

  const handleCloseTab = (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextTabs = openTabs.filter((t) => t.path !== filePath);
    setOpenTabs(nextTabs);
    if (activeTabPath === filePath) {
      setActiveTabPath(nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].path : '');
    }
  };

  const handleEditorContentChange = (newContent: string) => {
    setOpenTabs((prev) =>
      prev.map((t) => (t.path === activeTabPath ? { ...t, content: newContent, isModified: true } : t))
    );
  };

  // Save current open file
  const handleSaveCurrentFile = async () => {
    const currentTab = openTabs.find((t) => t.path === activeTabPath);
    if (!currentTab) return;

    setIsSavingFile(true);
    try {
      await apiClient.writeRepoFile(currentTab.path, currentTab.content);
      setOpenTabs((prev) =>
        prev.map((t) => (t.path === activeTabPath ? { ...t, isModified: false } : t))
      );
      showNotification(`Saved ${currentTab.name}`, 'success');
      await loadGitStatus();
    } catch (err: any) {
      showNotification(`Failed to save: ${err.message}`, 'error');
    } finally {
      setIsSavingFile(false);
    }
  };

  // Commit and push
  const handleCommitAndPush = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) {
      showNotification('Commit message is required', 'error');
      return;
    }

    setIsCommittingOrPushing(true);
    try {
      const commitRes = await apiClient.commitGit(commitMessage.trim(), true);
      showNotification(`Committed [${commitRes.commitHash}]: ${commitRes.message}`, 'success');

      await apiClient.pushGit({
        branch: gitStatus.branch || 'main',
        token: githubToken.trim() || undefined,
      });

      showNotification('Pushed to remote repository successfully', 'success');
      setIsPushModalOpen(false);
      setCommitMessage('');
      await loadGitStatus();
    } catch (err: any) {
      showNotification(`Git error: ${err.message}`, 'error');
    } finally {
      setIsCommittingOrPushing(false);
    }
  };

  // Apply Manual API Preset
  const handleApplyApiPreset = (preset: (typeof MANUAL_API_PRESETS)[number]) => {
    setManualFormat(preset.format);
    setExternalEndpoint(preset.endpoint);
    setAuthHeaderName(preset.authHeaderName);
    setExternalModelName(preset.model);
    setSelectedModel('manual-api');
    setApiTestResult(null);
  };

  // Save Manual API Configuration
  const handleSaveManualConfig = async () => {
    try {
      localStorage.setItem('aetheros_manual_api_format', manualFormat);
      localStorage.setItem('aetheros_manual_api_endpoint', externalEndpoint);
      localStorage.setItem('aetheros_manual_api_key', externalApiKey);
      localStorage.setItem('aetheros_manual_api_header', authHeaderName);
      localStorage.setItem('aetheros_manual_api_model', externalModelName);
    } catch {}

    try {
      await apiClient.saveManualApiConfig({
        format: manualFormat,
        endpoint: externalEndpoint,
        apiKey: externalApiKey,
        authHeaderName,
        model: externalModelName,
        temperature,
        maxTokens,
      });
      showNotification('Manual API Connection saved', 'success');
      setIsConfigModalOpen(false);
    } catch (err: any) {
      showNotification(`Saved locally (${err.message})`, 'info');
      setIsConfigModalOpen(false);
    }
  };

  // Test Manual API Connection
  const handleTestManualApi = async () => {
    setIsTestingApi(true);
    setApiTestResult(null);
    try {
      const res = await apiClient.testManualApiConnection({
        format: manualFormat,
        endpoint: externalEndpoint,
        apiKey: externalApiKey,
        authHeaderName,
        model: externalModelName,
      });
      setApiTestResult({
        success: res.success,
        message: res.message,
        latency_ms: res.latency_ms,
      });
    } catch (err: any) {
      setApiTestResult({
        success: false,
        message: err.message || 'Connection test failed',
      });
    } finally {
      setIsTestingApi(false);
    }
  };

  // Send message to coding assistant
  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || userInput).trim();
    if (!query || isGenerating) return;

    const userMsg: ChatMessage = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setUserInput('');
    setIsGenerating(true);

    const currentTab = openTabs.find((t) => t.path === activeTabPath);

    try {
      const response = await apiClient.sendAiStudioChat({
        message: query,
        model: selectedModel,
        externalApi:
          selectedModel === 'manual-api'
            ? {
                format: manualFormat,
                endpoint: externalEndpoint,
                apiKey: externalApiKey,
                authHeaderName,
                model: externalModelName,
                temperature,
                maxTokens,
              }
            : undefined,
        currentFile:
          includeActiveFileInContext && currentTab
            ? {
                path: currentTab.path,
                content: currentTab.content,
                language: currentTab.language,
              }
            : undefined,
        history: chatMessages.slice(-6).map((m) => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
      });

      const assistantMsg: ChatMessage = {
        id: `asst_${Date.now()}`,
        sender: 'assistant',
        content: response.response,
        model: response.model,
        provider: response.provider,
        toolCalls: response.tool_calls_executed,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setChatMessages((prev) => [...prev, assistantMsg]);
      await loadGitStatus();
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        sender: 'assistant',
        content: `Error: ${err.message || 'Failed to generate response'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsGenerating(false);
    }
  };

  // Connect a Popular MCP Template
  const handleConnectTemplate = async (tpl: any) => {
    try {
      await apiClient.addMcpServer({
        templateId: tpl.id,
        name: tpl.name,
        description: tpl.description,
        endpoint: tpl.defaultEndpoint,
        transport: tpl.transport,
        provider: tpl.provider,
        category: tpl.category,
      });
      showNotification(`Connected ${tpl.name}`, 'success');
      await loadMcpData();
      setMcpModalTab('connected');
    } catch (err: any) {
      showNotification(err.message, 'error');
    }
  };

  // Add custom MCP Server
  const handleAddMcpServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMcpName.trim() || !newMcpEndpoint.trim()) return;

    try {
      await apiClient.addMcpServer({
        name: newMcpName.trim(),
        provider: newMcpProvider.trim() || 'Custom MCP',
        description: `Manual ${newMcpTransport.toUpperCase()} MCP Connection`,
        endpoint: newMcpEndpoint.trim(),
        transport: newMcpTransport,
        config: newMcpApiKey.trim() ? { API_KEY: newMcpApiKey.trim() } : undefined,
      });
      showNotification(`Connected MCP Server: ${newMcpName}`, 'success');
      setNewMcpName('');
      setNewMcpEndpoint('');
      setNewMcpApiKey('');
      await loadMcpData();
      setMcpModalTab('connected');
    } catch (err: any) {
      showNotification(err.message, 'error');
    }
  };

  // Save credentials on an MCP server (e.g. Cloudflare API Token, GitHub PAT)
  const handleSaveServerConfig = async (serverId: string) => {
    try {
      await apiClient.configureMcpServer(serverId, serverConfigValues);
      showNotification('MCP credentials updated', 'success');
      setConfiguringServerId(null);
      setServerConfigValues({});
      await loadMcpData();
    } catch (err: any) {
      showNotification(err.message, 'error');
    }
  };

  // Toggle MCP server enabled/disabled
  const handleToggleMcpServer = async (id: string, currentEnabled: boolean) => {
    try {
      await apiClient.toggleMcpServer(id, !currentEnabled);
      await loadMcpData();
    } catch (err: any) {
      showNotification(err.message, 'error');
    }
  };

  // Remove custom MCP server
  const handleRemoveMcpServer = async (id: string) => {
    try {
      await apiClient.removeMcpServer(id);
      showNotification('Removed custom MCP server', 'info');
      await loadMcpData();
    } catch (err: any) {
      showNotification(err.message, 'error');
    }
  };

  // Execute an MCP tool directly
  const handleRunMcpTool = async (toolName: string, defaultArgs: Record<string, any> = {}) => {
    setIsExecutingMcpTool(true);
    setToolExecutionOutput(null);
    try {
      const res = await apiClient.executeMcpTool(toolName, defaultArgs);
      setToolExecutionOutput({
        tool: toolName,
        result: res.result,
        error: res.error,
      });
      showNotification(`Executed MCP tool: ${toolName}`, res.success ? 'success' : 'error');
    } catch (err: any) {
      setToolExecutionOutput({
        tool: toolName,
        result: null,
        error: err.message,
      });
    } finally {
      setIsExecutingMcpTool(false);
    }
  };

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  const currentTab = openTabs.find((t) => t.path === activeTabPath);

  // Render tree node recursively
  const renderTreeNode = (node: any) => {
    const isExpanded = expandedFolders.has(node.path);
    const isSelected = activeTabPath === node.path;

    if (node.type === 'dir') {
      return (
        <div key={node.path} className="select-none">
          <div
            onClick={() => toggleFolder(node.path)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded cursor-pointer transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </div>
          {isExpanded && node.children && (
            <div className="pl-3.5 border-l border-slate-200 dark:border-slate-800 ml-2 space-y-0.5">
              {node.children.map(renderTreeNode)}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        onClick={() => handleOpenFile(node.path)}
        className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded cursor-pointer transition-colors select-none ${
          isSelected
            ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-medium'
            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-slate-200'
        }`}
      >
        <FileCode className="w-3.5 h-3.5 shrink-0 text-slate-400" />
        <span className="truncate">{node.name}</span>
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-5.5rem)] flex flex-col w-full max-w-full overflow-hidden bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs">
      {/* ======================================================== */}
      {/* TOP COMMAND BAR (AetherOS Code Studio Header) */}
      {/* ======================================================== */}
      <div className="h-13 border-b border-slate-200 dark:border-slate-800 px-3 sm:px-4 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-900/70 shrink-0 min-w-0">
        {/* Left: Title & Repo Git Branch status */}
        <div className="flex items-center gap-3 shrink-0 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-2xs shrink-0">
              <Code2 className="w-4 h-4" />
            </div>
            <div className="hidden sm:block">
              <span className="text-xs font-bold text-slate-900 dark:text-white">AetherOS Code Studio</span>
            </div>
          </div>

          {/* Git Branch Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300">
            <GitBranch className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span className="font-semibold">{gitStatus.branch || 'main'}</span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            {gitStatus.clean ? (
              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Check className="w-3 h-3" />
                <span>clean</span>
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">
                {gitStatus.modified.length + gitStatus.untracked.length} modified
              </span>
            )}
          </div>
        </div>

        {/* Middle: Model Selector, Manual API Connection & MCP Hub */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => {
                setSelectedModel(e.target.value);
                if (e.target.value === 'manual-api') {
                  setIsConfigModalOpen(true);
                }
              }}
              className="py-1.5 pl-2.5 pr-7 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs truncate max-w-[175px] sm:max-w-none"
            >
              <optgroup label="Distributed Kaggle GPU Fleet">
                <option value="qwen-2.5-coder-14b">Qwen 2.5 Coder 14B (T4×2)</option>
                <option value="deepseek-coder-v2-16b">DeepSeek Coder V2 16B</option>
              </optgroup>
              <optgroup label="Manual API Connection">
                <option value="manual-api">
                  Manual API ({externalModelName || 'Custom Endpoint'})
                </option>
              </optgroup>
            </select>
          </div>

          {/* Dedicated Manual API Connection Button */}
          <button
            onClick={() => setIsConfigModalOpen(true)}
            title="Configure Manual API Connection (OpenAI, Anthropic, Cloudflare, Custom)"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              selectedModel === 'manual-api'
                ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-400'
            }`}
          >
            <Plug className="w-3.5 h-3.5 text-blue-500" />
            <span className="hidden md:inline">Manual API</span>
          </button>

          {/* MCP Connections Hub Button */}
          <button
            onClick={() => setIsMcpModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 hover:bg-purple-100 transition-colors"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden md:inline">MCP Hub</span>
            <span className="px-1.5 py-0.2 rounded-full bg-purple-200 dark:bg-purple-900 text-[10px] font-mono">
              {mcpServers.filter((s) => s.is_enabled).length}
            </span>
          </button>

          {/* Git Commit & Push Button */}
          <button
            onClick={() => setIsPushModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs transition-colors"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Commit & Push</span>
          </button>
        </div>

        {/* Right: Layout Switcher */}
        <div className="hidden lg:flex items-center gap-1 p-1 bg-slate-200/60 dark:bg-slate-800 rounded-lg text-xs">
          <button
            onClick={() => setLayoutMode('split')}
            className={`px-2 py-1 rounded-md font-medium transition-colors ${
              layoutMode === 'split'
                ? 'bg-white dark:bg-slate-900 shadow-2xs font-semibold text-blue-600'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Split
          </button>
          <button
            onClick={() => setLayoutMode('editor')}
            className={`px-2 py-1 rounded-md font-medium transition-colors ${
              layoutMode === 'editor'
                ? 'bg-white dark:bg-slate-900 shadow-2xs font-semibold text-blue-600'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Editor
          </button>
          <button
            onClick={() => setLayoutMode('chat')}
            className={`px-2 py-1 rounded-md font-medium transition-colors ${
              layoutMode === 'chat'
                ? 'bg-white dark:bg-slate-900 shadow-2xs font-semibold text-blue-600'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Chat
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MAIN VIEWPORT: 3-PANEL LAYOUT */}
      {/* ======================================================== */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* PANEL 1: LEFT SIDEBAR (FILES, GIT & MCP CONNECTIONS) */}
        {layoutMode !== 'chat' && (
          <div className="w-64 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-900/30 shrink-0 overflow-hidden">
            {/* Left Tabs */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 text-xs font-semibold bg-slate-100/70 dark:bg-slate-900/60">
              <button
                onClick={() => setActiveLeftTab('files')}
                className={`flex-1 py-2 text-center transition-colors flex items-center justify-center gap-1 ${
                  activeLeftTab === 'files'
                    ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Files</span>
              </button>
              <button
                onClick={() => setActiveLeftTab('git')}
                className={`flex-1 py-2 text-center transition-colors flex items-center justify-center gap-1 ${
                  activeLeftTab === 'git'
                    ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>Git</span>
                {!gitStatus.clean && <span className="w-2 h-2 rounded-full bg-amber-500" />}
              </button>
              <button
                onClick={() => setActiveLeftTab('mcp')}
                className={`flex-1 py-2 text-center transition-colors flex items-center justify-center gap-1 ${
                  activeLeftTab === 'mcp'
                    ? 'border-b-2 border-purple-600 text-purple-600 dark:text-purple-400 bg-white dark:bg-slate-900'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>MCP</span>
              </button>
            </div>

            {/* Left Content Area */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {activeLeftTab === 'files' && (
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between px-2 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <span>Repository Explorer</span>
                    <button onClick={loadRepositoryTree} title="Refresh tree">
                      <RefreshCw className="w-3 h-3 hover:text-slate-600" />
                    </button>
                  </div>
                  {repoTree.map(renderTreeNode)}
                </div>
              )}

              {activeLeftTab === 'git' && (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between px-2 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <span>Working Tree</span>
                    <button onClick={loadGitStatus} title="Refresh status">
                      <RefreshCw className="w-3 h-3 hover:text-slate-600" />
                    </button>
                  </div>

                  {/* Modified Files */}
                  <div>
                    <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 px-2 mb-1">
                      Modified ({gitStatus.modified.length})
                    </div>
                    {gitStatus.modified.length === 0 ? (
                      <div className="px-2 text-[11px] text-slate-400 italic">None</div>
                    ) : (
                      gitStatus.modified.map((file: string) => (
                        <div
                          key={file}
                          onClick={() => handleOpenFile(file)}
                          className="px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate"
                        >
                          {file}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Untracked Files */}
                  <div>
                    <div className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 px-2 mb-1">
                      Untracked ({gitStatus.untracked.length})
                    </div>
                    {gitStatus.untracked.length === 0 ? (
                      <div className="px-2 text-[11px] text-slate-400 italic">None</div>
                    ) : (
                      gitStatus.untracked.map((file: string) => (
                        <div
                          key={file}
                          onClick={() => handleOpenFile(file)}
                          className="px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate"
                        >
                          {file}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 px-2 space-y-1.5">
                    <button
                      onClick={() => setIsGitDiffOpen(true)}
                      className="w-full py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                    >
                      Inspect Full Git Diff
                    </button>
                  </div>
                </div>
              )}

              {activeLeftTab === 'mcp' && (
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between px-2 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <span>Active MCP Servers</span>
                    <button
                      onClick={() => setIsMcpModalOpen(true)}
                      className="text-purple-600 dark:text-purple-400 hover:underline font-semibold text-[11px] normal-case"
                    >
                      + Manage
                    </button>
                  </div>

                  {mcpServers.map((s) => (
                    <div
                      key={s.id}
                      className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-slate-900 dark:text-white truncate text-[11px]">
                          {s.name}
                        </span>
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            s.is_enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                          }`}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                        <span>{s.provider || s.transport}</span>
                        <span>{s.tools?.length || 0} tools</span>
                      </div>
                      <div className="pt-1 flex flex-wrap gap-1">
                        {(s.tools || []).slice(0, 2).map((t: any) => (
                          <button
                            key={t.name}
                            onClick={() => {
                              setIsMcpModalOpen(true);
                              setMcpModalTab('tools');
                              handleRunMcpTool(t.name, {});
                            }}
                            className="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-mono text-[10px] hover:bg-purple-100"
                          >
                            ▶ {t.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={() => {
                      setIsMcpModalOpen(true);
                      setMcpModalTab('popular');
                    }}
                    className="w-full py-2 px-3 rounded-xl border border-dashed border-purple-300 dark:border-purple-800 text-purple-600 dark:text-purple-400 font-semibold text-xs hover:bg-purple-50/40 dark:hover:bg-purple-950/30 transition-colors"
                  >
                    + Add Cloudflare / GitHub / Popular MCP
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* PANEL 2: CENTER CODE EDITOR & TABS */}
        {layoutMode !== 'chat' && (
          <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-950 overflow-hidden">
            {/* File Tabs Strip */}
            <div className="h-10 border-b border-slate-200 dark:border-slate-800 flex items-center bg-slate-100/50 dark:bg-slate-900/40 px-2 overflow-x-auto shrink-0">
              {openTabs.map((tab) => {
                const isActive = tab.path === activeTabPath;
                return (
                  <div
                    key={tab.path}
                    onClick={() => setActiveTabPath(tab.path)}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded-t-lg border-t-2 cursor-pointer transition-colors shrink-0 ${
                      isActive
                        ? 'border-blue-600 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-semibold shadow-2xs'
                        : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    <span>{tab.name}</span>
                    {tab.isModified && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                    <button
                      onClick={(e) => handleCloseTab(tab.path, e)}
                      className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}

              {openTabs.length === 0 && (
                <div className="text-xs text-slate-400 italic px-2">No files open</div>
              )}
            </div>

            {/* Code Editor Viewport */}
            {currentTab ? (
              <div className="flex-1 flex flex-col min-h-0 relative">
                {/* Code Editor Action Bar */}
                <div className="h-8 border-b border-slate-100 dark:border-slate-800/80 px-3 flex items-center justify-between text-[11px] text-slate-400 font-mono bg-white dark:bg-slate-950 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-600 dark:text-slate-300 font-semibold">{currentTab.path}</span>
                    <span>·</span>
                    <span>{currentTab.language}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {currentTab.isModified && <span className="text-amber-500">Unsaved changes</span>}
                    <button
                      onClick={handleSaveCurrentFile}
                      disabled={isSavingFile}
                      className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                    >
                      <Save className="w-3 h-3" />
                      <span>{isSavingFile ? 'Saving...' : 'Save File'}</span>
                    </button>
                  </div>
                </div>

                {/* Editor textarea */}
                <div className="flex-1 overflow-auto flex">
                  <div className="w-10 bg-slate-50 dark:bg-slate-900/50 py-3 text-right pr-2 text-xs font-mono text-slate-400 select-none shrink-0 border-r border-slate-100 dark:border-slate-800/80">
                    {currentTab.content.split('\n').map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  <textarea
                    value={currentTab.content}
                    onChange={(e) => handleEditorContentChange(e.target.value)}
                    spellCheck={false}
                    className="flex-1 p-3 text-xs font-mono leading-relaxed bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 resize-none focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs p-6">
                <FileCode className="w-10 h-10 mb-2 opacity-50 text-blue-500" />
                <p>Select a file from the repository explorer on the left</p>
              </div>
            )}
          </div>
        )}

        {/* PANEL 3: RIGHT CODING ASSISTANT */}
        {layoutMode !== 'editor' && (
          <div className="w-full lg:w-[460px] xl:w-[500px] border-l border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-900/20 shrink-0 overflow-hidden">
            {/* Assistant Header */}
            <div className="h-10 border-b border-slate-200 dark:border-slate-800 px-3 flex items-center justify-between text-xs bg-white dark:bg-slate-950 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Cpu className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="font-semibold text-slate-900 dark:text-white truncate">Coding Assistant</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 truncate">
                  {selectedModel === 'manual-api' ? externalModelName || 'manual-api' : selectedModel}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeActiveFileInContext}
                    onChange={(e) => setIncludeActiveFileInContext(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span>Attach open file</span>
                </label>
              </div>
            </div>

            {/* Chat Messages Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1 px-1">
                    {msg.sender === 'user' ? (
                      <>
                        <span>You</span>
                        <span>·</span>
                        <span>{msg.timestamp}</span>
                      </>
                    ) : (
                      <>
                        <Cpu className="w-3 h-3 text-blue-500" />
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {msg.model || 'AetherOS Code Engine'}
                        </span>
                        <span>·</span>
                        <span>{msg.timestamp}</span>
                      </>
                    )}
                  </div>

                  <div
                    className={`max-w-[95%] p-3.5 rounded-2xl text-xs leading-relaxed ${
                      msg.sender === 'user'
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs space-y-2'
                    }`}
                  >
                    {/* Tool Calls Execution Accordion */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mb-2 p-2 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-400">
                          <Wrench className="w-3 h-3 text-purple-500" />
                          <span>Executed MCP Tools ({msg.toolCalls.length})</span>
                        </div>
                        {msg.toolCalls.map((tc, idx) => (
                          <div key={idx} className="text-[10px] font-mono text-slate-500 flex items-center justify-between">
                            <span className="text-blue-600 dark:text-blue-400">{tc.name}()</span>
                            <span className="text-emerald-600">verified</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="whitespace-pre-wrap font-sans">{msg.content}</div>

                    {/* Quick insert to editor if contains code block */}
                    {msg.content.includes('```') && currentTab && (
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex justify-end">
                        <button
                          onClick={() => {
                            const codeMatch = msg.content.match(/```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)```/);
                            if (codeMatch && codeMatch[1]) {
                              handleEditorContentChange(codeMatch[1]);
                              showNotification(`Inserted code block into ${currentTab.name}`, 'info');
                            }
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-lg transition-colors flex items-center gap-1"
                        >
                          <Copy className="w-3 h-3" />
                          <span>Apply Code to Editor</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isGenerating && (
                <div className="flex items-center gap-2 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs text-slate-500 animate-pulse">
                  <Cpu className="w-4 h-4 text-blue-500" />
                  <span>Synthesizing response with MCP context...</span>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Quick Prompt Suggestions */}
            <div className="px-3 py-1.5 border-t border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-950/60 flex items-center gap-1.5 overflow-x-auto text-[11px] shrink-0">
              <button
                onClick={() => handleSendMessage('Inspect wrangler.toml and Cloudflare D1 schema tables.')}
                className="whitespace-nowrap px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cloudflare bindings & D1
              </button>
              <button
                onClick={() => handleSendMessage('Check git status and recent GitHub commits.')}
                className="whitespace-nowrap px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Git status & commits
              </button>
              <button
                onClick={() => handleSendMessage('Explain the architecture of the open file and suggest improvements.')}
                className="whitespace-nowrap px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Analyze active file
              </button>
            </div>

            {/* Input Box */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="relative"
              >
                <textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Ask Coding Assistant to inspect repo, invoke Cloudflare/GitHub MCP, or write code..."
                  rows={2}
                  className="w-full pl-3 pr-10 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
                <button
                  type="submit"
                  disabled={isGenerating || !userInput.trim()}
                  className="absolute right-2.5 bottom-3.5 p-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* MODAL 1: GIT COMMIT & PUSH DIALOG */}
      {/* ======================================================== */}
      {isPushModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <UploadCloud className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Git Commit & Push</h3>
              </div>
              <button onClick={() => setIsPushModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            <form onSubmit={handleCommitAndPush} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Commit Message
                </label>
                <input
                  type="text"
                  required
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="e.g. feat: add Manual API connection and Cloudflare/GitHub MCP"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Target Branch
                </label>
                <input
                  type="text"
                  disabled
                  value={gitStatus.branch || 'main'}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/50 text-slate-500 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  GitHub Personal Access Token (Optional)
                </label>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="ghp_••••••••••••••••••••••••••••••••••••"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Only required if pushing to a remote that requires authenticated credentials.
                </p>
              </div>

              <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl text-blue-800 dark:text-blue-300 flex items-center justify-between">
                <span>Changed Files:</span>
                <span className="font-mono font-bold">
                  {gitStatus.modified.length + gitStatus.untracked.length} files
                </span>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isCommittingOrPushing}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold flex items-center justify-center gap-2"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>{isCommittingOrPushing ? 'Pushing to remote...' : 'Commit & Push Now'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: MCP CONNECTIONS HUB (CLOUDFLARE, GITHUB & POPULAR) */}
      {/* ======================================================== */}
      {isMcpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Model Context Protocol (MCP) Connections Hub
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Connect Cloudflare, GitHub, PostgreSQL, Sentry, Slack, Linear, HuggingFace & custom JSON-RPC servers
                  </p>
                </div>
              </div>
              <button onClick={() => setIsMcpModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            {/* Modal Sub-Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 text-xs font-semibold shrink-0">
              <button
                onClick={() => setMcpModalTab('connected')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  mcpModalTab === 'connected'
                    ? 'bg-purple-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                Connected MCPs ({mcpServers.length})
              </button>
              <button
                onClick={() => setMcpModalTab('popular')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  mcpModalTab === 'popular'
                    ? 'bg-purple-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                Popular MCP Catalog ({mcpTemplates.length})
              </button>
              <button
                onClick={() => setMcpModalTab('tools')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  mcpModalTab === 'tools'
                    ? 'bg-purple-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                Live Tools & Runner ({mcpTools.length})
              </button>
              <button
                onClick={() => setMcpModalTab('custom')}
                className={`px-3 py-1.5 rounded-lg transition-colors ${
                  mcpModalTab === 'custom'
                    ? 'bg-purple-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                + Manual MCP Endpoint
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 text-xs pr-1">
              {/* TAB 1: CONNECTED MCP SERVERS */}
              {mcpModalTab === 'connected' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {mcpServers.map((s) => (
                    <div
                      key={s.id}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 space-y-2.5 flex flex-col justify-between"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-white text-xs">{s.name}</span>
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-mono">
                              {s.provider || s.transport}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleToggleMcpServer(s.id, s.is_enabled)}
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                s.is_enabled
                                  ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                              }`}
                            >
                              {s.is_enabled ? 'Enabled' : 'Disabled'}
                            </button>
                            {s.transport !== 'builtin' && (
                              <button
                                onClick={() => handleRemoveMcpServer(s.id)}
                                className="p-1 text-slate-400 hover:text-rose-500"
                                title="Remove custom MCP"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-500 leading-relaxed">{s.description}</p>

                        {s.endpoint && (
                          <div className="text-[10px] font-mono text-slate-400 truncate">
                            Endpoint: {s.endpoint}
                          </div>
                        )}
                      </div>

                      {/* Credentials Configuration Drawer */}
                      {s.config_fields && s.config_fields.length > 0 && (
                        <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800">
                          {configuringServerId === s.id ? (
                            <div className="space-y-2 bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                              {s.config_fields.map((field: any) => (
                                <div key={field.key}>
                                  <label className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-0.5">
                                    {field.label}
                                  </label>
                                  <input
                                    type={field.secret ? 'password' : 'text'}
                                    placeholder={field.placeholder}
                                    value={serverConfigValues[field.key] || ''}
                                    onChange={(e) =>
                                      setServerConfigValues((prev) => ({
                                        ...prev,
                                        [field.key]: e.target.value,
                                      }))
                                    }
                                    className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
                                  />
                                </div>
                              ))}
                              <div className="flex justify-end gap-1.5 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setConfiguringServerId(null)}
                                  className="px-2.5 py-1 rounded text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveServerConfig(s.id)}
                                  className="px-2.5 py-1 rounded text-[11px] font-semibold bg-purple-600 text-white hover:bg-purple-700"
                                >
                                  Save Credentials
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono text-slate-500">
                                {s.configured_keys && s.configured_keys.length > 0
                                  ? `Configured: ${s.configured_keys.join(', ')}`
                                  : `${s.tools?.length || 0} tools ready`}
                              </span>
                              <button
                                onClick={() => {
                                  setConfiguringServerId(s.id);
                                  setServerConfigValues({});
                                }}
                                className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                              >
                                <Key className="w-3 h-3" />
                                <span>Configure API Keys</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 2: POPULAR MCP CATALOG (CLOUDFLARE, GITHUB, POSTGRES, SENTRY, SLACK, LINEAR, HF) */}
              {mcpModalTab === 'popular' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {mcpTemplates.map((tpl) => {
                    const alreadyConnected = mcpServers.some((s) => s.name === tpl.name);
                    return (
                      <div
                        key={tpl.id}
                        className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950 flex flex-col justify-between space-y-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900 dark:text-white">{tpl.name}</span>
                            <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 font-mono text-[10px]">
                              {tpl.provider}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">{tpl.description}</p>
                          <div className="text-[10px] font-mono text-slate-400 pt-1">
                            Endpoint: {tpl.defaultEndpoint} ({tpl.transport.toUpperCase()})
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-slate-800">
                          <span className="text-[10px] text-slate-400 font-mono">
                            {tpl.tools?.length || 1} tools · {tpl.configFields?.length || 0} auth keys
                          </span>
                          <button
                            disabled={alreadyConnected}
                            onClick={() => handleConnectTemplate(tpl)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                              alreadyConnected
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 cursor-default'
                                : 'bg-purple-600 hover:bg-purple-700 text-white'
                            }`}
                          >
                            {alreadyConnected ? '✓ Connected' : '+ Connect MCP'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* TAB 3: LIVE MCP TOOLS & INTERACTIVE RUNNER */}
              {mcpModalTab === 'tools' && (
                <div className="space-y-4">
                  {toolExecutionOutput && (
                    <div className="p-3.5 rounded-xl bg-slate-950 text-slate-100 border border-slate-800 space-y-1.5 font-mono text-[11px]">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-emerald-400">
                          MCP Tool Output: {toolExecutionOutput.tool}()
                        </span>
                        <button
                          onClick={() => setToolExecutionOutput(null)}
                          className="text-slate-400 hover:text-white"
                        >
                          Clear
                        </button>
                      </div>
                      {toolExecutionOutput.error ? (
                        <div className="text-rose-400">{toolExecutionOutput.error}</div>
                      ) : (
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-slate-300">
                          {JSON.stringify(toolExecutionOutput.result, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {mcpTools.map((t, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-start justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                              {t.tool?.name}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-900 text-slate-500">
                              {t.serverName}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">{t.tool?.description}</p>
                        </div>
                        <button
                          disabled={isExecutingMcpTool}
                          onClick={() => {
                            const sampleArgs: Record<string, any> = {};
                            if (t.tool?.name === 'read_file') sampleArgs.path = 'package.json';
                            if (t.tool?.name === 'search_code') sampleArgs.query = 'mcpManager';
                            if (t.tool?.name === 'investigate_domain') sampleArgs.target = 'https://example.com';
                            if (t.tool?.name === 'hf_search_models') sampleArgs.query = 'Qwen2.5-Coder';
                            handleRunMcpTool(t.tool?.name, sampleArgs);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/80 hover:bg-purple-100 text-purple-700 dark:text-purple-300 font-mono text-[11px] font-semibold shrink-0"
                        >
                          Run
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 4: ADD MANUAL MCP ENDPOINT */}
              {mcpModalTab === 'custom' && (
                <form
                  onSubmit={handleAddMcpServer}
                  className="p-5 rounded-xl border border-purple-200 dark:border-purple-900/60 bg-purple-50/30 dark:bg-purple-950/20 space-y-4"
                >
                  <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                    Connect Manual MCP Server (HTTP / SSE)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Server Display Name
                      </label>
                      <input
                        type="text"
                        required
                        value={newMcpName}
                        onChange={(e) => setNewMcpName(e.target.value)}
                        placeholder="e.g. Cloudflare Workers MCP"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Provider / Category Label
                      </label>
                      <input
                        type="text"
                        value={newMcpProvider}
                        onChange={(e) => setNewMcpProvider(e.target.value)}
                        placeholder="Cloudflare / GitHub / Custom"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        MCP Server Endpoint URL
                      </label>
                      <input
                        type="url"
                        required
                        value={newMcpEndpoint}
                        onChange={(e) => setNewMcpEndpoint(e.target.value)}
                        placeholder="https://mcp.yourdomain.com/sse"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Transport Protocol
                      </label>
                      <select
                        value={newMcpTransport}
                        onChange={(e) => setNewMcpTransport(e.target.value as 'http' | 'sse')}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                      >
                        <option value="http">HTTP JSON-RPC</option>
                        <option value="sse">Server-Sent Events (SSE)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Bearer Token / API Secret (Optional)
                    </label>
                    <input
                      type="password"
                      value={newMcpApiKey}
                      onChange={(e) => setNewMcpApiKey(e.target.value)}
                      placeholder="Optional authentication token for this MCP server"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-mono"
                    />
                  </div>

                  <button
                    type="submit"
                    className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs"
                  >
                    Connect Manual MCP Server
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: MANUAL API CONNECTION & MODEL CONFIGURATION */}
      {/* ======================================================== */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Plug className="w-4 h-4 text-blue-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Manual API Connection & Runtime Settings
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Connect OpenAI, Anthropic, Cloudflare Workers AI, OpenRouter, Groq, or custom REST endpoints
                  </p>
                </div>
              </div>
              <button onClick={() => setIsConfigModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Execution Mode / Active Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-semibold"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quick Provider Presets */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  1-Click Manual API Templates
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {MANUAL_API_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleApplyApiPreset(preset)}
                      className={`px-2.5 py-1.5 rounded-lg border text-left text-[11px] font-medium transition-colors ${
                        externalEndpoint === preset.endpoint && selectedModel === 'manual-api'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Manual API Connection Fields */}
              <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      API Payload Format
                    </label>
                    <select
                      value={manualFormat}
                      onChange={(e) => setManualFormat(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    >
                      <option value="openai_compatible">OpenAI Chat Completions</option>
                      <option value="anthropic">Anthropic Messages API</option>
                      <option value="cloudflare_workers_ai">Cloudflare Workers AI</option>
                      <option value="ollama">Ollama / vLLM Local</option>
                      <option value="custom_rest">Custom JSON REST</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Auth Header Name
                    </label>
                    <input
                      type="text"
                      value={authHeaderName}
                      onChange={(e) => setAuthHeaderName(e.target.value)}
                      placeholder="Authorization or x-api-key"
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Manual API Endpoint URL
                  </label>
                  <input
                    type="url"
                    value={externalEndpoint}
                    onChange={(e) => setExternalEndpoint(e.target.value)}
                    placeholder="https://api.openai.com/v1/chat/completions"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      API Key / Bearer Token
                    </label>
                    <input
                      type="password"
                      value={externalApiKey}
                      onChange={(e) => setExternalApiKey(e.target.value)}
                      placeholder="sk-••••••••••••••••••••"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Model Identifier
                    </label>
                    <input
                      type="text"
                      value={externalModelName}
                      onChange={(e) => setExternalModelName(e.target.value)}
                      placeholder="gpt-4o, claude-3-7-sonnet, qwen2.5-coder"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>

                {/* Test Connection Result */}
                {apiTestResult && (
                  <div
                    className={`p-2.5 rounded-lg border text-[11px] flex items-start gap-2 ${
                      apiTestResult.success
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
                        : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300'
                    }`}
                  >
                    {apiTestResult.success ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                    )}
                    <span className="break-all">{apiTestResult.message}</span>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={isTestingApi || !externalEndpoint.trim()}
                    onClick={handleTestManualApi}
                    className="px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold text-xs hover:bg-blue-100 flex items-center gap-1.5"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>{isTestingApi ? 'Testing Endpoint...' : 'Test Manual Connection'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">
                      Temperature ({temperature})
                    </label>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Max Output Tokens
                  </label>
                  <input
                    type="number"
                    min={256}
                    max={8192}
                    step={256}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    setSelectedModel('manual-api');
                    handleSaveManualConfig();
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                >
                  Save & Activate Manual API
                </button>
                <button
                  onClick={handleSaveManualConfig}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Save Only
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 4: GIT DIFF INSPECTION VIEWER */}
      {/* ======================================================== */}
      {isGitDiffOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Working Tree Diff (vs HEAD)
                </h3>
              </div>
              <button onClick={() => setIsGitDiffOpen(false)}>
                <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-slate-950 p-4 rounded-xl font-mono text-xs text-slate-200 whitespace-pre">
              {gitDiff || '(No unstaged modifications)'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
