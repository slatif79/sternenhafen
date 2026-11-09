import { useEffect, useMemo, useRef, useState } from 'react';
import { aiAction, newMemo } from '../engine/ai';
import {
  actor, applyAction, canBuild, canBuyDevCard, COSTS, GameError, LARGEST_FLEET_MIN, legalOutposts,
  legalPirateHexes, legalRoutes, legalSetupOutposts, legalSetupRoutes, legalStations, LONGEST_ROUTE_MIN,
  piecesLeft, publicVictoryPoints, totalCards, victoryPoints,
  type Action, type BuildKind, type GameState, type ResourceCount,
} from '../engine/game';
import { RESOURCES } from '../engine/types';
import { BoardView } from './BoardView';
import {
  DevCardsDialog, DiscardDialog, StealDialog, TradeDialog, TradeRespondDialog, TradeResultDialog,
} from './Dialogs';
import { LogDialog, RulesDialog } from './Rules';
import { LEVEL_LABEL } from './SetupScreen';
import { RESOURCE_STYLE } from './theme';

const BUILD_LABEL: Record<BuildKind, string> = { route: 'Route', outpost: 'Außenposten', station: 'Station' };

function Cost({ cost }: { cost: Partial<ResourceCount> }) {
  return (
    <span className="cost">
      {RESOURCES.flatMap((r) => Array.from({ length: cost[r] ?? 0 }, (_, i) => <span key={r + i}>{RESOURCE_STYLE[r].icon}</span>))}
    </span>
  );
}

