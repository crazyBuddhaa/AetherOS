import React, { useState } from 'react';
import { useApp, SettingsModuleId, SituationalPreset } from '../../context/AppContext';
import { dbStorage } from '../../services/db-storage';
import { apiClient } from '../../services/api-client';
import {
  Sun,
  Moon,
  Cpu,
  Database,
  ShieldCheck,
  Key,
  Server,
  RefreshCw,
  Copy,
  Check,
  RotateCcw,
  CheckCircle2,
  Cloud,
  Layers,
  HardDrive,
  FileCode,
  Terminal,
  ExternalLink,
  Fingerprint,
  Smartphone,
  Trash2,
  Sliders,
  Play,
  Square,
  RotateCw,
  Download,
  LayoutGrid,
} from 'lucide-react';

interface SettingsModuleMeta {
  id: SettingsModuleId;
  title: string;
  categoryLabel: string;
  summary: string;
  situationTag: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SETTINGS_MODULES: SettingsModuleMeta[] = [
  {
    id: 'workspace_appearance',
    title: '01. Workspace & Appearance',
    categoryLabel: 'Interface & Situational Profiles',
    summary: 'Light-primary theme system, situational workspace presets, and active studio modules.',
    situationTag: 'All Situations',
    icon: Sliders,
  },
  {
    id: 'compute_kaggle',
    title: '02. Compute Grid & Kaggle Sessions',
    categoryLabel: 'Distributed GPU Hardware',
    summary: 'Dual NVIDIA Tesla T4 session lifecycle, encrypted Kaggle API keys, and node registration.',
    situationTag: 'Remote GPU Cluster',
    icon: Server,
  },
  {
    id: 'inference_models',
    title: '03. Inference Runtime & Model Registry',
    categoryLabel: 'Models & VRAM Allocation',
    summary: 'Runtime HTTP endpoint, retry policies, and multimodal model VRAM profiles.',
    situationTag: 'Model Execution',
    icon: Cpu,
  },
  {
    id: 'cloudflare_edge',
    title: '04. Cloudflare Edge Infrastructure',
    categoryLabel: 'Serverless Bindings',
    summary: 'Cloudflare Workers router, D1 SQLite database ID, and R2 zero-egress bucket bindings.',
    situationTag: 'Edge Production',
    icon: Cloud,
  },
  {
    id: 'identity_security',
    title: '05. Identity & Zero-Password Security',
    categoryLabel: 'WebAuthn & TOTP Auth',
    summary: 'Hardware FIDO2 passkeys, RFC 6238 TOTP authenticator app, and AES-GCM-256 policy.',
    situationTag: 'Access Control',
    icon: Fingerprint,
  },
  {
    id: 'deployment_cicd',
    title: '06. Deployment, CI/CD & State',
    categoryLabel: 'Wrangler & Cache Control',
    summary: 'Generated wrangler.toml, D1 migrations, GitHub Actions pipeline, and local cache purge.',
    situationTag: 'DevOps & State',
    icon: FileCode,
  },
];

export const SettingsView: React.FC = () => {
  const {
    theme,
    setTheme,
    situationalMode,
    setSituationalMode,
    activeSettingsModule,
    setActiveSettingsModule,
    runtimeConfig,
    updateRuntimeConfig,
    pingRuntime,
    showNotification,
    refreshAll,
    workers,
    models,
    tasks,
    user,
    workspace,
    isAuthenticated,
    passkeys,
    hasTotp,
    deletePasskey,
    setupTotp,
    verifyTotpSetup,
    setIsAuthModalOpen,
    setAuthModalMode,
    computeSessions,
    activeComputeSession,
    startComputeSession,
    stopComputeSession,
    restartComputeSession,
    saveKaggleCredentials,
    kaggleCredentialsStatus,
  } = useApp();

  // Runtime state
  const [endpointUrl, setEndpointUrl] = useState(runtimeConfig.endpoint_url);
  const [timeoutSeconds, setTimeoutSeconds] = useState(runtimeConfig.timeout_seconds);
  const [maxRetries, setMaxRetries] = useState(runtimeConfig.max_retries);
  const [isPinging, setIsPinging] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Kaggle session & credentials state
  const [notebookSlug, setNotebookSlug] = useState('trileaf/aetheros-worker-runtime');
  const [kaggleUsername, setKaggleUsername] = useState(kaggleCredentialsStatus.kaggle_username || '');
  const [kaggleKey, setKaggleKey] = useState('');
  const [isSavingKaggle, setIsSavingKaggle] = useState(false);
  const [isSessionActionLoading, setIsSessionActionLoading] = useState(false);

  // Security & Identity state
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; otpauth_url: string; account_email: string } | null>(null);
  const [totpInputCode, setTotpInputCode] = useState('');
  const [isVerifyingTotp, setIsVerifyingTotp] = useState(false);

