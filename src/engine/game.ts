// Spielzustand und Regeln von „Sternenhafen“.
// Alles ist rein funktional: applyAction(state, action) liefert einen neuen Zustand.

import { generateBoard, TOPOLOGY } from './board';
import { createRng, nextRandom, shuffle } from './rng';
import { RESOURCES, TERRAIN_RESOURCE, type Board, type Resource } from './types';

export type ResourceCount = Record<Resource, number>;
export type BuildKind = 'route' | 'outpost' | 'station';
export type PlayerKind = 'human' | 'ai';
export type AiLevel = 'easy' | 'medium' | 'hard';
export type DevCardType = 'knight' | 'routes' | 'plenty' | 'monopoly' | 'point';

export const COSTS: Record<BuildKind | 'devCard', Partial<ResourceCount>> = {
  route: { fuel: 1, crystal: 1 },
  outpost: { fuel: 1, crystal: 1, ice: 1, food: 1 },
  station: { food: 2, ore: 3 },
  devCard: { ore: 1, ice: 1, food: 1 },
};

export const PIECE_LIMITS: Record<BuildKind, number> = { route: 15, outpost: 5, station: 4 };
export const BANK_START = 19;
export const WIN_POINTS = 10;
export const HAND_LIMIT = 7;
export const LONGEST_ROUTE_MIN = 5;
export const LARGEST_FLEET_MIN = 3;
export const PLAYER_COLORS = ['#ff4d6d', '#3d8bff', '#f5f5fa', '#ffd84d'];

const DECK: DevCardType[] = [
  ...Array<DevCardType>(14).fill('knight'),
  ...Array<DevCardType>(5).fill('point'),
  'routes', 'routes', 'plenty', 'plenty', 'monopoly', 'monopoly',
];

export interface PlayerConfig {
  name: string;
  kind: PlayerKind;
  level?: AiLevel;
}

export interface DevCard {
  type: DevCardType;
  /** Zug, in dem die Karte gekauft wurde – sie darf erst ab dem nächsten Zug gespielt werden */
  boughtTurn: number;
}

export interface Player {
  id: number;
  name: string;
  kind: PlayerKind;
  level: AiLevel;
  color: string;
  resources: ResourceCount;
  devCards: DevCard[];
  knightsPlayed: number;
}

export interface Building {
  owner: number;
  type: 'outpost' | 'station';
}

/** Was im Hauptspiel gerade als Nächstes passieren muss */
export type Pending =
  | { kind: 'none' }
  | { kind: 'discard'; amounts: number[] }
  | { kind: 'movePirate' }
  | { kind: 'steal'; hex: number; victims: number[] }
  | { kind: 'freeRoutes'; left: number }
  | TradeOffer;

/** Antwort eines Mitspielers. Beim Gegenangebot aus Sicht des Antwortenden: er gibt `give` und will `get`. */
export type TradeResponse =
  | { type: 'accept' }
  | { type: 'decline' }
  | { type: 'counter'; give: Partial<ResourceCount>; get: Partial<ResourceCount> };

/** Offenes Handelsangebot des aktuellen Spielers: er gibt `give` und will `get`. */
export interface TradeOffer {
  kind: 'trade';
  from: number;
  give: Partial<ResourceCount>;
  get: Partial<ResourceCount>;
  /** Index = Spieler; undefined = nicht gefragt, null = Antwort steht noch aus */
  responses: (TradeResponse | null | undefined)[];
}

export type Phase =
  | { kind: 'setup'; order: number[]; step: number; awaiting: 'outpost' | 'route'; lastVertex: number | null }
  | { kind: 'main'; rolled: boolean; pending: Pending; devPlayed: boolean }
  | { kind: 'ended'; winner: number };

export interface GameState {
  board: Board;
  players: Player[];
  bank: ResourceCount;
  deck: DevCardType[];
  /** Index = Ecken-ID */
  buildings: (Building | null)[];
  /** Index = Kanten-ID, Wert = Besitzer */
  routes: (number | null)[];
  longestRoute: number | null;
  largestFleet: number | null;
  current: number;
  phase: Phase;
  dice: [number, number] | null;
  rngState: number;
  turn: number;
  log: string[];
}

