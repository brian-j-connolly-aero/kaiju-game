# Monster Battle 9001: the soundtrack

Choir and orchestra that swell with each stage, written as code and rendered from a General MIDI
(Musical Instrument Digital Interface) soundfont. Thirteen files, one theme, one key, one tempo.

- Files: `client/public/assets/audio/music/<id>.ogg` and `.mp3` (44.1 kHz stereo).
- Manifest: `client/public/assets/manifest.music.json` (the `"music"` section).
- Source: `tools/audio/music/` (rebuild everything with `tools/audio/music/build.sh`).
- Measurements and pictures: `docs/audio/music/` (`MEASUREMENTS.md`, one spectrogram per file,
  one loop-splice picture per loop and format).

## 1. The musical idea

**Key:** D minor. **Tempo:** 96 beats per minute, 4/4, for every cue. One bar is exactly 2.5 s
(110250 samples), one beat 0.625 s. Every length in the game's contract lands on whole bars:
20 s is 8 bars, 30 s is 12 bars, 80 s is 32 bars, the 10 s cocoon is 4 bars.

**The theme** ("Gragnor's theme") is an eight-bar tune on one rhythmic cell: long, short, long
(a dotted quarter, an eighth, a half note).

```
bar        1        2        3         4        5        6        7         8
tune     D  D F | E  D C | F  F Bb | A  G E  | D  D F | E  D C | G  F Eb | D
bass     D      | C      | Bb   G  | A       | D      | C      | Eb   A  | D
chords   Dm     | C      | Bb   Gm | A7      | Dm     | C      | Eb  A7b5| Dm
```

- Bars 1 and 2 (**D D F, E D C**) are the **head motif**. Every cue quotes it.
- Bars 1 to 4 sit on a descending "lament" bass and stop on the dominant.
- Bars 5 to 8 answer, and close through the flattened second: an E flat chord, then A7 with a
  flat fifth, so the last step of the tune is E flat falling to D. That is the monster's cadence.
- A **second strain** (8 bars: G minor, D minor over F, E flat, A7; G minor, B flat, E
  half-diminished, A7) turns the cell downwards and climbs back to the dominant.

How it develops through a match:

| Where | What happens to the theme |
| --- | --- |
| `lobby` | Stated in full, twice: low and plain, then tutti. This is where players learn it. |
| `briefing` | Head motif once, on English horn, over a pedal. |
| `stage1` | Fragments only: plucked, on muted trumpet, on clarinet (which breaks off). Four bars of the tune finally get out near the end of the loop, then sink back. |
| `stage2` | The first full statements of the match: horns, then violins, then choir in octaves. |
| `stage3` | Dark statement by men's voices and low brass; then the first half of the theme **at half speed as the bass line** under a slow chorale; then the apotheosis with the whole choir. |
| `cocoon` | Head motif on celesta, like a music box. |
| `intermission` | The cell climbs one step a bar over a dominant pedal; in bar 4 it is the head motif at home pitch. |
| `win_humans` | Head motif turned to D major as a trumpet fanfare. |
| `win_kaiju` | Head motif plus the flat-second close, for full choir. |
| `hearing` | First half of the theme as a passacaglia over its own lament bass. |

## 2. Cue list

Loop points are in seconds and are exact sample positions at 44.1 kHz. "Bars" is the musical
body; loops carry an extra 0.25 s before the loop start and 0.25 s after the loop end (see
section 4).

| id | title | kind | bars | file length | loop [start, end] | group | loudness (LUFS) |
| --- | --- | --- | ---: | ---: | --- | --- | ---: |
| `lobby` | The Long Watch (brooding march) | loop | 32 | 80.5 s | [0.25, 80.25] | | -16.0 |
| `briefing` | Situation Room (tense bed) | loop | 8 | 20.5 s | [0.25, 20.25] | | -18.1 |
| `stage1_base` | Something in the Streets | loop | 32 | 80.5 s | [0.25, 80.25] | `stage1` | -18.9 |
| `stage1_combat` | (combat stem) | loop | 32 | 80.5 s | [0.25, 80.25] | `stage1` | -19.8 |
| `stage2_base` | Steel Against Scale | loop | 32 | 80.5 s | [0.25, 80.25] | `stage2` | -17.1 |
| `stage2_combat` | (combat stem) | loop | 32 | 80.5 s | [0.25, 80.25] | `stage2` | -20.3 |
| `stage3_base` | Colossus over Port Meridian | loop | 32 | 80.5 s | [0.25, 80.25] | `stage3` | -16.9 |
| `stage3_combat` | (combat stem) | loop | 32 | 80.5 s | [0.25, 80.25] | `stage3` | -19.2 |
| `cocoon` | Chrysalis | one-shot | 4 | 12.5 s | | | -16.1 |
| `intermission` | Redeploy (build) | one-shot | 8 | 23.5 s | | | -16.1 |
| `win_humans` | Port Meridian Stands (fanfare) | one-shot | 5 | 14.5 s | | | -16.1 |
| `win_kaiju` | The City Falls Silent | one-shot | 5 | 14.9 s | | | -16.1 |
| `hearing` | For the Record (somber, bureaucratic) | loop | 12 | 30.5 s | [0.25, 30.25] | | -18.0 |

