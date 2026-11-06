import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { apiClient } from '../../services/api-client';
import {
  Code2,
  Play,
  Copy,
  Check,
  Plus,
  FileCode,
  Terminal,
  Cpu,
  HardDrive,
  Sparkles,
  RefreshCw,
  FolderGit2,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';

interface CodeStudioFile {
  id: string;
  filename: string;
  language: 'typescript' | 'python' | 'sql' | 'rust';
  description: string;
  content: string;
  taskId?: string;
}

const INITIAL_CODE_FILES: CodeStudioFile[] = [
  {
    id: 'code_1',
    filename: 'worker_lease_router.ts',
    language: 'typescript',
    description: 'Cloudflare Worker atomic task claim & lease verification handler',
    content: `import type { Env, Task } from './worker/types';

export async function claimNextAvailableTask(
  env: Env,
  workerId: string,
  availableVramMb: number
): Promise<Task | null> {
  const nowIso = new Date().toISOString();
  const leaseExpiresIso = new Date(Date.now() + 90_000).toISOString();

  // Select highest-priority queued task matching node VRAM constraints
  const candidate = await env.DB.prepare(\`
    SELECT * FROM tasks
    WHERE status = 'queued'
      AND COALESCE(json_extract(input_payload, '$.min_vram_mb'), 0) <= ?
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END ASC,
      created_at ASC
    LIMIT 1
  \`)
    .bind(availableVramMb)
    .first<Task>();

  if (!candidate) return null;

  const updated = await env.DB.prepare(\`
    UPDATE tasks
    SET status = 'assigned',
        claimed_by_worker = ?,
        lease_expires_at = ?,
        attempt_count = COALESCE(attempt_count, 0) + 1,
        updated_at = ?
    WHERE id = ? AND status = 'queued'
  \`)
    .bind(workerId, leaseExpiresIso, nowIso, candidate.id)
    .run();

  return updated.meta?.changes === 1
    ? { ...candidate, status: 'assigned', claimed_by_worker: workerId, lease_expires_at: leaseExpiresIso }
    : null;
}`,
  },
  {
    id: 'code_2',
    filename: '0005_workspace_artifacts_index.sql',
    language: 'sql',
    description: 'D1 SQLite composite indexing migration for studio workspace artifacts',
    content: `-- Migration: 0005_workspace_artifacts_index.sql
-- Target: Cloudflare D1 (SQLite 3.45+)

CREATE INDEX IF NOT EXISTS idx_files_task_created
  ON files(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_status_priority
  ON tasks(status, priority, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_category_time
  ON activity_logs(category, created_at DESC);`,
  },
  {
    id: 'code_3',
    filename: 'kaggle_dual_t4_inference.py',
    language: 'python',
    description: 'PyTorch tensor-parallel inference runner for Dual NVIDIA Tesla T4 (32GB)',
    content: `import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

def load_sharded_coder_model(model_id: str = "Qwen/Qwen2.5-Coder-14B-Instruct"):
    assert torch.cuda.device_count() >= 1, "CUDA GPU required for local inference"
    tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        torch_dtype=torch.float16,
        device_map="auto",
        max_memory={0: "14GiB", 1: "14GiB"},
    )
    return tokenizer, model

def synthesize_code(prompt: str, max_new_tokens: int = 1024) -> str:
    tokenizer, model = load_sharded_coder_model()
    messages = [
        {"role": "system", "content": "You are a principal systems engineer."},
        {"role": "user", "content": prompt},
    ]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer([text], return_tensors="pt").to(model.device)
    with torch.inference_mode():
        generated = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
    return tokenizer.decode(generated[0][inputs.input_ids.shape[1]:], skip_special_tokens=True)`,
  },
];

const REFERENCE_BLUEPRINTS = [
  {
    label: 'Rate-Limited Worker Middleware',
    language: 'typescript' as const,
    filename: 'rate_limiter_edge.ts',
    description: 'Reference Blueprint: Sliding-window rate limiter middleware for Cloudflare Workers',
    code: `import type { Env } from './worker/types';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtEpochMs: number;
}

const windowBuckets = new Map<string, { count: number; expiresAt: number }>();

export function checkSlidingWindowRateLimit(
  clientKey: string,
  limitPerMinute: number = 120
): RateLimitResult {
  const now = Date.now();
  const bucket = windowBuckets.get(clientKey);

  if (!bucket || bucket.expiresAt <= now) {
    const expiresAt = now + 60_000;
    windowBuckets.set(clientKey, { count: 1, expiresAt });
    return { allowed: true, remaining: limitPerMinute - 1, resetAtEpochMs: expiresAt };
  }

  if (bucket.count >= limitPerMinute) {
    return { allowed: false, remaining: 0, resetAtEpochMs: bucket.expiresAt };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limitPerMinute - bucket.count),
    resetAtEpochMs: bucket.expiresAt,
  };
}`,
  },
  {
    label: 'R2 Verified Artifact Streamer',
    language: 'typescript' as const,
    filename: 'r2_stream_archive.ts',
    description: 'Reference Blueprint: Cloudflare R2 uploader with SHA-256 digest verification',
    code: `import type { R2Bucket, R2Object } from './worker/types';

export async function putVerifiedArtifactStream(
  bucket: R2Bucket,
  r2Key: string,
  payloadText: string,
  contentType: string = 'application/json'
): Promise<{ object: R2Object; sha256Hex: string }> {
  const bytes = new TextEncoder().encode(payloadText);
  const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const sha256Hex = Array.from(new Uint8Array(digestBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const object = await bucket.put(r2Key, bytes.buffer as ArrayBuffer, {
    httpMetadata: { contentType },
    customMetadata: { sha256: sha256Hex, verified_at: new Date().toISOString() },
  });

  return { object, sha256Hex };
}`,
  },
  {
    label: 'D1 Telemetry Aggregation View',
    language: 'sql' as const,
    filename: '0006_worker_telemetry_view.sql',
    description: 'Reference Blueprint: Normalized D1 SQLite view summarizing worker GPU efficiency',
    code: `-- Migration: 0006_worker_telemetry_view.sql
-- Aggregates per-worker task throughput and average step execution latency

CREATE VIEW IF NOT EXISTS v_worker_efficiency_summary AS
SELECT
  w.id AS worker_id,
  w.name AS worker_name,
  w.provider AS provider,
  w.gpu_model AS gpu_model,
  w.gpu_count AS gpu_count,
  w.vram_mb AS vram_mb,
  w.status AS current_status,
  w.total_tasks_completed AS completed_tasks,
  COUNT(t.id) AS active_assigned_tasks,
  ROUND(AVG(COALESCE(w.gpu_utilization_percent, 0)), 1) AS avg_gpu_utilization_pct
FROM compute_workers w
LEFT JOIN tasks t
  ON t.claimed_by_worker = w.id
  AND t.status IN ('assigned', 'downloading', 'loading_model', 'running', 'uploading')
WHERE w.is_revoked = 0
GROUP BY w.id;`,
  },
];

export const CodeWorkspaceView: React.FC = () => {
  const { submitTask, uploadFile, showNotification, workers, tasks } = useApp();

  const [files, setFiles] = useState<CodeStudioFile[]>(INITIAL_CODE_FILES);
  const [selectedFileId, setSelectedFileId] = useState<string>(INITIAL_CODE_FILES[0].id);
  const [selectedModel, setSelectedModel] = useState<string>('qwen-2.5-coder-14b');
  const [promptInput, setPromptInput] = useState<string>('');
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [isSavingR2, setIsSavingR2] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [executionOutput, setExecutionOutput] = useState<string[]>([
    'Workspace initialized. Select a file to edit, load a reference blueprint, or dispatch a real synthesis task to the GPU grid.',
  ]);

  // Defensive Cybersecurity Assessment (Phase 10) state
  const [showSecurityPanel, setShowSecurityPanel] = useState<boolean>(false);
  const [secTargetUrl, setSecTargetUrl] = useState<string>('');
  const [secDomain, setSecDomain] = useState<string>('');
  const [secAuthConfirmed, setSecAuthConfirmed] = useState<boolean>(false);
  const [isRunningAudit, setIsRunningAudit] = useState<boolean>(false);
  const [securityReport, setSecurityReport] = useState<any | null>(null);
  const [securityReportR2Key, setSecurityReportR2Key] = useState<string | null>(null);

  const activeFile = files.find(f => f.id === selectedFileId) || files[0];
  const onlineWorkers = workers.filter(w => w.status === 'online' || w.status === 'busy');
  const trackedTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) : null;

  // Sync completed worker output into editor file when a dispatched task finishes
  useEffect(() => {
    if (!trackedTask) return;
    if (trackedTask.status === 'completed' && trackedTask.result_payload) {
      const outputText =
        typeof trackedTask.result_payload.output === 'string'
          ? trackedTask.result_payload.output
          : typeof trackedTask.result_payload.code === 'string'
          ? trackedTask.result_payload.code
          : JSON.stringify(trackedTask.result_payload, null, 2);

      const synthId = `code_task_${trackedTask.id}`;
      setFiles(prev => {
        if (prev.some(f => f.id === synthId)) return prev;
        const newFile: CodeStudioFile = {
          id: synthId,
          filename: `synthesized_${trackedTask.id.slice(-6)}.ts`,
          language: 'typescript',
          description: trackedTask.title,
          content: outputText,
          taskId: trackedTask.id,
        };
        return [newFile, ...prev];
      });
      setSelectedFileId(synthId);
      setExecutionOutput(prev => [
        ...prev,
        `[COMPLETED]: Task ${trackedTask.id} finished on worker ${trackedTask.claimed_by_worker || 'grid'}. Output loaded into editor.`,
      ]);
      setActiveTaskId(null);
    } else if (trackedTask.status === 'failed') {
      setExecutionOutput(prev => [
        ...prev,
        `[FAILED]: Task ${trackedTask.id} failed: ${trackedTask.error_message || 'Execution error'}`,
      ]);
      setActiveTaskId(null);
    }
  }, [trackedTask]);

  const handleCodeChange = (newContent: string) => {
    setFiles(prev =>
      prev.map(f => (f.id === activeFile.id ? { ...f, content: newContent } : f))
    );
  };

  const handleLoadBlueprint = (blueprint: typeof REFERENCE_BLUEPRINTS[number]) => {
    const existing = files.find(f => f.filename === blueprint.filename);
    if (existing) {
      setSelectedFileId(existing.id);
    } else {
      const newFile: CodeStudioFile = {
        id: `bp_${Date.now()}`,
        filename: blueprint.filename,
        language: blueprint.language,
        description: blueprint.description,
        content: blueprint.code,
      };
      setFiles(prev => [newFile, ...prev]);
      setSelectedFileId(newFile.id);
    }
    setExecutionOutput(prev => [
      ...prev,
      `Loaded reference blueprint '${blueprint.filename}' into editor buffer.`,
    ]);
  };

  const handleSynthesize = async () => {
    const directivePrompt = promptInput.trim();
    if (!directivePrompt) return;

    setIsSynthesizing(true);
    try {
      const created = await submitTask({
        agentId: 'agent_dataops',
        title: `Code Synthesis: ${directivePrompt.slice(0, 64)}`,
        description: directivePrompt,
        inputPayload: {
          workspace: 'code_generation',
          task_type: 'inference',
          model: selectedModel,
          prompt: directivePrompt,
          language: activeFile.language,
          require_gpu: true,
          min_vram_mb: 10240,
          required_capability: 'code',
        },
        priority: 'high',
      });
      setActiveTaskId(created.id);
      setPromptInput('');

      if (onlineWorkers.length === 0) {
        setExecutionOutput(prev => [
          ...prev,
          `[QUEUED — WAITING FOR GPU WORKER]: Task '${created.id}' persisted in D1 for model '${selectedModel}'.`,
          `No active GPU compute workers are currently online. Connect your Kaggle T4×2 worker node to execute this task—no fabricated code was substituted.`,
        ]);
      } else {
        setExecutionOutput(prev => [
          ...prev,
          `[DISPATCHED]: Task '${created.id}' queued for ${onlineWorkers.length} online GPU node(s) using ${selectedModel}.`,
        ]);
      }
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleDispatchToGrid = async () => {
    setIsDispatching(true);
    try {
      const created = await submitTask({
        agentId: 'agent_dataops',
        title: `Code Verification & Execution: ${activeFile.filename}`,
        description: activeFile.description,
        inputPayload: {
          workspace: 'code_generation',
          task_type: 'inference',
          model: selectedModel,
          filename: activeFile.filename,
          language: activeFile.language,
          source_code: activeFile.content,
          prompt: `Review and verify module ${activeFile.filename}:\n\n${activeFile.content}`,
          require_gpu: true,
          min_vram_mb: 10240,
          required_capability: 'code',
        },
        priority: 'high',
      });
      setActiveTaskId(created.id);
      setExecutionOutput(prev => [
        ...prev,
        onlineWorkers.length > 0
          ? `Dispatched ${activeFile.filename} (Task ${created.id}) to active GPU compute queue (${selectedModel}).`
          : `Queued ${activeFile.filename} (Task ${created.id}) in D1. Waiting for a compatible GPU worker node to connect.`,
      ]);
    } finally {
      setIsDispatching(false);
    }
  };

  const handleSaveToR2 = async () => {
    setIsSavingR2(true);
    try {
      const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
      const fileObj = new File([blob], activeFile.filename, { type: 'text/plain' });
      await uploadFile(fileObj, activeFile.taskId);
      setExecutionOutput(prev => [
        ...prev,
        `Uploaded ${activeFile.filename} (${blob.size} bytes) to Cloudflare R2 bucket and recorded D1 metadata.`,
      ]);
    } finally {
      setIsSavingR2(false);
    }
  };

  const handleRunDefensiveAudit = async () => {
    setIsRunningAudit(true);
    try {
      const res = await apiClient.assessSecurity({
        scope: 'full_audit',
        target_url: secTargetUrl.trim() || undefined,
        domain: secDomain.trim() || undefined,
        source_code: activeFile.content,
        source_filename: activeFile.filename,
        authorization_confirmed: secAuthConfirmed || (!secTargetUrl.trim() && !secDomain.trim()),
        authorized_scope_note: `Code Workspace Audit (${activeFile.filename})`,
      });
      setSecurityReport(res.report);
      setSecurityReportR2Key(res.artifacts?.markdown_key || null);
      setExecutionOutput(prev => [
        ...prev,
        `[AEGIS-0 SECURITY AUDIT]: Completed assessment ${res.report.report_id} (${res.report.summary.total_findings} findings: ${res.report.summary.verified_findings} verified, ${res.report.summary.unverified_indicators} unverified indicators). Archived to R2: ${res.artifacts?.markdown_key}`,
      ]);
      showNotification('Defensive cybersecurity audit completed & archived to R2', 'success');
    } catch (err: any) {
      showNotification(err?.message || 'Security assessment failed', 'error');
    } finally {
      setIsRunningAudit(false);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    showNotification(`Copied ${activeFile.filename} to clipboard`, 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = activeFile.content.split('\n');

  return (
    <div className="space-y-6 pb-10 w-full max-w-full min-w-0">
      {/* Workspace Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800 min-w-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span className="whitespace-nowrap">Studio Workspaces</span>
            <span>/</span>
            <span className="text-slate-900 dark:text-slate-200 font-medium whitespace-nowrap">Code Generation</span>
            <span>·</span>
            <span className="font-mono tabular-nums whitespace-nowrap">{files.length} workspace files</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Code Generation & Defensive Security Workbench
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            Author TypeScript Workers, D1 SQLite migrations, and PyTorch GPU modules, or run authorized defensive security audits.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs max-w-full">
            <Cpu className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="text-slate-500 dark:text-slate-400 shrink-0">Model:</span>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="font-mono font-semibold text-slate-900 dark:text-white bg-transparent focus:outline-none cursor-pointer truncate"
            >
              <option value="qwen-2.5-coder-14b">Qwen 2.5 Coder 14B (14GB VRAM)</option>
              <option value="deepseek-r1-distill-qwen-14b">DeepSeek R1 Distill 14B (15GB VRAM)</option>
            </select>
          </div>

          <button
            onClick={() => setShowSecurityPanel(prev => !prev)}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              showSecurityPanel
                ? 'border-red-600 bg-red-600 text-white'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Aegis-0 Security Audit</span>
          </button>

          <button
            onClick={handleSaveToR2}
            disabled={isSavingR2}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <HardDrive className="w-3.5 h-3.5 text-slate-500" />
            <span>{isSavingR2 ? 'Uploading...' : 'Save to R2'}</span>
          </button>

          <button
            onClick={handleDispatchToGrid}
            disabled={isDispatching}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isDispatching ? 'Dispatching...' : 'Run on Compute Grid'}</span>
          </button>
        </div>
      </div>

      {/* Honest Compute Availability Banner */}
      {onlineWorkers.length === 0 && (
        <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">No GPU Compute Workers Currently Online:</span> Code synthesis tasks submitted below will be persisted in Cloudflare D1 (`queued`) and automatically claimed when your Kaggle T4×2 worker connects. Aegis-0 static code & defensive security audits execute natively on the Cloudflare Worker and are available immediately.
          </div>
        </div>
      )}

      {/* Defensive Cybersecurity Specialist Panel (Phase 10) */}
      {showSecurityPanel && (
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-red-600 dark:text-red-400" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Aegis-0 Defensive Cybersecurity Assessment (`agent_cybersec`)
                </h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Performs non-destructive HTTP security-header analysis, TLS inspection, DNS SPF/DMARC/CAA verification, and static source code auditing on `{activeFile.filename}`.
              </p>
            </div>
            {securityReportR2Key && (
              <a
                href={`/api/files/download/${encodeURIComponent(securityReportR2Key)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Download R2 Markdown Report</span>
              </a>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Optional Target Website URL (HTTP Headers & TLS Check)
              </label>
              <input
                type="url"
                value={secTargetUrl}
                onChange={e => setSecTargetUrl(e.target.value)}
                placeholder="https://example.com (leave blank for code-only audit)"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Optional Domain Name (DNS SPF / DMARC / CAA Check)
              </label>
              <input
                type="text"
                value={secDomain}
                onChange={e => setSecDomain(e.target.value)}
                placeholder="example.com"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={secAuthConfirmed}
                onChange={e => setSecAuthConfirmed(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                I confirm I am authorized to perform passive, non-destructive defensive checks on the specified target.
              </span>
            </label>

            <button
              onClick={handleRunDefensiveAudit}
              disabled={isRunningAudit || ((Boolean(secTargetUrl.trim()) || Boolean(secDomain.trim())) && !secAuthConfirmed)}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              {isRunningAudit ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              <span>{isRunningAudit ? 'Running Defensive Audit...' : `Audit ${activeFile.filename} & Target`}</span>
            </button>
          </div>

          {securityReport && (
            <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-center">
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase">Posture Score</div>
                  <div className="text-base font-bold font-mono text-slate-900 dark:text-white">
                    {securityReport.summary.overall_risk_score}/100
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-red-50/70 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50">
                  <div className="text-[10px] text-red-600 dark:text-red-400 uppercase">Critical / High</div>
                  <div className="text-base font-bold font-mono text-red-700 dark:text-red-300">
                    {securityReport.summary.critical + securityReport.summary.high}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50">
                  <div className="text-[10px] text-amber-600 dark:text-amber-400 uppercase">Medium / Low</div>
                  <div className="text-base font-bold font-mono text-amber-700 dark:text-amber-300">
                    {securityReport.summary.medium + securityReport.summary.low}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase">Verified Findings</div>
                  <div className="text-base font-bold font-mono text-emerald-700 dark:text-emerald-300">
                    {securityReport.summary.verified_findings}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 sm:col-span-2">
                  <div className="text-[10px] text-slate-500 uppercase">Unverified Indicators</div>
                  <div className="text-base font-bold font-mono text-slate-700 dark:text-slate-300">
                    {securityReport.summary.unverified_indicators}
                  </div>
                </div>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {securityReport.findings.map((f: any) => (
                  <div
                    key={f.id}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 text-xs space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        [{f.severity.toUpperCase()} · CVSS {f.cvss_estimate.toFixed(1)}] {f.title}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                          f.verification_status === 'verified_finding'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                            : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {f.verification_status}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">{f.description}</p>
                    <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      Evidence: {f.evidence}
                    </div>
                    <div className="text-[11px] text-blue-700 dark:text-blue-300">
                      Remediation: {f.remediation}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Prompt Synthesis Bar */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <input
              type="text"
              value={promptInput}
              onChange={e => setPromptInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSynthesize();
              }}
              placeholder="Describe a module, SQL migration, or worker endpoint to dispatch to Qwen 2.5 Coder 14B..."
              className="w-full px-3.5 py-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <button
            onClick={handleSynthesize}
            disabled={isSynthesizing || !promptInput.trim()}
            className="px-4 py-2.5 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-blue-600 text-white hover:bg-slate-800 dark:hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
          >
            {isSynthesizing ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>{isSynthesizing ? 'Dispatching Task...' : 'Dispatch Code Synthesis'}</span>
          </button>
        </div>

        {/* Reference Blueprints */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] text-slate-400 font-medium">Load Reference Blueprint:</span>
          {REFERENCE_BLUEPRINTS.map((bp, i) => (
            <button
              key={i}
              onClick={() => handleLoadBlueprint(bp)}
              className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0"
            >
              {bp.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main 3-Column IDE Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: File Explorer (3 cols) */}
        <div className="lg:col-span-3 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
              <FolderGit2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Workspace Files</span>
            </div>
            <button
              onClick={() => {
                const newFile: CodeStudioFile = {
                  id: `code_${Date.now()}`,
                  filename: `module_${files.length + 1}.ts`,
                  language: 'typescript',
                  description: 'Custom TypeScript module',
                  content: `// New AetherOS module\nexport function initModule() {\n  return { ready: true };\n}\n`,
                };
                setFiles(prev => [newFile, ...prev]);
                setSelectedFileId(newFile.id);
              }}
              className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="New file"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
            {files.map(file => {
              const isSelected = file.id === activeFile.id;
              return (
                <button
                  key={file.id}
                  onClick={() => setSelectedFileId(file.id)}
                  className={`w-full text-left px-4 py-3 transition-colors flex items-start gap-2.5 ${
                    isSelected
                      ? 'bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <FileCode className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-mono font-semibold truncate">
                      {file.filename}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {file.language} · {file.content.split('\n').length} lines
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center + Right: Code Editor & Diagnostics (9 cols) */}
        <div className="lg:col-span-9 min-w-0 space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            {/* Editor Header */}
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Code2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {activeFile.filename}
                </span>
                <span className="text-xs text-slate-400 hidden sm:inline">·</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate hidden sm:inline">
                  {activeFile.description}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {lines.length} lines · {activeFile.content.length} chars
                </span>
                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Editable Code Buffer with Line Gutter */}
            <div className="relative flex bg-slate-950 text-slate-100 font-mono text-xs min-h-[380px] max-h-[520px] overflow-y-auto">
              <div
                aria-hidden="true"
                className="select-none py-4 px-3 text-right text-slate-600 bg-slate-950 border-r border-slate-800/80 tabular-nums leading-6 shrink-0"
              >
                {lines.map((_, idx) => (
                  <div key={idx}>{idx + 1}</div>
                ))}
              </div>
              <textarea
                value={activeFile.content}
                onChange={e => handleCodeChange(e.target.value)}
                spellCheck={false}
                className="w-full min-w-0 p-4 bg-transparent text-slate-100 font-mono text-xs leading-6 focus:outline-none resize-none overflow-x-auto"
                rows={Math.max(16, lines.length)}
              />
            </div>
          </div>

          {/* Compiler & Compute Verification Output */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Orchestrator & Verification Console</span>
                {trackedTask && (
                  <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-mono text-[10px]">
                    Task {trackedTask.id}: {trackedTask.status.toUpperCase()} ({trackedTask.progress_percent}%)
                  </span>
                )}
              </div>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                Active GPU Workers: {onlineWorkers.length}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300 space-y-1">
              {executionOutput.map((line, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-slate-400 select-none tabular-nums">{String(idx + 1).padStart(2, '0')}</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
