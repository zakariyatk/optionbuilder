import type { ReactNode } from 'react';
import { ArrowLeftToLine, ChevronsRight, Pause, Play, StepForward, X } from 'lucide-react';
import { REPLAY_SPEEDS, replayLabel, useReplayState, type ReplayController } from './replay';

function Control({ label, onClick, disabled, children, wide }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-9 items-center justify-center gap-2 rounded-md text-sm text-[var(--text-primary)] hover:bg-[var(--surface-sunken)] disabled:opacity-35 disabled:hover:bg-transparent ${wide ? 'px-3' : 'w-9'}`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden="true" className="mx-1 h-6 w-px bg-[var(--border-strong)]" />;

/** TradingView's replay controls, under the chart while a replay is on. */
export function ReplayBar({ replay }: { replay: ReplayController }) {
  const s = useReplayState(replay);
  if (s.mode === 'off') return null;
  const canMove = s.index !== null && !s.atEnd;

  return (
    <div role="toolbar" aria-label="Bar replay" className="flex flex-wrap items-center gap-1 border-t border-[var(--border)] bg-[var(--surface-card)] px-2 py-1">
      <Control label="Select bar" onClick={replay.selectBar} wide>
        <ArrowLeftToLine size={18} aria-hidden="true" />
        Select bar
      </Control>
      <Divider />
      {s.mode === 'playing' ? (
        <Control label="Pause" onClick={replay.pause}>
          <Pause size={18} aria-hidden="true" />
        </Control>
      ) : (
        <Control label="Play" onClick={replay.play} disabled={!canMove}>
          <Play size={18} aria-hidden="true" />
        </Control>
      )}
      <Control label="Forward one bar" onClick={replay.step} disabled={!canMove || s.mode === 'playing'}>
        <StepForward size={18} aria-hidden="true" />
      </Control>
      <label className="flex h-9 items-center rounded-md px-1 text-sm hover:bg-[var(--surface-sunken)]">
        <span className="sr-only">Replay speed</span>
        <select
          value={s.speed}
          onChange={(e) => replay.setSpeed(Number(e.target.value))}
          title="Replay speed (bars per second)"
          className="cursor-pointer bg-transparent text-sm text-[var(--text-primary)] outline-none"
        >
          {REPLAY_SPEEDS.map((v) => (
            <option key={v} value={v}>
              {v}x
            </option>
          ))}
        </select>
      </label>
      <span className="px-2 text-sm text-[var(--text-secondary)]" title="Replay interval">
        {replay.periodText()}
      </span>
      <Divider />
      <Control label="Jump to real-time" onClick={replay.exit}>
        <ChevronsRight size={18} aria-hidden="true" />
      </Control>
      <span className="min-w-0 flex-1 truncate px-2 text-xs text-[var(--text-muted)]" aria-live="polite">
        {s.mode === 'select'
          ? 'Click a bar on the chart to replay from it.'
          : s.time !== null
            ? `Replaying ${replayLabel(s.time)}${s.atEnd ? ' · all bars shown' : ''}`
            : ''}
      </span>
      <Control label="Exit replay" onClick={replay.exit}>
        <X size={18} aria-hidden="true" />
      </Control>
    </div>
  );
}
