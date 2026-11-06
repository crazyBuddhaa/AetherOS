/**
 * Cloudflare Worker Environment Bindings & Domain Types
 */

// Cloudflare Workers Ambient Types
export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[]; success: boolean; meta?: any }>;
  run<T = unknown>(): Promise<{ success: boolean; meta?: any }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<any[]>;
  exec(query: string): Promise<any>;
}

export interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpMetadata?: Record<string, any>;
  customMetadata?: Record<string, string>;
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

export interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | string | null, options?: any): Promise<R2Object>;
  get(key: string, options?: any): Promise<R2ObjectBody | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: any): Promise<R2Objects>;
}

export interface Fetcher {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

export interface Env {
  // Bindings
  DB: D1Database;
  FILES_BUCKET: R2Bucket;
  ASSETS?: Fetcher;


  // Environment variables
  ENVIRONMENT: string;
  INFERENCE_RUNTIME_URL: string;
  INFERENCE_RUNTIME_TIMEOUT_MS?: string;
  INFERENCE_RUNTIME_MAX_RETRIES?: string;

  // Secrets
  RUNTIME_API_KEY?: string;
  JWT_SECRET?: string;
  WORKER_AUTH_PEPPER?: string;
  WORKER_REGISTRATION_TOKEN?: string;
  REQUIRE_WORKER_NONCE?: string;
}

export type UserRole = 'admin' | 'operator' | 'member' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface PermittedTool {
  id: string;
  name: string;
  description: string;
  category: 'execution' | 'retrieval' | 'network' | 'filesystem' | 'database';
  requires_approval: boolean;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  parameters_schema: Record<string, unknown>;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  model: string;
  system_instructions: string;
  temperature: number;
  max_tokens: number;
  permitted_tools: PermittedTool[];
  is_enabled: boolean;
  avatar_color: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 
  | 'pending'
  | 'queued' 
  | 'assigned'
  | 'downloading'
  | 'loading_model'
  | 'running' 
  | 'uploading'
  | 'waiting_approval' 
  | 'completed' 
  | 'failed' 
  | 'cancelled' 
  | 'paused';

export type WorkerProvider = 'kaggle' | 'oracle' | 'runpod' | 'self_hosted' | 'custom';
export type WorkerStatus = 'online' | 'busy' | 'offline' | 'maintenance';

export interface ComputeWorker {
  id: string;
  name: string;
  provider: WorkerProvider;
  gpu_model: string;
  gpu_count: number;
  vram_mb: number;
  system_ram_mb: number;
  status: WorkerStatus;
  key_prefix?: string;
  capabilities?: string[];
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

export interface ComputeWorkerRecord extends ComputeWorker {
  api_key_hash: string;
  key_fingerprint?: string | null;
  is_revoked: number;
}

export type ModelCategory = 'text' | 'image' | 'video' | 'image_processing' | 'audio';

export interface ModelDefinition {
  id: string;
  name: string;
  category: ModelCategory;
  min_vram_mb: number;
  supported_precisions: string[];
  weights_source: string;
  description?: string;
  execution_constraints?: Record<string, unknown>;
  is_enabled: boolean;
  created_at: string;
}

export interface WorkerRegisterPayload {
  name?: string;
  provider?: WorkerProvider;
  gpu_model: string;
  gpu_count?: number;
  vram_mb?: number;
  system_ram_mb?: number;
  capabilities?: string[];
  contributor_name?: string;
  contributor_email?: string;
  registration_token?: string;
}

export interface WorkerHeartbeatPayload {
  worker_id: string;
  status?: WorkerStatus;
  gpu_utilization_percent?: number;
  gpu_memory_used_mb?: number;
  gpu_temperature_c?: number;
  uptime_seconds?: number;
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

export interface Task {
  id: string;
  agent_id: string;
  user_id: string;
  title: string;
  description?: string;
  input_payload: Record<string, unknown>;
  priority: TaskPriority;
  status: TaskStatus;
  progress_percent: number;
  result_payload?: Record<string, unknown>;
  error_message?: string;
  external_runtime_task_id?: string;
  claimed_by_worker?: string;
  lease_expires_at?: string;
  attempt_count?: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  steps?: TaskStep[];
  agent_name?: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ApprovalActionType = 
  | 'shell_execution' 
  | 'file_modification' 
  | 'database_write' 
  | 'external_api_call' 
  | 'financial_transaction' 
  | 'cloud_deployment';

export interface ApprovalRequest {
  id: string;
  task_id: string;
  agent_id: string;
  step_id?: string;
  action_name: string;
  action_type: ApprovalActionType;
  payload: {
    command?: string;
    target?: string;
    diff?: string;
    details?: string;
    parameters?: Record<string, unknown>;
  };
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  status: ApprovalStatus;
  requested_at: string;
  decided_at?: string;
  decided_by?: string;
  review_comment?: string;
  agent_name?: string;
  task_title?: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  agent_id?: string;
  title: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  agent_name?: string;
  agent_avatar_color?: string;
  last_message?: string;
  message_count?: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_type: 'user' | 'agent' | 'system' | 'tool';
  content: string;
  tool_calls?: Array<{
    tool_id: string;
    tool_name: string;
    input: Record<string, unknown>;
    output?: Record<string, unknown>;
    status: 'success' | 'failed' | 'requires_approval';
  }>;
  attachments?: string[];
  tokens_used: number;
  created_at: string;
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

// External Runtime Integration Types (Self-Hosted Inference Engine)
export interface RuntimeSubmissionRequest {
  task_id: string;
  agent: {
    id: string;
    name: string;
    model: string;
    system_instructions: string;
    temperature: number;
    permitted_tools: PermittedTool[];
  };
  input: Record<string, unknown>;
  callback_url: string;
}

export interface RuntimeSubmissionResponse {
  external_task_id: string;
  status: 'queued' | 'claimed' | 'rejected';
  assigned_node?: string;
  estimated_queue_time_ms?: number;
}

export interface RuntimeStatusResponse {
  external_task_id: string;
  status: 'running' | 'completed' | 'failed' | 'waiting_approval';
  current_step?: string;
  progress_percent: number;
  result?: Record<string, unknown>;
  error?: string;
  heartbeat_timestamp: string;
}

export interface RuntimeHeartbeatResponse {
  node_id: string;
  status: 'healthy' | 'degraded' | 'maintenance';
  active_jobs: number;
  capacity_percent: number;
  engine_version: string;
  uptime_seconds: number;
}

// User Account & Organization Types
export interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'member' | 'viewer';
  status: 'pending_verification' | 'active' | 'suspended';
  verification_token_hash?: string;
  verification_expires_at?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
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
  id: string;
  user_id: string;
  public_key: string;
  algorithm: number;
  sign_count: number;
  device_name: string;
  transports?: string[];
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
  id: string;
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
