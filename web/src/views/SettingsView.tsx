export interface SettingsViewProps {
  onSaved: () => Promise<void> | void;
}

export default function SettingsView(_props: SettingsViewProps) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">
      SettingsView loading…
    </div>
  );
}
