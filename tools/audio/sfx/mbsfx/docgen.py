"""Writes docs/audio/SFX.md from the registry and the measurements (so the table never drifts)."""
from __future__ import annotations

from . import master
from .master import REPO
from .registry import FAMILIES, Spec

DOC = REPO / "docs/audio/SFX.md"

TITLES = {"kaiju": "Kaiju", "humans": "Humans", "world": "World", "ui": "Interface and stings",
          "tier2": "Tier 2: three more kaiju, three more factions"}
KAIJU = {"lizard": "Gragnor, the Lizard", "crab": "Krabulon, the Crab", "burrower": "Drillmaw, the Burrower",
         "moth": "Vespera, the Moth"}

INTRO = """# Monster Battle 9001: Sound Effects

Every sound effect in the game (Tier 1, and the kaiju and factions of Tier 2), what it is for,
and how it was checked. This file is written by `tools/audio/sfx/build.sh`; change the
generators, not this file. What the game code still has to do with these sounds is listed in
`docs/audio/client-notes-sfx.md`.

## What is here

- **{n_ids} sounds, {n_files} variants**, each as `.ogg` (Vorbis) and `.mp3`, 44.1 kHz, in
  `client/public/assets/audio/sfx/`. Total size {size_mb:.1f} MB for both formats together.
- `client/public/assets/manifest.sfx.json`: the partial manifest (section `"sfx"`). Run
  `npm run assets:manifest` to merge it into `manifest.json`.
- Everything is synthesized from code: no samples, no recordings, nothing to license.

## How to rebuild

```
tools/audio/sfx/build.sh                 # everything: synthesis, both encodings, manifest, checks, pictures, this file
tools/audio/sfx/build.sh 'explosion_*'   # only the sounds that match
tools/audio/sfx/build.sh --no-verify     # skip the checks and pictures
```

It needs the asset tools (`tools/setup-asset-tools.sh`): Python with numpy, scipy, soundfile and
pillow, and `ffmpeg`. A full build takes about {build_s} on four cores. The build is seeded, so
the same code gives the same sounds. Intermediate WAV files go to `/tmp/mb-scratch/sfx/`.

Source layout (`tools/audio/sfx/mbsfx/`): `dsp.py` (noise, filters, oscillators, envelopes,
synthetic impulse responses, limiter), `parts.py` (shared building blocks: thumps, bursts,
whooshes, debris, crackle), `kaiju.py`, `humans.py`, `world.py`, `ui.py`, `tier2.py` (one small
function per sound), `master.py` (levels, fades, loop layout, encoding), `analyze.py` (the checks
and pictures), `docgen.py` (this file).

## For whoever wires these into the game

- **Names.** A sound marked with variants has files `<id>_1`, `<id>_2`, `<id>_3`; pick one at
  random each time. A sound with one variant is just `<id>`. The manifest lists the paths.
- **Levels are already mixed.** `gain` is 1 for everything: a footstep is already quieter than an
  explosion, an ambience already sits under both. Scale whole groups in the mixer, not files.
  A sound that holds for seconds sits under the voice lines: the beam loop is 3 dB quieter than
  it first was, and the charging tone, which has to be noticed, 6 dB louder. Both changes are
  in the files.
- **Mono and stereo.** Sounds that happen at a place in the world are mono, ready for a
  positional panner. Stereo is used for ambiences, stings, and the set pieces (every roar, the
  molt blast, the death, the Ark opening); those stay intact when summed to mono.
- **One-shots start on the first sample.** An impact is at time zero, so trigger it on the
  frame of the hit. That includes the molt blast: trigger it on the blast frame, as the cocoon
  music stops. Where a sound leads up to its moment, the "loudest at" column says how long
  before the moment to start it: the swipes, `jet_flyby` (1.2 s), `generator_overload` (2.2 s)
  and `relic_open` (1.9 s).
- **Loops.** A loop file is `[0.25 s lead-in][loop body][0.25 s pad]`, the same layout as the
  music. Play from the start and loop between the two times in the manifest (`loop: [start, end]`,
  in seconds). The lead-in is the end of the body faded in and the pad is its beginning, so the
  audio repeats exactly on both sides of both loop points, and a decoder that shifts the audio by
  a few milliseconds still loops cleanly. Playing from 0 gives a 0.17 s fade-in; to start at full
  level instead (the beam after its wind-up), start playback at the loop start, 0.25 s in.
- **Playback rate.** `kaiju_hurt` is one size of animal: play it at about 1.2, 1.0 and 0.8 for
  stages 1, 2 and 3. `laser_charge_loop` is meant to rise with the charge, from 1.0 at empty to
  1.5 at full; `volley_ready` starts on the pitch the loop has reached by then and locks a
  fourth above it. `tank_engine_loop`, `heli_loop` and `drone_loop` speed up with the vehicle.
- **In tune with the music.** The three `bell` variants are three bells (D, F and A, the home
  chord of the score), so picking one at random is right and several trucks ring a chord.
  `chant_loop` is eight beats at the music's 96 beats a minute, in its key: start it on a beat
  of the stage music where that is easy. `relic_open` ends on the only major chord in the game.

## The signature roar

One voice model makes all three roars, and also the hurt, stagger, brace, eating and death
sounds, so everything the Lizard utters is the same animal. The roar has three parts, in the
same proportions at every stage: a **rise** (the growl climbs and the mouth opens), a **tear**
(the full-throated scream, ripped into pulses, with a metallic screech on top) and a **falling
rumble** (everything slides down into a long low growl). Three layers: a growl (a sawtooth with
vibrato and a subharmonic, through moving formant filters), a scream (noise through moving
band-passes) and a screech (a cluster of inharmonic partials, like bowed metal). Each stage is
longer and lower, with a bigger space around it. See `docs/audio/sfx/roar_contour.png`.

{roar_table}

## The other three roars (Tier 2)

Every kaiju has its own signature. All four follow one plan, so the game treats them alike:
three parts in fixed proportions, the same length at each stage, the same loudness at each
stage, and the same streets to echo in. What tells the animals apart is what the roar is made of:

- **Krabulon, the Crab** (`kaiju_roar_crab_s1..s3`, picture `roar_contour_crab.png`). **Clatter**:
  the two claws clack in turn, left and right, faster and faster, over a low breath being drawn.
  **Bellow**: a hollow two-note honk, rasped into pulses like a file dragged over the shell; the
  shell's resonances stay where they are, where the Lizard's mouth moves. **Hiss**: steam and
  foam let go, with bubbles popping in it.
- **Drillmaw, the Burrower** (`kaiju_roar_burrower_s1..s3`, picture `roar_contour_burrower.png`).
  **Rumble**: it is still under the ground, and everything is muffled. **Bore**: it breaks the
  surface, and the drill and its whine climb all the way through. This roar winds up where the
  Lizard's sinks. **Grind-down**: the drill runs down through gravel.
- **Vespera, the Moth** (`kaiju_roar_moth_s1..s3`, picture `roar_contour_moth.png`). **Flutter**:
  wingbeats, puffs of air. **Shriek**: two reedy tones scraped like an insect's wing, trilled,
  high above everything else in the game. **Shimmer**: the shriek slides down, its trill
  breaking into single chirps, while scale dust falls.

{tier2_roar_table}
"""

