import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  ExternalLink,
  PackageSearch,
  Search,
  FlaskConical,
  X,
  Check
} from 'lucide-react';
import { api } from '../api/client';
import { BomData, BOM_STATUSES } from '../types/api';
import Markdown from '../components/Markdown';

const money = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Extracts a URL from either a raw URL or a markdown [label](url) cell. */
function sourceUrl(src: string): string | null {
  const m = src.match(/\((https?:\/\/[^)]+)\)/) ?? src.match(/^(https?:\/\/\S+)/);
  return m ? m[1] : null;
}

const STATUS_TONE: Record<string, string> = {
  'Identified': 'bg-slate-800 text-slate-300',
  'Ordered': 'bg-sky-950/80 text-sky-300',
  'Shipped': 'bg-indigo-950/80 text-indigo-300',
  'Received': 'bg-emerald-950/80 text-emerald-300',
  'Bench Tested': 'bg-emerald-900/80 text-emerald-200'
};

interface EditState {
  itemId: string;
  tracking: string;
  actualTotal: string;
}

export default function BomView() {
  const [data, setData] = useState<BomData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [subsystemFilter, setSubsystemFilter] = useState('all');
  const [edit, setEdit] = useState<EditState | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showTradeStudy, setShowTradeStudy] = useState(false);

  const load = async () => {
    try {
      setData(await api.fetchBom());
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load BOM');
    }
  };

  useEffect(() => { void load(); }, []);

  const subsystems = useMemo(
    () => Array.from(new Set((data?.items ?? []).map(i => i.subsystem).filter(Boolean))).sort(),
    [data]
  );

  const visibleItems = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.items ?? []).filter(item => {
      if (subsystemFilter !== 'all' && item.subsystem !== subsystemFilter) return false;
      if (!q) return true;
      return (
        item.id.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tracking.toLowerCase().includes(q)
      );
    });
  }, [data, filter, subsystemFilter]);

  const patchItem = async (itemId: string, updates: Parameters<typeof api.updateBomItem>[1]) => {
    setSavingId(itemId);
    setError(null);
    try {
      const updated = await api.updateBomItem(itemId, updates);
      setData(prev => (prev ? { ...updated, tradeStudy: prev.tradeStudy } : updated as BomData));
    } catch (err: any) {
      setError(err?.message ?? 'Update failed');
    } finally {
      setSavingId(null);
    }
  };

  const commitEdit = async () => {
    if (!edit) return;
    const updates: Parameters<typeof api.updateBomItem>[1] = { tracking: edit.tracking.trim() || '—' };
    const actual = edit.actualTotal.trim();
    if (actual === '' || actual === '—') updates.actualTotal = null;
    else {
      const n = Number(actual.replace(/[$,]/g, ''));
      if (!Number.isNaN(n)) updates.actualTotal = n;
    }
    await patchItem(edit.itemId, updates);
    setEdit(null);
  };

  if (!data && !error) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading bill of materials…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <PackageSearch className="h-10 w-10 text-slate-700" aria-hidden />
        <p className="text-sm text-slate-400">No BOM yet ({error}).</p>
        <p className="max-w-sm text-xs leading-relaxed text-slate-600">
          Ask the agent on the Development tab to “draft the BOM” once the requirements phase is approved.
        </p>
      </div>
    );
  }

  if (!data) return null;
  const fin = data.financials;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/40 px-4 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search part, ID, tracking…"
            aria-label="Search BOM items"
            className="min-h-[36px] w-56 rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none"
          />
        </div>
        <select
          value={subsystemFilter}
          onChange={e => setSubsystemFilter(e.target.value)}
          aria-label="Filter by subsystem"
          className="min-h-[36px] rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200 focus:border-sky-600 focus:outline-none"
        >
          <option value="all">All subsystems</option>
          {subsystems.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="text-slate-400">
            Est <span className="font-semibold text-slate-200">{money(fin.totalEstimated)}</span>
          </span>
          <span className="text-slate-400">
            Actual <span className="font-semibold text-slate-200">{money(fin.totalActual)}</span>
          </span>
          <span className={fin.netVariance > 0 ? 'text-rose-300' : 'text-emerald-300'}>
            {fin.netVariance > 0 ? '+' : ''}{money(fin.netVariance)} var
          </span>
          {data.tradeStudy && (
            <button
              onClick={() => setShowTradeStudy(v => !v)}
              className={`flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 font-medium transition ${
                showTradeStudy
                  ? 'border-sky-700 bg-sky-950/60 text-sky-300'
                  : 'border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Trade study
            </button>
          )}
          <button
            onClick={() => void load()}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
            aria-label="Refresh BOM"
            title="Refresh BOM"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>

      {error && (
        <p className="border-b border-rose-900/60 bg-rose-950/40 px-4 py-1.5 text-xs text-rose-300" role="alert">
          {error}
        </p>
      )}

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {showTradeStudy && data.tradeStudy ? (
          <div className="p-5">
            <Markdown content={data.tradeStudy} />
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-slate-900 text-left text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Item</th>
                <th className="px-3 py-2.5 font-semibold">Part / Description</th>
                <th className="px-3 py-2.5 font-semibold">Sub</th>
                <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Tracking #</th>
                <th className="px-3 py-2.5 text-right font-semibold">Est total</th>
                <th className="px-3 py-2.5 text-right font-semibold">Actual</th>
                <th className="px-3 py-2.5 text-right font-semibold">Variance</th>
                <th className="px-3 py-2.5" aria-label="Row actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-xs text-slate-500">
                    No items match the current filter.
                  </td>
                </tr>
              )}
              {visibleItems.map(item => {
                const isEditing = edit?.itemId === item.id;
                const saving = savingId === item.id;
                const over = (item.variance ?? 0) > 0;
                return (
                  <tr key={item.id} className="hover:bg-slate-900/50">
                    <td className="px-3 py-2 font-mono text-xs text-sky-300">{item.id}</td>
                    <td className="max-w-[260px] px-3 py-2">
                      <span className="block truncate text-slate-200" title={item.description}>{item.description}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{item.subsystem}</td>
                    <td className="px-3 py-2 text-right text-slate-300">{item.qty}</td>
                    <td className="px-3 py-2">
                      <select
                        value={item.status}
                        onChange={e => void patchItem(item.id, { status: e.target.value })}
                        disabled={saving}
                        aria-label={`Status for ${item.id}`}
                        className={`min-h-[32px] rounded-md border border-transparent px-1.5 text-xs font-semibold focus:border-sky-600 focus:outline-none ${STATUS_TONE[item.status] ?? 'bg-slate-800 text-slate-300'}`}
                      >
                        {BOM_STATUSES.map(s => <option key={s} value={s} className="bg-slate-900 text-slate-200">{s}</option>)}
                        {!BOM_STATUSES.includes(item.status as any) && <option value={item.status}>{item.status}</option>}
                      </select>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-300">
                      {isEditing ? (
                        <input
                          value={edit.tracking}
                          onChange={e => setEdit({ ...edit, tracking: e.target.value })}
                          aria-label={`Tracking number for ${item.id}`}
                          className="w-28 rounded-md border border-sky-700 bg-slate-950 px-1.5 py-1 text-xs focus:outline-none"
                        />
                      ) : (
                        item.tracking || '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">{money(item.estTotal)}</td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {isEditing ? (
                        <input
                          value={edit.actualTotal}
                          onChange={e => setEdit({ ...edit, actualTotal: e.target.value })}
                          aria-label={`Actual total for ${item.id}`}
                          className="w-20 rounded-md border border-sky-700 bg-slate-950 px-1.5 py-1 text-right text-xs focus:outline-none"
                        />
                      ) : (
                        money(item.actualTotal)
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right text-xs font-medium ${item.variance === null ? 'text-slate-600' : over ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {item.variance === null ? '—' : `${over ? '+' : ''}${money(item.variance)}`}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {saving ? (
                        <Loader2 className="ml-auto h-4 w-4 animate-spin text-sky-400" aria-hidden />
                      ) : isEditing ? (
                        <span className="flex justify-end gap-1">
                          <button
                            onClick={() => void commitEdit()}
                            className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-500"
                            aria-label={`Save ${item.id}`}
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button
                            onClick={() => setEdit(null)}
                            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-700 text-slate-400 hover:bg-slate-800"
                            aria-label={`Cancel edit for ${item.id}`}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </span>
                      ) : (
                        <span className="flex justify-end gap-1">
                          {sourceUrl(item.source) && (
                            <a
                              href={sourceUrl(item.source)!}
                              target="_blank"
                              rel="noreferrer"
                              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-sky-300"
                              aria-label={`Open source link for ${item.id}`}
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            </a>
                          )}
                          <button
                            onClick={() => setEdit({ itemId: item.id, tracking: item.tracking === '—' ? '' : item.tracking, actualTotal: item.actualTotal === null ? '' : String(item.actualTotal) })}
                            className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
                          >
                            Edit
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
