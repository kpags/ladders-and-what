Original prompt: Add game-mode selection to the lobby from data/game_modes.json, filter boards by mode with an empty state, and implement standard, run_away, and guess_what rules including Desert.

## Progress

- Inspected the Vue lobby, authoritative WebSocket server, board data, and shared game rules.
- Confirmed Desert is tagged `run_away`; no board currently belongs to `guess_what`.
- Implementation decision: run-away explosions advance upward from square 1, destroying the next 3-6 intact spaces every randomized 7-9 player actions.
- Implementation decision: guess-what question spaces are randomized at game creation and remain visually hidden.
- Added synchronized game-mode selection, mode-filtered board carousel, descriptions, and the no-board/start-disabled state.
- Added run-away explosion state, elimination/spectator handling, charcoal board overlays, and future-ready guess-what randomization.
- Added synchronized explosion warning/explosion/death audio and a full-screen destruction notice.
- Production build passes.
- Browser QA passed for Standard, Run Away/Desert, Guess WHAT empty state, disabled Start behavior, AI addition, and starting Desert gameplay.
- Targeted rules QA passed for 3-6 sequential destroyed squares, occupant elimination, spectator state, and skipping eliminated turns.
- Refined Run Away penalties to retain position and add 30 seconds of skill cooldown, with explicit overlay/log text.
- Centered Desert tokens on exact 10x10 cell centers.
- Changed destruction into a server-synchronized warning and one-square-at-a-time sequence with caught-player pauses.
- Destroyed-square fills now preserve grid outlines; movement stops and eliminates on the first destroyed square traversed.
- Added bounded transparent-composited explosion GIF effects and distinct warning, explosion, death, and safe audio cues.
- Browser QA verified token centers, live timeout penalty copy, warning/caught overlays, dark cell geometry, and GIF sizing/transparency.
- Production build, syntax checks, targeted rule checks, and bundled web-game runner pass.
- Tightened destruction ordering: the three-second warning always clears first, then one GIF plays before one square darkens every 0.50 seconds.
- Stabilized mobile character taps and prevented Play Now from replacing an active room.
- Added a local name-edit draft so lobby broadcasts do not overwrite text while typing.
- Added host-only human player kick controls and authoritative server removal.
- Shortened Run Away destruction scheduling to a random 3-5 completed turns.
- Two-client mobile QA confirmed room/host retention, stable in-progress name editing, host kick behavior, and the kick control layout.
- Production build, syntax checks, 100 randomized interval checks, and bundled web-game smoke test pass.
- Replaced per-player action destruction scheduling with the HUD's global turn counter (`nextExplosionTurn`).
- Added a non-overlapping 1-second pause after each completed darkening/caught-player sequence before the next square.
- Rule QA confirmed both 2-player (4 actions) and 6-player (12 actions) games trigger at the same HUD Turn 3 threshold.
- Verified normal rolls, penalties, and skill-ended turns use the global threshold without duplicate same-turn destruction.
- Production build, syntax checks, diff checks, and bundled browser smoke test pass.
- Split final Run Away outcomes: the sole survivor of universal destruction wins, while the sole player left after all others reach 100 loses.
- Added an explicit `winner`/`won` state so the HUD, player list, and outcome audio distinguish last-standing victories from finish rankings.
- Rule QA passed for destruction-only winner, all-but-one-finished loser, and mixed-state continuation.
- Browser QA confirmed the “Game over · Winner” banner and “Winner · Last standing” player status.
- Added Run Away dual 1-4 dice, one-button/manual-or-3-second-auto stop, and a server-authoritative 2-second spinning +/- operator phase.
- Added signed forward/backward/stay movement results and zero-result protection against replaying stale landing effects.
- Increased each destruction wave from 3-6 squares to 4-7.
- Added a three-second post-game R.I.P memorial listing eliminated players; no memorial is emitted when nobody was caught.
- Browser QA verified rolling, locked dice/operator spin, final equation/direction messaging, auto-stop timing, and memorial layout.

## TODO

- None for the requested scope.
