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
  Identified: 'bg-[#11151d] text-[#a8b3c4]',
  Ordered: 'bg-violet-950/80 text-violet-300 border border-violet-700/40',
  Shipped: 'bg-violet-950/80 text-violet-300 border border-violet-700/40',
  Received: 'bg-[#2e1065] text-[#e8edf5] border border-[#8b5cf6]/40',
  'Bench Tested': 'bg-teal-950/80 text-teal-200 border border-teal-700/50',
  Consumed: 'bg-purple-950/80 text-purple-300 border border-purple-800/40'
};

function getTrackingUrl(tracking: string): string | null {
  const clean = tracking.trim().replace(/^#/, '');
  if (!clean || clean === '—' || clean === '-') return null;
  if (/^https?:\/\//i.test(clean)) return clean;
  if (/^1Z[0-9A-Z]{16}$/i.test(clean)) return `https://www.ups.com/track?tracknum=${encodeURIComponent(clean)}`;
  if (/^\d{12}$|^\d{15}$/i.test(clean)) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(clean)}`;
  if (/^9\d{19,21}$/i.test(clean)) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(clean)}`;
  if (/^\d{10}$/i.test(clean)) return `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(clean)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(clean + ' tracking')}`;
}

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
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[#6e7d92]" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Loading parts, BOM, and sourcing data…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#05070c] text-[#e8edf5]">
      {/* Top Header & Sub-Tabs Navigation */}
      <header className="border-b border-[#2a3342] bg-[#0d1017]/70 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <PackageSearch className="h-6 w-6 text-violet-400" />
              Parts & Sourcing Hub
            </h1>
            <p className="text-xs text-[#a8b3c4]">
              Three-tier engineering hub: Candidate Sourcing, Engineering BOM, and Procurement Tracker.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => void loadData()}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#3b4658] bg-[#11151d]/80 px-4 text-xs font-medium text-[#a8b3c4] hover:bg-[#171c26] transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Sub-Tab Navigation Bar */}
        <div className="mt-4 flex items-center gap-2 border-t border-[#2a3342]/60 pt-3">
          <button
            onClick={() => setSubTab('sourcing')}
            className={`flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
              subTab === 'sourcing'
                ? 'bg-violet-950/40 text-violet-300 border border-violet-600/40'
                : 'text-[#a8b3c4] hover:text-[#e8edf5] hover:bg-[#11151d]/50'
            }`}
          >
            <Layers className="h-4 w-4" />
            1. Sourcing (Trade Studies)
            {tradeStudies.length > 0 && (
              <span className="rounded-full bg-[#11151d] px-2 py-0.5 text-[10px] text-[#a8b3c4]">
                {tradeStudies.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setSubTab('bom')}
            className={`flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
              subTab === 'bom'
                ? 'bg-violet-950/40 text-violet-300 border border-violet-600/40'
                : 'text-[#a8b3c4] hover:text-[#e8edf5] hover:bg-[#11151d]/50'
            }`}
          >
            <FileSpreadsheet className="h-4 w-4" />
            2. BOM (Engineering Specs)
            {bomData && (
              <span className="rounded-full bg-[#11151d] px-2 py-0.5 text-[10px] text-[#a8b3c4]">
                {bomData.items.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setSubTab('parts')}
            className={`flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
              subTab === 'parts'
                ? 'bg-violet-950/40 text-violet-300 border border-violet-600/40'
                : 'text-[#a8b3c4] hover:text-[#e8edf5] hover:bg-[#11151d]/50'
            }`}
          >
            <Truck className="h-4 w-4" />
            3. Parts (Logistics & Actuals)
            {bomData && (
              <span className="rounded-full bg-[#11151d] px-2 py-0.5 text-[10px] text-[#a8b3c4]">
                {Math.round(bomData.financials.procurementProgressPercent)}%
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Financial Rollup Metric Banner (shown on BOM and Parts) */}
      {bomData && subTab !== 'sourcing' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4 border-b border-[#2a3342]/60 bg-[#0d1017]/70">
          <div className="rounded-lg border border-[#2a3342] bg-[#0d1017]/70 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#a8b3c4]">Total Estimated Budget</div>
            <div className="text-xl font-bold text-[#e8edf5]">{money(bomData.financials.totalEstimated)}</div>
          </div>
          <div className="rounded-lg border border-[#2a3342] bg-[#0d1017]/70 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#a8b3c4]">Actual Committed Spend</div>
            <div className="text-xl font-bold text-violet-400">{money(bomData.financials.totalActual)}</div>
          </div>
          <div className="rounded-lg border border-[#2a3342] bg-[#0d1017]/70 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#a8b3c4]">Net Budget Variance</div>
            <div className={`text-xl font-bold ${bomData.financials.netVariance > 0 ? 'text-rose-400' : 'text-[#e8edf5]'}`}>
              {bomData.financials.netVariance > 0 ? '+' : ''}
              {money(bomData.financials.netVariance)}
            </div>
          </div>
          <div className="rounded-lg border border-[#2a3342] bg-[#0d1017]/70 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#a8b3c4]">Procurement Progress</div>
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 rounded-full bg-[#11151d] overflow-hidden">
                <div
                  className="h-full bg-[#7c3aed]/60 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, bomData.financials.procurementProgressPercent))}%` }}
                />
              </div>
              <span className="text-sm font-bold text-[#e8edf5]">
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
              <div className="rounded-xl border border-[#2a3342] bg-[#0d1017]/70 p-8 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#ff2a3c]/45 bg-[#1a0208]">
                  <Layers className="h-7 w-7 text-[#ff2a3c]" />
                </div>
                <h3 className="text-base font-semibold text-[#e8edf5]">No component options compared yet</h3>
                <p className="mt-1 text-sm text-[#a8b3c4] max-w-md mx-auto leading-relaxed">
                  The AI compares candidate parts (like different motors or batteries) against your
                  project requirements before picking the best one. Ask it to{' '}
                  <span className="font-medium text-[#ffb3bd]">"compare options for the motor"</span> in the Studio.
                </p>
              </div>
            ) : (
              tradeStudies.map((study, idx) => (
                <div key={idx} className="rounded-xl border border-[#2a3342] bg-[#0d1017]/70 p-5 shadow-sm space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs font-mono uppercase tracking-wider text-violet-400 font-semibold">
                        {study.subsystemId}
                      </div>
                      <h2 className="text-lg font-bold text-[#e8edf5]">{study.subsystemName}</h2>
                    </div>
                  </div>

                  {study.requirements.length > 0 && (
                    <div className="rounded-lg bg-[#05070c]/60 p-3 border border-[#2a3342]/80">
                      <div className="text-xs font-semibold text-[#a8b3c4] uppercase tracking-wider mb-1.5">
                        Governing Requirements
                      </div>
                      <ul className="list-disc list-inside space-y-1 text-xs text-[#a8b3c4]">
                        {study.requirements.map((req, rIdx) => (
                          <li key={rIdx}>{req}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Candidates Comparison Table */}
                  <div className="overflow-x-auto rounded-lg border border-[#2a3342]">
                    <table className="min-w-full divide-y divide-[#2a3342] text-left text-xs">
                      <thead className="bg-[#05070c] text-[#a8b3c4] font-semibold uppercase tracking-wider">
                        <tr>
                          <th className="px-3 py-2.5">Candidate</th>
                          <th className="px-3 py-2.5">Specifications</th>
                          <th className="px-3 py-2.5 text-center">Compliance</th>
                          <th className="px-3 py-2.5">Lead Time</th>
                          <th className="px-3 py-2.5 text-right">Est. Price</th>
                          <th className="px-3 py-2.5 text-center">Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#2a3342] bg-[#0d1017]/70">
                        {study.candidates.map((cand, cIdx) => (
                          <tr key={cIdx} className="hover:bg-[#171c26] transition-colors">
                            <td className="px-3 py-2.5 font-medium text-[#e8edf5] whitespace-nowrap">
                              {cand.candidate}
                            </td>
                            <td className="px-3 py-2.5 text-[#a8b3c4]">{cand.specs}</td>
                            <td className="px-3 py-2.5 text-center">
                              {cand.satisfies === 'compliant' && (
                                <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold bg-[#2e1065] text-[#e8edf5] border border-[#8b5cf6]/40">
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
                            <td className="px-3 py-2.5 text-[#a8b3c4] whitespace-nowrap">{cand.leadTime}</td>
                            <td className="px-3 py-2.5 text-right font-mono font-medium text-[#e8edf5]">
                              {money(cand.estPrice)}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {sourceUrl(cand.source) ? (
                                <a
                                  href={sourceUrl(cand.source)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300"
                                >
                                  Link <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span className="text-[#6e7d92]">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {study.rationale && (
                    <div className="rounded-lg bg-violet-950/20 border border-violet-800/30 p-3">
                      <div className="text-[11px] font-semibold text-violet-300 uppercase tracking-wider mb-1">
                        Selection Rationale
                      </div>
                      <p className="text-xs text-[#a8b3c4] leading-relaxed">{study.rationale}</p>
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
                <Search className="absolute left-3 top-3.5 h-4 w-4 text-[#a8b3c4]" />
                <input
                  type="text"
                  placeholder="Filter BOM components..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-[#2a3342] bg-[#0d1017] py-2.5 pl-9 pr-3 text-xs text-[#e8edf5] placeholder-[#6e7d92] focus:border-[#ff2a3c] focus:outline-none"
                />
              </div>

              {subsystems.length > 0 && (
                <select
                  value={subsystemFilter}
                  onChange={e => setSubsystemFilter(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-[#2a3342] bg-[#0d1017] px-3 py-2 text-xs text-[#e8edf5] focus:border-[#ff2a3c] focus:outline-none cursor-pointer"
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
              <div className="rounded-xl border border-[#2a3342] bg-[#0d1017]/70 p-8 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#ff2a3c]/45 bg-[#1a0208]">
                  <FileSpreadsheet className="h-7 w-7 text-[#ff2a3c]" />
                </div>
                <p className="text-sm text-[#e8edf5] font-semibold">Your shopping list isn't ready yet</p>
                <p className="text-xs text-[#a8b3c4] mt-1.5 max-w-md mx-auto leading-relaxed">
                  The AI drafts the full parts list — exact parts, quantities, and costs — after the
                  design is approved. Ask it to <span className="font-medium text-[#ffb3bd]">"draft the BOM"</span> in the Studio.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#2a3342]">
                <table className="min-w-full divide-y divide-[#2a3342] text-left text-xs">
                  <thead className="bg-[#05070c] text-[#a8b3c4] font-semibold uppercase tracking-wider">
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
                  <tbody className="divide-y divide-[#2a3342] bg-[#0d1017]/70">
                    {visibleBomItems.map(item => (
                      <tr key={item.id} className="hover:bg-[#171c26] transition-colors">
                        <td className="px-3 py-2.5 font-medium text-[#a8b3c4] whitespace-nowrap">
                          {item.subsystem}
                        </td>
                        <td className="px-3 py-2.5 font-mono font-bold text-violet-400 whitespace-nowrap">
                          {item.id}
                        </td>
                        <td className="px-3 py-2.5 text-[#e8edf5]">{item.description}</td>
                        <td className="px-3 py-2.5 text-center font-mono font-bold text-[#e8edf5]">
                          {item.qty}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[#a8b3c4]">
                          {money(item.estUnit)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-[#e8edf5]">
                          {money(item.estTotal)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {sourceUrl(item.source) ? (
                            <a
                              href={sourceUrl(item.source)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300"
                            >
                              Source <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-[#6e7d92]">—</span>
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
                <Search className="absolute left-3 top-3.5 h-4 w-4 text-[#a8b3c4]" />
                <input
                  type="text"
                  placeholder="Filter parts by tracking or description..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-[#2a3342] bg-[#0d1017] py-2.5 pl-9 pr-3 text-xs text-[#e8edf5] placeholder-[#6e7d92] focus:border-[#ff2a3c] focus:outline-none"
                />
              </div>

              {subsystems.length > 0 && (
                <select
                  value={subsystemFilter}
                  onChange={e => setSubsystemFilter(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-[#2a3342] bg-[#0d1017] px-3 py-2 text-xs text-[#e8edf5] focus:border-[#ff2a3c] focus:outline-none cursor-pointer"
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
              <div className="rounded-xl border border-[#2a3342] bg-[#0d1017]/70 p-8 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#ff2a3c]/45 bg-[#1a0208]">
                  <Truck className="h-7 w-7 text-[#ff2a3c]" />
                </div>
                <p className="text-sm text-[#e8edf5] font-semibold">Nothing tracked for shipping yet</p>
                <p className="text-xs text-[#a8b3c4] mt-1.5 max-w-md mx-auto leading-relaxed">
                  Once your shopping list exists, ordered parts show up here with shipping status,
                  tracking numbers, and final costs.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#2a3342]">
                <table className="min-w-full divide-y divide-[#2a3342] text-left text-xs">
                  <thead className="bg-[#05070c] text-[#a8b3c4] font-semibold uppercase tracking-wider">
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
                  <tbody className="divide-y divide-[#2a3342] bg-[#0d1017]/70">
                    {visibleBomItems.map(item => {
                      const isEditing = edit?.itemId === item.id;
                      const isSaving = savingId === item.id;

                      return (
                        <tr key={item.id} className="hover:bg-[#171c26] transition-colors">
                          <td className="px-3 py-2.5 font-mono font-bold text-violet-400 whitespace-nowrap">
                            {item.id}
                          </td>
                          <td className="px-3 py-2.5 text-[#e8edf5]">{item.description}</td>

                          {/* Status Dropdown */}
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            <select
                              value={item.status}
                              disabled={isSaving}
                              onChange={e => patchItem(item.id, { status: e.target.value })}
                              aria-label={`Status for ${item.id}`}
                              className={`rounded px-2.5 py-1 text-[11px] font-semibold focus:outline-none ${
                                STATUS_TONE[item.status] ?? 'bg-[#11151d] text-[#a8b3c4]'
                              }`}
                            >
                              {BOM_STATUSES.map(st => (
                                <option key={st} value={st} className="bg-[#0d1017] text-[#e8edf5]">
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
                                className="w-16 rounded border border-violet-500 bg-[#05070c] px-2 py-1 text-center font-mono text-xs text-white"
                              />
                            ) : (
                              <span className="font-bold text-[#e8edf5]">{item.qty}</span>
                            )}
                          </td>

                          {/* Tracking Number */}
                          <td className="px-3 py-2.5 font-mono text-[#a8b3c4]">
                            {isEditing ? (
                              <input
                                type="text"
                                value={edit.tracking}
                                onChange={e => setEdit({ ...edit, tracking: e.target.value })}
                                placeholder="Tracking / Order #"
                                className="w-full rounded border border-violet-500 bg-[#05070c] px-2 py-1 font-mono text-xs text-white"
                              />
                            ) : item.tracking && item.tracking !== '—' ? (
                              (() => {
                                const tUrl = getTrackingUrl(item.tracking);
                                return tUrl ? (
                                  <a
                                    href={tUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 hover:underline"
                                    title="Track package"
                                  >
                                    <span>{item.tracking}</span>
                                    <ExternalLink className="h-3 w-3 shrink-0" />
                                  </a>
                                ) : (
                                  <span>{item.tracking}</span>
                                );
                              })()
                            ) : (
                              <span>—</span>
                            )}
                          </td>

                          {/* Actual Total */}
                          <td className="px-3 py-2.5 text-right font-mono font-medium text-[#e8edf5]">
                            {isEditing ? (
                              <input
                                type="text"
                                value={edit.actualTotal}
                                onChange={e => setEdit({ ...edit, actualTotal: e.target.value })}
                                placeholder="$0.00"
                                className="w-24 rounded border border-violet-500 bg-[#05070c] px-2 py-1 text-right font-mono text-xs text-white"
                              />
                            ) : (
                              money(item.actualTotal)
                            )}
                          </td>

                          {/* Variance */}
                          <td className="px-3 py-2.5 text-right font-mono">
                            {item.variance === null ? (
                              <span className="text-[#6e7d92]">—</span>
                            ) : (
                              <span
                                className={`font-semibold ${
                                  item.variance > 0 ? 'text-rose-400' : 'text-[#e8edf5]'
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
                              <Loader2 className="mx-auto h-4 w-4 animate-spin text-violet-400" />
                            ) : isEditing ? (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => void commitEdit()}
                                  title="Save changes"
                                  className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded bg-[#7c3aed] text-white hover:bg-[#8b5cf6]"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => setEdit(null)}
                                  title="Cancel"
                                  className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded bg-[#11151d] text-[#a8b3c4] hover:bg-[#171c26]"
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
                                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded text-[#a8b3c4] hover:bg-[#11151d] hover:text-[#e8edf5]"
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
