import { describe, expect, it } from 'vitest';
import { TOPOLOGY } from './board';
import {
  applyAction, BANK_START, createGame, legalOutposts, legalRoutes, legalSetupOutposts, legalSetupRoutes,
  produce, victoryPoints,
} from './game';
import { finishSetup, players, resolvePending } from './testUtils';

describe('Gründungsphase', () => {
  it('läuft in Schlangenreihenfolge 0,1,2,2,1,0', () => {
    let s = createGame(players(3), 1);
    const seen: number[] = [];
    while (s.phase.kind === 'setup') {
      if (s.phase.awaiting === 'outpost') seen.push(s.current);
      s = s.phase.awaiting === 'outpost'
        ? applyAction(s, { type: 'placeSetupOutpost', vertex: legalSetupOutposts(s)[0] })
        : applyAction(s, { type: 'placeSetupRoute', edge: legalSetupRoutes(s)[0] });
    }
    expect(seen).toEqual([0, 1, 2, 2, 1, 0]);
    expect(s.phase).toEqual({ kind: 'main', rolled: false, pending: { kind: 'none' }, devPlayed: false });
    expect(s.current).toBe(0);
    s.players.forEach((_, p) => expect(victoryPoints(s, p)).toBe(2));
  });

  it('erzwingt die Abstandsregel', () => {
    let s = createGame(players(3), 1);
    const v = 10;
    s = applyAction(s, { type: 'placeSetupOutpost', vertex: v });
    s = applyAction(s, { type: 'placeSetupRoute', edge: legalSetupRoutes(s)[0] });
    const neighbor = TOPOLOGY.vertices[v].neighbors[0];
    expect(() => applyAction(s, { type: 'placeSetupOutpost', vertex: neighbor })).toThrow();
    expect(() => applyAction(s, { type: 'placeSetupOutpost', vertex: v })).toThrow();
  });

  it('die Route muss am gerade gesetzten Außenposten liegen', () => {
    let s = createGame(players(3), 1);
    s = applyAction(s, { type: 'placeSetupOutpost', vertex: 10 });
    const far = TOPOLOGY.edges.find((e) => e.a !== 10 && e.b !== 10)!.id;
    expect(() => applyAction(s, { type: 'placeSetupRoute', edge: far })).toThrow();
  });

  it('der zweite Außenposten bringt Startrohstoffe', () => {
    let s = createGame(players(2), 3);
    // Runde 1 für beide Spieler
    for (let i = 0; i < 2; i++) {
      s = applyAction(s, { type: 'placeSetupOutpost', vertex: legalSetupOutposts(s)[0] });
      s = applyAction(s, { type: 'placeSetupRoute', edge: legalSetupRoutes(s)[0] });
    }
    const p = s.current;
    // Ein Platz mit 3 produktiven Feldern
    const v = legalSetupOutposts(s).find((id) =>
      TOPOLOGY.vertices[id].hexes.length === 3 &&
      TOPOLOGY.vertices[id].hexes.every((h) => s.board.tiles[h].terrain !== 'void'))!;
    s = applyAction(s, { type: 'placeSetupOutpost', vertex: v });
    const total = Object.values(s.players[p].resources).reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
  });
});

