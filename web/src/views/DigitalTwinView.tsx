import { useEffect, useRef, useState } from 'react';
import { Box, UploadCloud, Boxes, Loader2 } from 'lucide-react';
import { api } from '../api/client';
import { RoadmapPhase, WorkInstruction } from '../types/api';

/**
 * Tab 6 — 3D Digital Twin viewport scaffold.
 *
 * Ships as a GLTF upload slot plus a live subsystem readiness explorer.
 * The Three.js canvas mounts into the viewport container in a future
 * iteration; the upload path and readiness data plumbing are live now.
 */

interface SubsystemReadiness {
  id: string;
  actions: number;
  complete: number;
  defects: number;
}

function computeReadiness(instructions: WorkInstruction[]): SubsystemReadiness[] {
  const map = new Map<string, SubsystemReadiness>();
  for (const wi of instructions) {
    const id = wi.subsystem || 'UNASSIGNED';
    const entry = map.get(id) ?? { id, actions: 0, complete: 0, defects: 0 };
    entry.actions += 1;
    const pct = wi.steps.length === 0 ? 0 : wi.steps.filter(s => s.checked).length / wi.steps.length;
    if (pct === 1) entry.complete += 1;
    if (wi.nonConformance.flagStatus.toUpperCase().includes('OPEN')) entry.defects += 1;
    map.set(id, entry);
  }
  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export default function DigitalTwinView() {
  const [readiness, setReadiness] = useState<SubsystemReadiness[] | null>(null);
  const [roadmap, setRoadmap] = useState<RoadmapPhase[]>([]);
  const [modelName, setModelName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [actions, phases] = await Promise.all([api.fetchActions(), api.fetchRoadmap()]);
        setReadiness(computeReadiness(actions));
        setRoadmap(phases);
      } catch {
        setReadiness([]);
      }
    })();
  }, []);

  const uploadModel = async (file: File) => {
    setUploading(true);
    setNotice(null);
    try {
      const safeName = `DIGITAL-TWIN-${file.name.replace(/[^a-zA-Z0-9.-]+/g, '-').toUpperCase()}`;
      const result = await api.uploadArtifact(safeName, file);
      setModelName(result.path);
      setNotice(`Model stored at ${result.path} — the 3D viewport will render it in a future update.`);
    } catch (err: any) {
      setNotice(err?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const icdApproved = roadmap.find(p => p.id === 'icd')?.status === 'COMPLETED';

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_320px]">
      {/* Viewport */}
      <section className="relative flex min-h-[320px] flex-col items-center justify-center border-r border-slate-800 bg-gradient-to-b from-slate-950 to-slate-900 p-6" aria-label="3D viewport">
        <div
          className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-8 text-center"
        >
          <Box className="h-12 w-12 text-sky-500/70" aria-hidden />
          <div>
            <h2 className="text-sm font-bold text-slate-200">Digital twin viewport</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Upload a GLTF/GLB model of the system to anchor the spatial digital twin. Subsystem
              readiness from the shop floor will overlay as a heatmap once the renderer lands.
            </p>
            {modelName && (
              <p className="mt-2 font-mono text-[11px] text-emerald-300">{modelName}</p>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gltf,.glb"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void uploadModel(f);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex min-h-[44px] items-center gap-2 rounded-lg bg-sky-600 px-5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-40"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UploadCloud className="h-4 w-4" aria-hidden />}
            Upload GLTF / GLB model
          </button>
          {notice && <p className="text-xs text-slate-400" role="status">{notice}</p>}
        </div>
      </section>

      {/* Subsystem explorer */}
      <aside className="min-h-0 overflow-y-auto" aria-label="Subsystem readiness">
        <header className="border-b border-slate-800 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Boxes className="h-4 w-4 text-sky-400" aria-hidden /> Subsystem readiness
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {icdApproved ? 'Derived from the approved ICD and shop-floor progress' : 'Populates as the ICD and work instructions mature'}
          </p>
        </header>

        {readiness === null ? (
          <div className="flex items-center justify-center gap-2 p-6 text-xs text-slate-500" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
          </div>
        ) : readiness.length === 0 ? (
          <p className="p-6 text-center text-xs leading-relaxed text-slate-500">
            No subsystem execution data yet. Work instructions tagged with subsystems (SS-01, SS-02…)
            will appear here with live readiness as steps complete.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {readiness.map(ss => {
              const pct = ss.actions === 0 ? 0 : Math.round((ss.complete / ss.actions) * 100);
              return (
                <li key={ss.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-sky-300">{ss.id}</span>
                    {ss.defects > 0 && (
                      <span className="rounded-full bg-rose-950/80 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                        {ss.defects} defect{ss.defects > 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-400">{ss.complete}/{ss.actions} actions</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden>
                    <div
                      className={`h-full rounded-full ${ss.defects > 0 ? 'bg-rose-500' : pct === 100 ? 'bg-emerald-500' : 'bg-sky-500'}`}
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}
