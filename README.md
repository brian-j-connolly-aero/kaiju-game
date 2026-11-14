# Monster Battle 9001

A party game for five people in the web browser. One player is Gragnor, a giant monster that
hatches in the harbour city of Port Meridian and tries to flatten it; the other four lead army
squads that try to stop it before the night is over. A match is three stages, about eight
minutes (ten at most). Empty seats are played by the computer.

The game runs on one computer (the host's). Friends join from their own browsers through a
link; they install nothing. The game never contacts any outside service while it runs.

## Hosting a game

Read **[docs/HOSTING.md](docs/HOSTING.md)**. In short: install Podman Desktop or Docker
Desktop, then double-click `host/start.cmd` (Windows) or run `host/start.sh` (Linux, WSL:
Windows Subsystem for Linux). It builds the game the first time, starts it and shows the link
to send. `host/stop.cmd` or `host/stop.sh` stops it.

## Playing

Send your friends **[docs/PLAYING.md](docs/PLAYING.md)**: what the game is, how to join, the
controls and tips for both sides. In the game, H opens the controls card.

## For developers

- `docs/requirements.md`: the owner's design brief. `docs/ROADMAP.md`: the owner's decisions
  after the first multiplayer playtest, and the work planned from them (newer than the brief).
  `docs/DESIGN.md`: rules and numbers.
- `docs/ARCHITECTURE.md`: how the code is laid out. `docs/ASSETS.md`: the art and sound contract.
- `docs/STATUS.md`: what is built, what was tested, what is still open.

With Node.js 22: `npm ci` once, then `npm run dev` (development server with live reload),
`npm run check` (type checks, lint rules and all tests; must pass before any change is done),
`npm run build` and `npm run host` (build and serve on http://localhost:2567).