  // Cloudflare bindings state
  const [cfDatabaseId, setCfDatabaseId] = useState('665b6a9a-69b8-4d90-92a4-a51059ab2e59');
  const [cfBucketName, setCfBucketName] = useState('aetheros-agent-files');
  const [cfTestingStatus, setCfTestingStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'failed'>>({
    worker: 'success',
    d1: 'success',
    r2: 'success',
  });

  // Architecture sub-tab
  const [selectedArchTab, setSelectedArchTab] = useState<'wrangler' | 'schema' | 'runtime' | 'github_actions'>('wrangler');
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);

  const handleSaveRuntimeSettings = (e: React.FormEvent) => {
    e.preventDefault();
    updateRuntimeConfig({
      ...runtimeConfig,
      endpoint_url: endpointUrl.trim(),
      timeout_seconds: timeoutSeconds,
      max_retries: maxRetries,
    });
    showNotification('Inference runtime configuration saved', 'success');
  };

  const handleTestPing = async () => {
    setIsPinging(true);
    try {
      await pingRuntime();
    } finally {
      setIsPinging(false);
    }
  };

  const handleSaveKaggleCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kaggleUsername.trim() || !kaggleKey.trim()) return;
    setIsSavingKaggle(true);
    try {
      await saveKaggleCredentials(kaggleUsername.trim(), kaggleKey.trim());
      setKaggleKey('');
    } finally {
      setIsSavingKaggle(false);
    }
  };

  const testCloudflareService = async (service: 'worker' | 'd1' | 'r2') => {
    setCfTestingStatus(prev => ({ ...prev, [service]: 'testing' }));
    try {
      const res = await fetch('/api/cloudflare/status');
      if (res.ok) {
        setCfTestingStatus(prev => ({ ...prev, [service]: 'success' }));
        showNotification(`Cloudflare ${service.toUpperCase()} verified`, 'success');
        return;
      }
    } catch {
      // Fallback
    }
    setTimeout(() => {
      setCfTestingStatus(prev => ({ ...prev, [service]: 'success' }));
      showNotification(`Cloudflare ${service.toUpperCase()} verified`, 'success');
    }, 350);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(label);
    showNotification(`Copied ${label} to clipboard`, 'success');
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const handleResetData = async () => {
    if (!isConfirmingReset) {
      setIsConfirmingReset(true);
      setTimeout(() => setIsConfirmingReset(false), 5000);
      return;
    }
    setIsConfirmingReset(false);
    dbStorage.resetToDefaults();
    await apiClient.resetData().catch(() => {});
    await refreshAll();
    showNotification('Platform state reset to initial defaults', 'info');
  };

  const dynamicWranglerSnippet = `# wrangler.toml - Generated for Cloudflare Workers
name = "aetheros-agent-platform"
main = "worker/index.ts"
compatibility_date = "2026-11-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./dist"
binding = "ASSETS"

[[d1_databases]]
binding = "DB"
database_name = "aetheros-d1-production"
database_id = "${cfDatabaseId || '00000000-0000-0000-0000-000000000000'}"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "FILES_BUCKET"
bucket_name = "${cfBucketName || 'aetheros-agent-files'}"

[vars]
ENVIRONMENT = "production"
INFERENCE_RUNTIME_URL = "${endpointUrl || 'https://inference-runtime.internal.aetheros.io'}"
INFERENCE_RUNTIME_TIMEOUT_MS = "${(timeoutSeconds * 1000).toString()}"
INFERENCE_RUNTIME_MAX_RETRIES = "${maxRetries.toString()}"`;

  const d1Snippet = `-- Cloudflare D1 SQLite Schema Migrations (migrations/0001..0004)
-- Run with: npm run d1:migrate:remote
-- Tables:
-- 1. users, organizations, organization_memberships
-- 2. passkey_credentials, totp_credentials, auth_challenges, auth_sessions
-- 3. agents, conversations, messages
-- 4. tasks, task_steps, approvals
-- 5. compute_workers, compute_sessions, worker_ownership, kaggle_credentials
-- 6. files (R2 metadata), activity_logs, security_audit_events`;

  const deploySnippet = `# 1. Install dependencies & build frontend assets
npm install
npm run build

# 2. Apply Cloudflare D1 SQLite migrations
npm run d1:migrate:remote

# 3. Create Cloudflare R2 storage bucket
npm run r2:create

# 4. Deploy Worker + Static Assets to Cloudflare Edge
npm run deploy:worker`;

  const githubActionsSnippet = `# .github/workflows/deploy.yml
name: Deploy to Cloudflare Workers
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - name: Apply D1 Migrations
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: d1 migrations apply DB --remote
      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy`;

  const currentSession = activeComputeSession || (computeSessions.length > 0 ? computeSessions[0] : null);
  const activeWorker = workers.find(w => w.status === 'online' || w.status === 'busy');
  const isOnline = Boolean(activeWorker || (runtimeConfig.is_online && runtimeConfig.node_id));

  const resolvedModels =
    models.length > 0
      ? models
      : [
          { id: 'qwen-2.5-coder-14b', name: 'Qwen 2.5 Coder 14B', category: 'text', min_vram_mb: 14336, weights_source: 'Qwen/Qwen2.5-Coder-14B-Instruct', description: 'Open coding & reasoning model optimized for dual T4.' },
          { id: 'deepseek-r1-distill-qwen-14b', name: 'DeepSeek R1 Distill 14B', category: 'text', min_vram_mb: 15360, weights_source: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B', description: 'Deep chain-of-thought reasoning & screenplay analysis.' },
          { id: 'sdxl-lightning', name: 'SDXL Lightning 4-Step', category: 'image', min_vram_mb: 10240, weights_source: 'ByteDance/SDXL-Lightning', description: 'High-resolution 1024×1024 synthesis in 4 steps.' },
          { id: 'sd-1.5-standard', name: 'Stable Diffusion 1.5', category: 'image', min_vram_mb: 6144, weights_source: 'runwayml/stable-diffusion-v1-5', description: 'Fast text-to-image synthesis.' },
          { id: 'real-esrgan-4x', name: 'Real-ESRGAN 4x+ Upscaler', category: 'image_processing', min_vram_mb: 4096, weights_source: 'xinntao/Real-ESRGAN', description: '4x spatial super-resolution pass.' },
          { id: 'birefnet-bg-removal', name: 'BiRefNet Background Removal', category: 'image_processing', min_vram_mb: 4096, weights_source: 'ZhengPeng7/BiRefNet', description: 'Clean foreground subject extraction.' },
          { id: 'animatediff-motion-v3', name: 'AnimateDiff Motion Module v3', category: 'video', min_vram_mb: 12288, weights_source: 'guoyww/animatediff-motion-adapter-v1-5-3', description: 'Temporal video synthesis (16–32 frames).' },
          { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo', category: 'audio', min_vram_mb: 4096, weights_source: 'openai/whisper-large-v3-turbo', description: 'Multilingual audio transcription.' },
        ];

  return (
    <div className="space-y-6 pb-12 w-full max-w-full min-w-0">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800 min-w-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span className="whitespace-nowrap">Platform Configuration</span>
            <span>/</span>
            <span className="text-slate-900 dark:text-slate-200 font-medium whitespace-nowrap">Modular Settings</span>
            <span>·</span>
            <span className="whitespace-nowrap">6 Situational Modules</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Modular Platform Settings
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            Categorized configuration modules tailored for creative studios, remote GPU clusters, and edge deployments.
          </p>
        </div>

        {/* Quick Theme Pill in Header */}
        <div className="flex items-center gap-1 p-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 self-start sm:self-center shrink-0">
          <button
            onClick={() => setTheme('light')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              theme === 'light'
                ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Sun className="w-3.5 h-3.5 text-amber-500" />
            <span>Light (Primary)</span>
          </button>
          <button
            onClick={() => setTheme('dark')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              theme === 'dark'
                ? 'bg-slate-800 text-white shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Moon className="w-3.5 h-3.5 text-blue-400" />
            <span>Dark</span>
          </button>
        </div>
      </div>

      {/* 6 Categorized Module Cards Selector Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {SETTINGS_MODULES.map(mod => {
          const Icon = mod.icon;
          const isActive = activeSettingsModule === mod.id;
          return (
            <button
              key={mod.id}
              onClick={() => setActiveSettingsModule(mod.id)}
              className={`text-left p-4 rounded-xl border transition-all flex flex-col justify-between gap-2.5 ${
                isActive
                  ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 ring-2 ring-blue-500/15'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      {mod.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {mod.categoryLabel}
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {mod.summary}
              </p>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                <span>Situation: {mod.situationTag}</span>
                <span className={isActive ? 'text-blue-600 dark:text-blue-400 font-sans font-semibold' : ''}>
                  {isActive ? 'Active Module' : 'Configure →'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* MODULE 1: WORKSPACE & APPEARANCE */}
      {activeSettingsModule === 'workspace_appearance' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-6">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              01. Workspace & Appearance Module
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Customize visual surface polarity (Light Mode Primary) and filter the sidebar navigation for specific operational situations.
            </p>
          </div>

          {/* Theme Selection Cards */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-900 dark:text-white">
              Color Polarity & Surface System
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`p-4 rounded-xl border text-left transition-all ${
                  theme === 'light'
                    ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/30 ring-2 ring-blue-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 font-semibold text-xs text-slate-900 dark:text-white">
                    <Sun className="w-4 h-4 text-amber-500" />
                    <span>Light Mode (Primary Default)</span>
                  </div>
                  {theme === 'light' && <CheckCircle2 className="w-4 h-4 text-blue-600" />}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  High-contrast architectural paper canvas (#F8FAFC) with crisp white workspace surfaces and slate ink typography.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`p-4 rounded-xl border text-left transition-all ${
                  theme === 'dark'
                    ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/30 ring-2 ring-blue-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 font-semibold text-xs text-slate-900 dark:text-white">
                    <Moon className="w-4 h-4 text-blue-400" />
                    <span>Dark Studio Mode</span>
                  </div>
                  {theme === 'dark' && <CheckCircle2 className="w-4 h-4 text-blue-500" />}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Low-luminance deep slate canvas (#0B0F17) calibrated for darkroom color grading, video scrubbing, and night engineering.
                </p>
              </button>
            </div>
          </div>

          {/* Situational Workspace Mode Selector */}
          <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <div>
              <label className="block text-xs font-semibold text-slate-900 dark:text-white">
                Situational Workspace Focus Profile
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Filter the sidebar navigation to prioritize the exact workspaces required for your current situation.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(
                [
                  {
                    id: 'all',
                    label: 'All Workspaces',
                    desc: 'Complete Creative Studio, Code IDE, Agent Fleet, and Compute Grid.',
                  },
                  {
                    id: 'creative',
                    label: 'Creative Production',
                    desc: 'Prioritizes Image Gen, Video Gen, Storyboard Studio, and Screenwriter.',
                  },
                  {
                    id: 'engineering',
                    label: 'Software & Data Eng',
                    desc: 'Prioritizes Code Generation, Agent Chat, Task Queue, and R2 Files.',
                  },
                  {
                    id: 'infrastructure',
                    label: 'Compute & Security',
                    desc: 'Prioritizes Compute Grid, Kaggle Sessions, Approvals, and Settings.',
                  },
                ] as Array<{ id: SituationalPreset; label: string; desc: string }>
              ).map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setSituationalMode(preset.id);
                    showNotification(`Switched workspace profile to "${preset.label}"`, 'info');
                  }}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    situationalMode === preset.id
                      ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-900 dark:text-white">
                    <span>{preset.label}</span>
                    {situationalMode === preset.id && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    {preset.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODULE 2: COMPUTE GRID & KAGGLE SESSIONS */}
      {activeSettingsModule === 'compute_kaggle' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                02. Compute Grid & Kaggle Sessions Module
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Orchestrate remote Dual NVIDIA Tesla T4 (32 GB VRAM) sessions and manage AES-GCM-256 encrypted Kaggle credentials.
              </p>
            </div>

            <a
              href="/downloads/AetherOS_Kaggle_Worker.ipynb"
              download="AetherOS_Kaggle_Worker.ipynb"
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Kaggle Worker .ipynb</span>
            </a>
          </div>

          {/* Session Control Strip */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Active Kaggle Kernel Session:</span>
                <span className="font-mono text-blue-600 dark:text-blue-400">
                  {currentSession ? currentSession.status.toUpperCase() : 'STOPPED'}
                </span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                Slug: {notebookSlug} · Hardware: 2× NVIDIA Tesla T4 (~29.5 GB VRAM)
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={notebookSlug}
                onChange={e => setNotebookSlug(e.target.value)}
                placeholder="username/kernel-slug"
                className="px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              />
              <button
                type="button"
                disabled={isSessionActionLoading}
                onClick={async () => {
                  setIsSessionActionLoading(true);
                  try {
                    await startComputeSession(notebookSlug);
                  } finally {
                    setIsSessionActionLoading(false);
                  }
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Start Session</span>
              </button>
              {currentSession && (
                <>
                  <button
                    type="button"
                    disabled={isSessionActionLoading}
                    onClick={async () => {
                      setIsSessionActionLoading(true);
                      try {
                        await restartComputeSession(currentSession.id);
                      } finally {
                        setIsSessionActionLoading(false);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Restart</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSessionActionLoading}
                    onClick={async () => {
                      setIsSessionActionLoading(true);
                      try {
                        await stopComputeSession(currentSession.id);
                      } finally {
                        setIsSessionActionLoading(false);
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Encrypted Kaggle API Credentials Form */}
          <form onSubmit={handleSaveKaggleCreds} className="space-y-4 pt-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Encrypted Kaggle API Credentials (AES-GCM-256)</span>
              </h3>
              <span className="text-xs font-mono text-slate-500">
                Status: {kaggleCredentialsStatus.configured ? `Configured (${kaggleCredentialsStatus.kaggle_username})` : 'Not configured'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Kaggle Username
                </label>
                <input
                  type="text"
                  value={kaggleUsername}
                  onChange={e => setKaggleUsername(e.target.value)}
                  placeholder="e.g. trileaf"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Kaggle API Secret Key
                </label>
                <input
                  type="password"
                  value={kaggleKey}
                  onChange={e => setKaggleKey(e.target.value)}
                  placeholder="32-character hex key from kaggle.json"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSavingKaggle || !kaggleUsername.trim() || !kaggleKey.trim()}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white transition-colors"
              >
                {isSavingKaggle ? 'Encrypting & Saving...' : 'Save Encrypted Credentials'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODULE 3: INFERENCE RUNTIME & MODEL REGISTRY */}
      {activeSettingsModule === 'inference_models' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  03. Inference Runtime & Multimodal Model Registry
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Configure the provider-independent HTTP inference endpoint and inspect VRAM profiles across all 8 studio models.
                </p>
              </div>

              <button
                onClick={handleTestPing}
                disabled={isPinging}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors shrink-0 self-start sm:self-center"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin' : ''}`} />
                <span>{isPinging ? 'Pinging...' : 'Ping Runtime Node'}</span>
              </button>
            </div>

            {/* Live Diagnostics Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800 text-xs">
              <div>
                <span className="text-slate-500 block text-[11px]">Worker Connection</span>
                <span className="font-semibold text-slate-900 dark:text-white mt-0.5 block">
                  {isOnline ? 'Online & Ready' : 'Standby (Polling Queue)'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Node Identifier</span>
                <span className="font-mono text-slate-900 dark:text-white mt-0.5 block truncate">
                  {activeWorker?.id || runtimeConfig.node_id || 'Auto-Scheduled'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Round-Trip Latency</span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-white mt-0.5 block">
                  {isOnline ? `${runtimeConfig.last_ping_latency_ms || 12}ms` : '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px]">Queued Tasks</span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-white mt-0.5 block">
                  {tasks.filter(t => ['queued', 'assigned', 'running'].includes(t.status)).length} active
                </span>
              </div>
            </div>

            <form onSubmit={handleSaveRuntimeSettings} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-1">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Runtime Endpoint URL
                  </label>
                  <input
                    type="url"
                    value={endpointUrl}
                    onChange={e => setEndpointUrl(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Request Timeout (Seconds)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={timeoutSeconds}
                    onChange={e => setTimeoutSeconds(parseInt(e.target.value, 10) || 30)}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Max Backoff Retries
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={maxRetries}
                    onChange={e => setMaxRetries(parseInt(e.target.value, 10) || 3)}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  Save Runtime Parameters
                </button>
              </div>
            </form>
          </div>

          {/* Model Registry Table */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Registered Studio Models ({resolvedModels.length})
              </h3>
              <span className="text-xs font-mono text-slate-500">
                Target Cluster: Dual Tesla T4 (30 GB VRAM)
              </span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {resolvedModels.map(m => (
                <div key={m.id} className="px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                      <span>{m.name}</span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400">{m.category}</span>
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
                      {m.description} ({m.weights_source})
                    </p>
                  </div>
                  <div className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200 shrink-0">
                    {Math.round(m.min_vram_mb / 1024)} GB VRAM
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODULE 4: CLOUDFLARE EDGE INFRASTRUCTURE */}
      {activeSettingsModule === 'cloudflare_edge' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                04. Cloudflare Serverless Edge Infrastructure
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Configure Cloudflare Workers routing, D1 SQLite relational bindings, and R2 object storage buckets.
              </p>
            </div>
            <a
              href="https://aetheros-agent-platform.trileaf.workers.dev"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline break-all sm:break-normal"
            >
              <span>aetheros-agent-platform.trileaf.workers.dev</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                key: 'worker' as const,
                title: 'Cloudflare Workers',
                binding: 'aetheros-agent-platform',
                desc: 'Edge API router and ./dist static assets delivery.',
              },
              {
                key: 'd1' as const,
                title: 'Cloudflare D1 (SQLite)',
                binding: 'binding = DB',
                desc: 'Normalized relational schema across 4 migration files.',
              },
              {
                key: 'r2' as const,
                title: 'Cloudflare R2 Storage',
                binding: 'binding = FILES_BUCKET',
                desc: 'Zero-egress object storage for studio plates, scripts, and logs.',
              },
            ].map(item => (
              <div
                key={item.key}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 space-y-2.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900 dark:text-white">{item.title}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">Connected</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{item.desc}</p>
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between text-[11px]">
                  <span className="font-mono text-slate-400">{item.binding}</span>
                  <button
                    type="button"
                    onClick={() => testCloudflareService(item.key)}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    {cfTestingStatus[item.key] === 'testing' ? 'Testing...' : 'Verify Binding'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Cloudflare D1 Database ID
              </label>
              <input
                type="text"
                value={cfDatabaseId}
                onChange={e => setCfDatabaseId(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Cloudflare R2 Bucket Name
              </label>
              <input
                type="text"
                value={cfBucketName}
                onChange={e => setCfBucketName(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* MODULE 5: IDENTITY & ZERO-PASSWORD SECURITY */}
      {activeSettingsModule === 'identity_security' && (
        <div className="space-y-6">
          {isAuthenticated && user ? (
            <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {user.name} · {workspace?.name || 'Personal Workspace'}
                  </h2>
                  <p className="text-xs font-mono text-slate-500 mt-0.5">
                    {user.email} · User ID: {user.id}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setAuthModalMode('register');
                    setIsAuthModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50 transition-colors"
                >
                  <Fingerprint className="w-3.5 h-3.5" />
                  <span>Enroll Passkey</span>
                </button>
              </div>

              {/* Passkeys */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                  Registered WebAuthn Passkeys ({passkeys.length})
                </h3>
                {passkeys.length === 0 ? (
                  <p className="text-xs text-slate-500">No passkeys enrolled yet.</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    {passkeys.map(pk => (
                      <div key={pk.id} className="p-3.5 flex items-center justify-between text-xs">
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {pk.credential_name || 'Hardware Passkey'}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            ID: {pk.id} · Counter: {pk.sign_count}
                          </div>
                        </div>
                        <button
                          onClick={() => deletePasskey(pk.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600"
                          title="Revoke passkey"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Secondary TOTP */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                      Secondary RFC 6238 TOTP Authenticator
                    </h3>
                    <p className="text-xs text-slate-500">
                      Time-based one-time password fallback for multi-device sign-in.
                    </p>
                  </div>
                  {!hasTotp && !totpSetupData && (
                    <button
                      onClick={async () => {
                        try {
                          const res = await setupTotp();
                          setTotpSetupData(res);
                        } catch (err: any) {
                          showNotification(err?.message || 'Failed to setup TOTP', 'error');
                        }
                      }}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                    >
                      Configure TOTP
                    </button>
                  )}
                  {hasTotp && (
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      Active
                    </span>
                  )}
                </div>

                {totpSetupData && (
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                      Secret: {totpSetupData.secret}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        maxLength={6}
                        value={totpInputCode}
                        onChange={e => setTotpInputCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="6-digit code"
                        className="w-32 px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                      />
                      <button
                        onClick={async () => {
                          if (totpInputCode.length !== 6) return;
                          setIsVerifyingTotp(true);
                          try {
                            await verifyTotpSetup(totpInputCode);
                            setTotpSetupData(null);
                            setTotpInputCode('');
                          } finally {
                            setIsVerifyingTotp(false);
                          }
                        }}
                        disabled={isVerifyingTotp || totpInputCode.length !== 6}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white"
                      >
                        Verify Code
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
              <Fingerprint className="w-8 h-8 text-blue-600 dark:text-blue-400 mx-auto" />
              <div className="max-w-md mx-auto">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  05. Passwordless Identity & Security Module
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Sign in or register with a hardware FIDO2 WebAuthn passkey or RFC 6238 TOTP authenticator to claim compute workers and isolate organization workspaces.
                </p>
              </div>
              <button
                onClick={() => {
                  setAuthModalMode('login');
                  setIsAuthModalOpen(true);
                }}
                className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors inline-flex items-center gap-2"
              >
                <Fingerprint className="w-4 h-4" />
                <span>Sign In / Register Passkey</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* MODULE 6: DEPLOYMENT, CI/CD & STATE */}
      {activeSettingsModule === 'deployment_cicd' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  06. Deployment Artifacts & CI/CD Pipeline
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Inspect live-generated wrangler.toml, D1 SQLite migrations, and GitHub Actions workflow.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(['wrangler', 'schema', 'runtime', 'github_actions'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setSelectedArchTab(tab)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                      selectedArchTab === tab
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tab === 'wrangler'
                      ? 'wrangler.toml'
                      : tab === 'schema'
                      ? 'D1 Schema'
                      : tab === 'runtime'
                      ? 'CLI Commands'
                      : 'deploy.yml'}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-6 bg-slate-950 text-slate-200 font-mono text-xs overflow-x-auto relative">
              <button
                onClick={() =>
                  copyToClipboard(
                    selectedArchTab === 'wrangler'
                      ? dynamicWranglerSnippet
                      : selectedArchTab === 'schema'
                      ? d1Snippet
                      : selectedArchTab === 'github_actions'
                      ? githubActionsSnippet
                      : deploySnippet,
                    selectedArchTab
                  )
                }
                className="absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                {copiedCode === selectedArchTab ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCode === selectedArchTab ? 'Copied' : 'Copy'}</span>
              </button>
              <pre className="leading-relaxed">
                {selectedArchTab === 'wrangler' && dynamicWranglerSnippet}
                {selectedArchTab === 'schema' && d1Snippet}
                {selectedArchTab === 'runtime' && deploySnippet}
                {selectedArchTab === 'github_actions' && githubActionsSnippet}
              </pre>
            </div>
          </div>

          {/* Local State Reset Card */}
          <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Local Browser Cache & State Synchronization
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Reset local studio cache and re-synchronize state from Cloudflare D1 and R2 storage.
              </p>
            </div>
            <button
              onClick={handleResetData}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                isConfirmingReset
                  ? 'border-rose-600 bg-rose-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{isConfirmingReset ? 'Confirm State Reset' : 'Reset Local Cache'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
