# Audio pipeline: how every sound gets made

Every sound in Monster Battle 9001 (music, sound effects, voice lines) is generated from source
code in this folder. Nothing is recorded or downloaded. Each family has its own builder; one
script runs all three. The contract the files must meet (names, formats, manifests) is
`docs/ASSETS.md` sections 6 and 7; what each family sounds like and how the game should play it
is in `docs/audio/MUSIC.md`, `docs/audio/SFX.md` and `docs/audio/VOICE.md`.

```
tools/audio/
  build_all.sh         rebuild every sound with one command, then merge the manifests
  music/build.sh       score (Python) -> MIDI -> fluidsynth -> mix and master -> .ogg + .mp3
  music/mbmusic/       the score, the instruments, the mixdown and the measurements; arcade.py
                       holds the writing tools of the fast match tracks (round 4)
  sfx/build.sh         synthesis (numpy, scipy) -> master -> .ogg + .mp3, docs/audio/SFX.md
  sfx/mbsfx/           one Python function per sound, grouped by family (moves.py, army.py and
                       city.py hold the sounds of phases 1 to 3)
  voice/build.sh       offline speech synthesis -> radio / broadcast / hall chain -> .ogg + .mp3,
                       docs/audio/VOICE.md, docs/VOICE_SCRIPT.md
  voice/cast.json      who speaks with which synthesizer voice and processing chain; the lines
                       themselves are shared/src/defs/voiceLines.json (the monster's molt line)
                       and the communication rose's, client/src/audio/roseLines.json
  voice/pronounce.json respellings fed to the synthesizer (subtitles never change)
  voice/build_state.json  what each line was last built from (for rebuilding only what changed)
  voice/tryline.py     try a wording in a voice before it goes into the script
```

## 1. Rebuild everything

```bash
npm install                        # once, for the manifest merge
tools/setup-asset-tools.sh         # once per machine, if /opt/mbtools/venv or fluidsynth is missing
tools/audio/build_all.sh
```

That runs, one after the other: the music builder, the sound effect builder, the voice builder
(every line rebuilt) and `npm run assets:manifest`. It prints a summary with the time each step
took and ends with exit status 0 only if every step succeeded; a failed step is named and the
status is 1. On a 4-core machine with 2 cores given to it the whole run took about 12 to 13
minutes (music about 4, effects about 2, voice about 6) before round 4; the longer match tracks of
round 4 add about 3 minutes to the music from an empty cache (the four of them alone take about
5 minutes; estimated, not timed as part of a full run).

Useful options (`tools/audio/build_all.sh --help` lists them all):

| Option | What it does |
| --- | --- |
| `--only sfx,voice` | build only these families (`music`, `sfx`, `voice`); the manifest merge always runs |
| `--changed` | voice: only the lines whose words, voice or processing changed |
| `--no-verify` | skip the measurements, pictures and generated documents (faster, for trying things) |
| `--clean` | throw away the music's cached instrument renders so every note is rendered again |
| `--jobs N` | cores the build may use (default 2); the whole run is pinned to that many cores |
| `--list` | print the commands it would run, and stop |

Environment variables: `MB_SCRATCH_ROOT` (where intermediate files go, default
`/tmp/mb-scratch`), `MB_AUDIO_CPUS` (which cores to pin to, for example `2,3`), `MB_PYTHON`
(default `/opt/mbtools/venv/bin/python`).

## 2. Where things go

- **Committed:** the generator sources in this folder, the encoded files in
  `client/public/assets/audio/{music,sfx,voice}/` (each sound as `.ogg` and `.mp3`), the partial
  manifests `client/public/assets/manifest.{music,sfx,voice}.json`, the merged
  `manifest.json`, and the generated documents and pictures under `docs/audio/`.
- **Never committed:** MIDI files, WAV masters, logs. They go under `/tmp/mb-scratch`:
  `music/` and `voice/` under `MB_SCRATCH_ROOT`, `sfx/` always at `/tmp/mb-scratch/sfx`, and the
  log of each step at `$MB_SCRATCH_ROOT/audio-build/<step>.log`.
- **Disk:** the music keeps its rendered instrument parts in `$MB_SCRATCH_ROOT/music/parts`
  between runs (about 15 GB), so that a rebuild only renders what changed. `--clean` empties it.

## 3. Reproducible

From unchanged sources a full rebuild gives back every `.ogg` and `.mp3` byte for byte, and the
same manifests and documents (checked on 726 files, November 2026; and on the sound effects
again after phase 3 added 38 sounds: none of the older files changed by a byte). The encoders are run with
fixed settings and the synthesis uses fixed random seeds. At the end of a run the script says
how many files differ from the last commit; after a rebuild with no source change that number
should be 0. If it is not, something in the tools changed (an ffmpeg or fluidsynth upgrade, for
example): decode both versions and compare the samples before trusting the new files.

## 4. Changing one sound

Use the family's own builder; it takes the ids to rebuild and checks its own output:

```bash
tools/audio/music/build.sh stage2 final_minute  # these cues only (each cue keeps its own tempo)
tools/audio/sfx/build.sh 'kaiju_roar*'          # sounds whose id matches
tools/audio/voice/build.sh 'v_nerve_break_*'    # lines whose id matches (only if changed)
npm run assets:manifest                         # then merge the manifests
```

Each builder measures what it built (loudness, peaks, loop seams, lengths against the manifest)
and fails if a file breaks the rules in its document. Then run `npm run check`.

## 5. Things to know

- The music builder always starts three synthesizer processes at a time; `build_all.sh` pins
  the whole run to `--jobs` cores, so they share those cores instead of taking a third.
- The voice builder remembers the measurements of a line for as long as its words, voice and
  processing stay the same. `build_all.sh` sets them aside for a full build so that every line
  is measured again, and puts them back if the voice step stops early.
- `ffmpeg`'s Vorbis decoder returns a few short `.ogg` files 1024 samples (23 ms) too long;
  browsers return the exact length. Only silence is affected. The lengths in the sound effect
  table of `docs/audio/SFX.md` are measured with `ffmpeg`, so a few of them (`radio_close`,
  `ui_ready`, `ui_hover`) read about 23 ms long.
- The game must run offline: no builder fetches anything at build time either, apart from the
  one-time setup script.
- The voice script is two files (since round 4). `shared/src/defs/voiceLines.json` holds the
  simulation's cue lines, of which only the news telling the monster it can molt is left (the
  audio tools only read it); `client/src/audio/roseLines.json` holds the communication rose's
  army lines, per wedge, and the squad voices that speak them: every line is built in every
  voice, as `rose_<voice>_<wedge>_<n>`. The voice builder checks, builds, measures and documents
  both together, and a line id must be unique across the two. A later voice pass (a commercial
  voice service) can rebuild every file from the same two files. The monster's rose noises are
  sound effects (`sfx/mbsfx/rose.py`, `kaiju_rose_*`).
- The music's intonation table (`music/mbmusic/tuning_table.json`) is measured once per
  instrument. After adding an instrument to `music/mbmusic/orchestra.py`, run
  `/opt/mbtools/venv/bin/python tools/audio/music/build.py --measure-tuning-new`: it measures
  only the new ones, so every older cue stays byte for byte the same.
- Sound effects whose variants are not interchangeable: `kaiju_stumble_s1..s3`, whose three
  variants are the three stumble looks, in order. Every other sound's variants are picked at
  random by the game.
