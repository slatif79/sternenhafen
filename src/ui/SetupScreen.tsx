import { useState } from 'react';
import { RulesDialog } from './Rules';
import { PLAYER_COLORS, type AiLevel, type PlayerConfig, type PlayerKind } from '../engine/game';

const DEFAULT_NAMES = ['Spieler 1', 'Nova', 'Orion', 'Vega'];
export const LEVEL_LABEL: Record<AiLevel, string> = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };

interface Seat {
  name: string;
  kind: PlayerKind;
  level: AiLevel;
}

const INITIAL: Seat[] = DEFAULT_NAMES.map((name, i) => ({ name, kind: i === 0 ? 'human' : 'ai', level: 'medium' }));

export function SetupScreen({ onStart }: { onStart: (players: PlayerConfig[]) => void }) {
  const [count, setCount] = useState(4);
  const [seats, setSeats] = useState<Seat[]>(INITIAL);
  const [showRules, setShowRules] = useState(false);
  const active = seats.slice(0, count);
  const humans = active.filter((s) => s.kind === 'human').length;

  const update = (i: number, patch: Partial<Seat>) => setSeats((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const start = () =>
    onStart(
      active.map((s, i) => ({
        name: s.name.trim() || (s.kind === 'ai' ? `KI ${i + 1}` : `Spieler ${i + 1}`),
        kind: s.kind,
        level: s.level,
      })),
    );

  return (
    <div className="setup">
      <div className="setup-card">
        <h1>✦ Sternenhafen</h1>
        <p className="muted">Baue Raumrouten, Außenposten und Stationen. Wer zuerst 10 Siegpunkte hat, gewinnt.</p>

        <h2>Anzahl Spieler</h2>
        <div className="segmented">
          {[2, 3, 4].map((n) => (
            <button key={n} className={n === count ? 'active' : ''} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>

        <h2>Spieler</h2>
        {active.map((seat, i) => (
          <div key={i} className="seat">
            <div className="player-row">
              <span className="dot" style={{ background: PLAYER_COLORS[i] }} />
              <input
                value={seat.name}
                maxLength={16}
                aria-label={`Name Spieler ${i + 1}`}
                onChange={(e) => update(i, { name: e.target.value })}
                onFocus={(e) => e.target.select()}
              />
              <div className="segmented mini kind-toggle">
                <button className={seat.kind === 'human' ? 'active' : ''} onClick={() => update(i, { kind: 'human' })} title="Mensch" aria-label="Mensch">
                  👤
                </button>
                <button className={seat.kind === 'ai' ? 'active' : ''} onClick={() => update(i, { kind: 'ai' })} title="Computergegner" aria-label="Computergegner">
                  🤖
                </button>
              </div>
            </div>
            {seat.kind === 'ai' && (
              <div className="segmented mini level-row">
                {(['easy', 'medium', 'hard'] as AiLevel[]).map((l) => (
                  <button key={l} className={seat.level === l ? 'active' : ''} onClick={() => update(i, { level: l })}>
                    {LEVEL_LABEL[l]}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {humans === 0 && <p className="error small">Mindestens ein Mensch muss mitspielen.</p>}
        {humans > 1 && <p className="muted small">Mehrere Menschen spielen abwechselnd an diesem Gerät.</p>}

        <button className="primary wide" disabled={humans === 0} onClick={start}>
          Spiel starten
        </button>
        <button className="wide link-btn" onClick={() => setShowRules(true)}>📖 Spielregeln</button>
      </div>
      {showRules && <RulesDialog onClose={() => setShowRules(false)} />}
    </div>
  );
}
