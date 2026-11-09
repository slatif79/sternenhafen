import { useState, type ReactNode } from 'react';
import {
  canProposeTrade, hasCards, validTradeSides, type TradeOffer, type TradeResponse,
  canBankTrade, canPlayDev, DEV_CARD_INFO, emptyResources, totalCards, tradeRatio, victoryPoints,
  type Action, type DevCardType, type GameState, type ResourceCount,
} from '../engine/game';
import { RESOURCES, type Resource } from '../engine/types';
import { RESOURCE_STYLE } from './theme';

export function Sheet({ title, onClose, children }: { title: string; onClose?: () => void; children: ReactNode }) {
  return (
    <div className="overlay sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          {onClose && <button className="icon-btn" onClick={onClose} aria-label="Schließen">✕</button>}
        </div>
        {children}
      </div>
    </div>
  );
}

function ResIcon({ r }: { r: Resource }) {
  return <span className="res-icon" style={{ background: RESOURCE_STYLE[r].color }}>{RESOURCE_STYLE[r].icon}</span>;
}

/** Auswahl einer Anzahl je Rohstoff mit +/−. */
function Picker({
  value, onChange, max, total,
}: {
  value: ResourceCount;
  onChange: (v: ResourceCount) => void;
  max: (r: Resource) => number;
  total: number;
}) {
  const sum = totalCards(value);
  return (
    <div className="picker">
      {RESOURCES.map((r) => (
        <div key={r} className="picker-row">
          <ResIcon r={r} />
          <span className="picker-name">{RESOURCE_STYLE[r].name} <span className="muted small">({max(r)})</span></span>
          <button disabled={value[r] === 0} onClick={() => onChange({ ...value, [r]: value[r] - 1 })}>−</button>
          <strong className="picker-val">{value[r]}</strong>
          <button disabled={value[r] >= max(r) || sum >= total} onClick={() => onChange({ ...value, [r]: value[r] + 1 })}>＋</button>
        </div>
      ))}
    </div>
  );
}

// ---------- Abwerfen ----------

export function DiscardDialog({ game, player, need, dispatch }: {
  game: GameState; player: number; need: number; dispatch: (a: Action) => void;
}) {
  const [sel, setSel] = useState(emptyResources);
  const res = game.players[player].resources;
  return (
    <Sheet title={`${game.players[player].name}: ${need} Karten abwerfen`}>
      <p className="muted">Eine 7 wurde gewürfelt und du hast mehr als 7 Karten. Wähle {need} Karten, die du an die Bank abgibst.</p>
      <Picker value={sel} onChange={setSel} max={(r) => res[r]} total={need} />
      <button
        className="primary wide"
        disabled={totalCards(sel) !== need}
        onClick={() => dispatch({ type: 'discard', player, cards: sel })}
      >
        {totalCards(sel)} / {need} abwerfen
      </button>
    </Sheet>
  );
}

// ---------- Rauben ----------

