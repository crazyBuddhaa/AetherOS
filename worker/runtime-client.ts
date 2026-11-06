import type {
  Env,
  RuntimeSubmissionRequest,
  RuntimeSubmissionResponse,
  RuntimeStatusResponse,
  RuntimeHeartbeatResponse,
} from './types.ts';

/**
 * Provider-Independent External Inference Runtime Client
 * Handles authenticated communication with self-hosted AI inference infrastructure.
 */
export class ExternalInferenceRuntimeClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(env: Env) {
    this.baseUrl = (env.INFERENCE_RUNTIME_URL || '').replace(/\/$/, '');
    this.apiKey = env.RUNTIME_API_KEY;
    this.timeoutMs = parseInt(env.INFERENCE_RUNTIME_TIMEOUT_MS || '30000', 10);
    this.maxRetries = parseInt(env.INFERENCE_RUNTIME_MAX_RETRIES || '3', 10);
  }

  private getHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Client-Version': 'aetheros-worker/1.0.0',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  private async fetchWithRetry<T>(
    endpoint: string,
    options: RequestInit,
    retryCount = 0
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...this.getHeaders(),
          ...(options.headers || {}),
        },
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown server error');
        throw new Error(`Inference runtime error (${response.status}): ${errorText}`);
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort = (err as Error)?.name === 'AbortError';
      const errorMessage = isAbort
        ? `Request timeout after ${this.timeoutMs}ms`
        : (err as Error)?.message || 'Network error';

      if (retryCount < this.maxRetries && !isAbort) {
        const delayMs = Math.pow(2, retryCount) * 1000 + Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.fetchWithRetry<T>(endpoint, options, retryCount + 1);
      }

      throw new Error(`External runtime call failed [${endpoint}]: ${errorMessage}`);
    }
  }

  async submitTask(request: RuntimeSubmissionRequest): Promise<RuntimeSubmissionResponse> {
    return this.fetchWithRetry<RuntimeSubmissionResponse>('/v1/tasks/submit', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getTaskStatus(externalTaskId: string): Promise<RuntimeStatusResponse> {
    return this.fetchWithRetry<RuntimeStatusResponse>(
      `/v1/tasks/${encodeURIComponent(externalTaskId)}/status`,
      {
        method: 'GET',
      }
    );
  }

  async checkHeartbeat(): Promise<RuntimeHeartbeatResponse> {
    return this.fetchWithRetry<RuntimeHeartbeatResponse>('/v1/health/heartbeat', {
      method: 'GET',
    });
  }

  async cancelTask(externalTaskId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    return this.fetchWithRetry<{ success: boolean; message: string }>(
      `/v1/tasks/${encodeURIComponent(externalTaskId)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({ reason: reason || 'Cancelled by user' }),
      }
    );
  }

  async reportError(
    externalTaskId: string,
    errorPayload: { code: string; message: string; stack?: string }
  ): Promise<void> {
    await this.fetchWithRetry<void>(`/v1/tasks/${encodeURIComponent(externalTaskId)}/errors`, {
      method: 'POST',
      body: JSON.stringify(errorPayload),
    });
  }

  async deliverApproval(
    externalTaskId: string,
    approvalData: { approval_id: string; decision: 'approved' | 'rejected'; review_comment?: string }
  ): Promise<{ resumed: boolean }> {
    return this.fetchWithRetry<{ resumed: boolean }>(
      `/v1/tasks/${encodeURIComponent(externalTaskId)}/approvals/resume`,
      {
        method: 'POST',
        body: JSON.stringify(approvalData),
      }
    );
  }
}
