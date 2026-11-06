import React from 'react';
import { useApp } from '../../context/AppContext';
import { StatusBadge, RiskBadge } from '../common/StatusBadge';
import { 
  Bot, 
  Workflow, 
  ShieldAlert, 
  HardDrive, 
  ArrowRight, 
  Plus, 
  CheckCircle2, 
  Clock, 
  Cpu, 
  Sparkles 
} from 'lucide-react';

export const DashboardView: React.FC<{ onNewTaskClick: () => void }> = ({ onNewTaskClick }) => {
  const { 
    agents, 
    tasks, 
    approvals, 
    files, 
    logs, 
    stats, 
    runtimeConfig, 
    setActiveTab, 
    setSelectedTaskId,
    setSelectedAgentId,
    pingRuntime,
    decideApproval,
  } = useApp();


  const pendingApprovals = approvals.filter(a => a.status === 'pending');
  const runningTasks = tasks.filter(t => t.status === 'running' || t.status === 'waiting_approval');
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Top Welcome / Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Platform Overview
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Autonomous agent operations, task execution traces, and human authorization queue.
          </p>
        </div>

        {/* Runtime Engine Connection Capsule */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => pingRuntime()}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors shadow-2xs"
            title="Click to ping runtime engine"
          >
            <Cpu className="w-3.5 h-3.5 text-blue-500" />
            <span className="font-mono tabular-nums">
              {runtimeConfig.is_online && runtimeConfig.node_id
                ? `${runtimeConfig.node_id} (${runtimeConfig.last_ping_latency_ms || 0}ms)`
                : 'No compute worker online'}
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                runtimeConfig.is_online && runtimeConfig.node_id
                  ? 'bg-emerald-500'
                  : 'bg-rose-500'
              }`}
            />
          </button>

          <button
            onClick={onNewTaskClick}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Task</span>
          </button>
        </div>
      </div>

      {/* KPI Metric Strip (Tabular figures, single elevation) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Agents */}
        <div 
          onClick={() => setActiveTab('agents')}
          className="cursor-pointer p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 hover:border-slate-300 dark:hover:border-slate-700 transition-all shadow-2xs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Agent Fleet</span>
            <Bot className="w-4 h-4 text-blue-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {stats.active_agents}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              / {stats.total_agents} active
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
            <span>Configured assistants</span>
            <ArrowRight className="w-3 h-3 text-slate-400" />
          </div>
        </div>

        {/* Metric 2: Tasks */}
        <div 
          onClick={() => setActiveTab('tasks')}
          className="cursor-pointer p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 hover:border-slate-300 dark:hover:border-slate-700 transition-all shadow-2xs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Workflows</span>
            <Workflow className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {stats.running_tasks}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              / {stats.total_tasks} total
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
            <span>Execution queue</span>
            <ArrowRight className="w-3 h-3 text-slate-400" />
          </div>
        </div>

        {/* Metric 3: Approvals */}
        <div 
          onClick={() => setActiveTab('approvals')}
          className={`cursor-pointer p-5 rounded-xl border transition-all shadow-2xs ${
            pendingApprovals.length > 0
              ? 'border-amber-300 dark:border-amber-800/80 bg-amber-50/50 dark:bg-amber-950/20'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Pending Approvals</span>
            <ShieldAlert className={`w-4 h-4 ${pendingApprovals.length > 0 ? 'text-amber-500' : 'text-slate-400'}`} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {stats.pending_approvals}
            </span>
            <span className="text-xs text-slate-400">
              {stats.pending_approvals === 1 ? 'action requires review' : 'actions require review'}
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
            <span>Human authorization</span>
            <ArrowRight className="w-3 h-3 text-slate-400" />
          </div>
        </div>

        {/* Metric 4: Files / Storage */}
        <div 
          onClick={() => setActiveTab('files')}
          className="cursor-pointer p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 hover:border-slate-300 dark:hover:border-slate-700 transition-all shadow-2xs"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Cloudflare R2</span>
            <HardDrive className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {formatBytes(stats.storage_bytes_used)}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              ({stats.total_files} files)
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
            <span>Object store</span>
            <ArrowRight className="w-3 h-3 text-slate-400" />
          </div>
        </div>
      </div>

      {/* Interactive Pending Approvals Callout (Inline Authorization) */}
      {pendingApprovals.length > 0 && (
        <div className="p-5 rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50/70 dark:bg-amber-950/30 shadow-2xs space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-200 flex items-center gap-2">
                  <span>{pendingApprovals.length} Consequential Action{pendingApprovals.length > 1 ? 's' : ''} Awaiting Authorization</span>
                  <RiskBadge risk={pendingApprovals[0].risk_level} />
                </h2>
                <p className="text-xs text-amber-800 dark:text-amber-400 mt-0.5">
                  Action: <strong className="font-semibold">{pendingApprovals[0].action_name}</strong> by agent {pendingApprovals[0].agent_name}. Workflow execution is paused.
                </p>
                {pendingApprovals[0].payload.command && (
                  <code className="mt-2 block p-2 rounded bg-slate-950 text-blue-400 text-[11px] font-mono border border-amber-400/30 dark:border-amber-900/40">
                    {pendingApprovals[0].payload.command}
                  </code>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5 self-start md:self-center shrink-0">
              <button
                onClick={() => decideApproval(pendingApprovals[0].id, 'rejected', 'Rejected from Dashboard')}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
              >
                Reject
              </button>
              <button
                onClick={() => decideApproval(pendingApprovals[0].id, 'approved', 'Authorized from Dashboard')}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-2xs transition-colors"
              >
                Authorize Execution
              </button>
              <button
                onClick={() => setActiveTab('approvals')}
                className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline ml-2"
              >
                View all ({pendingApprovals.length})
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Two Column Grid: Running Tasks & Agent Fleet */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column (2 Cols): Live Task Monitor */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Workflow className="w-4 h-4 text-blue-500" />
              <span>Active Workflows</span>
            </h2>
            <button
              onClick={() => setActiveTab('tasks')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              <span>View all ({tasks.length})</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900/90 divide-y divide-slate-100 dark:divide-slate-800/80 shadow-2xs overflow-hidden">
            {runningTasks.length === 0 ? (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-medium">All task queues nominal</p>
                <p className="text-xs mt-1 text-slate-400">No autonomous tasks are currently running.</p>
                <button
                  onClick={onNewTaskClick}
                  className="mt-4 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Submit New Task</span>
                </button>
              </div>
            ) : (
              runningTasks.map(task => (
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
                      <div className="flex items-center gap-2">
                        <StatusBadge status={task.status} size="sm" />
                        <span className="text-xs text-slate-400 font-mono tabular-nums">· {task.agent_name}</span>
                        <span className="text-xs text-slate-400 font-mono tabular-nums">· Priority: {task.priority}</span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-1 truncate">
                        {task.title}
                      </h3>
                      {task.description && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
                          {task.description}
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-xs font-mono font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                        {task.progress_percent}%
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        task.status === 'waiting_approval'
                          ? 'bg-amber-500'
                          : 'bg-blue-600'
                      }`}
                      style={{ width: `${task.progress_percent}%` }}
                    />
                  </div>

                  {/* Current step preview */}
                  {task.steps && task.steps.length > 0 && (
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      <span>
                        Step {task.steps.filter(s => s.status === 'completed').length + 1} of {task.steps.length}: {task.steps.find(s => s.status === 'running' || s.status === 'waiting_approval')?.step_name || 'Processing'}
                      </span>
                      <span className="tabular-nums">
                        {task.claimed_by_worker}
                      </span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Agent Fleet Overview */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Bot className="w-4 h-4 text-blue-500" />
              <span>Configured Agents</span>
            </h2>
            <button
              onClick={() => setActiveTab('agents')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              <span>Manage</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900/90 divide-y divide-slate-100 dark:divide-slate-800/80 shadow-2xs overflow-hidden">
            {agents.length === 0 ? (
              <div className="p-6 text-center text-slate-500 dark:text-slate-400">
                <Bot className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                <p className="text-xs font-medium">No agents configured</p>
                <p className="text-[11px] mt-1 text-slate-400">Create an autonomous agent to execute tasks.</p>
                <button
                  onClick={() => setActiveTab('agents')}
                  className="mt-3 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Agent</span>
                </button>
              </div>
            ) : (
              agents.map(agent => (
              <div
                key={agent.id}
                onClick={() => {
                  setSelectedAgentId(agent.id);
                  setActiveTab('agents');
                }}
                className="p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-2xs"
                    style={{ backgroundColor: agent.avatar_color }}
                  >
                    {agent.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                      {agent.name}
                    </h3>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      <span className="font-mono">{agent.model}</span>
                      <span>·</span>
                      <span>{agent.permitted_tools.length} tools</span>
                    </div>
                  </div>
                </div>

                <div className="shrink-0">
                  <StatusBadge status={agent.is_enabled ? 'enabled' : 'disabled'} size="sm" />
                </div>
              </div>
            ))
          )}
        </div>

          {/* Quick Chat Shortcut */}
          <div 
            onClick={() => setActiveTab('chat')}
            className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800/60 cursor-pointer transition-colors flex items-center justify-between"
          >
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-blue-500" />
              <div>
                <p className="text-xs font-semibold text-slate-900 dark:text-white">Conversational Console</p>
                <p className="text-[11px] text-slate-500">Interact with agents and attach files</p>
              </div>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          </div>
        </div>
      </div>

      {/* Recent Activity Log Feed */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <span>Audit Trail & Activity Log</span>
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            Cloudflare D1 Table: activity_logs
          </span>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900/90 divide-y divide-slate-100 dark:divide-slate-800/80 shadow-2xs overflow-hidden">
          {logs.length === 0 ? (
            <div className="p-6 text-center text-slate-500 dark:text-slate-400 text-xs">
              No activity recorded yet in the audit log.
            </div>
          ) : (
            logs.slice(0, 5).map(log => (
            <div key={log.id} className="p-3.5 flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono text-slate-400 text-[11px] tabular-nums shrink-0">
                  {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="text-slate-500 dark:text-slate-400 capitalize font-mono shrink-0">
                  [{log.category}]
                </span>
                <span className="font-medium text-slate-900 dark:text-slate-200 truncate">
                  {log.action.replace(/_/g, ' ')}
                  {log.task_title && ` — ${log.task_title}`}
                  {log.agent_name && ` (${log.agent_name})`}
                </span>
              </div>
              <span className="text-[11px] text-slate-400 shrink-0 font-mono">
                {log.id}
              </span>
            </div>
          )))}
        </div>
      </div>
    </div>
  );
};