const DIE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export function GameScreen({ initial, onQuit }: { initial: GameState; onQuit: (force?: boolean) => void }) {
  const [game, setGame] = useState(initial);
  const [mode, setMode] = useState<BuildKind | null>(null);
  const [revealedFor, setRevealedFor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [dialog, setDialog] = useState<'trade' | 'dev' | null>(null);
  const [fast, setFast] = useState(false);
  const aiMemo = useRef(newMemo());
  const prevGame = useRef(game);
  const [flash, setFlash] = useState<{ key: number; vertices: number[]; edges: number[]; hexes: number[]; color: string }>();

  // Änderungen gegenüber dem vorherigen Zustand finden und kurz aufleuchten lassen
  useEffect(() => {
    const prev = prevGame.current;
    prevGame.current = game;
    if (prev === game) return;
    const vertices = game.buildings.flatMap((b, v) =>
      b && (prev.buildings[v]?.owner !== b.owner || prev.buildings[v]?.type !== b.type) ? [v] : []);
    const edges = game.routes.flatMap((o, e) => (o !== null && prev.routes[e] !== o ? [e] : []));
    const hexes = game.board.pirateHex !== prev.board.pirateHex ? [game.board.pirateHex] : [];
    if (vertices.length + edges.length + hexes.length === 0) return;
    const owner = vertices.length ? game.buildings[vertices[0]]!.owner : edges.length ? game.routes[edges[0]]! : prev.current;
    setFlash((f) => ({ key: (f?.key ?? 0) + 1, vertices, edges, hexes, color: game.players[owner].color }));
  }, [game]);

  const acting = actor(game);
  const me = game.players[acting];
  const humanIds = game.players.filter((p) => p.kind === 'human').map((p) => p.id);
  const humans = humanIds.length;
  const actingHuman = me.kind === 'human';
  const ended = game.phase.kind === 'ended';
  const needsHandover = !ended && actingHuman && humans > 1 && revealedFor !== acting;
  /** Darf der Mensch am Gerät gerade etwas tun? */
  const canAct = actingHuman && !needsHandover && !ended;
  /** Wessen Karten werden unten angezeigt? */
  const viewer = actingHuman ? acting : humans === 1 ? humanIds[0] : revealedFor;
  const viewerRes = viewer === null || needsHandover ? null : game.players[viewer].resources;
  const colors = game.players.map((p) => p.color);
  const ph = game.phase;
  const pending = ph.kind === 'main' ? ph.pending : null;
  const idle = ph.kind === 'main' && ph.pending.kind === 'none';

  const dispatch = (action: Action) => {
    try {
      const next = applyAction(game, action);
      setGame(next);
      setError(null);
      if (action.type === 'build' && !canBuild(next, action.kind)) setMode(null);
      if (action.type === 'proposeTrade') setDialog(null);
      if (action.type === 'endTurn') {
        setMode(null);
        setDialog(null);
      }
    } catch (e) {
      if (e instanceof GameError) setError(e.message);
      else throw e;
    }
  };

  // Welche Plätze sind gerade antippbar?
  const targets = useMemo(() => {
    const none = { v: [] as number[], e: [] as number[], h: [] as number[] };
    if (!canAct) return none;
    if (ph.kind === 'setup') {
      return ph.awaiting === 'outpost' ? { ...none, v: legalSetupOutposts(game) } : { ...none, e: legalSetupRoutes(game) };
    }
    if (ph.kind !== 'main') return none;
    if (ph.pending.kind === 'movePirate') return { ...none, h: legalPirateHexes(game) };
    if (ph.pending.kind === 'freeRoutes') return { ...none, e: legalRoutes(game, game.current) };
    if (ph.pending.kind === 'none' && mode && canBuild(game, mode)) {
      if (mode === 'route') return { ...none, e: legalRoutes(game, game.current) };
      return { ...none, v: mode === 'outpost' ? legalOutposts(game, game.current) : legalStations(game, game.current) };
    }
    return none;
  }, [game, ph, mode, canAct]);

  // Schutz vor versehentlichem Verlassen/Neuladen während eines laufenden Spiels
  useEffect(() => {
    if (ended) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [ended]);

  // Computergegner: führt nach kurzer Pause eine Aktion aus
  useEffect(() => {
    if (ended || actingHuman) return;
    const quick = pending && (pending.kind === 'discard' || pending.kind === 'trade');
    const delay = fast ? 120 : quick ? 450 : 750;
    const t = setTimeout(() => {
      let next: GameState | null = null;
      try {
        next = applyAction(game, aiAction(game, aiMemo.current));
      } catch (e) {
        console.error('KI-Fehler', e);
        // Notfall: Zug beenden bzw. offenes Angebot schließen, damit das Spiel weiterläuft
        for (const fallback of [{ type: 'endTurn' }, { type: 'cancelTrade' }, { type: 'roll' }] as Action[]) {
          try { next = applyAction(game, fallback); break; } catch { /* nächster Versuch */ }
        }
      }
      if (next) setGame(next);
    }, delay);
    return () => clearTimeout(t);
  }, [game, ended, actingHuman, pending, fast]);

  const onVertexTap = (v: number) => {
    if (ph.kind === 'setup') dispatch({ type: 'placeSetupOutpost', vertex: v });
    else if (mode === 'outpost' || mode === 'station') dispatch({ type: 'build', kind: mode, vertex: v });
  };
  const onEdgeTap = (e: number) => {
    if (ph.kind === 'setup') dispatch({ type: 'placeSetupRoute', edge: e });
    else dispatch({ type: 'build', kind: 'route', edge: e });
  };
  const onHexTap = (h: number) => dispatch({ type: 'movePirate', hex: h });

  const hint = (() => {
    if (!actingHuman && !ended) {
      if (pending?.kind === 'discard') return 'wirft Karten ab …';
      if (pending?.kind === 'trade') return acting === pending.from ? 'wählt einen Handel …' : 'prüft das Angebot …';
      return 'ist am Zug … 🤖';
    }
    if (ph.kind === 'setup') {
      const round = ph.step < game.players.length ? 'ersten' : 'zweiten';
      return ph.awaiting === 'outpost'
        ? `Setze deinen ${round} Außenposten.`
        : 'Setze eine Raumroute an den neuen Außenposten.';
    }
    if (!pending) return '';
    switch (pending.kind) {
      case 'discard': return `Wirf ${pending.amounts[acting]} Karten ab.`;
      case 'movePirate': return 'Tippe auf ein Feld, um das Piratenschiff 🏴‍☠️ zu versetzen.';
      case 'steal': return 'Wähle, wen du beraubst.';
      case 'freeRoutes': return `Baue noch ${pending.left} kostenlose Raumroute${pending.left > 1 ? 'n' : ''}.`;
      case 'trade':
        return acting === pending.from
          ? 'Alle haben geantwortet – wähle einen Handel.'
          : `Antworte auf das Angebot von ${game.players[pending.from].name}.`;
    }
    if (ph.kind === 'main' && !ph.rolled) return 'Würfle, um deinen Zug zu beginnen.';
    if (mode) return `Tippe auf einen markierten Platz für: ${BUILD_LABEL[mode]}.`;
    return 'Baue, handle oder beende deinen Zug.';
  })();

  const lastLog = game.log[game.log.length - 1];
  const left = piecesLeft(game, game.current);
  const devCount = game.players[game.current].devCards.length;

  return (
    <div className="app">
      {/* Spielerleiste */}
      <header className="players">
        {game.players.map((p) => (
          <div key={p.id} className={`player-chip ${p.id === game.current ? 'current' : ''}`} style={{ borderColor: p.color }}>
            <span className="dot" style={{ background: p.color }} />
            <span className="pname">{p.kind === 'ai' ? '🤖 ' : ''}{p.name}</span>
            {p.kind === 'ai' && <span className="level-tag">{LEVEL_LABEL[p.level]}</span>}
            <span className="vp" title="Siegpunkte (sichtbar)">★ {publicVictoryPoints(game, p.id)}</span>
            <span className="cards" title="Rohstoffkarten">🂠 {totalCards(p.resources)}</span>
            {p.devCards.length > 0 && <span className="cards" title="Entwicklungskarten">🃏 {p.devCards.length}</span>}
            {p.knightsPlayed > 0 && <span className="cards" title="Gespielte Raumjäger">🚀 {p.knightsPlayed}</span>}
            {game.longestRoute === p.id && <span className="award" title={`Längste Route (ab ${LONGEST_ROUTE_MIN}) +2`}>🛣️</span>}
            {game.largestFleet === p.id && <span className="award" title={`Größte Flotte (ab ${LARGEST_FLEET_MIN}) +2`}>🛡️</span>}
          </div>
        ))}
        {humans < game.players.length && (
          <button className={`icon-btn ${fast ? 'active' : ''}`} onClick={() => setFast((f) => !f)} title="KI-Tempo" aria-label="KI-Tempo umschalten">
            {fast ? '⏩' : '▶︎'}
          </button>
        )}
        <button className="icon-btn" onClick={() => setShowRules(true)} title="Spielregeln" aria-label="Spielregeln">?</button>
        <button className="icon-btn" onClick={() => onQuit()} aria-label="Spiel verlassen" title="Spiel verlassen">✕</button>
      </header>

      <main className="main">
        <BoardView
          board={game.board}
          buildings={game.buildings}
          routes={game.routes}
          colors={colors}
          targetVertices={targets.v}
          targetEdges={targets.e}
          targetHexes={targets.h}
          activeColor={me.color}
          onVertexTap={onVertexTap}
          onEdgeTap={onEdgeTap}
          onHexTap={onHexTap}
          flash={flash}
        />
        {game.dice && (
          <div className={`dice ${game.dice[0] + game.dice[1] === 7 ? 'seven' : ''}`} aria-label={`Wurf: ${game.dice[0] + game.dice[1]}`}>
            <span>{DIE_FACES[game.dice[0]]}</span>
            <span>{DIE_FACES[game.dice[1]]}</span>
            <strong>{game.dice[0] + game.dice[1]}</strong>
          </div>
        )}
      </main>

      {/* Aktionsleiste */}
      <footer className="panel">
        <div className="status-line">
          <span className="dot" style={{ background: me.color }} />
          <strong>{me.name}:</strong>&nbsp;<span className={error ? 'error' : ''}>{error ?? hint}</span>
        </div>
        <button className="log-line" onClick={() => setShowLog((v) => !v)}>
          {lastLog} <span className="muted">· Verlauf</span>
        </button>

        {viewerRes && (
          <div className="hand">
            {RESOURCES.map((r) => (
              <div key={r} className={`card ${viewerRes[r] === 0 ? 'empty' : ''}`} style={{ borderColor: RESOURCE_STYLE[r].color }}>
                <span className="card-icon">{RESOURCE_STYLE[r].icon}</span>
                <span className="card-count">{viewerRes[r]}</span>
                <span className="card-name">{RESOURCE_STYLE[r].name}</span>
              </div>
            ))}
          </div>
        )}

        {ph.kind === 'main' && idle && canAct && (
          <div className="actions">
            {!ph.rolled ? (
              <>
                <button className="primary span3" onClick={() => dispatch({ type: 'roll' })}>🎲 Würfeln</button>
                <button onClick={() => setDialog('dev')}>🃏 {devCount}</button>
              </>
            ) : (
              <>
                {(['route', 'outpost', 'station'] as BuildKind[]).map((k) => (
                  <button
                    key={k}
                    className={`build-btn ${mode === k ? 'active' : ''}`}
                    disabled={!canBuild(game, k)}
                    onClick={() => setMode((m) => (m === k ? null : k))}
                  >
                    <span>{BUILD_LABEL[k]} <span className="muted small">({left[k]})</span></span>
                    <Cost cost={COSTS[k]} />
                  </button>
                ))}
                <button className="build-btn" disabled={!canBuyDevCard(game)} onClick={() => dispatch({ type: 'buyDevCard' })}>
                  <span>Karte <span className="muted small">({game.deck.length})</span></span>
                  <Cost cost={COSTS.devCard} />
                </button>
                <button onClick={() => { setMode(null); setDialog('trade'); }}>⇄ Handel</button>
                <button onClick={() => { setMode(null); setDialog('dev'); }}>🃏 Karten ({devCount})</button>
                <button className="primary span2" onClick={() => dispatch({ type: 'endTurn' })}>Zug beenden</button>
              </>
            )}
          </div>
        )}
      </footer>

      {/* Dialoge */}
      {canAct && pending?.kind === 'discard' && (
        <DiscardDialog key={acting} game={game} player={acting} need={pending.amounts[acting]} dispatch={dispatch} />
      )}
      {canAct && pending?.kind === 'steal' && (
        <StealDialog game={game} victims={pending.victims} dispatch={dispatch} />
      )}
      {canAct && pending?.kind === 'trade' && acting !== pending.from && (
        <TradeRespondDialog key={acting} game={game} offer={pending} player={acting} dispatch={dispatch} />
      )}
      {canAct && pending?.kind === 'trade' && acting === pending.from && (
        <TradeResultDialog game={game} offer={pending} dispatch={dispatch} />
      )}
      {canAct && idle && dialog === 'trade' && (
        <TradeDialog game={game} dispatch={dispatch} onClose={() => setDialog(null)} />
      )}
      {canAct && idle && dialog === 'dev' && (
        <DevCardsDialog game={game} dispatch={dispatch} onClose={() => setDialog(null)} />
      )}

      {showLog && <LogDialog game={game} onClose={() => setShowLog(false)} />}
      {showRules && <RulesDialog onClose={() => setShowRules(false)} />}

      {needsHandover && (
        <div className="overlay">
          <div className="overlay-card">
            <span className="big-dot" style={{ background: me.color }} />
            <h2>{me.name} ist dran</h2>
            <p className="muted">
              {pending?.kind === 'discard'
                ? `${me.name} muss wegen der 7 Karten abwerfen. Gib das Gerät weiter.`
                : pending?.kind === 'trade' && acting !== pending.from
                  ? `${game.players[pending.from].name} hat ein Handelsangebot für ${me.name}. Gib das Gerät weiter.`
                  : pending?.kind === 'trade'
                    ? `Alle haben geantwortet. Gib das Gerät zurück an ${me.name}.`
                    : `Gib das Gerät an ${me.name} weiter. Die Karten werden erst danach angezeigt.`}
            </p>
            <button className="primary wide" onClick={() => setRevealedFor(acting)}>
              Ich bin {me.name}
            </button>
          </div>
        </div>
      )}

      {ph.kind === 'ended' && (
        <div className="overlay">
          <div className="overlay-card">
            <div className="trophy">🏆</div>
            <h2>{game.players[ph.winner].name} gewinnt!</h2>
            <p className="muted">In Zug {game.turn}. Endstand inkl. Artefakte:</p>
            <ul className="results">
              {[...game.players]
                .sort((a, b) => victoryPoints(game, b.id) - victoryPoints(game, a.id))
                .map((p) => (
                  <li key={p.id}>
                    <span className="dot" style={{ background: p.color }} /> {p.name} – ★ {victoryPoints(game, p.id)}
                  </li>
                ))}
            </ul>
            <button className="primary wide" onClick={() => onQuit(true)}>Neues Spiel</button>
          </div>
        </div>
      )}
    </div>
  );
}
