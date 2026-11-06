import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Agent, PermittedTool, RiskLevel } from '../../types';
import { StatusBadge, RiskBadge } from '../common/StatusBadge';
import { Modal } from '../common/Modal';
import { 
  Bot, 
  Plus, 
  Settings2, 
  Trash2, 
  Power, 
  ShieldCheck, 
  Wrench, 
  Terminal, 
  Cpu 
} from 'lucide-react';

const AVAILABLE_DEFAULT_TOOLS: PermittedTool[] = [
  {
    id: 'tool_d1_query',
    name: 'D1 SQL Query',
    description: 'Execute read-only SQL queries on Cloudflare D1 databases.',
    category: 'database',
    requires_approval: false,
    risk_level: 'low',
  },
  {
    id: 'tool_d1_migrate',
    name: 'D1 Schema Migration',
    description: 'Execute DDL statements or write operations on production tables.',
    category: 'database',
    requires_approval: true,
    risk_level: 'high',
  },
  {
    id: 'tool_r2_storage',
    name: 'Cloudflare R2 Object Store',
    description: 'Read and write analytical files to Cloudflare R2 buckets.',
    category: 'filesystem',
    requires_approval: false,
    risk_level: 'low',
  },
  {
    id: 'tool_bash_exec',
    name: 'Shell Command Runner',
    description: 'Run sandboxed CLI scripts for ETL orchestration.',
    category: 'execution',
    requires_approval: true,
    risk_level: 'critical',
  },
  {
    id: 'tool_web_crawl',
    name: 'Web Document Reader',
    description: 'Fetch and extract clean markdown from technical documentation and URLs.',
    category: 'retrieval',
    requires_approval: false,
    risk_level: 'low',
  },
  {
    id: 'tool_deploy_patch',
    name: 'Worker Route Deployer',
    description: 'Deploy hotfixes and update routing rules in production.',
    category: 'execution',
    requires_approval: true,
    risk_level: 'critical',
  },
];

