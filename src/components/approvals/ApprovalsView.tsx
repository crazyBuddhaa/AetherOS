import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ApprovalRequest } from '../../types';
import { StatusBadge, RiskBadge } from '../common/StatusBadge';
import { 
  ShieldAlert, 
  Check, 
  X, 
  Terminal, 
  FileCode, 
  Clock, 
  UserCheck, 
  AlertTriangle 
} from 'lucide-react';

export const ApprovalsView: React.FC = () => {
  const { approvals, decideApproval, setActiveTab, setSelectedTaskId } = useApp();

  const [activeFilter, setActiveFilter] = useState<'pending' | 'history'>('pending');
  const [commentInput, setCommentInput] = useState<Record<string, string>>({});
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);

  const pendingApprovals = approvals.filter(a => a.status === 'pending');
  const historyApprovals = approvals.filter(a => a.status !== 'pending');

  const displayedList = activeFilter === 'pending' ? pendingApprovals : historyApprovals;

  const handleAction = (approvalId: string, decision: 'approved' | 'rejected') => {
    const comment = commentInput[approvalId] || '';
    decideApproval(approvalId, decision, comment);
    setCommentInput(prev => ({ ...prev, [approvalId]: '' }));
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Human Authorization Queue
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Consequential action sign-off gates. Autonomous execution is suspended until approved by an operator.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg text-xs font-medium self-start sm:self-auto">
          <button
            onClick={() => setActiveFilter('pending')}
            className={`px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
              activeFilter === 'pending'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <span>Pending Review</span>
            <span className="font-mono text-[10px] tabular-nums px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
              {pendingApprovals.length}
            </span>
          </button>
          <button
            onClick={() => setActiveFilter('history')}
            className={`px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
              activeFilter === 'history'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <span>Audit History</span>
            <span className="font-mono text-[10px] tabular-nums text-slate-400">
              {historyApprovals.length}
            </span>
          </button>
        </div>
      </div>

      {/* Approvals Cards Feed */}
      <div className="space-y-4">
        {displayedList.length === 0 ? (
          <div className="p-12 text-center border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900/90 text-slate-500">
            <ShieldAlert className="w-8 h-8 mx-auto mb-2 text-slate-400" />
            <p className="text-sm font-medium">
              {activeFilter === 'pending' ? 'No pending authorizations' : 'No approval history found'}
            </p>
            <p className="text-xs mt-1 text-slate-400">
              {activeFilter === 'pending'
                ? 'All autonomous tasks are currently running within authorized tool boundaries.'
                : 'Past authorization decisions will be preserved here for compliance audits.'}
            </p>
          </div>
        ) : (
          displayedList.map(item => (
            <div
              key={item.id}
              className={`rounded-xl border transition-all p-6 shadow-2xs ${
                item.status === 'pending'
                  ? 'border-amber-300 dark:border-amber-800/80 bg-white dark:bg-slate-900'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40'
              }`}
            >
              {/* Card Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={item.status} size="sm" />
                    <span className="text-xs text-slate-400 font-mono">· Approval ID: {item.id}</span>
                    <span className="text-xs text-slate-400 font-mono">· Agent: {item.agent_name}</span>
                  </div>

                  <h2 className="text-base font-semibold text-slate-900 dark:text-white mt-1.5 flex items-center gap-2">
                    <span>{item.action_name}</span>
                    <RiskBadge risk={item.risk_level} />
                  </h2>

                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                    <span>Associated Workflow:</span>
                    <button
                      onClick={() => {
                        setSelectedTaskId(item.task_id);
                        setActiveTab('tasks');
                      }}
                      className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      {item.task_title || item.task_id}
                    </button>
                  </div>
                </div>

                <div className="text-left sm:text-right shrink-0">
                  <span className="text-xs text-slate-400 font-mono block">
                    Requested: {new Date(item.requested_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500 block capitalize">
                    Type: {item.action_type.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>

              {/* Action Payload / Diff Box */}
              <div className="mt-4 space-y-2">
                {item.payload.details && (
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    {item.payload.details}
                  </p>
                )}

                {item.payload.target && (
                  <div className="text-xs font-mono text-slate-500 flex items-center gap-2">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Target:</span>
                    <span>{item.payload.target}</span>
                  </div>
                )}

                {item.payload.command && (
                  <div className="p-3 rounded-lg bg-slate-950 font-mono text-xs text-slate-200 overflow-x-auto border border-slate-800">
                    <div className="flex items-center gap-2 text-slate-500 text-[11px] mb-1">
                      <Terminal className="w-3 h-3" />
                      <span>Proposed Command:</span>
                    </div>
                    <code className="text-blue-400">{item.payload.command}</code>
                  </div>
                )}

                {item.payload.diff && (
                  <div className="p-3 rounded-lg bg-slate-950 font-mono text-xs overflow-x-auto border border-slate-800">
                    <div className="flex items-center gap-2 text-slate-500 text-[11px] mb-1">
                      <FileCode className="w-3 h-3" />
                      <span>Configuration Diff:</span>
                    </div>
                    <pre className="text-slate-300 whitespace-pre leading-relaxed text-[11px]">
                      {item.payload.diff}
                    </pre>
                  </div>
                )}
              </div>

              {/* Decision Section or Review Audit */}
              {item.status === 'pending' ? (
                <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex-1">
                    <input
                      type="text"
                      placeholder="Reviewer justification or comment (optional)..."
                      value={commentInput[item.id] || ''}
                      onChange={e =>
                        setCommentInput(prev => ({ ...prev, [item.id]: e.target.value }))
                      }
                      className="w-full sm:max-w-md px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => handleAction(item.id, 'rejected')}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject & Abort</span>
                    </button>

                    <button
                      onClick={() => handleAction(item.id, 'approved')}
                      className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Authorize Execution</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono">
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      Decided by {item.decided_by || 'Operator'}: "{item.review_comment || 'Action evaluated'}"
                    </span>
                  </div>
                  <span className="tabular-nums">
                    {item.decided_at && new Date(item.decided_at).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
