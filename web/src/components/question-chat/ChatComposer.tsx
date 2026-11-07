// One question's composer: segmented [Advisory | Answer] mode control, an
// autosizing draft textarea, mic, and the single mode-labelled send verb
// (Ask / Record). Design 2026-11-03 §2b.2–§2b.8, §4.3, §5, §7.
//
// MODE STATE OWNERSHIP — this component is fully controlled. The parent owns
// `mode` and must enforce the reset rules (design §2b.4):
//   R1 mode is 'advisory' on mount, panel reopen, every question switch, and
//      after every send (ask or answer);
//   R2 never persisted (no localStorage key);
//   R3 the mode belongs to the unsent draft — switching keeps the draft,
//      discarding it (Esc) returns to advisory;
//   R4 no idle timer, ever;
//   R5 a failed answer send returns to advisory, keeps the draft, and sets
//      `answerError` so the Retry-as-answer card renders;
//   R6 a recorded/queued answer replaces the composer with `locked`, so the
//      mode is moot; the next composer is advisory;
//   R7 conclude / proposal accept / Ask-in-flight never change the mode.
import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, Loader2, Lock, MessageCircleQuestion, Mic, SendHorizontal } from 'lucide-react';
import { useAutosizeTextarea } from './useAutosizeTextarea';

/** 'advisory' asks the specialist and records nothing; 'answer' commits. */
export type ComposerMode = 'advisory' | 'answer';

/** Composer replacement row (§4.3): queued answer, resolved, auto-applied. */
export interface ComposerLocked {
  kind: 'queued' | 'resolved' | 'auto';
  text: string;
  onUndo?: () => void;
}

export interface ChatComposerProps {
  /** Controlled draft (one draft per question, owned by the parent). */
  value: string;
  onChange: (text: string) => void;
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  /** Send the draft as a question to the specialist — records nothing. */
  onAsk: () => void;
  /** Send the draft as the answer — irreversible once the server accepts it. */
  onAnswer: () => void;
  /** An Ask or an answer is in flight: verbs disabled, textarea stays editable. */
  busy: boolean;
  /** Composer unavailable (e.g. answer queued/applying elsewhere). */
  disabled: boolean;
  /** When set, the composer is replaced by one locked row. */
  locked?: ComposerLocked;
  /** Non-fatal Ask error (S6), rendered as a role=alert card. */
  error?: string;
  /** Push-to-talk state for the mic button (Alt hold / pill). */
  recording: boolean;
  onMicDown: () => void;
  onMicUp: () => void;
  placeholder?: string;
  /** Answer-send failure (R5): role=alert card with Retry as answer. */
  answerError?: string;
}

const LOCKED_ICON = { queued: Lock, resolved: Check, auto: Check } as const;

/**
 * Chat composer with two skins. Inputs/outputs: see `ChatComposerProps`.
 * Throws: never. Keyboard (design §2b.5): Enter sends in the visible mode
 * (advisory → Ask, answer → Record), Shift+Enter newlines, Alt+A toggles the
 * mode without sending. There is no send-as-answer shortcut: the skin says
 * what Enter does.
 */