export type Action =
  | { type: 'placeSetupOutpost'; vertex: number }
  | { type: 'placeSetupRoute'; edge: number }
  | { type: 'roll' }
  | { type: 'build'; kind: 'route'; edge: number }
  | { type: 'build'; kind: 'outpost' | 'station'; vertex: number }
  | { type: 'discard'; player: number; cards: Partial<ResourceCount> }
  | { type: 'movePirate'; hex: number }
  | { type: 'steal'; victim: number }
  | { type: 'bankTrade'; give: Resource; get: Resource }
  | { type: 'buyDevCard' }
  | { type: 'playKnight' }
  | { type: 'playRoutes' }
  | { type: 'playPlenty'; resources: [Resource, Resource] }
  | { type: 'playMonopoly'; resource: Resource }
  | { type: 'proposeTrade'; give: Partial<ResourceCount>; get: Partial<ResourceCount>; to: number[] }
  | { type: 'respondTrade'; player: number; response: TradeResponse }
  | { type: 'completeTrade'; with: number }
  | { type: 'cancelTrade' }
  | { type: 'endTurn' };

export class GameError extends Error {}

export const emptyResources = (): ResourceCount => ({ ore: 0, ice: 0, crystal: 0, food: 0, fuel: 0 });

export const RESOURCE_NAMES: Record<Resource, string> = {
  ore: 'Erz', ice: 'Eis', crystal: 'Kristall', food: 'Nahrung', fuel: 'Treibstoff',
};

export const DEV_CARD_INFO: Record<DevCardType, { name: string; icon: string; text: string }> = {
  knight: { name: 'Raumjäger', icon: '🚀', text: 'Versetze das Piratenschiff und raube eine Karte.' },
  routes: { name: 'Hyperraumtunnel', icon: '🌀', text: 'Baue 2 Raumrouten kostenlos.' },
  plenty: { name: 'Frachtfund', icon: '📦', text: 'Nimm 2 beliebige Rohstoffe aus der Bank.' },
  monopoly: { name: 'Monopol', icon: '💰', text: 'Alle anderen geben dir ihre Karten eines Rohstoffs.' },
  point: { name: 'Artefakt', icon: '🏺', text: '1 Siegpunkt (bleibt geheim bis zum Sieg).' },
};

const MAIN_IDLE = (rolled: boolean, devPlayed = false): Phase => ({
  kind: 'main', rolled, pending: { kind: 'none' }, devPlayed,
});

export function createGame(configs: PlayerConfig[], seed: number): GameState {
  if (configs.length < 2 || configs.length > 4) throw new GameError('2 bis 4 Spieler erforderlich');
  const n = configs.length;
  const order = [...Array(n).keys(), ...[...Array(n).keys()].reverse()];
  const bank = emptyResources();
  RESOURCES.forEach((r) => (bank[r] = BANK_START));
  return {
    board: generateBoard(seed),
    players: configs.map((c, id) => ({
      id,
      name: c.name,
      kind: c.kind,
      level: c.level ?? 'medium',
      color: PLAYER_COLORS[id],
      resources: emptyResources(),
      devCards: [],
      knightsPlayed: 0,
    })),
    bank,
    deck: shuffle(DECK, createRng(seed ^ 0x5bd1e995)),
    buildings: TOPOLOGY.vertices.map(() => null),
    routes: TOPOLOGY.edges.map(() => null),
    longestRoute: null,
    largestFleet: null,
    current: 0,
    phase: { kind: 'setup', order, step: 0, awaiting: 'outpost', lastVertex: null },
    dice: null,
    rngState: seed ^ 0x9e3779b9,
    turn: 0,
    log: ['Gründungsphase: Jeder setzt nacheinander einen Außenposten und eine Raumroute.'],
  };
}

// ---------- Abfragen ----------

/** Wer muss gerade handeln? Meist der aktuelle Spieler – beim Abwerfen nach einer 7 aber reihum alle Betroffenen. */
export function actor(s: GameState): number {
  if (s.phase.kind === 'main' && s.phase.pending.kind === 'discard') {
    const i = s.phase.pending.amounts.findIndex((a) => a > 0);
    if (i >= 0) return i;
  }
  if (s.phase.kind === 'main' && s.phase.pending.kind === 'trade') {
    const i = s.phase.pending.responses.findIndex((r) => r === null);
    if (i >= 0) return i;
  }
  return s.current;
}

/** Siegpunkte, die alle sehen können (ohne geheime Artefakte) */
export function publicVictoryPoints(s: GameState, p: number): number {
  const buildings = s.buildings.reduce(
    (sum, b) => sum + (b && b.owner === p ? (b.type === 'station' ? 2 : 1) : 0),
    0,
  );
  return buildings + (s.longestRoute === p ? 2 : 0) + (s.largestFleet === p ? 2 : 0);
}

export function victoryPoints(s: GameState, p: number): number {
  return publicVictoryPoints(s, p) + s.players[p].devCards.filter((c) => c.type === 'point').length;
}

