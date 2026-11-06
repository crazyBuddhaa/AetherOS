import React from 'react';
import { useApp, NavTab } from '../../context/AppContext';
import { Sun, Moon, Plus, Search, Fingerprint, LogOut, Sliders } from 'lucide-react';

export const TopBar: React.FC<{
  onNewTaskClick: () => void;
  onOpenCommandPalette: () => void;
}> = ({ onNewTaskClick, onOpenCommandPalette }) => {
  const {
    activeTab,
    setActiveTab,
    theme,
    toggleTheme,
    stats,
    user,
    workspace,
    isAuthenticated,
    setIsAuthModalOpen,
    setAuthModalMode,
    logout,
  } = useApp();

  // Primary Studio Workspace Links (max 6 top-level links in header)
  const studioNavItems: { id: NavTab; label: string }[] = [
    { id: 'dashboard', label: 'Workspace Hub' },
    { id: 'code', label: 'Code Gen' },
    { id: 'image', label: 'Image Studio' },
    { id: 'video', label: 'Video Studio' },
    { id: 'storyboard', label: 'Storyboard' },
    { id: 'screenwriter', label: 'Screenwriter' },
  ];

  // Mobile includes all workspaces + operations
  const mobileNavItems: { id: NavTab; label: string; count?: number }[] = [
    ...studioNavItems,
    { id: 'web_intelligence', label: 'Web Intel' },
    { id: 'chat', label: 'Agent Chat' },
    { id: 'tasks', label: 'Tasks', count: stats.running_tasks > 0 ? stats.running_tasks : undefined },
    { id: 'compute', label: 'Compute Grid' },
    { id: 'sessions', label: 'Kaggle T4×2' },
    { id: 'agents', label: 'Agents' },
    { id: 'approvals', label: 'Approvals', count: stats.pending_approvals > 0 ? stats.pending_approvals : undefined },
    { id: 'files', label: 'R2 Storage' },
    { id: 'settings', label: 'Settings' },
    { id: 'auth', label: 'Identity & Passkeys' },
  ];

  return (
    <header className="sticky top-0 z-40 w-full max-w-full overflow-hidden border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md transition-colors">
      <div className="max-w-[1600px] w-full mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-1.5 sm:gap-4 min-w-0">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('dashboard')}
            className="text-left font-bold tracking-tight text-slate-900 dark:text-white text-sm sm:text-base flex items-center gap-2 hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
          >
            <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-mono font-bold shadow-xs shrink-0">
              Æ
            </span>
            <span>AetherOS</span>
          </button>
        </div>

        {/* Zone 2: Studio Workspace Quick Switcher */}
        <nav className="hidden xl:flex items-center gap-6 text-xs font-medium min-w-0">
          {studioNavItems.map(item => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`relative py-1.5 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <span>{item.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Actions, Theme Switcher & Auth */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0 min-w-0">
          <button
            onClick={onOpenCommandPalette}
            className="hidden sm:flex items-center gap-1.5 p-2 sm:px-2.5 sm:py-1.5 text-xs text-slate-500 dark:text-slate-400 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:text-slate-800 dark:hover:text-slate-200 transition-colors whitespace-nowrap shrink-0"
            title="Open Command Palette (Cmd+K)"
            aria-label="Quick search"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Quick jump</span>
            <kbd className="hidden md:inline-block text-[10px] font-mono px-1.5 py-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-500 dark:text-slate-400">
              ⌘K
            </kbd>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`p-2 rounded-lg border transition-colors shrink-0 ${
              activeTab === 'settings'
                ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400'
                : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Situational Settings Modules"
            aria-label="Settings Modules"
          >
            <Sliders className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <button
            onClick={toggleTheme}
            aria-label="Toggle Light/Dark Mode"
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode (Primary)'}
            className="flex items-center gap-1.5 p-2 sm:px-2.5 sm:py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
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

          <button
            onClick={onNewTaskClick}
            className="flex items-center gap-1 p-2 sm:px-3 sm:py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-xs transition-colors whitespace-nowrap shrink-0"
            title="Dispatch Task"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Dispatch Task</span>
          </button>

          {/* User Profile / Auth Area */}
          <div className="flex items-center gap-1 sm:gap-2 pl-1 sm:pl-2 border-l border-slate-200 dark:border-slate-800 shrink-0">
            {isAuthenticated && user ? (
              <div className="flex items-center gap-1 sm:gap-2">
                <button
                  onClick={() => setActiveTab('auth')}
                  title={`Signed in as ${user.name} - View Identity & Passkeys`}
                  className="flex items-center gap-1.5 p-1 sm:px-2 sm:py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                >
                  <div className="w-7 h-7 rounded-full bg-blue-600 text-white font-semibold text-xs flex items-center justify-center font-mono shrink-0 shadow-2xs">
                    {user.name
                      .split(' ')
                      .map(n => n[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase() || 'U'}
                  </div>
                  <div className="hidden lg:block text-xs">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 leading-tight truncate max-w-[100px]">
                      {user.name}
                    </div>
                    <div className="text-slate-500 text-[10px] truncate max-w-[100px]">
                      {workspace?.name || 'Personal'}
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => logout()}
                  title="Sign out"
                  className="p-1.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setAuthModalMode('login');
                    setActiveTab('auth');
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors border border-slate-200 dark:border-slate-700 whitespace-nowrap shrink-0 shadow-2xs"
                >
                  <Fingerprint className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>Sign In</span>
                </button>
                <button
                  onClick={() => {
                    setAuthModalMode('register');
                    setActiveTab('auth');
                  }}
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-lg transition-colors border border-blue-200 dark:border-blue-900 whitespace-nowrap shrink-0"
                >
                  <span>Register</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile & Tablet Navigation Scroll Strip */}
      <div className="lg:hidden flex items-center gap-1.5 px-3 sm:px-4 py-2 border-t border-slate-200 dark:border-slate-800 overflow-x-auto text-xs font-medium bg-slate-50/70 dark:bg-slate-950/70 w-full max-w-full">
        {mobileNavItems.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`whitespace-nowrap shrink-0 px-2.5 py-1 rounded-md transition-colors ${
              activeTab === item.id
                ? 'bg-blue-600 text-white font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800'
            }`}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && ` (${item.count})`}
          </button>
        ))}
      </div>
    </header>
  );
};