LUFS is Loudness Units relative to Full Scale (integrated loudness, EBU R128). Full mixes are
mastered to -16. The two beds that sit under speech (`briefing`, `hearing`) are 2 lower on
purpose. Stage stems are mastered as a pair: **base plus combat together** is -16.5 (stage 1),
-15.5 (stage 2), -15.0 (stage 3), so the music really does get a little louder with each stage,
and each base stem alone is 2 to 2.5 lower than its pair.

Total size: about 10 MB of `.ogg` and 10 MB of `.mp3` (the client loads one format).

### Manifest entries

```json
"stage2_base": { "base": "audio/music/stage2_base", "loop": [0.25, 80.25], "bpm": 96,
                 "group": "stage2", "duration": 80.5 }
```

`base`, `loop`, `bpm` and `group` are the contract fields from `docs/ASSETS.md`. `duration`
(file length in seconds) is an additive convenience, the same idea as `duration` on voice lines.
One-shots have no `loop`.

## 3. What is in each cue

Every part is written within the real range of the instrument or voice (the build refuses to
run otherwise), and nothing but octaves and fifths sounds below F2.

**`lobby`, The Long Watch.** 32 bars.
Bars 1 to 4, vamp: plucked basses and cellos (D and A, a slow march), field drum, bass drum, a
held open fifth in the cellos with the violas sighing B flat to A, and the theme's rhythm as a
timpani signal. Bars 5 to 12, the theme low and plain: horns, cellos and bassoon in unison over
the plucked bass, violins holding a high A. Bars 13 to 20, second strain: violins and clarinet
with violas an octave below, string harmony, bowed basses, the drum swelling back in, trombones
and a timpani roll into the return. Bars 21 to 28, the theme tutti: trumpets, horns, men's voices
(joined by the altos for the second half), tremolo violins, pulsing violas, trombones in open
fifths, tuba, timpani, cymbals. Bars 29 to 32, codetta: clarinet and bassoon echo the head motif
and the texture winds down into the vamp.

**`briefing`, Situation Room.** 8 bars over a D pedal, written to stay out of the way of speech:
held basses and cellos, tremolo violas (the same B flat to A sigh), a very high violin line, a
timpani pulse on beats 1 and 3, soft field drum, and the head motif once on English horn in
bars 5 and 6.

**`stage1`, Something in the Streets (the hatchling).** Sparse and nervous. 32 bars.
- *Base:* a stop-and-start cello figure on D with a flat-second twitch (E flat), sparse plucked
  bass, plucked fragments of the head motif passed between violins and violas, tremolo violas,
  a clarinet that tries the tune in bars 9 to 12 and breaks off, a hint of choir (women, "ooh")
  in bars 13 to 16 and 25 to 28, a distant muted trumpet and a bassoon with the head motif in
  bars 17 to 22, and in bars 25 to 28 the first four bars of the theme in cellos and violas. A
  soft snare tic every second bar is the only percussion in the base stem.
- *Combat:* nervous snare (irregular accents, rolls into each eight-bar phrase), rim clicks,
  bass drum, timpani, short stopped stabs from horns and trombones placed where the cello figure
  plays its root, a two-note muted-trumpet alarm, small choir shouts at phrase starts, short
  cymbal crashes with a swell into them.

**`stage2`, Steel Against Scale (the juvenile).** Full and driving. 32 bars.
- *Base:* basses and "galloping" cellos and violas (an eighth and two sixteenths on every beat).
  Bars 1 to 8 the theme in the horns; bars 9 to 16 the theme in violins, flute and oboe while the
  horns take the tenor line and **the choir enters** (women, "ooh"); bars 17 to 24 the second
  strain sung by sopranos and altos with the violins, tenors, basses and horns in harmony,
  building; bars 25 to 32 the theme with the choir in octaves, horns, violins and woodwind,
  trombones and tuba underneath.