export function piecesLeft(s: GameState, p: number): Record<BuildKind, number> {
  const outposts = s.buildings.filter((b) => b?.owner === p && b.type === 'outpost').length;
  const stations = s.buildings.filter((b) => b?.owner === p && b.type === 'station').length;
  const routes = s.routes.filter((o) => o === p).length;
  return {
    route: PIECE_LIMITS.route - routes,
    outpost: PIECE_LIMITS.outpost - outposts,
    station: PIECE_LIMITS.station - stations,
  };
}

export function canAfford(res: ResourceCount, cost: Partial<ResourceCount>): boolean {
  return RESOURCES.every((r) => res[r] >= (cost[r] ?? 0));
}

export function totalCards(res: Partial<ResourceCount>): number {
  return RESOURCES.reduce((sum, r) => sum + (res[r] ?? 0), 0);
}

/** Abstandsregel: Ecke frei und alle Nachbarecken frei. */
export function distanceOk(s: GameState, v: number): boolean {
  return !s.buildings[v] && TOPOLOGY.vertices[v].neighbors.every((n) => !s.buildings[n]);
}

/** Kann Spieler p an dieser (freien) Kante eine Route anschließen? */
function routeConnects(s: GameState, p: number, edgeId: number): boolean {
  const e = TOPOLOGY.edges[edgeId];
  for (const v of [e.a, e.b]) {
    const b = s.buildings[v];
    if (b) {
      if (b.owner === p) return true;
      continue; // fremder Bau unterbricht die Verbindung
    }
    if (TOPOLOGY.vertices[v].edges.some((oe) => oe !== edgeId && s.routes[oe] === p)) return true;
  }
  return false;
}

export function legalSetupOutposts(s: GameState): number[] {
  return TOPOLOGY.vertices.filter((v) => distanceOk(s, v.id)).map((v) => v.id);
}

export function legalSetupRoutes(s: GameState): number[] {
  if (s.phase.kind !== 'setup' || s.phase.lastVertex === null) return [];
  return TOPOLOGY.vertices[s.phase.lastVertex].edges.filter((e) => s.routes[e] === null);
}

export function legalRoutes(s: GameState, p: number): number[] {
  return TOPOLOGY.edges.filter((e) => s.routes[e.id] === null && routeConnects(s, p, e.id)).map((e) => e.id);
}

export function legalOutposts(s: GameState, p: number): number[] {
  return TOPOLOGY.vertices
    .filter((v) => distanceOk(s, v.id) && v.edges.some((e) => s.routes[e] === p))
    .map((v) => v.id);
}

export function legalStations(s: GameState, p: number): number[] {
  return s.buildings
    .map((b, v) => (b?.owner === p && b.type === 'outpost' ? v : -1))
    .filter((v) => v >= 0);
}

export function legalPirateHexes(s: GameState): number[] {
  return s.board.tiles.map((t) => t.hexId).filter((h) => h !== s.board.pirateHex);
}

/** Mitspieler mit Bau am Feld und mindestens einer Karte */
export function stealVictims(s: GameState, hex: number, thief: number): number[] {
  const owners = new Set<number>();
  for (const v of TOPOLOGY.hexes[hex].vertices) {
    const b = s.buildings[v];
    if (b && b.owner !== thief && totalCards(s.players[b.owner].resources) > 0) owners.add(b.owner);
  }
  return [...owners].sort();
}

/** Ist der aktuelle Spieler im normalen Zug (keine offene Pflichtaktion)? */
function isIdle(s: GameState, needRolled = true): boolean {
  return s.phase.kind === 'main' && s.phase.pending.kind === 'none' && (!needRolled || s.phase.rolled);
}

/** Kann der aktuelle Spieler gerade etwas dieser Art bauen (Phase, Rohstoffe, Vorrat, Bauplatz)? */
export function canBuild(s: GameState, kind: BuildKind): boolean {
  if (!isIdle(s)) return false;
  const p = s.current;
  if (!canAfford(s.players[p].resources, COSTS[kind]) || piecesLeft(s, p)[kind] <= 0) return false;
  const spots = kind === 'route' ? legalRoutes(s, p) : kind === 'outpost' ? legalOutposts(s, p) : legalStations(s, p);
  return spots.length > 0;
}

export function canBuyDevCard(s: GameState): boolean {
  return isIdle(s) && s.deck.length > 0 && canAfford(s.players[s.current].resources, COSTS.devCard);
}

