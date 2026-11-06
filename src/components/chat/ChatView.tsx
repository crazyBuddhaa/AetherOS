import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { dbStorage } from '../../services/db-storage';
import { runtimeEngine } from '../../services/runtime-engine';
import { Conversation, Message, Agent, MessageArtifact } from '../../types';
import { 
  Send, 
  Paperclip, 
  Plus, 
  Bot, 
  User, 
  Terminal, 
  FileText, 
  Pin, 
  Check, 
  Clock, 
  X, 
  Copy, 
  Sparkles, 
  Workflow, 
  ChevronRight, 
  ChevronDown, 
  UploadCloud, 
  Brain, 
  Code2, 
  FileCode, 
  Square, 
  SlidersHorizontal, 
  ExternalLink, 
  Download, 
  Layers, 
  Trash2, 
  RotateCw 
} from 'lucide-react';

export const ChatView: React.FC<{ onConvertMessageToTask?: (content: string, agentId: string) => void }> = ({
  onConvertMessageToTask,
}) => {
  const { 
    agents, 
    conversations, 
    selectedConversationId, 
    setSelectedConversationId,
    uploadFile,
    showNotification,
  } = useApp();

  const activeAgents = agents.filter(a => a.is_enabled);
  const [currentConvId, setCurrentConvId] = useState<string>(
    selectedConversationId || conversations[0]?.id || ''
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    activeAgents[0]?.id || ''
  );

  // Streaming & Thinking states
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinkingPhase, setIsThinkingPhase] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingThought, setStreamingThought] = useState('');
  const [deepThinkingMode, setDeepThinkingMode] = useState(true);

  // Artifact Viewer (Canvas split panel)
  const [activeArtifact, setActiveArtifact] = useState<MessageArtifact | null>(null);

  // System Instructions Drawer
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  // File uploads
  const [attachedFiles, setAttachedFiles] = useState<{ id: string; name: string; size: number }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // UI state
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load conversation and messages
  useEffect(() => {
    if (currentConvId) {
      const msgs = dbStorage.getMessages(currentConvId);
      setMessages(msgs);
      const conv = conversations.find(c => c.id === currentConvId);
      if (conv && conv.agent_id) {
        setSelectedAgentId(conv.agent_id);
      }
    }
  }, [currentConvId, conversations]);

  // Auto-scroll on new tokens
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, streamingThought]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [inputPrompt]);

  const activeAgent: Agent | undefined = agents.find(a => a.id === selectedAgentId) || activeAgents[0];

  const getAgentForMessage = (msg: Message): Agent => {
    const conv = conversations.find(c => c.id === msg.conversation_id);
    const agentId = conv?.agent_id || selectedAgentId;
    return agents.find(a => a.id === agentId) || activeAgent || agents[0];
  };

  const toggleThoughtExpand = (msgId: string) => {
    setExpandedThoughts(prev => ({
      ...prev,
      [msgId]: prev[msgId] === undefined ? false : !prev[msgId],
    }));
  };

  const toggleToolExpand = (toolKey: string) => {
    setExpandedTools(prev => ({
      ...prev,
      [toolKey]: !prev[toolKey],
    }));
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeId(id);
    showNotification('Copied to clipboard', 'success');
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const handleCreateNewConversation = () => {
    const newConvId = `conv_${Date.now()}`;
    const newConv: Conversation = {
      id: newConvId,
      user_id: 'usr_admin',
      agent_id: activeAgent?.id,
      agent_name: activeAgent?.name,
      agent_avatar_color: activeAgent?.avatar_color,
      title: `Session with ${activeAgent?.name || 'Agent'}`,
      is_pinned: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      message_count: 0,
    };
    dbStorage.saveConversation(newConv);
    setCurrentConvId(newConvId);
    setSelectedConversationId(newConvId);
    setMessages([]);
    setActiveArtifact(null);
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const promptToSend = customPrompt || inputPrompt;
    if ((!promptToSend.trim() && attachedFiles.length === 0) || isStreaming || !activeAgent) return;

    let convId = currentConvId;
    if (!convId) {
      convId = `conv_${Date.now()}`;
      const newConv: Conversation = {
        id: convId,
        user_id: 'usr_admin',
        agent_id: activeAgent.id,
        agent_name: activeAgent.name,
        agent_avatar_color: activeAgent.avatar_color,
        title: promptToSend.slice(0, 32) || 'New Conversation',
        is_pinned: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      dbStorage.saveConversation(newConv);
      setCurrentConvId(convId);
    }

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      conversation_id: convId,
      sender_type: 'user',
      content: promptToSend.trim(),
      attachments: attachedFiles.map(f => f.name),
      tokens_used: Math.round(promptToSend.length / 4),
      created_at: new Date().toISOString(),
    };

    dbStorage.addMessage(userMessage);
    setMessages(prev => [...prev, userMessage]);
    setInputPrompt('');
    setAttachedFiles([]);
    setIsStreaming(true);
    setIsThinkingPhase(deepThinkingMode);
    setStreamingText('');
    setStreamingThought('');

    try {
      const finalMsg = await runtimeEngine.streamChatMessage(
        convId,
        promptToSend,
        activeAgent,
        chunk => {
          setIsThinkingPhase(false);
          setStreamingText(chunk);
        },
        thought => {
          setStreamingThought(thought);
        }
      );
      const updated = dbStorage.getMessages(convId);
      setMessages(updated);

      // Auto-preview artifact if generated
      if (finalMsg.artifacts && finalMsg.artifacts.length > 0) {
        setActiveArtifact(finalMsg.artifacts[0]);
      }
    } catch {
      showNotification('Inference streaming error', 'error');
    } finally {
      setIsStreaming(false);
      setIsThinkingPhase(false);
      setStreamingText('');
      setStreamingThought('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const uploaded = await uploadFile(files[i], undefined, currentConvId);
        setAttachedFiles(prev => [...prev, { id: uploaded.id, name: uploaded.filename, size: uploaded.size_bytes }]);
      }
    } catch {
      showNotification('Failed to upload file to Cloudflare R2', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Render stylized markdown content
  const renderFormattedContent = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, idx) => {
      // Header 3
      if (line.startsWith('### ')) {
        return (
          <h4 key={idx} className="text-sm font-bold text-slate-900 dark:text-white mt-3 mb-1">
            {line.replace('### ', '')}
          </h4>
        );
      }
      // Header 2
      if (line.startsWith('## ')) {
        return (
          <h3 key={idx} className="text-base font-bold text-slate-900 dark:text-white mt-4 mb-2">
            {line.replace('## ', '')}
          </h3>
        );
      }
      // Bullet list
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        return (
          <div key={idx} className="flex items-start gap-2 my-1 pl-1">
            <span className="text-blue-500 font-bold">·</span>
            <span>{line.replace(/^[-*]\s*/, '')}</span>
          </div>
        );
      }
      // Numbered list
      if (/^\d+\.\s/.test(line.trim())) {
        return (
          <div key={idx} className="flex items-start gap-2 my-1 pl-1">
            <span className="text-blue-500 font-mono text-[11px] font-semibold">{line.split('.')[0]}.</span>
            <span>{line.replace(/^\d+\.\s*/, '')}</span>
          </div>
        );
      }
      // Plain line
      return line ? (
        <p key={idx} className="my-1">
          {line}
        </p>
      ) : (
        <div key={idx} className="h-2" />
      );
    });
  };

  return (
    <div 
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={async e => {
        e.preventDefault();
        setIsDragOver(false);
        await handleFileUpload(e.dataTransfer.files);
      }}
      className="relative h-[calc(100vh-8.5rem)] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs overflow-hidden"
    >
      {/* Drag & Drop Visual Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-blue-600/15 backdrop-blur-xs border-2 border-dashed border-blue-500 rounded-xl flex items-center justify-center p-6 pointer-events-none">
          <div className="text-center bg-white dark:bg-slate-900 p-6 rounded-xl shadow-xl border border-blue-200 dark:border-blue-800">
            <UploadCloud className="w-10 h-10 text-blue-500 mx-auto mb-2 animate-bounce" />
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Drop files to attach to Cloudflare R2
            </p>
          </div>
        </div>
      )}

      {/* Top Studio Control Bar (Google AI Studio & OpenCode style) */}
      <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/70 flex items-center justify-between gap-4 shrink-0 text-xs">
        <div className="flex items-center gap-3 min-w-0">
          {/* Agent Color Dot & Name */}
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
              style={{ backgroundColor: activeAgent?.avatar_color || '#2563EB' }}
            />

            <select
              value={selectedAgentId}
              onChange={e => setSelectedAgentId(e.target.value)}
              className="text-xs font-semibold bg-transparent text-slate-900 dark:text-white border-0 focus:outline-none cursor-pointer pr-1"
            >
              {activeAgents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

          {/* Model Badge */}
          <div className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            <span>Model:</span>
            <span className="font-semibold text-slate-700 dark:text-slate-200">{activeAgent?.model}</span>
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800 hidden md:block" />

          {/* Deep Reasoning Mode Toggle */}
          <button
            onClick={() => setDeepThinkingMode(!deepThinkingMode)}
            className={`hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              deepThinkingMode
                ? 'bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300'
                : 'text-slate-400 hover:text-slate-600'
            }`}
            title="Enable Deep Thinking & Chain of Thought Reasoning"
          >
            <Brain className="w-3.5 h-3.5" />
            <span>Deep Reasoning: {deepThinkingMode ? 'On' : 'Off'}</span>
          </button>
        </div>

        {/* Studio Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowSystemPrompt(!showSystemPrompt)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
              showSystemPrompt
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">System Instructions</span>
          </button>

          <button
            onClick={handleCreateNewConversation}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>
        </div>
      </div>

      {/* Collapsible System Instructions Drawer (AI Studio Style) */}
      {showSystemPrompt && (
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-950/90 text-xs animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-semibold uppercase tracking-wider text-[10px] text-slate-500">
              Active Agent System Instructions (Prompt Boundary)
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              Temperature: {activeAgent?.temperature} · Max Tokens: {activeAgent?.max_tokens}
            </span>
          </div>
          <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[11px] whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
            {activeAgent?.system_instructions}
          </div>
        </div>
      )}

      {/* Main Workspace (Split view: Chat Stream on Left, Artifact Canvas on Right) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chat Thread */}
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-slate-900">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            {messages.length === 0 && !isStreaming && (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
                <div 
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-bold shadow-md mb-3"
                  style={{ backgroundColor: activeAgent?.avatar_color || '#2563EB' }}
                >
                  {activeAgent?.name ? activeAgent.name.charAt(0) : 'Æ'}
                </div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  {activeAgent?.name || 'Inference Chat Console'}
                </h3>
                <p className="text-xs mt-1 text-slate-400 max-w-sm">
                  {activeAgent
                    ? `Autonomous inference session with ${activeAgent.model}. Workloads dispatch to connected compute workers.`
                    : 'Create an autonomous agent or connect a compute worker to run local model inference.'}
                </p>

                {/* Natural Prompt Starters */}
                <div className="mt-5 w-full space-y-2 text-left">
                  {[
                    'Analyze slow queries on Cloudflare D1 weather_records table',
                    'Plan a Parquet schema migration with ZSTD compression',
                    'Probe edge worker latency across European regions',
                  ].map((suggestion, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(suggestion)}
                      className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 bg-slate-50/50 dark:bg-slate-950/40 hover:bg-blue-50/30 dark:hover:bg-blue-950/30 text-xs text-slate-700 dark:text-slate-300 transition-all flex items-center justify-between group shadow-2xs"
                    >
                      <span className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="truncate">{suggestion}</span>
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 transition-colors shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Rendered Messages */}
            {messages.map(msg => {
              const isUser = msg.sender_type === 'user';
              const isThoughtOpen = expandedThoughts[msg.id] !== false;
              const msgAgent = getAgentForMessage(msg);
              const agentColor = msgAgent?.avatar_color || activeAgent?.avatar_color || '#2563EB';
              const agentName = msgAgent?.name || activeAgent?.name || 'Agent';

              return isUser ? (
                /* User Message (Clean, right-aligned, no avatar icon box) */
                <div key={msg.id} className="ml-auto w-fit max-w-[85%] sm:max-w-2xl space-y-1">
                  <div className="bg-blue-600 text-white rounded-2xl rounded-tr-xs px-4 py-2.5 text-xs leading-relaxed shadow-sm">
                    <p className="whitespace-pre-wrap">{msg.content}</p>

                    {/* Attached files */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-white/20 flex flex-wrap gap-1.5">
                        {msg.attachments.map((att, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/15 text-[11px] font-mono"
                          >
                            <FileText className="w-3 h-3 text-white/80" />
                            <span>{att}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2 text-[10px] text-slate-400 font-mono pr-1">
                    <span className="tabular-nums">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span>·</span>
                    <span className="tabular-nums">{msg.tokens_used} tokens</span>
                  </div>
                </div>
              ) : (
                /* Agent Message (No avatar icon box, distinct agent color theme) */
                <div key={msg.id} className="mr-auto w-full max-w-3xl space-y-2 group">
                  {/* Agent Identity Header in Agent's own color */}
                  <div className="flex items-center gap-2 px-1">
                    <span
                      className="w-2 h-2 rounded-full shrink-0 shadow-xs"
                      style={{ backgroundColor: agentColor }}
                    />
                    <span
                      className="font-semibold text-xs tracking-tight"
                      style={{ color: agentColor }}
                    >
                      {agentName}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      · {msgAgent?.model || activeAgent?.model}
                    </span>
                  </div>

                  {/* Collapsible Thinking Process with agent color accent */}
                  {msg.thinking && (
                    <div
                      className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 overflow-hidden text-xs"
                      style={{ borderLeftColor: agentColor, borderLeftWidth: '3px' }}
                    >
                      <button
                        onClick={() => toggleThoughtExpand(msg.id)}
                        className="w-full px-3 py-2 flex items-center justify-between text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <Brain className="w-3.5 h-3.5" style={{ color: agentColor }} />
                          <span>
                            Thinking Process {msg.thought_duration_seconds ? `(${msg.thought_duration_seconds}s)` : ''}
                          </span>
                        </span>
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <span>{isThoughtOpen ? 'Hide' : 'Show'}</span>
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isThoughtOpen ? 'rotate-180' : ''}`} />
                        </span>
                      </button>

                      {isThoughtOpen && (
                        <div className="px-3 pb-3 text-[11px] font-mono text-slate-600 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800/80 pt-2 whitespace-pre-wrap leading-relaxed">
                          {msg.thinking}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Content Box with agent's distinct left border color */}
                  <div
                    className="relative p-4 rounded-xl text-xs leading-relaxed border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 text-slate-900 dark:text-slate-100 shadow-2xs"
                    style={{ borderLeftColor: agentColor, borderLeftWidth: '3px' }}
                  >
                    <div className="space-y-1">
                      {renderFormattedContent(msg.content)}
                    </div>

                    {/* Tool Calls Cards */}
                    {msg.tool_calls && msg.tool_calls.length > 0 && (
                      <div className="mt-3 space-y-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
                        {msg.tool_calls.map((tool, idx) => {
                          const toolKey = `${msg.id}_tool_${idx}`;
                          const isToolOpen = expandedTools[toolKey] !== false;

                          return (
                            <div
                              key={idx}
                              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden text-xs"
                            >
                              <button
                                type="button"
                                onClick={() => toggleToolExpand(toolKey)}
                                className="w-full px-3 py-2 flex items-center justify-between text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <Terminal className="w-3.5 h-3.5" style={{ color: agentColor }} />
                                  <span className="font-mono font-semibold truncate" style={{ color: agentColor }}>
                                    {tool.tool_name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[10px] font-mono">
                                    <Check className="w-3 h-3" />
                                    <span>Success</span>
                                  </span>
                                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isToolOpen ? 'rotate-180' : ''}`} />
                                </div>
                              </button>

                              {isToolOpen && (
                                <div className="p-3 border-t border-slate-100 dark:border-slate-800 space-y-2 bg-slate-950 font-mono text-[11px]">
                                  <div>
                                    <span className="text-slate-500 text-[10px] block">Input Parameters:</span>
                                    <pre className="text-slate-300 overflow-x-auto mt-0.5">
                                      {JSON.stringify(tool.input, null, 2)}
                                    </pre>
                                  </div>
                                  {tool.output && (
                                    <div className="pt-2 border-t border-slate-800">
                                      <span className="text-slate-500 text-[10px] block">Result Payload:</span>
                                      <pre className="text-emerald-400 overflow-x-auto mt-0.5">
                                        {JSON.stringify(tool.output, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Generated Artifacts Pills */}
                    {msg.artifacts && msg.artifacts.length > 0 && (
                      <div className="mt-3 space-y-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
                          Generated Artifacts ({msg.artifacts.length})
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {msg.artifacts.map((art, idx) => (
                            <button
                              key={idx}
                              onClick={() => setActiveArtifact(art)}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all shadow-2xs ${
                                activeArtifact?.title === art.title
                                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold ring-1 ring-blue-500'
                                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:border-blue-400'
                              }`}
                            >
                              <Code2 className="w-3.5 h-3.5 text-blue-500" />
                              <span>{art.title}</span>
                              <ExternalLink className="w-3 h-3 text-slate-400" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Attached Files Badges */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-200/50 dark:border-slate-800/80 flex flex-wrap gap-2">
                        {msg.attachments.map((att, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/10 dark:bg-white/10 text-[11px] font-mono"
                          >
                            <FileText className="w-3 h-3 text-blue-400" />
                            <span>{att}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Floating Action Bar on Hover */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -bottom-3 right-3 flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-1.5 py-0.5 shadow-sm text-[11px]">
                      <button
                        onClick={() => handleCopy(msg.content, msg.id)}
                        className="p-1 hover:text-blue-600 dark:hover:text-blue-400 text-slate-500 transition-colors"
                        title="Copy response"
                      >
                        {copiedCodeId === msg.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      </button>

                      <button
                        onClick={() => {
                          if (onConvertMessageToTask && msgAgent) {
                            onConvertMessageToTask(msg.content, msgAgent.id);
                          }
                        }}
                        className="p-1 hover:text-blue-600 dark:hover:text-blue-400 text-slate-500 transition-colors flex items-center gap-1"
                        title="Convert into Autonomous Task"
                      >
                        <Workflow className="w-3 h-3" />
                        <span className="text-[10px]">Make Task</span>
                      </button>
                    </div>
                  </div>

                  {/* Metadata line */}
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono px-1">
                    <span className="tabular-nums">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span>·</span>
                    <span className="tabular-nums">{msg.tokens_used} tokens</span>
                  </div>
                </div>
              );
            })}

            {/* Live Streaming Indicator (No avatar icon box, active agent color accent) */}
            {isStreaming && (
              <div className="mr-auto w-full max-w-3xl space-y-2">
                {/* Active Agent Identity in their color */}
                <div className="flex items-center gap-2 px-1">
                  <span
                    className="w-2 h-2 rounded-full shrink-0 shadow-xs animate-pulse"
                    style={{ backgroundColor: activeAgent?.avatar_color || '#2563EB' }}
                  />
                  <span
                    className="font-semibold text-xs tracking-tight"
                    style={{ color: activeAgent?.avatar_color || '#2563EB' }}
                  >
                    {activeAgent?.name || 'Agent'}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    · {activeAgent?.model} · Generating...
                  </span>
                </div>

                {/* Live Thinking Phase with agent-colored accent */}
                {isThinkingPhase && streamingThought && (
                  <div
                    className="p-3 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 text-xs animate-pulse"
                    style={{ borderLeftColor: activeAgent?.avatar_color || '#2563EB', borderLeftWidth: '3px' }}
                  >
                    <div
                      className="flex items-center gap-2 font-medium mb-1"
                      style={{ color: activeAgent?.avatar_color || '#2563EB' }}
                    >
                      <Brain className="w-3.5 h-3.5 animate-spin" />
                      <span>Thinking...</span>
                    </div>
                    <p className="font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                      {streamingThought}
                    </p>
                  </div>
                )}

                {/* Streaming Response Content with agent-colored accent */}
                {streamingText && (
                  <div
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 text-slate-900 dark:text-slate-100 text-xs leading-relaxed shadow-2xs"
                    style={{ borderLeftColor: activeAgent?.avatar_color || '#2563EB', borderLeftWidth: '3px' }}
                  >
                    <p className="whitespace-pre-wrap">{streamingText}</p>
                    <span
                      className="inline-block w-1.5 h-3.5 ml-1 animate-pulse"
                      style={{ backgroundColor: activeAgent?.avatar_color || '#2563EB' }}
                    />
                  </div>
                )}

                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono px-1">
                  <Clock className="w-3 h-3 animate-spin" style={{ color: activeAgent?.avatar_color || '#2563EB' }} />
                  <span>Inference engine running · ~42 tokens/s</span>
                </div>
              </div>
            )}


            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Prompt Composer (AI Studio / OpenCode style) */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
            {/* Attached Files Chips */}
            {attachedFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachedFiles.map(file => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300 font-mono shadow-2xs"
                  >
                    <FileText className="w-3.5 h-3.5 text-blue-500" />
                    <span className="truncate max-w-[150px]">{file.name}</span>
                    <button
                      onClick={() => setAttachedFiles(prev => prev.filter(f => f.id !== file.id))}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Composer Box */}
            <div className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all">
              <textarea
                ref={textareaRef}
                value={inputPrompt}
                onChange={e => setInputPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={`Ask ${activeAgent?.name || 'agent'} to analyze, code, query D1, or orchestrate...`}
                className="w-full px-4 pt-3 pb-1 text-xs resize-none bg-transparent outline-none text-slate-900 dark:text-white placeholder-slate-400 font-sans"
              />

              {/* Bottom Toolbar inside composer */}
              <div className="px-3 py-2 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800/60">
                <div className="flex items-center gap-1.5">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={e => handleFileUpload(e.target.files)}
                    multiple
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-2 py-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 text-xs rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Attach file to Cloudflare R2"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Attach</span>
                  </button>

                  <div className="h-3 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

                  {/* Model Chip */}
                  <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                    {activeAgent?.model}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 font-mono hidden sm:inline tabular-nums">
                    {inputPrompt.length} chars
                  </span>

                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={() => setIsStreaming(false)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors shadow-2xs"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!inputPrompt.trim() && attachedFiles.length === 0}
                      onClick={() => handleSendMessage()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors shadow-2xs"
                    >
                      <span>Send</span>
                      <Send className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
              <span>⏎ to send · Shift+⏎ for newline · Drag files anywhere to upload to R2</span>
              <span className="font-mono">Self-Hosted Inference Engine</span>
            </div>
          </div>
        </div>

        {/* Right: Artifact / Code Canvas Panel (AI Studio / OpenCode Canvas) */}
        {activeArtifact && (
          <div className="w-80 md:w-96 border-l border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/80 flex flex-col shrink-0 animate-in slide-in-from-right-4 duration-200">
            {/* Canvas Header */}
            <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2 min-w-0">
                <FileCode className="w-4 h-4 text-blue-500 shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                    {activeArtifact.title}
                  </h3>
                  <span className="text-[10px] font-mono text-slate-400 uppercase">
                    {activeArtifact.language} · Artifact Canvas
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleCopy(activeArtifact.content, 'canvas')}
                  className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Copy code"
                >
                  {copiedCodeId === 'canvas' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>

                <button
                  onClick={() => setActiveArtifact(null)}
                  className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Close artifact"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Code Body */}
            <div className="flex-1 p-4 bg-slate-950 font-mono text-xs text-slate-300 overflow-y-auto overflow-x-auto leading-relaxed border-t border-slate-800">
              <pre>{activeArtifact.content}</pre>
            </div>

            {/* Canvas Footer Actions */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between text-xs">
              <span className="text-[11px] font-mono text-slate-400">
                {activeArtifact.content.split('\n').length} lines
              </span>

              <button
                onClick={() => {
                  if (onConvertMessageToTask && activeAgent) {
                    onConvertMessageToTask(activeArtifact.content, activeAgent.id);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-2xs transition-colors"
              >
                <Workflow className="w-3.5 h-3.5" />
                <span>Run as Task</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
