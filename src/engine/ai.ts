// Computergegner für „Sternenhafen“.
// aiAction() liefert für den Spieler, der gerade handeln muss (actor), genau eine regelkonforme Aktion.
// Stufen: easy (zufälliger, kein Spielerhandel), medium (Heuristiken), hard (bessere Planung, spielt gegen den Führenden).

import { pips, TOPOLOGY } from './board';
import {
  actor, canAfford, canBankTrade, canBuild, canBuyDevCard, canPlayDev, canProposeTrade, COSTS, distanceOk,
  emptyResources, legalOutposts, legalPirateHexes, legalRoutes, legalSetupOutposts, legalSetupRoutes,
  legalStations, piecesLeft, publicVictoryPoints, totalCards, tradeRatio, tradeTerms,
  victoryPoints, WIN_POINTS,
  type Action, type AiLevel, type BuildKind, type GameState, type ResourceCount, type TradeOffer,
} from './game';
import { RESOURCES, TERRAIN_RESOURCE, type Resource } from './types';

export type Rng = () => number;

/** Gedächtnis der KI pro Spieler und Zug (verhindert Endlosschleifen beim Handeln). */
interface TurnMemo {
  turn: number;
  proposals: number;
  bankTrades: number;
  actions: number;
}

export interface AiMemo {
  byPlayer: Record<number, TurnMemo>;
}

export const newMemo = (): AiMemo => ({ byPlayer: {} });

type Goal = BuildKind | 'devCard';

/** Stellschrauben der Stufe „Schwer“ (per Simulation abgestimmt). */
export const HARD_TUNING = {
  /** Gewicht für Erz/Nahrung bei der Platzwahl (Stationen + Karten) */
  cityWeight: 1,
  /** Mindestgewinn, damit ein Tausch angenommen wird */
  tradeThreshold: 0.5,
  outpostValue: 2.1,
  devValue: 1.1,
  /** Ab wie vielen Punkten ein Mitspieler als „Führender“ gilt */
  leaderVp: 8,
};

const PROPOSAL_LIMIT: Record<AiLevel, number> = { easy: 0, medium: 1, hard: 1 };
const LEADER_VP = 8;

// ---------- Bewertung ----------

/** Erwartete Würfelpunkte pro Rohstoff für einen Spieler */
export function production(s: GameState, p: number): ResourceCount {
  const prod = emptyResources();
  s.buildings.forEach((b, v) => {
    if (!b || b.owner !== p) return;
    for (const h of TOPOLOGY.vertices[v].hexes) {
      const t = s.board.tiles[h];
      const r = TERRAIN_RESOURCE[t.terrain];
      if (r && h !== s.board.pirateHex) prod[r] += pips(t.number) * (b.type === 'station' ? 2 : 1);
    }
  });
  return prod;
}

/** Wert einer Ecke als Bauplatz für Spieler p. */
export function vertexScore(s: GameState, v: number, p: number, level: AiLevel): number {
  const prod = production(s, p);
  let score = 0;
  const seen = new Set<Resource>();
  for (const h of TOPOLOGY.vertices[v].hexes) {
    const t = s.board.tiles[h];
    const r = TERRAIN_RESOURCE[t.terrain];
    if (!r) continue;
    let w = pips(t.number);
    if (level === 'hard' && (r === 'ore' || r === 'food')) w *= HARD_TUNING.cityWeight;
    if (level !== 'easy') {
      if (prod[r] === 0 && !seen.has(r)) w *= 1.4; // neuer Rohstoff
      if (h === s.board.pirateHex) w *= 0.5;
    }
    seen.add(r);
    score += w;
  }
  if (level !== 'easy') {
    score += seen.size * 0.6; // Vielfalt
    for (const hb of s.board.harbors) {
      const e = TOPOLOGY.edges[hb.edgeId];
      if (e.a !== v && e.b !== v) continue;
      if (hb.kind === 'any') score += 1.2;
      else score += Math.min(3, (prod[hb.kind] + (seen.has(hb.kind) ? 3 : 0)) * 0.35);
    }
  }
  return score;
}

/** Was fehlt für ein Ziel? */
function missingFor(res: ResourceCount, cost: Partial<ResourceCount>): ResourceCount {
  const m = emptyResources();
  RESOURCES.forEach((r) => (m[r] = Math.max(0, (cost[r] ?? 0) - res[r])));
  return m;
}