/** Tauschkurs mit der Bank für einen Rohstoff (4:1, Hafen 3:1 oder 2:1) */
export function tradeRatio(s: GameState, p: number, r: Resource): number {
  let ratio = 4;
  for (const h of s.board.harbors) {
    const e = TOPOLOGY.edges[h.edgeId];
    if (s.buildings[e.a]?.owner !== p && s.buildings[e.b]?.owner !== p) continue;
    if (h.kind === r) ratio = Math.min(ratio, 2);
    else if (h.kind === 'any') ratio = Math.min(ratio, 3);
  }
  return ratio;
}

export function canBankTrade(s: GameState, give: Resource, get: Resource): boolean {
  return isIdle(s) && give !== get && s.bank[get] > 0 &&
    s.players[s.current].resources[give] >= tradeRatio(s, s.current, give);
}

/** Welche Entwicklungskarte darf der aktuelle Spieler jetzt spielen? */
export function canPlayDev(s: GameState, type: Exclude<DevCardType, 'point'>): boolean {
  if (s.phase.kind !== 'main' || s.phase.pending.kind !== 'none' || s.phase.devPlayed) return false;
  const p = s.players[s.current];
  return p.devCards.some((c) => c.type === type && c.boughtTurn < s.turn);
}

/** Länge der längsten zusammenhängenden Route eines Spielers (fremde Bauten unterbrechen). */
export function longestRouteLength(s: GameState, p: number): number {
  const own = new Set(s.routes.map((o, e) => (o === p ? e : -1)).filter((e) => e >= 0));
  if (own.size === 0) return 0;
  let best = 0;
  const used = new Set<number>();

  const dfs = (v: number, len: number) => {
    best = Math.max(best, len);
    const b = s.buildings[v];
    if (len > 0 && b && b.owner !== p) return; // blockiert: hier geht es nicht weiter
    for (const e of TOPOLOGY.vertices[v].edges) {
      if (!own.has(e) || used.has(e)) continue;
      used.add(e);
      const edge = TOPOLOGY.edges[e];
      dfs(edge.a === v ? edge.b : edge.a, len + 1);
      used.delete(e);
    }
  };

  const starts = new Set<number>();
  own.forEach((e) => {
    starts.add(TOPOLOGY.edges[e].a);
    starts.add(TOPOLOGY.edges[e].b);
  });
  starts.forEach((v) => dfs(v, 0));
  return best;
}

// ---------- Hilfsfunktionen für Änderungen (arbeiten auf einer Kopie) ----------

function pay(s: GameState, p: number, cost: Partial<ResourceCount>) {
  for (const r of RESOURCES) {
    const c = cost[r] ?? 0;
    s.players[p].resources[r] -= c;
    s.bank[r] += c;
  }
}

function checkWin(s: GameState) {
  if (s.phase.kind === 'main' && victoryPoints(s, s.current) >= WIN_POINTS) {
    s.phase = { kind: 'ended', winner: s.current };
    s.log.push(`🏆 ${s.players[s.current].name} gewinnt mit ${victoryPoints(s, s.current)} Siegpunkten!`);
  }
}

function updateLongestRoute(s: GameState) {
  const lengths = s.players.map((p) => longestRouteLength(s, p.id));
  const max = Math.max(...lengths);
  const holder = s.longestRoute;
  let next: number | null;
  if (holder !== null && lengths[holder] === max && max >= LONGEST_ROUTE_MIN) next = holder;
  else {
    const leaders = lengths.map((l, p) => (l === max ? p : -1)).filter((p) => p >= 0);
    next = max >= LONGEST_ROUTE_MIN && leaders.length === 1 ? leaders[0] : null;
  }
  if (next !== holder) {
    s.longestRoute = next;
    s.log.push(
      next === null
        ? 'Niemand hat mehr die längste Route.'
        : `🛣️ ${s.players[next].name} hat jetzt die längste Route (${lengths[next]}).`,
    );
  }
}

function updateLargestFleet(s: GameState, p: number) {
  const k = s.players[p].knightsPlayed;
  const holder = s.largestFleet;
  if (holder === p || k < LARGEST_FLEET_MIN) return;
  if (holder === null || k > s.players[holder].knightsPlayed) {
    s.largestFleet = p;
    s.log.push(`🚀 ${s.players[p].name} hat jetzt die größte Flotte (${k} Raumjäger).`);
  }
}

function random(s: GameState): number {
  const [x, next] = nextRandom(s.rngState);
  s.rngState = next;
  return x;
}

function describe(res: Partial<ResourceCount>): string {
  return RESOURCES.filter((r) => (res[r] ?? 0) > 0)
    .map((r) => `${res[r]}× ${RESOURCE_NAMES[r]}`)
    .join(', ');
}

/** Verteilt Rohstoffe für eine Augensumme. Bei Bank-Engpass bekommt niemand etwas von diesem Rohstoff
 *  (außer es ist nur ein Spieler betroffen – der bekommt den Rest). */
