import { ProjectInfo } from '../types/api';
import { useTurnStream } from '../api/useTurnStream';

export interface DevelopmentViewProps {
  turnStream: ReturnType<typeof useTurnStream>;
  project: ProjectInfo | null;
  onProjectChanged: () => Promise<void> | void;
}

export default function DevelopmentView(_props: DevelopmentViewProps) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">
      Development workspace loading…
    </div>
  );
}
