import { useEffect, useMemo, useState } from 'react';
import type { Player, TeamInfo, VoteSessionState } from '@shared';
import { usePartySfx } from './usePartySfx';

function landslideMeta(tallies: Record<string, number> | undefined, totalVotes: number) {
  if (!tallies || totalVotes < 2) return null;
  const vals = Object.values(tallies);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  if (max === min) return null;
  if (max / totalVotes >= 0.65 && max - min >= 2) {
    return { kind: 'landslide' as const, n: max };
  }
  return null;
}

function candidateLabel(
  cid: string,
  vote: VoteSessionState,
  teams: TeamInfo[],
  nameById: Map<string, string>,
): string {
  if (vote.mode === 'teams') {
    return teams.find((t) => t.id === cid)?.name ?? cid;
  }
  return nameById.get(cid) ?? '…';
}

export function VoteOverlay({
  teams,
  players,
  vote,
  myId,
  onVote,
}: {
  teams: TeamInfo[];
  players: Player[];
  vote: VoteSessionState;
  myId: string | null;
  onVote: (candidateId: string) => void;
}) {
  const { play } = usePartySfx();
  const [phase, setPhase] = useState<'count' | 'bars'>('count');
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (!vote.revealed) return;
    const ids: number[] = [];
    ids.push(
      window.setTimeout(() => {
        setPhase('count');
        setCount(3);
        play('drum');
      }, 0),
    );
    ids.push(
      window.setTimeout(() => {
        play('tick');
        setCount(2);
      }, 550),
    );
    ids.push(
      window.setTimeout(() => {
        play('tick');
        setCount(1);
      }, 1100),
    );
    ids.push(window.setTimeout(() => setPhase('bars'), 1750));
    return () => ids.forEach((id) => clearTimeout(id));
  }, [vote.revealed, vote.id, play]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.name);
    return m;
  }, [players]);

  const candidates = vote.candidateIds ?? [];
  const youVoted = vote.youVoted ?? false;
  const totalVotes = vote.voteCount ?? 0;
  const ls = landslideMeta(vote.tallies, totalVotes);

  if (!vote.revealed) {
    return (
      <div className="vote-overlay">
        <div className="vote-card">
          <h2 className="vote-question">Secret vote</h2>
          <p className="vote-q">{vote.question ?? ''}</p>
          <p className="muted vote-sub">
            {totalVotes}/{players.length} voted · tap a {vote.mode === 'teams' ? 'team' : 'name'}
          </p>
          <div className="vote-candidates">
            {candidates.map((cid) => {
              const label = candidateLabel(cid, vote, teams, nameById);
              const disabled =
                youVoted || (!vote.allowSelfVote && vote.mode === 'players' && cid === myId);
              return (
                <button
                  key={cid}
                  type="button"
                  className={`vote-chip ${youVoted ? 'vote-chip-disabled' : ''}`}
                  disabled={disabled || !myId}
                  onClick={() => onVote(cid)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {youVoted ? <p className="vote-sealed">Vote locked in</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="vote-overlay vote-overlay-reveal">
      <div className="vote-card vote-card-reveal">
        {phase === 'count' ? (
          <div className="vote-countdown">
            <span className="vote-count-num">{count}</span>
          </div>
        ) : (
          <>
            <h2 className="vote-question">Results</h2>
            <p className="vote-q">{vote.question}</p>
            {ls ? <p className="vote-landslide">Landslide · {ls.n} votes</p> : null}
            <div className="vote-bars">
              {candidates.map((cid) => {
                const n = vote.tallies?.[cid] ?? 0;
                const label = candidateLabel(cid, vote, teams, nameById);
                const pct = totalVotes ? Math.round((n / totalVotes) * 100) : 0;
                return (
                  <div key={cid} className="vote-bar-row">
                    <div className="vote-bar-label">{label}</div>
                    <div className="vote-bar-track">
                      <div className="vote-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="vote-bar-num">{n}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
