import { useId } from 'react';
import type { ReactNode } from 'react';
import { Loader2, Save } from 'lucide-react';

export interface SettingsSaveBarStatus {
  kind: 'success' | 'warning' | 'error';
  text: string;
}

export interface SettingsSaveBarProps {
  /** Primary button label, e.g. "Save AI settings". */
  label: string;
  /** Primary button label while saving. */
  savingLabel: string;
  /** Text shown when nothing is unsaved. */
  cleanText: string;
  /** Names of the unsaved parts. Empty = clean. */
  dirtyParts: string[];
  saving: boolean;
  /** Visible reason why Save is unavailable. */
  blockedReason?: string;
  /** Result of the last save. Success replaces the clean text. */
  status?: SettingsSaveBarStatus | null;
  /** Helper content (text, extra buttons) shown above the action row. */
  extra?: ReactNode;
  onSave: () => void;
  onDiscard?: () => void;
}

const statusTone: Record<SettingsSaveBarStatus['kind'], string> = {
  success: 'text-[#86efac]',
  warning: 'text-amber-200',
  error: 'text-rose-300'
};

const buttonFocus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400';

/** Scoped, sticky save bar with a local, always-mounted live region. */
export function SettingsSaveBar(props: SettingsSaveBarProps) {
  const { label, savingLabel, cleanText, dirtyParts, saving, blockedReason, status, extra, onSave, onDiscard } = props;
  const reasonId = useId();
  const dirty = dirtyParts.length > 0;
  const saveDisabled = saving || !dirty || Boolean(blockedReason);
  const showSuccess = status?.kind === 'success';
  const stateText = dirty ? `Unsaved changes: ${dirtyParts.join(', ')}` : cleanText;

  return (
    <div className="sticky bottom-0 space-y-2 border-t border-[#2a3342] bg-[#05070c]/95 p-3 backdrop-blur">
      {extra}
      <div role="status" aria-live="polite" className="text-sm">
        {showSuccess ? (
          <p className={statusTone.success}>{status.text}</p>
        ) : (
          <p className={dirty ? 'text-amber-200' : 'text-[#a8b3c4]'}>{stateText}</p>
        )}
      </div>
      {status && !showSuccess && (
        <p role="alert" className={`text-sm ${statusTone[status.kind]}`}>{status.text}</p>
      )}
      {blockedReason && (
        <p id={reasonId} className="text-sm text-amber-200">{blockedReason}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saveDisabled}
          aria-describedby={blockedReason ? reasonId : undefined}
          className={`flex min-h-[44px] items-center gap-2 rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50 ${buttonFocus}`}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {saving ? savingLabel : label}
        </button>
        {onDiscard && dirty && !saving && (
          <button
            type="button"
            onClick={onDiscard}
            className={`min-h-[44px] rounded-lg border border-[#3b4658] px-4 text-sm text-[#e8edf5] hover:bg-[#11151d] ${buttonFocus}`}
          >
            Discard
          </button>
        )}
      </div>
    </div>
  );
}
