import { describe, expect, it } from 'vitest';
import { TOPOLOGY } from './board';
import {
  actor, applyAction, canPlayDev, createGame, longestRouteLength, publicVictoryPoints, stealVictims, totalCards,
  tradeRatio, victoryPoints, type GameState,
} from './game';
import { finishSetup, players, resolvePending } from './testUtils';

const rich = () => ({ ore: 5, ice: 5, crystal: 5, food: 5, fuel: 5 });

/** Würfelt so lange (mit Zugwechsel), bis eine 7 fällt. Vorher bekommt jeder die angegebenen Karten. */
function rollUntilSeven(s: GameState, prepare: (s: GameState) => void): GameState {
  for (let i = 0; i < 500; i++) {
    prepare(s);
    const r = applyAction(s, { type: 'roll' });
    if (r.dice![0] + r.dice![1] === 7) return r;
    s = applyAction(resolvePending(r), { type: 'endTurn' });
  }
  throw new Error('keine 7 gewürfelt');
}

/** Leert die Hauptphase und gibt einen Zustand nach dem Würfeln ohne offene Aktionen. */
function rolledIdle(seed = 5, n = 3): GameState {
  let s = finishSetup(createGame(players(n), seed));
  s = resolvePending(applyAction(s, { type: 'roll' }));
  return s;
}

describe('Piraten bei einer 7', () => {
  it('wer mehr als 7 Karten hat, wirft die Hälfte ab (abgerundet)', () => {
    let s = finishSetup(createGame(players(3), 11));
    s = rollUntilSeven(s, (st) => {
      st.players[0].resources = { ore: 9, ice: 0, crystal: 0, food: 0, fuel: 0 }; // 9 → 4 abwerfen
      st.players[1].resources = { ore: 7, ice: 0, crystal: 0, food: 0, fuel: 0 }; // 7 → nichts
      st.players[2].resources = { ore: 4, ice: 4, crystal: 0, food: 0, fuel: 0 }; // 8 → 4 abwerfen
    });
    if (s.phase.kind !== 'main' || s.phase.pending.kind !== 'discard') throw new Error('erwartet: discard');
    expect(s.phase.pending.amounts).toEqual([4, 0, 4]);
    expect(actor(s)).toBe(0);
    expect(() => applyAction(s, { type: 'discard', player: 0, cards: { ore: 3 } })).toThrow();
    expect(() => applyAction(s, { type: 'endTurn' })).toThrow();
    s = applyAction(s, { type: 'discard', player: 0, cards: { ore: 4 } });
    expect(actor(s)).toBe(2);
    s = applyAction(s, { type: 'discard', player: 2, cards: { ore: 2, ice: 2 } });
    expect(totalCards(s.players[0].resources)).toBe(5);
    expect(totalCards(s.players[2].resources)).toBe(4);
    expect(s.phase.kind === 'main' && s.phase.pending.kind).toBe('movePirate');
    expect(actor(s)).toBe(s.current);
  });

  it('Piratenschiff muss das Feld wechseln und raubt eine Karte', () => {
    let s = rolledIdle();
    if (s.phase.kind !== 'main') throw new Error();
    s.phase.pending = { kind: 'movePirate' };
    expect(() => applyAction(s, { type: 'movePirate', hex: s.board.pirateHex })).toThrow();

    // Feld mit genau einem fremden Bau suchen
    const p = s.current;
    s.players.forEach((pl) => (pl.resources = rich()));
    const hex = TOPOLOGY.hexes.find((h) => h.id !== s.board.pirateHex && stealVictims(s, h.id, p).length === 1)!;
    const victim = stealVictims(s, hex.id, p)[0];
    const before = totalCards(s.players[victim].resources);
    s = applyAction(s, { type: 'movePirate', hex: hex.id });
    expect(s.board.pirateHex).toBe(hex.id);
    expect(totalCards(s.players[victim].resources)).toBe(before - 1);
    expect(totalCards(s.players[p].resources)).toBe(26);
    expect(s.phase.kind === 'main' && s.phase.pending.kind).toBe('none');
  });

  it('bei mehreren Opfern wählt der Spieler', () => {
    let s = rolledIdle(5, 3);
    if (s.phase.kind !== 'main') throw new Error();
    s.phase.pending = { kind: 'movePirate' };
    s.players.forEach((pl) => (pl.resources = rich()));
    s.buildings = s.buildings.map(() => null);
    const hex = TOPOLOGY.hexes.find((h) => h.id !== s.board.pirateHex)!;
    s.buildings[hex.vertices[0]] = { owner: (s.current + 1) % 3, type: 'outpost' };
    s.buildings[hex.vertices[3]] = { owner: (s.current + 2) % 3, type: 'outpost' };
    s = applyAction(s, { type: 'movePirate', hex: hex.id });
    if (s.phase.kind !== 'main' || s.phase.pending.kind !== 'steal') throw new Error('erwartet: steal');
    expect(s.phase.pending.victims).toHaveLength(2);
    const v = s.phase.pending.victims[1];
    s = applyAction(s, { type: 'steal', victim: v });
    expect(totalCards(s.players[v].resources)).toBe(24);
  });
});

