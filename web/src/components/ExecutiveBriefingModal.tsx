import { Printer, X, AlertTriangle, ShieldAlert } from 'lucide-react';
import { DashboardData } from '../types/api';

interface ExecutiveBriefingModalProps {
  data: DashboardData;
  onClose: () => void;
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function ExecutiveBriefingModal({ data, onClose }: ExecutiveBriefingModalProps) {
  const { project, roadmap, issues } = data;
  const fin = project.financials;

  const handlePrint = () => {
    window.print();
  };

  const todayStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const nonConformances = issues.filter(i => i.type === 'non_conformance');
  const openQuestions = issues.filter(i => i.type === 'open_question');

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/90 backdrop-blur-md overflow-y-auto briefing-modal-backdrop">
      {/* Sticky Action Toolbar (Hidden in Print) */}
      <header className="sticky top-0 z-10 flex min-h-[60px] items-center justify-between border-b border-slate-800 bg-slate-900/90 px-6 py-3 no-print">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-emerald-400" />
          <h2 className="text-sm font-bold text-white">2-Page Executive Briefing & Audit Report</h2>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-mono text-slate-300">
            Print-Ready Letter (8.5" x 11")
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handlePrint}
            className="flex min-h-[44px] items-center gap-2 rounded-xl bg-sky-600 px-5 text-xs font-bold text-white shadow-lg hover:bg-sky-500 transition-colors"
          >
            <Printer className="h-4 w-4" />
            Save as PDF / Print
          </button>
          <button
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Document Body (Rendered as 2 letter pages) */}
      <div className="flex-1 p-4 md:p-8 flex flex-col items-center gap-8 briefing-modal-content">
        {/* ================================================================= */}
        {/* PAGE 1: EXECUTIVE SUMMARY, FINANCIALS, SUBSYSTEM MATRIX           */}
        {/* ================================================================= */}
        <section className="briefing-page w-full max-w-[8.5in] min-h-[11in] bg-white text-slate-900 p-10 md:p-12 shadow-2xl rounded-sm flex flex-col justify-between">
          <div className="space-y-6">
            {/* Header */}
            <div className="border-b-2 border-slate-900 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-sky-700">
                    STARN Engineering Program Management
                  </div>
                  <h1 className="mt-1 text-2xl font-black text-slate-950 uppercase tracking-tight">
                    Executive Briefing: {project.name}
                  </h1>
                </div>
                <div className="text-right">
                  <span className="inline-block rounded bg-slate-900 px-2.5 py-1 text-xs font-mono font-bold text-white uppercase">
                    Gate: {project.activePhase.toUpperCase()}
                  </span>
                  <div className="mt-1 text-[11px] font-mono text-slate-600">{todayStr}</div>
                </div>
              </div>
            </div>

            {/* 1. Executive Summary */}
            <div className="space-y-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-1">
                1. System Scope & Operational Intent
              </h2>
              <p className="text-xs leading-relaxed text-slate-700 text-justify">
                {project.summary ||
                  'System scope, operational concepts, and functional baselines established and governed per approved STARN specialist deliverables.'}
              </p>
            </div>

            {/* 2. Financial & Procurement Rollup */}
            <div className="space-y-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-1">
                2. Financial & Procurement Rollup
              </h2>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-[10px] font-semibold uppercase text-slate-500">Estimated Budget</div>
                  <div className="mt-1 font-mono text-base font-black text-slate-900">
                    {money(fin.totalEstimated)}
                  </div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-[10px] font-semibold uppercase text-slate-500">Committed Spend</div>
                  <div className="mt-1 font-mono text-base font-black text-slate-900">
                    {money(fin.totalActual)}
                  </div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-[10px] font-semibold uppercase text-slate-500">Net Variance</div>
                  <div
                    className={`mt-1 font-mono text-base font-black ${
                      fin.netVariance > 0 ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    {fin.netVariance > 0 ? '+' : ''}
                    {money(fin.netVariance)}
                  </div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-[10px] font-semibold uppercase text-slate-500">Procured Progress</div>
                  <div className="mt-1 font-mono text-base font-black text-slate-900">
                    {Math.round(fin.procurementProgressPercent)}%
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Subsystem Architecture Overview */}
            <div className="space-y-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-1">
                3. Subsystem Decomposition & Readiness
              </h2>
              <table className="w-full text-left text-xs border border-slate-200">
                <thead className="bg-slate-100 text-slate-700 text-[10px] font-bold uppercase">
                  <tr>
                    <th className="p-2 border-b border-slate-200">Subsystem</th>
                    <th className="p-2 border-b border-slate-200">Designation</th>
                    <th className="p-2 border-b border-slate-200 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-[11px]">
                  <tr>
                    <td className="p-2 font-mono font-bold text-slate-900">SS-01</td>
                    <td className="p-2 text-slate-800">Structural Frame & Deployable Mountings</td>
                    <td className="p-2 text-center text-emerald-800 font-semibold">Active Baseline</td>
                  </tr>
                  <tr>
                    <td className="p-2 font-mono font-bold text-slate-900">SS-02</td>
                    <td className="p-2 text-slate-800">High-Voltage Battery & Energy Storage</td>
                    <td className="p-2 text-center text-emerald-800 font-semibold">Active Baseline</td>
                  </tr>
                  <tr>
                    <td className="p-2 font-mono font-bold text-slate-900">SS-03</td>
                    <td className="p-2 text-slate-800">Power Conversion & Distribution Inverters</td>
                    <td className="p-2 text-center text-emerald-800 font-semibold">Active Baseline</td>
                  </tr>
                  <tr>
                    <td className="p-2 font-mono font-bold text-slate-900">SS-04</td>
                    <td className="p-2 text-slate-800">Thermal Dissipation & Environmental Enclosure</td>
                    <td className="p-2 text-center text-slate-600">Pending Review</td>
                  </tr>
                  <tr>
                    <td className="p-2 font-mono font-bold text-slate-900">SS-05</td>
                    <td className="p-2 text-slate-800">Telemetry, Safety Interlocks & Emergency Stop</td>
                    <td className="p-2 text-center text-slate-600">Pending Review</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Page 1 Footer */}
          <div className="border-t border-slate-200 pt-3 flex items-center justify-between text-[10px] text-slate-500 font-mono">
            <span>STARN Autonomous Engineering Management System</span>
            <span>Page 1 of 2</span>
          </div>
        </section>

        {/* ================================================================= */}
        {/* PAGE 2: LINEAR PHASE-GATE FLOWCHART, AUDIT MATRIX, DEFECTS        */}
        {/* ================================================================= */}
        <section className="briefing-page w-full max-w-[8.5in] min-h-[11in] bg-white text-slate-900 p-10 md:p-12 shadow-2xl rounded-sm flex flex-col justify-between">
          <div className="space-y-6">
            {/* Header */}
            <div className="border-b-2 border-slate-900 pb-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">
                  Phase-Gate Audit & Execution Governance
                </h2>
                <span className="font-mono text-[10px] text-slate-500">Document Ref: STARN-BRF-001</span>
              </div>
            </div>

            {/* 4. Linear Phase-Gate Subway Flowchart (Formal Report Standard) */}
            <div className="space-y-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-1">
                4. Linear Phase-Gate Subway Flowchart
              </h3>
              <div className="rounded border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between overflow-x-auto gap-1">
                  {roadmap.map((p, idx) => {
                    const isApproved = p.status === 'COMPLETED';
                    const isActive = p.status === 'IN_PROGRESS';
                    const isPending = p.status === 'PENDING_REVIEW';

                    return (
                      <div key={p.id} className="flex flex-col items-center min-w-[48px] text-center">
                        <div
                          className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-mono font-bold ${
                            isApproved
                              ? 'bg-emerald-600 text-white'
                              : isActive
                              ? 'bg-sky-600 text-white animate-pulse'
                              : isPending
                              ? 'bg-amber-500 text-white'
                              : 'bg-slate-300 text-slate-600'
                          }`}
                        >
                          {idx + 1}
                        </div>
                        <span className="mt-1 font-mono text-[8px] font-bold text-slate-800 truncate max-w-[50px]">
                          {p.name.split(' ')[0]}
                        </span>
                        <span className="font-mono text-[7px] text-slate-500">
                          {isApproved ? 'PASS' : isActive ? 'ACTIVE' : 'GATE'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 5. Milestone Deliverables Audit Matrix */}
            <div className="space-y-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-1">
                5. Milestone Deliverables & Critic Scores
              </h3>
              <table className="w-full text-left text-xs border border-slate-200">
                <thead className="bg-slate-100 text-slate-700 text-[10px] font-bold uppercase">
                  <tr>
                    <th className="p-1.5 border-b border-slate-200 text-center">#</th>
                    <th className="p-1.5 border-b border-slate-200">Milestone</th>
                    <th className="p-1.5 border-b border-slate-200">Artifact File</th>
                    <th className="p-1.5 border-b border-slate-200 text-center">Status</th>
                    <th className="p-1.5 border-b border-slate-200 text-right">Critic Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-[10px]">
                  {roadmap.map((p, idx) => (
                    <tr key={p.id}>
                      <td className="p-1.5 text-center font-mono font-bold text-slate-700">{idx + 1}</td>
                      <td className="p-1.5 font-semibold text-slate-900">{p.name}</td>
                      <td className="p-1.5 font-mono text-slate-600">{p.artifactPath}</td>
                      <td className="p-1.5 text-center">
                        {p.status === 'COMPLETED' ? (
                          <span className="font-bold text-emerald-700">Approved</span>
                        ) : p.status === 'IN_PROGRESS' ? (
                          <span className="font-bold text-sky-700">In Progress</span>
                        ) : p.status === 'PENDING_REVIEW' ? (
                          <span className="font-bold text-amber-700">Draft</span>
                        ) : (
                          <span className="text-slate-400">Locked</span>
                        )}
                      </td>
                      <td className="p-1.5 text-right font-mono font-bold text-slate-900">
                        {p.criticScore !== undefined ? `${p.criticScore.toFixed(1)}/10` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 6. Hardware Non-Conformances & Risks */}
            <div className="space-y-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-1">
                6. Critical Non-Conformances & Builder Questions
              </h3>
              {nonConformances.length === 0 && openQuestions.length === 0 ? (
                <div className="p-2.5 rounded bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 font-medium">
                  ✔ Zero open hardware non-conformances or unaddressed builder questions.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {nonConformances.map(nc => (
                    <div
                      key={nc.id}
                      className="rounded border border-rose-200 bg-rose-50 p-2 text-[10px] text-rose-900 flex items-start gap-2"
                    >
                      <ShieldAlert className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold uppercase">[Non-Conformance] {nc.title}:</span>{' '}
                        {nc.description}
                      </div>
                    </div>
                  ))}
                  {openQuestions.map(oq => (
                    <div
                      key={oq.id}
                      className="rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-900 flex items-start gap-2"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold uppercase">[Open Question] {oq.title}:</span>{' '}
                        {oq.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Page 2 Footer */}
          <div className="border-t border-slate-200 pt-3 flex items-center justify-between text-[10px] text-slate-500 font-mono">
            <span>Confidential — STARN Project Baseline</span>
            <span>Page 2 of 2</span>
          </div>
        </section>
      </div>
    </div>
  );
}
