import React, { useState, useEffect, useRef } from 'react';
import { useApp, SettingsModuleId } from '../../context/AppContext';
import {
  Search,
  Bot,
  Workflow,
  ShieldAlert,
  HardDrive,
  Settings2,
  MessageSquare,
  Plus,
  Sun,
  Moon,
  ArrowRight,
  Cpu,
  Code2,
  Image as ImageIcon,
  Film,
  Clapperboard,
  FileText,
  Server,
  Cloud,
  Fingerprint,
  FileCode,
  Sliders,
} from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNewTaskClick: () => void;
}

interface CommandItem {
  id: string;
  category: 'Studio Workspaces' | 'Operations' | 'Settings Modules' | 'Workflows' | 'Agents' | 'Actions';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNewTaskClick,
}) => {
  const {
    setActiveTab,
    setActiveSettingsModule,
    tasks,
    agents,
    approvals,
    setSelectedTaskId,
    setSelectedAgentId,
    toggleTheme,
    theme,
    pingRuntime,
  } = useApp();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const openSettingsModule = (moduleId: SettingsModuleId) => {
    setActiveSettingsModule(moduleId);
    setActiveTab('settings');
    onClose();
  };

  const items: CommandItem[] = [
    // Studio Workspaces
    {
      id: 'ws-hub',
      category: 'Studio Workspaces',
      title: 'Workspace Hub (Overview)',
      subtitle: 'Central launcher for separated creative, engineering, and compute studios',
      icon: <Workflow className="w-4 h-4 text-blue-600" />,
      onSelect: () => { setActiveTab('dashboard'); onClose(); },
    },
    {
      id: 'ws-code',
      category: 'Studio Workspaces',
      title: 'Code Generation Studio',
      subtitle: 'Multi-file TypeScript, D1 SQL, and Python synthesis workspace',
      icon: <Code2 className="w-4 h-4 text-blue-600" />,
      onSelect: () => { setActiveTab('code'); onClose(); },
    },
    {
      id: 'ws-image',
      category: 'Studio Workspaces',
      title: 'Image Generation Studio',
      subtitle: 'SDXL Lightning & SD 1.5 visual synthesis with Real-ESRGAN 4x+ & BiRefNet',
      icon: <ImageIcon className="w-4 h-4 text-indigo-600" />,
      onSelect: () => { setActiveTab('image'); onClose(); },
    },
    {
      id: 'ws-video',
      category: 'Studio Workspaces',
      title: 'Video Generation Studio',
      subtitle: 'AnimateDiff temporal motion pipeline with camera trajectory controls',
      icon: <Film className="w-4 h-4 text-purple-600" />,
      onSelect: () => { setActiveTab('video'); onClose(); },
    },
    {
      id: 'ws-storyboard',
      category: 'Studio Workspaces',
      title: 'Storyboard Studio',
      subtitle: 'Sequential shot continuity planner, lens specs, and animatic preview',
      icon: <Clapperboard className="w-4 h-4 text-amber-600" />,
      onSelect: () => { setActiveTab('storyboard'); onClose(); },
    },
    {
      id: 'ws-screenwriter',
      category: 'Studio Workspaces',
      title: 'Screenwriter Studio',
      subtitle: 'Fountain screenplay editor, scene beat index, and 1-click Storyboard extraction',
      icon: <FileText className="w-4 h-4 text-emerald-600" />,
      onSelect: () => { setActiveTab('screenwriter'); onClose(); },
    },

    // Operations
    {
      id: 'nav-chat',
      category: 'Operations',
      title: 'Agent Chat Console',
      subtitle: 'Interactive multi-agent dialogue and task conversion',
      icon: <MessageSquare className="w-4 h-4 text-indigo-500" />,
      onSelect: () => { setActiveTab('chat'); onClose(); },
    },
    {
      id: 'nav-tasks',
      category: 'Operations',
      title: 'Task Orchestration Queue',
      subtitle: 'Execution pipelines and step traces',
      icon: <Workflow className="w-4 h-4 text-sky-500" />,
      onSelect: () => { setActiveTab('tasks'); onClose(); },
    },
    {
      id: 'nav-compute',
      category: 'Operations',
      title: 'Distributed Compute Grid',
      subtitle: 'Monitor GPU nodes, Kaggle workers, and VRAM telemetry',
      icon: <Cpu className="w-4 h-4 text-blue-500" />,
      onSelect: () => { setActiveTab('compute'); onClose(); },
    },
    {
      id: 'nav-sessions',
      category: 'Operations',
      title: 'Kaggle T4×2 Sessions',
      subtitle: 'Dual NVIDIA Tesla T4 (32GB VRAM) lifecycle manager',
      icon: <Server className="w-4 h-4 text-emerald-500" />,
      onSelect: () => { setActiveTab('sessions'); onClose(); },
    },
    {
      id: 'nav-agents',
      category: 'Operations',
      title: 'Manage Agent Fleet',
      subtitle: 'Configure models, capabilities, and system rules',
      icon: <Bot className="w-4 h-4 text-emerald-500" />,
      onSelect: () => { setActiveTab('agents'); onClose(); },
    },
    {
      id: 'nav-approvals',
      category: 'Operations',
      title: 'Human Authorization Queue',
      subtitle: 'Review pending consequential actions',
      icon: <ShieldAlert className="w-4 h-4 text-amber-500" />,
      onSelect: () => { setActiveTab('approvals'); onClose(); },
    },
    {
      id: 'nav-files',
      category: 'Operations',
      title: 'Cloudflare R2 Storage',
      subtitle: 'Explore analytical files and studio artifacts',
      icon: <HardDrive className="w-4 h-4 text-purple-500" />,
      onSelect: () => { setActiveTab('files'); onClose(); },
    },

    // Settings Modules
    {
      id: 'set-appearance',
      category: 'Settings Modules',
      title: 'Module 01: Workspace & Appearance',
      subtitle: 'Light-primary theme switcher and situational workspace presets',
      icon: <Sliders className="w-4 h-4 text-blue-500" />,
      onSelect: () => openSettingsModule('workspace_appearance'),
    },
    {
      id: 'set-kaggle',
      category: 'Settings Modules',
      title: 'Module 02: Compute Grid & Kaggle Sessions',
      subtitle: 'Kaggle API credentials, T4×2 session controls, and GPU nodes',
      icon: <Server className="w-4 h-4 text-emerald-500" />,
      onSelect: () => openSettingsModule('compute_kaggle'),
    },
    {
      id: 'set-inference',
      category: 'Settings Modules',
      title: 'Module 03: Inference Runtime & Model Registry',
      subtitle: 'Endpoint URL, timeout policy, and 10 open-weights model profiles',
      icon: <Cpu className="w-4 h-4 text-indigo-500" />,
      onSelect: () => openSettingsModule('inference_models'),
    },
    {
      id: 'set-cloudflare',
      category: 'Settings Modules',
      title: 'Module 04: Cloudflare Edge Infrastructure',
      subtitle: 'Workers router, D1 database ID, and R2 bucket bindings',
      icon: <Cloud className="w-4 h-4 text-amber-500" />,
      onSelect: () => openSettingsModule('cloudflare_edge'),
    },
    {
      id: 'set-security',
      category: 'Settings Modules',
      title: 'Module 05: Identity & Zero-Password Security',
      subtitle: 'WebAuthn FIDO2 passkeys, TOTP authenticator, and AES-GCM-256',
      icon: <Fingerprint className="w-4 h-4 text-purple-500" />,
      onSelect: () => openSettingsModule('identity_security'),
    },
    {
      id: 'set-cicd',
      category: 'Settings Modules',
      title: 'Module 06: Deployment, CI/CD & State',
      subtitle: 'Generated wrangler.toml, D1 SQL schema, and cache reset',
      icon: <FileCode className="w-4 h-4 text-slate-500" />,
      onSelect: () => openSettingsModule('deployment_cicd'),
    },

    // Actions
    {
      id: 'act-new-task',
      category: 'Actions',
      title: 'Dispatch Autonomous Task...',
      subtitle: 'Submit a new workflow to any specialized agent',
      icon: <Plus className="w-4 h-4 text-blue-600" />,
      onSelect: () => { onClose(); onNewTaskClick(); },
    },
    {
      id: 'act-toggle-theme',
      category: 'Actions',
      title: `Switch to ${theme === 'dark' ? 'Light (Primary)' : 'Dark'} Mode`,
      subtitle: 'Toggle studio color theme',
      icon: theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />,
      onSelect: () => { toggleTheme(); onClose(); },
    },
    {
      id: 'act-ping-runtime',
      category: 'Actions',
      title: 'Ping Inference Engine',
      subtitle: 'Test round-trip latency to external self-hosted worker',
      icon: <Settings2 className="w-4 h-4 text-blue-500" />,
      onSelect: () => { pingRuntime(); onClose(); },
    },

    // Pending Approvals
    ...approvals.filter(a => a.status === 'pending').map(appr => ({
      id: `appr-${appr.id}`,
      category: 'Operations' as const,
      title: `Authorize: ${appr.action_name}`,
      subtitle: `${appr.agent_name} · ${appr.risk_level} risk`,
      icon: <ShieldAlert className="w-4 h-4 text-amber-500" />,
      onSelect: () => { setActiveTab('approvals'); onClose(); },
    })),

    // Active Tasks
    ...tasks.slice(0, 4).map(task => ({
      id: `task-${task.id}`,
      category: 'Workflows' as const,
      title: task.title,
      subtitle: `${task.status} · ${task.progress_percent}% · ${task.agent_name}`,
      icon: <Workflow className="w-4 h-4 text-slate-400" />,
      onSelect: () => { setSelectedTaskId(task.id); setActiveTab('tasks'); onClose(); },
    })),

    // Agents
    ...agents.slice(0, 6).map(agent => ({
      id: `agent-${agent.id}`,
      category: 'Agents' as const,
      title: agent.name,
      subtitle: `${agent.model} · ${agent.permitted_tools.length} capabilities`,
      icon: <Bot className="w-4 h-4" style={{ color: agent.avatar_color }} />,
      onSelect: () => { setSelectedAgentId(agent.id); setActiveTab('agents'); onClose(); },
    })),
  ];

  const filteredItems = items.filter(item => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
      item.category.toLowerCase().includes(q)
    );
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].onSelect();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs transition-opacity"
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden z-10">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Jump to workspace (Code, Image, Video, Storyboard, Screenwriter) or Settings module..."
            className="flex-1 text-sm bg-transparent border-0 outline-none text-slate-900 dark:text-white placeholder-slate-400 font-sans"
          />
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 divide-y divide-slate-100/60 dark:divide-slate-800/60">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No workspaces or modules found for "{query}".
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  onClick={item.onSelect}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between gap-3 text-xs transition-colors ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100 font-medium'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="shrink-0">{item.icon}</div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate text-slate-900 dark:text-white">
                        {item.title}
                      </p>
                      {item.subtitle && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                      {item.category}
                    </span>
                    {isSelected && (
                      <ArrowRight className="w-3.5 h-3.5 text-blue-500" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-950/80 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Open Studio</span>
            <span>ESC Close</span>
          </div>
          <span>AetherOS Studio Quick Jump</span>
        </div>
      </div>
    </div>
  );
};