export function produce(s: GameState, sum: number) {
  const demand = s.players.map(() => emptyResources());
  for (const tile of s.board.tiles) {
    if (tile.number !== sum || tile.hexId === s.board.pirateHex) continue;
    const res = TERRAIN_RESOURCE[tile.terrain];
    if (!res) continue;
    for (const v of TOPOLOGY.hexes[tile.hexId].vertices) {
      const b = s.buildings[v];
      if (b) demand[b.owner][res] += b.type === 'station' ? 2 : 1;
    }
  }
  const gains = s.players.map(() => emptyResources());
  for (const r of RESOURCES) {
    const total = demand.reduce((t, d) => t + d[r], 0);
    if (total === 0) continue;
    const receivers = demand.filter((d) => d[r] > 0).length;
    if (total > s.bank[r] && receivers > 1) {
      s.log.push(`Die Bank hat nicht genug ${RESOURCE_NAMES[r]} – niemand erhält ${RESOURCE_NAMES[r]}.`);
      continue;
    }
    demand.forEach((d, p) => {
      const amount = Math.min(d[r], s.bank[r]);
      gains[p][r] += amount;
      s.players[p].resources[r] += amount;
      s.bank[r] -= amount;
    });
  }
  gains.forEach((g, p) => {
    if (totalCards(g) > 0) s.log.push(`${s.players[p].name} erhält ${describe(g)}.`);
  });
}

function stealFrom(s: GameState, thief: number, victim: number) {
  const pool = RESOURCES.flatMap((r) => Array<Resource>(s.players[victim].resources[r]).fill(r));
  if (pool.length === 0) return;
  const r = pool[Math.floor(random(s) * pool.length)];
  s.players[victim].resources[r]--;
  s.players[thief].resources[r]++;
  s.log.push(`${s.players[thief].name} raubt ${s.players[victim].name} eine Karte.`);
}

/** Hat der Spieler mindestens diese Karten? */
export function hasCards(s: GameState, p: number, cards: Partial<ResourceCount>): boolean {
  return canAfford(s.players[p].resources, cards);
}

/** Gültige Handelsseiten: beide nicht leer, keine negativen Werte, kein Rohstoff auf beiden Seiten. */
export function validTradeSides(give: Partial<ResourceCount>, get: Partial<ResourceCount>): boolean {
  if (RESOURCES.some((r) => (give[r] ?? 0) < 0 || (get[r] ?? 0) < 0)) return false;
  if (totalCards(give) === 0 || totalCards(get) === 0) return false;
  return RESOURCES.every((r) => !((give[r] ?? 0) > 0 && (get[r] ?? 0) > 0));
}

export function canProposeTrade(s: GameState): boolean {
  return isIdle(s) && totalCards(s.players[s.current].resources) > 0;
}

/** Was würde der Abschluss mit Spieler `w` konkret tauschen? (aus Sicht des Anbietenden) */
export function tradeTerms(offer: TradeOffer, w: number): { give: Partial<ResourceCount>; get: Partial<ResourceCount> } | null {
  const r = offer.responses[w];
  if (!r) return null;
  if (r.type === 'accept') return { give: offer.give, get: offer.get };
  if (r.type === 'counter') return { give: r.get, get: r.give };
  return null;
}

function transfer(s: GameState, from: number, to: number, cards: Partial<ResourceCount>) {
  for (const r of RESOURCES) {
    const n = cards[r] ?? 0;
    s.players[from].resources[r] -= n;
    s.players[to].resources[r] += n;
  }
}

function setPending(s: GameState, pending: Pending) {
  if (s.phase.kind === 'main') s.phase.pending = pending;
}

function takeDevCard(s: GameState, p: number, type: DevCardType) {
  const cards = s.players[p].devCards;
  const i = cards.findIndex((c) => c.type === type && c.boughtTurn < s.turn);
  cards.splice(i, 1);
  if (s.phase.kind === 'main') s.phase.devPlayed = true;
}

// ---------- Aktionen ----------