/** Bester Pfad zur nächsten guten Ausbau-Ecke: erste Kante und Zielwert. */
function planRoute(s: GameState, p: number, level: AiLevel): { edge: number; score: number } | null {
  const legal = new Set(legalRoutes(s, p));
  if (legal.size === 0) return null;
  // Startecken: Endpunkte der eigenen Routen und eigene Bauten, nicht durch Fremde blockiert
  const start = new Set<number>();
  s.routes.forEach((o, e) => {
    if (o !== p) return;
    const ed = TOPOLOGY.edges[e];
    [ed.a, ed.b].forEach((v) => {
      const b = s.buildings[v];
      if (!b || b.owner === p) start.add(v);
    });
  });
  s.buildings.forEach((b, v) => b?.owner === p && start.add(v));

  // BFS über freie Kanten, merkt sich die erste Kante
  const dist = new Map<number, { d: number; first: number }>();
  let frontier: number[] = [];
  start.forEach((v) => dist.set(v, { d: 0, first: -1 }));
  frontier = [...start];
  for (let d = 1; d <= 4 && frontier.length; d++) {
    const next: number[] = [];
    for (const v of frontier) {
      const info = dist.get(v)!;
      const vb = s.buildings[v];
      if (d > 1 && vb && vb.owner !== p) continue;
      for (const e of TOPOLOGY.vertices[v].edges) {
        if (s.routes[e] !== null) continue;
        if (info.d === 0 && !legal.has(e)) continue;
        const ed = TOPOLOGY.edges[e];
        const w = ed.a === v ? ed.b : ed.a;
        if (dist.has(w)) continue;
        const wb = s.buildings[w];
        if (wb && wb.owner !== p) continue;
        dist.set(w, { d, first: info.first === -1 ? e : info.first });
        next.push(w);
      }
    }
    frontier = next;
  }

  let best: { edge: number; score: number } | null = null;
  dist.forEach((info, v) => {
    if (info.d === 0 || info.first < 0 || !distanceOk(s, v)) return;
    const score = vertexScore(s, v, p, level) / (1 + 0.7 * info.d);
    if (!best || score > best.score) best = { edge: info.first, score };
  });
  return best;
}

function bestOf<T>(items: T[], score: (x: T) => number, rng: Rng, noise = 0): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const x of items) {
    const sc = score(x) + (noise ? rng() * noise : 0);
    if (sc > bestScore) {
      bestScore = sc;
      best = x;
    }
  }
  return best;
}

/** Ziel für diesen Zug: was als Nächstes gebaut/gekauft werden soll. */
function chooseGoal(s: GameState, p: number, level: AiLevel, rng: Rng): Goal | null {
  const res = s.players[p].resources;
  const left = piecesLeft(s, p);
  const options: { goal: Goal; value: number }[] = [];
  if (left.station > 0 && legalStations(s, p).length) options.push({ goal: 'station', value: 2.3 });
  if (left.outpost > 0 && legalOutposts(s, p).length) options.push({ goal: 'outpost', value: level === 'hard' ? HARD_TUNING.outpostValue : 2.1 });
  else if (left.route > 0 && left.outpost > 0 && planRoute(s, p, level)) options.push({ goal: 'route', value: 1.5 });
  if (s.deck.length) options.push({ goal: 'devCard', value: level === 'hard' ? HARD_TUNING.devValue : 0.8 });
  if (!options.length) return null;
  const score = (o: { goal: Goal; value: number }) =>
    o.value / (1 + totalCards(missingFor(res, COSTS[o.goal])) * 0.6);
  return bestOf(options, score, rng, level === 'easy' ? 1.5 : 0.05)!.goal;
}

/** Wert einzelner Rohstoffe für einen Spieler (für Handel und Abwerfen). */
function resourceValues(s: GameState, p: number, goal: Goal | null): Record<Resource, number> {
  const prod = production(s, p);
  const res = s.players[p].resources;
  const need = goal ? COSTS[goal] : {};
  const v = {} as Record<Resource, number>;
  for (const r of RESOURCES) {
    let val = 1;
    if ((need[r] ?? 0) > res[r]) val += 1.2; // fehlt fürs Ziel
    else if ((need[r] ?? 0) > 0) val += 0.6; // wird fürs Ziel gebraucht
    if (prod[r] === 0) val += 0.4; // schwer zu bekommen
    else if (prod[r] >= 8) val -= 0.3;
    v[r] = val;
  }
  return v;
}

const cardsValue = (cards: Partial<ResourceCount>, values: Record<Resource, number>) =>
  RESOURCES.reduce((sum, r) => sum + (cards[r] ?? 0) * values[r], 0);

