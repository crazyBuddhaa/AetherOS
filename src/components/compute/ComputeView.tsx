import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Cpu, 
  Server, 
  Activity, 
  Plus, 
  RefreshCw, 
  Copy, 
  Check, 
  Terminal, 
  Flame, 
  Layers, 
  ShieldCheck, 
  ExternalLink, 
  HardDrive, 
  Zap, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  UserCheck,
  Download,
  Code2,
  Send,
  HelpCircle,
  ArrowRight
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { SessionManagerView } from './SessionManagerView';

export const ComputeView: React.FC = () => {
  const { 
    workers, 
    models, 
    registerWorker, 
    showNotification, 
    refreshAll, 
    submitTask,
    workerOwnerships,
    claimWorkerOwnership,
    user,
    isAuthenticated,
    setIsAuthModalOpen,
    setAuthModalMode
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'sessions' | 'workers' | 'models' | 'guide' | 'dispatch'>('sessions');
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [isCopyRunnerModalOpen, setIsCopyRunnerModalOpen] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // New Worker Form State
  const [nodeName, setNodeName] = useState('');
  const [provider, setProvider] = useState<'kaggle' | 'oracle' | 'runpod' | 'self_hosted'>('kaggle');
  const [gpuModel, setGpuModel] = useState('NVIDIA Tesla T4');
  const [gpuCount, setGpuCount] = useState(2);
  const [vramGb, setVramGb] = useState(30);
  const [systemRamGb, setSystemRamGb] = useState(32);
  const [contributorName, setContributorName] = useState('');
  const [newWorkerCredentials, setNewWorkerCredentials] = useState<{ workerId: string; apiKey: string } | null>(null);

  // Test Task Dispatcher State
  const [testTaskTitle, setTestTaskTitle] = useState('Verify Dual-T4 CUDA Compute & Run Reasoning Prompt');
  const [testTaskPrompt, setTestTaskPrompt] = useState('Write a clean, parameterized SQLite migration query that adds a composite index on weather_records(region_id, recorded_at DESC).');
  const [testTaskModel, setTestTaskModel] = useState('qwen-2.5-coder-14b');
  const [testTaskMode, setTestTaskMode] = useState<'inference' | 'hardware_diagnostic'>('inference');
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setIsRefreshing(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    showNotification(`Copied ${label} to clipboard`, 'success');
    setTimeout(() => setCopiedText(null), 2500);
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await registerWorker({
        name: nodeName || `${contributorName || 'Contributor'} ${provider.toUpperCase()} (${gpuModel})`,
        provider,
        gpu_model: gpuModel,
        gpu_count: gpuCount,
        vram_mb: vramGb * 1024,
        system_ram_mb: systemRamGb * 1024,
        contributor_name: contributorName || 'Anonymous Contributor',
      });
      setNewWorkerCredentials({
        workerId: res.worker.id,
        apiKey: res.apiKey,
      });
      showNotification('Worker node registered successfully', 'success');
    } catch (err: any) {
      showNotification(`Failed to register worker: ${err.message}`, 'error');
    }
  };

  const handleDispatchTestTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTaskTitle.trim()) return;
    setIsSubmittingTask(true);
    try {
      await submitTask({
        agentId: 'agent_dataops',
        title: testTaskTitle,
        description:
          testTaskMode === 'hardware_diagnostic'
            ? 'PyTorch tensor matmul & CUDA dual-GPU verification task.'
            : `Distributed GPU local inference workload via ${testTaskModel}.`,
        inputPayload:
          testTaskMode === 'hardware_diagnostic'
            ? { task_type: 'hardware_diagnostic', require_gpu: true, matrix_dim: 1024 }
            : {
                model: testTaskModel,
                prompt: testTaskPrompt,
                max_tokens: 512,
                temperature: 0.2,
                require_gpu: true,
              },
        priority: 'high',
      });
      showNotification('Task dispatched to distributed compute queue!', 'success');
      setTestTaskTitle('');
    } catch (err: any) {
      showNotification(`Failed to dispatch task: ${err.message}`, 'error');
    } finally {
      setIsSubmittingTask(false);
    }
  };

  const totalGpus = workers.reduce((acc, w) => acc + (w.status === 'online' || w.status === 'busy' ? w.gpu_count : 0), 0);
  const totalVramGb = Math.round(workers.reduce((acc, w) => acc + (w.status === 'online' || w.status === 'busy' ? w.vram_mb : 0), 0) / 1024);
  const activeNodesCount = workers.filter(w => w.status === 'online' || w.status === 'busy').length;
  const totalTasksCompleted = workers.reduce((acc, w) => acc + (w.total_tasks_completed || 0), 0);

  const platformOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://aetheros-agent-platform.trileaf.workers.dev';

  const standaloneKaggleRunnerCode = `# ==============================================================================
# AetherOS Distributed Compute Node - Canonical Kaggle Single-Cell Launcher
# Compatible with Kaggle Dual NVIDIA Tesla T4 (2x 16GB VRAM)
# Repository: https://github.com/crazyBuddhaa/AetherOS
# ==============================================================================
# Kaggle Settings (Right Sidebar):
#   1. Accelerator: GPU T4 x2
#   2. Internet:    Internet On
#   3. Optional Kaggle Secrets (Add-ons -> Secrets):
#      - AETHER_WORKER_ID & AETHER_WORKER_KEY (pre-registered worker credentials)
#      - AETHER_REGISTRATION_TOKEN            (if gateway enforces enrollment token)
# ==============================================================================
import os, subprocess, sys
from pathlib import Path

os.environ.setdefault("AETHER_PLATFORM_URL", "${platformOrigin}")
os.environ.setdefault("CONTRIBUTOR_NAME", "Kaggle Community Contributor")${
    newWorkerCredentials
      ? `\nos.environ.setdefault("AETHER_WORKER_ID", "${newWorkerCredentials.workerId}")`
      : ''
  }

# Load credentials from Kaggle Secrets without printing secret values
try:
    from kaggle_secrets import UserSecretsClient
    _client = UserSecretsClient()
    for _k in ("AETHER_PLATFORM_URL", "AETHER_WORKER_ID", "AETHER_WORKER_KEY", "AETHER_REGISTRATION_TOKEN"):
        if not os.environ.get(_k):
            try:
                _v = _client.get_secret(_k)
                if _v:
                    os.environ[_k] = str(_v).strip()
            except Exception:
                pass
except ImportError:
    pass

work_dir = Path("/kaggle/working/AetherOS")
if (Path.cwd() / "worker-runtime" / "aether_worker.py").is_file():
    work_dir = Path.cwd()
elif work_dir.exists():
    subprocess.check_call(["git", "-C", str(work_dir), "pull", "--ff-only"])
else:
    subprocess.check_call(["git", "clone", "--depth", "1", "https://github.com/crazyBuddhaa/AetherOS.git", str(work_dir)])

subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "-r", str(work_dir / "worker-runtime" / "requirements.txt")])
sys.path.insert(0, str(work_dir / "worker-runtime"))

import aether_worker
health = aether_worker.WorkerApiClient(os.environ["AETHER_PLATFORM_URL"]).check_health()
print(f"Control plane online: D1={health.get('d1_connected')} | R2={health.get('r2_connected')}")
aether_worker.run_worker()`;

  return (
    <div className="space-y-8 pb-12 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <Cpu className="w-7 h-7 text-blue-500" />
            <span>Distributed Compute Grid</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Centrally coordinated, multi-provider GPU compute network. Kaggle T4x2, contributor nodes, and self-hosted runtimes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          {/* Quick-Launch Kaggle Notebook Download */}
          <a
            href="/downloads/AetherOS_Kaggle_Worker.ipynb"
            download="AetherOS_Kaggle_Worker.ipynb"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors shadow-2xs"
            title="Download ready-to-run Jupyter notebook for Kaggle"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download .ipynb</span>
          </a>

          {/* Copy Standalone Single-Cell Script */}
          <button
            onClick={() => setIsCopyRunnerModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
          >
            <Code2 className="w-3.5 h-3.5 text-blue-500" />
            <span>Copy Runner Script</span>
          </button>

          <button
            onClick={() => {
              setNewWorkerCredentials(null);
              setIsRegisterModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Connect Worker Node</span>
          </button>
        </div>
      </div>

      {/* Aggregate Cluster Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Online Compute Nodes</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {activeNodesCount} <span className="text-xs font-normal text-slate-400">/ {workers.length} registered</span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">Kaggle T4×2 & contributor clusters</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Available GPUs</span>
            <Layers className="w-4 h-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {totalGpus} <span className="text-xs font-normal text-slate-400">GPUs active</span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">NVIDIA Tensor Core architecture</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Aggregate VRAM Capacity</span>
            <HardDrive className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {totalVramGb} <span className="text-xs font-normal text-slate-400">GB GDDR6</span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">Distributed across active worker nodes</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Autonomous Tasks Served</span>
            <Zap className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {totalTasksCompleted} <span className="text-xs font-normal text-slate-400">tasks completed</span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">Pull-based zero-ingress dispatch</span>
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        <button
          onClick={() => setActiveSubTab('sessions')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeSubTab === 'sessions'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Cpu className="w-4 h-4 text-emerald-400" />
          <span>Kaggle Session Manager</span>
        </button>

        <button
          onClick={() => setActiveSubTab('workers')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeSubTab === 'workers'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>Active Nodes ({workers.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('dispatch')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeSubTab === 'dispatch'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Zap className="w-4 h-4 text-amber-400" />
          <span>Dispatch Test Task</span>
        </button>

        <button
          onClick={() => setActiveSubTab('models')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeSubTab === 'models'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Model Registry & VRAM Profiles ({models.length || 8})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('guide')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeSubTab === 'guide'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>Kaggle Setup Guide (3 Options)</span>
        </button>
      </div>

      {/* SUB-TAB 0: KAGGLE COMPUTE SESSION MANAGER */}
      {activeSubTab === 'sessions' && <SessionManagerView />}

      {/* SUB-TAB 1: WORKER NODES */}
      {activeSubTab === 'workers' && (
        <div className="space-y-4">
          {workers.length === 0 ? (
            <div className="p-12 text-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
              <Server className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">No Compute Workers Connected</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                No distributed compute workers are currently registered or connected to the platform. Launch a Kaggle GPU worker (dual Tesla T4) or register a node to execute local model inference.
              </p>
              <div className="mt-4 flex items-center justify-center gap-3">
                <button
                  onClick={() => setIsRegisterModalOpen(true)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-2xs inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Register Worker</span>
                </button>
                <button
                  onClick={() => setActiveSubTab('guide')}
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 inline-flex items-center gap-1.5"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Kaggle Setup Guide</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {workers.map(worker => {
                const isOnline = worker.status === 'online' || worker.status === 'busy';
                const vramFormatted = Math.round(worker.vram_mb / 1024);

                return (
                  <div
                    key={worker.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xs space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                          <Cpu className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-sm text-slate-900 dark:text-white">
                              {worker.name}
                            </h3>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                              worker.status === 'busy'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                : isOnline
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                                worker.status === 'busy' ? 'bg-amber-500 animate-pulse' : isOnline ? 'bg-emerald-500' : 'bg-slate-400'
                              }`} />
                              <span className="capitalize">{worker.status}</span>
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-400">
                            {worker.id} · {worker.provider.toUpperCase()}
                          </span>
                        </div>
                      </div>

                      <span className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                        {worker.gpu_count}× {worker.gpu_model}
                      </span>
                    </div>

                    {/* Hardware Telemetry Bar */}
                    <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 text-xs">
                      <div>
                        <span className="text-slate-400 text-[10px] block">VRAM Pool</span>
                        <span className="font-semibold text-slate-900 dark:text-white mt-0.5 block tabular-nums">
                          {vramFormatted} GB
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 text-[10px] block">GPU Utilization</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                            {worker.gpu_utilization_percent !== undefined ? `${worker.gpu_utilization_percent}%` : 'Not reported'}
                          </span>
                        </div>
                      </div>

                      <div>
                        <span className="text-slate-400 text-[10px] block">GPU Temperature</span>
                        <span className="font-semibold text-slate-900 dark:text-white mt-0.5 block tabular-nums flex items-center gap-1">
                          <Flame className="w-3 h-3 text-orange-500" />
                          <span>{worker.gpu_temperature_c !== undefined ? `${worker.gpu_temperature_c}°C` : 'Not reported'}</span>
                        </span>
                      </div>
                    </div>

                    {/* Worker Owner & Claiming */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] gap-2">
                      <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 truncate">
                        <UserCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="truncate">
                          Owner: <strong>{workerOwnerships[worker.id]?.owner_name || (worker.id === 'wrk_kaggle_464cc6bdb46da70260a1e849' && user ? user.name : worker.contributor_name || 'Autonomous Community Node')}</strong>
                        </span>
                        {!workerOwnerships[worker.id] && (
                          <button
                            onClick={() => {
                              if (!isAuthenticated) {
                                setAuthModalMode('login');
                                setIsAuthModalOpen(true);
                              } else {
                                claimWorkerOwnership(worker.id, 'personal');
                              }
                            }}
                            className="ml-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                          >
                            Claim
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1 text-slate-400 shrink-0 font-mono text-[10px]">
                        <Clock className="w-3 h-3" />
                        <span>{worker.uptime_seconds !== undefined ? `${Math.round(worker.uptime_seconds / 60)}m uptime` : '—'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: DISPATCH TEST TASK */}
      {activeSubTab === 'dispatch' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xs space-y-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <span>Dispatch Workload to Distributed Compute Workers</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Submit a live text reasoning and code execution task into the Cloudflare D1 queue. Any connected Kaggle T4 worker will claim and execute it.
            </p>
          </div>

          <form onSubmit={handleDispatchTestTask} className="space-y-4 max-w-2xl text-xs">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1.5">
                Task Title / Directive
              </label>
              <input
                type="text"
                value={testTaskTitle}
                onChange={e => setTestTaskTitle(e.target.value)}
                placeholder="e.g. Generate and validate high-throughput SQL indexing strategy"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1.5">
                  Execution Mode
                </label>
                <select
                  value={testTaskMode}
                  onChange={e => setTestTaskMode(e.target.value as 'inference' | 'hardware_diagnostic')}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                >
                  <option value="inference">Local LLM Inference (Transformers / Accelerate)</option>
                  <option value="hardware_diagnostic">PyTorch CUDA Tensor Verification Diagnostic</option>
                </select>
              </div>

              {testTaskMode === 'inference' ? (
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1.5">
                    Target Workload Model
                  </label>
                  <select
                    value={testTaskModel}
                    onChange={e => setTestTaskModel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  >
                    <option value="qwen-2.5-coder-14b">Qwen 2.5 Coder 14B (Code Reasoning)</option>
                    <option value="deepseek-r1-distill-qwen-14b">DeepSeek R1 Distill 14B (Deep Logic)</option>
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1.5">
                    Target Worker
                  </label>
                  <div className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 flex items-center justify-between">
                    <span>Auto-Scheduled (First Available CUDA Node)</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                </div>
              )}
            </div>

            {testTaskMode === 'inference' && (
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1.5">
                  Inference Prompt
                </label>
                <textarea
                  rows={3}
                  value={testTaskPrompt}
                  onChange={e => setTestTaskPrompt(e.target.value)}
                  placeholder="Enter prompt for local model inference..."
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                />
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmittingTask || !testTaskTitle.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs transition-colors shadow-2xs"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSubmittingTask ? 'Enqueueing Task...' : 'Dispatch Task to Grid'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SUB-TAB 3: MULTIMODAL MODEL REGISTRY */}
      {activeSubTab === 'models' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Supported Open-Source Multimodal Models
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Declarative hardware execution constraints and minimum VRAM allocation profiles.
                </p>
              </div>

              <span className="text-xs font-mono text-slate-500">
                Max Available VRAM: {totalVramGb} GB
              </span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {(models.length > 0 ? models : [
                { id: 'qwen-2.5-coder-14b', name: 'Qwen 2.5 Coder 14B', category: 'text', min_vram_mb: 14336, supported_precisions: ['fp16', 'int4'], weights_source: 'Qwen/Qwen2.5-Coder-14B-Instruct', description: 'Premier open coding & reasoning model. Optimized for tensor-parallel on dual T4.' },
                { id: 'deepseek-r1-distill-qwen-14b', name: 'DeepSeek R1 Distill 14B', category: 'text', min_vram_mb: 15360, supported_precisions: ['fp16', 'int4'], weights_source: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B', description: 'High-throughput reasoning model with deep chain-of-thought distillation.' },
                { id: 'sd-1.5-standard', name: 'Stable Diffusion 1.5', category: 'image', min_vram_mb: 6144, supported_precisions: ['fp16'], weights_source: 'runwayml/stable-diffusion-v1-5', description: 'Fast text-to-image synthesis (~2.5s generation per step on T4).' },
                { id: 'sdxl-lightning', name: 'SDXL Lightning 4-Step', category: 'image', min_vram_mb: 10240, supported_precisions: ['fp16'], weights_source: 'ByteDance/SDXL-Lightning', description: 'Photorealistic high-resolution 1024x1024 generation in 4 inference steps.' },
                { id: 'real-esrgan-4x', name: 'Real-ESRGAN 4x+ Upscaler', category: 'image_processing', min_vram_mb: 4096, supported_precisions: ['fp16'], weights_source: 'xinntao/Real-ESRGAN', description: 'High-fidelity spatial super-resolution upscaler.' },
                { id: 'birefnet-bg-removal', name: 'BiRefNet Background Removal', category: 'image_processing', min_vram_mb: 4096, supported_precisions: ['fp16'], weights_source: 'ZhengPeng7/BiRefNet', description: 'Ultra-clean background extraction for multimodal agent workflows.' },
                { id: 'animatediff-motion-v3', name: 'AnimateDiff Motion Module v3', category: 'video', min_vram_mb: 12288, supported_precisions: ['fp16'], weights_source: 'guoyww/animatediff-motion-adapter-v1-5-3', description: 'Short video synthesis from text prompt (16-32 frames at 512x512).' },
                { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo', category: 'audio', min_vram_mb: 4096, supported_precisions: ['fp16'], weights_source: 'openai/whisper-large-v3-turbo', description: 'Fast multilingual speech-to-text transcription engine.' },
              ]).map(m => {
                const requiredGb = Math.round(m.min_vram_mb / 1024);
                const isCompatible = totalVramGb >= requiredGb;

                return (
                  <div key={m.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-950/30 transition-colors">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {m.name}
                        </span>
                        <span className="uppercase text-[10px] px-2 py-0.5 rounded font-mono font-medium bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                          {m.category}
                        </span>
                      </div>
                      <p className="text-slate-500 dark:text-slate-400 text-xs">
                        {m.description}
                      </p>
                      <span className="text-[11px] font-mono text-slate-400 block">
                        Source: {m.weights_source}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <span className="font-mono text-xs font-semibold block text-slate-800 dark:text-slate-200">
                          {requiredGb} GB VRAM
                        </span>
                        <span className={`text-[10px] font-medium flex items-center justify-end gap-1 ${
                          isCompatible ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                        }`}>
                          {isCompatible ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                          <span>{isCompatible ? 'Grid Compatible' : 'Needs Node Upgrade'}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: KAGGLE WORKER SETUP GUIDE (3 OPTIONS DETAILED) */}
      {activeSubTab === 'guide' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xs space-y-8">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              How to Connect Your Kaggle GPUs to AetherOS
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Choose from the three launch options below based on your workflow preference.
            </p>
          </div>

          {/* Three Options Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Option 1 */}
            <div className="p-5 rounded-xl border-2 border-blue-500/40 dark:border-blue-500/30 bg-blue-50/20 dark:bg-blue-950/20 space-y-3 relative">
              <span className="absolute -top-3 right-4 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white uppercase tracking-wider">
                Recommended
              </span>
              <div className="flex items-center gap-2">
                <Download className="w-5 h-5 text-blue-500" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">Option 1: Ready .ipynb</h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Download the pre-configured notebook, upload it to Kaggle, set GPU to <b>T4 x2</b> & toggle <b>Internet On</b>, and click <b>Run All</b>.
              </p>
              <div className="pt-2">
                <a
                  href="/downloads/AetherOS_Kaggle_Worker.ipynb"
                  download="AetherOS_Kaggle_Worker.ipynb"
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .ipynb File</span>
                </a>
              </div>
            </div>

            {/* Option 2 */}
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 space-y-3">
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5 text-indigo-500" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">Option 2: Single-Cell Script</h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Copy a self-contained Python script into any active Kaggle notebook cell. Auto-installs dependencies and starts polling immediately.
              </p>
              <div className="pt-2">
                <button
                  onClick={() => setIsCopyRunnerModalOpen(true)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:border-blue-500 text-slate-800 dark:text-slate-200 text-xs font-semibold transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Script to Clipboard</span>
                </button>
              </div>
            </div>

            {/* Option 3 */}
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 space-y-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-emerald-500" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">Option 3: Kaggle CLI Push</h3>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Push headless kernels directly from your terminal using the official Kaggle CLI. Great for automated CI/CD and cron jobs.
              </p>
              <div className="pt-2">
                <code className="block p-2 rounded bg-slate-100 dark:bg-slate-900 text-[11px] font-mono text-slate-700 dark:text-slate-300">
                  kaggle kernels push -p ./notebooks
                </code>
              </div>
            </div>
          </div>

          {/* Detailed Instructions Accordion */}
          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
            <span className="font-semibold text-slate-900 dark:text-white block">
              Step-by-Step Kaggle Configuration (Outbound Polling &amp; Credential Security)
            </span>
            <ol className="list-decimal list-inside space-y-2 text-slate-600 dark:text-slate-300 leading-relaxed">
              <li>
                <b>Create a New Notebook</b>: Go to <a href="https://www.kaggle.com/code" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline inline-flex items-center gap-1">kaggle.com/code <ExternalLink className="w-3 h-3" /></a> and click <b>New Notebook</b>.
              </li>
              <li>
                <b>Set Accelerator to Dual T4 GPUs</b>: In the right sidebar under <b>Notebook options</b>, change <b>Accelerator</b> to <b>GPU T4 x2</b> (32 GB total VRAM).
              </li>
              <li>
                <b>Enable Internet Access</b>: In the right sidebar, verify <b>Internet</b> is toggled to <b>Internet On</b> (requires a phone-verified Kaggle account; zero inbound ports are opened).
              </li>
              <li>
                <b>Store Credentials in Kaggle Secrets (Recommended)</b>: In <b>Add-ons &rarr; Secrets</b>, add <code className="font-mono text-blue-500">AETHER_WORKER_ID</code> and <code className="font-mono text-blue-500">AETHER_WORKER_KEY</code> (from <i>Connect Worker Node</i>) or <code className="font-mono text-blue-500">AETHER_REGISTRATION_TOKEN</code> so secrets never appear in notebook cells or output logs.
              </li>
              <li>
                <b>Run the Worker</b>: Import <code className="font-mono text-blue-500">notebooks/AetherOS_Kaggle_Worker.ipynb</code> or paste the single-cell launcher for <code className="font-mono text-blue-500">worker-runtime/aether_worker.py</code>, then click <b>Run All</b>.
              </li>
            </ol>
          </div>
        </div>
      )}

      {/* MODAL 1: COPY STANDALONE RUNNER */}
      <Modal
        isOpen={isCopyRunnerModalOpen}
        onClose={() => setIsCopyRunnerModalOpen(false)}
        title="Single-Cell Kaggle Runner Script"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Copy and paste this Python snippet into a cell in your Kaggle notebook, ensure <b>GPU T4 x2</b> and <b>Internet On</b> are active, and press <b>Shift + Enter</b>:
          </p>

          <div className="relative bg-slate-950 text-slate-200 p-4 rounded-lg font-mono text-[11px] overflow-x-auto max-h-80 overflow-y-auto">
            <button
              onClick={() => copyToClipboard(standaloneKaggleRunnerCode, 'Kaggle Script')}
              className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors shadow-xs"
            >
              {copiedText === 'Kaggle Script' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedText === 'Kaggle Script' ? 'Copied!' : 'Copy Code'}</span>
            </button>
            <pre className="text-slate-300 leading-relaxed">{standaloneKaggleRunnerCode}</pre>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setIsCopyRunnerModalOpen(false)}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-xs"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL 2: REGISTER WORKER MODAL */}
      <Modal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        title={newWorkerCredentials ? 'Worker Node Credentials' : 'Register New Compute Worker'}
      >
        {newWorkerCredentials ? (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300">
              <span className="font-semibold block">Worker Node Registered Successfully!</span>
              <p className="mt-1 text-[11px]">
                This private Bearer key is shown only once and is stored as a salted cryptographic hash. Add both values to Kaggle <b>Add-ons &rarr; Secrets</b> (never commit or print the key in notebook output).
              </p>
            </div>

            <div className="space-y-2 font-mono">
              <div>
                <span className="text-slate-400 text-[10px] block">AETHER_WORKER_ID</span>
                <code className="block bg-slate-100 dark:bg-slate-800 p-2 rounded text-slate-900 dark:text-white select-all">
                  {newWorkerCredentials.workerId}
                </code>
              </div>

              <div>
                <span className="text-slate-400 text-[10px] block">AETHER_WORKER_KEY (Private API Key — Shown Once)</span>
                <div className="flex items-center gap-2">
                  <code className="block flex-1 bg-slate-100 dark:bg-slate-800 p-2 rounded text-blue-600 dark:text-blue-400 select-all">
                    {newWorkerCredentials.apiKey}
                  </code>
                  <button
                    onClick={() => copyToClipboard(newWorkerCredentials.apiKey, 'API Key')}
                    className="p-2 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setIsRegisterModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-xs"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleRegisterSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
                Node / Cluster Name
              </label>
              <input
                type="text"
                value={nodeName}
                onChange={e => setNodeName(e.target.value)}
                placeholder="e.g. My Kaggle T4x2 Node"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
                  Compute Provider
                </label>
                <select
                  value={provider}
                  onChange={e => setProvider(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="kaggle">Kaggle (Free GPU)</option>
                  <option value="oracle">Oracle Cloud (OCI)</option>
                  <option value="runpod">RunPod GPU</option>
                  <option value="self_hosted">Self-Hosted Dedicated</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
                  GPU Model
                </label>
                <input
                  type="text"
                  value={gpuModel}
                  onChange={e => setGpuModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
                  GPU Count
                </label>
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={gpuCount}
                  onChange={e => setGpuCount(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
                  Total VRAM (GB)
                </label>
                <input
                  type="number"
                  min="4"
                  max="512"
                  value={vramGb}
                  onChange={e => setVramGb(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
                  System RAM (GB)
                </label>
                <input
                  type="number"
                  min="8"
                  max="512"
                  value={systemRamGb}
                  onChange={e => setSystemRamGb(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">
                Contributor Name / Tag
              </label>
              <input
                type="text"
                value={contributorName}
                onChange={e => setContributorName(e.target.value)}
                placeholder="e.g. Community Contributor #42"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsRegisterModalOpen(false)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm transition-colors"
              >
                Register & Generate Key
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