VERIFY = """## How it was verified

Nobody listened to these: they were checked by measurement and by reading spectrograms. Every
encoded file is decoded again with `ffmpeg` and measured; the numbers are in
`docs/audio/sfx/measurements.json` and the pictures in `docs/audio/sfx/`.

Checked on every file, in both formats:

- **Peak** below -1 dB full scale (worst file: {worst_peak:.2f} dB, `{worst_peak_name}`).
- **Loudness** within 1.5 dB of the sound's target, and variants of one sound within 1 dB of
  each other (largest spread: {worst_spread:.2f} dB, `{worst_spread_name}`). Loudness is measured
  with the broadcast loudness weighting (K-weighting) over the loudest 200 ms of a one-shot, or
  over a whole pass of a loop.
- **No DC offset** (largest: {worst_dc:.5f} of full scale).
- **No clicks at the ends**: a one-shot starts from silence or straight into its attack (its
  first samples are at least 10 dB below what follows within 10 ms, or 40 dB below the peak), and
  ends at least 40 dB below its peak.
- **On time**: a sound that is started on the frame of its event peaks at once
  ({on_time}).
- **Length and alignment** against the master: at most {worst_offset} samples of shift in either
  format. (`ffmpeg`'s Vorbis decoder returns some short files 128 samples short or up to 22 ms
  long; other decoders return the exact length. Either way only silence is affected: every
  one-shot ends with 6 ms of it, and the extra samples are zeros.)

Compared within families (average of the variants, `.ogg`):

{order_table}

Bigger must be longer, darker (lower spectral centroid: the "center of mass" of the spectrum)
and louder. All of these orderings are enforced by the build.

Cues that mean different things must not sound alike. The build compares a coarse picture of
each pair (energy in 28 frequency bands over time; 1 means the same sound, unrelated sounds are
near 0) and fails above the limit:

{distinct_table}

Loops, measured across the loop point as the game will play them:

{loop_table}

"Step" is the size of the jump between the last sample before the loop end and the first after
the loop start, compared with the ordinary sample-to-sample steps nearby (a click would be many
times larger than 1). "Onset" is how much sudden new energy appears at the splice compared with
playing straight on (0 dB: none). "Repeat" is how closely the audio around the loop end matches
the audio around the loop start; it is normally about as good as the encoder's own error, shown
beside it. "exact" means the two are identical sample for sample (the 16 s loops are a whole
number of MP3 blocks long, so the encoder makes the same decisions both times).

Pictures (decoded `.ogg` unless marked):

{pictures}

## Known limits

{limits}
"""