- *Combat:* snare on the gallop with fills and rolls, bass drum, taiko, timpani on the roots with
  triplet run-ups, crash cymbals with swells at each section, two trumpet parts and trombones
  answering every bar of the theme on beats 3 and 4 ("da-da-DUM", the theme's own cell) plus
  short tutti chords at phrase starts, and choir shouts on the strong bars.

**`stage3`, Colossus over Port Meridian (the titan).** Enormous. 32 bars. Same tempo, but the
accents fall 3+3+2, so it lurches like something very heavy walking.
- *Base:* bars 1 to 8 the theme, dark: tenors, basses, trombones and horns in unison, women
  holding the harmony, strings in unbroken sixteenths, cellos and basses hammering the roots,
  tuba, organ pedal, tubular bells and a church bell. Bars 9 to 16 the second strain: sopranos,
  altos, violins and flute, men and horns in harmony. Bars 17 to 24 the first half of the theme
  at half speed as the bass (men's voices, trombones, tuba, basses, organ pedal) under a slow
  rising chorale for the women, horns and tremolo violins, bells every two bars. Bars 25 to 32
  the apotheosis: the whole choir in octaves, trumpets, horns, violins, flute and piccolo, low
  brass in open fifths, a bell on every bar, closing on the flat-second cadence.
- *Combat:* timpani, bass drum, taiko and snare on the 3+3+2 accents, crash cymbals, trombone
  punches on the same accents, trumpet calls (a triplet pickup and a long note) answering the
  tune, choir shouts on beats 1 and 2-and.

**`cocoon`, Chrysalis.** One-shot, 4 bars: **exactly 10.0 s of music, then silence and ring-out**.
A muffled heartbeat that speeds up (once every two beats, then three times a bar, then every
beat), a choir cluster that slides slowly upward (women on A and B flat, men on D and A,
sopranos adding D and E flat), glassy tremolo violins, the head motif on celesta, and a cymbal
swell into the cut at 10.0 s, which is where the game plays the molt blast.

**`intermission`, Redeploy.** One-shot, 8 bars: **a 20.0 s build, a single hit at exactly
20.0 s, then 3.5 s of ring-out**. Everything stands on the dominant (A in the basses, an
eight-bar timpani roll). The theme's cell climbs one step a bar; cellos and bassoon start, violas
and horns join in bar 3, violins, trombones and a snare roll in bar 5, trumpets and choir in
bar 7. The hit is the D that the next stage starts on.

**`win_humans`, Port Meridian Stands.** One-shot. The head motif in D major on two trumpet
parts, horns and violins; triplet tonguing over B flat and C; a held D major chord with choir,
timpani and snare rolls, cymbals, tubular bells and glockenspiel.

**`win_kaiju`, The City Falls Silent.** One-shot. Head motif for men's voices and trombones,
then the flat-second close with the full choir, horns, tremolo low strings, organ pedal, timpani,
and a tolling church bell.

**`hearing`, For the Record.** 12 bars: the lament bass three times round, plucked, with a dry
harpsichord and a wood-block clock (tock on 1 and 3, tick on 2 and 4). English horn has the tune
first; then bassoon an octave lower with a walking clarinet counter-line; then violas and cellos
in octaves with the English horn above. It stops on the dominant, so the loop restarts cleanly.

## 4. How the client should play it

### Loops

Decode with Web Audio (`decodeAudioData`) and play with an `AudioBufferSourceNode`:

```ts
src.buffer = buffer;
src.loop = true;
src.loopStart = entry.loop[0];   // 0.25
src.loopEnd = entry.loop[1];     // 0.25 + bars * 2.5
src.start(when, 0);              // start from the top of the file, not from loopStart
```

Every loop file is laid out like this:

```
[ lead-in 0.25 s ][ loop body: whole bars ][ pad 0.25 s ]
  ^ 0              ^ loopStart              ^ loopEnd
```

The lead-in is the last quarter second of the loop, faded in; the pad is the first quarter
second of the loop. So the audio is the same on both sides of both loop points, and the jump
from `loopEnd` to `loopStart` is seamless even if a decoder shifts the audio by a few
milliseconds (MP3 decoders differ in how they trim encoder delay). The hall reverb at the end of
the loop is already folded into its beginning, so the loop never sounds "cut". Do not loop the
whole file (`<audio loop>`): that would replay the lead-in and the pad.

### Base and combat stems

For each stage, `stageN_base` and `stageN_combat` have the same length, the same loop points and
the same bar lines.

1. Create both sources with the loop settings above and **start them with the same `when`**.
   Never restart one without the other; they are only aligned if they started together.
2. Give each its own gain node. Base stays at 1. Combat starts at 0.
3. When the fight is on (shots flying, a volley charging, the kaiju attacking units), ramp the
   combat gain to 1 over about 0.6 s (one beat). When it has been quiet for 6 to 8 s, ramp it
   back to 0 over about 4 s. A linear ramp is fine.
4. Both stems at full gain are safe: they were limited **together**, so base alone, combat
   alone, and any mix of the two stay under -1 dBTP (decibels true peak; measured on the encoded
   files, see `MEASUREMENTS.md`). No extra limiter is needed for the music bus.

The combat stem carries the drums, the brass answers and the choir shouts; on its own it sounds
like a percussion track. The base stem on its own is complete music (it has the tune).

### Moving between cues

Tempo and key are shared, so plain crossfades of 1 to 2 s work everywhere. Three places are
written to line up with the game clock:

- **Cocoon (10 s).** Fade the stage stems out over about 1 s and start `cocoon` when the cocoon
  starts. The music stops dead at 10.0 s, where the molt blast sound plays.
- **Intermission.** The hit is at 20.0 s into the file. For a 20 s intermission start the file
  at the beginning. For a shorter one of `T` seconds, start it at offset `20 - T` with a 50 ms
  fade-in (for 8 s: offset 12.0), so the hit still lands when the next stage begins. Start the
  next stage's stems at that moment; the hit and the stage's first chord are both D.
- **Match end.** Cut the stage stems (0.3 s fade) and play `win_humans` or `win_kaiju`. Start the
  `hearing` loop when the hearing screen opens.

`lobby`, `briefing` and `hearing` are ordinary loops. `briefing` and `hearing` are meant to run
under the voiced lines; they are already 2 LU quieter than the rest and can be ducked a further
4 to 6 dB while someone is speaking.

## 5. How it is made

```
tools/audio/music/
  build.sh              one command: score review, render, master, encode, verify
  build.py              command-line entry (build.sh calls it)
  mbmusic/
    score.py            note notation, parts, MIDI export (96 beats per minute grid)
    orchestra.py        the instruments: soundfont program, real range, seat, mix defaults
    theme.py            the theme, its harmony and voice leading
    patterns.py         accompaniment patterns that follow the harmony
    cues/*.py           one file per cue (stage files hold both stems)
    tuning.py           intonation measurement; tuning_table.json is its committed result
    synth.py            fluidsynth render of each part, with per-note intonation correction
    dsp.py              hall reverb, filters, loop folding, limiter, loudness
    mixdown.py          mix, master, file layout, encode, manifest
    review.py           composer's review of the written score
    analyze.py          verification, spectrograms, MEASUREMENTS.md
```

`build.sh` with no arguments rebuilds everything (about six minutes from an empty cache);
`build.sh lobby stage2` rebuilds only those cues; `build.sh --review` prints the score review;
`--no-verify` skips the measurements. Intermediate MIDI and WAV files go to
`/tmp/mb-scratch/music` (set `MB_SCRATCH` to move it), never into the repository.

1. **Score.** Each cue is Python that writes notes into named parts
   (`part.line(5, "D4:1.5 D4:.5 F4:2 | E4:1.5 D4:.5 C4:2", 92)`: bar 5, pitches with lengths in
   beats, bar-line checks, velocity). The theme, its bass and its three inner voices live in
   `theme.py`; the inner voices move by step and against the bass, so the harmony never doubles
   the bass in parallel.
2. **Score review** (`build.sh --review`, also run before every build, which stops on a finding):
   every note inside the instrument's real range; no thirds or seconds sounding below C3 and
   nothing but octaves and fifths below F2, checked across all parts and both stems of a cue;
   one-shots not running past their end. It also prints who plays in which bar and how loud.
3. **Render.** Each part is rendered on its own with fluidsynth and `FluidR3_GM.sf2`, no synth
   effects. Two things are done to the samples:
   - *Intonation.* The soundfont is not in tune with itself: measured against equal temperament
     the choir is 20 to 48 cents flat in the men's register, the timpani 38 cents sharp from G2
     up, the plucked strings jump 40 cents between neighbouring keys. `tuning.py` measures every
     key of every patch once; the synth then retunes each note (within a cent). Without this the
     unison and octave statements of the theme are sour.
   - *Marcato.* The string, horn and choir samples swell in slowly, which smears fast figures.
     The "marcato" and "shout" instruments start each sample a few thousand samples in, with a
     short clean fade, so gallops, sixteenths and choir shouts speak on time.
4. **Mix.** Per part: level, high-pass under the instrument, a little high-shelf lift for the
   dull sampled strings, voices and brass, a seat in the stereo picture (violins left, low
   strings and low brass right of centre, basses near the middle), and a send to one shared
   hall. The hall is a synthetic impulse response (decay 2.6 s at 500 Hz, 1.5 s at 8 kHz, 22 ms
   pre-delay) kept out of the bass.
5. **Loop folding.** A loop is rendered once with its whole ring-out; everything that rings past
   the last bar is added back onto the start. Because everything up to here is linear, the result
   is exactly the music playing forever, and the loop start equals what follows the loop end
   sample for sample (verified: the difference in the master is zero).
6. **Master.** One gain per cue to reach the loudness target, then a look-ahead limiter with a
   ceiling of -1.5 dB. For a stage, one gain curve is computed from base, combat and their sum
   together and applied to both, which is what makes every fade position safe. The limiter barely
   works: at most 1.5 dB of reduction, on under 5% of the samples, in any cue.
7. **Encode.** ffmpeg, Vorbis quality 4 and MP3 variable bit rate quality 5 (both about
   115 kbit/s for this material), with bit-exact flags so a rebuild gives identical files.

## 6. Verification

Nobody listened to this: it was verified by measurement and by looking at pictures. The numbers
are in `docs/audio/music/MEASUREMENTS.md` (regenerated by every build) and `measurements.json`.

- **Decodes, right length.** All 26 files decode; every decoded length matches the score to the
  sample (0.00 ms error), and decoded audio lines up with the master at offset 0 in both formats.
- **Not silent, not clipped.** True peak of every file is between -5.8 and -1.0 dBTP.
- **Loudness.** Full mixes -16.0 to -16.1 LUFS; beds -18.0 and -18.1; stage pairs -16.5, -15.5,
  -15.0 (base alone -18.9, -17.1, -16.9).
- **Stems sum without clipping.** Base plus combat, decoded and added at full level: true peak
  -1.0 to -1.7 dBTP in both formats.
- **Loops are continuous.** In the master the loop is exactly periodic. In the encoded files the
  200 ms around the loop end repeat the 200 ms around the loop start as closely as the codec
  allows (within 3 dB of the codec's own error), the sample step across the splice is ordinary
  (0.01 to 1.5 times the 99th percentile of the steps around it; a click would be many times
  that), and the jump adds no onset energy (within 0.7 dB of playing straight through).
  Pictures: `docs/audio/music/<id>_seam_ogg.png` and `_seam_mp3.png` show the last 2 s before the
  loop end followed by the first 2 s after the loop start, with a 20 ms waveform across the
  splice.
- **Structure.** `docs/audio/music/<id>.png` (and `stageN_sum.png` for the pairs) are
  spectrograms with the sections marked; the bar-by-bar loudness table in `MEASUREMENTS.md` shows
  each build (for example the lobby goes -21, -18, -18 rising to -14, -13 for the tutti, back to
  -21).
- **Beat grid.** The strongest onsets of every loop sit within 13 ms (median) of the
  sixteenth-note grid counted from the loop start.
- **Stereo and mono.** Left and right are within 1.5 dB of each other in every file; summing to
  mono loses 1.1 to 2.3 dB (no cancellation).

## 7. Known weaknesses

- It is a 2008 General MIDI soundfont. The strings and choir are recognisably sampled, the
  choir can only sing "aah" and "ooh", there are no true legato transitions, and drum rolls are
  written out as single strokes, which can sound mechanical when exposed (the lobby vamp, the
  intermission).
- Balance was set from loudness tables per part and section and from spectra, not by ear. A
  listening pass by a person may want a few decibels here and there; the gains are one number
  per part in `cues/*.py`.
- The orchestra is dark above 5 kHz (the samples have little there); the percussion carries the
  top end, so the base stems sound mellower than the combat stems.
- A loop's first pass already contains the reverb tail of "the previous pass" at its very start,
  and the file begins with a quarter-second fade-in before the first downbeat. Both are by
  design (they are what makes the loop seamless) but they are audible on the first play if you
  listen for them.
- The stage 3 organ pedal goes down to 33 Hz; small speakers will not reproduce it (the tuba and
  basses carry the same line an octave up).
