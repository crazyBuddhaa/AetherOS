import React, { useState, useEffect, useRef } from 'react';
import { useApp, NavTab } from '../../context/AppContext';
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
  Cpu 
} from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNewTaskClick: () => void;
}

interface CommandItem {
  id: string;
  category: 'Navigation' | 'Workflows' | 'Approvals' | 'Agents' | 'Actions';
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

  const items: CommandItem[] = [
    // Navigation
    {
      id: 'nav-dash',
      category: 'Navigation',
      title: 'Go to Dashboard',
      subtitle: 'Platform metrics, active workflows, and fleet overview',
      icon: <Workflow className="w-4 h-4 text-blue-500" />,
      onSelect: () => { setActiveTab('dashboard'); onClose(); },
    },
    {
      id: 'nav-chat',
      category: 'Navigation',
      title: 'Open Conversational Console',
      subtitle: 'Chat with autonomous agents',
      icon: <MessageSquare className="w-4 h-4 text-indigo-500" />,
      onSelect: () => { setActiveTab('chat'); onClose(); },
    },
    {
      id: 'nav-agents',
      category: 'Navigation',
      title: 'Manage Agent Fleet',
      subtitle: 'Configure models, capabilities, and system rules',
      icon: <Bot className="w-4 h-4 text-emerald-500" />,
      onSelect: () => { setActiveTab('agents'); onClose(); },
    },
    {
      id: 'nav-tasks',
      category: 'Navigation',
      title: 'View Task Orchestration',
      subtitle: 'Execution pipelines and step traces',
      icon: <Workflow className="w-4 h-4 text-sky-500" />,
      onSelect: () => { setActiveTab('tasks'); onClose(); },
    },
    {
      id: 'nav-approvals',
      category: 'Navigation',
      title: 'Open Human Authorization Queue',
      subtitle: 'Review pending consequential actions',
      icon: <ShieldAlert className="w-4 h-4 text-amber-500" />,
      onSelect: () => { setActiveTab('approvals'); onClose(); },
    },
    {
      id: 'nav-files',
      category: 'Navigation',
      title: 'Browse Cloudflare R2 Storage',
      subtitle: 'Explore analytical files and task artifacts',
      icon: <HardDrive className="w-4 h-4 text-purple-500" />,
      onSelect: () => { setActiveTab('files'); onClose(); },
    },
    {
      id: 'nav-compute',
      category: 'Navigation',
      title: 'Distributed Compute Grid',
      subtitle: 'Monitor GPU nodes, Kaggle workers, and VRAM telemetry',
      icon: <Cpu className="w-4 h-4 text-blue-500" />,
      onSelect: () => { setActiveTab('compute'); onClose(); },
    },
    {
      id: 'nav-settings',
      category: 'Navigation',
      title: 'Platform Architecture & Settings',
      subtitle: 'Inference runtime, D1 migrations, and Wrangler config',
      icon: <Settings2 className="w-4 h-4 text-slate-500" />,
      onSelect: () => { setActiveTab('settings'); onClose(); },
    },

    // Actions
    {
      id: 'act-new-task',
      category: 'Actions',
      title: 'Submit Autonomous Task...',
      subtitle: 'Dispatch a new workflow to an agent',
      icon: <Plus className="w-4 h-4 text-blue-600" />,
      onSelect: () => { onClose(); onNewTaskClick(); },
    },
    {
      id: 'act-toggle-theme',
      category: 'Actions',
      title: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`,
      subtitle: 'Toggle platform interface color theme',
      icon: theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />,
      onSelect: () => { toggleTheme(); onClose(); },
    },
    {
      id: 'act-ping-runtime',
      category: 'Actions',
      title: 'Ping Inference Engine',
      subtitle: 'Test round-trip latency to external self-hosted worker',
      icon: <Cpu className="w-4 h-4 text-blue-500" />,
      onSelect: () => { pingRuntime(); onClose(); },
    },

    // Pending Approvals
    ...approvals.filter(a => a.status === 'pending').map(appr => ({
      id: `appr-${appr.id}`,
      category: 'Approvals' as const,
      title: `Authorize: ${appr.action_name}`,
      subtitle: `${appr.agent_name} · ${appr.risk_level} risk`,
      icon: <ShieldAlert className="w-4 h-4 text-amber-500" />,
      onSelect: () => { setActiveTab('approvals'); onClose(); },
    })),

    // Active Tasks
    ...tasks.slice(0, 5).map(task => ({
      id: `task-${task.id}`,
      category: 'Workflows' as const,
      title: task.title,
      subtitle: `${task.status} · ${task.progress_percent}% · ${task.agent_name}`,
      icon: <Workflow className="w-4 h-4 text-slate-400" />,
      onSelect: () => { setSelectedTaskId(task.id); setActiveTab('tasks'); onClose(); },
    })),

    // Agents
    ...agents.map(agent => ({
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
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity" 
      />

      {/* Modal Dialog */}
      <div 
        className="relative w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-800/80">
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
            placeholder="Type a command, workflow, agent, or search..."
            className="flex-1 text-sm bg-transparent border-0 outline-none text-slate-900 dark:text-white placeholder-slate-400 font-sans"
          />
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 divide-y divide-slate-100/50 dark:divide-slate-800/50">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No results found for "{query}".
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
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-950/80 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <span>AetherOS Quick Jump</span>
        </div>
      </div>
    </div>
  );
};
