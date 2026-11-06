import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Task, TaskStatus } from '../../types';
import { StatusBadge } from '../common/StatusBadge';
import { 
  Workflow, 
  Plus, 
  Pause, 
  Play, 
  X, 
  Terminal, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  ArrowUpRight, 
  Server, 
  ShieldAlert 
} from 'lucide-react';

export const TasksView: React.FC<{ onNewTaskClick: () => void }> = ({ onNewTaskClick }) => {
  const { 
    tasks, 
    selectedTaskId, 
    setSelectedTaskId, 
    cancelTask, 
    togglePauseTask, 
    setActiveTab 
  } = useApp();

  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const activeTask = tasks.find(t => t.id === selectedTaskId) || tasks[0];

  const filteredTasks = tasks.filter(t => {
    if (filterStatus !== 'all') {
      if (filterStatus === 'running') {
        if (!['assigned', 'downloading', 'loading_model', 'running', 'uploading'].includes(t.status)) return false;
      } else if (t.status !== filterStatus) {
        return false;
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        (t.agent_name && t.agent_name.toLowerCase().includes(q)) ||
        t.id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeWorkerStates = new Set(['assigned', 'downloading', 'loading_model', 'running', 'uploading']);

  const filterTabs: { id: string; label: string; count?: number }[] = [
    { id: 'all', label: 'All Tasks', count: tasks.length },
    { id: 'running', label: 'Running', count: tasks.filter(t => activeWorkerStates.has(t.status)).length },
    { id: 'waiting_approval', label: 'Waiting Approval', count: tasks.filter(t => t.status === 'waiting_approval').length },
    { id: 'queued', label: 'Queued', count: tasks.filter(t => t.status === 'queued').length },
    { id: 'completed', label: 'Completed', count: tasks.filter(t => t.status === 'completed').length },
    { id: 'failed', label: 'Failed', count: tasks.filter(t => t.status === 'failed').length },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Task Orchestration
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Monitor autonomous execution pipelines, worker nodes, and step-level execution telemetry.
          </p>
        </div>

        <button
          onClick={onNewTaskClick}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Submit Task</span>
        </button>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Interactive Filter Tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg overflow-x-auto text-xs font-medium">
          {filterTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilterStatus(tab.id)}
              className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                filterStatus === tab.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-2xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className="font-mono text-[10px] tabular-nums text-slate-400">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by title, agent, ID..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Main Split Layout: Tasks List (Left) & Inspector (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Tasks List */}
        <div className="lg:col-span-5 space-y-3">
          {filteredTasks.length === 0 ? (
            <div className="p-12 text-center border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900/90 text-slate-500">
              <Workflow className="w-8 h-8 mx-auto mb-2 text-slate-400" />
              <p className="text-sm font-medium">No tasks found</p>
              <p className="text-xs mt-1 text-slate-400">Try modifying your filter or submit a new task.</p>
            </div>
          ) : (
            filteredTasks.map(task => {
              const isSelected = activeTask?.id === task.id;
              return (
                <div
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer shadow-2xs ${
                    isSelected
                      ? 'border-blue-500 dark:border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 ring-1 ring-blue-500'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={task.status} size="sm" />
                        <span className="text-xs text-slate-400 font-mono">· {task.agent_name}</span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-1.5 truncate">
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
                  <div className="mt-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        task.status === 'failed'
                          ? 'bg-rose-500'
                          : task.status === 'waiting_approval'
                          ? 'bg-amber-500'
                          : 'bg-blue-600'
                      }`}
                      style={{ width: `${task.progress_percent}%` }}
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span className="tabular-nums">ID: {task.id}</span>
                    <span className="capitalize">{task.priority} Priority</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Column: Detailed Task Inspector */}
        <div className="lg:col-span-7">
          {activeTask ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs overflow-hidden">
              {/* Inspector Header */}
              <div className="p-6 border-b border-slate-100 dark:border-slate-800/80">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={activeTask.status} size="md" />
                      <span className="text-xs text-slate-400 font-mono">· Task ID: {activeTask.id}</span>
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                      {activeTask.title}
                    </h2>
                  </div>

                  {/* Task Control Buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    {(activeTask.status === 'running' || activeTask.status === 'paused') && (
                      <button
                        onClick={() => togglePauseTask(activeTask.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                      >
                        {activeTask.status === 'running' ? (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5" />
                            <span>Resume</span>
                          </>
                        )}
                      </button>
                    )}

                    {activeTask.status === 'waiting_approval' && (
                      <button
                        onClick={() => setActiveTab('approvals')}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-2xs transition-colors"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Authorize in Queue</span>
                      </button>
                    )}

                    {(activeTask.status === 'running' || activeTask.status === 'queued') && (
                      <button
                        onClick={() => cancelTask(activeTask.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Cancel Task</span>
                      </button>
                    )}
                  </div>
                </div>

                {activeTask.description && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">
                    {activeTask.description}
                  </p>
                )}

                {/* Metadata Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Designated Agent</span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {activeTask.agent_name}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Worker Node</span>
                    <span className="font-mono text-slate-900 dark:text-white">
                      {activeTask.claimed_by_worker || 'Awaiting assignment'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Priority</span>
                    <span className="font-mono capitalize text-slate-900 dark:text-white">
                      {activeTask.priority}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Started At</span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-white">
                      {activeTask.started_at ? new Date(activeTask.started_at).toLocaleTimeString() : 'Queued'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Step-by-Step Execution Trace */}
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Step-by-Step Execution Plan ({activeTask.steps?.length || 0} Steps)
                  </h3>
                  <span className="text-xs font-mono tabular-nums text-slate-400">
                    {activeTask.progress_percent}% Overall Progress
                  </span>
                </div>

                {activeTask.error_message && (
                  <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
                    <div className="flex items-center gap-2 font-semibold mb-1">
                      <AlertCircle className="w-4 h-4 text-rose-500" />
                      <span>Execution Halted</span>
                    </div>
                    <p className="font-mono text-[11px]">{activeTask.error_message}</p>
                  </div>
                )}

                <div className="relative pl-3 space-y-4 before:absolute before:left-5 before:top-4 before:bottom-4 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                  {activeTask.steps?.map((step, idx) => {
                    const isStepRunning = ['assigned', 'downloading', 'loading_model', 'running', 'uploading'].includes(step.status);
                    const isStepBlocked = step.status === 'waiting_approval';
                    const isStepCompleted = step.status === 'completed';

                    return (
                      <div
                        key={step.id}
                        className={`relative p-4 rounded-xl border transition-all shadow-2xs ${
                          isStepBlocked
                            ? 'border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20'
                            : isStepRunning
                            ? 'border-blue-400 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold border shrink-0 ${
                              isStepCompleted
                                ? 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-500 text-emerald-600 dark:text-emerald-400'
                                : isStepBlocked
                                ? 'bg-amber-50 dark:bg-amber-950/80 border-amber-500 text-amber-600 dark:text-amber-400'
                                : isStepRunning
                                ? 'bg-blue-50 dark:bg-blue-950/80 border-blue-500 text-blue-600 dark:text-blue-400 animate-pulse'
                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'
                            }`}>
                              {step.step_number}
                            </span>
                            <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                              {step.step_name}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <StatusBadge status={step.status} size="sm" />
                            {step.duration_ms > 0 && (
                              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                                {step.duration_ms}ms
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Step Logs Console */}
                        {step.logs && (
                          <div className="mt-3 p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed border border-slate-800/80 shadow-inner">
                            {step.logs}
                          </div>
                        )}

                        {/* Step Blocked Action Alert */}
                        {isStepBlocked && (
                          <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-900/60 flex items-center justify-between gap-3">
                            <span className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                              Execution waiting for human authorization
                            </span>
                            <button
                              onClick={() => setActiveTab('approvals')}
                              className="px-3 py-1 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md transition-colors shadow-2xs"
                            >
                              Open Approval
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>


                {/* Task Result Output Payload */}
                {activeTask.result_payload && (
                  <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-2">
                      Result Payload
                    </span>
                    <pre className="p-3 rounded-lg bg-slate-950 text-emerald-400 font-mono text-xs overflow-x-auto border border-slate-800">
                      {JSON.stringify(activeTask.result_payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-12 text-center border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 text-slate-400">
              Select a task from the list to view its execution trace.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
