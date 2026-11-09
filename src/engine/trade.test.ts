import { describe, expect, it } from 'vitest';
import { actor, applyAction, createGame, type GameState } from './game';
import { finishSetup, players, resolvePending } from './testUtils';

function ready(n = 4): GameState {
  let s = finishSetup(createGame(players(n), 21));
  s = resolvePending(applyAction(s, { type: 'roll' }));
  s.players.forEach((pl) => (pl.resources = { ore: 2, ice: 2, crystal: 2, food: 2, fuel: 2 }));
  return s;
}

describe('Handel zwischen Spielern', () => {
  it('Angebot → alle antworten reihum → Anbieter schließt mit einem ab', () => {
    let s = ready();
    const p = s.current;
    const others = [1, 2, 3].map((i) => (p + i) % 4);
    s = applyAction(s, { type: 'proposeTrade', give: { ore: 2 }, get: { fuel: 1 }, to: others });
    expect(actor(s)).toBe(Math.min(...others));
    expect(() => applyAction(s, { type: 'endTurn' })).toThrow();
    expect(() => applyAction(s, { type: 'completeTrade', with: others[0] })).toThrow(); // noch nicht alle

    s = applyAction(s, { type: 'respondTrade', player: others[0], response: { type: 'decline' } });
    s = applyAction(s, { type: 'respondTrade', player: others[1], response: { type: 'accept' } });
    s = applyAction(s, {
      type: 'respondTrade', player: others[2],
      response: { type: 'counter', give: { fuel: 1 }, get: { ore: 1 } },
    });
    expect(actor(s)).toBe(p);
    expect(() => applyAction(s, { type: 'completeTrade', with: others[0] })).toThrow(); // hat abgelehnt

    // Gegenangebot annehmen: p gibt 1 Erz, bekommt 1 Treibstoff
    const t = applyAction(s, { type: 'completeTrade', with: others[2] });
    expect(t.players[p].resources).toMatchObject({ ore: 1, fuel: 3 });
    expect(t.players[others[2]].resources).toMatchObject({ ore: 3, fuel: 1 });
    expect(t.phase.kind === 'main' && t.phase.pending.kind).toBe('none');

    // Alternativ das ursprüngliche Angebot mit dem Annehmenden
    const u = applyAction(s, { type: 'completeTrade', with: others[1] });
    expect(u.players[p].resources).toMatchObject({ ore: 0, fuel: 3 });
    expect(u.players[others[1]].resources).toMatchObject({ ore: 4, fuel: 1 });
  });

  it('nur gefragte Spieler antworten; Abbrechen ist möglich', () => {
    let s = ready();
    const p = s.current;
    const q = (p + 2) % 4;
    s = applyAction(s, { type: 'proposeTrade', give: { ice: 1 }, get: { crystal: 1 }, to: [q] });
    expect(actor(s)).toBe(q);
    const other = (p + 1) % 4;
    expect(() => applyAction(s, { type: 'respondTrade', player: other, response: { type: 'accept' } })).toThrow();
    expect(() => applyAction(s, { type: 'cancelTrade' })).toThrow(); // q muss erst antworten
    s = applyAction(s, { type: 'respondTrade', player: q, response: { type: 'decline' } });
    s = applyAction(s, { type: 'cancelTrade' });
    expect(s.phase.kind === 'main' && s.phase.pending.kind).toBe('none');
    // danach normal weiter
    s = applyAction(s, { type: 'endTurn' });
    expect(s.current).toBe((p + 1) % 4);
  });

  it('prüft Karten und gültige Angebote', () => {
    const s = ready();
    const p = s.current;
    const q = (p + 1) % 4;
    const bad = [
      { give: { ore: 3 }, get: { fuel: 1 } }, // zu wenig Erz
      { give: {}, get: { fuel: 1 } }, // Geschenk
      { give: { ore: 1 }, get: {} },
      { give: { ore: 1 }, get: { ore: 1 } }, // gleicher Rohstoff
      { give: { ore: -1 }, get: { fuel: 1 } },
    ];
    for (const b of bad) expect(() => applyAction(s, { type: 'proposeTrade', ...b, to: [q] })).toThrow();
    expect(() => applyAction(s, { type: 'proposeTrade', give: { ore: 1 }, get: { fuel: 1 }, to: [p] })).toThrow();

    let t = applyAction(s, { type: 'proposeTrade', give: { ore: 1 }, get: { fuel: 3 }, to: [q] });
    // q hat nur 2 Treibstoff → Annehmen nicht möglich, Gegenangebot über eigene Karten hinaus auch nicht
    expect(() => applyAction(t, { type: 'respondTrade', player: q, response: { type: 'accept' } })).toThrow();
    expect(() => applyAction(t, {
      type: 'respondTrade', player: q, response: { type: 'counter', give: { fuel: 5 }, get: { ore: 1 } },
    })).toThrow();
    t = applyAction(t, { type: 'respondTrade', player: q, response: { type: 'counter', give: { fuel: 2 }, get: { ore: 1 } } });
    t = applyAction(t, { type: 'completeTrade', with: q });
    expect(t.players[p].resources).toMatchObject({ ore: 1, fuel: 4 });
  });

  it('Handel nur nach dem Würfeln und ohne offene Pflichtaktion', () => {
    const s = finishSetup(createGame(players(3), 21));
    s.players[0].resources.ore = 2;
    expect(() => applyAction(s, { type: 'proposeTrade', give: { ore: 1 }, get: { fuel: 1 }, to: [1] })).toThrow();
  });
});
