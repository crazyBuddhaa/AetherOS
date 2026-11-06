import React from 'react';
import { useApp, NavTab, SettingsModuleId, SituationalPreset } from '../../context/AppContext';
import { StatusBadge, RiskBadge } from '../common/StatusBadge';
import {
  Code2,
  Image as ImageIcon,
  Film,
  Clapperboard,
  Feather,
  MessageSquare,
  Bot,
  Workflow,
  ShieldAlert,
  HardDrive,
  ArrowRight,
  Plus,
  CheckCircle2,
  Cpu,
  Sliders,
  Server,
  Cloud,
  Fingerprint,
  FileCode,
} from 'lucide-react';

export const DashboardView: React.FC<{ onNewTaskClick: () => void }> = ({ onNewTaskClick }) => {
  const {
    agents,
    tasks,
    approvals,
    stats,
    runtimeConfig,
    storyboardShots,
    studioImages,
    studioVideos,
    screenplayScenes,
    situationalMode,
    setSituationalMode,
    setActiveTab,
    setActiveSettingsModule,
    setSelectedTaskId,
    setSelectedAgentId,
    pingRuntime,
    decideApproval,
  } = useApp();

  const pendingApprovals = approvals.filter(a => a.status === 'pending');
  const runningTasks = tasks.filter(t => t.status === 'running' || t.status === 'waiting_approval' || t.status === 'queued' || t.status === 'assigned');

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const studioWorkspaces: Array<{
    id: NavTab;
    title: string;
    category: 'engineering' | 'creative';
    modelLabel: string;
    metricText: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      id: 'code',
      title: 'Code Generation',
      category: 'engineering',
      modelLabel: 'qwen-2.5-coder-14b',
      metricText: 'TypeScript · SQL · Python',
      description: 'Synthesize Cloudflare Workers, D1 SQLite migrations, and PyTorch GPU modules in a split IDE.',
      icon: Code2,
    },
    {
      id: 'image',
      title: 'Image Generation',
      category: 'creative',
      modelLabel: 'sdxl-lightning',
      metricText: `${studioImages.length} studio plates`,
      description: 'High-resolution diffusion synthesis with Real-ESRGAN 4x upscaling and BiRefNet alpha extraction.',
      icon: ImageIcon,
    },
    {
      id: 'video',
      title: 'Video Generation',
      category: 'creative',
      modelLabel: 'animatediff-motion-v3',
      metricText: `${studioVideos.length} motion clips`,
      description: 'Keyframe-conditioned temporal motion synthesis with camera rig trajectories and frame scrubbing.',
      icon: Film,
    },
    {
      id: 'storyboard',
      title: 'Storyboard Studio',
      category: 'creative',
      modelLabel: 'deepseek-r1-distill-qwen-14b',
      metricText: `${storyboardShots.length} sequential shots`,
      description: 'Sequential visual narrative planning, lens & camera continuity, and animatic playback.',
      icon: Clapperboard,
    },
    {
      id: 'screenwriter',
      title: 'Screenwriter',
      category: 'creative',
      modelLabel: 'deepseek-r1-distill-qwen-14b',
      metricText: `${screenplayScenes.length} script scenes`,
      description: 'Fountain screenplay authoring, AI dramaturg beat expansion, and 1-click shot extraction.',
      icon: Feather,
    },
    {
      id: 'chat',
      title: 'Agent Chat Console',
      category: 'engineering',
      modelLabel: 'Multi-Agent Fleet',
      metricText: `${stats.active_agents} active agents`,
      description: 'Interactive multi-turn reasoning console with live chain-of-thought and artifact canvas.',
      icon: MessageSquare,
    },
  ];

  const filteredWorkspaces = studioWorkspaces.filter(w => {
    if (situationalMode === 'creative') return w.category === 'creative';
    if (situationalMode === 'engineering') return w.category === 'engineering' || w.id === 'code';
    return true;
  });

  const settingsModulesShortcut: Array<{
    id: SettingsModuleId;
    title: string;
    meta: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'workspace_appearance', title: '01. Workspace & Theme', meta: 'Light Primary · Presets', icon: Sliders },
    { id: 'compute_kaggle', title: '02. Compute & Kaggle', meta: 'Dual T4 · Session Control', icon: Server },
    { id: 'inference_models', title: '03. Inference & Models', meta: '8 Multimodal Profiles', icon: Cpu },
    { id: 'cloudflare_edge', title: '04. Cloudflare Edge', meta: 'Workers · D1 · R2', icon: Cloud },
    { id: 'identity_security', title: '05. Identity & Passkeys', meta: 'WebAuthn · TOTP', icon: Fingerprint },
    { id: 'deployment_cicd', title: '06. Deployment & CI/CD', meta: 'Wrangler · GitHub Actions', icon: FileCode },
  ];

  return (
    <div className="space-y-8 pb-12">
      {/* Top Header & Situational Mode Filter */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>AetherOS Studio</span>
            <span>·</span>
            <span>Cloudflare Workers + D1 + R2</span>
            <span>·</span>
            <span>Distributed GPU Grid</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Modular Studio Workspaces
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Dedicated environments for code generation, image synthesis, video motion, storyboarding, and screenwriting.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Situational Filter Segmented Control */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
            {(
              [
                { id: 'all', label: 'All Workspaces' },
                { id: 'creative', label: 'Creative Suite' },
                { id: 'engineering', label: 'Engineering' },
                { id: 'infrastructure', label: 'Infrastructure' },
              ] as Array<{ id: SituationalPreset; label: string }>
            ).map(item => (
              <button
                key={item.id}
                onClick={() => setSituationalMode(item.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  situationalMode === item.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-2xs font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            onClick={onNewTaskClick}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Dispatch Task</span>
          </button>
        </div>
      </div>

      {/* Section 1: Dedicated Workspaces Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            01. Dedicated Production Workspaces
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Select a specialized workspace to launch its dedicated toolset
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWorkspaces.map(ws => {
            const Icon = ws.icon;
            return (
              <div
                key={ws.id}
                onClick={() => setActiveTab(ws.id)}
                className="group cursor-pointer p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-500 dark:hover:border-blue-500 transition-all flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                      <Icon className="w-4 h-4" />
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {ws.title}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                      {ws.description}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  <span>{ws.modelLabel}</span>
                  <span>{ws.metricText}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 2: Categorized Settings Modules Hub */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              02. Modular Settings & Infrastructure Categories
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Jump directly to any situational configuration module
            </p>
          </div>
          <button
            onClick={() => setActiveTab('settings')}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            <span>Open Settings Hub</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {settingsModulesShortcut.map(mod => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                onClick={() => {
                  setActiveSettingsModule(mod.id);
                  setActiveTab('settings');
                }}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex items-center justify-between gap-3 text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {mod.title}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {mod.meta}
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 3: Platform Telemetry & Operations Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => setActiveTab('agents')}
          className="cursor-pointer p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 transition-all"
        >
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Configured Agents</span>
            <Bot className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {stats.active_agents}
            </span>
            <span className="text-xs text-slate-500">/ {stats.total_agents} active</span>
          </div>
        </div>

        <div
          onClick={() => setActiveTab('tasks')}
          className="cursor-pointer p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 transition-all"
        >
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Execution Queue</span>
            <Workflow className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {stats.running_tasks}
            </span>
            <span className="text-xs text-slate-500">/ {stats.total_tasks} tasks</span>
          </div>
        </div>

        <div
          onClick={() => setActiveTab('approvals')}
          className="cursor-pointer p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 transition-all"
        >
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Human Approvals</span>
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {stats.pending_approvals}
            </span>
            <span className="text-xs text-slate-500">awaiting review</span>
          </div>
        </div>

        <div
          onClick={() => setActiveTab('files')}
          className="cursor-pointer p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 transition-all"
        >
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Cloudflare R2 Store</span>
            <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-900 dark:text-white">
              {formatBytes(stats.storage_bytes_used)}
            </span>
            <span className="text-xs text-slate-500">({stats.total_files} files)</span>
          </div>
        </div>
      </div>

      {/* Inline Pending Approvals Callout */}
      {pendingApprovals.length > 0 && (
        <div className="p-5 rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50/70 dark:bg-amber-950/30 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-200 flex items-center gap-2">
                  <span>{pendingApprovals.length} Consequential Action{pendingApprovals.length > 1 ? 's' : ''} Awaiting Authorization</span>
                  <RiskBadge risk={pendingApprovals[0].risk_level} />
                </h2>
                <p className="text-xs text-amber-800 dark:text-amber-400 mt-0.5">
                  Action: <strong className="font-semibold">{pendingApprovals[0].action_name}</strong> by agent {pendingApprovals[0].agent_name}.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                onClick={() => decideApproval(pendingApprovals[0].id, 'rejected', 'Rejected from Workspace Hub')}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-100 transition-colors"
              >
                Reject
              </button>
              <button
                onClick={() => decideApproval(pendingApprovals[0].id, 'approved', 'Authorized from Workspace Hub')}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                Authorize Execution
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Workflows & Agent Fleet */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Active Distributed Workflows
            </h2>
            <button
              onClick={() => setActiveTab('tasks')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              View Queue ({tasks.length})
            </button>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
            {runningTasks.length === 0 ? (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                <CheckCircle2 className="w-7 h-7 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                <p className="text-xs font-medium text-slate-700 dark:text-slate-300">All studio queues nominal</p>
                <p className="text-xs mt-1 text-slate-500">
                  Launch a synthesis job from Code, Image, Video, or Screenwriter workspaces.
                </p>
              </div>
            ) : (
              runningTasks.slice(0, 4).map(task => (
                <div
                  key={task.id}
                  onClick={() => {
                    setSelectedTaskId(task.id);
                    setActiveTab('tasks');
                  }}
                  className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                        <StatusBadge status={task.status} size="sm" />
                        <span>·</span>
                        <span>{task.agent_name || task.agent_id}</span>
                        <span>·</span>
                        <span>Priority: {task.priority}</span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-1 truncate">
                        {task.title}
                      </h3>
                    </div>
                    <span className="text-xs font-mono font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                      {task.progress_percent}%
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Agent Fleet Summary */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Specialized Studio Agents
            </h2>
            <button
              onClick={() => setActiveTab('agents')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              Manage Fleet
            </button>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
            {agents.slice(0, 5).map(agent => (
              <div
                key={agent.id}
                onClick={() => {
                  setSelectedAgentId(agent.id);
                  setActiveTab('agents');
                }}
                className="p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                    {agent.name}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {agent.model}
                  </div>
                </div>
                <StatusBadge status={agent.is_enabled ? 'enabled' : 'disabled'} size="sm" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