/** Nutzen eines Tauschs für Spieler p: er bekommt `gets`, gibt `gives`. */
function tradeGain(s: GameState, p: number, gets: Partial<ResourceCount>, gives: Partial<ResourceCount>, level: AiLevel, rng: Rng) {
  const goal = chooseGoal(s, p, level, rng);
  const before = resourceValues(s, p, goal);
  return cardsValue(gets, before) - cardsValue(gives, before);
}

function wouldAcceptTrade(
  s: GameState, p: number, partner: number, gets: Partial<ResourceCount>, gives: Partial<ResourceCount>,
  level: AiLevel, rng: Rng,
): boolean {
  if (!canAfford(s.players[p].resources, gives)) return false;
  const gain = tradeGain(s, p, gets, gives, level, rng);
  if (level === 'easy') return gain >= 0 && rng() < 0.7;
  const leader = level === 'hard' ? HARD_TUNING.leaderVp : LEADER_VP;
  if (publicVictoryPoints(s, partner) >= leader) return false; // dem Führenden wird nicht geholfen
  return gain > (level === 'hard' ? HARD_TUNING.tradeThreshold : 0.25);
}

// ---------- Teilentscheidungen ----------

function chooseDiscard(s: GameState, p: number, need: number, level: AiLevel, rng: Rng): Partial<ResourceCount> {
  const goal = chooseGoal(s, p, level, rng);
  const values = resourceValues(s, p, goal);
  const left = { ...s.players[p].resources };
  const out = emptyResources();
  for (let i = 0; i < need; i++) {
    // Karte mit dem geringsten Wert, bei Gleichstand vom größten Stapel
    const r = bestOf(
      RESOURCES.filter((x) => left[x] > 0),
      (x) => -values[x] + left[x] * 0.15,
      rng,
      level === 'easy' ? 2 : 0,
    )!;
    left[r]--;
    out[r]++;
  }
  return out;
}

function choosePirateHex(s: GameState, p: number, level: AiLevel, rng: Rng): number {
  const hexes = legalPirateHexes(s);
  const leaderVp = Math.max(...s.players.map((pl) => (pl.id === p ? 0 : publicVictoryPoints(s, pl.id))));
  return bestOf(hexes, (h) => {
    const tile = s.board.tiles[h];
    const pp = pips(tile.number);
    let score = 0;
    for (const v of TOPOLOGY.hexes[h].vertices) {
      const b = s.buildings[v];
      if (!b) continue;
      const weight = b.type === 'station' ? 2 : 1;
      if (b.owner === p) score -= 4 * weight * Math.max(1, pp);
      else {
        const vp = publicVictoryPoints(s, b.owner);
        let w = weight * pp;
        if (level === 'hard') w *= 1 + vp / 4 + (vp === leaderVp ? 0.5 : 0);
        score += w + (totalCards(s.players[b.owner].resources) > 0 ? 1 : 0);
      }
    }
    return score;
  }, rng, level === 'easy' ? 6 : 0.01)!;
}

function chooseVictim(s: GameState, victims: number[], level: AiLevel, rng: Rng): number {
  return bestOf(victims, (v) => {
    const cards = totalCards(s.players[v].resources);
    return level === 'easy' ? cards : publicVictoryPoints(s, v) * 1.5 + cards;
  }, rng, level === 'easy' ? 3 : 0.01)!;
}

function bestRouteEdge(s: GameState, p: number, level: AiLevel, rng: Rng): number {
  const plan = planRoute(s, p, level);
  if (plan) return plan.edge;
  return bestOf(legalRoutes(s, p), () => 0, rng, 1)!;
}

function buildAction(s: GameState, p: number, kind: BuildKind, level: AiLevel, rng: Rng): Action {
  const noise = level === 'easy' ? 4 : 0.01;
  if (kind === 'route') return { type: 'build', kind, edge: bestRouteEdge(s, p, level, rng) };
  if (kind === 'outpost') {
    const v = bestOf(legalOutposts(s, p), (x) => vertexScore(s, x, p, level), rng, noise)!;
    return { type: 'build', kind, vertex: v };
  }
  const v = bestOf(legalStations(s, p), (x) => vertexScore(s, x, p, 'easy'), rng, noise)!;
  return { type: 'build', kind, vertex: v };
}

/** Bank-/Hafentausch, um einem Ziel näher zu kommen. */
function bankTradeFor(s: GameState, p: number, goal: Goal): Action | null {
  const res = s.players[p].resources;
  const cost = COSTS[goal];
  const missing = missingFor(res, cost);
  const want = RESOURCES.find((r) => missing[r] > 0 && s.bank[r] > 0);
  if (!want) return null;
  // Überschuss = was nicht fürs Ziel gebraucht wird
  const give = bestOf(
    RESOURCES.filter((g) => g !== want && canBankTrade(s, g, want) && res[g] - (cost[g] ?? 0) >= tradeRatio(s, p, g)),
    (g) => res[g] - (cost[g] ?? 0) - tradeRatio(s, p, g),
    () => 0,
  );
  return give ? { type: 'bankTrade', give, get: want } : null;
}

