import type { RoomState } from '@shared';
import { MAX_TEAM_NAME_LENGTH } from '@shared';
import type { CSSProperties, RefObject } from 'react';

type Props = {
  state: RoomState;
  teamLabelA: string;
  teamLabelB: string;
  teamNameInputA: RefObject<HTMLInputElement | null>;
  teamNameInputB: RefObject<HTMLInputElement | null>;
  teamsEnabled: boolean;
  onSaveNames: () => void;
  onAutoBalance: () => void;
  onAssign: (playerId: string, teamId: string) => void;
  onReveal: () => void;
};

const TEAM_COLORS: Record<string, { border: string; bg: string; dot: string }> = {
  t1: { border: 'rgba(96, 165, 250, 0.45)', bg: 'rgba(59, 130, 246, 0.12)', dot: '#60a5fa' },
  t2: { border: 'rgba(244, 114, 182, 0.45)', bg: 'rgba(244, 114, 182, 0.12)', dot: '#f472b6' },
};

export function TeamSetupPanel({
  state,
  teamLabelA,
  teamLabelB,
  teamNameInputA,
  teamNameInputB,
  teamsEnabled,
  onSaveNames,
  onAutoBalance,
  onAssign,
  onReveal,
}: Props) {
  return (
    <div className="team-setup-card">
      <div className="team-setup-head">
        <div>
          <h2 className="team-setup-title">Teams</h2>
          <p className="muted team-setup-desc">
            {teamsEnabled
              ? 'Points on rounds and team votes. Preview the reveal before you start.'
              : 'Turn on team mode in the settings panel (⚙️) to split the room and assign colors.'}
          </p>
        </div>
      </div>

      {teamsEnabled ? (
        <div className="team-setup-body animate-in">
          <div className="team-name-pair">
            <div
              className="team-field"
              style={{ borderColor: TEAM_COLORS.t1!.border, background: TEAM_COLORS.t1!.bg }}
            >
              <span className="team-dot" style={{ background: TEAM_COLORS.t1!.dot }} />
              <label htmlFor="tn-a">Team 1 name</label>
              <input
                ref={teamNameInputA}
                id="tn-a"
                key={`ta-${teamLabelA}`}
                maxLength={MAX_TEAM_NAME_LENGTH}
                defaultValue={teamLabelA}
                autoComplete="off"
              />
            </div>
            <div
              className="team-field"
              style={{ borderColor: TEAM_COLORS.t2!.border, background: TEAM_COLORS.t2!.bg }}
            >
              <span className="team-dot" style={{ background: TEAM_COLORS.t2!.dot }} />
              <label htmlFor="tn-b">Team 2 name</label>
              <input
                ref={teamNameInputB}
                id="tn-b"
                key={`tb-${teamLabelB}`}
                maxLength={MAX_TEAM_NAME_LENGTH}
                defaultValue={teamLabelB}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="team-actions-row">
            <button type="button" className="btn-secondary btn-pill" onClick={onSaveNames}>
              Save names
            </button>
            <button type="button" className="btn-secondary btn-pill" onClick={onAutoBalance}>
              Balance rosters
            </button>
          </div>
          <ul className="team-assign team-assign--cards">
            {state.players.map((p) => (
              <li key={p.id}>
                <span className="team-player-name">{p.name}</span>
                <div className="team-pill-toggle" role="group" aria-label={`Assign ${p.name}`}>
                  <button
                    type="button"
                    className={`team-pill ${state.playerTeamId[p.id] === 't1' ? 'team-pill--active' : ''}`}
                    style={{ '--team-accent': TEAM_COLORS.t1!.dot } as CSSProperties}
                    onClick={() => onAssign(p.id, 't1')}
                  >
                    {teamLabelA}
                  </button>
                  <button
                    type="button"
                    className={`team-pill ${state.playerTeamId[p.id] === 't2' ? 'team-pill--active' : ''}`}
                    style={{ '--team-accent': TEAM_COLORS.t2!.dot } as CSSProperties}
                    onClick={() => onAssign(p.id, 't2')}
                  >
                    {teamLabelB}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-secondary btn-block team-reveal-btn" onClick={onReveal}>
            Preview team reveal
          </button>
        </div>
      ) : null}
    </div>
  );
}
