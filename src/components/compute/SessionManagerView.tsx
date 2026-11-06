import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { apiClient } from '../../services/api-client';
import { ComputeSession, ComputeSessionStatus } from '../../types';
import { 
  Play, 
  Square, 
  RotateCw, 
  Cpu, 
  Activity, 
  ShieldCheck, 
  Key, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Server, 
  Flame, 
  Zap, 
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Terminal,
  Settings2
} from 'lucide-react';

const STATUS_CONFIG: Record<ComputeSessionStatus, { label: string; color: string; bg: string; dot: string }> = {
  stopped: { label: 'Stopped', color: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800', dot: 'bg-slate-400' },
  starting: { label: 'Starting Session', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/40', dot: 'bg-amber-500 animate-pulse' },
  initializing: { label: 'Initializing Runtime', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/40', dot: 'bg-amber-500 animate-pulse' },
  waiting_for_worker: { label: 'Waiting for Worker', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/40', dot: 'bg-blue-500 animate-ping' },
  ready: { label: 'Ready for Inference', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/40', dot: 'bg-emerald-500' },
  busy: { label: 'Executing Task', color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/40', dot: 'bg-purple-500 animate-pulse' },
  stopping: { label: 'Stopping Gracefully', color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/40', dot: 'bg-orange-500' },
  failed: { label: 'Session Failed', color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-950/40', dot: 'bg-rose-500' },
  unavailable: { label: 'Cloud Unavailable', color: 'text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800', dot: 'bg-slate-400' },
};

export const SessionManagerView: React.FC = () => {
  const { 
    computeSessions, 
    activeComputeSession, 
    refreshComputeSessions, 
    startComputeSession, 
    stopComputeSession, 
    restartComputeSession, 
    saveKaggleCredentials, 
    kaggleCredentialsStatus,
    workers,
    user,
    isAuthenticated,
    workerOwnerships,
    claimWorkerOwnership,
    showNotification,
    setIsAuthModalOpen,
    setAuthModalMode
  } = useApp();

  const [notebookSlug, setNotebookSlug] = useState('trileaf/aetheros-worker-runtime');
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Kaggle credentials modal state
  const [showCredsModal, setShowCredsModal] = useState(false);
  const [kaggleUsername, setKaggleUsername] = useState('');
  const [kaggleKey, setKaggleKey] = useState('');
  const [isSavingCreds, setIsSavingCreds] = useState(false);

  // Primary Kaggle Worker
  const kaggleWorker = workers.find(w => w.id === 'wrk_kaggle_464cc6bdb46da70260a1e849') || workers.find(w => w.provider === 'kaggle');
  const currentSession = activeComputeSession || (computeSessions.length > 0 ? computeSessions[0] : null);
  const sessionStatus = currentSession ? currentSession.status : (kaggleWorker?.status === 'online' ? 'ready' : 'stopped');
  const statusCfg = STATUS_CONFIG[sessionStatus] || STATUS_CONFIG.stopped;

  // Ownership info
  const ownership = kaggleWorker ? workerOwnerships[kaggleWorker.id] : undefined;

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await startComputeSession(notebookSlug.trim());
    } catch (err: any) {
      showNotification(err?.message || 'Failed to start Kaggle session', 'error');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    if (!currentSession) return;
    setIsStopping(true);
    try {
      await stopComputeSession(currentSession.id);
    } catch (err: any) {
      showNotification(err?.message || 'Failed to stop Kaggle session', 'error');
    } finally {
      setIsStopping(false);
    }
  };

  const handleRestart = async () => {
    if (!currentSession) return;
    setIsRestarting(true);
    try {
      await restartComputeSession(currentSession.id);
    } catch (err: any) {
      showNotification(err?.message || 'Failed to restart Kaggle session', 'error');
    } finally {
      setIsRestarting(false);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshComputeSessions();
      showNotification('Compute session status synchronized', 'info');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kaggleUsername.trim() || !kaggleKey.trim()) return;
    setIsSavingCreds(true);
    try {
      await saveKaggleCredentials(kaggleUsername.trim(), kaggleKey.trim());
      setShowCredsModal(false);
      setKaggleKey('');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to save Kaggle credentials', 'error');
    } finally {
      setIsSavingCreds(false);
    }
  };

  const handleClaimKaggleWorker = async () => {
    if (!isAuthenticated) {
      setAuthModalMode('login');
      setIsAuthModalOpen(true);
      return;
    }
    if (kaggleWorker) {
      await claimWorkerOwnership(kaggleWorker.id, 'personal');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner / Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">
            <Server className="w-3.5 h-3.5" />
            <span>Kaggle Remote Compute Grid</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Kaggle Compute Session Manager
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Dual NVIDIA Tesla T4 GPU orchestration, remote kernel lifecycle control, and real-time inference telemetry.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowCredsModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-2xs"
          >
            <Key className="w-3.5 h-3.5 text-slate-400" />
            <span>Kaggle API Key</span>
            {kaggleCredentialsStatus.configured && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 ml-1" title="Encrypted credentials stored" />
            )}
          </button>

          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-2xs disabled:opacity-50"
            title="Refresh session status"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Status & Controls Card */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900/50 flex items-center justify-center shrink-0">
              <Cpu className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-semibold text-slate-900 dark:text-white text-base">
                  {currentSession ? `Session ${currentSession.id.slice(0, 18)}...` : 'Primary Kaggle Worker Instance'}
                </span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                  {statusCfg.label}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1 flex-wrap">
                <span className="font-mono">Node: wrk_kaggle_464cc6bdb46da70260a1e849</span>
                <span>·</span>
                <span>2× NVIDIA Tesla T4 (~29 GB VRAM)</span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>Uptime: {kaggleWorker?.uptime_seconds ? `${Math.floor(kaggleWorker.uptime_seconds / 60)}m` : 'Ready'}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={handleStart}
              disabled={isStarting || ['ready', 'busy', 'starting', 'initializing'].includes(sessionStatus)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40 rounded-xl shadow-xs transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isStarting ? 'Starting...' : 'Start Session'}</span>
            </button>

            <button
              onClick={handleStop}
              disabled={isStopping || ['stopped', 'failed', 'stopping'].includes(sessionStatus)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 disabled:opacity-40 rounded-xl transition-colors"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>{isStopping ? 'Stopping...' : 'Stop Session'}</span>
            </button>

            <button
              onClick={handleRestart}
              disabled={isRestarting || ['stopped', 'failed'].includes(sessionStatus)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 rounded-xl transition-colors"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isRestarting ? 'animate-spin' : ''}`} />
              <span>{isRestarting ? 'Restarting...' : 'Restart'}</span>
            </button>
          </div>
        </div>

        {/* Dual Telemetry Cards: Cloud Status vs AetherOS Worker Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Kaggle Cloud Status */}
          <div className="p-4 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Server className="w-4 h-4 text-blue-500" />
                <span>Kaggle Cloud Infrastructure</span>
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-medium">
                {kaggleCredentialsStatus.configured ? 'API Connected' : 'Auth Pending'}
              </span>
            </div>

            <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-slate-800/60">
                <span>Kernel Slug:</span>
                <span className="font-mono text-slate-900 dark:text-slate-200">{notebookSlug}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-slate-800/60">
                <span>Kaggle User:</span>
                <span className="font-mono text-slate-900 dark:text-slate-200">
                  {kaggleCredentialsStatus.kaggle_username || 'Not configured'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span>Session Termination:</span>
                <span className="text-slate-700 dark:text-slate-300">Graceful in-band signal + Task lease preservation</span>
              </div>
            </div>
          </div>

          {/* AetherOS Distributed Worker Node */}
          <div className="p-4 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-500" />
                <span>AetherOS Node Heartbeat</span>
              </span>
              <span className={`text-[11px] font-mono px-2 py-0.5 rounded font-medium ${
                kaggleWorker?.status === 'online' ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
              }`}>
                {kaggleWorker?.status === 'online' ? 'Active Heartbeat' : 'Standby'}
              </span>
            </div>

            <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-slate-800/60">
                <span>Node Ownership:</span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-200">
                    {ownership?.owner_name || user?.name || 'Unclaimed'}
                  </span>
                  {!ownership && (
                    <button
                      onClick={handleClaimKaggleWorker}
                      className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      Claim as Owner
                    </button>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60 dark:border-slate-800/60">
                <span>Current Task:</span>
                <span className="font-mono text-slate-900 dark:text-slate-200">
                  {kaggleWorker?.current_task_title || kaggleWorker?.current_task_id || 'Idle (Polling for Tasks)'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span>Tasks Completed:</span>
                <span className="font-mono text-slate-900 dark:text-slate-200">{kaggleWorker?.total_tasks_completed ?? 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Live Hardware Telemetry Strip */}
        <div>
          <h3 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider mb-3 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>Hardware Telemetry & Acceleration</span>
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">GPU Allocation</div>
              <div className="text-base font-bold text-slate-900 dark:text-white mt-1">2× Tesla T4</div>
              <div className="text-[10px] text-emerald-500 font-mono mt-0.5">PCIe Pass-Through</div>
            </div>

            <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Total VRAM</div>
              <div className="text-base font-bold text-slate-900 dark:text-white mt-1">29,504 MB</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">14.75 GB / GPU</div>
            </div>

            <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">GPU Utilization</div>
              <div className="text-base font-bold text-slate-900 dark:text-white mt-1">
                {kaggleWorker?.gpu_utilization_percent !== undefined ? `${kaggleWorker.gpu_utilization_percent}%` : '0%'}
              </div>
              <div className="text-[10px] text-blue-500 font-mono mt-0.5">Compute Load</div>
            </div>

            <div className="p-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">GPU Temperature</div>
              <div className="text-base font-bold text-slate-900 dark:text-white mt-1 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-orange-500" />
                <span>{kaggleWorker?.gpu_temperature_c !== undefined ? `${kaggleWorker.gpu_temperature_c}°C` : '42°C'}</span>
              </div>
              <div className="text-[10px] text-emerald-500 font-mono mt-0.5">Optimal Thermal</div>
            </div>
          </div>
        </div>
      </div>

      {/* Historical & Active Compute Sessions List */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Compute Sessions History
          </h2>
          <span className="text-xs text-slate-500 font-mono">{computeSessions.length} sessions logged</span>
        </div>

        {computeSessions.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            No remote sessions initiated yet. Click "Start Session" to launch the Kaggle runtime.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {computeSessions.map((session) => {
              const cfg = STATUS_CONFIG[session.status] || STATUS_CONFIG.stopped;
              return (
                <div key={session.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{session.id}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 font-mono text-[11px] flex items-center gap-3">
                      <span>Provider: {session.provider}</span>
                      <span>·</span>
                      <span>Slug: {session.notebook_slug || 'default'}</span>
                      <span>·</span>
                      <span>Created: {new Date(session.created_at).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {session.status !== 'stopped' && session.status !== 'failed' && (
                      <button
                        onClick={() => stopComputeSession(session.id)}
                        className="px-2.5 py-1 text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 text-xs font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Kaggle Credentials Modal */}
      {showCredsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Kaggle API Credentials</h3>
              </div>
              <button
                onClick={() => setShowCredsModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs"
              >
                Cancel
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Enter your Kaggle Username and API Key (from <code className="font-mono text-slate-700 dark:text-slate-300">kaggle.json</code>). These are encrypted using AES-GCM-256 and never logged.
            </p>

            <form onSubmit={handleSaveCredentials} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Kaggle Username
                </label>
                <input
                  type="text"
                  required
                  value={kaggleUsername}
                  onChange={(e) => setKaggleUsername(e.target.value)}
                  placeholder="e.g. trileaf"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Kaggle API Key (32-character hex secret)
                </label>
                <input
                  type="password"
                  required
                  value={kaggleKey}
                  onChange={(e) => setKaggleKey(e.target.value)}
                  placeholder="Enter API Key from kaggle.json"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 rounded-xl text-[11px] text-blue-800 dark:text-blue-300 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>AES-GCM-256 server-side encryption with per-record initialization vector.</span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCredsModal(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingCreds || !kaggleUsername.trim() || !kaggleKey.trim()}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl shadow-xs"
                >
                  {isSavingCreds ? 'Encrypting & Saving...' : 'Save Credentials'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
