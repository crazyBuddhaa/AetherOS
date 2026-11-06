import React from 'react';
import { useApp, NavTab } from '../../context/AppContext';
import { Sun, Moon, Plus, Search, Fingerprint, LogOut } from 'lucide-react';

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
    logout
  } = useApp();

  const navItems: { id: NavTab; label: string; count?: number }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'chat', label: 'Chat' },
    { id: 'agents', label: 'Agents' },
    { id: 'tasks', label: 'Tasks', count: stats.running_tasks > 0 ? stats.running_tasks : undefined },
    { id: 'approvals', label: 'Approvals', count: stats.pending_approvals > 0 ? stats.pending_approvals : undefined },
    { id: 'files', label: 'Files' },
    { id: 'compute', label: 'Compute Grid' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark (Single Text Element) */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setActiveTab('dashboard')}
            className="text-left font-bold tracking-tight text-slate-900 dark:text-white text-lg flex items-center gap-2 hover:opacity-90 transition-opacity"
          >
            <span className="w-7 h-7 rounded-md bg-blue-600 text-white flex items-center justify-center text-xs font-mono font-bold shadow-sm">
              Æ
            </span>
            <span>AetherOS</span>
          </button>
        </div>

        {/* Zone 2: Navigation Links (Single-Line Text Links) */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {navItems.map(item => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`relative py-1 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <span>{item.label}</span>
                {item.count !== undefined && item.count > 0 && (
                  <span className="text-[11px] font-mono tabular-nums px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                    {item.count}
                  </span>
                )}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Actions & Controls */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={onOpenCommandPalette}
            className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-400 dark:text-slate-400 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shadow-2xs"
            title="Open Command Palette (Cmd+K)"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Quick search</span>
            <kbd className="text-[10px] font-mono px-1 py-0.2 bg-slate-200 dark:bg-slate-800 rounded text-slate-500 dark:text-slate-400">⌘K</kbd>
          </button>

          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>


          <button
            onClick={onNewTaskClick}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Submit Task</span>
          </button>

          {/* User Profile / Auth Area */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
            {isAuthenticated && user ? (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-blue-600 text-white font-semibold text-xs flex items-center justify-center font-mono shadow-xs">
                  {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U'}
                </div>
                <div className="text-left text-xs hidden lg:block">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <span>{user.name}</span>
                    <span className="text-[10px] px-1 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-mono font-normal">
                      Passkey
                    </span>
                  </div>
                  <div className="text-slate-500 text-[11px] truncate max-w-[120px]">
                    {workspace?.name || 'Personal Workspace'}
                  </div>
                </div>
                <button
                  onClick={() => logout()}
                  title="Sign out"
                  className="p-1.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setAuthModalMode('login');
                  setIsAuthModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-lg transition-colors border border-blue-200 dark:border-blue-900/50 shadow-2xs whitespace-nowrap"
              >
                <Fingerprint className="w-3.5 h-3.5" />
                <span>Sign In / Register</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Navigation Scroll Strip */}
      <div className="md:hidden flex items-center gap-4 px-4 py-2 border-t border-slate-100 dark:border-slate-900 overflow-x-auto text-xs font-medium">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`whitespace-nowrap px-2.5 py-1 rounded-md transition-colors ${
              activeTab === item.id
                ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-semibold'
                : 'text-slate-600 dark:text-slate-400'
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
