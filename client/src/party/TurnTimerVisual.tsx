import { useEffect, useMemo, useRef } from 'react';
import { usePartySfx } from './usePartySfx';

export function TurnTimerVisual({
  turnEndsAt,
  totalSeconds,
  nowTick,
  soundEnabled = true,
}: {
  turnEndsAt: number | null;
  totalSeconds: number;
  nowTick: number;
  soundEnabled?: boolean;
}) {
  const { play } = usePartySfx(soundEnabled);
  const lastWarn = useRef(-1);

  const { frac, secLeft } = useMemo(() => {
    if (turnEndsAt == null || totalSeconds <= 0) {
      return { frac: 1, secLeft: 0 };
    }
    const ms = Math.max(0, turnEndsAt - nowTick);
    const sec = Math.ceil(ms / 1000);
    const f = Math.min(1, ms / (totalSeconds * 1000));
    return { frac: f, secLeft: sec };
  }, [turnEndsAt, totalSeconds, nowTick]);

  useEffect(() => {
    if (secLeft <= 3 && secLeft >= 1 && secLeft !== lastWarn.current) {
      lastWarn.current = secLeft;
      play('tick');
    }
    if (secLeft > 3) lastWarn.current = -1;
  }, [secLeft, play]);

  if (turnEndsAt == null || totalSeconds <= 0) return null;

  const deg = frac * 360;
  const urgent = secLeft <= 3;

  return (
    <div className={`turn-timer-wrap ${urgent ? 'turn-timer-urgent' : ''}`} aria-live="polite">
      <div
        className="turn-timer-ring"
        style={{
          background: `conic-gradient(#a78bfa ${deg}deg, rgba(196, 168, 255, 0.12) 0)`,
        }}
      >
        <div className="turn-timer-inner">
          <span className="turn-timer-num">{secLeft}</span>
          <span className="turn-timer-label">sec</span>
        </div>
      </div>
      <div className="turn-timer-bar">
        <div className="turn-timer-bar-fill" style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}
