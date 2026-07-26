# core-hunter — app + web samenvoegen? (BESLIST: B nu, A als richting)

> Datum: 2026-07-12. **Status: BESLIST (Kasper, 2026-07-12).**
> Aanleiding: de backlog van "web viewer: parity met app"-issues (#223, #224, #225, en eerder #170,
> #214) laat een patroon zien — features worden twee keer gebouwd, in twee losse codebases, en de
> logica die wél gedeeld zou moeten zijn wordt met de hand gesynchroniseerd in plaats van echt gedeeld.
> Dit document zet de feiten op een rij en schetst opties.

## Beslissing (Kasper, 2026-07-12)

> "B for now, with A as specific target but based on a manual switch mode, between 'on-the-go' mode
> and analysis"

- **Nu: optie B.** Extraheer de bewezen duplicatie (`signal.js`, `locate.js`, de kern van
  `names.js`/`filters.js`, `hexgrid.js`) naar een gedeelde module. Laagste risico, pakt de acute
  silent-drift-pijn (`names.js` wordt al met de hand "mirrored") direct aan.
- **Richting: optie A**, specifiek uitgewerkt als een **handmatige modus-schakelaar** tussen
  **"on-the-go"** (huidige `app/`-functionaliteit: live BLE/GPS/MQTT-publish, veldgebruik) en
  **"analyse"** (huidige `web/`-functionaliteit: historisch, multi-hunter, rollen/auth). Geen
  automatische modusdetectie — de gebruiker kiest expliciet.
- B is de eerste stap naar A: pas als de gedeelde kern bestaat wordt duidelijk hoeveel UI/logica er
  nog echt samengevoegd moet worden voor de modus-schakelaar.

## Aanleiding (Kasper, 2026-07-12)

> "essentially it is the same thing, done twice"

Drie samenhangende pijnpunten:
1. **Dubbel werk voor parity** — elke feature in `app/` die ook op `web/` moet, is een aparte
   herbouw-taak (en andersom: `web/`'s auth/rollen-systeem bestaat niet in `app/`).
2. **Gefragmenteerde UX** — gebruikers moeten weten of ze de installable pwa of de browser-dashboard
   nodig hebben voor wat in hun hoofd één product is.
3. **Dubbele deploy/ops-overhead** — twee frontends, twee build/deploy-paden, ongeacht featureparity.

## Huidige situatie (feiten)

### `app/` — mobiele hunter-pwa

- **Stack**: geen framework, vanilla ES modules; **Vite 5.4** build; **MapLibre GL 4.7.1** (CDN,
  sinds #214/#147 — recente migratie). Gebundeld: ~577 KB (~181 KB gzipped).
- **Unieke capabilities**: live BLE companion-verbinding (`transport.js`, `frames.js`, `selfinfo.js`),
  live GPS-tracking (`gps.js`), MQTT-publish (`publisher.js`), compass mode (`rotation.js`), Discover
  FAB (`discover.js`), target list (`targetlist.js`), reception-ticker (`receptionlog.js`),
  offline-first IndexedDB capture-buffer (`queue.js` — data blijft lokaal bruikbaar zonder mobiel
  netwerk).
- **Deploy**: Docker + nginx; `config.json` runtime-fetched (niet gebakken in de bundle); echte
  PWA-manifest + service worker (die bewust **niets** cachet — "offline resilience lives in the app,
  not here", alle assets zijn hashed en forever-cached, alleen index.html/sw.js/manifest/config.json
  zijn no-cache).
- **Datamodel**: **live/sessie-only, geen historische query.** `app/` is een *producer*, nooit een
  *consumer* van het receptions-dataset — het roept nooit `/api/points` of iets historisch aan.
- **Omvang**: 3.544 regels source (33 bestanden) + 1.409 regels tests. 129 commits sinds 2026-06-29
  (project is 2 weken oud).

### `web/` — browser analyse-dashboard

- **Stack**: **geen build-stap, geen bundler** — rauwe ES modules rechtstreeks naar de browser;
  **Leaflet 1.9.4** (CDN).
- **Unieke capabilities**: historische/multi-hunter analyse met bbox+datum-filters, volledig
  account/rollen-systeem (guest/member/admin — `auth.js`, `admin.js`, `reset.js`, audit-log),
  shareable/persistente URL-state (`urlstate.js` — elke UI-instelling in querystring én localStorage),
  publieke landingpagina (`web/landing/`).
- **Deploy**: statische bestanden via nginx op `map.on8ar.eu`, `/api/*` geproxied naar dezelfde Go
  `server/`. Ook installable als pwa (manifest, **bewust geen** service worker — "online analysis
  tool that always needs the server/API").
- **Datamodel**: **volledig query-driven.** `fetchPointsPaged` pagineert `/api/points`; geen lokale
  opslag, elke view is een verse server-roundtrip.
- **Omvang**: 1.981 regels source (24 bestanden, inclusief tests) + losse Playwright e2e-suite.
  52 commits sinds 2026-06-30 — **~2,5× minder commit-volume dan `app/`** in dezelfde periode.

### Wat al gedeeld hoort te zijn, maar het niet is

Beide praten met dezelfde Go-backend (`server/`), maar delen **geen code** — er is geen `shared/`
directory, geen symlinks. Concreet gevonden:

- `app/src/signal.js` ↔ `web/signal.js`: **byte-voor-byte identiek** (rssiTier, snrTier,
  tierColorVar, fillOpacity).
- `app/src/locate.js` ↔ `web/locate.js`: **functioneel identiek** (222 regels beide, hele
  RSSI-locate-centroid-algoritme gedupliceerd).
- `app/src/names.js` ↔ `web/names.js`: zelfde concept, bewust met de hand gesynchroniseerd — de
  docstring in `app/src/names.js:24` zegt letterlijk *"Mirrors the analysis website's gate
  (web/names.js)"*. Dit is precies het "silent drift"-risico: het werkt vandaag omdat iemand het
  onthouden heeft, niet omdat het gegarandeerd is.
- Hex-grid binning: bewust **wél** eenmalig opgelost — server-side in Go (`server/internal/geo/`)
  i.p.v. dubbel in JS. Bewijs dat "dedupliceren via de server" al een bekend patroon is hier.

### Wat de oorspronkelijke bedoeling al was

Het ontwerpdocument van `web/` zelf (`docs/superpowers/specs/2026-06-30-analysis-website-design.md`,
beslissing #7) zegt: *"Reuse the mobile hunter's map (signal.js, hexgrid.js, points/hex rendering,
tile providers) adapted to consume API rows instead of the IndexedDB snapshot."* — **hergebruik was
altijd al het plan.** Het is alleen nooit echt gedeelde code geworden; de twee zijn sindsdien uit
elkaar gegroeid (hex-logica verhuisde naar Go, MapLibre-migratie raakte alleen `app/`, de rest werd
met de hand gemirrored).

`AGENTS.md` (het contributor-guide) beschrijft `app/` en `server/` uitgebreid maar **noemt `web/`
nergens** — ook een signaal dat de tweede frontend organisch is ontstaan, niet met opzet apart
gehouden.

## Het verschil dat blijft bestaan, ongeacht de keuze

`app/` en `web/` doen vandaag structureel verschillende dingen, niet toevallig:

- `app/` = **live producer**: BLE + GPS + MQTT-publish, sessie-geheugen, installable voor veldgebruik
  zonder netwerk.
- `web/` = **historische consumer**: multi-hunter, rollen/auth/admin, query-gedreven, altijd
  online-only.

Elke samenvoeg-optie moet hiermee rekening houden — het is geen kwestie van "plak de twee UI's aan
elkaar", de onderliggende data-modellen (live-stream vs. query-driven) zijn fundamenteel anders.

## Opties

### A — Eén app, live/analyse als modus binnen één shell
Eén codebase, één deploy; "Live hunten" en "Analyse" worden views/tabs die gedeelde map-/filter-/
datalaag-code hergebruiken.
- **Voordeel**: lost alle drie de pijnpunten in één keer op — geen dubbel werk meer, één PWA-verhaal,
  één deploy.
- **Nadeel**: grote migratie. Kies MapLibre óf Leaflet (waarschijnlijk MapLibre, gezien recent werk);
  de live-only architectuur moet uitgebreid worden met een query-gedreven analyselaag; het
  rollen/auth-systeem (guest/member/admin) bestaat alleen in `web/` en moet mee; een installable
  live-hunt-app die óók multi-user-analyse+admin herbergt is een ongebruikelijke combinatie voor wie
   'm enkel wil installeren om te hunten.

### B — Gedeelde core-library, twee entry points
Extraheer de bewezen duplicatie (`signal.js`, `locate.js`, de kern van `names.js`/`filters.js`,
`hexgrid.js`) naar een gedeelde module die beide importeren; `app/` en `web/` blijven losse
deploys/entry points.
- **Voordeel**: lost het "hand-mirrored, silent drift"-probleem meteen op, kleine/incrementele
  migratie, laag risico, sluit aan bij wat het ontwerp altijd al bedoelde.
- **Nadeel**: lost de "elke UI-feature moet twee keer gebouwd worden"-pijn niet volledig op voor
  UI-componenten (target-list, reception-ticker zijn UI, geen pure logica) — die blijven apart tenzij
  er ook UI-componenten gedeeld worden.

### C — `web/` gaat op in de `app/`-pwa
Analysefunctionaliteit wordt onderdeel van de installable app; de aparte site verdwijnt.
- **Voordeel**: echt één ding.
- **Nadeel**: een installable live-hunt-pwa die ook een publieke marketing/analyse-site met
  gast-toegang moet zijn is architectuur-technisch ongebruikelijk (SEO/publieke landingpagina +
  installable-app-model passen niet vanzelfsprekend samen).

### D — `app/` wordt een modus binnen `web/`
`web/` wordt de ene shell (heeft al auth/rollen/publieke landingpagina); "live hunten" wordt een tab
die BLE/GPS/MQTT-publish erbij haalt voor ingelogde hunters.
- **Voordeel**: past beter bij "één publiek product met een live-modus voor wie inlogt" — `web/` heeft
  al het rollen-/multi-user-fundament.
- **Nadeel**: pwa-installability/offline-first voor de live-modus wordt lastiger als het geen
  top-level installable app meer is (browsers installeren op basis van de root-manifest/service-worker
  van de site) — moet uitgezocht worden of veldgebruik zonder netwerk zo behouden blijft.

## Wat sowieso helpt, ongeacht de uiteindelijke keuze

Dedupliceer nu al de bewezen 1-op-1-duplicatie (`signal.js` is letterlijk identiek, `locate.js` is
functioneel identiek, `names.js` is bewust hand-gemirrored). Dat is een kleine, laag-risico eerste
stap die in **elke** uitkomst nuttig blijft en het meest acute silent-drift-risico meteen wegneemt.

## Open vragen om samen te beantwoorden

1. Moet "live hunten" op termijn zonder installable pwa kunnen (browser-only), of blijft
   installability een harde eis?
2. Moeten gasten/niet-ingelogde gebruikers ooit toegang krijgen tot de live-hunt-modus, of blijft dat
   altijd account-only zoals nu in `app/`?
3. Moet admin-functionaliteit (user management, audit-log) op termijn ook vanuit de live-app bereikbaar
   zijn, of blijft dat een web-only ding?
4. Tijdsdruk: is dit iets voor nu (blokkeert het de lopende #223–#237-batch?), of een losstaand traject
   ernaast?

## Redenering achter de beslissing

Gegeven dat hergebruik altijd al de bedoeling was (zie ontwerpdoc) en dat de acute pijn vooral zit in
stilzwijgende drift van al-identieke logica, was **optie B** de laagste-risico eerste stap die het
gemelde probleem het meest direct aanpakt zonder meteen een grote architecturale gok te wagen op
live-vs-analyse-samenvoeging — zie "Beslissing" bovenaan. Opties C en D zijn met deze beslissing van
tafel.