export default function ChatComposer({
  value,
  onChange,
  mode,
  onModeChange,
  onAsk,
  onAnswer,
  busy,
  disabled,
  locked,
  error,
  recording,
  onMicDown,
  onMicUp,
  placeholder,
  answerError
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const advisoryRef = useRef<HTMLButtonElement>(null);
  const answerRef = useRef<HTMLButtonElement>(null);
  const helpId = useId();
  const isAnswer = mode === 'answer';
  useAutosizeTextarea(textareaRef, value, !locked);

  if (locked) {
    const Icon = LOCKED_ICON[locked.kind];
    return (
      <div className="qchat-composer is-locked">
        <div role="status" tabIndex={-1} className={`qchat-locked is-${locked.kind}`}>
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          <span>{locked.text}</span>
          {locked.onUndo && (
            <button type="button" onClick={locked.onUndo} className="qchat-undo ml-auto">
              Undo
            </button>
          )}
        </div>
      </div>
    );
  }

  const empty = value.trim() === '';
  const sendDisabled = disabled || busy || empty;

  function selectMode(next: ComposerMode, moveFocus: boolean): void {
    onModeChange(next);
    if (moveFocus) (next === 'answer' ? answerRef : advisoryRef).current?.focus();
  }

  function onSegmentKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      selectMode('answer', true);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      selectMode('advisory', true);
    }
  }

  function onTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (sendDisabled) return;
    if (isAnswer) onAnswer();
    else onAsk();
  }

  // Alt+A flips the visible skin and sends nothing, so the next Enter still
  // obeys the skin the user can see. Handled on the composer so it works with
  // focus in the textarea or on a segment button.
  function onComposerKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'a' && e.key !== 'A') return;
    e.preventDefault();
    onModeChange(isAnswer ? 'advisory' : 'answer');
  }

  return (
    <div
      className={`qchat-composer ${isAnswer ? 'is-answer' : 'is-advisory'}`}
      onKeyDown={onComposerKeyDown}
    >
      <div className="qchat-modehead">
        {/* Two-position segmented control: both modes stay visible so the
            alternative is discoverable before typing. */}
        <div
          role="radiogroup"
          aria-label="Composer mode"
          className="qchat-seg"
          onKeyDown={onSegmentKeyDown}
        >
          <button
            ref={advisoryRef}
            type="button"
            role="radio"
            aria-checked={!isAnswer}
            tabIndex={isAnswer ? -1 : 0}
            onClick={() => onModeChange('advisory')}
            title="Advisory — the specialist replies, nothing is recorded"
            className="qchat-seg-btn"
          >
            <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden />
            Advisory
          </button>
          <button
            ref={answerRef}
            type="button"
            role="radio"
            aria-checked={isAnswer}
            tabIndex={isAnswer ? 0 : -1}
            onClick={() => onModeChange('answer')}
            title="Answer — sending records your answer, no undo"
            className="qchat-seg-btn"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Answer
          </button>
        </div>
        <p className="qchat-hint">
          {isAnswer ? (
            <>
              <Lock className="h-3 w-3 shrink-0" aria-hidden />
              Sending records your answer — no undo
            </>
          ) : (
            <>
              <MessageCircleQuestion className="h-3 w-3 shrink-0" aria-hidden />
              Nothing is recorded
            </>
          )}
        </p>
      </div>

      <div className="qchat-inputrow">
        <label htmlFor={helpId} className="sr-only">
          {isAnswer ? 'Your answer' : 'Question or note'}
        </label>
        <textarea
          ref={textareaRef}
          id={helpId}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          disabled={disabled}
          rows={2}
          aria-describedby={`${helpId}-help`}
          placeholder={
            placeholder ?? (isAnswer ? 'Write your answer…' : 'Ask the specialist…')
          }
          className="qchat-textarea"
        />
        <button
          type="button"
          aria-label="Record answer"
          aria-pressed={recording}
          disabled={disabled || busy}
          onPointerDown={onMicDown}
          onPointerUp={onMicUp}
          onPointerLeave={onMicUp}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onMicDown();
            }
          }}
          onKeyUp={e => {
            if (e.key === 'Enter' || e.key === ' ') onMicUp();
          }}
          className="qchat-mic"
        >
          <Mic className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={isAnswer ? onAnswer : onAsk}
          disabled={sendDisabled}
          aria-keyshortcuts="Enter"
          title={
            isAnswer
              ? 'Record this as your answer — no undo (Enter)'
              : 'Send as a question — nothing is recorded (Enter)'
          }
          className={`qchat-send ${isAnswer ? 'is-answer' : 'is-advisory'}`}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
          ) : isAnswer ? (
            <SendHorizontal className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden />
          )}
          {isAnswer ? 'Record' : 'Ask'}
          <kbd className="qchat-kbd" aria-hidden>
            Enter
          </kbd>
        </button>
      </div>

      {error && (
        <p role="alert" className="qchat-alert">
          {error}
        </p>
      )}
      {answerError && (
        <div role="alert" className="qchat-alert">
          <span>{answerError}</span>
          <button
            type="button"
            onClick={() => {
              onModeChange('answer');
              onAnswer();
            }}
            className="qchat-retry"
          >
            Retry as answer
          </button>
        </div>
      )}

      <p id={`${helpId}-help`} className="sr-only">
        Enter sends in the selected mode. Shift plus Enter adds a line. Alt plus A switches between
        advisory and answer.
      </p>
      <p role="status" className="sr-only">
        {isAnswer
          ? 'Answer mode — sending records your answer'
          : 'Advisory mode — nothing is recorded'}
      </p>
    </div>
  );
}
