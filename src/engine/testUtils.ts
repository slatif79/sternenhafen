// Hilfsfunktionen für Tests (und später für Simulationen).
import {
  applyAction, legalPirateHexes, legalRoutes, legalSetupOutposts, legalSetupRoutes, type GameState,
} from './game';
import { RESOURCES, type Resource } from './types';

export const players = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `S${i + 1}`, kind: 'human' as const }));

/** Erledigt offene Pflichtaktionen (Abwerfen, Piraten, Rauben) mit einfachen Entscheidungen. */
export function resolvePending(s: GameState): GameState {
  while (s.phase.kind === 'main' && s.phase.pending.kind !== 'none') {
    const pend = s.phase.pending;
    if (pend.kind === 'discard') {
      const pl = pend.amounts.findIndex((a) => a > 0);
      let need = pend.amounts[pl];
      const cards: Partial<Record<Resource, number>> = {};
      for (const r of RESOURCES) {
        const take = Math.min(need, s.players[pl].resources[r]);
        cards[r] = take;
        need -= take;
      }
      s = applyAction(s, { type: 'discard', player: pl, cards });
    } else if (pend.kind === 'movePirate') {
      s = applyAction(s, { type: 'movePirate', hex: legalPirateHexes(s)[0] });
    } else if (pend.kind === 'steal') {
      s = applyAction(s, { type: 'steal', victim: pend.victims[0] });
    } else if (pend.kind === 'trade') {
      const q = pend.responses.findIndex((r) => r === null);
      s = q >= 0
        ? applyAction(s, { type: 'respondTrade', player: q, response: { type: 'decline' } })
        : applyAction(s, { type: 'cancelTrade' });
    } else {
      s = applyAction(s, { type: 'build', kind: 'route', edge: legalRoutes(s, s.current)[0] });
    }
  }
  return s;
}

/** Spielt die Gründungsphase automatisch durch (jeweils erster legaler Platz). */
export function finishSetup(s: GameState): GameState {
  while (s.phase.kind === 'setup') {
    s = s.phase.awaiting === 'outpost'
      ? applyAction(s, { type: 'placeSetupOutpost', vertex: legalSetupOutposts(s)[0] })
      : applyAction(s, { type: 'placeSetupRoute', edge: legalSetupRoutes(s)[0] });
  }
  return s;
}

