import { useEffect } from 'react';
import type { PartyMomentPayload } from '@shared';
import confetti from 'canvas-confetti';
import { usePartySfx } from './usePartySfx';

export function PartyMomentOverlay({
  moment,
  onClose,
  soundEnabled = true,
}: {
  moment: PartyMomentPayload;
  onClose: () => void;
  soundEnabled?: boolean;
}) {
  const { play } = usePartySfx(soundEnabled);

  useEffect(() => {
    document.body.classList.add('party-shake');
    play(moment.sound);
    if (moment.confetti) {
      void confetti({
        particleCount: 90,
        spread: 72,
        origin: { y: 0.65 },
        colors: ['#a78bfa', '#f472b6', '#fde047', '#38bdf8'],
      });
    }
    const t = window.setTimeout(() => onClose(), 4200);
    return () => {
      window.clearTimeout(t);
      document.body.classList.remove('party-shake');
    };
  }, [moment, onClose, play]);

  return (
    <div className="party-moment-overlay" role="dialog" aria-modal>
      <div className="party-moment-card">
        <p className="party-moment-tag">{moment.category}</p>
        <h2 className="party-moment-title">{moment.title}</h2>
        <div className="party-moment-gif-wrap">
          <img src={moment.imageUrl} alt="" className="party-moment-gif" />
        </div>
        <button type="button" className="btn-secondary party-moment-close" onClick={onClose}>
          Nice
        </button>
      </div>
    </div>
  );
}
