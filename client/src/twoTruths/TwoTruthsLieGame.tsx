import { useEffect, useState } from 'react';
import type { RoomState } from '@shared';
import { MAX_CARD_TEXT_LENGTH } from '@shared';
import { socket } from '../socket';

type Props = {
  state: RoomState;
  myId: string | null;
};

export function TwoTruthsLieGame({ state, myId }: Props) {
  const ttl = state.twoTruthsLie;
  const [s0, setS0] = useState('');
  const [s1, setS1] = useState('');
  const [s2, setS2] = useState('');
  const [lieIdx, setLieIdx] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    setS0('');
    setS1('');
    setS2('');
    setLieIdx(0);
  }, [ttl?.hotSeatPlayerId, ttl?.roundNumber]);

  if (!ttl) return null;

  const hotName = state.players.find((p) => p.id === ttl.hotSeatPlayerId)?.name ?? 'Player';
  const isHot = myId === ttl.hotSeatPlayerId;

  const submitStatements = () => {
    socket.emit('ttl_submit_statements', {
      statements: [s0.trim(), s1.trim(), s2.trim()] as [string, string, string],
      lieIndex: lieIdx,
    });
  };

  const vote = (choice: number) => {
    socket.emit('ttl_vote', { choice });
  };

  const ackReveal = () => {
    socket.emit('ttl_ack_reveal', {});
  };

  return (
    <section className="ttl-root">
      <div className="ttl-header">
        <h2 className="ttl-title">🤥 Two Truths &amp; a Lie</h2>
        <p className="muted">
          Round {ttl.roundNumber} / {ttl.totalRounds} · Hot seat: <strong>{hotName}</strong>
          {isHot ? <span className="badge-you">you</span> : null}
        </p>
      </div>

      {ttl.uiStep === 'entering' && isHot ? (
        <div className="ttl-private card-panel">
          <p className="ttl-private-banner">🔒 Only you can see this — stay screen-private.</p>
          <label className="ttl-label">Statement 1</label>
          <textarea
            value={s0}
            onChange={(e) => setS0(e.target.value)}
            maxLength={MAX_CARD_TEXT_LENGTH}
            rows={2}
            className="ttl-ta"
          />
          <label className="ttl-label">Statement 2</label>
          <textarea
            value={s1}
            onChange={(e) => setS1(e.target.value)}
            maxLength={MAX_CARD_TEXT_LENGTH}
            rows={2}
            className="ttl-ta"
          />
          <label className="ttl-label">Statement 3</label>
          <textarea
            value={s2}
            onChange={(e) => setS2(e.target.value)}
            maxLength={MAX_CARD_TEXT_LENGTH}
            rows={2}
            className="ttl-ta"
          />
          <p className="muted ttl-lie-pick">Which one is the lie?</p>
          <div className="ttl-lie-row">
            {([0, 1, 2] as const).map((i) => (
              <button
                key={i}
                type="button"
                className={`btn-secondary ${lieIdx === i ? 'mode-card--active' : ''}`}
                onClick={() => setLieIdx(i)}
              >
                #{i + 1}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-primary btn-primary-cta"
            onClick={submitStatements}
            disabled={!s0.trim() || !s1.trim() || !s2.trim()}
          >
            Lock in &amp; show the room
          </button>
        </div>
      ) : null}

      {ttl.uiStep === 'entering' && !isHot ? (
        <div className="ttl-wait card-panel">
          <p className="muted" style={{ margin: 0 }}>
            <strong>{hotName}</strong> is writing three statements — look away so it stays private.
          </p>
        </div>
      ) : null}

      {ttl.uiStep === 'voting' && ttl.statements ? (
        <div className="ttl-vote card-panel">
          <p className="ttl-vote-lead">Which statement is the lie?</p>
          {ttl.statements.map((text, i) => (
            <div key={i} className="ttl-stmt">
              <span className="ttl-stmt-n">{i + 1}.</span>
              <p>{text}</p>
            </div>
          ))}
          {!isHot && !ttl.youVoted ? (
            <div className="ttl-vote-btns">
              <button type="button" className="btn-primary" onClick={() => vote(0)}>
                Vote #1
              </button>
              <button type="button" className="btn-primary" onClick={() => vote(1)}>
                Vote #2
              </button>
              <button type="button" className="btn-primary" onClick={() => vote(2)}>
                Vote #3
              </button>
            </div>
          ) : null}
          {!isHot && ttl.youVoted ? <p className="muted">Vote locked in.</p> : null}
          {isHot ? <p className="muted">Others are voting…</p> : null}
          <p className="muted ttl-vote-count">
            {ttl.votesReceived} / {ttl.votesExpected} votes
          </p>
        </div>
      ) : null}

      {ttl.uiStep === 'reveal' && ttl.statements && ttl.lieIndex !== null ? (
        <div className="ttl-reveal card-panel">
          <h3>Reveal</h3>
          <p>
            The lie was <strong>#{ttl.lieIndex + 1}</strong>:{' '}
            <em>{ttl.statements[ttl.lieIndex]}</em>
          </p>
          {ttl.allVotersCorrect ? (
            <p className="ttl-drink-msg">
              Everyone guessed the lie — <strong>{hotName}</strong> drinks.
            </p>
          ) : ttl.votesExpected > 0 && ttl.wrongGuessers.length >= ttl.votesExpected ? (
            <p className="ttl-drink-msg">Everyone guessed wrong — <strong>{hotName}</strong> is safe.</p>
          ) : (
            <p className="ttl-drink-msg">
              Wrong guessers drink:{' '}
              {ttl.wrongGuessers
                .map((id) => state.players.find((p) => p.id === id)?.name)
                .filter(Boolean)
                .join(', ') || '—'}
            </p>
          )}
          {ttl.drinkers.length > 0 ? (
            <p className="muted">
              Drinking this round:{' '}
              {ttl.drinkers
                .map((id) => state.players.find((p) => p.id === id)?.name)
                .join(', ')}
            </p>
          ) : null}
          <button type="button" className="btn-primary btn-primary-cta" onClick={ackReveal}>
            Next round
          </button>
        </div>
      ) : null}
    </section>
  );
}
