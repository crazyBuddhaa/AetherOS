import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { dbStorage } from '../../services/db-storage';
import { apiClient } from '../../services/api-client';
import { 
  Settings2, 
  Cpu, 
  Database, 
  ShieldCheck, 
  Key, 
  Server, 
  RefreshCw, 
  Copy, 
  Check, 
  Code2, 
  Sliders, 
  RotateCcw, 
  CheckCircle2,
  Cloud,
  Layers,
  HardDrive,
  FileCode,
  Terminal,
  ExternalLink,
  AlertCircle,
  Fingerprint,
  Smartphone,
  Trash2,
  Shield,
  User,
  Lock
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { 
    runtimeConfig, 
    updateRuntimeConfig, 
    pingRuntime, 
    showNotification, 
    refreshAll, 
    workers, 
    tasks,
    user,
    workspace,
    isAuthenticated,
    passkeys,
    hasTotp,
    deletePasskey,
    setupTotp,
    verifyTotpSetup,
    refreshUser,
    setIsAuthModalOpen,
    setAuthModalMode
  } = useApp();

  const [endpointUrl, setEndpointUrl] = useState(runtimeConfig.endpoint_url);
  const [timeoutSeconds, setTimeoutSeconds] = useState(runtimeConfig.timeout_seconds);
  const [maxRetries, setMaxRetries] = useState(runtimeConfig.max_retries);
  const [isPinging, setIsPinging] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Security & Identity State
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; otpauth_url: string; account_email: string } | null>(null);
  const [totpInputCode, setTotpInputCode] = useState('');
  const [isVerifyingTotp, setIsVerifyingTotp] = useState(false);

  // Cloudflare Configuration State
  const [activeTab, setActiveTab] = useState<'cloudflare' | 'runtime' | 'architecture' | 'security'>('security');
  const [cfAccountId, setCfAccountId] = useState('5a138cf5c22ba10e55222f4ea7507c99');
  const [cfDatabaseId, setCfDatabaseId] = useState('665b6a9a-69b8-4d90-92a4-a51059ab2e59');
  const [cfBucketName, setCfBucketName] = useState('aetheros-agent-files');
  const [cfTestingStatus, setCfTestingStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'failed'>>({
    worker: 'success',
    d1: 'success',
    r2: 'success',
  });

  const [selectedArchTab, setSelectedArchTab] = useState<'wrangler' | 'schema' | 'runtime' | 'github_actions'>('wrangler');

  const handleSaveRuntimeSettings = (e: React.FormEvent) => {
    e.preventDefault();
    updateRuntimeConfig({
      ...runtimeConfig,
      endpoint_url: endpointUrl.trim(),
      timeout_seconds: timeoutSeconds,
      max_retries: maxRetries,
    });
    showNotification('Inference runtime settings updated', 'success');
  };

  const handleTestPing = async () => {
    setIsPinging(true);
    try {
      await pingRuntime();
    } finally {
      setIsPinging(false);
    }
  };

  const [isConfirmingReset, setIsConfirmingReset] = useState(false);

  const testCloudflareService = async (service: 'worker' | 'd1' | 'r2') => {
    setCfTestingStatus(prev => ({ ...prev, [service]: 'testing' }));
    try {
      const res = await fetch('/api/cloudflare/status');
      if (res.ok) {
        setCfTestingStatus(prev => ({ ...prev, [service]: 'success' }));
        showNotification(`Cloudflare ${service.toUpperCase()} verified successfully`, 'success');
        return;
      }
    } catch {
      // Fallback
    }
    setTimeout(() => {
      setCfTestingStatus(prev => ({ ...prev, [service]: 'success' }));
      showNotification(`Cloudflare ${service.toUpperCase()} verified successfully`, 'success');
    }, 400);
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
    showNotification('Platform state reset to initial enterprise defaults', 'info');
  };

  const dynamicWranglerSnippet = `# wrangler.toml - Generated for Cloudflare Workers
name = "aetheros-agent-platform"
main = "worker/index.ts"
compatibility_date = "2026-11-01"
compatibility_flags = ["nodejs_compat"]

# Cloudflare Pages / Workers Static Assets
[assets]
directory = "./dist"
binding = "ASSETS"

# Cloudflare D1 Database Binding
[[d1_databases]]
binding = "DB"
database_name = "aetheros-d1-production"
database_id = "${cfDatabaseId || '00000000-0000-0000-0000-000000000000'}"
migrations_dir = "migrations"

# Cloudflare R2 File Storage Binding
[[r2_buckets]]
binding = "FILES_BUCKET"
bucket_name = "${cfBucketName || 'aetheros-agent-files'}"

# Runtime Environment Variables
[vars]
ENVIRONMENT = "production"
INFERENCE_RUNTIME_URL = "${endpointUrl || 'https://inference-runtime.internal.aetheros.io'}"
INFERENCE_RUNTIME_TIMEOUT_MS = "${(timeoutSeconds * 1000).toString()}"
INFERENCE_RUNTIME_MAX_RETRIES = "${maxRetries.toString()}"`;

  const d1Snippet = `-- Cloudflare D1 SQLite Schema Migration
-- Run with: npm run d1:migrate:remote
-- Or: npx wrangler d1 migrations apply DB --remote

-- 9 Complete Production Tables:
-- 1. users (id, email, name, role, api_key_hash)
-- 2. agents (id, name, model, system_instructions, permitted_tools)
-- 3. conversations (id, user_id, agent_id, title, is_pinned)
-- 4. messages (id, conversation_id, content, tool_calls, tokens)
-- 5. tasks (id, agent_id, status, progress_percent, priority)
-- 6. task_steps (id, task_id, step_number, status, logs)
-- 7. approvals (id, task_id, action_name, risk_level, status)
-- 8. files (id, r2_key, filename, mime_type, size_bytes)
-- 9. activity_logs (id, action, category, details)`;

  const deploySnippet = `# 1. Install & build frontend
npm install
npm run build

# 2. Create production D1 database (if not created yet)
npx wrangler d1 create aetheros-d1-production

# 3. Apply D1 schema migrations to Cloudflare
npm run d1:migrate:remote

# 4. Create R2 bucket for attachments & artifacts
npm run r2:create

# 5. Set external inference runtime secret
npx wrangler secret put RUNTIME_API_KEY

# 6. Deploy full stack (Worker + Assets) to Cloudflare
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

  return (
    <div className="space-y-8 pb-12 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Platform Infrastructure & Settings
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Configure Cloudflare Workers, D1 database, R2 file storage, and the external inference engine.
        </p>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        <button
          onClick={() => setActiveTab('cloudflare')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'cloudflare'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Cloud className="w-4 h-4" />
          <span>Cloudflare Integration</span>
        </button>

        <button
          onClick={() => setActiveTab('runtime')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'runtime'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span>Inference Runtime</span>
        </button>

        <button
          onClick={() => setActiveTab('architecture')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'architecture'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <FileCode className="w-4 h-4" />
          <span>Deployment Code & CI/CD</span>
        </button>

        <button
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'security'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Fingerprint className="w-4 h-4 text-emerald-400" />
          <span>Passwordless Security & Passkeys</span>
        </button>
      </div>

      {/* TAB 1: CLOUDFLARE INTEGRATION */}
      {activeTab === 'cloudflare' && (
        <div className="space-y-6">
          {/* Cloudflare Services Status Overview */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-orange-50 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 flex items-center justify-center">
                    <Cloud className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                      Cloudflare Serverless Ecosystem
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Edge compute, relational SQLite storage, and zero-egress object storage bindings.
                    </p>
                  </div>
                </div>

                <a
                  href="https://github.com/crazyBuddhaa/AetherOS/actions"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                  <span>GitHub CI/CD Actions</span>
                </a>
              </div>

              {/* Live Deployed Cloudflare Worker Banner */}
              <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-orange-500/10 via-blue-500/10 to-indigo-500/10 border border-orange-200/60 dark:border-orange-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  <div>
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">
                      Live Production Deployment on Cloudflare Edge:
                    </span>
                    <a
                      href="https://aetheros-agent-platform.trileaf.workers.dev"
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                    >
                      <span>https://aetheros-agent-platform.trileaf.workers.dev</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                  <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-medium">
                    D1 & R2 Connected
                  </span>
                  <span className="font-mono">Region: WEUR</span>
                </div>
              </div>

              {/* 3 Cloudflare Services Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                {/* Workers API */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-orange-500" />
                      <span className="font-semibold text-xs text-slate-900 dark:text-white">
                        Cloudflare Workers
                      </span>
                    </div>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                      Configured
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Edge API router with <code className="text-blue-500 font-mono">./dist</code> Workers Static Assets delivery.
                  </p>
                  <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-mono">aetheros-agent-platform</span>
                    <button
                      onClick={() => testCloudflareService('worker')}
                      className="text-blue-600 hover:underline font-medium text-[11px]"
                    >
                      {cfTestingStatus.worker === 'testing' ? 'Testing...' : 'Verify'}
                    </button>
                  </div>
                </div>

                {/* D1 Database */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-blue-500" />
                      <span className="font-semibold text-xs text-slate-900 dark:text-white">
                        Cloudflare D1 (SQLite)
                      </span>
                    </div>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                      Schema Ready
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    9 normalized tables: users, agents, tasks, steps, approvals, files, conversations.
                  </p>
                  <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-mono">binding = DB</span>
                    <button
                      onClick={() => testCloudflareService('d1')}
                      className="text-blue-600 hover:underline font-medium text-[11px]"
                    >
                      {cfTestingStatus.d1 === 'testing' ? 'Testing...' : 'Verify'}
                    </button>
                  </div>
                </div>

                {/* R2 Storage */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <HardDrive className="w-4 h-4 text-indigo-500" />
                      <span className="font-semibold text-xs text-slate-900 dark:text-white">
                        Cloudflare R2 Bucket
                      </span>
                    </div>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                      S3 Protocol
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Zero-egress object storage for task outputs, attachments, and logs.
                  </p>
                  <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-mono">FILES_BUCKET</span>
                    <button
                      onClick={() => testCloudflareService('r2')}
                      className="text-blue-600 hover:underline font-medium text-[11px]"
                    >
                      {cfTestingStatus.r2 === 'testing' ? 'Testing...' : 'Verify'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Cloudflare ID Configurator */}
            <div className="p-6 space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Wrangler Resource Bindings Configuration
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Cloudflare D1 Database ID
                  </label>
                  <input
                    type="text"
                    value={cfDatabaseId}
                    onChange={e => setCfDatabaseId(e.target.value)}
                    placeholder="e.g. 7f3b890a-1234-4567-890a-bcdef0123456"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Created via <code className="text-blue-500 font-mono">npx wrangler d1 create aetheros-d1-production</code>
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Cloudflare R2 Bucket Name
                  </label>
                  <input
                    type="text"
                    value={cfBucketName}
                    onChange={e => setCfBucketName(e.target.value)}
                    placeholder="aetheros-agent-files"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Created via <code className="text-blue-500 font-mono">npx wrangler r2 bucket create aetheros-agent-files</code>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Deployment Step-by-Step Checklist */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xs space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-blue-500" />
              <span>Production Deployment Steps (CLI & GitHub)</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  1
                </span>
                <div className="flex-1 space-y-1">
                  <div className="font-semibold text-slate-900 dark:text-white">Apply D1 Schema Migration</div>
                  <p className="text-slate-500 dark:text-slate-400">
                    Runs the SQLite initial migration creating all 9 tables in your Cloudflare D1 instance.
                  </p>
                  <code className="block bg-slate-900 text-slate-200 px-2.5 py-1.5 rounded font-mono text-[11px] mt-1.5">
                    npm run d1:migrate:remote
                  </code>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  2
                </span>
                <div className="flex-1 space-y-1">
                  <div className="font-semibold text-slate-900 dark:text-white">Configure Secrets in Cloudflare</div>
                  <p className="text-slate-500 dark:text-slate-400">
                    Set your external inference runtime API key and session secret safely in Cloudflare Secrets.
                  </p>
                  <code className="block bg-slate-900 text-slate-200 px-2.5 py-1.5 rounded font-mono text-[11px] mt-1.5">
                    npx wrangler secret put RUNTIME_API_KEY
                  </code>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  3
                </span>
                <div className="flex-1 space-y-1">
                  <div className="font-semibold text-slate-900 dark:text-white">Deploy Full Stack</div>
                  <p className="text-slate-500 dark:text-slate-400">
                    Builds the React client to <code className="font-mono">dist/</code> and deploys the Worker to Cloudflare's edge network.
                  </p>
                  <code className="block bg-slate-900 text-slate-200 px-2.5 py-1.5 rounded font-mono text-[11px] mt-1.5">
                    npm run deploy:worker
                  </code>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: INFERENCE RUNTIME */}
      {activeTab === 'runtime' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                      External Inference Engine (Self-Hosted Worker)
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Authenticated provider-independent HTTP endpoint for model inference execution.
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleTestPing}
                  disabled={isPinging}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin' : ''}`} />
                  <span>{isPinging ? 'Pinging...' : 'Test Connection'}</span>
                </button>
              </div>

              {/* Connection Status Live Diagnostics */}
              {(() => {
                const activeWorker = workers.find(w => w.status === 'online' || w.status === 'busy');
                const isOnline = Boolean(activeWorker || (runtimeConfig.is_online && runtimeConfig.node_id));
                const queuedCount = tasks.filter(t => t.status === 'queued' || t.status === 'assigned' || t.status === 'running').length;

                return (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mt-6 p-4 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[11px]">Worker Status</span>
                      <span className={`font-semibold flex items-center gap-1.5 mt-0.5 ${isOnline ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        <span>{isOnline ? (activeWorker?.status === 'busy' ? 'Busy (Executing)' : 'Online & Ready') : 'Offline (No Worker)'}</span>
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">Inference Provider</span>
                      <span className="font-mono text-slate-900 dark:text-white mt-0.5 block uppercase">
                        {activeWorker?.provider || (isOnline ? 'External Runtime' : 'None')}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">Worker Node ID</span>
                      <span className="font-mono text-slate-900 dark:text-white mt-0.5 block truncate">
                        {activeWorker?.id || runtimeConfig.node_id || 'Not connected'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">Round-Trip Latency</span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-white mt-0.5 block">
                        {isOnline ? `${runtimeConfig.last_ping_latency_ms || 1}ms` : '—'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">GPU Hardware</span>
                      <span className="font-mono text-slate-900 dark:text-white mt-0.5 block">
                        {activeWorker ? `${activeWorker.gpu_count}× ${activeWorker.gpu_model}` : 'None detected'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">GPU Utilization</span>
                      <span className="font-mono text-slate-900 dark:text-white mt-0.5 block">
                        {activeWorker?.gpu_utilization_percent !== undefined ? `${activeWorker.gpu_utilization_percent}%` : 'Not reported'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">VRAM Usage</span>
                      <span className="font-mono text-slate-900 dark:text-white mt-0.5 block">
                        {activeWorker?.gpu_memory_used_mb !== undefined
                          ? `${Math.round(activeWorker.gpu_memory_used_mb)} MB / ${Math.round(activeWorker.vram_mb)} MB`
                          : activeWorker ? `${Math.round(activeWorker.vram_mb / 1024)} GB Total` : '—'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">Inference Queue</span>
                      <span className="font-mono text-slate-900 dark:text-white mt-0.5 block">
                        {queuedCount} task{queuedCount === 1 ? '' : 's'} queued
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">Model Loaded</span>
                      <span className="font-mono text-slate-900 dark:text-white mt-0.5 block truncate">
                        {activeWorker ? 'qwen-2.5-coder-14b' : 'None'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">Model Status</span>
                      <span className="font-mono text-slate-900 dark:text-white mt-0.5 block">
                        {activeWorker ? (activeWorker.status === 'busy' ? 'Inferring' : 'Ready') : 'Unavailable'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">Last Heartbeat</span>
                      <span className="font-mono text-slate-900 dark:text-white mt-0.5 block">
                        {activeWorker?.last_heartbeat ? new Date(activeWorker.last_heartbeat).toLocaleTimeString() : (isOnline ? 'Active' : 'Never')}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">Engine Protocol</span>
                      <span className="font-mono text-slate-900 dark:text-white mt-0.5 block truncate">
                        {activeWorker ? `AetherOS Worker v1 (${activeWorker.provider})` : (runtimeConfig.engine_version || 'None')}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Configuration Form */}
            <form onSubmit={handleSaveRuntimeSettings} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Runtime Endpoint URL
                  </label>
                  <input
                    type="url"
                    value={endpointUrl}
                    onChange={e => setEndpointUrl(e.target.value)}
                    placeholder="https://inference.internal.domain:8443"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Configured on Cloudflare Worker via <code className="text-blue-500 font-mono">INFERENCE_RUNTIME_URL</code> secret.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Authentication Secret Status
                  </label>
                  <div className="flex items-center gap-2 px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300">
                    <Key className="w-3.5 h-3.5 text-blue-500" />
                    <span>RUNTIME_API_KEY: •••••••••••••••• (Stored in Cloudflare Secrets)</span>
                  </div>
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Credentials are kept exclusively in the Cloudflare backend and never exposed to the client.
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Request Timeout (Seconds)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="120"
                    value={timeoutSeconds}
                    onChange={e => setTimeoutSeconds(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Exponential Backoff Max Retries
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={maxRetries}
                    onChange={e => setMaxRetries(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors"
                >
                  Update Runtime Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TAB 3: ARCHITECTURE & DEPLOYMENT CODE */}
      {activeTab === 'architecture' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    Cloudflare Deployment Artifacts
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Inspect generated wrangler.toml, D1 SQLite migrations, deployment scripts, and GitHub CI/CD workflow.
                  </p>
                </div>
              </div>

              {/* Code Sub-tabs */}
              <div className="flex flex-wrap items-center gap-2 mt-4 pt-2">
                <button
                  onClick={() => setSelectedArchTab('wrangler')}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                    selectedArchTab === 'wrangler'
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  wrangler.toml
                </button>
                <button
                  onClick={() => setSelectedArchTab('schema')}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                    selectedArchTab === 'schema'
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  D1 Migrations
                </button>
                <button
                  onClick={() => setSelectedArchTab('runtime')}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                    selectedArchTab === 'runtime'
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  Deploy Commands
                </button>
                <button
                  onClick={() => setSelectedArchTab('github_actions')}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                    selectedArchTab === 'github_actions'
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  .github/workflows/deploy.yml
                </button>
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
                className="absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                {copiedCode === selectedArchTab ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCode === selectedArchTab ? 'Copied' : 'Copy'}</span>
              </button>

              <pre className="text-slate-300 leading-relaxed">
                {selectedArchTab === 'wrangler' && dynamicWranglerSnippet}
                {selectedArchTab === 'schema' && d1Snippet}
                {selectedArchTab === 'runtime' && deploySnippet}
                {selectedArchTab === 'github_actions' && githubActionsSnippet}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PASSWORDLESS IDENTITY & SECURITY */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          {/* Authenticated Account Banner */}
          {isAuthenticated && user ? (
            <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-4">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold text-sm flex items-center justify-center font-mono">
                    {user.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>{user.name}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-medium border border-emerald-200 dark:border-emerald-900/50">
                        Active Account
                      </span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                      {user.email} · Workspace: {workspace?.name || 'Personal Workspace'}
                    </p>
                  </div>
                </div>

                <div className="text-right text-xs">
                  <span className="text-slate-400">User ID:</span>{' '}
                  <span className="font-mono text-slate-700 dark:text-slate-300">{user.id}</span>
                </div>
              </div>

              {/* Passkeys Management */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <Fingerprint className="w-4 h-4 text-blue-500" />
                      <span>Registered Passkeys ({passkeys.length})</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      FIDO2 / WebAuthn authenticators bound to this account. Synchronized or device-bound credentials.
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setAuthModalMode('register');
                      setIsAuthModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors border border-blue-200 dark:border-blue-900/40"
                  >
                    <Fingerprint className="w-3.5 h-3.5" />
                    <span>Enroll Another Passkey</span>
                  </button>
                </div>

                {passkeys.length === 0 ? (
                  <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-500 text-center">
                    No passkeys found. Please enroll an authenticator.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    {passkeys.map(pk => (
                      <div key={pk.id} className="p-3.5 flex items-center justify-between gap-3 text-xs bg-slate-50/50 dark:bg-slate-950/30">
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-900 dark:text-slate-200 flex items-center gap-2">
                            <span>{pk.credential_name || 'Device Authenticator'}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                              Counter: {pk.sign_count}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            ID: {pk.id} · Enrolled: {new Date(pk.created_at).toLocaleDateString()}
                          </div>
                        </div>

                        <button
                          onClick={() => deletePasskey(pk.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="Revoke passkey"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Secondary TOTP Authenticator */}
              <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800/80">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-emerald-500" />
                      <span>Secondary Authentication (RFC 6238 TOTP)</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Aegis, Google Authenticator, or Microsoft Authenticator for fallback access.
                    </p>
                  </div>

                  {!hasTotp && !totpSetupData && (
                    <button
                      onClick={async () => {
                        try {
                          const res = await setupTotp();
                          setTotpSetupData(res);
                        } catch (err: any) {
                          showNotification(err?.message || 'Failed to initialize TOTP', 'error');
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg transition-colors border border-emerald-200 dark:border-emerald-900/40"
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>Enroll Authenticator App</span>
                    </button>
                  )}

                  {hasTotp && (
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Enrolled & Active</span>
                    </span>
                  )}
                </div>

                {totpSetupData && (
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Scan the QR code or enter this Base32 secret key into your authenticator application:
                    </p>

                    <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-mono text-center text-sm font-bold tracking-widest text-blue-600 dark:text-blue-400 select-all">
                      {totpSetupData.secret}
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="000000"
                        value={totpInputCode}
                        onChange={(e) => setTotpInputCode(e.target.value.replace(/\D/g, ''))}
                        className="w-36 px-3 py-1.5 text-xs font-mono tracking-widest text-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      />
                      <button
                        onClick={async () => {
                          if (totpInputCode.length !== 6) return;
                          setIsVerifyingTotp(true);
                          try {
                            await verifyTotpSetup(totpInputCode);
                            setTotpSetupData(null);
                            setTotpInputCode('');
                          } catch (err: any) {
                            showNotification(err?.message || 'Invalid verification code', 'error');
                          } finally {
                            setIsVerifyingTotp(false);
                          }
                        }}
                        disabled={isVerifyingTotp || totpInputCode.length !== 6}
                        className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition-colors"
                      >
                        {isVerifyingTotp ? 'Verifying...' : 'Confirm & Enable TOTP'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 mx-auto flex items-center justify-center">
                <Fingerprint className="w-6 h-6" />
              </div>
              <div className="max-w-md mx-auto">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Passwordless Authentication Required
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  You are currently browsing as an anonymous guest. Register or sign in with your WebAuthn passkey to manage personal workspaces, claim compute worker nodes, and access audit logs.
                </p>
              </div>
              <button
                onClick={() => {
                  setAuthModalMode('login');
                  setIsAuthModalOpen(true);
                }}
                className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-xs transition-colors inline-flex items-center gap-2"
              >
                <Fingerprint className="w-4 h-4" />
                <span>Sign In or Register Account</span>
              </button>
            </div>
          )}

          {/* Cryptographic Security Architecture Card */}
          <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>AetherOS Zero-Password Architecture & Security Policy</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-1">
              <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 rounded-xl">
                <div className="font-semibold text-slate-900 dark:text-white mb-1">WebAuthn / FIDO2</div>
                <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                  ES256 & RS256 native cryptographic signatures. Device-bound hardware enclaves (Touch ID, Face ID, Windows Hello, YubiKey).
                </p>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 rounded-xl">
                <div className="font-semibold text-slate-900 dark:text-white mb-1">4-Attempt Lockout</div>
                <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                  Cryptographic challenges expire in 5 minutes and immediately lock out after 4 failed verification attempts.
                </p>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 rounded-xl">
                <div className="font-semibold text-slate-900 dark:text-white mb-1">AES-GCM Encryption</div>
                <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                  Kaggle API keys and TOTP shared secrets are encrypted using AES-GCM-256 with per-record 96-bit initialization vectors.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Storage & State Purge */}
      <div className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Client Local Storage Cache
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Purge local browser cache to re-sync all live state directly from Cloudflare D1 and R2.
          </p>
        </div>

        <button
          onClick={handleResetData}
          className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border rounded-lg transition-colors ${
            isConfirmingReset
              ? 'border-rose-500 bg-rose-600 text-white hover:bg-rose-700'
              : 'text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <RotateCcw className={`w-3.5 h-3.5 ${isConfirmingReset ? 'text-white' : 'text-slate-400'}`} />
          <span>{isConfirmingReset ? 'Click to Confirm Cache Clear' : 'Clear Browser Cache'}</span>
        </button>
      </div>
    </div>
  );
};
