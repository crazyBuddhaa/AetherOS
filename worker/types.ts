/**
 * TypeScript Definitions for AetherOS Cloudflare Worker, D1 Database, and R2 Bucket
 */

export interface Env {
  // Cloudflare D1 Database Binding
  DB: D1Database;

  // Cloudflare R2 Storage Bucket Binding
  FILES_BUCKET: R2Bucket;

  // Static Assets Binding (Cloudflare Workers Assets)
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };

  // Environment Variables
  ENVIRONMENT: string;
  INFERENCE_RUNTIME_URL: string;
  INFERENCE_RUNTIME_TIMEOUT_MS?: string;
  INFERENCE_RUNTIME_MAX_RETRIES?: string;
  REQUIRE_WORKER_NONCE?: string;

  // Secrets (configured via `wrangler secret put`)
  RUNTIME_API_KEY?: string;
  JWT_SECRET?: string;
  WORKER_AUTH_PEPPER?: string;
  WORKER_REGISTRATION_TOKEN?: string;
}

// Minimal Cloudflare Workers Runtime Types (so tsc compiles cleanly without external global conflicts)
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
  error?: string;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

export interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions
  ): Promise<R2Object>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

export interface R2PutOptions {
  httpMetadata?: {
    contentType?: string;
    contentDisposition?: string;
    cacheControl?: string;
  };
  customMetadata?: Record<string, string>;
}

export interface R2ListOptions {
  limit?: number;
  prefix?: string;
  cursor?: string;
}

export interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Record<string, string>;
  uploaded?: Date;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

