import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNats } from '../context/NatsContext';
import { Database, RefreshCcw, Plus, Trash2, Check, X, Search, Edit3 } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

interface BucketInfo {
  streamName: string;   // e.g. KV_ROOK_STATUS
  bucketName: string;   // e.g. ROOK_STATUS  (used for kv ops)
  keyCount: number;
}

interface EntryData {
  key: string;
  value: string;
  revision: number;
  created: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tryParseJson(str: string): { parsed: unknown; valid: boolean } {
  try {
    return { parsed: JSON.parse(str), valid: true };
  } catch {
    return { parsed: null, valid: false };
  }
}

function formatAge(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString();
}

// ─── JSON Syntax Highlighter ─────────────────────────────────────────────────

function JsonView({ value }: { value: string }) {
  const { parsed, valid } = tryParseJson(value);
  if (!valid) return null;

  const formatted = JSON.stringify(parsed, null, 2);

  // Split on tokens we want to colour; keep delimiters via capture group
  const parts = formatted.split(
    /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g
  );

  return (
    <pre className="cortex-json font-mono text-xs leading-relaxed overflow-auto max-h-52 p-2 bg-black/30 rounded">
      {parts.map((part, i) => {
        if (part.match(/^".*":/))    return <span key={i} className="cj-key">{part}</span>;
        if (part.startsWith('"'))    return <span key={i} className="cj-string">{part}</span>;
        if (part === 'true' || part === 'false') return <span key={i} className="cj-bool">{part}</span>;
        if (part === 'null')          return <span key={i} className="cj-null">{part}</span>;
        if (/^-?\d/.test(part))      return <span key={i} className="cj-num">{part}</span>;
        return <span key={i} className="cj-plain">{part}</span>;
      })}
    </pre>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const Cortex: React.FC = () => {
  const { connection, js, status } = useNats();

  // Bucket list
  const [buckets, setBuckets] = useState<BucketInfo[]>([]);
  const [isLoadingBuckets, setIsLoadingBuckets] = useState(false);

  // Selected bucket
  const [selectedBucket, setSelectedBucket] = useState<BucketInfo | null>(null);

  // KV entries for selected bucket
  const [entries, setEntries] = useState<Map<string, EntryData>>(new Map());
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [isWatching, setIsWatching] = useState(false);

  // UI state
  const [filter, setFilter] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [flashError, setFlashError] = useState<string | null>(null);

  const watcherRef = useRef<{ stop: () => void } | null>(null);

  // ── Error flash ──────────────────────────────────────────────────────────

  const showError = (msg: string) => {
    setFlashError(msg);
    setTimeout(() => setFlashError(null), 5000);
  };

  // ── Load bucket list ─────────────────────────────────────────────────────

  const loadBuckets = useCallback(async () => {
    if (!connection || status !== 'connected') return;
    setIsLoadingBuckets(true);
    try {
      const jsm = await connection.jetstreamManager();
      const found: BucketInfo[] = [];
      for await (const stream of jsm.streams.list()) {
        if (stream.config.name.startsWith('KV_')) {
          found.push({
            streamName: stream.config.name,
            bucketName: stream.config.name.slice(3),
            keyCount: stream.state.num_subjects ?? stream.state.messages,
          });
        }
      }
      found.sort((a, b) => a.bucketName.localeCompare(b.bucketName));
      setBuckets(found);
    } catch (err: any) {
      showError(`Failed to list buckets: ${err.message}`);
    } finally {
      setIsLoadingBuckets(false);
    }
  }, [connection, status]);

  useEffect(() => {
    loadBuckets();
  }, [loadBuckets]);

  // ── Watch selected bucket ─────────────────────────────────────────────────

  useEffect(() => {
    if (!js || !selectedBucket) return;

    let stopped = false;
    let watcher: { stop: () => void } | null = null;

    setEntries(new Map());
    setIsWatching(false);
    setIsLoadingEntries(true);
    setEditingKey(null);
    setConfirmDeleteKey(null);
    setFilter('');

    const run = async () => {
      try {
        const kv = await js.views.kv(selectedBucket.bucketName);
        watcher = await kv.watch() as unknown as { stop: () => void };
        watcherRef.current = watcher;

        let initialized = false;

        // Fallback for empty buckets: mark ready after 600 ms of silence
        const initTimer = setTimeout(() => {
          if (!stopped && !initialized) {
            initialized = true;
            setIsLoadingEntries(false);
            setIsWatching(true);
          }
        }, 600);

        for await (const entry of watcher as unknown as AsyncIterable<{
          key: string;
          value: Uint8Array;
          revision: number;
          created?: Date;
          operation: string;
          delta: number;
        }>) {
          if (stopped) break;

          // First real entry clears loading
          if (!initialized) {
            initialized = true;
            clearTimeout(initTimer);
            setIsLoadingEntries(false);
            setIsWatching(true);
          }

          setEntries(prev => {
            const next = new Map(prev);
            if (entry.operation === 'DEL' || entry.operation === 'PURGE') {
              next.delete(entry.key);
            } else {
              next.set(entry.key, {
                key: entry.key,
                value: new TextDecoder().decode(entry.value),
                revision: entry.revision,
                created: entry.created ? new Date(entry.created) : new Date(),
              });
            }
            return next;
          });
        }
      } catch (err: any) {
        if (!stopped) {
          setIsWatching(false);
          setIsLoadingEntries(false);
          showError(`Watch error: ${err.message}`);
        }
      }
    };

    run();

    return () => {
      stopped = true;
      watcher?.stop();
      watcherRef.current = null;
      setIsWatching(false);
    };
  }, [js, selectedBucket]);

  // ── KV operations ────────────────────────────────────────────────────────

  const handleSaveEdit = async (key: string) => {
    if (!js || !selectedBucket) return;
    setSavingKey(key);
    try {
      const kv = await js.views.kv(selectedBucket.bucketName);
      await kv.put(key, new TextEncoder().encode(editValue));
      setEditingKey(null);
    } catch (err: any) {
      showError(`Save failed: ${err.message}`);
    } finally {
      setSavingKey(null);
    }
  };

  const handleDelete = async (key: string) => {
    if (!js || !selectedBucket) return;
    try {
      const kv = await js.views.kv(selectedBucket.bucketName);
      await kv.delete(key);
      setConfirmDeleteKey(null);
    } catch (err: any) {
      showError(`Delete failed: ${err.message}`);
    }
  };

  const handleAddKey = async () => {
    if (!js || !selectedBucket || !newKey.trim()) return;
    setSavingKey('__new__');
    try {
      const kv = await js.views.kv(selectedBucket.bucketName);
      await kv.put(newKey.trim(), new TextEncoder().encode(newValue));
      setNewKey('');
      setNewValue('');
      setIsAddingKey(false);
    } catch (err: any) {
      showError(`Add key failed: ${err.message}`);
    } finally {
      setSavingKey(null);
    }
  };

  // ── Derived data ─────────────────────────────────────────────────────────

  const filteredEntries = Array.from(entries.values())
    .filter(e => !filter || e.key.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => a.key.localeCompare(b.key));

  const maxRevision = entries.size > 0
    ? Math.max(...Array.from(entries.values()).map(e => e.revision))
    : 0;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">

      {/* Page header */}
      <div className="border-b border-divider pb-4 flex justify-between items-end flex-shrink-0">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter italic">Cortex</h2>
          <p className="text-gray-500 text-sm">JetStream KV browser &amp; editor</p>
        </div>
        {flashError && (
          <div className="flex items-center gap-2 text-xs text-red-400 font-mono bg-red-500/10 border border-red-500/20 px-3 py-2 rounded">
            <X size={12} />
            <span>{flashError}</span>
            <button onClick={() => setFlashError(null)} className="ml-1 hover:text-red-300">
              <X size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0 mt-4 gap-4">

        {/* ── Left panel: bucket list ── */}
        <div className="w-64 flex-shrink-0 flex flex-col bg-card border border-divider rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-divider flex items-center justify-between flex-shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">KV Buckets</span>
            <button
              onClick={loadBuckets}
              disabled={isLoadingBuckets}
              className="p-1 rounded hover:bg-active text-gray-600 hover:text-primary transition-colors disabled:opacity-40"
              title="Refresh bucket list"
            >
              <RefreshCcw size={12} className={isLoadingBuckets ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoadingBuckets && (
              <div className="p-8 flex justify-center text-gray-600">
                <RefreshCcw size={16} className="animate-spin" />
              </div>
            )}

            {!isLoadingBuckets && buckets.length === 0 && (
              <div className="p-8 text-center text-gray-600 text-xs italic">
                No KV buckets found
              </div>
            )}

            {buckets.map(bucket => {
              const isSelected = selectedBucket?.streamName === bucket.streamName;
              const liveKeyCount = isSelected ? entries.size : bucket.keyCount;
              return (
                <button
                  key={bucket.streamName}
                  onClick={() => {
                    setSelectedBucket(bucket);
                    setIsAddingKey(false);
                    setNewKey('');
                    setNewValue('');
                  }}
                  className={`w-full px-4 py-3 text-left flex items-center gap-3 transition-colors border-b border-divider/40 last:border-0 ${
                    isSelected
                      ? 'bg-active text-white'
                      : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {/* Live indicator dot */}
                  <div className="relative w-2 h-2 flex-shrink-0">
                    {isSelected && isWatching ? (
                      <>
                        <div className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" />
                        <div className="absolute inset-0 rounded-full bg-primary" />
                      </>
                    ) : (
                      <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-gray-500' : 'bg-gray-700'}`} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs font-semibold truncate">{bucket.bucketName}</div>
                    <div className="text-[10px] text-gray-600 mt-0.5 font-mono">
                      {liveKeyCount} key{liveKeyCount !== 1 ? 's' : ''}
                    </div>
                  </div>

                  <Database size={12} className="flex-shrink-0 opacity-30" />
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right panel: KV workspace ── */}
        <div className="flex-1 min-w-0 flex flex-col bg-card border border-divider rounded-lg overflow-hidden">

          {/* Empty state */}
          {!selectedBucket ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-gray-600">
                <Database size={40} className="mx-auto mb-3 opacity-15" />
                <div className="text-sm italic">Select a bucket to explore</div>
              </div>
            </div>
          ) : (
            <>
              {/* Workspace toolbar */}
              <div className="px-5 py-3 border-b border-divider flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-sm">{selectedBucket.bucketName}</span>
                  {isWatching && (
                    <span className="flex items-center gap-1.5 text-[10px] text-primary font-bold uppercase tracking-widest">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      Live
                    </span>
                  )}
                  {isLoadingEntries && (
                    <span className="flex items-center gap-1.5 text-[10px] text-gray-500 font-mono">
                      <RefreshCcw size={10} className="animate-spin" />
                      Connecting…
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {/* Filter */}
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
                    <input
                      type="text"
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
                      placeholder="Filter keys…"
                      className="pl-7 pr-3 py-1.5 bg-black/40 border border-divider rounded text-xs font-mono text-white placeholder-gray-600 outline-none focus:border-primary w-44 transition-colors"
                    />
                  </div>

                  {/* Add key toggle */}
                  <button
                    onClick={() => {
                      setIsAddingKey(v => !v);
                      setNewKey('');
                      setNewValue('');
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-widest transition-colors ${
                      isAddingKey
                        ? 'bg-primary/20 text-primary border border-primary/40'
                        : 'border border-dashed border-gray-600 text-gray-400 hover:text-primary hover:border-primary hover:bg-primary/5'
                    }`}
                  >
                    <Plus size={12} />
                    Add Key
                  </button>
                </div>
              </div>

              {/* Add key form */}
              {isAddingKey && (
                <div className="px-5 py-4 border-b border-divider bg-primary/[0.04] flex items-start gap-3 flex-shrink-0">
                  <div className="pt-1.5 flex-shrink-0">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-primary">New</span>
                  </div>
                  <input
                    type="text"
                    value={newKey}
                    onChange={e => setNewKey(e.target.value)}
                    placeholder="key.name"
                    className="w-44 bg-black/50 border border-divider rounded px-2.5 py-1.5 text-xs font-mono text-white placeholder-gray-600 outline-none focus:border-primary transition-colors"
                    onKeyDown={e => {
                      if (e.key === 'Escape') setIsAddingKey(false);
                    }}
                  />
                  <textarea
                    value={newValue}
                    onChange={e => setNewValue(e.target.value)}
                    placeholder="value"
                    rows={2}
                    className="flex-1 bg-black/50 border border-divider rounded px-2.5 py-1.5 text-xs font-mono text-white placeholder-gray-600 outline-none focus:border-primary resize-none transition-colors"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && e.metaKey) handleAddKey();
                      if (e.key === 'Escape') setIsAddingKey(false);
                    }}
                  />
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <button
                      onClick={handleAddKey}
                      disabled={!newKey.trim() || savingKey === '__new__'}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-primary text-black text-xs font-bold rounded hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                      <Check size={12} />
                      Save
                    </button>
                    <button
                      onClick={() => setIsAddingKey(false)}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-divider text-gray-500 text-xs rounded hover:text-white transition-colors"
                    >
                      <X size={12} />
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* KV table */}
              <div className="flex-1 overflow-y-auto">
                {isLoadingEntries && (
                  <div className="p-16 text-center text-gray-600">
                    <RefreshCcw size={22} className="animate-spin mx-auto opacity-40 mb-3" />
                    <div className="text-xs">Connecting to bucket…</div>
                  </div>
                )}

                {!isLoadingEntries && filteredEntries.length === 0 && (
                  <div className="p-16 text-center text-gray-600 text-sm italic">
                    {entries.size === 0
                      ? 'This bucket is empty'
                      : 'No keys match your filter'}
                  </div>
                )}

                {!isLoadingEntries && filteredEntries.length > 0 && (
                  <table className="w-full text-left border-collapse" style={{ tableLayout: 'fixed' }}>
                    <thead className="sticky top-0 bg-black/80 backdrop-blur-sm z-10">
                      <tr className="border-b border-divider">
                        <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 w-60">Key</th>
                        <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500">Value</th>
                        <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 w-24 text-right">Updated</th>
                        <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-500 w-24 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map(entry => {
                        const { valid: isJson } = tryParseJson(entry.value);
                        const isEditing = editingKey === entry.key;
                        const isConfirmDelete = confirmDeleteKey === entry.key;

                        return (
                          <tr
                            key={entry.key}
                            className="border-b border-divider/40 hover:bg-white/[0.025] transition-colors group"
                          >
                            {/* Key column */}
                            <td className="px-5 py-3 align-top">
                              <div className="flex items-start gap-2 min-w-0">
                                <span className="font-mono text-xs text-primary truncate" title={entry.key}>
                                  {entry.key}
                                </span>
                                {isJson && (
                                  <span className="flex-shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 tracking-wide">
                                    JSON
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Value column */}
                            <td className="px-5 py-3 align-top max-w-0">
                              {isEditing ? (
                                <textarea
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  autoFocus
                                  rows={Math.min(12, Math.max(2, (editValue.match(/\n/g) ?? []).length + 2))}
                                  className="w-full bg-black/60 border border-primary/60 rounded px-2.5 py-2 text-xs font-mono text-white outline-none focus:border-primary resize-y transition-colors"
                                  onKeyDown={e => {
                                    if (e.key === 'Escape') setEditingKey(null);
                                    // Shift+Enter always inserts newline; bare Enter saves for single-line strings
                                    if (e.key === 'Enter' && !e.shiftKey && !isJson && !editValue.includes('\n')) {
                                      e.preventDefault();
                                      handleSaveEdit(entry.key);
                                    }
                                  }}
                                />
                              ) : isJson ? (
                                <div
                                  className="cursor-text overflow-hidden"
                                  onClick={() => { setEditingKey(entry.key); setEditValue(entry.value); setConfirmDeleteKey(null); }}
                                  title="Click to edit"
                                >
                                  <JsonView value={entry.value} />
                                </div>
                              ) : (
                                <span
                                  className="font-mono text-xs text-gray-300 block truncate cursor-text hover:text-white transition-colors"
                                  onClick={() => { setEditingKey(entry.key); setEditValue(entry.value); setConfirmDeleteKey(null); }}
                                  title={entry.value || undefined}
                                >
                                  {entry.value || <em className="text-gray-600 not-italic">empty</em>}
                                </span>
                              )}
                            </td>

                            {/* Timestamp column */}
                            <td className="px-5 py-3 align-top text-right">
                              <span className="text-[10px] text-gray-600 font-mono whitespace-nowrap">
                                {formatAge(entry.created)}
                              </span>
                            </td>

                            {/* Actions column */}
                            <td className="px-5 py-3 align-top">
                              {isEditing ? (
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => handleSaveEdit(entry.key)}
                                    disabled={savingKey === entry.key}
                                    className="p-1.5 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-40"
                                    title="Save"
                                  >
                                    {savingKey === entry.key
                                      ? <RefreshCcw size={12} className="animate-spin" />
                                      : <Check size={12} />
                                    }
                                  </button>
                                  <button
                                    onClick={() => setEditingKey(null)}
                                    className="p-1.5 rounded hover:bg-active text-gray-500 hover:text-white transition-colors"
                                    title="Cancel (Esc)"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              ) : isConfirmDelete ? (
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => handleDelete(entry.key)}
                                    className="p-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                                    title="Confirm delete"
                                  >
                                    <Check size={12} />
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteKey(null)}
                                    className="p-1.5 rounded hover:bg-active text-gray-500 hover:text-white transition-colors"
                                    title="Cancel"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => {
                                      setEditingKey(entry.key);
                                      setEditValue(entry.value);
                                      setConfirmDeleteKey(null);
                                    }}
                                    className="p-1.5 rounded hover:bg-active text-gray-600 hover:text-primary transition-colors"
                                    title="Edit value"
                                  >
                                    <Edit3 size={12} />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setConfirmDeleteKey(entry.key);
                                      setEditingKey(null);
                                    }}
                                    className="p-1.5 rounded hover:bg-active text-gray-600 hover:text-red-500 transition-colors"
                                    title="Delete key"
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
                )}
              </div>

              {/* Footer status bar */}
              <div className="px-5 py-2 border-t border-divider bg-black/20 flex items-center justify-between flex-shrink-0">
                <span className="text-[10px] text-gray-600 font-mono">
                  {filteredEntries.length} of {entries.size} key{entries.size !== 1 ? 's' : ''}
                  {filter && <> &middot; filtered by <em className="not-italic text-gray-500">"{filter}"</em></>}
                </span>
                {maxRevision > 0 && (
                  <span className="text-[10px] text-gray-700 font-mono">
                    rev #{maxRevision}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Cortex;
