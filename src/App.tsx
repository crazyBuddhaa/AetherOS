/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { TopBar } from './components/common/TopBar';
import { Sidebar } from './components/common/Sidebar';
import { DashboardView } from './components/dashboard/DashboardView';
import { CodeWorkspaceView } from './components/workspaces/CodeWorkspaceView';
import { ImageWorkspaceView } from './components/workspaces/ImageWorkspaceView';
import { VideoWorkspaceView } from './components/workspaces/VideoWorkspaceView';
import { StoryboardWorkspaceView } from './components/workspaces/StoryboardWorkspaceView';
import { ScreenwriterWorkspaceView } from './components/workspaces/ScreenwriterWorkspaceView';
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
  const { activeTab, notification } = useApp();
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [preselectedAgentId, setPreselectedAgentId] = useState<string | undefined>(undefined);
  const [prefilledTitle, setPrefilledTitle] = useState<string | undefined>(undefined);
  const [prefilledDescription, setPrefilledDescription] = useState<string | undefined>(undefined);

  // Global Keyboard Shortcut (Cmd+K / Ctrl+K)
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
    <div className="min-h-screen w-full max-w-[100vw] overflow-x-hidden flex flex-col bg-[#F8FAFC] dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Bar Navigation */}
      <TopBar
        onNewTaskClick={() => handleOpenNewTask()}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />

      {/* Split Studio Shell: Sidebar + Dedicated Workspace Viewport */}
      <div className="flex-1 flex w-full max-w-[1600px] mx-auto min-w-0">
        <Sidebar />

        <main className="flex-1 min-w-0 w-full max-w-full overflow-x-hidden px-4 sm:px-6 lg:px-8 pt-5 pb-12">
          {activeTab === 'dashboard' && (
            <DashboardView onNewTaskClick={() => handleOpenNewTask()} />
          )}
          {activeTab === 'code' && <CodeWorkspaceView />}
          {activeTab === 'image' && <ImageWorkspaceView />}
          {activeTab === 'video' && <VideoWorkspaceView />}
          {activeTab === 'storyboard' && <StoryboardWorkspaceView />}
          {activeTab === 'screenwriter' && <ScreenwriterWorkspaceView />}
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
      </div>

      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:bottom-6 sm:right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-lg text-xs font-medium border transition-all bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800 max-w-md">
          {notification.type === 'success' && (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          )}
          {notification.type === 'error' && (
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
          )}
          {notification.type === 'info' && (
            <Info className="w-4 h-4 text-blue-500 shrink-0" />
          )}
          <span className="truncate">{notification.message}</span>
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
