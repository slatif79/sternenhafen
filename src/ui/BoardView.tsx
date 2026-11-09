import { memo, useRef } from 'react';
import { pips, TOPOLOGY } from '../engine/board';
import type { Building } from '../engine/game';
import { cornerOffset } from '../engine/geometry';
import type { Board } from '../engine/types';
import { harborLabel, TERRAIN_STYLE } from './theme';
import { usePanZoom } from './usePanZoom';

const HEX_INSET = 0.96;
const hexPoints = (cx: number, cy: number, size = HEX_INSET) =>
  [0, 1, 2, 3, 4, 5]
    .map((i) => {
      const o = cornerOffset(i);
      return `${(cx + o.x * size).toFixed(3)},${(cy + o.y * size).toFixed(3)}`;
    })
    .join(' ');

const { hexes, vertices, edges } = TOPOLOGY;

/** Endpunkte einer Kante, an beiden Enden etwas eingekürzt */
function edgeLine(edgeId: number, shrink = 0.2) {
  const e = edges[edgeId];
  const a = vertices[e.a];
  const b = vertices[e.b];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { x1: a.x + dx * shrink, y1: a.y + dy * shrink, x2: b.x - dx * shrink, y2: b.y - dy * shrink };
}

/** Statische Ebene: Felder, Zahlen, Häfen – ändert sich nur mit dem Brett / Piraten. */
const Terrain = memo(function Terrain({ board }: { board: Board }) {
  return (
    <>
      {board.harbors.map((h) => {
        const e = edges[h.edgeId];
        const hex = hexes[e.hexes[0]];
        const va = vertices[e.a];
        const vb = vertices[e.b];
        const mx = (va.x + vb.x) / 2;
        const my = (va.y + vb.y) / 2;
        const dx = mx - hex.x;
        const dy = my - hex.y;
        const len = Math.hypot(dx, dy);
        const px = mx + (dx / len) * 0.62;
        const py = my + (dy / len) * 0.62;
        const label = harborLabel(h.kind);
        return (
          <g key={h.edgeId} className="harbor">
            <line x1={va.x} y1={va.y} x2={px} y2={py} />
            <line x1={vb.x} y1={vb.y} x2={px} y2={py} />
            <circle cx={px} cy={py} r={0.36} />
            {label.icon ? (
              <>
                <text x={px} y={py - 0.07} className="harbor-icon">{label.icon}</text>
                <text x={px} y={py + 0.2} className="harbor-ratio">{label.ratio}</text>
              </>
            ) : (
              <text x={px} y={py + 0.02} className="harbor-ratio big">{label.ratio}</text>
            )}
          </g>
        );
      })}

      {board.tiles.map((t) => {
        const hex = hexes[t.hexId];
        const style = TERRAIN_STYLE[t.terrain];
        const hot = t.number === 6 || t.number === 8;
        const p = pips(t.number);
        return (
          <g key={t.hexId} className="tile">
            <polygon points={hexPoints(hex.x, hex.y)} fill={style.color} />
            {style.icon && <text x={hex.x} y={hex.y - 0.48} className="tile-icon">{style.icon}</text>}
            {t.number !== null && (
              <g className={`token ${hot ? 'hot' : ''}`}>
                <circle cx={hex.x} cy={hex.y + 0.18} r={0.34} />
                <text x={hex.x} y={hex.y + 0.14} className="token-num">{t.number}</text>
                {Array.from({ length: p }, (_, i) => (
                  <circle key={i} className="pip" cx={hex.x + (i - (p - 1) / 2) * 0.075} cy={hex.y + 0.37} r={0.025} />
                ))}
              </g>
            )}
            {board.pirateHex === t.hexId && (
              <text x={hex.x} y={hex.y + (t.number === null ? 0.05 : -0.05)} className="pirate">🏴‍☠️</text>
            )}
          </g>
        );
      })}
    </>
  );
});

function BuildingShape({ x, y, type, color }: { x: number; y: number; type: Building['type']; color: string }) {
  if (type === 'outpost') {
    return <circle cx={x} cy={y} r={0.2} fill={color} className="piece" />;
  }
  // Station: Sechseck mit Kern
  return (
    <g>
      <polygon points={hexPoints(x, y, 0.3)} fill={color} className="piece" />
      <circle cx={x} cy={y} r={0.09} className="station-core" />
    </g>
  );
}

