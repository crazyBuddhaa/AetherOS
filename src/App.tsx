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
import { WebIntelligenceView } from './components/intelligence/WebIntelligenceView';
import { ChatView } from './components/chat/ChatView';
import { AgentsView } from './components/agents/AgentsView';
import { TasksView } from './components/tasks/TasksView';
import { ApprovalsView } from './components/approvals/ApprovalsView';
import { FilesView } from './components/files/FilesView';
import { ComputeView } from './components/compute/ComputeView';
import { SessionManagerView } from './components/compute/SessionManagerView';
import { SettingsView } from './components/settings/SettingsView';
import { AuthPageView } from './components/auth/AuthPageView';
import { NewTaskModal } from './components/tasks/NewTaskModal';
import { AuthModal } from './components/auth/AuthModal';
import { CommandPalette } from './components/common/CommandPalette';
import { CheckCircle2, AlertCircle, Info, Sun, Moon } from 'lucide-react';

const AppContent: React.FC = () => {
  const {
    activeTab,
    notification,
    isAuthenticated,
    user,
    isAuthChecking,
    theme,
    toggleTheme,
  } = useApp();
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

  // 1. Initial Session Resolution State (prevents layout flash)
  if (isAuthChecking) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#F8FAFC] dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center text-xl font-mono font-bold shadow-lg shadow-blue-500/20 animate-pulse">
            Æ
          </div>
          <div className="space-y-1">
            <h1 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">AetherOS Platform</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Verifying cryptographic hardware state...</p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Authentication Gate: Unauthenticated users MUST register or sign in
  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen w-full max-w-[100vw] overflow-x-hidden flex flex-col bg-[#F8FAFC] dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 transition-colors">
        {/* Minimal Unauthenticated Header */}
        <header className="sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
          <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-mono font-bold shadow-xs">
                Æ
              </span>
              <span className="font-bold tracking-tight text-slate-900 dark:text-white text-base">AetherOS</span>
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900">
                Authentication Required
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                aria-label="Toggle Light/Dark Mode"
                title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode (Primary)'}
                className="flex items-center gap-1.5 p-2 sm:px-2.5 sm:py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                {theme === 'light' ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-500" />
                    <span className="hidden sm:inline">Light</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-blue-400" />
                    <span className="hidden sm:inline">Dark</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Main Authentication & Registration View */}
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col justify-center">
          <AuthPageView />
        </main>

        {/* Security Footer */}
        <footer className="w-full border-t border-slate-200 dark:border-slate-800/80 py-4 px-4 text-center text-xs text-slate-500 dark:text-slate-400 bg-white/50 dark:bg-slate-900/50">
          <p>AetherOS Distributed Autonomous Platform · FIDO2 WebAuthn & Hardware Passkey Protection</p>
        </footer>

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
      </div>
    );
  }

  // 3. Authenticated Studio Platform Shell
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
          {activeTab === 'web_intelligence' && <WebIntelligenceView />}
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
          {activeTab === 'auth' && <AuthPageView />}
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
