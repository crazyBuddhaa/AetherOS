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
  HardDrive,
  Sparkles,
  RefreshCw,
  FolderGit2,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  GitBranch,
  GitCommit,
  UploadCloud,
  FileText,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Layers,
  Settings,
  Send,
  Sliders,
  X,
  Maximize2,
  Minimize2,
  Save,
  MessageSquare,
  Bot,
  User,
  Wrench,
  Search,
  CheckCircle2,
  AlertCircle,
  Database,
  Globe,
  Key,
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

  // --- Model & External API State ---
  const [models, setModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.8-flash');
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [externalEndpoint, setExternalEndpoint] = useState('');
  const [externalApiKey, setExternalApiKey] = useState('');
  const [externalModelName, setExternalModelName] = useState('gpt-4o');
  const [temperature, setTemperature] = useState(0.4);
  const [maxTokens, setMaxTokens] = useState(3000);

  // --- MCP (Model Context Protocol) State ---
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [mcpTools, setMcpTools] = useState<any[]>([]);
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpEndpoint, setNewMcpEndpoint] = useState('');

  // --- AI Studio Chat Assistant State ---
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      content: `Welcome to **Google AI Studio Coding Workspace** inside AetherOS!\n\nI can directly read your repository, modify and save files, inspect git changes, push commits to remote, and invoke Model Context Protocol (MCP) tools.\n\nAsk me anything about your codebase or click a suggestion below to begin.`,
      model: 'gemini-3.8-flash',
      provider: 'gemini',
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
    } catch {
      // Use standard fallback
      setModels([
        { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Google AI Studio)' },
        { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite' },
        { id: 'gemini-4-argon', name: 'Gemini 4 Argon' },
        { id: 'qwen-2.5-coder-14b', name: 'Qwen 2.5 Coder 14B (Kaggle)' },
        { id: 'external-api', name: 'External Provider / Custom API' },
      ]);
    }
  };

  // Load repo tree
  const loadRepositoryTree = async () => {
    try {
      const tree = await apiClient.getRepoTree(4);
      setRepoTree(tree);
      // Open src/App.tsx by default if no tabs open
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

  // Load MCP servers & tools
  const loadMcpData = async () => {
    try {
      const servers = await apiClient.getMcpServers();
      setMcpServers(servers);
      const tools = await apiClient.getMcpTools();
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
      // Step 1: Commit
      const commitRes = await apiClient.commitGit(commitMessage.trim(), true);
      showNotification(`Committed [${commitRes.commitHash}]: ${commitRes.message}`, 'success');

      // Step 2: Push
      const pushRes = await apiClient.pushGit({
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

  // Send message to AI Studio coding assistant
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
          selectedModel === 'external-api'
            ? {
                endpoint: externalEndpoint,
                apiKey: externalApiKey,
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

  // Add custom MCP Server
  const handleAddMcpServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMcpName.trim() || !newMcpEndpoint.trim()) return;

    try {
      await apiClient.addMcpServer({
        name: newMcpName.trim(),
        description: 'External Custom MCP Service',
        endpoint: newMcpEndpoint.trim(),
      });
      showNotification(`Added MCP Server: ${newMcpName}`, 'success');
      setNewMcpName('');
      setNewMcpEndpoint('');
      await loadMcpData();
    } catch (err: any) {
      showNotification(err.message, 'error');
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
      {/* TOP COMMAND BAR (AI Studio Header) */}
      {/* ======================================================== */}
      <div className="h-13 border-b border-slate-200 dark:border-slate-800 px-3 sm:px-4 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-900/70 shrink-0 min-w-0">
        {/* Left: Title & Repo Git Branch status */}
        <div className="flex items-center gap-3 shrink-0 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-2xs shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="hidden sm:block">
              <span className="text-xs font-bold text-slate-900 dark:text-white">AI Studio Code IDE</span>
            </div>
          </div>

          {/* Git Branch Pill */}
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

        {/* Middle: Model Selector Dropdown & External API Config */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="py-1.5 pl-2.5 pr-8 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs truncate max-w-[190px] sm:max-w-none"
            >
              <optgroup label="Google Gemini (AI Studio)">
                <option value="gemini-3.8-flash">Gemini 3.8 Flash (Default)</option>
                <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
                <option value="gemini-4-argon">Gemini 4 Argon (Reasoning)</option>
              </optgroup>
              <optgroup label="Distributed Kaggle Workers">
                <option value="qwen-2.5-coder-14b">Qwen 2.5 Coder 14B (T4×2)</option>
              </optgroup>
              <optgroup label="Custom Provider">
                <option value="external-api">External API / Custom Endpoint</option>
              </optgroup>
            </select>
          </div>

          {/* Model & External API settings button */}
          <button
            onClick={() => setIsConfigModalOpen(true)}
            title="Configure External API Endpoint & Parameters"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-blue-600 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* MCP Hub Button */}
          <button
            onClick={() => setIsMcpModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 hover:bg-purple-100 transition-colors"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden md:inline">MCP Tools</span>
            <span className="px-1.5 py-0.2 rounded-full bg-purple-200 dark:bg-purple-900 text-[10px] font-mono">
              {mcpTools.length}
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
              layoutMode === 'split' ? 'bg-white dark:bg-slate-900 shadow-2xs font-semibold text-blue-600' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Split
          </button>
          <button
            onClick={() => setLayoutMode('editor')}
            className={`px-2 py-1 rounded-md font-medium transition-colors ${
              layoutMode === 'editor' ? 'bg-white dark:bg-slate-900 shadow-2xs font-semibold text-blue-600' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Editor
          </button>
          <button
            onClick={() => setLayoutMode('chat')}
            className={`px-2 py-1 rounded-md font-medium transition-colors ${
              layoutMode === 'chat' ? 'bg-white dark:bg-slate-900 shadow-2xs font-semibold text-blue-600' : 'text-slate-600 dark:text-slate-400'
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
        {/* PANEL 1: LEFT SIDEBAR (FILE EXPLORER & GIT) */}
        {layoutMode !== 'chat' && (
          <div className="w-60 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-900/30 shrink-0 overflow-hidden">
            {/* Left Tabs */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 text-xs font-semibold bg-slate-100/70 dark:bg-slate-900/60">
              <button
                onClick={() => setActiveLeftTab('files')}
                className={`flex-1 py-2 text-center transition-colors flex items-center justify-center gap-1.5 ${
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
                className={`flex-1 py-2 text-center transition-colors flex items-center justify-center gap-1.5 ${
                  activeLeftTab === 'git'
                    ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>Changes</span>
                {!gitStatus.clean && (
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                )}
              </button>
            </div>

            {/* Left Content Area */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {activeLeftTab === 'files' ? (
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between px-2 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <span>Repository Explorer</span>
                    <button onClick={loadRepositoryTree} title="Refresh tree">
                      <RefreshCw className="w-3 h-3 hover:text-slate-600" />
                    </button>
                  </div>
                  {repoTree.map(renderTreeNode)}
                </div>
              ) : (
                /* Git Changes Tab */
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

                  {/* Diff Trigger */}
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 px-2">
                    <button
                      onClick={() => setIsGitDiffOpen(true)}
                      className="w-full py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                    >
                      Inspect Full Git Diff
                    </button>
                  </div>
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
                  {/* Line Numbers */}
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

        {/* PANEL 3: RIGHT AI STUDIO CHAT ASSISTANT */}
        {layoutMode !== 'editor' && (
          <div className="w-full lg:w-[460px] xl:w-[500px] border-l border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-900/20 shrink-0 overflow-hidden">
            {/* Assistant Header */}
            <div className="h-10 border-b border-slate-200 dark:border-slate-800 px-3 flex items-center justify-between text-xs bg-white dark:bg-slate-950 shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <span className="font-semibold text-slate-900 dark:text-white">AI Studio Assistant</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                  {selectedModel}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
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
                        <Sparkles className="w-3 h-3 text-blue-500" />
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{msg.model || 'AI Studio'}</span>
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
                            <span className="text-emerald-600">success</span>
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
                  <Sparkles className="w-4 h-4 text-blue-500" />
                  <span>AI Studio is thinking, reading repo context & synthesizing...</span>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Quick Prompt Suggestions */}
            <div className="px-3 py-1.5 border-t border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-950/60 flex items-center gap-1.5 overflow-x-auto text-[11px] shrink-0">
              <button
                onClick={() => handleSendMessage('Explain the architecture of the open file and suggest improvements.')}
                className="whitespace-nowrap px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Explain active file
              </button>
              <button
                onClick={() => handleSendMessage('Run git status and explain what changes are uncommitted.')}
                className="whitespace-nowrap px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Check git status
              </button>
              <button
                onClick={() => handleSendMessage('Write a complete unit test for this module.')}
                className="whitespace-nowrap px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Generate unit test
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
                  placeholder="Ask AI Studio to write code, inspect repo, or push to git..."
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
                  placeholder="e.g. feat: integrate AI Studio and MCP tools"
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
      {/* MODAL 2: MCP TOOLS & SERVERS HUB */}
      {/* ======================================================== */}
      {isMcpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Model Context Protocol (MCP) Hub
                </h3>
              </div>
              <button onClick={() => setIsMcpModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 text-xs">
              {/* Connected MCP Servers */}
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white mb-2">Connected MCP Servers</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {mcpServers.map((s) => (
                    <div
                      key={s.id}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 dark:text-white">{s.name}</span>
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 font-mono">
                          {s.transport}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">{s.description}</p>
                      <div className="text-[10px] text-purple-600 dark:text-purple-400 font-mono">
                        {s.tools?.length || 0} tools available
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add Custom MCP Server */}
              <form onSubmit={handleAddMcpServer} className="p-4 rounded-xl border border-purple-200 dark:border-purple-900/60 bg-purple-50/40 dark:bg-purple-950/20 space-y-3">
                <h4 className="font-bold text-slate-900 dark:text-white">Add External MCP Server</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    required
                    value={newMcpName}
                    onChange={(e) => setNewMcpName(e.target.value)}
                    placeholder="Server Name (e.g. Sentry MCP)"
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
                  />
                  <input
                    type="url"
                    required
                    value={newMcpEndpoint}
                    onChange={(e) => setNewMcpEndpoint(e.target.value)}
                    placeholder="https://mcp-endpoint.domain/sse"
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-mono"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs"
                >
                  Connect External MCP
                </button>
              </form>

              {/* Discovered MCP Tools Catalog */}
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white mb-2">Available Discovered Tools ({mcpTools.length})</h4>
                <div className="space-y-2">
                  {mcpTools.map((t, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-start justify-between gap-3"
                    >
                      <div>
                        <div className="font-mono font-bold text-blue-600 dark:text-blue-400">
                          {t.tool?.name}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">{t.tool?.description}</p>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        {t.serverName}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: MODEL & EXTERNAL API SETTINGS */}
      {/* ======================================================== */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Model & External API Settings
                </h3>
              </div>
              <button onClick={() => setIsConfigModalOpen(false)}>
                <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Active Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedModel === 'external-api' && (
                <div className="space-y-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Endpoint URL
                    </label>
                    <input
                      type="url"
                      value={externalEndpoint}
                      onChange={(e) => setExternalEndpoint(e.target.value)}
                      placeholder="https://api.openai.com/v1/chat/completions"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      API Key / Bearer Token
                    </label>
                    <input
                      type="password"
                      value={externalApiKey}
                      onChange={(e) => setExternalApiKey(e.target.value)}
                      placeholder="sk-••••••••••••••••••••••••••••••••••••"
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
                      placeholder="gpt-4o, claude-3-7-sonnet, deepseek-chat"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Temperature ({temperature})
                  </label>
                  <span className="text-slate-400 text-[10px]">Creativity / Determinism</span>
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
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>

              <button
                onClick={() => {
                  setIsConfigModalOpen(false);
                  showNotification('Configuration saved', 'success');
                }}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              >
                Apply & Save Settings
              </button>
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
