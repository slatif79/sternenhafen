# ✦ Sternenhafen

Ein Rohstoff- und Handelsspiel im Weltraum für 2–4 Spieler – im Browser, am Handy per Touch, allein gegen Computergegner oder mit mehreren Menschen an einem Gerät.

**Spielen:** https://slatif79.github.io/sternenhafen/

## Spielprinzip

Baue Raumrouten, Außenposten und Stationen auf einem zufälligen Sternenfeld aus Asteroiden, Eisfeldern, Kristallnebeln, Biokuppeln und Gaswolken. Würfle um Rohstoffe, handle mit Bank, Häfen und Mitspielern, nutze Entwicklungskarten und weiche dem Piratenschiff aus. Wer zuerst 10 Siegpunkte hat, gewinnt. Die vollständigen Regeln gibt es im Spiel unter „?“.

- 2–4 Spieler, beliebig gemischt aus Menschen und KI (Leicht / Mittel / Schwer)
- Mehrere Menschen spielen abwechselnd an einem Gerät (mit Übergabe-Bildschirm)
- Spielerhandel mit Angeboten, Gegenangeboten und Annahme
- Läuft komplett im Browser, kein Server nötig

## Entwicklung

```bash
npm install
npm run dev      # Entwicklungsserver
npm test         # Regel- und KI-Tests (Vitest)
npm run build    # statischer Build nach dist/
```

Aufbau:

- `src/engine/` – Spiellogik ohne UI: Brett & Topologie, Regeln (`game.ts`, rein funktional über `applyAction`), Computergegner (`ai.ts`)
- `src/ui/` – React-Oberfläche (SVG-Brett mit Zoom/Pan, Dialoge, Startbildschirm)

Jeder Push auf `main` wird per GitHub Actions getestet, gebaut und auf GitHub Pages veröffentlicht.