export const AgentsView: React.FC<{ onNewTaskForAgent?: (agentId: string) => void }> = ({ onNewTaskForAgent }) => {
  const { agents, createAgent, updateAgent, deleteAgent, setActiveTab, setSelectedConversationId } = useApp();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('qwen-2.5-coder-14b');
  const [systemInstructions, setSystemInstructions] = useState('');
  const [temperature, setTemperature] = useState(0.2);
  const [avatarColor, setAvatarColor] = useState('#2563EB');
  const [selectedTools, setSelectedTools] = useState<PermittedTool[]>([]);

  const openCreateModal = () => {
    setEditingAgent(null);
    setName('');
    setDescription('');
    setModel('qwen-2.5-coder-14b');
    setSystemInstructions('You are an autonomous engineering agent operating on Cloudflare and Kaggle compute infrastructure.');
    setTemperature(0.2);
    setAvatarColor('#2563EB');
    setSelectedTools([AVAILABLE_DEFAULT_TOOLS[0], AVAILABLE_DEFAULT_TOOLS[2]]);
    setIsModalOpen(true);
  };

  const openEditModal = (agent: Agent) => {
    setEditingAgent(agent);
    setName(agent.name);
    setDescription(agent.description);
    setModel(agent.model);
    setSystemInstructions(agent.system_instructions);
    setTemperature(agent.temperature);
    const tools = Array.isArray(agent.permitted_tools)
      ? (agent.permitted_tools.map((t: any) =>
          typeof t === 'string'
            ? {
                id: t,
                name: t,
                description: `Tool ${t}`,
                category: 'execution',
                requires_approval: false,
                risk_level: 'low',
              }
            : t
        ) as PermittedTool[])
      : [];
    setSelectedTools(tools);
    setIsModalOpen(true);
  };

  const handleToggleTool = (tool: PermittedTool) => {
    setSelectedTools(prev => {
      const exists = prev.some(t => t.id === tool.id);
      if (exists) {
        return prev.filter(t => t.id !== tool.id);
      } else {
        return [...prev, tool];
      }
    });
  };

  const handleToggleApprovalRequirement = (toolId: string) => {
    setSelectedTools(prev =>
      prev.map(t => {
        if (t.id === toolId) {
          const newReq = !t.requires_approval;
          return {
            ...t,
            requires_approval: newReq,
            risk_level: newReq ? 'high' : ('low' as RiskLevel),
          };
        }
        return t;
      })
    );
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !systemInstructions.trim()) return;

    if (editingAgent) {
      updateAgent({
        ...editingAgent,
        name: name.trim(),
        description: description.trim(),
        model,
        system_instructions: systemInstructions.trim(),
        temperature,
        avatar_color: avatarColor,
        permitted_tools: selectedTools,
      });
    } else {
      const newAgent: Agent = {
        id: `agent_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: name.trim(),
        description: description.trim(),
        model,
        system_instructions: systemInstructions.trim(),
        temperature,
        max_tokens: 4096,
        is_enabled: true,
        avatar_color: avatarColor,
        permitted_tools: selectedTools,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      createAgent(newAgent);
    }
    setIsModalOpen(false);
  };

  const handleToggleActive = (agent: Agent) => {
    updateAgent({ ...agent, is_enabled: !agent.is_enabled });
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Agent Fleet Management
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Configure autonomous agents, system instructions, and permitted consequential tool gates.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create New Agent</span>
        </button>
      </div>

      {/* Agents Grid */}
      {agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center bg-slate-50/50 dark:bg-slate-900/30">
          <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-4">
            <Bot className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            No autonomous agents configured
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-md mx-auto">
            No agents exist in the database. Create your first autonomous agent to orchestrate tasks across the distributed Kaggle compute cluster.
          </p>
          <div className="mt-5">
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Agent</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {agents.map(agent => (
            <div
              key={agent.id}
              className={`rounded-xl border transition-all p-6 flex flex-col justify-between shadow-2xs ${
                agent.is_enabled
                  ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90'
                  : 'border-slate-200/60 dark:border-slate-800/40 bg-slate-50/50 dark:bg-slate-950/40 opacity-75'
              }`}
            >
              <div>
                {/* Card Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold shadow-2xs shrink-0"
                      style={{ backgroundColor: agent.avatar_color }}
                    >
                      {agent.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                        {agent.name}
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        <span className="font-mono">{agent.model}</span>
                        <span>·</span>
                        <span className="font-mono tabular-nums">temp {agent.temperature}</span>
                      </div>
                    </div>
                  </div>

                  <StatusBadge status={agent.is_enabled ? 'enabled' : 'disabled'} size="sm" />
                </div>

                {/* Description */}
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-3 leading-relaxed">
                  {agent.description}
                </p>

                {/* System Instructions Teaser */}
                <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 font-mono line-clamp-2">
                  {agent.system_instructions}
                </div>

                {/* Permitted Tools Matrix */}
                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                    <span className="font-semibold uppercase tracking-wider text-[10px]">
                      Permitted Capabilities & Safety Gates
                    </span>
                    <span className="font-mono">{agent.permitted_tools.length} configured</span>
                  </div>

                  <div className="space-y-1.5">
                    {agent.permitted_tools.map(tool => (
                      <div
                        key={tool.id}
                        className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-50/70 dark:bg-slate-800/40"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Terminal className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                            {tool.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <RiskBadge risk={tool.risk_level} />
                          {tool.requires_approval && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                              · Requires Review
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions Bar */}
            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleActive(agent)}
                  className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{agent.is_enabled ? 'Disable' : 'Enable'}</span>
                </button>

                <button
                  onClick={() => openEditModal(agent)}
                  className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  <span>Configure</span>
                </button>

                <button
                  onClick={() => deleteAgent(agent.id)}
                  className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                  title="Delete Agent"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedConversationId(null);
                    setActiveTab('chat');
                  }}
                  className="px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
                >
                  Chat
                </button>

                <button
                  onClick={() => {
                    if (onNewTaskForAgent) onNewTaskForAgent(agent.id);
                  }}
                  className="px-2.5 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-md transition-colors"
                >
                  Assign Task
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    )}

      {/* Agent Create / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingAgent ? `Configure ${editingAgent.name}` : 'Create Autonomous Agent'}
        description="Set behavioral prompts, model parameters, and consequential tool authorization constraints."
        maxWidth="xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Agent Name
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. DataOps & ETL Architect"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Inference Model
              </label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="qwen-2.5-coder-14b">qwen-2.5-coder-14b (Kaggle 2× Tesla T4 / vLLM)</option>
                <option value="deepseek-r1-distill-qwen-14b">deepseek-r1-distill-qwen-14b (Kaggle 2× Tesla T4 / vLLM)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
              Role Description
            </label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="High-level responsibilities and domain expertise..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                System Instructions & Safety Policy
              </label>
              <span className="text-[11px] font-mono text-slate-400">Core Persona</span>
            </div>
            <textarea
              value={systemInstructions}
              onChange={e => setSystemInstructions(e.target.value)}
              rows={4}
              placeholder="Define behavioral boundaries, instructions, and rules before taking consequential actions..."
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {/* Temperature & Avatar Color */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Temperature</span>
                <span className="font-mono tabular-nums">{temperature}</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.05"
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Avatar Theme Color
              </label>
              <div className="flex items-center gap-2">
                {['#2563EB', '#0D9488', '#7C3AED', '#E11D48', '#D97706', '#4B5563'].map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setAvatarColor(color)}
                    className={`w-6 h-6 rounded-md transition-transform ${
                      avatarColor === color ? 'scale-115 ring-2 ring-offset-2 ring-blue-500' : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Permitted Tools Configuration */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Permitted Tools & Human Authorization Gates
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {AVAILABLE_DEFAULT_TOOLS.map(tool => {
                const isSelected = selectedTools.some(t => t.id === tool.id);
                const currentConfig = selectedTools.find(t => t.id === tool.id);

                return (
                  <div
                    key={tool.id}
                    className={`p-2.5 rounded-lg border transition-colors flex items-center justify-between text-xs ${
                      isSelected
                        ? 'border-blue-200 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleTool(tool)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 dark:text-white truncate">
                          {tool.name}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">{tool.description}</p>
                      </div>
                    </div>

                    {isSelected && (
                      <button
                        type="button"
                        onClick={() => handleToggleApprovalRequirement(tool.id)}
                        className={`text-[11px] font-mono px-2 py-0.5 rounded transition-colors shrink-0 ${
                          currentConfig?.requires_approval
                            ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 font-semibold'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {currentConfig?.requires_approval ? 'Requires Approval' : 'Auto-Approve'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors"
            >
              {editingAgent ? 'Save Changes' : 'Create Agent'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
