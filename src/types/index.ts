export type UserRole = 'admin' | 'operator' | 'member' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatar_url?: string;
}

export type ToolCategory = 'execution' | 'retrieval' | 'network' | 'filesystem' | 'database';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PermittedTool {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  requires_approval: boolean;
  risk_level: RiskLevel;
  parameters_schema?: Record<string, unknown>;
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
  agent_name?: string;
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
  task_title?: string;
  agent_id: string;
  agent_name?: string;
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
  risk_level: RiskLevel;
  status: ApprovalStatus;
  requested_at: string;
  decided_at?: string;
  decided_by?: string;
  review_comment?: string;
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

export interface MessageToolCall {
  tool_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'success' | 'failed' | 'requires_approval';
}

export interface MessageArtifact {
  title: string;
  language: string;
  content: string;
  type: 'code' | 'sql' | 'diff' | 'document' | 'config';
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_type: 'user' | 'agent' | 'system' | 'tool';
  content: string;
  thinking?: string;
  thought_duration_seconds?: number;
  tool_calls?: MessageToolCall[];
  artifacts?: MessageArtifact[];
  attachments?: string[];
  tokens_used: number;
  created_at: string;
  is_streaming?: boolean;
}


export interface AttachedFile {
  id: string;
  r2_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  size?: string;
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
  agent_name?: string;
  task_id?: string;
  task_title?: string;
  action: string;
  category: 'auth' | 'agent' | 'task' | 'approval' | 'file' | 'system' | 'runtime';
  details?: Record<string, unknown>;
  created_at: string;
}

export interface RuntimeConfig {
  endpoint_url: string;
  api_key_configured: boolean;
  timeout_seconds: number;
  max_retries: number;
  heartbeat_interval_seconds: number;
  is_online: boolean;
  last_ping_latency_ms?: number;
  node_id?: string;
  active_jobs?: number;
  capacity_percent?: number;
  engine_version?: string;
}

export interface SystemStats {
  total_agents: number;
  active_agents: number;
  total_tasks: number;
  running_tasks: number;
  pending_approvals: number;
  total_files: number;
  storage_bytes_used: number;
  runtime_status: 'healthy' | 'degraded' | 'offline';
}

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  email_verified: boolean;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface PasskeyItem {
  id: string;
  credential_name?: string;
  sign_count: number;
  created_at: string;
  last_used_at?: string;
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
  provider: WorkerProvider;
  user_id: string;
  organization_id?: string;
  worker_id?: string;
  external_session_id?: string;
  notebook_slug?: string;
  status: ComputeSessionStatus;
  error_message?: string;
  started_at?: string;
  stopped_at?: string;
  last_heartbeat_at?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WorkerOwnershipInfo {
  worker_id: string;
  owner_user_id: string;
  organization_id?: string;
  ownership_type: 'personal' | 'organization';
  claimed_at: string;
  owner_name?: string;
}

export interface KaggleCredentialsStatus {
  configured: boolean;
  kaggle_username?: string;
  last_updated_at?: string;
}

