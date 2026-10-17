import { useEffect, useState, useRef } from 'react';
import {
  FolderArchive,
  Upload,
  FileText,
  Trash2,
  Loader2,
  RefreshCw,
  Plus
} from 'lucide-react';
import { api } from '../api/client';
import { LibraryListing, RoadmapPhase } from '../types/api';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LibraryView() {
  const [library, setLibrary] = useState<LibraryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  const [roadmap, setRoadmap] = useState<RoadmapPhase[]>([]);
  const [selectedSpecialist, setSelectedSpecialist] = useState<string>('conops');

  const refInputRef = useRef<HTMLInputElement>(null);
  const exInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [lib, rm] = await Promise.all([api.fetchLibrary(), api.fetchRoadmap()]);
      setLibrary(lib);
      setRoadmap(rm);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load library');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleReferenceUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.uploadReference(file.name, file);
      setNotice(`✔ Uploaded reference: ${res.filename}`);
      await load();
      setTimeout(() => setNotice(null), 4000);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to upload reference');
    } finally {
      setUploading(false);
    }
  };

  const handleExampleUpload = async (specialistId: string, file: File) => {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.uploadExample(specialistId, file.name, file);
      setNotice(`✔ Uploaded example for [${specialistId.toUpperCase()}]: ${res.filename}`);
      await load();
      setTimeout(() => setNotice(null), 4000);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to upload example');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteReference = async (name: string) => {
    if (!window.confirm(`Are you sure you want to delete reference "${name}"?`)) return;
    setDeletingFile(name);
    try {
      await api.deleteReference(name);
      setNotice(`Removed reference "${name}"`);
      await load();
      setTimeout(() => setNotice(null), 4000);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete reference');
    } finally {
      setDeletingFile(null);
    }
  };

  const handleDeleteExample = async (specialistId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete quality example "${name}"?`)) return;
    setDeletingFile(`${specialistId}:${name}`);
    try {
      await api.deleteExample(specialistId, name);
      setNotice(`Removed example "${name}" from [${specialistId.toUpperCase()}]`);
      await load();
      setTimeout(() => setNotice(null), 4000);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete example');
    } finally {
      setDeletingFile(null);
    }
  };

  if (loading && !library) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading project library…
      </div>
    );
  }

  const exampleSpecialists = Object.keys(library?.examples ?? {});

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <FolderArchive className="h-6 w-6 text-sky-400" />
            <div>
              <h1 className="text-lg font-bold text-slate-100">Project Library</h1>
              <p className="text-xs text-slate-400">
                Manage reference documents (ICDs, datasheets, spec sheets) and custom quality examples.
              </p>
            </div>
          </div>
          <button
            onClick={() => void load()}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </header>

        {error && (
          <p className="rounded-lg border border-rose-900 bg-rose-950/50 px-3 py-2 text-sm text-rose-200" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-lg border border-emerald-900 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-200" role="status">
            {notice}
          </p>
        )}

        {/* 1. Reference Documents Section */}
        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-200">Reference Documents</h2>
              <p className="text-xs text-slate-400">
                Stored in <code className="font-mono text-slate-300">reference/</code>. The agent inspects these to ground designs in real hardware specifications.
              </p>
            </div>

            <div>
              <input
                type="file"
                ref={refInputRef}
                accept=".md,.txt,.pdf,.csv,.png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void handleReferenceUpload(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => refInputRef.current?.click()}
                disabled={uploading}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-sky-700 px-3.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload Reference Document
              </button>
            </div>
          </div>

          {/* Reference Drop Zone */}
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void handleReferenceUpload(f);
            }}
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-700 bg-slate-950/40 p-4 text-center hover:border-sky-500 transition-colors"
          >
            <FileText className="h-6 w-6 text-slate-500 mb-1" />
            <p className="text-xs text-slate-300">
              Drag &amp; drop reference documents here (.pdf, .txt, .md, .csv, images)
            </p>
          </div>

          {/* Reference List */}
          {(!library?.references || library.references.length === 0) ? (
            <p className="py-2 text-center text-xs text-slate-500">No reference documents uploaded yet.</p>
          ) : (
            <div className="divide-y divide-slate-800 border-t border-slate-800">
              {library.references.map(ref => (
                <div key={ref.name} className="flex min-h-[44px] items-center justify-between gap-3 py-2">
                  <div className="flex items-center gap-2.5 truncate">
                    <FileText className="h-4 w-4 text-sky-400 shrink-0" />
                    <span className="font-mono text-xs text-slate-200 truncate">{ref.name}</span>
                    <span className="text-[11px] text-slate-500 shrink-0">{formatBytes(ref.size)}</span>
                  </div>
                  <button
                    onClick={() => void handleDeleteReference(ref.name)}
                    disabled={deletingFile === ref.name}
                    aria-label={`Delete ${ref.name}`}
                    className="flex min-h-[44px] items-center gap-1 rounded px-2.5 text-xs text-rose-400 hover:bg-rose-950/40 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Remove</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 2. Specialist Quality Examples Section */}
        <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-200">Custom Quality Examples</h2>
              <p className="text-xs text-slate-400">
                Stored in <code className="font-mono text-slate-300">examples/&lt;specialist&gt;/</code>. Used by specialists &amp; critic to match standard of quality.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={selectedSpecialist}
                onChange={e => setSelectedSpecialist(e.target.value)}
                aria-label="Select specialist to upload example for"
                className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                {roadmap.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <input
                type="file"
                ref={exInputRef}
                accept=".md,.txt,.pdf"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void handleExampleUpload(selectedSpecialist, f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => exInputRef.current?.click()}
                disabled={uploading}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-sky-700 px-3.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Example
              </button>
            </div>
          </div>

          {exampleSpecialists.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">
              No custom quality examples uploaded yet. Drop example documents in the Development view or use the button above.
            </p>
          ) : (
            <div className="space-y-4 pt-2">
              {exampleSpecialists.map(specId => {
                const files = library?.examples[specId] || [];
                const phaseName = roadmap.find(p => p.id === specId)?.name ?? specId.toUpperCase();
                return (
                  <div key={specId} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                      <span className="font-bold text-xs uppercase tracking-wider text-sky-400">
                        {phaseName} <span className="font-mono text-slate-500 text-[10px]">({specId})</span>
                      </span>
                      <span className="text-[11px] text-slate-400">{files.length} example{files.length === 1 ? '' : 's'}</span>
                    </div>

                    <div className="divide-y divide-slate-800/60">
                      {files.map(ex => (
                        <div key={ex.name} className="flex min-h-[44px] items-center justify-between gap-2 py-1">
                          <div className="flex items-center gap-2 truncate">
                            <FileText className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            <span className="font-mono text-xs text-slate-200 truncate">{ex.name}</span>
                            <span className="text-[11px] text-slate-500 shrink-0">{formatBytes(ex.size)}</span>
                          </div>
                          <button
                            onClick={() => void handleDeleteExample(specId, ex.name)}
                            disabled={deletingFile === `${specId}:${ex.name}`}
                            aria-label={`Delete ${ex.name}`}
                            className="flex min-h-[44px] items-center gap-1 rounded px-2 text-xs text-rose-400 hover:bg-rose-950/40 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Remove</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
