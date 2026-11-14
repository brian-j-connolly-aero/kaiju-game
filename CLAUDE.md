# Monster Battle 9001

Asymmetric browser party game: one kaiju wrecks a city, four army squads try to stop it.
Server-authoritative multiplayer, self-hosted on one PC behind a Cloudflare Tunnel.

## Read first

- `docs/requirements.md`: the owner's design doc. Source of truth for intent and tone.
- `docs/ROADMAP.md`: the owner's latest decisions and the current work plan. Newer than
  `docs/DESIGN.md` where the two disagree.
- `docs/DESIGN.md`: concrete rules and numbers.
- `docs/ARCHITECTURE.md`: stack, layout, contracts, quality gates.
- `docs/ASSETS.md`: art and audio contract (names, formats, manifests).

## Ground rules for everyone working here

- Stay inside the files and folders your task owns. If you must touch a shared contract
  (`shared/src/net`, `shared/src/sim/events.ts`, defs schemas, manifests), make the smallest
  additive change and update the docs in the same change.
- Do not run `git commit`, `git push`, `git stash`, `git checkout` or `git reset` unless your
  task says to. Other people are working in this same tree at the same time; the coordinator
  commits.
- `npm run check` must pass before you call code work done. Never skip, delete or weaken a test
  to get there. Report failures honestly.
- Library versions are newer than you may remember. Check the installed package's types and
  README in `node_modules` before using an API from memory.
- The game must run fully offline: no runtime calls to outside services, no CDN links.
- No-reading rule: in-game text is only names and subtitles. Everything else is pictures.
- Tone: absurd world, played completely straight. For the Coalition of Faiths the joke is
  earnest teamwork and absurd firepower, never any faith; all clergy are fictional.
- Spell out acronyms on first use in anything a person will read (docs, slides, reports).
- Never put model or tool vendor names in code, comments or assets. Commit messages carry only
  the attribution trailer the coordinator supplies.
- The project owner is non-technical. Anything written for them is plain language.

## Machine notes

- Only 4 CPU cores, shared with other workers. Do not leave servers, watchers or browsers
  running when you finish. Use distinct ports for anything you start (pick a random high port)
  and kill it afterwards.
- Asset tools: `/opt/mbtools/venv/bin/python` has Blender (`bpy`), numpy, scipy, pillow, mido,
  soundfile, pedalboard, pocketsphinx. `fluidsynth`, `sox`, `ffmpeg`, `RHVoice-test`, `flite`,
  `pico2wave`, `festival`, `espeak-ng` are installed. If they are missing (fresh machine), run
  `tools/setup-asset-tools.sh`.
- Headless browser: Chromium and Playwright are pre-installed (`require('playwright')` from any
  directory). Never run `playwright install`.
- Scratch files go in `/tmp/mb-scratch/<your-task>/`, never in the repo.
- Blender renders: cap Cycles at 2 threads and low sample counts; previews should take seconds.