export function StealDialog({ game, victims, dispatch }: { game: GameState; victims: number[]; dispatch: (a: Action) => void }) {
  return (
    <Sheet title="Wen beraubst du?">
      <p className="muted">Du ziehst eine zufällige Karte.</p>
      <div className="choice-list">
        {victims.map((v) => (
          <button key={v} onClick={() => dispatch({ type: 'steal', victim: v })}>
            <span className="dot" style={{ background: game.players[v].color }} /> {game.players[v].name}
            <span className="muted"> · {totalCards(game.players[v].resources)} Karten</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ---------- Handel mit der Bank ----------

function BankTradePanel({ game, dispatch }: { game: GameState; dispatch: (a: Action) => void }) {
  const [give, setGive] = useState<Resource | null>(null);
  const [get, setGet] = useState<Resource | null>(null);
  const p = game.current;
  const res = game.players[p].resources;
  const ok = give && get && canBankTrade(game, give, get);

  return (
    <>
      <h3>Du gibst</h3>
      <div className="res-grid">
        {RESOURCES.map((r) => {
          const ratio = tradeRatio(game, p, r);
          return (
            <button
              key={r}
              className={`res-btn ${give === r ? 'active' : ''}`}
              disabled={res[r] < ratio}
              onClick={() => setGive(r)}
            >
              <ResIcon r={r} />
              <strong>{ratio}:1</strong>
              <span className="muted small">hast {res[r]}</span>
            </button>
          );
        })}
      </div>
      <h3>Du bekommst</h3>
      <div className="res-grid">
        {RESOURCES.map((r) => (
          <button
            key={r}
            className={`res-btn ${get === r ? 'active' : ''}`}
            disabled={r === give || game.bank[r] === 0}
            onClick={() => setGet(r)}
          >
            <ResIcon r={r} />
            <strong>1</strong>
            <span className="muted small">Bank {game.bank[r]}</span>
          </button>
        ))}
      </div>
      <button
        className="primary wide"
        disabled={!ok}
        onClick={() => {
          if (give && get) dispatch({ type: 'bankTrade', give, get });
          setGet(null);
        }}
      >
        {give && get
          ? `${tradeRatio(game, p, give)}× ${RESOURCE_STYLE[give].name} → 1× ${RESOURCE_STYLE[get].name}`
          : 'Rohstoffe wählen'}
      </button>
      <p className="muted small">Häfen verbessern deinen Kurs, wenn du dort einen Außenposten oder eine Station hast.</p>
    </>
  );
}

// ---------- Entwicklungskarten ----------

type Playable = Exclude<DevCardType, 'point'>;

export function DevCardsDialog({ game, dispatch, onClose }: { game: GameState; dispatch: (a: Action) => void; onClose: () => void }) {
  const p = game.current;
  const me = game.players[p];
  const [choosing, setChoosing] = useState<'plenty' | 'monopoly' | null>(null);
  const [plenty, setPlenty] = useState(emptyResources);

  const types: DevCardType[] = ['knight', 'routes', 'plenty', 'monopoly', 'point'];
  const counts = types
    .map((t) => ({
      t,
      ready: me.devCards.filter((c) => c.type === t && c.boughtTurn < game.turn).length,
      fresh: me.devCards.filter((c) => c.type === t && c.boughtTurn >= game.turn).length,
    }))
    .filter((c) => c.ready + c.fresh > 0);

  const play = (t: Playable) => {
    if (t === 'knight') dispatch({ type: 'playKnight' });
    else if (t === 'routes') dispatch({ type: 'playRoutes' });
    else return setChoosing(t);
    onClose();
  };

  if (choosing === 'plenty') {
    const picked = RESOURCES.flatMap((r) => Array<Resource>(plenty[r]).fill(r));
    return (
      <Sheet title="📦 Frachtfund: 2 Rohstoffe wählen" onClose={() => setChoosing(null)}>
        <Picker value={plenty} onChange={setPlenty} max={(r) => Math.min(2, game.bank[r])} total={2} />
        <button
          className="primary wide"
          disabled={picked.length !== 2}
          onClick={() => {
            dispatch({ type: 'playPlenty', resources: [picked[0], picked[1]] });
            onClose();
          }}
        >
          Nehmen
        </button>
      </Sheet>
    );
  }

  if (choosing === 'monopoly') {
    return (
      <Sheet title="💰 Monopol: Rohstoff wählen" onClose={() => setChoosing(null)}>
        <p className="muted">Alle Mitspieler geben dir sämtliche Karten dieses Rohstoffs.</p>
        <div className="res-grid">
          {RESOURCES.map((r) => (
            <button key={r} className="res-btn" onClick={() => { dispatch({ type: 'playMonopoly', resource: r }); onClose(); }}>
              <ResIcon r={r} />
              <span>{RESOURCE_STYLE[r].name}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Deine Entwicklungskarten" onClose={onClose}>
      <p className="muted small">
        Deine Siegpunkte: <strong>★ {victoryPoints(game, p)}</strong> (inkl. geheimer Artefakte) · Raumjäger gespielt: {me.knightsPlayed}
      </p>
      {counts.length === 0 && <p className="muted">Du hast noch keine Entwicklungskarten.</p>}
      <div className="dev-list">
        {counts.map(({ t, ready, fresh }) => {
          const info = DEV_CARD_INFO[t];
          return (
            <div key={t} className="dev-card">
              <span className="dev-icon">{info.icon}</span>
              <div className="dev-text">
                <strong>{info.name} ×{ready + fresh}</strong>
                <span className="muted small">{info.text}</span>
                {fresh > 0 && t !== 'point' && <span className="small fresh">{fresh} neu – ab nächstem Zug spielbar</span>}
              </div>
              {t !== 'point' && (
                <button className="primary" disabled={!canPlayDev(game, t)} onClick={() => play(t)}>Spielen</button>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted small">Pro Zug darfst du eine Entwicklungskarte spielen – den Raumjäger auch vor dem Würfeln.</p>
    </Sheet>
  );
}

// ---------- Handel: Tabs Mitspieler / Bank ----------

export function TradeDialog({ game, dispatch, onClose }: { game: GameState; dispatch: (a: Action) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'players' | 'bank'>('players');
  const p = game.current;
  const others = game.players.filter((pl) => pl.id !== p).map((pl) => pl.id);
  return (
    <Sheet title="Handel" onClose={onClose}>
      <div className="segmented tabs">
        <button className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>🤝 Mitspieler</button>
        <button className={tab === 'bank' ? 'active' : ''} onClick={() => setTab('bank')}>🏦 Bank & Häfen</button>
      </div>
      {tab === 'bank' ? (
        <BankTradePanel game={game} dispatch={dispatch} />
      ) : (
        <TradeComposer
          game={game}
          player={p}
          recipients={others}
          submitLabel="Angebot senden"
          disabled={!canProposeTrade(game)}
          onSubmit={(give, get, to) => dispatch({ type: 'proposeTrade', give, get, to: to ?? others })}
        />
      )}
    </Sheet>
  );
}

/** Kompakte Anzeige von Karten, z. B. „🪨🪨 ⚡“ */
export function CardsInline({ cards }: { cards: Partial<ResourceCount> }) {
  const items = RESOURCES.filter((r) => (cards[r] ?? 0) > 0);
  if (items.length === 0) return <span className="muted">nichts</span>;
  return (
    <span className="cards-inline">
      {items.map((r) => (
        <span key={r} className="chip" style={{ borderColor: RESOURCE_STYLE[r].color }}>
          {cards[r]}× {RESOURCE_STYLE[r].icon} {RESOURCE_STYLE[r].name}
        </span>
      ))}
    </span>
  );
}

/** Rohstoff-Auswahl als 5 kompakte Spalten mit ＋ / Wert / − */
function Stepper({ value, onChange, max, note }: {
  value: ResourceCount;
  onChange: (v: ResourceCount) => void;
  max: (r: Resource) => number;
  note?: (r: Resource) => string;
}) {
  return (
    <div className="stepper">
      {RESOURCES.map((r) => (
        <div key={r} className="stepper-col">
          <button disabled={value[r] >= max(r)} onClick={() => onChange({ ...value, [r]: value[r] + 1 })} aria-label={`${RESOURCE_STYLE[r].name} mehr`}>＋</button>
          <div className={`stepper-val ${value[r] > 0 ? 'on' : ''}`} style={{ borderColor: RESOURCE_STYLE[r].color }}>
            <span>{RESOURCE_STYLE[r].icon}</span>
            <strong>{value[r]}</strong>
          </div>
          <button disabled={value[r] === 0} onClick={() => onChange({ ...value, [r]: value[r] - 1 })} aria-label={`${RESOURCE_STYLE[r].name} weniger`}>−</button>
          {note && <span className="muted tiny">{note(r)}</span>}
        </div>
      ))}
    </div>
  );
}

/** Angebot oder Gegenangebot zusammenstellen. `player` ist der, der gibt. */
function TradeComposer({
  game, player, recipients, initialGive, initialGet, submitLabel, disabled, onSubmit,
}: {
  game: GameState;
  player: number;
  /** Auswählbare Empfänger (nur beim neuen Angebot) */
  recipients?: number[];
  initialGive?: Partial<ResourceCount>;
  initialGet?: Partial<ResourceCount>;
  submitLabel: string;
  disabled?: boolean;
  onSubmit: (give: Partial<ResourceCount>, get: Partial<ResourceCount>, to?: number[]) => void;
}) {
  const [give, setGive] = useState<ResourceCount>({ ...emptyResources(), ...initialGive });
  const [get, setGet] = useState<ResourceCount>({ ...emptyResources(), ...initialGet });
  const [to, setTo] = useState<number[]>(recipients ?? []);
  const res = game.players[player].resources;
  const ok = !disabled && validTradeSides(give, get) && hasCards(game, player, give) && (!recipients || to.length > 0);

  return (
    <div className="composer">
      <h3>Du gibst</h3>
      <Stepper value={give} onChange={setGive} max={(r) => (get[r] > 0 ? 0 : res[r])} note={(r) => `hast ${res[r]}`} />
      <h3>Du möchtest</h3>
      <Stepper value={get} onChange={setGet} max={(r) => (give[r] > 0 ? 0 : 9)} />
      {recipients && (
        <>
          <h3>An wen?</h3>
          <div className="recipients">
            {recipients.map((q) => {
              const on = to.includes(q);
              return (
                <button key={q} className={on ? 'active' : ''} onClick={() => setTo((t) => (on ? t.filter((x) => x !== q) : [...t, q]))}>
                  <span className="dot" style={{ background: game.players[q].color }} /> {game.players[q].name}
                  <span className="muted small"> · {totalCards(game.players[q].resources)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      <button className="primary wide" disabled={!ok} onClick={() => onSubmit(give, get, recipients ? to : undefined)}>
        {submitLabel}
      </button>
    </div>
  );
}

// ---------- Antwort eines Mitspielers ----------

export function TradeRespondDialog({ game, offer, player, dispatch }: {
  game: GameState; offer: TradeOffer; player: number; dispatch: (a: Action) => void;
}) {
  const [countering, setCountering] = useState(false);
  const from = game.players[offer.from];
  const canAccept = hasCards(game, player, offer.get);
  const respond = (response: TradeResponse) => dispatch({ type: 'respondTrade', player, response });

  if (countering) {
    return (
      <Sheet title={`Gegenangebot an ${from.name}`} onClose={() => setCountering(false)}>
        <TradeComposer
          game={game}
          player={player}
          initialGive={offer.get}
          initialGet={offer.give}
          submitLabel="Gegenangebot senden"
          onSubmit={(give, get) => respond({ type: 'counter', give, get })}
        />
      </Sheet>
    );
  }

  return (
    <Sheet title={`Angebot von ${from.name}`}>
      <div className="offer-box">
        <div><span className="muted">Du bekommst</span><CardsInline cards={offer.give} /></div>
        <div><span className="muted">Du gibst</span><CardsInline cards={offer.get} /></div>
      </div>
      <p className="small own-cards"><span className="muted">Deine Karten:</span> <CardsInline cards={game.players[player].resources} /></p>
      {!canAccept && <p className="error small">Dafür hast du nicht genug Karten.</p>}
      <div className="respond-actions">
        <button className="primary" disabled={!canAccept} onClick={() => respond({ type: 'accept' })}>Annehmen</button>
        <button onClick={() => setCountering(true)}>Gegenangebot</button>
        <button onClick={() => respond({ type: 'decline' })}>Ablehnen</button>
      </div>
    </Sheet>
  );
}

// ---------- Ergebnis für den Anbietenden ----------

export function TradeResultDialog({ game, offer, dispatch }: { game: GameState; offer: TradeOffer; dispatch: (a: Action) => void }) {
  const p = offer.from;
  return (
    <Sheet title="Antworten auf dein Angebot">
      <div className="offer-box">
        <div><span className="muted">Du gibst</span><CardsInline cards={offer.give} /></div>
        <div><span className="muted">Du möchtest</span><CardsInline cards={offer.get} /></div>
      </div>
      <p className="small own-cards"><span className="muted">Deine Karten:</span> <CardsInline cards={game.players[p].resources} /></p>
      <div className="choice-list">
        {offer.responses.map((r, q) => {
          if (!r) return null;
          const pl = game.players[q];
          return (
            <div key={q} className="response-row">
              <span className="dot" style={{ background: pl.color }} />
              <div className="response-text">
                <strong>{pl.name}</strong>
                {r.type === 'accept' && <span className="ok">nimmt an</span>}
                {r.type === 'decline' && <span className="muted">lehnt ab</span>}
                {r.type === 'counter' && (
                  <span className="small">
                    Gegenangebot: gibt <CardsInline cards={r.give} /> für <CardsInline cards={r.get} />
                  </span>
                )}
              </div>
              {r.type !== 'decline' && (
                <button
                  className="primary"
                  disabled={r.type === 'counter' && !hasCards(game, p, r.get)}
                  onClick={() => dispatch({ type: 'completeTrade', with: q })}
                >
                  Handeln
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button className="wide" onClick={() => dispatch({ type: 'cancelTrade' })}>
        {offer.responses.some((r) => r && r.type !== 'decline') ? 'Doch nicht handeln' : 'Schließen'}
      </button>
    </Sheet>
  );
}