LIMITS = [
    "No one has heard these. The checks catch technical faults (clipping, clicks, bad loops, wrong "
    "length, wrong balance between families) and the spectrograms show that each sound has the "
    "intended shape, but whether a sound is pleasing or funny or tiring after an hour is a "
    "listening question. A first listening pass by a person is the most valuable next step.",
    "Large impacts (stage 3 steps and stomps, large explosions, tank guns) carry most of their "
    "energy below 120 Hz. They are built with harmonics and a noisy mid layer so they still read "
    "on laptop speakers, but they will be noticeably thinner there than on headphones.",
    "`crowd_panic_loop` is a cloud of synthetic vowel sounds. It reads as a distant crowd in a "
    "spectrogram; up close it may sound like a choir warming up. Keep it low in the mix.",
    "Ambience loops are 16 s long. The bird phrases and the far foghorn (sunset) repeat every pass; "
    "if that becomes noticeable, play them quieter or generate longer loops (one number in `world.py`).",
    "The hurt, stagger and death sounds exist at one size. The roar is the only utterance with a "
    "version per stage.",
    "The Tier 2 sounds were made from the design text, before the kaiju and units that use them "
    "exist in the game. Expect to adjust levels and lead times when they are wired in. The Crab, "
    "the Burrower and the Moth have a roar each and nothing else of their own yet: their hurt, "
    "stagger and death sounds are still the Lizard's.",
    "`chant_loop` and the voices in `relic_open` are synthetic singers on open vowels, with no "
    "words. Like the crowd, they read as a choir in a spectrogram and may sound like an organ "
    "stop up close.",
]


def _range(vals: list[float], fmt: str = "{:.2f}") -> str:
    lo, hi = min(vals), max(vals)
    return fmt.format(lo) if abs(hi - lo) < 0.005 else f"{fmt.format(lo)} to {fmt.format(hi)}"


