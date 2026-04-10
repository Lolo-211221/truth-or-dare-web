import { useEffect, useState } from 'react';
import type { RoomState } from '@shared';
import { socket } from '../socket';

type Props = {
  state: RoomState;
  myId: string | null;
};

const SUITS: { id: '♥' | '♦' | '♣' | '♠'; label: string }[] = [
  { id: '♥', label: 'Hearts' },
  { id: '♦', label: 'Diamonds' },
  { id: '♣', label: 'Clubs' },
  { id: '♠', label: 'Spades' },
];

export function RideTheBusGame({ state, myId }: Props) {
  const rtb = state.rideTheBus;
  const [flipOn, setFlipOn] = useState(false);

  useEffect(() => {
    if (rtb?.faceUpCard) {
      setFlipOn(false);
      const t = requestAnimationFrame(() => setFlipOn(true));
      return () => cancelAnimationFrame(t);
    }
  }, [rtb?.faceUpCard?.rank, rtb?.faceUpCard?.suit, rtb?.cardsThisRound?.length]);

  if (!rtb) return null;

  const hotName = state.players.find((p) => p.id === rtb.hotSeatPlayerId)?.name ?? 'Player';
  const isHot = myId === rtb.hotSeatPlayerId;
  const face = rtb.faceUpCard;
  const q = rtb.currentQuestion1Based;

  const flip = () => socket.emit('rtb_flip', {});
  const ackWrong = () => socket.emit('rtb_ack_wrong', {});
  const ackRound = () => socket.emit('rtb_ack_round_win', {});

  const sendGuess = (payload: object) => {
    socket.emit('rtb_guess', payload);
  };

  const survivorName = rtb.lastRoundSurvivorId
    ? state.players.find((p) => p.id === rtb.lastRoundSurvivorId)?.name
    : null;

  return (
    <section className="rtb-root">
      <div className="rtb-header">
        <h2 className="rtb-title">🚌 Ride the Bus</h2>
        <p className="muted rtb-sub">
          Hot seat: <strong>{hotName}</strong>
          {isHot ? <span className="badge-you">you</span> : null}
        </p>
        <p className="rtb-progress">
          Question <strong>{q}</strong> / 4 · Deck: {rtb.cardsRemaining} cards
        </p>
      </div>

      <ul className="rtb-players">
        {state.players.map((p) => (
          <li
            key={p.id}
            className={
              rtb.completedPlayerIds.includes(p.id)
                ? 'rtb-pl rtb-pl--done'
                : p.id === rtb.hotSeatPlayerId
                  ? 'rtb-pl rtb-pl--hot'
                  : 'rtb-pl'
            }
          >
            <span>{p.name}</span>
            {rtb.completedPlayerIds.includes(p.id) ? <span className="rtb-badge">✓ Survived</span> : null}
          </li>
        ))}
      </ul>

      <div className="rtb-card-zone">
        {face ? (
          <div className={`rtb-flip ${flipOn ? 'rtb-flip--on' : ''}`}>
            <div className="rtb-card-face">
              <span className="rtb-card-rank">{face.rank}</span>
              <span className="rtb-card-suit">{face.suit}</span>
            </div>
          </div>
        ) : (
          <div className="rtb-card-back" aria-hidden />
        )}
      </div>

      {rtb.uiStep === 'awaitFlip' && isHot ? (
        <button type="button" className="btn-primary btn-primary-cta" onClick={flip}>
          Flip card
        </button>
      ) : null}
      {rtb.uiStep === 'awaitFlip' && !isHot ? (
        <p className="muted">{hotName} is flipping…</p>
      ) : null}

      {rtb.uiStep === 'awaitGuess' && face && isHot ? (
        <div className="rtb-guess">
          {q === 1 ? (
            <div className="rtb-guess-row">
              <p className="rtb-q">Red or black?</p>
              <button type="button" className="btn-secondary" onClick={() => sendGuess({ kind: 'color', color: 'red' })}>
                Red
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => sendGuess({ kind: 'color', color: 'black' })}
              >
                Black
              </button>
            </div>
          ) : null}
          {q === 2 ? (
            <div className="rtb-guess-row">
              <p className="rtb-q">Higher or lower than the first card?</p>
              <button type="button" className="btn-secondary" onClick={() => sendGuess({ kind: 'hilo', hilo: 'higher' })}>
                Higher
              </button>
              <button type="button" className="btn-secondary" onClick={() => sendGuess({ kind: 'hilo', hilo: 'lower' })}>
                Lower
              </button>
              <button type="button" className="btn-secondary" onClick={() => sendGuess({ kind: 'hilo', hilo: 'same' })}>
                Same
              </button>
            </div>
          ) : null}
          {q === 3 ? (
            <div className="rtb-guess-row">
              <p className="rtb-q">Inside or outside the first two cards?</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => sendGuess({ kind: 'inout', inout: 'inside' })}
              >
                Inside
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => sendGuess({ kind: 'inout', inout: 'outside' })}
              >
                Outside
              </button>
            </div>
          ) : null}
          {q === 4 ? (
            <div className="rtb-guess-row rtb-suits">
              <p className="rtb-q">What suit?</p>
              <div className="rtb-suit-grid">
                {SUITS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="btn-secondary"
                    onClick={() => sendGuess({ kind: 'suit', suit: s.id })}
                  >
                    {s.id} {s.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {rtb.uiStep === 'awaitGuess' && !isHot ? (
        <p className="muted">{hotName} is guessing…</p>
      ) : null}

      {rtb.uiStep === 'wrong' ? (
        <div className="rtb-overlay rtb-overlay--wrong">
          <h3>Wrong!</h3>
          <p>{rtb.wrongMessage ?? 'Take a drink and restart from question 1.'}</p>
          {isHot ? (
            <button type="button" className="btn-primary btn-primary-cta" onClick={ackWrong}>
              Continue
            </button>
          ) : (
            <p className="muted">Waiting for {hotName}…</p>
          )}
        </div>
      ) : null}

      {rtb.uiStep === 'roundWin' ? (
        <div className="rtb-overlay rtb-overlay--win">
          <h3>Survived the bus! 🎉</h3>
          <p>
            <strong>{survivorName}</strong> cleared all four — safe this round.
          </p>
          <button type="button" className="btn-primary btn-primary-cta" onClick={ackRound}>
            Continue
          </button>
        </div>
      ) : null}
    </section>
  );
}