describe('Hauptphase', () => {
  it('erst würfeln, dann bauen oder Zug beenden', () => {
    const s = finishSetup(createGame(players(3), 5));
    expect(() => applyAction(s, { type: 'endTurn' })).toThrow();
    expect(() => applyAction(s, { type: 'build', kind: 'route', edge: legalRoutes(s, 0)[0] })).toThrow();
    const r = applyAction(s, { type: 'roll' });
    expect(r.dice).not.toBeNull();
    expect(() => applyAction(r, { type: 'roll' })).toThrow();
    const e = applyAction(r, { type: 'endTurn' });
    expect(e.current).toBe(1);
  });

  it('Würfel sind deterministisch und liegen zwischen 1 und 6', () => {
    let s = finishSetup(createGame(players(3), 9));
    const sums: number[] = [];
    for (let i = 0; i < 200; i++) {
      s = applyAction(s, { type: 'roll' });
      expect(s.dice![0]).toBeGreaterThanOrEqual(1);
      expect(s.dice![1]).toBeLessThanOrEqual(6);
      sums.push(s.dice![0] + s.dice![1]);
      s = resolvePending(s);
      s = applyAction(s, { type: 'endTurn' });
    }
    expect(new Set(sums).size).toBeGreaterThan(8);
  });

  it('Erträge: Außenposten 1, Station 2, Piratenfeld blockiert', () => {
    const s = finishSetup(createGame(players(3), 5));
    const tile = s.board.tiles.find((t) => t.number === 8)!;
    const res = { asteroid: 'ore', icefield: 'ice', nebula: 'crystal', biodome: 'food', gascloud: 'fuel' }[
      tile.terrain as 'asteroid'
    ] as 'ore';
    const [v1, v2] = TOPOLOGY.hexes[tile.hexId].vertices.filter((_, i) => i % 3 === 0);
    s.buildings = s.buildings.map(() => null);
    s.buildings[v1] = { owner: 0, type: 'outpost' };
    s.buildings[v2] = { owner: 1, type: 'station' };
    s.players.forEach((pl) => (pl.resources[res] = 0));
    const bank = s.bank[res];

    produce(s, 8);
    expect(s.players[0].resources[res]).toBe(1);
    expect(s.players[1].resources[res]).toBe(2);
    expect(s.bank[res]).toBe(bank - 3);

    s.board.pirateHex = tile.hexId;
    produce(s, 8);
    expect(s.players[0].resources[res]).toBe(1);
  });

  it('Bank-Engpass: bei mehreren Empfängern bekommt niemand etwas', () => {
    const s = finishSetup(createGame(players(3), 5));
    const tile = s.board.tiles.find((t) => t.number === 6)!;
    const res = { asteroid: 'ore', icefield: 'ice', nebula: 'crystal', biodome: 'food', gascloud: 'fuel' }[
      tile.terrain as 'asteroid'
    ] as 'ore';
    const [v1, v2] = TOPOLOGY.hexes[tile.hexId].vertices.filter((_, i) => i % 3 === 0);
    s.buildings = s.buildings.map(() => null);
    s.buildings[v1] = { owner: 0, type: 'station' };
    s.buildings[v2] = { owner: 1, type: 'station' };
    s.players.forEach((pl) => (pl.resources[res] = 0));
    s.bank[res] = 3;
    produce(s, 6);
    expect(s.players[0].resources[res]).toBe(0);
    expect(s.bank[res]).toBe(3);
  });

  it('Bauen kostet Rohstoffe und braucht Anschluss', () => {
    let s = finishSetup(createGame(players(3), 5));
    s = applyAction(s, { type: 'roll' });
    s.players[0].resources = { ore: 3, ice: 1, crystal: 3, food: 3, fuel: 3 };
    const edge = legalRoutes(s, 0)[0];
    s = applyAction(s, { type: 'build', kind: 'route', edge });
    expect(s.routes[edge]).toBe(0);
    expect(s.players[0].resources.fuel).toBe(2);
    expect(s.players[0].resources.crystal).toBe(2);
    expect(s.bank.fuel + s.players.reduce((t, p) => t + p.resources.fuel, 0)).toBeLessThanOrEqual(BANK_START + 3);

    // Station auf eigenem Außenposten
    const own = s.buildings.findIndex((b) => b?.owner === 0);
    s = applyAction(s, { type: 'build', kind: 'station', vertex: own });
    expect(s.buildings[own]).toEqual({ owner: 0, type: 'station' });
    expect(victoryPoints(s, 0)).toBe(3);

    // Fremde Außenposten können nicht ausgebaut werden
    const other = s.buildings.findIndex((b) => b?.owner === 1);
    expect(() => applyAction(s, { type: 'build', kind: 'station', vertex: other })).toThrow();
  });

  it('Außenposten braucht eigene Route und Abstand', () => {
    const s = finishSetup(createGame(players(3), 5));
    for (const v of legalOutposts(s, 0)) {
      expect(TOPOLOGY.vertices[v].edges.some((e) => s.routes[e] === 0)).toBe(true);
      expect(TOPOLOGY.vertices[v].neighbors.every((n) => s.buildings[n] === null)).toBe(true);
    }
  });

  it('fremde Bauten unterbrechen Routen', () => {
    const s = finishSetup(createGame(players(2), 5));
    s.buildings = s.buildings.map(() => null);
    s.routes = s.routes.map(() => null);
    // Spieler 0 hat eine Route, an deren Ende ein Außenposten von Spieler 1 steht
    const e = TOPOLOGY.edges[0];
    s.routes[e.id] = 0;
    s.buildings[e.b] = { owner: 1, type: 'outpost' };
    const beyond = TOPOLOGY.vertices[e.b].edges.filter((x) => x !== e.id);
    const legal = legalRoutes(s, 0);
    beyond.forEach((x) => expect(legal).not.toContain(x));
    TOPOLOGY.vertices[e.a].edges.filter((x) => x !== e.id).forEach((x) => expect(legal).toContain(x));
  });

  it('wer 10 Siegpunkte erreicht, gewinnt', () => {
    let s = finishSetup(createGame(players(2), 5));
    s = applyAction(s, { type: 'roll' });
    s.players[0].resources = { ore: 20, ice: 0, crystal: 0, food: 20, fuel: 0 };
    // Start: 2 Außenposten (2 Punkte). Direkt 2 Stationen + 2 Außenposten dazusetzen → 8 Punkte.
    const free = TOPOLOGY.vertices.map((v) => v.id).filter((v) => s.buildings[v] === null);
    let added = 0;
    for (const v of free) {
      if (added === 4) break;
      if (TOPOLOGY.vertices[v].neighbors.every((n) => s.buildings[n] === null)) {
        s.buildings[v] = { owner: 0, type: added < 2 ? 'station' : 'outpost' };
        added++;
      }
    }
    expect(victoryPoints(s, 0)).toBe(8);
    const own = s.buildings.findIndex((b) => b?.owner === 0 && b.type === 'outpost');
    s = applyAction(s, { type: 'build', kind: 'station', vertex: own });
    expect(s.phase.kind).toBe('main');
    const own2 = s.buildings.findIndex((b) => b?.owner === 0 && b.type === 'outpost');
    s = applyAction(s, { type: 'build', kind: 'station', vertex: own2 });
    expect(s.phase).toEqual({ kind: 'ended', winner: 0 });
    expect(() => applyAction(s, { type: 'endTurn' })).toThrow();
  });
});
