import React from 'react';
import { useApp, NavTab, SettingsModuleId, SituationalPreset } from '../../context/AppContext';
import {
  LayoutGrid,
  Code2,
  Image as ImageIcon,
  Film,
  Clapperboard,
  Feather,
  MessageSquare,
  Workflow,
  Cpu,
  Server,
  Bot,
  ShieldCheck,
  HardDrive,
  Sliders,
  Sun,
  Moon,
  Globe,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    situationalMode,
    setSituationalMode,
    activeSettingsModule,
    setActiveSettingsModule,
    theme,
    setTheme,
    stats,
    storyboardShots,
    studioImages,
    studioVideos,
    screenplayScenes,
  } = useApp();

  const studioItems: Array<{
    id: NavTab;
    label: string;
    badge?: string | number;
    category: 'all' | 'creative' | 'engineering';
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'dashboard', label: 'Workspace Hub', category: 'all', icon: LayoutGrid },
    { id: 'code', label: 'Code Generation', badge: 'IDE', category: 'engineering', icon: Code2 },
    { id: 'image', label: 'Image Generation', badge: studioImages.length, category: 'creative', icon: ImageIcon },
    { id: 'video', label: 'Video Generation', badge: studioVideos.length, category: 'creative', icon: Film },
    { id: 'storyboard', label: 'Storyboard Studio', badge: storyboardShots.length, category: 'creative', icon: Clapperboard },
    { id: 'screenwriter', label: 'Screenwriter', badge: screenplayScenes.length, category: 'creative', icon: Feather },
  ];

  const operationsItems: Array<{
    id: NavTab;
    label: string;
    badge?: number;
    category: 'all' | 'engineering' | 'infrastructure';
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'web_intelligence', label: 'Web Intelligence', category: 'engineering', icon: Globe },
    { id: 'chat', label: 'Agent Chat', category: 'engineering', icon: MessageSquare },
    { id: 'tasks', label: 'Task Queue', badge: stats.running_tasks || undefined, category: 'engineering', icon: Workflow },
    { id: 'compute', label: 'Compute Grid', category: 'infrastructure', icon: Cpu },
    { id: 'sessions', label: 'Kaggle Sessions', category: 'infrastructure', icon: Server },
    { id: 'agents', label: 'Agent Fleet', badge: stats.active_agents || undefined, category: 'engineering', icon: Bot },
    { id: 'approvals', label: 'Approvals', badge: stats.pending_approvals || undefined, category: 'infrastructure', icon: ShieldCheck },
    { id: 'files', label: 'R2 Storage', badge: stats.total_files || undefined, category: 'engineering', icon: HardDrive },
  ];

  const settingsModules: Array<{ id: SettingsModuleId; label: string }> = [
    { id: 'workspace_appearance', label: '01. Workspace & Theme' },
    { id: 'compute_kaggle', label: '02. Compute & Kaggle' },
    { id: 'inference_models', label: '03. Inference & Models' },
    { id: 'cloudflare_edge', label: '04. Cloudflare Edge' },
    { id: 'identity_security', label: '05. Identity & Passkeys' },
    { id: 'deployment_cicd', label: '06. Deployment & CI/CD' },
  ];

  const visibleStudioItems = studioItems.filter(item => {
    if (item.id === 'dashboard') return true;
    if (situationalMode === 'creative') return item.category === 'creative';
    if (situationalMode === 'engineering') return item.category === 'engineering';
    return true;
  });

  const visibleOpsItems = operationsItems.filter(item => {
    if (situationalMode === 'creative') return item.id === 'files' || item.id === 'tasks';
    if (situationalMode === 'infrastructure') return item.category === 'infrastructure';
    return true;
  });

  return (
    <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 select-none">
      {/* Situational Focus Selector */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800/80 space-y-2">
        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
          Situational Workspace Mode
        </label>
        <select
          value={situationalMode}
          onChange={e => setSituationalMode(e.target.value as SituationalPreset)}
          className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
        >
          <option value="all">All Workspaces (Full Suite)</option>
          <option value="creative">Creative Production Suite</option>
          <option value="engineering">Software & Data Engineering</option>
          <option value="infrastructure">Compute & Edge Infrastructure</option>
        </select>
      </div>

      {/* Scrollable Navigation Sections */}
      <div className="flex-1 overflow-y-auto p-3 space-y-6">
        {/* Group 1: Dedicated Workspaces */}
        <div className="space-y-1">
          <div className="px-2.5 py-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
            Studio Workspaces
          </div>
          {visibleStudioItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && (
                  <span className="text-[11px] font-mono tabular-nums text-slate-400 dark:text-slate-500">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Group 2: Operations & Compute Fleet */}
        <div className="space-y-1">
          <div className="px-2.5 py-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
            Operations & Compute
          </div>
          {visibleOpsItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Group 3: Categorized Settings Modules */}
        <div className="space-y-1">
          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeTab === 'settings'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <span className="flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5" />
              <span>Settings Modules</span>
            </span>
            <span className="text-[10px] font-mono">6</span>
          </button>

          <div className="pl-3 space-y-0.5 border-l border-slate-200 dark:border-slate-800 ml-3">
            {settingsModules.map(mod => {
              const isSelected = activeTab === 'settings' && activeSettingsModule === mod.id;
              return (
                <button
                  key={mod.id}
                  onClick={() => {
                    setActiveSettingsModule(mod.id);
                    setActiveTab('settings');
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-[11px] transition-colors truncate ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  {mod.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Theme Polarity Switcher (Light Primary) */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTheme('light')}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              theme === 'light'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Sun className="w-3.5 h-3.5 text-amber-500" />
            <span>Light</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              theme === 'dark'
                ? 'bg-slate-800 text-white shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-white'
            }`}
          >
            <Moon className="w-3.5 h-3.5 text-blue-400" />
            <span>Dark</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