export function applyAction(state: GameState, action: Action): GameState {
  if (state.phase.kind === 'ended') throw new GameError('Das Spiel ist vorbei.');
  const s: GameState = structuredClone(state);
  const p = s.current;
  const name = s.players[p].name;
  const phase = s.phase;

  switch (action.type) {
    case 'placeSetupOutpost': {
      if (phase.kind !== 'setup' || phase.awaiting !== 'outpost') throw new GameError('Jetzt kein Außenposten möglich.');
      if (!distanceOk(s, action.vertex)) throw new GameError('Hier darf kein Außenposten stehen.');
      s.buildings[action.vertex] = { owner: p, type: 'outpost' };
      phase.awaiting = 'route';
      phase.lastVertex = action.vertex;
      s.log.push(`${name} gründet einen Außenposten.`);
      // Zweite Runde: Startrohstoffe von den angrenzenden Feldern
      if (phase.step >= s.players.length) {
        const gain = emptyResources();
        for (const h of TOPOLOGY.vertices[action.vertex].hexes) {
          const r = TERRAIN_RESOURCE[s.board.tiles[h].terrain];
          if (r && s.bank[r] > 0) {
            gain[r]++;
            s.bank[r]--;
            s.players[p].resources[r]++;
          }
        }
        if (totalCards(gain) > 0) s.log.push(`${name} erhält Startrohstoffe: ${describe(gain)}.`);
      }
      return s;
    }

    case 'placeSetupRoute': {
      if (phase.kind !== 'setup' || phase.awaiting !== 'route') throw new GameError('Jetzt keine Raumroute möglich.');
      if (!legalSetupRoutes(s).includes(action.edge)) throw new GameError('Die Route muss am neuen Außenposten liegen.');
      s.routes[action.edge] = p;
      phase.step++;
      phase.awaiting = 'outpost';
      phase.lastVertex = null;
      if (phase.step >= phase.order.length) {
        s.phase = MAIN_IDLE(false);
        s.current = 0;
        s.turn = 1;
        s.log.push(`Gründung abgeschlossen. ${s.players[0].name} beginnt.`);
      } else {
        s.current = phase.order[phase.step];
      }
      return s;
    }

    case 'roll': {
      if (phase.kind !== 'main' || phase.rolled || phase.pending.kind !== 'none') {
        throw new GameError('Jetzt kann nicht gewürfelt werden.');
      }
      const d: [number, number] = [1 + Math.floor(random(s) * 6), 1 + Math.floor(random(s) * 6)];
      s.dice = d;
      phase.rolled = true;
      const sum = d[0] + d[1];
      s.log.push(`${name} würfelt ${d[0]} + ${d[1]} = ${sum}.`);
      if (sum !== 7) {
        produce(s, sum);
        return s;
      }
      s.log.push('🏴‍☠️ Eine 7! Die Piraten greifen an.');
      const amounts = s.players.map((pl) => {
        const n = totalCards(pl.resources);
        return n > HAND_LIMIT ? Math.floor(n / 2) : 0;
      });
      if (amounts.some((a) => a > 0)) {
        phase.pending = { kind: 'discard', amounts };
        amounts.forEach((a, i) => a > 0 && s.log.push(`${s.players[i].name} muss ${a} Karten abwerfen.`));
      } else {
        phase.pending = { kind: 'movePirate' };
      }
      return s;
    }

    case 'discard': {
      if (phase.kind !== 'main' || phase.pending.kind !== 'discard') throw new GameError('Jetzt wird nicht abgeworfen.');
      const need = phase.pending.amounts[action.player] ?? 0;
      if (need === 0) throw new GameError('Dieser Spieler muss nichts abwerfen.');
      if (totalCards(action.cards) !== need) throw new GameError(`Bitte genau ${need} Karten abwerfen.`);
      const res = s.players[action.player].resources;
      if (RESOURCES.some((r) => (action.cards[r] ?? 0) < 0 || (action.cards[r] ?? 0) > res[r])) {
        throw new GameError('So viele Karten hast du nicht.');
      }
      pay(s, action.player, action.cards);
      phase.pending.amounts[action.player] = 0;
      s.log.push(`${s.players[action.player].name} wirft ${need} Karten ab.`);
      if (phase.pending.amounts.every((a) => a === 0)) phase.pending = { kind: 'movePirate' };
      return s;
    }

    case 'movePirate': {
      if (phase.kind !== 'main' || phase.pending.kind !== 'movePirate') throw new GameError('Das Piratenschiff kann jetzt nicht bewegt werden.');
      if (!legalPirateHexes(s).includes(action.hex)) throw new GameError('Das Piratenschiff muss auf ein anderes Feld.');
      s.board.pirateHex = action.hex;
      s.log.push(`${name} versetzt das Piratenschiff.`);
      const victims = stealVictims(s, action.hex, p);
      if (victims.length === 0) phase.pending = { kind: 'none' };
      else if (victims.length === 1) {
        stealFrom(s, p, victims[0]);
        phase.pending = { kind: 'none' };
      } else phase.pending = { kind: 'steal', hex: action.hex, victims };
      return s;
    }

    case 'steal': {
      if (phase.kind !== 'main' || phase.pending.kind !== 'steal') throw new GameError('Jetzt wird nicht geraubt.');
      if (!phase.pending.victims.includes(action.victim)) throw new GameError('Diesem Spieler kann nichts geraubt werden.');
      stealFrom(s, p, action.victim);
      phase.pending = { kind: 'none' };
      return s;
    }

    case 'build': {
      const free = phase.kind === 'main' && phase.pending.kind === 'freeRoutes' && action.kind === 'route';
      if (!free && !isIdle(s)) throw new GameError('Erst würfeln, dann bauen.');
      const kind = action.kind;
      if (piecesLeft(s, p)[kind] <= 0) throw new GameError('Keine Bauteile dieser Art mehr übrig.');
      if (!free && !canAfford(s.players[p].resources, COSTS[kind])) throw new GameError('Nicht genug Rohstoffe.');
      if (action.kind === 'route') {
        if (!legalRoutes(s, p).includes(action.edge)) throw new GameError('Hier kann keine Route gebaut werden.');
        s.routes[action.edge] = p;
        s.log.push(`${name} baut eine Raumroute${free ? ' (Hyperraumtunnel)' : ''}.`);
      } else if (action.kind === 'outpost') {
        if (!legalOutposts(s, p).includes(action.vertex)) throw new GameError('Hier kann kein Außenposten gebaut werden.');
        s.buildings[action.vertex] = { owner: p, type: 'outpost' };
        s.log.push(`${name} baut einen Außenposten.`);
      } else {
        if (!legalStations(s, p).includes(action.vertex)) throw new GameError('Nur eigene Außenposten können ausgebaut werden.');
        s.buildings[action.vertex] = { owner: p, type: 'station' };
        s.log.push(`${name} baut eine Station.`);
      }
      if (free && phase.kind === 'main' && phase.pending.kind === 'freeRoutes') {
        const left = phase.pending.left - 1;
        const more = left > 0 && piecesLeft(s, p).route > 0 && legalRoutes(s, p).length > 0;
        phase.pending = more ? { kind: 'freeRoutes', left } : { kind: 'none' };
      } else {
        pay(s, p, COSTS[kind]);
      }
      if (kind !== 'station') updateLongestRoute(s);
      checkWin(s);
      return s;
    }

    case 'bankTrade': {
      if (!canBankTrade(s, action.give, action.get)) throw new GameError('Dieser Tausch ist nicht möglich.');
      const ratio = tradeRatio(s, p, action.give);
      pay(s, p, { [action.give]: ratio });
      s.bank[action.get]--;
      s.players[p].resources[action.get]++;
      s.log.push(`${name} tauscht ${ratio}× ${RESOURCE_NAMES[action.give]} gegen 1× ${RESOURCE_NAMES[action.get]}.`);
      return s;
    }

    case 'buyDevCard': {
      if (!canBuyDevCard(s)) throw new GameError('Jetzt kann keine Entwicklungskarte gekauft werden.');
      pay(s, p, COSTS.devCard);
      const type = s.deck.pop()!;
      s.players[p].devCards.push({ type, boughtTurn: s.turn });
      s.log.push(`${name} kauft eine Entwicklungskarte.`);
      checkWin(s);
      return s;
    }

    case 'playKnight': {
      if (!canPlayDev(s, 'knight')) throw new GameError('Du kannst jetzt keinen Raumjäger spielen.');
      takeDevCard(s, p, 'knight');
      s.players[p].knightsPlayed++;
      s.log.push(`${name} spielt einen Raumjäger 🚀.`);
      updateLargestFleet(s, p);
      setPending(s, { kind: 'movePirate' });
      checkWin(s);
      return s;
    }

    case 'playRoutes': {
      if (!canPlayDev(s, 'routes')) throw new GameError('Du kannst jetzt keinen Hyperraumtunnel spielen.');
      takeDevCard(s, p, 'routes');
      s.log.push(`${name} spielt einen Hyperraumtunnel 🌀.`);
      const left = Math.min(2, piecesLeft(s, p).route);
      if (left > 0 && legalRoutes(s, p).length > 0) setPending(s, { kind: 'freeRoutes', left });
      return s;
    }

    case 'playPlenty': {
      if (!canPlayDev(s, 'plenty')) throw new GameError('Du kannst jetzt keinen Frachtfund spielen.');
      const want = emptyResources();
      action.resources.forEach((r) => want[r]++);
      if (RESOURCES.some((r) => want[r] > s.bank[r])) throw new GameError('Die Bank hat nicht genug davon.');
      takeDevCard(s, p, 'plenty');
      RESOURCES.forEach((r) => {
        s.bank[r] -= want[r];
        s.players[p].resources[r] += want[r];
      });
      s.log.push(`${name} spielt einen Frachtfund 📦 und erhält ${describe(want)}.`);
      return s;
    }

    case 'playMonopoly': {
      if (!canPlayDev(s, 'monopoly')) throw new GameError('Du kannst jetzt kein Monopol spielen.');
      takeDevCard(s, p, 'monopoly');
      let total = 0;
      s.players.forEach((pl) => {
        if (pl.id === p) return;
        total += pl.resources[action.resource];
        pl.resources[action.resource] = 0;
      });
      s.players[p].resources[action.resource] += total;
      s.log.push(`${name} spielt ein Monopol 💰 auf ${RESOURCE_NAMES[action.resource]} und erhält ${total} Karten.`);
      return s;
    }

    case 'proposeTrade': {
      if (!canProposeTrade(s)) throw new GameError('Jetzt kann nicht gehandelt werden.');
      if (!validTradeSides(action.give, action.get)) throw new GameError('Ungültiges Angebot.');
      if (!hasCards(s, p, action.give)) throw new GameError('So viele Karten hast du nicht.');
      const to = [...new Set(action.to)].filter((q) => q !== p && q >= 0 && q < s.players.length);
      if (to.length === 0) throw new GameError('Wähle mindestens einen Mitspieler.');
      const responses: (TradeResponse | null | undefined)[] = s.players.map((_, q) => (to.includes(q) ? null : undefined));
      setPending(s, { kind: 'trade', from: p, give: { ...action.give }, get: { ...action.get }, responses });
      s.log.push(`${name} bietet ${describe(action.give)} für ${describe(action.get)}.`);
      return s;
    }

    case 'respondTrade': {
      if (phase.kind !== 'main' || phase.pending.kind !== 'trade') throw new GameError('Es gibt kein offenes Angebot.');
      const offer = phase.pending;
      const q = action.player;
      if (offer.responses[q] !== null) throw new GameError('Dieser Spieler muss nicht antworten.');
      const r = action.response;
      if (r.type === 'accept' && !hasCards(s, q, offer.get)) throw new GameError('Dafür hast du nicht genug Karten.');
      if (r.type === 'counter') {
        if (!validTradeSides(r.give, r.get)) throw new GameError('Ungültiges Gegenangebot.');
        if (!hasCards(s, q, r.give)) throw new GameError('So viele Karten hast du nicht.');
      }
      offer.responses[q] = r.type === 'counter' ? { type: 'counter', give: { ...r.give }, get: { ...r.get } } : { type: r.type };
      const qn = s.players[q].name;
      s.log.push(
        r.type === 'accept' ? `${qn} nimmt das Angebot an.`
          : r.type === 'decline' ? `${qn} lehnt ab.`
          : `${qn} macht ein Gegenangebot: ${describe(r.give)} für ${describe(r.get)}.`,
      );
      return s;
    }

    case 'completeTrade': {
      if (phase.kind !== 'main' || phase.pending.kind !== 'trade') throw new GameError('Es gibt kein offenes Angebot.');
      const offer = phase.pending;
      if (offer.responses.some((r) => r === null)) throw new GameError('Es haben noch nicht alle geantwortet.');
      const terms = tradeTerms(offer, action.with);
      if (!terms) throw new GameError('Mit diesem Spieler gibt es keinen Handel.');
      if (!hasCards(s, p, terms.give) || !hasCards(s, action.with, terms.get)) {
        throw new GameError('Für diesen Handel fehlen Karten.');
      }
      transfer(s, p, action.with, terms.give);
      transfer(s, action.with, p, terms.get);
      phase.pending = { kind: 'none' };
      s.log.push(`🤝 ${name} und ${s.players[action.with].name} handeln: ${describe(terms.give)} gegen ${describe(terms.get)}.`);
      return s;
    }

    case 'cancelTrade': {
      if (phase.kind !== 'main' || phase.pending.kind !== 'trade') throw new GameError('Es gibt kein offenes Angebot.');
      if (phase.pending.responses.some((r) => r === null)) throw new GameError('Es haben noch nicht alle geantwortet.');
      phase.pending = { kind: 'none' };
      s.log.push(`${name} zieht das Angebot zurück.`);
      return s;
    }

    case 'endTurn': {
      if (!isIdle(s)) throw new GameError('Erst würfeln.');
      s.current = (p + 1) % s.players.length;
      s.phase = MAIN_IDLE(false);
      s.dice = null;
      s.turn++;
      s.log.push(`${s.players[s.current].name} ist am Zug.`);
      return s;
    }
  }
}