function playerTradeFor(s: GameState, p: number, goal: Goal, level: AiLevel): Action | null {
  const res = s.players[p].resources;
  const cost = COSTS[goal];
  const missing = missingFor(res, cost);
  // Nur fragen, wenn genau eine Karte fehlt – sonst nerven die Angebote
  if (totalCards(missing) !== 1) return null;
  const want = RESOURCES.find((r) => missing[r] > 0)!;
  const surplus = RESOURCES.filter((r) => r !== want && res[r] - (cost[r] ?? 0) > 0);
  if (!surplus.length) return null;
  const give = surplus.reduce((a, b) => (res[a] - (cost[a] ?? 0) >= res[b] - (cost[b] ?? 0) ? a : b));
  const to = s.players
    .filter((pl) => pl.id !== p && (level === 'easy' || publicVictoryPoints(s, pl.id) < LEADER_VP))
    .map((pl) => pl.id);
  if (!to.length) return null;
  return { type: 'proposeTrade', give: { [give]: 1 }, get: { [want]: 1 }, to };
}

function chooseDevPlay(s: GameState, p: number, goal: Goal | null, level: AiLevel, beforeRoll: boolean): Action | null {
  if (level === 'easy' && !beforeRoll) {
    if (canPlayDev(s, 'knight')) return { type: 'playKnight' };
  }
  const me = s.players[p];
  const onMyHex = TOPOLOGY.hexes[s.board.pirateHex].vertices.some((v) => s.buildings[v]?.owner === p);
  if (canPlayDev(s, 'knight')) {
    const fleetGain = s.largestFleet !== p && me.knightsPlayed + 1 >= 3 &&
      (s.largestFleet === null || me.knightsPlayed + 1 > s.players[s.largestFleet].knightsPlayed);
    if (onMyHex || (level === 'hard' && fleetGain)) return { type: 'playKnight' };
  }
  if (beforeRoll) return null;
  if (canPlayDev(s, 'plenty')) {
    const missing = goal ? missingFor(me.resources, COSTS[goal]) : emptyResources();
    const list = RESOURCES.flatMap((r) => Array<Resource>(missing[r]).fill(r)).filter((r) => s.bank[r] > 0);
    if (list.length >= 1) {
      const a = list[0];
      const b = list[1] ?? RESOURCES.reduce((x, y) => (s.bank[x] >= s.bank[y] ? x : y));
      if (s.bank[a] >= (a === b ? 2 : 1) && s.bank[b] >= 1) return { type: 'playPlenty', resources: [a, b] };
    }
  }
  if (canPlayDev(s, 'monopoly')) {
    const r = RESOURCES.reduce((x, y) => {
      const cnt = (q: Resource) => s.players.reduce((sum, pl) => sum + (pl.id === p ? 0 : pl.resources[q]), 0);
      return cnt(x) >= cnt(y) ? x : y;
    });
    const total = s.players.reduce((sum, pl) => sum + (pl.id === p ? 0 : pl.resources[r]), 0);
    if (total >= (level === 'hard' ? 3 : 4)) return { type: 'playMonopoly', resource: r };
  }
  if (canPlayDev(s, 'routes') && piecesLeft(s, p).route >= 2 && planRoute(s, p, level)) return { type: 'playRoutes' };
  if (canPlayDev(s, 'knight') && level !== 'easy' && onMyHex) return { type: 'playKnight' };
  return null;
}

// ---------- Hauptfunktion ----------

