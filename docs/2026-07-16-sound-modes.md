# Decision — sound modes: pings, surf/air bed, generative music, sound FAB (#145, #255)

2026-07-16. Implements #145 as redefined on 2026-07-15: **geiger mode is
dropped**; the guiding rule is that sound is **always real** — every
information-carrying sound corresponds to an actual event (a zero-hop reception
or an outgoing ping), never synthesized ticking. A soundbed/music layer is
allowed because it carries no information. Also folds in #255 (decided the same
day, before #145 shipped): the FAB collapses to **three** states instead of
four — ambient and music never needed to be reachable separately in practice.

## The three states (sound FAB, cycled)

- **off** (default) — silent.
- **rxtx** — one morse dit per **real zero-hop reception** in the active
  filter set, plus the transmit cues (below). No bed, no music.
- **full** — the surf/air soundbed + generative ambient music (below), with
  the same rx/tx sounds on top.

A FAB (below the 2D/3D toggle) cycles the states, icon shows the current mode,
accent ring while sound is on — same conventions as the layer/discover FABs.
The FAB tap doubles as the user gesture Web Audio requires. Mode persists in
localStorage (like the attenuator, key `core-hunter-sound`); on a later visit
the suspended context resumes on the first tap anywhere. Values from the brief
4-state period before #255 (`ping`/`ambient`/`music` — a couple of days of
dogfooding only, never released) migrate onto the 3-state set on load
(`ping`→`rxtx`, `ambient`/`music`→`full`).

## Sound design — chosen by ear in a live A/B lab

Iterated with Kasper in a throwaway lab page (reference: messenger.abeto.co —
warm, rounded, nothing beepy; later Artlist ambient albums for the music
direction). Auditioned: sonar drops, water drops, bubble pops, chimes, bells,
harp, kalimba, damped pluck, woodblock, soft tick; surf/air vs. zen-pad,
singing-bowl and sampled-ambiance beds; real music tracks vs. generative.

- **RX ping = morse dit on the F harmonic series** (round-6 winner from four
  finalists: morse-pentatonic, morse-harmonic, sonar-echo-return,
  sonar-harmonic). A tight CW dit — 4 ms attack, 35..95 ms hold, 12 ms
  release — whose pitch is quantized to consonant overtones of F2
  (harmonics 4 5 6 8 9 10 12 → F4 A4 C5 F5 G5 A5 C6). The generative music
  plays in F-pentatonic, and overtones of F cannot clash with it — that fixes
  what killed the round-2 kalimba, which was tuned to G against music in F.
  Same fixed dBm band as the HUD bar (−115..−75, calibration/attenuator offset
  applied): hotter = higher harmonic, longer dit, louder. Voices auditioned on
  the way here: sonar drops, water drops, bubble pops, chimes, bells, harp,
  kalimba, damped pluck, woodblock, ticks, claves, telegraph, sonar family,
  cloud/soft family.
- **TX cues** (the #232/#233 addendum) — bubble pops with a fast upward pitch
  flick: two rising pops for the auto-discover broadcast, one higher pop per
  repeater trace-ping. The audio twin of the Discover FAB's visual pulse.
  Mnemonic: *dit = heard, rising pop = sent*.
- **Ambient bed = surf/air noise layers** (brown + pink noise, slow independent
  LFO swells).
- **Music = Eno-style generative ambient** (option B; licensed-music streaming
  was considered and rejected — a public repo can't ship Artlist tracks, and
  streaming breaks offline field use). Seven soft pad voices, each looping one
  note of a calm F-pentatonic set (F3 G3 A3 C4 D4 F4 A4) on **mutually prime
  periods** (19…47 s ÷ 1.8 density) — the combination never repeats (the
  *Music for Airports* technique). Slow swells, unison detune, per-voice stereo
  position, lowpassed. Zero assets, works offline.
- **Final mix (dialed in by ear, lab round 6):** rx dits at **50%** of their
  natural level (independent of the bed/music), music **86%** at **1.7×**
  density, reverb **wet 35% / decay 2.8 s** on pings, tx cues, and music.
- Mix constants live at the top of `sound.js` (`REVERB_*`, `MUSIC_*`, `RX_GAIN`).

## Behaviour choices

- Pings follow the **filtered/plotted set** plus `hops === 0` — you hear what
  the map shows, minus relayed traffic (a relayed packet's RSSI describes the
  last repeater, not the target). With a target selected this is the old
  "target-ping" behaviour.
- The FAB is the only control — no Settings entry.
- Bursts are coalesced with a 60 ms minimum gap between pings.
- Everything is Web Audio synthesis — no audio assets shipped.
- iOS/Bluefy: the ring/silent hardware switch mutes Web Audio; nothing we can
  detect or work around from the page.
