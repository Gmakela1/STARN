export interface IssuesAndQuestionsViewProps {
  onPushToAgent: (prompt: string) => Promise<void> | void;
}

export default function IssuesAndQuestionsView(_props: IssuesAndQuestionsViewProps) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">
      IssuesAndQuestionsView loading…
    </div>
  );
}
