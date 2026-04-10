import type { MostLikelyCategory, RoomSettings, TruthDarePlayStyle } from '@shared';

type Props = {
  settings: RoomSettings;
  updateRoomSettings: (partial: Partial<RoomSettings>) => void;
  musicOn: boolean;
  onMusicToggle: (on: boolean) => void;
  sfxOn: boolean;
  onSfxToggle: (on: boolean) => void;
};

export function LobbySettingsContent({
  settings,
  updateRoomSettings,
  musicOn,
  onMusicToggle,
  sfxOn,
  onSfxToggle,
}: Props) {
  const tdStyle = settings.truthDarePlayStyle ?? 'mixed';

  return (
    <div className="settings-stack">
      <div className="settings-audio-row">
        <label className="settings-audio-item">
          <span className="switch">
            <input
              type="checkbox"
              checked={musicOn}
              onChange={(e) => onMusicToggle(e.target.checked)}
            />
            <span className="switch-slider" aria-hidden />
          </span>
          <span>Lobby music</span>
        </label>
        <label className="settings-audio-item">
          <span className="switch">
            <input type="checkbox" checked={sfxOn} onChange={(e) => onSfxToggle(e.target.checked)} />
            <span className="switch-slider" aria-hidden />
          </span>
          <span>Timer &amp; moment sounds</span>
        </label>
      </div>

      <label className="toggle-line settings-toggle settings-team-toggle">
        <span className="switch">
          <input
            type="checkbox"
            checked={settings.teamsEnabled}
            onChange={(e) => updateRoomSettings({ teamsEnabled: e.target.checked })}
          />
          <span className="switch-slider" aria-hidden />
        </span>
        Team mode
      </label>

      <div className="settings-group">
        <p className="settings-group-title">Truth or Dare deck</p>
        <p className="muted settings-hint">Applies to classic shared deck. Pick &amp; write uses the same mix rule for the choice step.</p>
        <div className="td-style-grid">
          {(
            [
              { id: 'truthOnly' as const, title: 'Truth only', sub: 'No dares in the deck' },
              { id: 'dareOnly' as const, title: 'Dare only', sub: 'No truths in the deck' },
              { id: 'mixed' as const, title: 'Mixed', sub: 'Truths & dares' },
            ] satisfies { id: TruthDarePlayStyle; title: string; sub: string }[]
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`mode-card mode-card--sm ${tdStyle === opt.id ? 'mode-card--active' : ''}`}
              onClick={() => updateRoomSettings({ truthDarePlayStyle: opt.id })}
            >
              <span className="mode-card-title">{opt.title}</span>
              <span className="mode-card-sub">{opt.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <label htmlFor="st-truth">Truths per person</label>
      <input
        id="st-truth"
        type="number"
        min={tdStyle === 'dareOnly' ? 0 : 1}
        max={10}
        disabled={tdStyle === 'dareOnly'}
        value={settings.truthsPerPlayer}
        onChange={(e) => updateRoomSettings({ truthsPerPlayer: Number(e.target.value) || 0 })}
      />

      <label htmlFor="st-dare">Dares per person</label>
      <input
        id="st-dare"
        type="number"
        min={tdStyle === 'truthOnly' ? 0 : 1}
        max={10}
        disabled={tdStyle === 'truthOnly'}
        value={settings.daresPerPlayer}
        onChange={(e) => updateRoomSettings({ daresPerPlayer: Number(e.target.value) || 0 })}
      />

      <label htmlFor="st-read">Truth answer on screen (seconds)</label>
      <input
        id="st-read"
        type="number"
        min={3}
        max={120}
        value={Math.round(settings.truthAnswerDisplayMs / 1000)}
        onChange={(e) =>
          updateRoomSettings({
            truthAnswerDisplayMs: Math.max(3000, (Number(e.target.value) || 10) * 1000),
          })
        }
      />

      <label htmlFor="st-author">Time to write prompt — hot seat (seconds)</label>
      <input
        id="st-author"
        type="number"
        min={15}
        max={300}
        value={Math.round(settings.authorPromptMs / 1000)}
        onChange={(e) =>
          updateRoomSettings({
            authorPromptMs: Math.max(15000, (Number(e.target.value) || 90) * 1000),
          })
        }
      />

      <label htmlFor="st-cycles">Full rounds (hot seat)</label>
      <input
        id="st-cycles"
        type="number"
        min={1}
        max={10}
        value={settings.pickCycles}
        onChange={(e) => updateRoomSettings({ pickCycles: Number(e.target.value) || 1 })}
      />

      <p className="muted settings-section-label">Round timer (optional)</p>
      <p className="muted settings-hint">Countdown for choosing Truth/Dare and playing the card. Auto-skips when time runs out.</p>
      <div className="timer-presets">
        {(
          [
            ['Off', 0],
            ['15s', 15],
            ['30s', 30],
            ['60s', 60],
            ['Custom', -1],
          ] as const
        ).map(([label, val]) => (
          <button
            key={label}
            type="button"
            className={
              settings.turnTimerSeconds === val ? 'btn-primary timer-preset' : 'btn-secondary timer-preset'
            }
            onClick={() => updateRoomSettings({ turnTimerSeconds: val })}
          >
            {label}
          </button>
        ))}
      </div>
      {settings.turnTimerSeconds === -1 ? (
        <>
          <label htmlFor="st-custom-t">Custom seconds</label>
          <input
            id="st-custom-t"
            type="number"
            min={5}
            max={300}
            value={settings.turnTimerCustomSeconds}
            onChange={(e) =>
              updateRoomSettings({
                turnTimerCustomSeconds: Math.min(300, Math.max(5, Number(e.target.value) || 45)),
              })
            }
          />
        </>
      ) : null}

      <div className="settings-group">
        <p className="settings-group-title">Most likely to — deck</p>
        <div className="mlt-source-grid">
          {(
            [
              { id: 'builtin' as const, title: 'Built-in only', sub: 'Curated prompts' },
              { id: 'custom' as const, title: 'Custom only', sub: 'Your lines' },
              { id: 'mixed' as const, title: 'Mix both', sub: 'Best of both' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`mode-card mode-card--sm ${settings.mltDeckSource === opt.id ? 'mode-card--active' : ''}`}
              onClick={() => updateRoomSettings({ mltDeckSource: opt.id })}
            >
              <span className="mode-card-title">{opt.title}</span>
              <span className="mode-card-sub">{opt.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <label htmlFor="mlt-cat">Most likely to — vibe</label>
      <select
        id="mlt-cat"
        value={settings.mostLikelyCategory}
        onChange={(e) =>
          updateRoomSettings({
            mostLikelyCategory: e.target.value as MostLikelyCategory,
          })
        }
      >
        <option value="funny">Funny</option>
        <option value="college">College</option>
        <option value="chaotic">Chaotic</option>
        <option value="spicy">Spicy / flirty</option>
      </select>

      <label className="toggle-line settings-toggle">
        <span className="switch">
          <input
            type="checkbox"
            checked={settings.preventSelfVoteDefault}
            onChange={(e) => updateRoomSettings({ preventSelfVoteDefault: e.target.checked })}
          />
          <span className="switch-slider" aria-hidden />
        </span>
        Block self-votes in party polls (default)
      </label>
    </div>
  );
}
