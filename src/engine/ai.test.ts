import { describe, expect, it } from 'vitest';
import { aiAction, newMemo } from './ai';
import { actor, applyAction, createGame, victoryPoints, type AiLevel, type GameState } from './game';
import { createRng } from './rng';

/** Spielt eine reine KI-Partie bis zum Ende. */
function playOut(levels: AiLevel[], seed: number, maxActions = 20000): { s: GameState; actions: number } {
  let s = createGame(levels.map((level, i) => ({ name: `KI ${i + 1}`, kind: 'ai' as const, level })), seed);
  const memo = newMemo();
  const rng = createRng(seed * 7 + 1);
  let actions = 0;
  while (s.phase.kind !== 'ended' && actions < maxActions) {
    const a = aiAction(s, memo, rng);
    s = applyAction(s, a); // wirft bei regelwidrigen Aktionen
    actions++;
  }
  return { s, actions };
}

describe('Computergegner', () => {
  it('spielen regelkonform bis zum Sieg (alle Stufen, 30 Partien)', () => {
    const turns: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const levels: AiLevel[] = (['easy', 'medium', 'hard', 'medium'] as AiLevel[]).slice(0, 2 + (seed % 3));
      const { s } = playOut(levels, seed);
      expect(s.phase.kind).toBe('ended');
      if (s.phase.kind === 'ended') expect(victoryPoints(s, s.phase.winner)).toBeGreaterThanOrEqual(10);
      turns.push(s.turn);
    }
    const avg = turns.reduce((a, b) => a + b, 0) / turns.length;
    // Partien sollen in vernünftiger Länge enden
    expect(avg).toBeLessThan(200);
  });

  it('Schwer schlägt Leicht deutlich (Stufen machen einen Unterschied)', () => {
    const wins: Record<AiLevel, number> = { easy: 0, medium: 0, hard: 0 };
    for (let seed = 100; seed < 160; seed++) {
      // Sitzreihenfolge rotieren, damit der Startvorteil fair verteilt ist
      const base: AiLevel[] = ['easy', 'hard', 'medium'];
      const levels = base.map((_, i) => base[(i + seed) % 3]);
      const { s } = playOut(levels, seed);
      if (s.phase.kind === 'ended') wins[levels[s.phase.winner]]++;
    }
    expect(wins.hard).toBeGreaterThan(wins.easy * 1.5);
    expect(wins.medium).toBeGreaterThan(wins.easy);
  });

  it('antwortet als Mitspieler auf Angebote eines Menschen', () => {
    let s = createGame([{ name: 'Mensch', kind: 'human' }, { name: 'KI', kind: 'ai', level: 'medium' }], 4);
    const memo = newMemo();
    const rng = createRng(3);
    // Gründung: Mensch nimmt jeweils ersten Platz, KI entscheidet selbst
    while (s.phase.kind === 'setup') {
      if (s.players[actor(s)].kind === 'ai') s = applyAction(s, aiAction(s, memo, rng));
      else s = s.phase.awaiting === 'outpost'
        ? applyAction(s, aiAction(s, memo, rng))
        : applyAction(s, aiAction(s, memo, rng));
    }
    while (s.phase.kind === 'main' && (s.current !== 0 || s.phase.rolled || s.phase.pending.kind !== 'none')) {
      s = applyAction(s, aiAction(s, memo, rng));
    }
    s = applyAction(s, { type: 'roll' });
    while (actor(s) !== 0 || (s.phase.kind === 'main' && s.phase.pending.kind !== 'none')) s = applyAction(s, aiAction(s, memo, rng));
    s.players[0].resources = { ore: 4, ice: 0, crystal: 0, food: 0, fuel: 0 };
    s.players[1].resources = { ore: 0, ice: 3, crystal: 0, food: 0, fuel: 0 };
    // großzügiges Angebot: 2 Erz für 1 Eis
    s = applyAction(s, { type: 'proposeTrade', give: { ore: 2 }, get: { ice: 1 }, to: [1] });
    expect(actor(s)).toBe(1);
    s = applyAction(s, aiAction(s, memo, rng));
    const r = s.phase.kind === 'main' && s.phase.pending.kind === 'trade' ? s.phase.pending.responses[1] : null;
    expect(r).toEqual({ type: 'accept' });
  });
});
