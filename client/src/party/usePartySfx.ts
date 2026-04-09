import { useCallback, useRef } from 'react';

type SfxKind = 'tick' | 'drum' | 'airhorn';

/** Lightweight Web Audio cues — no external assets required. */
export function usePartySfx() {
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = useCallback(() => {
    if (typeof window === 'undefined') return null;
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }, []);

  const play = useCallback(
    (kind: SfxKind) => {
      const ctx = getCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') void ctx.resume();

      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.value = kind === 'airhorn' ? 0.12 : 0.08;
      master.connect(ctx.destination);

      if (kind === 'tick') {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(880, now);
        o.frequency.exponentialRampToValueAtTime(440, now + 0.06);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.2, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        o.connect(g);
        g.connect(master);
        o.start(now);
        o.stop(now + 0.09);
        return;
      }

      if (kind === 'drum') {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(120, now);
        o.frequency.exponentialRampToValueAtTime(55, now + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.35, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        o.connect(g);
        g.connect(master);
        o.start(now);
        o.stop(now + 0.16);
        return;
      }

      // airhorn-ish chirp stack
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator();
        o.type = 'square';
        const f0 = 440 + i * 180;
        o.frequency.setValueAtTime(f0, now + i * 0.05);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.6, now + i * 0.05 + 0.2);
        const g = ctx.createGain();
        const t0 = now + i * 0.05;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.06, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.01, t0 + 0.22);
        o.connect(g);
        g.connect(master);
        o.start(t0);
        o.stop(t0 + 0.25);
      }
    },
    [getCtx],
  );

  return { play };
}
