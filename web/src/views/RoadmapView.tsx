import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import { RoadmapPhase } from '../types/api';
import TreasureMapRoadmap from '../components/TreasureMapRoadmap';

interface RoadmapViewProps {
  onSelectPhase: (phaseId: string) => void;
}

export default function RoadmapView({ onSelectPhase }: RoadmapViewProps) {
  const [roadmap, setRoadmap] = useState<RoadmapPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.fetchRoadmap();
      setRoadmap(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load roadmap');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading && roadmap.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-[#6e7d92]" role="status">
        <Loader2 className="h-5 w-5 animate-spin text-[#ff2a3c]" aria-hidden /> Loading build roadmap…
      </div>
    );
  }

  if (error && roadmap.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-rose-300">{error}</p>
        <button
          onClick={() => void load()}
          className="flex min-h-[44px] items-center gap-2 rounded-lg border border-[#3b4658] px-4 text-sm text-[#a8b3c4] hover:bg-[#11151d]"
        >
          <RefreshCw className="h-4 w-4" aria-hidden /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 bg-[#05070c] text-[#e8edf5]">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Approachable Header */}
        <section aria-label="Project roadmap header" className="rounded-2xl border border-[#2a3342] bg-[#0d1017]/70 p-6 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="rounded bg-[#1a0208] px-2 py-0.5 font-mono text-[11px] font-bold text-[#ffb3bd] border border-[#ff2a3c]/45">
              BUILD JOURNEY
            </span>
            <span className="text-xs text-[#a8b3c4]">13 Milestones</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            Project Roadmap: From Idea to Reality
          </h1>
          <p className="mt-2 text-sm text-[#a8b3c4] max-w-3xl leading-relaxed">
            Follow the 13 foundational engineering milestones. Click any phase to open it in the Studio.
          </p>
        </section>

        {/* Milestone Trail */}
        <section aria-label="Milestone trail">
          <TreasureMapRoadmap roadmap={roadmap} onSelectPhase={onSelectPhase} hideHeader />
        </section>
      </div>
    </div>
  );
}
