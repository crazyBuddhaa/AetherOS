/**
 * Google AI Studio Coding Assistant Engine for AetherOS
 * Powers conversational coding, model selection, external API routing,
 * repository introspection, and Model Context Protocol (MCP) tool execution.
 */

import { GoogleGenAI } from '@google/genai';
import { mcpManager } from './mcp-service.ts';
import { getGitStatus, readRepoFile, getRepoTree } from './repo-git-service.ts';

export interface ChatMessagePayload {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ExternalApiConfig {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiStudioChatRequest {
  message: string;
  history?: ChatMessagePayload[];
  model?: string;
  externalApi?: ExternalApiConfig;
  currentFile?: {
    path: string;
    content: string;
    language?: string;
  };
  enabledMcpServers?: string[];
  systemInstructions?: string;
}

export interface AiStudioChatResponse {
  response: string;
  model: string;
  provider: 'gemini' | 'external' | 'local_fallback' | 'kaggle';
  tool_calls_executed?: Array<{
    name: string;
    args: Record<string, any>;
    result: any;
    error?: string;
  }>;
  tokens_used?: number;
  git_status?: any;
}

export const AVAILABLE_MODELS = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash (Google AI Studio)',
    provider: 'gemini',
    description: 'Fast, high-fidelity multimodal coding and architectural reasoning',
    isDefault: true,
    capabilities: ['Code synthesis', 'Repo navigation', 'MCP Tools', 'Git ops'],
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    provider: 'gemini',
    description: 'Ultra-low latency model for fast code completions and quick questions',
    capabilities: ['Fast completions', 'Syntax inspection'],
  },
  {
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon (Advanced Reasoning)',
    provider: 'gemini',
    description: 'Deep architectural refactoring, algorithmic analysis, and complex code reviews',
    capabilities: ['Complex algorithms', 'Deep refactoring', 'Architecture'],
  },
  {
    id: 'qwen-2.5-coder-14b',
    name: 'Qwen 2.5 Coder 14B (Kaggle GPU)',
    provider: 'kaggle',
    description: 'Distributed PyTorch model running on Dual NVIDIA Tesla T4 (32GB VRAM)',
    capabilities: ['Local GPU', 'Zero external API calls'],
  },
  {
    id: 'external-api',
    name: 'External Provider / Custom Model Endpoint',
    provider: 'external',
    description: 'Connect custom OpenAI-compatible endpoint, Anthropic, or external inference gateway',
    capabilities: ['Custom endpoints', 'User-supplied keys'],
  },
];

export async function processAiStudioChat(req: AiStudioChatRequest): Promise<AiStudioChatResponse> {
  const selectedModelId = req.model || 'gemini-3.8-flash';
  const apiKey = req.externalApi?.apiKey || process.env.GEMINI_API_KEY;

  // Gather workspace context
  const gitStatus = await getGitStatus();
  const executedToolCalls: Array<{
    name: string;
    args: Record<string, any>;
    result: any;
    error?: string;
  }> = [];

  // 1. Tool intent detection (Automatic MCP tool execution if requested in user prompt)
  const lowerMsg = req.message.toLowerCase();
  
  // If user asks about git status/diff or repo files:
  if (lowerMsg.includes('git status') || lowerMsg.includes('what changed') || lowerMsg.includes('uncommitted')) {
    const res = await mcpManager.executeTool('git_status', {});
    executedToolCalls.push({ name: 'git_status', args: {}, result: res.result });
  } else if (lowerMsg.includes('git diff') || lowerMsg.includes('show diff')) {
    const res = await mcpManager.executeTool('git_diff', {});
    executedToolCalls.push({ name: 'git_diff', args: {}, result: res.result });
  } else if (lowerMsg.includes('list files') || lowerMsg.includes('repo tree') || lowerMsg.includes('file structure')) {
    const res = await mcpManager.executeTool('list_directory', { max_depth: 3 });
    executedToolCalls.push({ name: 'list_directory', args: { max_depth: 3 }, result: res.result });
  }

  // 2. Route to External Provider if requested
  if (selectedModelId === 'external-api' && req.externalApi?.endpoint) {
    return handleExternalApi(req, gitStatus, executedToolCalls);
  }

  // 3. Route to Gemini API via @google/genai SDK
  if (selectedModelId.startsWith('gemini-') && apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      // Construct contextual system instructions
      const systemInstruction = `You are the Google AI Studio assistant embedded inside AetherOS.
You assist developers in writing code, understanding repository structure, modifying files, executing git workflows, and managing Model Context Protocol (MCP) integrations.
Current Branch: ${gitStatus.branch}
Clean Working Tree: ${gitStatus.clean ? 'Yes' : 'No'}
Modified Files: ${gitStatus.modified.join(', ') || 'None'}
Staged Files: ${gitStatus.staged.join(', ') || 'None'}

When writing code, always specify the file path in comments or fenced blocks like:
\`\`\`typescript:src/example.ts
// code here
\`\`\`
Give clear, concise, actionable advice. Follow idiomatic TypeScript/React and modern Cloudflare Workers patterns.`;

      // Build contents
      const parts: any[] = [];

      // Include current editor file in context if provided
      if (req.currentFile && req.currentFile.path) {
        parts.push({
          text: `[Active File in Editor: ${req.currentFile.path} (${req.currentFile.language || 'code'})]\n\`\`\`${req.currentFile.language || ''}\n${req.currentFile.content.slice(0, 10000)}\n\`\`\`\n`,
        });
      }

      // Include pre-executed MCP tool results
      if (executedToolCalls.length > 0) {
        parts.push({
          text: `[Executed Workspace MCP Tools]:\n${JSON.stringify(executedToolCalls, null, 2)}\n`,
        });
      }

      // Add user prompt
      parts.push({ text: req.message });

      const response = await ai.models.generateContent({
        model: selectedModelId,
        contents: parts,
        config: {
          systemInstruction,
          temperature: req.externalApi?.temperature ?? 0.4,
          maxOutputTokens: req.externalApi?.maxTokens ?? 3000,
        },
      });

      const replyText = response.text || 'Code generated successfully.';

      return {
        response: replyText,
        model: selectedModelId,
        provider: 'gemini',
        tool_calls_executed: executedToolCalls,
        tokens_used: Math.round((replyText.length + req.message.length) / 4),
        git_status: gitStatus,
      };
    } catch (err: any) {
      console.error('Gemini API call error:', err);
      // Fallback with informative error
      return {
        response: `### AI Studio Assistant Response\n\n**Note**: Encountered an issue connecting to \`${selectedModelId}\`: ${err.message}.\n\nYou can configure an alternative API key or custom endpoint in the **Model & API Settings** panel, or switch models.`,
        model: selectedModelId,
        provider: 'local_fallback',
        tool_calls_executed: executedToolCalls,
        git_status: gitStatus,
      };
    }
  }

  // 4. Fallback / Local Assistant if no API key is configured yet
  const fallbackMessage = generateLocalAssistantResponse(req, gitStatus, executedToolCalls);
  return {
    response: fallbackMessage,
    model: selectedModelId,
    provider: 'local_fallback',
    tool_calls_executed: executedToolCalls,
    git_status: gitStatus,
  };
}

