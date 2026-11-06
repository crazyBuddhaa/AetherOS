import { dbStorage } from './db-storage';
import { apiClient } from './api-client';
import { Task, Message, Agent } from '../types';

/**
 * Runtime Execution Engine
 * Interfaces with Cloudflare Worker and distributed compute worker nodes (e.g. Kaggle dual-T4).
 */
class RuntimeEngine {
  /**
   * Ping inference runtime / active compute workers and return live status
   */
  async pingRuntime(customEndpoint?: string): Promise<{
    success: boolean;
    latencyMs: number;
    nodeId: string;
    engineVersion: string;
    error?: string;
  }> {
    const start = performance.now();
    const config = dbStorage.getRuntimeConfig();
    if (customEndpoint) {
      config.endpoint_url = customEndpoint;
    }

    try {
      const res = await fetch('/api/runtime/heartbeat');
      const latency = Math.max(1, Math.round(performance.now() - start));
      config.last_ping_latency_ms = latency;

      if (res.ok) {
        const data = (await res.json()) as {
          success: boolean;
          is_online?: boolean;
          provider?: string;
          heartbeat?: {
            node_id?: string;
            engine_version?: string;
            gpu_model?: string;
            gpu_count?: number;
          };
        };

        config.is_online = true;
        config.node_id = data.heartbeat?.node_id || '';
        config.engine_version =
          data.heartbeat?.engine_version ||
          (data.heartbeat?.gpu_model
            ? `${data.heartbeat.gpu_count || 1}× ${data.heartbeat.gpu_model}`
            : 'Distributed Worker');
        dbStorage.saveRuntimeConfig(config);

        return {
          success: true,
          latencyMs: latency,
          nodeId: config.node_id,
          engineVersion: config.engine_version,
        };
      } else {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        config.is_online = false;
        config.node_id = '';
        config.engine_version = '';
        dbStorage.saveRuntimeConfig(config);

        return {
          success: false,
          latencyMs: latency,
          nodeId: '',
          engineVersion: '',
          error: errData.error || 'No active compute workers connected',
        };
      }
    } catch (err: any) {
      const latency = Math.max(1, Math.round(performance.now() - start));
      config.is_online = false;
      config.last_ping_latency_ms = latency;
      config.node_id = '';
      config.engine_version = '';
      dbStorage.saveRuntimeConfig(config);

      return {
        success: false,
        latencyMs: latency,
        nodeId: '',
        engineVersion: '',
        error: err?.message || 'Connection failed',
      };
    }
  }

  /**
   * Submit autonomous task to real backend task queue
   */
  async submitTask(params: {
    agentId: string;
    title: string;
    description: string;
    inputPayload: Record<string, unknown>;
    priority: 'low' | 'medium' | 'high' | 'critical';
  }): Promise<Task> {
    return apiClient.submitTask(params);
  }

  /**
   * Resume a task after human approval has been granted
   */
  resumeTaskAfterApproval(_taskId: string) {
    // Task state is authoritative in D1; workers poll task state changes.
  }

  /**
   * Cancel task
   */
  cancelTask(taskId: string, reason = 'Cancelled by operator') {
    apiClient.cancelTask(taskId, reason).catch(() => {});
  }

  /**
   * Pause or resume task
   */
  toggleTaskPause(taskId: string) {
    apiClient.togglePauseTask(taskId).catch(() => {});
  }

  /**
   * Send real chat message to inference runtime
   */
  async streamChatMessage(
    conversationId: string,
    userContent: string,
    agent: Agent,
    onChunk: (chunk: string) => void,
    onThinkingChunk?: (thought: string) => void
  ): Promise<Message> {
    const response = await apiClient.sendChatMessage({
      message: userContent,
      conversation_id: conversationId,
      agent_id: agent.id,
      model: agent.model,
    });

    if (response.agent_message) {
      if (onThinkingChunk && response.agent_message.thinking) {
        onThinkingChunk(response.agent_message.thinking);
      }
      onChunk(response.agent_message.content);
      return response.agent_message;
    }

    if (response.task) {
      const text = `Task enqueued in distributed compute queue (#${response.task.id}). Assigned worker will claim and execute this inference workload.`;
      onChunk(text);
      const msg: Message = {
        id: `msg_${Date.now()}`,
        conversation_id: conversationId,
        sender_type: 'agent',
        content: text,
        tokens_used: 12,
        created_at: new Date().toISOString(),
      };
      dbStorage.addMessage(msg);
      return msg;
    }

    const fallbackText = response.error || 'No active compute workers are currently connected to execute inference.';
    onChunk(fallbackText);
    const msg: Message = {
      id: `msg_${Date.now()}`,
      conversation_id: conversationId,
      sender_type: 'agent',
      content: fallbackText,
      tokens_used: 0,
      created_at: new Date().toISOString(),
    };
    dbStorage.addMessage(msg);
    return msg;
  }
}

export const runtimeEngine = new RuntimeEngine();