describe('Bank- und Hafenhandel', () => {
  it('Standardkurs 4:1', () => {
    let s = rolledIdle();
    const p = s.current;
    s.board.harbors = [];
    s.players[p].resources = { ore: 4, ice: 0, crystal: 0, food: 0, fuel: 0 };
    expect(tradeRatio(s, p, 'ore')).toBe(4);
    s = applyAction(s, { type: 'bankTrade', give: 'ore', get: 'fuel' });
    expect(s.players[p].resources).toEqual({ ore: 0, ice: 0, crystal: 0, food: 0, fuel: 1 });
    expect(() => applyAction(s, { type: 'bankTrade', give: 'fuel', get: 'ore' })).toThrow();
  });

  it('Häfen: 3:1 allgemein, 2:1 für ihren Rohstoff', () => {
    const s = rolledIdle();
    const p = s.current;
    const e = TOPOLOGY.edges[TOPOLOGY.coastEdges[0]];
    s.buildings = s.buildings.map(() => null);
    s.buildings[e.a] = { owner: p, type: 'outpost' };
    s.board.harbors = [{ edgeId: e.id, kind: 'any' }];
    expect(tradeRatio(s, p, 'ice')).toBe(3);
    s.board.harbors = [{ edgeId: e.id, kind: 'ice' }];
    expect(tradeRatio(s, p, 'ice')).toBe(2);
    expect(tradeRatio(s, p, 'ore')).toBe(4);
    expect(tradeRatio(s, (p + 1) % 3, 'ice')).toBe(4);
  });
});

describe('Entwicklungskarten', () => {
  it('gekaufte Karten erst im nächsten Zug spielbar, max. eine pro Zug', () => {
    let s = rolledIdle();
    const p = s.current;
    s.players[p].resources = rich();
    s.deck = ['knight', 'knight'];
    s = applyAction(s, { type: 'buyDevCard' });
    expect(s.players[p].devCards).toEqual([{ type: 'knight', boughtTurn: s.turn }]);
    expect(s.players[p].resources.ore).toBe(4);
    expect(canPlayDev(s, 'knight')).toBe(false);
    expect(() => applyAction(s, { type: 'playKnight' })).toThrow();

    // eine Runde weiter
    s = applyAction(s, { type: 'endTurn' });
    for (let i = 0; i < 2; i++) {
      s = applyAction(resolvePending(applyAction(s, { type: 'roll' })), { type: 'endTurn' });
    }
    expect(s.current).toBe(p);
    s.players[p].devCards.push({ type: 'knight', boughtTurn: 0 });
    // Raumjäger darf auch vor dem Würfeln gespielt werden
    expect(canPlayDev(s, 'knight')).toBe(true);
    s = applyAction(s, { type: 'playKnight' });
    expect(s.phase.kind === 'main' && s.phase.pending.kind).toBe('movePirate');
    s = resolvePending(s);
    expect(canPlayDev(s, 'knight')).toBe(false); // schon eine Karte in diesem Zug
    expect(s.phase.kind === 'main' && s.phase.rolled).toBe(false);
  });

  it('größte Flotte ab 3 Raumjägern, nur wer mehr hat, übernimmt', () => {
    let s = rolledIdle(5, 2);
    const p = s.current;
    const q = 1 - p;
    s.players[q].knightsPlayed = 3;
    s.largestFleet = q;
    s.players[p].knightsPlayed = 2;
    s.players[p].devCards = [{ type: 'knight', boughtTurn: 0 }];
    s = resolvePending(applyAction(s, { type: 'playKnight' }));
    expect(s.largestFleet).toBe(q); // 3 gegen 3 – bleibt
    s.players[p].devCards = [{ type: 'knight', boughtTurn: 0 }];
    if (s.phase.kind === 'main') s.phase.devPlayed = false;
    s = resolvePending(applyAction(s, { type: 'playKnight' }));
    expect(s.largestFleet).toBe(p);
    expect(publicVictoryPoints(s, p)).toBe(4);
  });

  it('Monopol, Frachtfund und Hyperraumtunnel', () => {
    let s = rolledIdle();
    const p = s.current;
    s.players.forEach((pl) => (pl.resources = rich()));
    s.players[p].devCards = [
      { type: 'monopoly', boughtTurn: 0 },
      { type: 'plenty', boughtTurn: 0 },
      { type: 'routes', boughtTurn: 0 },
    ];
    s = applyAction(s, { type: 'playMonopoly', resource: 'ice' });
    expect(s.players[p].resources.ice).toBe(15);
    s.players.forEach((pl) => pl.id !== p && expect(pl.resources.ice).toBe(0));

    const reset = (st: GameState) => { if (st.phase.kind === 'main') st.phase.devPlayed = false; };
    reset(s);
    s = applyAction(s, { type: 'playPlenty', resources: ['ore', 'ore'] });
    expect(s.players[p].resources.ore).toBe(7);

    reset(s);
    const routesBefore = s.routes.filter((o) => o === p).length;
    const crystal = s.players[p].resources.crystal;
    s = applyAction(s, { type: 'playRoutes' });
    expect(s.phase.kind === 'main' && s.phase.pending).toEqual({ kind: 'freeRoutes', left: 2 });
    s = resolvePending(s);
    expect(s.routes.filter((o) => o === p).length).toBe(routesBefore + 2);
    expect(s.players[p].resources.crystal).toBe(crystal); // kostenlos
  });

  it('Artefakte zählen geheim mit und können den Sieg bringen', () => {
    let s = rolledIdle(5, 2);
    const p = s.current;
    s.players[p].devCards = Array.from({ length: 7 }, () => ({ type: 'point' as const, boughtTurn: 0 }));
    expect(publicVictoryPoints(s, p)).toBe(2);
    expect(victoryPoints(s, p)).toBe(9);
    s.players[p].resources = rich();
    s.deck = ['point'];
    s = applyAction(s, { type: 'buyDevCard' });
    expect(s.phase).toEqual({ kind: 'ended', winner: p });
  });
});