interface Props {
  board: Board;
  buildings: (Building | null)[];
  routes: (number | null)[];
  colors: string[];
  targetVertices?: number[];
  targetEdges?: number[];
  targetHexes?: number[];
  /** Kurz hervorgehobene Änderungen (letzte Aktion) */
  flash?: { key: number; vertices: number[]; edges: number[]; hexes: number[]; color: string };
  /** Farbe des Spielers, der gerade etwas platziert (für die Vorschau) */
  activeColor?: string;
  onVertexTap?: (id: number) => void;
  onEdgeTap?: (id: number) => void;
  onHexTap?: (id: number) => void;
}

export function BoardView({
  board, buildings, routes, colors, targetVertices = [], targetEdges = [], targetHexes = [], activeColor = '#fff',
  onVertexTap, onEdgeTap, onHexTap, flash,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { view, reset, zoomBy, wasDragged } = usePanZoom(svgRef);
  const tap = (fn?: (id: number) => void, id?: number) => () => {
    if (!wasDragged() && fn && id !== undefined) fn(id);
  };

  return (
    <div className="board-wrap">
      <svg ref={svgRef} className="board" viewBox="-6.4 -5.8 12.8 11.6" preserveAspectRatio="xMidYMid meet">
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          <Terrain board={board} />

          {/* Felder für das Piratenschiff */}
          {targetHexes.map((id) => (
            <polygon
              key={`th${id}`}
              points={hexPoints(hexes[id].x, hexes[id].y, 0.88)}
              className="target target-hex"
              stroke={activeColor}
              onClick={tap(onHexTap, id)}
            />
          ))}

          {/* Raumrouten */}
          {routes.map((owner, id) =>
            owner === null ? null : (
              <g key={`r${id}`} className="route">
                <line {...edgeLine(id)} className="route-outline" />
                <line {...edgeLine(id)} stroke={colors[owner]} className="route-fill" />
              </g>
            ),
          )}

          {/* Bauten */}
          {buildings.map((b, id) =>
            b ? <BuildingShape key={`b${id}`} x={vertices[id].x} y={vertices[id].y} type={b.type} color={colors[b.owner]} /> : null,
          )}

          {/* Letzte Aktion kurz hervorheben */}
          {flash && (
            <g key={flash.key} className="flash" stroke={flash.color}>
              {flash.hexes.map((id) => (
                <polygon key={`fh${id}`} points={hexPoints(hexes[id].x, hexes[id].y, 0.9)} className="flash-hex" />
              ))}
              {flash.edges.map((id) => (
                <line key={`fe${id}`} {...edgeLine(id, 0.05)} className="flash-edge" />
              ))}
              {flash.vertices.map((id) => (
                <circle key={`fv${id}`} cx={vertices[id].x} cy={vertices[id].y} r={0.42} className="flash-vertex" />
              ))}
            </g>
          )}

          {/* Mögliche Bauplätze */}
          {targetEdges.map((id) => (
            <g key={`te${id}`} className="target" onClick={tap(onEdgeTap, id)}>
              <line {...edgeLine(id)} className="target-edge" stroke={activeColor} />
              <line {...edgeLine(id, 0.1)} className="hit-edge" />
            </g>
          ))}
          {targetVertices.map((id) => (
            <g key={`tv${id}`} className="target" onClick={tap(onVertexTap, id)}>
              <circle cx={vertices[id].x} cy={vertices[id].y} r={0.17} className="target-vertex" stroke={activeColor} />
              <circle cx={vertices[id].x} cy={vertices[id].y} r={0.38} className="hit-vertex" />
            </g>
          ))}
        </g>
      </svg>

      <div className="zoom-controls">
        <button onClick={() => zoomBy(1.25)} aria-label="Hineinzoomen">＋</button>
        <button onClick={() => zoomBy(0.8)} aria-label="Herauszoomen">−</button>
        <button onClick={reset} aria-label="Ansicht zurücksetzen">⟲</button>
      </div>
    </div>
  );
}
