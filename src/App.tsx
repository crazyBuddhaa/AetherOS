/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { TopBar } from './components/common/TopBar';
import { DashboardView } from './components/dashboard/DashboardView';
import { ChatView } from './components/chat/ChatView';
import { AgentsView } from './components/agents/AgentsView';
import { TasksView } from './components/tasks/TasksView';
import { ApprovalsView } from './components/approvals/ApprovalsView';
import { FilesView } from './components/files/FilesView';
import { ComputeView } from './components/compute/ComputeView';
import { SessionManagerView } from './components/compute/SessionManagerView';
import { SettingsView } from './components/settings/SettingsView';
import { NewTaskModal } from './components/tasks/NewTaskModal';
import { AuthModal } from './components/auth/AuthModal';
import { CommandPalette } from './components/common/CommandPalette';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

const AppContent: React.FC = () => {
  const { activeTab, setActiveTab, notification } = useApp();
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [preselectedAgentId, setPreselectedAgentId] = useState<string | undefined>(undefined);
  const [prefilledTitle, setPrefilledTitle] = useState<string | undefined>(undefined);
  const [prefilledDescription, setPrefilledDescription] = useState<string | undefined>(undefined);

  // Global Keyboard Shortcuts (Cmd+K / Ctrl+K and 1-7 for tabs)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleOpenNewTask = (agentId?: string, title?: string, description?: string) => {
    setPreselectedAgentId(agentId);
    setPrefilledTitle(title);
    setPrefilledDescription(description);
    setIsNewTaskModalOpen(true);
  };

  const handleConvertChatToTask = (content: string, agentId: string) => {
    const firstLine = content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 50);
    handleOpenNewTask(agentId, firstLine || 'Autonomous Execution Directive', content);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Navigation Contract */}
      <TopBar 
        onNewTaskClick={() => handleOpenNewTask()} 
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />

      {/* Main Viewport Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {activeTab === 'dashboard' && (
          <DashboardView onNewTaskClick={() => handleOpenNewTask()} />
        )}
        {activeTab === 'chat' && (
          <ChatView onConvertMessageToTask={handleConvertChatToTask} />
        )}
        {activeTab === 'agents' && (
          <AgentsView onNewTaskForAgent={agentId => handleOpenNewTask(agentId)} />
        )}
        {activeTab === 'tasks' && (
          <TasksView onNewTaskClick={() => handleOpenNewTask()} />
        )}
        {activeTab === 'approvals' && <ApprovalsView />}
        {activeTab === 'files' && <FilesView />}
        {activeTab === 'compute' && <ComputeView />}
        {activeTab === 'sessions' && <SessionManagerView />}
        {activeTab === 'settings' && <SettingsView />}
      </main>

      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-lg text-xs font-medium border transition-all animate-in fade-in slide-in-from-bottom-2 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800">
          {notification.type === 'success' && (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          )}
          {notification.type === 'error' && (
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
          )}
          {notification.type === 'info' && (
            <Info className="w-4 h-4 text-blue-500 shrink-0" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* New Task Submission Modal */}
      <NewTaskModal
        isOpen={isNewTaskModalOpen}
        onClose={() => setIsNewTaskModalOpen(false)}
        preselectedAgentId={preselectedAgentId}
        prefilledTitle={prefilledTitle}
        prefilledDescription={prefilledDescription}
      />

      {/* Passwordless WebAuthn & TOTP Auth Modal */}
      <AuthModal />

      {/* Global Command Palette (Cmd+K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNewTaskClick={() => handleOpenNewTask()}
      />

      {/* Minimalist SaaS Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800/80 py-6 mt-auto bg-white/50 dark:bg-slate-950/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700 dark:text-slate-300">AetherOS Platform</span>
            <span>·</span>
            <span>Cloudflare Workers + D1 + R2 Architecture</span>
          </div>

          <div className="flex items-center gap-4 text-[11px] font-mono">
            <span>Inference: Self-Hosted Runtime</span>
            <span>·</span>
            <span>Shortcut: ⌘K Command Palette</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
