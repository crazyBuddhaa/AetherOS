import React from 'react';
import { TaskStatus, ApprovalStatus, RiskLevel } from '../../types';
import { CheckCircle2, Clock, AlertCircle, AlertTriangle, XCircle, PauseCircle } from 'lucide-react';

interface StatusBadgeProps {
  status: TaskStatus | ApprovalStatus | 'enabled' | 'disabled' | 'pending' | 'skipped';
  size?: 'sm' | 'md';
}


export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const iconClass = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  switch (status) {
    case 'running':
    case 'assigned':
    case 'downloading':
    case 'loading_model':
    case 'uploading': {
      const labels: Record<string, string> = {
        assigned: 'Assigned',
        downloading: 'Downloading',
        loading_model: 'Loading Model',
        running: 'Running',
        uploading: 'Uploading',
      };
      return (
        <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-medium text-xs">
          <Clock className={`${iconClass} animate-spin text-blue-500`} />
          <span>{labels[status] || 'Running'}</span>
        </span>
      );
    }
    case 'queued':
      return (
        <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-xs">
          <Clock className={iconClass} />
          <span>Queued</span>
        </span>
      );
    case 'waiting_approval':
      return (
        <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium text-xs">
          <AlertTriangle className={iconClass} />
          <span>Pending Approval</span>
        </span>
      );
    case 'completed':
    case 'approved':
      return (
        <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium text-xs">
          <CheckCircle2 className={iconClass} />
          <span>{status === 'approved' ? 'Approved' : 'Completed'}</span>
        </span>
      );
    case 'failed':
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-medium text-xs">
          <XCircle className={iconClass} />
          <span>{status === 'rejected' ? 'Rejected' : 'Failed'}</span>
        </span>
      );
    case 'cancelled':
      return (
        <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-xs">
          <XCircle className={iconClass} />
          <span>Cancelled</span>
        </span>
      );
    case 'paused':
      return (
        <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-xs">
          <PauseCircle className={iconClass} />
          <span>Paused</span>
        </span>
      );
    case 'enabled':
      return (
        <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Active</span>
        </span>
      );
    case 'disabled':
      return (
        <span className="inline-flex items-center gap-1.5 text-slate-400 dark:text-slate-500 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          <span>Disabled</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-slate-500 text-xs">
          <span>{status}</span>
        </span>
      );
  }
};

export const RiskBadge: React.FC<{ risk: RiskLevel }> = ({ risk }) => {
  switch (risk) {
    case 'critical':
      return (
        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium text-xs">
          <AlertCircle className="w-3 h-3" />
          <span>Critical Risk</span>
        </span>
      );
    case 'high':
      return (
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium text-xs">
          <AlertTriangle className="w-3 h-3" />
          <span>High Risk</span>
        </span>
      );
    case 'medium':
      return (
        <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400 text-xs">
          <span>Medium Risk</span>
        </span>
      );
    case 'low':
    default:
      return (
        <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 text-xs">
          <span>Low Risk</span>
        </span>
      );
  }
};
