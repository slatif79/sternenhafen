import { describe, expect, it } from 'vitest';
import { generateBoard, hotNumbersSeparated, pips, TOPOLOGY } from './board';

describe('Topologie', () => {
  it('hat 19 Felder, 54 Ecken, 72 Kanten und 30 Küstenkanten', () => {
    expect(TOPOLOGY.hexes).toHaveLength(19);
    expect(TOPOLOGY.vertices).toHaveLength(54);
    expect(TOPOLOGY.edges).toHaveLength(72);
    expect(TOPOLOGY.coastEdges).toHaveLength(30);
  });

  it('jede Ecke hat 2–3 Nachbarecken und 1–3 Felder', () => {
    for (const v of TOPOLOGY.vertices) {
      expect(v.neighbors.length).toBeGreaterThanOrEqual(2);
      expect(v.neighbors.length).toBeLessThanOrEqual(3);
      expect(v.hexes.length).toBeGreaterThanOrEqual(1);
      expect(v.hexes.length).toBeLessThanOrEqual(3);
      expect(v.edges.length).toBe(v.neighbors.length);
    }
  });

  it('das Mittelfeld hat 6 Nachbarn', () => {
    const center = TOPOLOGY.hexes.find((h) => h.q === 0 && h.r === 0)!;
    expect(center.neighbors).toHaveLength(6);
  });
});

describe('Brett-Generator', () => {
  it('ist bei gleichem Seed reproduzierbar', () => {
    expect(generateBoard(42)).toEqual(generateBoard(42));
  });

  it('verteilt Felder, Zahlen und Häfen korrekt (100 Seeds)', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const b = generateBoard(seed);
      const counts: Record<string, number> = {};
      b.tiles.forEach((t) => (counts[t.terrain] = (counts[t.terrain] ?? 0) + 1));
      expect(counts).toEqual({ biodome: 4, icefield: 4, gascloud: 4, asteroid: 3, nebula: 3, void: 1 });

      const numbers = b.tiles.map((t) => t.number).filter((n) => n !== null).sort((x, y) => x! - y!);
      expect(numbers).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
      expect(hotNumbersSeparated(b.tiles)).toBe(true);

      expect(b.tiles[b.pirateHex].terrain).toBe('void');

      expect(b.harbors).toHaveLength(9);
      expect(b.harbors.filter((h) => h.kind === 'any')).toHaveLength(4);
      // Häfen teilen sich keine Ecken
      const used = new Set<number>();
      for (const h of b.harbors) {
        const e = TOPOLOGY.edges[h.edgeId];
        expect(e.hexes).toHaveLength(1);
        expect(used.has(e.a) || used.has(e.b)).toBe(false);
        used.add(e.a).add(e.b);
      }
    }
  });

  it('berechnet Wahrscheinlichkeitspunkte', () => {
    expect([2, 6, 7, 8, 12].map(pips)).toEqual([1, 5, 6, 5, 1]);
  });
});
