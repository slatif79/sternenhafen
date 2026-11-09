import { useEffect, useRef } from 'react';
import { COSTS, DEV_CARD_INFO, type GameState } from '../engine/game';
import { RESOURCES } from '../engine/types';
import { Sheet } from './Dialogs';
import { RESOURCE_STYLE, TERRAIN_STYLE } from './theme';

function CostIcons({ kind }: { kind: keyof typeof COSTS }) {
  const c = COSTS[kind];
  return <span>{RESOURCES.flatMap((r) => Array.from({ length: c[r] ?? 0 }, () => RESOURCE_STYLE[r].icon)).join(' ')}</span>;
}

export function RulesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Spielregeln" onClose={onClose}>
      <div className="rules">
        <h3>Ziel</h3>
        <p>Wer in seinem Zug als Erster <strong>10 Siegpunkte</strong> hat, gewinnt.</p>

        <h3>Felder & Rohstoffe</h3>
        <ul>
          {(['asteroid', 'icefield', 'nebula', 'biodome', 'gascloud'] as const).map((t) => (
            <li key={t}>{TERRAIN_STYLE[t].icon} {TERRAIN_STYLE[t].name}</li>
          ))}
          <li>Der leere Raum liefert nichts – hier startet das Piratenschiff 🏴‍☠️.</li>
        </ul>
        <p>Würfelt jemand die Zahl eines Feldes, erhält jeder mit Außenposten an diesem Feld 1 Rohstoff, mit Station 2.</p>

        <h3>Gründung</h3>
        <p>Reihum setzt jeder einen Außenposten und eine Raumroute daran, danach in umgekehrter Reihenfolge ein zweites Mal. Der zweite Außenposten bringt sofort je einen Rohstoff der angrenzenden Felder.</p>

        <h3>Dein Zug</h3>
        <ol>
          <li><strong>Würfeln</strong> – alle erhalten Erträge.</li>
          <li><strong>Handeln</strong> – mit Mitspielern oder der Bank (4:1, an Häfen 3:1 oder 2:1).</li>
          <li><strong>Bauen</strong> und Karten kaufen, so oft du willst.</li>
          <li><strong>Zug beenden.</strong></li>
        </ol>

        <h3>Bauen</h3>
        <table className="cost-table">
          <tbody>
            <tr><td>Raumroute</td><td><CostIcons kind="route" /></td><td>an eigene Route oder eigenen Bau</td></tr>
            <tr><td>Außenposten (1 ★)</td><td><CostIcons kind="outpost" /></td><td>an eigener Route, Nachbarecken frei</td></tr>
            <tr><td>Station (2 ★)</td><td><CostIcons kind="station" /></td><td>ersetzt eigenen Außenposten</td></tr>
            <tr><td>Entwicklungskarte</td><td><CostIcons kind="devCard" /></td><td>zufällig vom Stapel</td></tr>
          </tbody>
        </table>
        <p className="muted small">Abstandsregel: Zwischen zwei Außenposten/Stationen muss immer mindestens eine freie Ecke liegen.</p>

        <h3>Eine 7 – die Piraten kommen</h3>
        <p>Niemand erhält Erträge. Wer mehr als 7 Karten hat, wirft die Hälfte (abgerundet) ab. Dann versetzt der Würfelnde das Piratenschiff: Das Feld liefert nichts mehr, und er raubt einem Mitspieler an diesem Feld eine zufällige Karte.</p>

        <h3>Entwicklungskarten</h3>
        <ul>
          {(['knight', 'routes', 'plenty', 'monopoly', 'point'] as const).map((t) => (
            <li key={t}>{DEV_CARD_INFO[t].icon} <strong>{DEV_CARD_INFO[t].name}</strong> – {DEV_CARD_INFO[t].text}</li>
          ))}
        </ul>
        <p className="muted small">Pro Zug eine Karte; nicht im Zug des Kaufs. Den Raumjäger darfst du auch vor dem Würfeln spielen.</p>

        <h3>Bonuspunkte</h3>
        <ul>
          <li>🛣️ <strong>Längste Route</strong> (+2): mindestens 5 zusammenhängende Raumrouten. Fremde Bauten unterbrechen.</li>
          <li>🛡️ <strong>Größte Flotte</strong> (+2): mindestens 3 gespielte Raumjäger.</li>
        </ul>
        <p className="muted small">Wer gleichzieht, übernimmt den Bonus nicht – man muss mehr haben.</p>
      </div>
    </Sheet>
  );
}

/** Spielverlauf mit farbigen Spielernamen, neueste Einträge unten. */
export function LogDialog({ game, onClose }: { game: GameState; onClose: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [game.log.length]);
  const lines = game.log.slice(-60);
  return (
    <Sheet title="Verlauf" onClose={onClose}>
      <div className="log-list">
        {lines.map((line, i) => {
          const pl = game.players.find((p) => line.startsWith(p.name) || line.startsWith(`🤝 ${p.name}`) || line.startsWith(`🏆 ${p.name}`));
          return (
            <div key={i} className="log-entry" style={{ borderLeftColor: pl?.color ?? 'transparent' }}>
              {line}
            </div>
          );
        })}
        <div ref={end} />
      </div>
    </Sheet>
  );
}