def write(specs: dict[str, Spec], report: dict) -> None:
    lines: list[str] = []
    n_files = 0
    size = 0
    worst_peak, worst_peak_name = -99.0, ""
    worst_dc = 0.0
    worst_offset = 0
    worst_spread, worst_spread_name = 0.0, ""
    for fam in FAMILIES:
        fam_specs = [s for s in specs.values() if s.family == fam and s.id in report]
        if not fam_specs:
            continue
        lines.append(f"### {TITLES[fam]}\n")
        lines.append("| Sound | Variants | Length (s) | Channels | Loop (s) | Loudest at (ms) | Intended use |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- |")
        for s in fam_specs:
            files = report[s.id]["files"]
            ogg = [f["ogg"] for f in files.values() if "ogg" in f]
            n_files += len(files)
            for fname, f in files.items():
                for ext in ("ogg", "mp3"):
                    if ext not in f:
                        continue
                    m = f[ext]
                    size += m["bytes"]
                    if m["peak_db"] > worst_peak:
                        worst_peak, worst_peak_name = m["peak_db"], f"{fname}.{ext}"
                    worst_dc = max(worst_dc, m["dc_offset"])
                    worst_offset = max(worst_offset, abs(m.get("offset_samples", 0)))
            lv = [m["level_db"] for m in ogg]
            if len(lv) > 1 and max(lv) - min(lv) > worst_spread:
                worst_spread, worst_spread_name = max(lv) - min(lv), s.id
            if s.loop:
                lo, hi = master.loop_points(s)
                length = f"{s.loop:g} per pass ({ogg[0]['seconds']:.2f} file)"
                loop = f"{lo:g} to {hi:g}"
                peak_at = ""
            else:
                length = _range([m["seconds"] for m in ogg])
                loop = ""
                peak_at = _range([m["peak_at_ms"] for m in ogg], "{:.0f}")
            ch = "stereo" if ogg[0]["channels"] == 2 else "mono"
            lines.append(f"| `{s.id}` | {s.variants} | {length} | {ch} | {loop} | {peak_at} | {s.use} |")
        lines.append("")

    def avg(sid: str, key: str) -> float:
        vals = [f["ogg"][key] for f in report[sid]["files"].values() if "ogg" in f]
        return sum(vals) / len(vals)

    from .analyze import ORDERED
    order = ["| Family | Sound | Length (s) | Spectral centroid (Hz) | Loudness (dB) |", "| --- | --- | --- | --- | --- |"]
    for group, members in ORDERED.items():
        for i, sid in enumerate(members):
            if sid in report:
                order.append(f"| {group if i == 0 else ''} | `{sid}` | {avg(sid, 'seconds'):.2f} | "
                             f"{avg(sid, 'centroid_hz'):.0f} | {avg(sid, 'level_db'):.1f} |")

    roar = ["| Stage | Length (s) | Spectral centroid (Hz) | Share of energy below 120 Hz | Loudness (dB) |",
            "| --- | --- | --- | --- | --- |"]
    for stage in (1, 2, 3):
        sid = f"kaiju_roar_lizard_s{stage}"
        if sid in report:
            roar.append(f"| {stage} | {avg(sid, 'seconds'):.2f} | {avg(sid, 'centroid_hz'):.0f} | "
                        f"{100 * avg(sid, 'low_share'):.0f}% | {avg(sid, 'level_db'):.1f} |")

    roar += ["", "The three parts, measured on the decoded files (the build fails unless the tear is the loudest and",
             "brightest part and the fall carries the most bass):", "",
             "| Stage | Part | Length (s) | Loudness (dB) | Spectral centroid (Hz) | Share of energy below 120 Hz |",
             "| --- | --- | --- | --- | --- | --- |"]
    for stage in (1, 2, 3):
        parts_ = report.get(f"kaiju_roar_lizard_s{stage}", {}).get("parts", {})
        for i, name in enumerate(("rise", "tear", "fall")):
            if name in parts_:
                p = parts_[name]
                roar.append(f"| {stage if i == 0 else ''} | {name} | {p['seconds']:.2f} | {p['level_db']:.1f} | "
                            f"{p['centroid_hz']:.0f} | {100 * p['low_share']:.0f}% |")

    # ---- the Tier 2 roars: the same tables for each, then how alike the four are ----
    from .analyze import ROAR_GROUPS, ROAR_LIKENESS_MAX, roar_plan
    plan = roar_plan()
    t2: list[str] = []
    kinds = [k for k in ROAR_GROUPS if k != "lizard" and f"kaiju_roar_{k}_s1" in report]
    if kinds:
        t2 += ["All four at a glance (the Lizard is repeated for comparison):", "",
               "| Kaiju | Stage | Length (s) | Spectral centroid (Hz) | Share of energy below 120 Hz | Loudness (dB) |",
               "| --- | --- | --- | --- | --- | --- |"]
        for kind in ["lizard"] + kinds:
            for stage in (1, 2, 3):
                sid = f"kaiju_roar_{kind}_s{stage}"
                if sid in report:
                    t2.append(f"| {KAIJU[kind] if stage == 1 else ''} | {stage} | {avg(sid, 'seconds'):.2f} | "
                              f"{avg(sid, 'centroid_hz'):.0f} | {100 * avg(sid, 'low_share'):.0f}% | {avg(sid, 'level_db'):.1f} |")
        t2 += ["", "The three parts of each, measured on the decoded files. The build fails unless, for the Crab, "
                   "the bellow is", "the loudest part, the hiss the brightest and the clatter the quietest; for the "
                   "Burrower, the bore is the", "loudest and the rumble the darkest, with the most bass; for the Moth, "
                   "the shriek is the loudest and", "brightest and the flutter the darkest.", "",
               "| Kaiju | Stage | Part | Length (s) | Loudness (dB) | Spectral centroid (Hz) | Share of energy below 120 Hz |",
               "| --- | --- | --- | --- | --- | --- | --- |"]
        for kind in kinds:
            for stage in (1, 2, 3):
                parts_ = report.get(f"kaiju_roar_{kind}_s{stage}", {}).get("parts", {})
                for i, key in enumerate(("rise", "tear", "fall")):
                    if key in parts_:
                        p = parts_[key]
                        t2.append(f"| {KAIJU[kind] if stage == 1 and i == 0 else ''} | {stage if i == 0 else ''} | "
                                  f"{plan[kind]['names'][i]} | {p['seconds']:.2f} | {p['level_db']:.1f} | "
                                  f"{p['centroid_hz']:.0f} | {100 * p['low_share']:.0f}% |")
        like = {sid: r.get("likeness", {}) for sid, r in report.items() if sid.startswith("kaiju_roar_")}
        pairs = [(a, b) for i, a in enumerate(["lizard"] + kinds) for b in (["lizard"] + kinds)[i + 1:]]
        if all(like.get(f"kaiju_roar_{a}_s1", {}).get(f"kaiju_roar_{b}_s1") is not None for a, b in pairs):
            t2 += ["", "How alike two roars are, as a number: each roar is reduced to a coarse picture (energy in 28 "
                       "frequency bands", "over 40 steps of its length) and the pictures are correlated. 1 means the "
                       "same sound. Two roars always", "share an outline (they swell, hold and die away, and end "
                       f"darker than they began), so unrelated roars still", f"score about 0.5 to 0.8. The build "
                       f"fails if two kaiju at the same stage score above {ROAR_LIKENESS_MAX}.", "",
                   "| Stage | " + " | ".join(f"{a.capitalize()} and {b.capitalize()}" for a, b in pairs) + " |",
                   "| --- |" + " --- |" * len(pairs)]
            for stage in (1, 2, 3):
                t2.append(f"| {stage} | " + " | ".join(
                    f"{like[f'kaiju_roar_{a}_s{stage}'][f'kaiju_roar_{b}_s{stage}']:.2f}" for a, b in pairs) + " |")
            t2 += ["", "For comparison, one kaiju against itself at another stage:", "",
                   "| Kaiju | Stage 1 and 2 | Stage 2 and 3 | Stage 1 and 3 |", "| --- | --- | --- | --- |"]
            for kind in ["lizard"] + kinds:
                own = lambda i, j: like[f"kaiju_roar_{kind}_s{i}"][f"kaiju_roar_{kind}_s{j}"]      # noqa: E731
                t2.append(f"| {KAIJU[kind]} | {own(1, 2):.2f} | {own(2, 3):.2f} | {own(1, 3):.2f} |")

    from .analyze import DISTINCT
    distinct = ["| Pair | Likeness | Limit |", "| --- | --- | --- |"]
    for (a, b), limit in DISTINCT:
        v = report.get(a, {}).get("likeness", {}).get(b)
        if v is not None:
            distinct.append(f"| `{a}` and `{b}` | {v:.2f} | {limit} |")

    from .analyze import ON_TIME_MS
    on_time = "; ".join(
        f"`{sid}`: {max(m['peak_at_ms'] for f in report[sid]['files'].values() for m in f.values()):.0f} ms after its "
        f"start, limit {limit:.0f} ms" for sid, limit in ON_TIME_MS.items() if sid in report)

    limits = list(LIMITS)
    worst = [(m.get("limiter_db", 0.0), sid) for sid, r in report.items() if sid.startswith("kaiju_roar_")
             for f in r["files"].values() for m in [f.get("ogg", {})]]
    if worst and max(worst)[0] >= 3.0:
        hot = sorted((sid for v, sid in worst if v >= 3.0))
        limits.append(
            f"At stage 3 the Crab's and the Burrower's roars are dark sounds held at the same loudness as the "
            f"others, which leaves their peaks little room: the limiter takes up to {max(worst)[0]:.1f} dB off the "
            f"loudest moments ({', '.join(f'`{h}`' for h in hot)}). The pulses of those roars are a little "
            f"flatter than designed; nothing clips.")

    loops = ["| Loop | Format | Step | Onset (dB) | Repeat (dB) | Encoder error (dB) |", "| --- | --- | --- | --- | --- | --- |"]
    for s in specs.values():
        if s.loop and s.id in report:
            for ext in ("ogg", "mp3"):
                m = report[s.id]["files"][s.id].get(ext)
                if m:
                    sm = m["seam"]
                    rep = "exact" if sm["repeat_error_db"] < -100 else f"{sm['repeat_error_db']:.0f}"
                    loops.append(f"| `{s.id}` | {ext} | {sm['step_vs_p99']:.2f} | {sm['splice_flux_db']:+.1f} | "
                                 f"{rep} | {sm.get('codec_error_db', float('nan')):.0f} |")

    pics = sorted(p.name for p in (REPO / "docs/audio/sfx").glob("*.png"))
    pictures = "\n".join(f"- `docs/audio/sfx/{p}`" for p in pics)

    text = INTRO.format(n_ids=len(report), n_files=n_files, size_mb=size / 1e6, build_s="a minute and a half",
                        roar_table="\n".join(roar), tier2_roar_table="\n".join(t2))
    text += "\n## The sounds\n\nLengths are of the encoded files. \"Loudest at\" is where the sound peaks, counted from its start.\n\n"
    text += "\n".join(lines)
    text += "\n" + VERIFY.format(worst_peak=worst_peak, worst_peak_name=worst_peak_name, worst_spread=worst_spread,
                                 worst_spread_name=worst_spread_name or "none", worst_dc=worst_dc, worst_offset=worst_offset,
                                 order_table="\n".join(order), loop_table="\n".join(loops), pictures=pictures,
                                 distinct_table="\n".join(distinct), on_time=on_time, limits="\n".join(f"- {x}" for x in limits))
    DOC.parent.mkdir(parents=True, exist_ok=True)
    DOC.write_text(text)