// Domain Models matching D1 SQL Schema
export interface Agent {
  id: string;
  name: string;
  description: string;
  model: string;
  system_instructions: string;
  temperature: number;
  max_tokens: number;
  permitted_tools: unknown[];
  is_enabled: boolean;
  avatar_color: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export type TaskLifecycleStatus =
  | 'pending'
  | 'queued'
  | 'validating'
  | 'scheduled'
  | 'assigned'
  | 'downloading'
  | 'loading_model'
  | 'running'
  | 'uploading'
  | 'processing_result'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'expired'
  | 'retrying';

export interface Task {
  id: string;
  agent_id: string;
  agent_name?: string;
  user_id: string;
  workspace_id?: string;
  idempotency_key?: string;
  title: string;
  description?: string;
  input_payload: Record<string, unknown>;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: TaskLifecycleStatus;
  progress_percent: number;
  result_payload?: Record<string, unknown>;
  error_message?: string;
  external_runtime_task_id?: string;
  claimed_by_worker?: string;
  lease_expires_at?: string;
  attempt_count?: number;
  max_retries?: number;
  timeout_seconds?: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  steps?: TaskStep[];
}

export type WorkerProvider = 'kaggle' | 'oracle' | 'runpod' | 'self_hosted' | 'custom';
export type WorkerStatus = 'online' | 'busy' | 'offline' | 'maintenance';

export interface GpuDeviceSpec {
  index: number;
  name: string;
  vram_total_mb: number;
  vram_used_mb?: number;
  vram_free_mb?: number;
  utilization_percent?: number;
  temperature_c?: number;
}

export interface ComputeWorker {
  id: string;
  name: string;
  provider: WorkerProvider;
  gpu_model: string;
  gpu_count: number;
  vram_mb: number;
  system_ram_mb: number;
  status: WorkerStatus;
  api_key_hash?: string;
  key_prefix?: string;
  key_fingerprint?: string;
  is_revoked?: boolean;
  capabilities?: string[];
  loaded_models?: string[];
  gpu_devices?: GpuDeviceSpec[];
  contributor_name?: string;
  contributor_email?: string;
  current_task_id?: string;
  current_task_title?: string;
  last_heartbeat?: string;
  lease_expires_at?: string;
  shutdown_at?: string;
  uptime_seconds: number;
  total_tasks_completed: number;
  created_at: string;
  updated_at: string;
  gpu_utilization_percent?: number;
  gpu_memory_used_mb?: number;
  gpu_temperature_c?: number;
}

export type ModelCategory =
  | 'text'
  | 'coding'
  | 'vision'
  | 'image'
  | 'video'
  | 'image_processing'
  | 'audio'
  | 'speech'
  | 'embedding'
  | 'specialized';

export interface ModelDefinition {
  id: string;
  name: string;
  category: ModelCategory;
  min_vram_mb: number;
  min_system_ram_mb?: number;
  supported_precisions: string[];
  capabilities?: string[];
  weights_source: string;
  parameter_count?: string;
  context_window?: number;
  default_timeout_seconds?: number;
  description?: string;
  execution_constraints?: Record<string, unknown>;
  is_enabled: boolean;
  created_at: string;
}

export interface WorkerHeartbeatPayload {
  worker_id: string;
  status?: WorkerStatus;
  gpu_utilization_percent?: number;
  gpu_memory_used_mb?: number;
  gpu_temperature_c?: number;
  uptime_seconds?: number;
  loaded_models?: string[];
  capabilities?: string[];
  gpu_devices?: GpuDeviceSpec[];
  system_ram_mb?: number;
}

export interface TaskStep {
  id: string;
  task_id: string;
  step_number: number;
  step_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting_approval';
  input_data?: Record<string, unknown>;
  output_data?: Record<string, unknown>;
  logs?: string;
  duration_ms: number;
  created_at: string;
}

export interface ApprovalRequest {
  id: string;
  task_id: string;
  task_title?: string;
  agent_id: string;
  agent_name?: string;
  step_id?: string;
  action_name: string;
  action_type:
    | 'shell_execution'
    | 'file_modification'
    | 'database_write'
    | 'external_api_call'
    | 'financial_transaction'
    | 'cloud_deployment';
  payload: Record<string, unknown>;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requested_at: string;
  decided_at?: string;
  decided_by?: string;
  review_comment?: string;
}

export interface R2FileRecord {
  id: string;
  r2_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  etag?: string;
  uploaded_by: string;
  conversation_id?: string;
  task_id?: string;
  storage_class: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  user_id?: string;
  agent_id?: string;
  task_id?: string;
  action: string;
  category: 'auth' | 'agent' | 'task' | 'approval' | 'file' | 'system' | 'runtime';
  details?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  agent_id?: string;
  agent_name?: string;
  agent_avatar_color?: string;
  title: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  last_message?: string;
  message_count?: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_type: 'user' | 'agent' | 'system' | 'tool';
  content: string;
  thinking?: string;
  tool_calls?: unknown[];
  artifacts?: unknown[];
  attachments?: string[];
  tokens_used: number;
  created_at: string;
}

// --- USER ACCOUNTS, PASSWORDLESS AUTH, WORKSPACES & SESSIONS (Migration 0004) ---

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'member' | 'viewer';
  status: 'pending_verification' | 'active' | 'suspended';
  is_active?: boolean;
  email_verified?: boolean;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  owner_user_id?: string;
  is_personal: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMembership {
  id: string;
  organization_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
}

export interface PasskeyCredential {
  id: string; // Credential ID (base64url)
  user_id: string;
  public_key: string; // SPKI / COSE key in base64url
  algorithm: number; // -7 (ES256) or -257 (RS256)
  sign_count: number;
  device_name: string;
  transports: string[];
  aaguid?: string;
  created_at: string;
  last_used_at?: string;
}

export interface TotpCredential {
  id: string;
  user_id: string;
  encrypted_secret: string;
  secret_iv: string;
  label: string;
  is_active: boolean;
  last_verified_counter: number;
  created_at: string;
  updated_at: string;
}

export interface AuthChallenge {
  id: string;
  challenge: string;
  purpose: 'registration' | 'login' | 'passkey_enrollment';
  user_id?: string;
  email?: string;
  origin: string;
  rp_id: string;
  failed_attempts: number;
  is_used: boolean;
  expires_at: string;
  created_at: string;
}

export interface AuthSession {
  id: string; // Session Token
  user_id: string;
  organization_id?: string;
  ip_address?: string;
  user_agent?: string;
  is_revoked: boolean;
  last_active_at: string;
  expires_at: string;
  created_at: string;
}

export type ComputeSessionStatus =
  | 'stopped'
  | 'starting'
  | 'initializing'
  | 'waiting_for_worker'
  | 'ready'
  | 'busy'
  | 'stopping'
  | 'failed'
  | 'unavailable';

export interface ComputeSession {
  id: string;
  provider: 'kaggle' | 'oracle' | 'runpod' | 'self_hosted';
  user_id: string;
  organization_id?: string;
  worker_id?: string;
  notebook_slug: string;
  kernel_session_id?: string;
  status: ComputeSessionStatus;
  gpu_type: string;
  started_at?: string;
  stopped_at?: string;
  last_poll_at?: string;
  logs_snippet?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  worker?: ComputeWorker | null;
}

export interface WorkerOwnership {
  worker_id: string;
  owner_user_id: string;
  organization_id?: string;
  ownership_type: 'personal' | 'organization' | 'contributor';
  claimed_at: string;
  owner_name?: string;
  organization_name?: string;
}

export interface KaggleCredentials {
  id: string;
  user_id: string;
  organization_id?: string;
  kaggle_username: string;
  encrypted_key: string;
  key_iv: string;
  created_at: string;
  updated_at: string;
}

export interface SecurityAuditEvent {
  id: string;
  user_id?: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  details: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
  createdAt: string;
}

export interface RuntimeSubmissionRequest {
  task_id: string;
  agent_id?: string;
  agent?: Agent | { id: string; name?: string; model?: string; system_instructions?: string };
  model?: string;
  input_payload?: Record<string, unknown>;
  input?: Record<string, unknown>;
  callback_url?: string;
  system_instructions?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface RuntimeSubmissionResponse {
  accepted: boolean;
  external_task_id: string;
  status: string;
  message?: string;
}

export interface RuntimeStatusResponse {
  external_task_id: string;
  status: TaskLifecycleStatus;
  progress_percent: number;
  result_payload?: Record<string, unknown>;
  error_message?: string;
}

export interface RuntimeHeartbeatResponse {
  online: boolean;
  node_id: string;
  engine_version?: string;
  active_jobs?: number;
  capacity_percent?: number;
}

