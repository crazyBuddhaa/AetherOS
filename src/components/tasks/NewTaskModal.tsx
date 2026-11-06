import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { TaskPriority } from '../../types';

interface NewTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedAgentId?: string;
  prefilledTitle?: string;
  prefilledDescription?: string;
}

export const NewTaskModal: React.FC<NewTaskModalProps> = ({
  isOpen,
  onClose,
  preselectedAgentId,
  prefilledTitle,
  prefilledDescription,
}) => {
  const { agents, submitTask, setActiveTab } = useApp();

  const activeAgents = agents.filter(a => a.is_enabled);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    preselectedAgentId || activeAgents[0]?.id || ''
  );
  const [title, setTitle] = useState(prefilledTitle || '');
  const [description, setDescription] = useState(prefilledDescription || '');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [inputPayloadStr, setInputPayloadStr] = useState(
    JSON.stringify({ target_environment: 'staging', timeout_minutes: 15 }, null, 2)
  );
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync props when opening
  React.useEffect(() => {
    if (isOpen) {
      if (preselectedAgentId) setSelectedAgentId(preselectedAgentId);
      if (prefilledTitle) setTitle(prefilledTitle);
      if (prefilledDescription) setDescription(prefilledDescription);
    }
  }, [isOpen, preselectedAgentId, prefilledTitle, prefilledDescription]);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !selectedAgentId) return;

    let payload: Record<string, unknown> = {};
    try {
      if (inputPayloadStr.trim()) {
        payload = JSON.parse(inputPayloadStr);
      }
      setPayloadError(null);
    } catch (err) {
      setPayloadError('Invalid JSON format in payload input');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitTask({
        agentId: selectedAgentId,
        title: title.trim(),
        description: description.trim(),
        inputPayload: payload,
        priority,
      });
      setTitle('');
      setDescription('');
      onClose();
      setActiveTab('tasks');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Submit Autonomous Task"
      description="Dispatch a new execution workflow to an agent. Consequential actions will require authorization."
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Agent Selection */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
            Designated Agent
          </label>
          <select
            value={selectedAgentId}
            onChange={e => setSelectedAgentId(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          >
            {activeAgents.map(agent => (
              <option key={agent.id} value={agent.id}>
                {agent.name} ({agent.model})
              </option>
            ))}
          </select>
        </div>

        {/* Task Title */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
            Task Title
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Ingest & Normalize Sensor Logs"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        {/* Task Description */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
            Operational Objective
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="Detailed instructions or context for the agent..."
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Priority Segmented Control */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
            Priority Tier
          </label>
          <div className="grid grid-cols-4 gap-2">
            {(['low', 'medium', 'high', 'critical'] as TaskPriority[]).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`py-1.5 text-xs font-medium rounded-md capitalize transition-colors border ${
                  priority === p
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-semibold'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Input Parameters JSON */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Input Parameters (JSON)
            </label>
            <span className="text-[11px] font-mono text-slate-400">Structured Payload</span>
          </div>
          <textarea
            value={inputPayloadStr}
            onChange={e => {
              setInputPayloadStr(e.target.value);
              setPayloadError(null);
            }}
            rows={4}
            className="w-full px-3 py-2 font-mono text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {payloadError && (
            <p className="text-xs text-rose-500 mt-1">{payloadError}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !title.trim()}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 rounded-lg shadow-sm transition-colors"
          >
            {isSubmitting ? 'Dispatching...' : 'Dispatch to Runtime'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
