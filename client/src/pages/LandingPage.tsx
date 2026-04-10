import { useEffect } from 'react';
import { Link } from 'react-router-dom';

const PREVIEW_GAMES: { emoji: string; label: string }[] = [
  { emoji: '🎭', label: 'Truth or Dare' },
  { emoji: '🃏', label: 'Kings Cup' },
  { emoji: '👆', label: 'Never Have I Ever' },
  { emoji: '🗳️', label: 'Most Likely To' },
  { emoji: '🚌', label: 'Ride the Bus' },
  { emoji: '🤥', label: 'Two Truths & a Lie' },
];

export default function LandingPage() {
  useEffect(() => {
    document.title = 'Party Games';
  }, []);

  return (
    <div className="landing-page">
      <div className="landing-bg" aria-hidden>
        <span className="landing-float landing-float--1">🎴</span>
        <span className="landing-float landing-float--2">🎊</span>
        <span className="landing-float landing-float--3">✨</span>
        <span className="landing-float landing-float--4">🃏</span>
        <span className="landing-float landing-float--5">🎉</span>
        <span className="landing-float landing-float--6">⭐</span>
        <div className="landing-particles" />
      </div>

      <div className="landing-inner animate-in">
        <header className="landing-hero">
          <h1 className="landing-title">Party Games</h1>
          <p className="landing-tagline">One room, infinite chaos</p>
        </header>

        <p className="landing-lead muted">Pick a mode after you join — everything happens in one live room.</p>

        <div className="landing-preview">
          {PREVIEW_GAMES.map((g) => (
            <div key={g.label} className="landing-preview-card">
              <span className="landing-preview-emoji" aria-hidden>
                {g.emoji}
              </span>
              <span className="landing-preview-label">{g.label}</span>
            </div>
          ))}
        </div>

        <Link to="/play" className="btn-primary btn-primary-cta landing-cta">
          Play now
        </Link>

        <p className="landing-disclaimer muted">
          Free to play. Drink responsibly — prompts are for fun with people you trust.
        </p>
      </div>
    </div>
  );
}