export function aiAction(s: GameState, memos: AiMemo, rng: Rng = Math.random): Action {
  const p = actor(s);
  const level = s.players[p].level;
  let memo = memos.byPlayer[p];
  if (!memo || memo.turn !== s.turn) memo = memos.byPlayer[p] = { turn: s.turn, proposals: 0, bankTrades: 0, actions: 0 };
  memo.actions++;

  const ph = s.phase;
  if (ph.kind === 'setup') {
    if (ph.awaiting === 'outpost') {
      const v = bestOf(legalSetupOutposts(s), (x) => vertexScore(s, x, p, level), rng, level === 'easy' ? 5 : 0.01)!;
      return { type: 'placeSetupOutpost', vertex: v };
    }
    // Route Richtung bester nächster Ecke
    const edges = legalSetupRoutes(s);
    const e = bestOf(edges, (eid) => {
      const ed = TOPOLOGY.edges[eid];
      const far = ed.a === ph.lastVertex ? ed.b : ed.a;
      const cands = TOPOLOGY.vertices[far].neighbors.filter((n) => n !== ph.lastVertex && distanceOk(s, n));
      return Math.max(0, ...cands.map((n) => vertexScore(s, n, p, level)));
    }, rng, level === 'easy' ? 5 : 0.01)!;
    return { type: 'placeSetupRoute', edge: e };
  }
  if (ph.kind !== 'main') throw new Error('KI: Spiel ist vorbei');

  const pend = ph.pending;
  switch (pend.kind) {
    case 'discard':
      return { type: 'discard', player: p, cards: chooseDiscard(s, p, pend.amounts[p], level, rng) };
    case 'movePirate':
      return { type: 'movePirate', hex: choosePirateHex(s, p, level, rng) };
    case 'steal':
      return { type: 'steal', victim: chooseVictim(s, pend.victims, level, rng) };
    case 'freeRoutes':
      return { type: 'build', kind: 'route', edge: bestRouteEdge(s, p, level, rng) };
    case 'trade':
      return p === pend.from ? completeOwnTrade(s, pend, level, rng) : respondToTrade(s, pend, p, level, rng);
  }

  // Normaler Zug des aktuellen Spielers
  const tooMany = memo.actions > 60;
  if (!ph.rolled) {
    const dev = tooMany ? null : chooseDevPlay(s, p, null, level, true);
    return dev ?? { type: 'roll' };
  }
  if (tooMany) return { type: 'endTurn' };

  const goal = chooseGoal(s, p, level, rng);
  const dev = chooseDevPlay(s, p, goal, level, false);
  if (dev) return dev;

  // Bauen: Station > Außenposten > Ziel-Route
  if (canBuild(s, 'station')) return buildAction(s, p, 'station', level, rng);
  if (canBuild(s, 'outpost')) return buildAction(s, p, 'outpost', level, rng);
  if (goal === 'route' && canBuild(s, 'route')) return buildAction(s, p, 'route', level, rng);
  if (goal === 'devCard' && canBuyDevCard(s)) return { type: 'buyDevCard' };

  // Handeln, um dem Ziel näher zu kommen
  if (goal && memo.bankTrades < 4) {
    const bt = bankTradeFor(s, p, goal);
    if (bt) {
      memo.bankTrades++;
      return bt;
    }
  }
  if (goal && memo.proposals < PROPOSAL_LIMIT[level] && canProposeTrade(s)) {
    const pt = playerTradeFor(s, p, goal, level);
    if (pt) {
      memo.proposals++;
      return pt;
    }
  }

  // Reste verwerten: zu viele Karten → Entwicklungskarte oder Route
  const cards = totalCards(s.players[p].resources);
  if (canBuyDevCard(s) && (cards > 7 || level === 'easy' || victoryPoints(s, p) >= WIN_POINTS - 1)) return { type: 'buyDevCard' };
  if (canBuild(s, 'route') && cards > 7 && planRoute(s, p, level)) return buildAction(s, p, 'route', level, rng);
  return { type: 'endTurn' };
}

function respondToTrade(s: GameState, offer: TradeOffer, p: number, level: AiLevel, rng: Rng): Action {
  // aus Sicht von p: bekommt offer.give, gibt offer.get
  const accept = wouldAcceptTrade(s, p, offer.from, offer.give, offer.get, level, rng);
  return { type: 'respondTrade', player: p, response: { type: accept ? 'accept' : 'decline' } };
}

function completeOwnTrade(s: GameState, offer: TradeOffer, level: AiLevel, rng: Rng): Action {
  const p = offer.from;
  const options = offer.responses
    .map((_, q) => ({ q, terms: tradeTerms(offer, q) }))
    .filter((o): o is { q: number; terms: NonNullable<ReturnType<typeof tradeTerms>> } => o.terms !== null)
    .filter((o) => canAfford(s.players[p].resources, o.terms.give) && canAfford(s.players[o.q].resources, o.terms.get))
    // Annahmen des eigenen Angebots sind gewollt; Gegenangebote werden geprüft
    .filter((o) => offer.responses[o.q]?.type === 'accept' ||
      wouldAcceptTrade(s, p, o.q, o.terms.get, o.terms.give, level === 'easy' ? 'medium' : level, rng));
  const best = bestOf(options, (o) => tradeGain(s, p, o.terms.get, o.terms.give, level, rng), rng);
  return best ? { type: 'completeTrade', with: best.q } : { type: 'cancelTrade' };
}
