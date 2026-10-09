import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  ExternalLink,
  PackageSearch,
  Search,
  Layers,
  Truck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Edit2,
  Check,
  X,
  FileSpreadsheet
} from 'lucide-react';
import { api } from '../api/client';
import { BomData, BOM_STATUSES, SubsystemTradeStudy } from '../types/api';

const money = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function sourceUrl(src: string): string | null {
  const m = src.match(/\((https?:\/\/[^)]+)\)/) ?? src.match(/^(https?:\/\/\S+)/);
  return m ? m[1] : null;
}

const STATUS_TONE: Record<string, string> = {
  Identified: 'bg-slate-800 text-slate-300',
  Ordered: 'bg-sky-950/80 text-sky-300 border border-sky-800/40',
  Shipped: 'bg-indigo-950/80 text-indigo-300 border border-indigo-800/40',
  Received: 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/40',
  'Bench Tested': 'bg-teal-950/80 text-teal-200 border border-teal-700/50'
};

interface EditState {
  itemId: string;
  qty: number;
  tracking: string;
  actualTotal: string;
}

export type PartsSubTab = 'sourcing' | 'bom' | 'parts';

export default function PartsView() {
  const [subTab, setSubTab] = useState<PartsSubTab>('bom');
  const [bomData, setBomData] = useState<BomData | null>(null);
  const [tradeStudies, setTradeStudies] = useState<SubsystemTradeStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [subsystemFilter, setSubsystemFilter] = useState('all');

  // Editing state for procurement
  const [edit, setEdit] = useState<EditState | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [bData, tData] = await Promise.all([
        api.fetchBom().catch(() => null),
        api.fetchTradeStudy().catch(() => [])
      ]);
      setBomData(bData);
      setTradeStudies(tData || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load parts & sourcing data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const subsystems = useMemo(() => {
    const fromBom = (bomData?.items ?? []).map(i => i.subsystem).filter(Boolean);
    const fromTrade = (tradeStudies ?? []).map(s => `${s.subsystemId}: ${s.subsystemName}`);
    return Array.from(new Set([...fromBom, ...fromTrade])).sort();
  }, [bomData, tradeStudies]);

  const visibleBomItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (bomData?.items ?? []).filter(item => {
      if (subsystemFilter !== 'all' && item.subsystem !== subsystemFilter) return false;
      if (!q) return true;
      return (
        item.id.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tracking.toLowerCase().includes(q)
      );
    });
  }, [bomData, searchQuery, subsystemFilter]);

  const patchItem = async (itemId: string, updates: Parameters<typeof api.updateBomItem>[1]) => {
    setSavingId(itemId);
    setError(null);
    try {
      const updated = await api.updateBomItem(itemId, updates);
      setBomData(prev => (prev ? { ...updated, tradeStudy: prev.tradeStudy } : (updated as BomData)));
    } catch (err: any) {
      setError(err?.message ?? 'Update failed');
    } finally {
      setSavingId(null);
    }
  };

  const commitEdit = async () => {
    if (!edit) return;
    const updates: Parameters<typeof api.updateBomItem>[1] = {
      qty: edit.qty,
      tracking: edit.tracking.trim() || '—'
    };
    const actual = edit.actualTotal.trim();
    if (actual === '' || actual === '—') updates.actualTotal = null;
    else {
      const n = Number(actual.replace(/[$,]/g, ''));
      if (!Number.isNaN(n)) updates.actualTotal = n;
    }
    await patchItem(edit.itemId, updates);
    setEdit(null);
  };

  if (loading && !bomData && tradeStudies.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Loading parts, BOM, and sourcing data…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      {/* Top Header & Sub-Tabs Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/60 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <PackageSearch className="h-6 w-6 text-sky-400" />
              Parts & Sourcing Hub
            </h1>
            <p className="text-xs text-slate-400">
              Three-tier engineering hub: Candidate Sourcing, Engineering BOM, and Procurement Tracker.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => void loadData()}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-4 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Sub-Tab Navigation Bar */}
        <div className="mt-4 flex items-center gap-2 border-t border-slate-800/60 pt-3">
          <button
            onClick={() => setSubTab('sourcing')}
            className={`flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
              subTab === 'sourcing'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Layers className="h-4 w-4" />
            1. Sourcing (Trade Studies)
            {tradeStudies.length > 0 && (
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                {tradeStudies.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setSubTab('bom')}
            className={`flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
              subTab === 'bom'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <FileSpreadsheet className="h-4 w-4" />
            2. BOM (Engineering Specs)
            {bomData && (
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                {bomData.items.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setSubTab('parts')}
            className={`flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
              subTab === 'parts'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Truck className="h-4 w-4" />
            3. Parts (Logistics & Actuals)
            {bomData && (
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                {Math.round(bomData.financials.procurementProgressPercent)}%
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Financial Rollup Metric Banner (shown on BOM and Parts) */}
      {bomData && subTab !== 'sourcing' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4 border-b border-slate-800/60 bg-slate-900/40">
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Estimated Budget</div>
            <div className="text-xl font-bold text-slate-100">{money(bomData.financials.totalEstimated)}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Actual Committed Spend</div>
            <div className="text-xl font-bold text-sky-400">{money(bomData.financials.totalActual)}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Net Budget Variance</div>
            <div className={`text-xl font-bold ${bomData.financials.netVariance > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {bomData.financials.netVariance > 0 ? '+' : ''}
              {money(bomData.financials.netVariance)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Procurement Progress</div>
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, bomData.financials.procurementProgressPercent))}%` }}
                />
              </div>
              <span className="text-sm font-bold text-slate-200">
                {Math.round(bomData.financials.procurementProgressPercent)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-rose-800/60 bg-rose-950/40 p-3 text-xs text-rose-300 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {/* SUB-TAB 1: SOURCING (TRADE STUDIES) */}
        {subTab === 'sourcing' && (
          <div className="space-y-6 max-w-6xl mx-auto">
            {tradeStudies.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center">
                <Layers className="mx-auto h-12 w-12 text-slate-600 mb-3" />
                <h3 className="text-base font-semibold text-slate-200">No Candidate Trade Studies Found</h3>
                <p className="mt-1 text-sm text-slate-400 max-w-md mx-auto">
                  Trade studies evaluate component candidates against system requirements before selection. Drafted in{' '}
                  <code className="text-sky-300">docs/TRADE_STUDY.md</code>.
                </p>
              </div>
            ) : (
              tradeStudies.map((study, idx) => (
                <div key={idx} className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 shadow-sm space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs font-mono uppercase tracking-wider text-sky-400 font-semibold">
                        {study.subsystemId}
                      </div>
                      <h2 className="text-lg font-bold text-slate-100">{study.subsystemName}</h2>
                    </div>
                  </div>

                  {study.requirements.length > 0 && (
                    <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800/80">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                        Governing Requirements
                      </div>
                      <ul className="list-disc list-inside space-y-1 text-xs text-slate-300">
                        {study.requirements.map((req, rIdx) => (
                          <li key={rIdx}>{req}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Candidates Comparison Table */}
                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
                      <thead className="bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider">
                        <tr>
                          <th className="px-3 py-2.5">Candidate</th>
                          <th className="px-3 py-2.5">Specifications</th>
                          <th className="px-3 py-2.5 text-center">Compliance</th>
                          <th className="px-3 py-2.5">Lead Time</th>
                          <th className="px-3 py-2.5 text-right">Est. Price</th>
                          <th className="px-3 py-2.5 text-center">Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 bg-slate-900/40">
                        {study.candidates.map((cand, cIdx) => (
                          <tr key={cIdx} className="hover:bg-slate-850 transition-colors">
                            <td className="px-3 py-2.5 font-medium text-slate-100 whitespace-nowrap">
                              {cand.candidate}
                            </td>
                            <td className="px-3 py-2.5 text-slate-300">{cand.specs}</td>
                            <td className="px-3 py-2.5 text-center">
                              {cand.satisfies === 'compliant' && (
                                <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800/40">
                                  <CheckCircle2 className="h-3 w-3" /> Compliant
                                </span>
                              )}
                              {cand.satisfies === 'warning' && (
                                <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-800/40">
                                  <AlertTriangle className="h-3 w-3" /> Warning
                                </span>
                              )}
                              {cand.satisfies === 'non_compliant' && (
                                <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold bg-rose-950 text-rose-300 border border-rose-800/40">
                                  <XCircle className="h-3 w-3" /> Non-Compliant
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{cand.leadTime}</td>
                            <td className="px-3 py-2.5 text-right font-mono font-medium text-slate-200">
                              {money(cand.estPrice)}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {sourceUrl(cand.source) ? (
                                <a
                                  href={sourceUrl(cand.source)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
                                >
                                  Link <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {study.rationale && (
                    <div className="rounded-lg bg-sky-950/20 border border-sky-800/30 p-3">
                      <div className="text-[11px] font-semibold text-sky-300 uppercase tracking-wider mb-1">
                        Selection Rationale
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">{study.rationale}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* SUB-TAB 2: BOM (ENGINEERING SPECS & BUDGET) */}
        {subTab === 'bom' && (
          <div className="space-y-4 max-w-7xl mx-auto">
            {/* Filter toolbar */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter BOM components..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>

              {subsystems.length > 0 && (
                <select
                  value={subsystemFilter}
                  onChange={e => setSubsystemFilter(e.target.value)}
                  className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  <option value="all">All Subsystems ({bomData?.items.length ?? 0})</option>
                  {subsystems.map(s => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Engineering BOM Table */}
            {!bomData || visibleBomItems.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center">
                <FileSpreadsheet className="mx-auto h-12 w-12 text-slate-600 mb-3" />
                <p className="text-sm text-slate-300 font-semibold">No BOM items found.</p>
                <p className="text-xs text-slate-500 mt-1">
                  Drafted in <code className="text-sky-300">docs/BOM.md</code> by the BOM Specialist.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-3">Subsystem</th>
                      <th className="px-3 py-3">Item ID</th>
                      <th className="px-3 py-3">Description</th>
                      <th className="px-3 py-3 text-center">Qty</th>
                      <th className="px-3 py-3 text-right">Est. Unit</th>
                      <th className="px-3 py-3 text-right">Est. Total</th>
                      <th className="px-3 py-3 text-center">Source Link</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-900/40">
                    {visibleBomItems.map(item => (
                      <tr key={item.id} className="hover:bg-slate-850 transition-colors">
                        <td className="px-3 py-2.5 font-medium text-slate-300 whitespace-nowrap">
                          {item.subsystem}
                        </td>
                        <td className="px-3 py-2.5 font-mono font-bold text-sky-400 whitespace-nowrap">
                          {item.id}
                        </td>
                        <td className="px-3 py-2.5 text-slate-200">{item.description}</td>
                        <td className="px-3 py-2.5 text-center font-mono font-bold text-slate-100">
                          {item.qty}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                          {money(item.estUnit)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-100">
                          {money(item.estTotal)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {sourceUrl(item.source) ? (
                            <a
                              href={sourceUrl(item.source)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
                            >
                              Source <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* SUB-TAB 3: PARTS (PROCUREMENT LOGISTICS & ACTUALS) */}
        {subTab === 'parts' && (
          <div className="space-y-4 max-w-7xl mx-auto">
            {/* Filter toolbar */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter parts by tracking or description..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </div>

              {subsystems.length > 0 && (
                <select
                  value={subsystemFilter}
                  onChange={e => setSubsystemFilter(e.target.value)}
                  className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  <option value="all">All Subsystems ({bomData?.items.length ?? 0})</option>
                  {subsystems.map(s => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Interactive Logistics Table */}
            {!bomData || visibleBomItems.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center">
                <Truck className="mx-auto h-12 w-12 text-slate-600 mb-3" />
                <p className="text-sm text-slate-300 font-semibold">No parts found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-3">Item ID</th>
                      <th className="px-3 py-3">Description</th>
                      <th className="px-3 py-3 text-center">Status</th>
                      <th className="px-3 py-3 text-center">Qty</th>
                      <th className="px-3 py-3">Tracking / Carrier</th>
                      <th className="px-3 py-3 text-right">Actual Total</th>
                      <th className="px-3 py-3 text-right">Variance</th>
                      <th className="px-3 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-900/40">
                    {visibleBomItems.map(item => {
                      const isEditing = edit?.itemId === item.id;
                      const isSaving = savingId === item.id;

                      return (
                        <tr key={item.id} className="hover:bg-slate-850 transition-colors">
                          <td className="px-3 py-2.5 font-mono font-bold text-sky-400 whitespace-nowrap">
                            {item.id}
                          </td>
                          <td className="px-3 py-2.5 text-slate-200">{item.description}</td>

                          {/* Status Dropdown */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            <select
                              value={item.status}
                              disabled={isSaving}
                              onChange={e => patchItem(item.id, { status: e.target.value })}
                              aria-label={`Status for ${item.id}`}
                              className={`rounded px-2.5 py-1 text-[11px] font-semibold focus:outline-none ${
                                STATUS_TONE[item.status] ?? 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {BOM_STATUSES.map(st => (
                                <option key={st} value={st} className="bg-slate-900 text-slate-200">
                                  {st}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Editable Qty */}
                          <td className="px-3 py-2.5 text-center font-mono">
                            {isEditing ? (
                              <input
                                type="number"
                                min={1}
                                value={edit.qty}
                                onChange={e => setEdit({ ...edit, qty: Number(e.target.value) || 1 })}
                                className="w-16 rounded border border-sky-500 bg-slate-950 px-2 py-1 text-center font-mono text-xs text-white"
                              />
                            ) : (
                              <span className="font-bold text-slate-100">{item.qty}</span>
                            )}
                          </td>

                          {/* Tracking Number */}
                          <td className="px-3 py-2.5 font-mono text-slate-300">
                            {isEditing ? (
                              <input
                                type="text"
                                value={edit.tracking}
                                onChange={e => setEdit({ ...edit, tracking: e.target.value })}
                                placeholder="Tracking / Order #"
                                className="w-full rounded border border-sky-500 bg-slate-950 px-2 py-1 font-mono text-xs text-white"
                              />
                            ) : (
                              <span>{item.tracking || '—'}</span>
                            )}
                          </td>

                          {/* Actual Total */}
                          <td className="px-3 py-2.5 text-right font-mono font-medium text-slate-100">
                            {isEditing ? (
                              <input
                                type="text"
                                value={edit.actualTotal}
                                onChange={e => setEdit({ ...edit, actualTotal: e.target.value })}
                                placeholder="$0.00"
                                className="w-24 rounded border border-sky-500 bg-slate-950 px-2 py-1 text-right font-mono text-xs text-white"
                              />
                            ) : (
                              money(item.actualTotal)
                            )}
                          </td>

                          {/* Variance */}
                          <td className="px-3 py-2.5 text-right font-mono">
                            {item.variance === null ? (
                              <span className="text-slate-500">—</span>
                            ) : (
                              <span
                                className={`font-semibold ${
                                  item.variance > 0 ? 'text-rose-400' : 'text-emerald-400'
                                }`}
                              >
                                {item.variance > 0 ? '+' : ''}
                                {money(item.variance)}
                              </span>
                            )}
                          </td>

                          {/* Action Controls */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            {isSaving ? (
                              <Loader2 className="mx-auto h-4 w-4 animate-spin text-sky-400" />
                            ) : isEditing ? (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => void commitEdit()}
                                  title="Save changes"
                                  className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded bg-emerald-600/80 text-white hover:bg-emerald-600"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => setEdit(null)}
                                  title="Cancel"
                                  className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() =>
                                  setEdit({
                                    itemId: item.id,
                                    qty: item.qty,
                                    tracking: item.tracking,
                                    actualTotal: item.actualTotal !== null ? String(item.actualTotal) : ''
                                  })
                                }
                                title="Edit tracking & actual price"
                                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
