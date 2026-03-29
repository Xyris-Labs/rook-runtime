import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNats } from '../context/NatsContext';
import type { StatusEntry } from '../context/NatsContext';
import {
  FolderOpen, FileText, Upload, FolderPlus, Trash2, Download,
  ChevronRight, RefreshCcw, X, Check, Home, HardDrive, AlertCircle,
  MoveRight,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DirEntry {
  name: string;
  type: 'file' | 'dir';
  size: number | null;
  modified: string;
}

interface ListResponse {
  path: string;
  entries: DirEntry[];
}

type ScribeStatus = StatusEntry & { httpPort?: number; serviceType?: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

function joinPath(base: string, name: string): string {
  if (!base || base === '.') return name;
  return `${base}/${name}`;
}

function parseBreadcrumbs(currentPath: string): Array<{ label: string; path: string }> {
  const crumbs: Array<{ label: string; path: string }> = [{ label: 'root', path: '.' }];
  if (!currentPath || currentPath === '.') return crumbs;
  const parts = currentPath.split('/').filter(Boolean);
  parts.forEach((part, i) => {
    crumbs.push({ label: part, path: parts.slice(0, i + 1).join('/') });
  });
  return crumbs;
}

// ─── Component ────────────────────────────────────────────────────────────────

const Scribe: React.FC = () => {
  const { meshStatus, status: natsStatus } = useNats();

  // Discovered Scribe HTTP base URL
  const [scribeUrl, setScribeUrl] = useState<string | null>(null);

  // File browser state
  const [currentPath, setCurrentPath] = useState('.');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Upload
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // New folder
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isSavingFolder, setIsSavingFolder] = useState(false);

  // Rename/move
  const [renamingEntry, setRenamingEntry] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Flash
  const [flashError, setFlashError] = useState<string | null>(null);
  const [flashSuccess, setFlashSuccess] = useState<string | null>(null);

  // ── Discover Scribe service from meshStatus ──────────────────────────────

  useEffect(() => {
    const found = Object.values(meshStatus).find(
      (e) => (e as ScribeStatus).capabilities?.includes('file-server')
    ) as ScribeStatus | undefined;

    if (found?.httpPort) {
      const url = `http://${window.location.hostname}:${found.httpPort}`;
      setScribeUrl(url);
    } else {
      setScribeUrl(null);
    }
  }, [meshStatus]);

  // ── Error / success flash ─────────────────────────────────────────────────

  const showError = useCallback((msg: string) => {
    setFlashError(msg);
    setTimeout(() => setFlashError(null), 5000);
  }, []);

  const showSuccess = useCallback((msg: string) => {
    setFlashSuccess(msg);
    setTimeout(() => setFlashSuccess(null), 3000);
  }, []);

  // ── Load directory ────────────────────────────────────────────────────────

  const loadDir = useCallback(async (dirPath: string) => {
    if (!scribeUrl) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${scribeUrl}/files?path=${encodeURIComponent(dirPath)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }
      const data: ListResponse = await res.json();
      setEntries(data.entries);
      setCurrentPath(dirPath);
    } catch (err: unknown) {
      showError(`Failed to list directory: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, [scribeUrl, showError]);

  useEffect(() => {
    if (scribeUrl) loadDir(currentPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scribeUrl]);

  // ── Upload ────────────────────────────────────────────────────────────────

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    if (!scribeUrl) return;
    const fileArr = Array.from(files);
    setIsUploading(true);
    let uploaded = 0;
    for (const file of fileArr) {
      const destPath = joinPath(currentPath === '.' ? '' : currentPath, file.name);
      try {
        const res = await fetch(`${scribeUrl}/files/upload?path=${encodeURIComponent(destPath)}`, {
          method: 'POST',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          showError(`Upload failed for "${file.name}": ${body.error}`);
        } else {
          uploaded++;
        }
      } catch (err: unknown) {
        showError(`Upload error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setIsUploading(false);
    if (uploaded > 0) {
      showSuccess(`Uploaded ${uploaded} file${uploaded > 1 ? 's' : ''}`);
      loadDir(currentPath);
    }
  }, [scribeUrl, currentPath, showError, showSuccess, loadDir]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      uploadFiles(e.target.files);
      e.target.value = '';
    }
  };

  // ── Drag and drop ─────────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  // ── New folder ────────────────────────────────────────────────────────────

  const handleCreateFolder = async () => {
    if (!scribeUrl || !newFolderName.trim()) return;
    const folderPath = joinPath(currentPath === '.' ? '' : currentPath, newFolderName.trim());
    setIsSavingFolder(true);
    try {
      const res = await fetch(
        `${scribeUrl}/files/mkdir?path=${encodeURIComponent(folderPath)}`,
        { method: 'PUT' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error);
      }
      setIsCreatingFolder(false);
      setNewFolderName('');
      showSuccess(`Folder "${newFolderName.trim()}" created`);
      loadDir(currentPath);
    } catch (err: unknown) {
      showError(`Create folder failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSavingFolder(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (name: string) => {
    if (!scribeUrl) return;
    const target = joinPath(currentPath === '.' ? '' : currentPath, name);
    setIsDeleting(true);
    try {
      const res = await fetch(`${scribeUrl}/files?path=${encodeURIComponent(target)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error);
      }
      setConfirmDelete(null);
      showSuccess(`Deleted "${name}"`);
      loadDir(currentPath);
    } catch (err: unknown) {
      showError(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // ── Rename ────────────────────────────────────────────────────────────────

  const handleRename = async (oldName: string) => {
    if (!scribeUrl || !renameValue.trim() || renameValue.trim() === oldName) {
      setRenamingEntry(null);
      return;
    }
    const base = currentPath === '.' ? '' : currentPath;
    const from = joinPath(base, oldName);
    const to = joinPath(base, renameValue.trim());
    try {
      const res = await fetch(`${scribeUrl}/files/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error);
      }
      setRenamingEntry(null);
      showSuccess(`Renamed to "${renameValue.trim()}"`);
      loadDir(currentPath);
    } catch (err: unknown) {
      showError(`Rename failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // ── Download URL ──────────────────────────────────────────────────────────

  const downloadUrl = (name: string) => {
    const p = joinPath(currentPath === '.' ? '' : currentPath, name);
    return `${scribeUrl}/files/download?path=${encodeURIComponent(p)}`;
  };

  // ── Breadcrumbs ───────────────────────────────────────────────────────────

  const breadcrumbs = parseBreadcrumbs(currentPath);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">

      {/* Page header */}
      <div className="border-b border-divider pb-4 flex justify-between items-end flex-shrink-0">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter italic">Scribe</h2>
          <p className="text-gray-500 text-sm">File server &amp; browser</p>
        </div>
        <div className="flex items-center gap-2">
          {flashSuccess && (
            <div className="flex items-center gap-2 text-xs text-green-400 font-mono bg-green-500/10 border border-green-500/20 px-3 py-2 rounded">
              <Check size={12} />
              <span>{flashSuccess}</span>
            </div>
          )}
          {flashError && (
            <div className="flex items-center gap-2 text-xs text-red-400 font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded">
              <AlertCircle size={12} />
              <span>{flashError}</span>
              <button onClick={() => setFlashError(null)} className="ml-1 hover:text-red-300">
                <X size={11} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Offline state */}
      {natsStatus !== 'connected' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-600">
            <HardDrive size={40} className="mx-auto mb-3 opacity-15" />
            <div className="text-sm italic">Waiting for NATS connection…</div>
          </div>
        </div>
      )}

      {/* Scribe not found */}
      {natsStatus === 'connected' && !scribeUrl && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-600">
            <HardDrive size={40} className="mx-auto mb-3 opacity-15" />
            <div className="text-sm italic">Scribe service not online</div>
            <div className="text-xs text-gray-700 mt-1">Waiting for service.scribe to register…</div>
          </div>
        </div>
      )}

      {/* File browser */}
      {scribeUrl && (
        <div className="flex flex-col flex-1 min-h-0 mt-4">

          {/* Toolbar: breadcrumbs + actions */}
          <div className="flex items-center justify-between gap-4 mb-3 flex-shrink-0">

            {/* Breadcrumbs */}
            <nav className="flex items-center gap-1 text-sm min-w-0 overflow-hidden">
              {breadcrumbs.map((crumb, i) => (
                <React.Fragment key={crumb.path}>
                  {i > 0 && <ChevronRight size={13} className="text-gray-600 flex-shrink-0" />}
                  {i === breadcrumbs.length - 1 ? (
                    <span className="font-medium text-white truncate max-w-xs">
                      {i === 0
                        ? <span className="flex items-center gap-1"><Home size={13} /> root</span>
                        : crumb.label}
                    </span>
                  ) : (
                    <button
                      onClick={() => loadDir(crumb.path)}
                      className="text-gray-400 hover:text-primary transition-colors flex-shrink-0 flex items-center gap-1"
                    >
                      {i === 0 ? <><Home size={13} /> root</> : crumb.label}
                    </button>
                  )}
                </React.Fragment>
              ))}
            </nav>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => loadDir(currentPath)}
                disabled={isLoading}
                className="p-1.5 rounded hover:bg-active text-gray-600 hover:text-primary transition-colors disabled:opacity-40"
                title="Refresh"
              >
                <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
              </button>

              {/* New folder */}
              <button
                onClick={() => { setIsCreatingFolder(v => !v); setNewFolderName(''); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-widest transition-colors ${
                  isCreatingFolder
                    ? 'bg-primary/20 text-primary border border-primary/40'
                    : 'border border-dashed border-gray-600 text-gray-400 hover:text-primary hover:border-primary hover:bg-primary/5'
                }`}
              >
                <FolderPlus size={13} />
                New Folder
              </button>

              {/* Upload */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-widest border border-dashed border-gray-600 text-gray-400 hover:text-primary hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-40"
              >
                {isUploading
                  ? <RefreshCcw size={13} className="animate-spin" />
                  : <Upload size={13} />
                }
                Upload
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          </div>

          {/* New folder inline form */}
          {isCreatingFolder && (
            <div className="mb-3 px-4 py-3 bg-primary/[0.04] border border-primary/20 rounded-lg flex items-center gap-3 flex-shrink-0">
              <FolderPlus size={14} className="text-primary flex-shrink-0" />
              <input
                type="text"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder="folder-name"
                autoFocus
                className="flex-1 bg-black/50 border border-divider rounded px-2.5 py-1.5 text-sm font-mono text-white placeholder-gray-600 outline-none focus:border-primary transition-colors"
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') { setIsCreatingFolder(false); setNewFolderName(''); }
                }}
              />
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || isSavingFolder}
                className="p-1.5 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-40"
              >
                {isSavingFolder ? <RefreshCcw size={13} className="animate-spin" /> : <Check size={13} />}
              </button>
              <button
                onClick={() => { setIsCreatingFolder(false); setNewFolderName(''); }}
                className="p-1.5 rounded hover:bg-active text-gray-500 hover:text-white transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* File table — also a drop zone */}
          <div
            className={`flex-1 min-h-0 bg-card border rounded-lg overflow-hidden flex flex-col transition-colors ${
              isDragOver ? 'border-primary bg-primary/5' : 'border-divider'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragOver && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="text-primary font-bold text-lg flex items-center gap-2">
                  <Upload size={20} />
                  Drop files to upload
                </div>
              </div>
            )}

            {/* Loading */}
            {isLoading && (
              <div className="flex-1 flex items-center justify-center p-16 text-gray-600">
                <RefreshCcw size={22} className="animate-spin opacity-40" />
              </div>
            )}

            {/* Empty */}
            {!isLoading && entries.length === 0 && (
              <div className="flex-1 flex items-center justify-center p-16 text-center text-gray-600">
                <div>
                  <FolderOpen size={32} className="mx-auto mb-3 opacity-15" />
                  <div className="text-sm italic">This folder is empty</div>
                  <div className="text-xs mt-1 text-gray-700">Upload files or create a folder to get started</div>
                </div>
              </div>
            )}

            {/* Table */}
            {!isLoading && entries.length > 0 && (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left border-collapse" style={{ tableLayout: 'fixed' }}>
                  <thead className="sticky top-0 bg-black/80 backdrop-blur-sm z-10">
                    <tr className="border-b border-divider">
                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500">Name</th>
                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 w-28 text-right">Size</th>
                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 w-32 text-right">Modified</th>
                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 w-32 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(entry => {
                      const isConfirmingDelete = confirmDelete === entry.name;
                      const isRenaming = renamingEntry === entry.name;

                      return (
                        <tr
                          key={entry.name}
                          className="border-b border-divider/40 hover:bg-white/[0.025] transition-colors group"
                        >
                          {/* Name */}
                          <td className="px-5 py-3">
                            {isRenaming ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={renameValue}
                                  onChange={e => setRenameValue(e.target.value)}
                                  autoFocus
                                  className="flex-1 bg-black/60 border border-primary/60 rounded px-2 py-1 text-xs font-mono text-white outline-none focus:border-primary"
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleRename(entry.name);
                                    if (e.key === 'Escape') setRenamingEntry(null);
                                  }}
                                />
                                <button
                                  onClick={() => handleRename(entry.name)}
                                  className="p-1 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                                >
                                  <Check size={12} />
                                </button>
                                <button
                                  onClick={() => setRenamingEntry(null)}
                                  className="p-1 rounded hover:bg-active text-gray-500 hover:text-white transition-colors"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2.5 min-w-0">
                                {entry.type === 'dir' ? (
                                  <FolderOpen size={15} className="text-yellow-500/70 flex-shrink-0" />
                                ) : (
                                  <FileText size={15} className="text-gray-500 flex-shrink-0" />
                                )}
                                {entry.type === 'dir' ? (
                                  <button
                                    onClick={() => loadDir(joinPath(currentPath === '.' ? '' : currentPath, entry.name))}
                                    className="font-medium text-sm text-white hover:text-primary transition-colors truncate text-left"
                                  >
                                    {entry.name}
                                  </button>
                                ) : (
                                  <a
                                    href={downloadUrl(entry.name)}
                                    download={entry.name}
                                    className="font-medium text-sm text-gray-300 hover:text-primary transition-colors truncate"
                                    title={`Download ${entry.name}`}
                                  >
                                    {entry.name}
                                  </a>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Size */}
                          <td className="px-5 py-3 text-right">
                            <span className="text-xs text-gray-500 font-mono">
                              {entry.type === 'dir' ? '—' : formatSize(entry.size)}
                            </span>
                          </td>

                          {/* Modified */}
                          <td className="px-5 py-3 text-right">
                            <span className="text-xs text-gray-600 font-mono whitespace-nowrap">
                              {formatDate(entry.modified)}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="px-5 py-3">
                            {isConfirmingDelete ? (
                              <div className="flex items-center justify-center gap-1">
                                <span className="text-[9px] text-red-400 font-bold uppercase mr-0.5">Sure?</span>
                                <button
                                  onClick={() => handleDelete(entry.name)}
                                  disabled={isDeleting}
                                  className="p-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-40"
                                  title="Confirm delete"
                                >
                                  {isDeleting
                                    ? <RefreshCcw size={12} className="animate-spin" />
                                    : <Check size={12} />
                                  }
                                </button>
                                <button
                                  onClick={() => setConfirmDelete(null)}
                                  className="p-1.5 rounded hover:bg-active text-gray-500 hover:text-white transition-colors"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {entry.type === 'file' && (
                                  <a
                                    href={downloadUrl(entry.name)}
                                    download={entry.name}
                                    className="p-1.5 rounded hover:bg-active text-gray-600 hover:text-primary transition-colors"
                                    title="Download"
                                  >
                                    <Download size={12} />
                                  </a>
                                )}
                                <button
                                  onClick={() => {
                                    setRenamingEntry(entry.name);
                                    setRenameValue(entry.name);
                                    setConfirmDelete(null);
                                  }}
                                  className="p-1.5 rounded hover:bg-active text-gray-600 hover:text-primary transition-colors"
                                  title="Rename"
                                >
                                  <MoveRight size={12} />
                                </button>
                                <button
                                  onClick={() => {
                                    setConfirmDelete(entry.name);
                                    setRenamingEntry(null);
                                  }}
                                  className="p-1.5 rounded hover:bg-active text-gray-600 hover:text-red-500 transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer */}
            <div className="px-5 py-2 border-t border-divider bg-black/20 flex items-center justify-between flex-shrink-0">
              <span className="text-[10px] text-gray-600 font-mono">
                {entries.length} item{entries.length !== 1 ? 's' : ''}
              </span>
              {scribeUrl && (
                <span className="text-[10px] text-gray-700 font-mono">
                  {scribeUrl}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Scribe;
