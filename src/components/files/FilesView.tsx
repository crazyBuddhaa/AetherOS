import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { AttachedFile } from '../../types';
import { 
  HardDrive, 
  Upload, 
  Trash2, 
  FileText, 
  Download, 
  Search, 
  FileCode, 
  Database, 
  CheckCircle2, 
  X 
} from 'lucide-react';

export const FilesView: React.FC = () => {
  const { files, uploadFile, deleteFile, showNotification, tasks } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedTaskAssociation, setSelectedTaskAssociation] = useState<string>('');
  const [previewFile, setPreviewFile] = useState<AttachedFile | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const filteredFiles = files.filter(f => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      f.filename.toLowerCase().includes(q) ||
      f.r2_key.toLowerCase().includes(q) ||
      f.mime_type.toLowerCase().includes(q)
    );
  });

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      for (let i = 0; i < droppedFiles.length; i++) {
        await uploadFile(droppedFiles[i], selectedTaskAssociation || undefined);
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (selected && selected.length > 0) {
      for (let i = 0; i < selected.length; i++) {
        await uploadFile(selected[i], selectedTaskAssociation || undefined);
      }
    }
  };

  const handleDownload = async (file: AttachedFile) => {
    showNotification(`Downloading ${file.filename} from Cloudflare R2...`, 'info');
    try {
      const res = await fetch(`/api/files/download/${encodeURIComponent(file.r2_key)}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.filename;
        a.click();
        URL.revokeObjectURL(url);
        showNotification(`Downloaded ${file.filename}`, 'success');
        return;
      } else {
        showNotification(`File download failed: ${res.statusText || 'File not found in R2 bucket'}`, 'error');
      }
    } catch (err: any) {
      showNotification(`Download error: ${err?.message || 'Network error'}`, 'error');
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Cloudflare R2 File Storage
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Bucket: <code className="font-mono text-blue-600 dark:text-blue-400">aetheros-agent-files</code> · Parquet analytical chunks, configs, and workflow artifacts.
          </p>
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg shadow-sm transition-colors shrink-0"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Upload File to R2</span>
        </button>
      </div>

      {/* Drag & Drop Upload Zone */}
      <div
        onDragOver={e => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`p-6 rounded-xl border-2 border-dashed transition-all text-center ${
          isDragging
            ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30'
            : 'border-slate-300 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 hover:border-slate-400 dark:hover:border-slate-700'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          multiple
          className="hidden"
        />
        <HardDrive className="w-8 h-8 mx-auto mb-2 text-blue-500" />
        <p className="text-xs font-medium text-slate-900 dark:text-white">
          Drag and drop datasets, scripts, or model weights here, or{' '}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-blue-600 dark:text-blue-400 underline font-semibold"
          >
            browse your files
          </button>
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          Files are automatically bound to the Cloudflare R2 bucket and indexed in D1.
        </p>

        {/* Optional Task Association */}
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500">
          <span>Associate with Workflow:</span>
          <select
            value={selectedTaskAssociation}
            onChange={e => setSelectedTaskAssociation(e.target.value)}
            className="text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
          >
            <option value="">None (General Storage)</option>
            {tasks.map(t => (
              <option key={t.id} value={t.id}>
                {t.title} ({t.id})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Search & Statistics Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
          <span>Total Objects: <strong className="text-slate-900 dark:text-white tabular-nums">{files.length}</strong></span>
          <span>·</span>
          <span>
            Capacity: <strong className="text-slate-900 dark:text-white tabular-nums">
              {formatBytes(files.reduce((a, b) => a + b.size_bytes, 0))}
            </strong>
          </span>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search R2 keys, names..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Files Table (High-density SaaS data grid, tabular figures) */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-100 dark:border-slate-800/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Object Name & Key</th>
                <th className="px-4 py-3">MIME Type</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Associated Task</th>
                <th className="px-4 py-3">Uploaded</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredFiles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    <HardDrive className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm font-medium text-slate-900 dark:text-white">R2 Storage Empty</p>
                    <p className="text-xs text-slate-400 mt-1">
                      No files or workflow artifacts currently stored in the R2 bucket.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredFiles.map(file => (
                  <tr
                    key={file.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <FileCode className="w-4 h-4 text-blue-500 shrink-0" />
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {file.filename}
                          </p>
                          <p className="text-[10px] font-mono text-slate-400">
                            r2://{file.r2_key}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                      {file.mime_type}
                    </td>

                    <td className="px-4 py-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatBytes(file.size_bytes)}
                    </td>

                    <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                      {file.task_id ? (
                        <span className="text-blue-600 dark:text-blue-400">
                          {file.task_id}
                        </span>
                      ) : (
                        <span className="text-slate-400">General</span>
                      )}
                    </td>

                    <td className="px-4 py-3 font-mono tabular-nums text-slate-400 text-[11px]">
                      {new Date(file.created_at).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleDownload(file)}
                          className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="Download from R2"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteFile(file.id)}
                          className="p-1 text-rose-500 hover:text-rose-700 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                          title="Delete from R2"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