describe('Längste Route', () => {
  /** Ecken entlang der Küste: coast[i] verbindet path[i] und path[i+1]. */
  const coast = TOPOLOGY.coastEdges;
  const shared = (e1: number, e2: number) => {
    const a = TOPOLOGY.edges[e1];
    const b = TOPOLOGY.edges[e2];
    return [a.a, a.b].find((v) => v === b.a || v === b.b)!;
  };
  const path: number[] = [];
  for (let i = 0; i < 8; i++) path.push(shared(coast[i], coast[i + 1]));
  // path[i] = gemeinsame Ecke von coast[i] und coast[i+1]
  const start = [TOPOLOGY.edges[coast[0]].a, TOPOLOGY.edges[coast[0]].b].find((v) => v !== path[0])!;

  function clean(s: GameState) {
    s.routes = s.routes.map(() => null);
    s.buildings = s.buildings.map(() => null);
  }

  it('die Küstenkanten bilden eine zusammenhängende Kette', () => {
    for (let i = 0; i < 8; i++) expect(path[i]).toBeDefined();
  });

  it('misst zusammenhängende Routen und fremde Bauten unterbrechen', () => {
    const s = rolledIdle(5, 2);
    clean(s);
    for (let i = 0; i < 6; i++) s.routes[coast[i]] = 0;
    expect(longestRouteLength(s, 0)).toBe(6);
    s.buildings[path[2]] = { owner: 1, type: 'outpost' }; // trennt 3 | 3
    expect(longestRouteLength(s, 0)).toBe(3);
    s.buildings[path[2]] = { owner: 0, type: 'outpost' };
    expect(longestRouteLength(s, 0)).toBe(6);
    // Abzweigung zählt nicht doppelt
    const branch = TOPOLOGY.vertices[path[1]].edges.find((e) => s.routes[e] === null)!;
    s.routes[branch] = 0;
    expect(longestRouteLength(s, 0)).toBe(6);
  });

  it('Bonus ab 5, Gleichstand behält der Inhaber, Unterbrechung kann ihn kosten', () => {
    let s = rolledIdle(5, 2);
    const p = s.current;
    const q = 1 - p;
    clean(s);
    s.buildings[start] = { owner: p, type: 'outpost' };
    for (let i = 0; i < 4; i++) s.routes[coast[i]] = p;
    s.players[p].resources = rich();
    s = applyAction(s, { type: 'build', kind: 'route', edge: coast[4] });
    expect(s.longestRoute).toBe(p);
    expect(publicVictoryPoints(s, p)).toBe(3);

    // q hat ebenfalls 5 → Gleichstand, p behält
    for (let i = 10; i < 15; i++) s.routes[coast[i]] = q;
    const branch = TOPOLOGY.vertices[path[1]].edges.find((e) => s.routes[e] === null)!;
    s = applyAction(s, { type: 'build', kind: 'route', edge: branch }); // löst Neuberechnung aus, bleibt 5
    expect(longestRouteLength(s, p)).toBe(5);
    expect(longestRouteLength(s, q)).toBe(5);
    expect(s.longestRoute).toBe(p);
    s.players[p].resources = rich();
    s = applyAction(s, { type: 'build', kind: 'route', edge: coast[5] });

    // q unterbricht p's Kette in der Mitte: p hat nur noch 3, q hat 5 → q übernimmt
    s.buildings[path[2]] = { owner: q, type: 'outpost' };
    s.players[p].resources = rich();
    s = applyAction(s, { type: 'build', kind: 'route', edge: coast[6] });
    expect(longestRouteLength(s, p)).toBe(4);
    expect(s.longestRoute).toBe(q);
  });
});