async function handleExternalApi(
  req: AiStudioChatRequest,
  gitStatus: any,
  toolCalls: any[]
): Promise<AiStudioChatResponse> {
  const config = req.externalApi;
  if (!config?.endpoint) {
    return {
      response: 'External API endpoint is not configured. Please enter your endpoint URL in the Model Settings modal.',
      model: 'external-api',
      provider: 'external',
      git_status: gitStatus,
    };
  }

  try {
    const payload = {
      model: config.model || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are the AetherOS Google AI Studio coding engine. Branch: ${gitStatus.branch}. Help the user write code and navigate their repo.`,
        },
        ...(req.history || []).map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: req.message },
      ],
      temperature: config.temperature ?? 0.4,
      max_tokens: config.maxTokens ?? 2048,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey.trim()}`;
    }

    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`External API returned HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data: any = await res.json();
    const reply = data.choices?.[0]?.message?.content || data.response || JSON.stringify(data);

    return {
      response: reply,
      model: config.model || 'external-api',
      provider: 'external',
      tool_calls_executed: toolCalls,
      tokens_used: data.usage?.total_tokens || Math.round(reply.length / 4),
      git_status: gitStatus,
    };
  } catch (err: any) {
    return {
      response: `External API call failed: ${err.message}. Please check your endpoint URL and credentials.`,
      model: 'external-api',
      provider: 'external',
      tool_calls_executed: toolCalls,
      git_status: gitStatus,
    };
  }
}

function generateLocalAssistantResponse(
  req: AiStudioChatRequest,
  gitStatus: any,
  toolCalls: any[]
): string {
  const activeFileName = req.currentFile?.path || 'workspace';
  return `### Google AI Studio Assistant (AetherOS)

I'm ready to inspect your repository, write code, execute git pushes, and call MCP tools.

* **Current Repository Branch:** \`${gitStatus.branch}\`
* **Working Tree:** ${gitStatus.clean ? '✅ Clean' : `⚠️ ${gitStatus.modified.length} modified, ${gitStatus.untracked.length} untracked`}
* **Active Open File:** \`${activeFileName}\`
${toolCalls.length > 0 ? `* **Executed MCP Tools:** ${toolCalls.map((t) => `\`${t.name}\``).join(', ')}` : ''}

> **Quick Tip:** To enable live **Gemini 3.8 Flash** or **Gemini 4 Argon** responses, verify your \`GEMINI_API_KEY\` in your environment or click **Model & API Settings** in the top bar to supply an external API endpoint or key.

You can ask me to:
1. **"Read repo files"** or **"Search for functions"** using the Filesystem MCP
2. **"Commit and push changes to git"** using the Git Operations MCP
3. **"Refactor the current open file"** with automated code generation!`;
}
