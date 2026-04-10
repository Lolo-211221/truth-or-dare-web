import { useEffect, useState } from 'react';
import type { RoomState } from '@shared';
import { socket } from '../socket';
import { kingsCupRule } from './kingsCupCopy';
import { usePartySfx } from '../party/usePartySfx';

type Props = {
  state: RoomState;
  myId: string | null;
  sfxOn: boolean;
};

export function KingsCupGame({ state, myId, sfxOn }: Props) {
  const kc = state.kingsCup;
  const { play } = usePartySfx(sfxOn);
  const [flip, setFlip] = useState(false);
  const [kingDraft, setKingDraft] = useState('');

  useEffect(() => {
    if (kc?.uiStep === 'cardFaceUp' && kc.faceUpCard) {
      setFlip(false);
      const t = window.requestAnimationFrame(() => {
        setFlip(true);
      });
      if (kc.faceUpCard.isX) {
        play('doom');
      }
      return () => window.cancelAnimationFrame(t);
    }
  }, [kc?.uiStep, kc?.faceUpCard?.rank, kc?.faceUpCard?.isX, play]);

  if (!kc) return null;

  const copy = kc.faceUpCard
    ? kingsCupRule(kc.faceUpCard.rank, kc.faceUpCard.isX)
    : { emoji: '🃏', title: '', rule: '' };

  const drawerName = state.players.find((p) => p.id === kc.drawerId)?.name ?? 'Player';
  const turnName = state.players.find((p) => p.id === kc.currentTurnPlayerId)?.name ?? '…';
  const penaltyName = kc.lastPenaltyPlayerId
    ? state.players.find((p) => p.id === kc.lastPenaltyPlayerId)?.name
    : null;

  const drawCard = () => socket.emit('kings_draw', {});
  const ackReveal = () => socket.emit('kings_ack_reveal', {});
  const heavenTap = () => socket.emit('kings_heaven_tap', {});
  const driveDone = () => socket.emit('kings_drive_done', {});
  const pickPlayer = (targetId: string) => socket.emit('kings_pick_player', { targetId });
  const submitRule = () => socket.emit('kings_submit_king_rule', { text: kingDraft });

  const isMyTurn = myId === kc.currentTurnPlayerId && kc.uiStep === 'waitingDraw';
  const driveCopy = kingsCupRule('5', false);

  return (
    <section className="kc-root">
      <div className="kc-banners">
        {kc.activeRule ? (
          <div className="kc-banner kc-banner--rule">
            <span className="kc-banner-emoji">👑</span>
            <div>
              <strong>House rule</strong>
              <p>{kc.activeRule}</p>
            </div>
          </div>
        ) : null}
        {kc.queenCurse ? (
          <div className="kc-banner kc-banner--queen">
            <span className="kc-banner-emoji">👸</span>
            <div>
              <strong>Queen curse</strong>
              <p>
                {state.players.find((p) => p.id === kc.queenCurse!.cursedId)?.name} can’t answer{' '}
                {state.players.find((p) => p.id === kc.queenCurse!.queenId)?.name}
                &apos;s questions (or drink).
              </p>
            </div>
          </div>
        ) : null}
        {kc.drinkingBuddy ? (
          <div className="kc-banner kc-banner--mate">
            <span className="kc-banner-emoji">🤝</span>
            <div>
              <strong>Buddies</strong>
              <p>
                {state.players.find((p) => p.id === kc.drinkingBuddy!.aId)?.name} &amp;{' '}
                {state.players.find((p) => p.id === kc.drinkingBuddy!.bId)?.name}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="kc-table">
        <div className="kc-pile" aria-hidden>
          {Array.from({ length: Math.min(8, Math.ceil(kc.cardsRemaining / 7)) }).map((_, i) => (
            <div key={i} className="kc-card-back" style={{ transform: `translate(${i * 2}px, ${i * -1}px)` }} />
          ))}
          <p className="kc-pile-count">{kc.cardsRemaining} cards</p>
        </div>

        <div className="kc-turn-pill">
          <span className="muted">Turn</span>
          <strong>{turnName}</strong>
        </div>
      </div>

      <ul className="kc-player-list">
        {state.players.map((p) => (
          <li key={p.id} className={p.id === kc.currentTurnPlayerId ? 'kc-pl--turn' : ''}>
            <span>{p.name}</span>
            {p.id === myId ? <span className="badge-you">you</span> : null}
          </li>
        ))}
      </ul>

      {kc.uiStep === 'waitingDraw' ? (
        <div className="kc-actions">
          {isMyTurn ? (
            <button type="button" className="btn-primary btn-primary-cta kc-draw-btn" onClick={drawCard}>
              Draw a card
            </button>
          ) : (
            <p className="muted kc-wait">Waiting for {turnName}…</p>
          )}
        </div>
      ) : null}

      {kc.uiStep === 'cardFaceUp' && kc.faceUpCard ? (
        <div className={`kc-reveal ${kc.faceUpCard.isX ? 'kc-reveal--x' : ''}`} role="dialog">
          <div className={`kc-flip ${flip ? 'kc-flip--on' : ''}`}>
            <div className="kc-card-face">
              <span className="kc-card-emoji">{copy.emoji}</span>
              <h2 className="kc-card-title">{copy.title}</h2>
              <p className="kc-card-sub">{kc.faceUpCard.isX ? '' : `${kc.faceUpCard.rank}${kc.faceUpCard.suit} · `}{copy.rule}</p>
              <p className="kc-card-drawer">Drawn by {drawerName}</p>
            </div>
          </div>
          {myId === kc.drawerId ? (
            <button type="button" className="btn-primary btn-primary-cta" onClick={ackReveal}>
              {kc.faceUpCard.isX ? 'Face the consequences…' : 'Reveal & continue'}
            </button>
          ) : (
            <p className="muted">Drawer is reading the card…</p>
          )}
        </div>
      ) : null}

      {kc.uiStep === 'heaven' ? (
        <div className="kc-minigame kc-minigame--heaven">
          <p className="kc-mg-title">🙏 Heaven race</p>
          <p className="muted">Last to tap drinks{kc.heavenEndsAt ? ` — hurry!` : ''}</p>
          <button type="button" className="btn-heaven" onClick={heavenTap}>
            ☝️ HEAVEN
          </button>
        </div>
      ) : null}

      {kc.uiStep === 'drive' ? (
        <div className="kc-minigame kc-minigame--drive">
          <p className="kc-mg-title">🚗 {driveCopy.title}</p>
          <p className="kc-drive-rule">{driveCopy.rule}</p>
          {myId === kc.drawerId ? (
            <button type="button" className="btn-primary btn-primary-cta" onClick={driveDone}>
              Done
            </button>
          ) : (
            <p className="muted">{drawerName} is leading this round…</p>
          )}
        </div>
      ) : null}

      {kc.uiStep === 'pickPlayer' && kc.pickPlayerFor ? (
        <div className="kc-minigame">
          <p className="kc-mg-title">
            {kc.pickPlayerFor === '2' ? '👉 Pick who drinks' : kc.pickPlayerFor === '8' ? '🤝 Pick your mate' : '👸 Who is cursed?'}
          </p>
          {myId === kc.drawerId ? (
            <div className="kc-pick-grid">
              {state.players
                .filter((p) => p.id !== myId)
                .map((p) => (
                  <button key={p.id} type="button" className="btn-secondary kc-pick-btn" onClick={() => pickPlayer(p.id)}>
                    {p.name}
                  </button>
                ))}
            </div>
          ) : (
            <p className="muted">{drawerName} is choosing…</p>
          )}
        </div>
      ) : null}

      {kc.uiStep === 'kingRule' ? (
        <div className="kc-minigame">
          <p className="kc-mg-title">👑 New house rule</p>
          {myId === kc.kingRuleSetterId ? (
            <>
              <textarea
                className="kc-rule-input"
                value={kingDraft}
                onChange={(e) => setKingDraft(e.target.value)}
                placeholder="e.g. No pointing with your elbows"
                rows={3}
                maxLength={280}
              />
              <button type="button" className="btn-primary" onClick={submitRule} disabled={!kingDraft.trim()}>
                Lock in rule
              </button>
            </>
          ) : (
            <p className="muted">{state.players.find((p) => p.id === kc.kingRuleSetterId)?.name} is writing…</p>
          )}
        </div>
      ) : null}

      {penaltyName && kc.uiStep === 'waitingDraw' ? (
        <p className="kc-penalty">
          Last round: <strong>{penaltyName}</strong> drinks
        </p>
      ) : null}
    </section>
  );
}
