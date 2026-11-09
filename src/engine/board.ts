// Zufällige Erzeugung des Spielbretts: Felder, Zahlenchips, Häfen.

import { buildTopology, type Topology } from './geometry';
import { createRng, shuffle } from './rng';
import type { Board, Harbor, HarborKind, Terrain, Tile } from './types';

export const TOPOLOGY: Topology = buildTopology(2);

const TERRAIN_POOL: Terrain[] = [
  ...Array<Terrain>(4).fill('biodome'),
  ...Array<Terrain>(4).fill('icefield'),
  ...Array<Terrain>(4).fill('gascloud'),
  ...Array<Terrain>(3).fill('asteroid'),
  ...Array<Terrain>(3).fill('nebula'),
  'void',
];

const NUMBER_POOL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

const HARBOR_POOL: HarborKind[] = ['any', 'any', 'any', 'any', 'ore', 'ice', 'crystal', 'food', 'fuel'];

/** Abstände zwischen Häfen entlang der 30 Küstenkanten (Summe 30). */
const HARBOR_SPACING = [3, 3, 4, 3, 3, 4, 3, 3, 4];

const isHot = (n: number | null) => n === 6 || n === 8;

/** 6 und 8 dürfen nicht auf benachbarten Feldern liegen. */
export function hotNumbersSeparated(tiles: Tile[], topo: Topology = TOPOLOGY): boolean {
  return tiles.every(
    (t) => !isHot(t.number) || topo.hexes[t.hexId].neighbors.every((n) => !isHot(tiles[n].number)),
  );
}

export function generateBoard(seed: number): Board {
  const rng = createRng(seed);
  const topo = TOPOLOGY;

  let tiles: Tile[] = [];
  for (let attempt = 0; attempt < 1000; attempt++) {
    const terrains = shuffle(TERRAIN_POOL, rng);
    const numbers = shuffle(NUMBER_POOL, rng);
    let n = 0;
    tiles = terrains.map((terrain, hexId) => ({
      hexId,
      terrain,
      number: terrain === 'void' ? null : numbers[n++],
    }));
    if (hotNumbersSeparated(tiles, topo)) break;
  }

  const kinds = shuffle(HARBOR_POOL, rng);
  const offset = Math.floor(rng() * topo.coastEdges.length);
  const harbors: Harbor[] = [];
  let pos = offset;
  HARBOR_SPACING.forEach((step, i) => {
    harbors.push({ edgeId: topo.coastEdges[pos % topo.coastEdges.length], kind: kinds[i] });
    pos += step;
  });

  const pirateHex = tiles.find((t) => t.terrain === 'void')!.hexId;
  return { seed, tiles, harbors, pirateHex };
}

/** Wahrscheinlichkeitspunkte eines Zahlenchips (2/12 → 1 … 6/8 → 5). */
export function pips(n: number | null): number {
  return n === null ? 0 : 6 - Math.abs(7 - n);
}
