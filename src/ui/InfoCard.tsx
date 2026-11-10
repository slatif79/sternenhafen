import { useState } from 'react';
import { canAfford, COSTS, type ResourceCount } from '../engine/game';
import { RESOURCES, TERRAIN_RESOURCE, type Terrain } from '../engine/types';
import { RESOURCE_STYLE, TERRAIN_STYLE } from './theme';

const TERRAIN_OF = Object.fromEntries(
  (Object.keys(TERRAIN_RESOURCE) as Terrain[]).filter((t) => TERRAIN_RESOURCE[t]).map((t) => [TERRAIN_RESOURCE[t], t]),
) as Record<string, Terrain>;

const BUILDS: { kind: keyof typeof COSTS; name: string; points: string }[] = [
  { kind: 'route', name: 'Raumroute', points: '' },
  { kind: 'outpost', name: 'Außenposten', points: '1 ★' },
  { kind: 'station', name: 'Station', points: '2 ★' },
  { kind: 'devCard', name: 'Entwicklungskarte', points: '' },
];

/**
 * Übersichtskarte neben dem Spielfeld: Rohstoffe mit Feldern und Baukosten.
 * Auf breiten Bildschirmen immer sichtbar, auf dem Handy über einen Knopf ausklappbar.
 * Mit `resources` wird markiert, was sich der Spieler am Gerät gerade leisten kann.
 */
export function InfoCard({ resources }: { resources: ResourceCount | null }) {
  const [open, setOpen] = useState(false);
  return (
    <aside className={`info-card ${open ? 'open' : ''}`}>
      <button className="info-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? '✕' : '📋 Kosten'}
      </button>
      <div className="info-body">
        <h3>Rohstoffe</h3>
        <ul className="info-res">
          {RESOURCES.map((r) => (
            <li key={r}>
              <span className="info-swatch" style={{ background: RESOURCE_STYLE[r].color }}>{RESOURCE_STYLE[r].icon}</span>
              <span>
                <strong>{RESOURCE_STYLE[r].name}</strong>
                <span className="muted small"> · {TERRAIN_STYLE[TERRAIN_OF[r]].name}</span>
              </span>
            </li>
          ))}
        </ul>

        <h3>Baukosten</h3>
        <ul className="info-costs">
          {BUILDS.map((b) => {
            const ok = resources ? canAfford(resources, COSTS[b.kind]) : false;
            return (
              <li key={b.kind} className={ok ? 'affordable' : ''}>
                <div className="info-cost-head">
                  <strong>{b.name}</strong>
                  {b.points && <span className="muted small">{b.points}</span>}
                  {ok && <span className="ok small" title="Kannst du dir leisten">✓</span>}
                </div>
                <div className="info-cost-items">
                  {RESOURCES.filter((r) => COSTS[b.kind][r]).map((r) => (
                    <span key={r} className="chip" style={{ borderColor: RESOURCE_STYLE[r].color }} title={RESOURCE_STYLE[r].name}>
                      {COSTS[b.kind][r]}× {RESOURCE_STYLE[r].icon}
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="muted tiny">Station ersetzt einen eigenen Außenposten. Bank 4:1, Häfen 3:1 / 2:1.</p>
      </div>
    </aside>
  );
}
