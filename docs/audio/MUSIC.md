# Monster Battle 9001: the soundtrack

Written as code and rendered from a General MIDI (Musical Instrument Digital Interface)
soundfont. Eleven cues (22 files). Around the match: choir and orchestra on one theme, in one
key and at one tempo (the lobby, the briefing, the cocoon, the intermission, the two win cues and
the hearing). The match itself, since round 4: four fast tracks in the style of a late-1990s
high-end arcade cabinet (rock drums, slap and synth bass, distorted guitars, synth leads,
orchestra hits, and the same choir and orchestra on top), one for each stage and one for the last
minute on the clock.

- Files: `client/public/assets/audio/music/<id>.ogg` and `.mp3` (44.1 kHz stereo).
- Manifest: `client/public/assets/manifest.music.json` (the `"music"` section).
- Source: `tools/audio/music/` (rebuild everything with `tools/audio/music/build.sh`).
- Measurements and pictures: `docs/audio/music/` (`MEASUREMENTS.md`, one spectrogram per file,
  one loop-splice picture per loop and format).

## 1. The musical idea

**Key:** D minor, for every cue (the match tracks lift their last chorus a tone or a semitone).
**Tempo:** 96 beats per minute, 4/4, for every cue around the match: one bar is exactly 2.5 s
(110250 samples), one beat 0.625 s, and every length in the game's contract lands on whole bars
(20 s is 8 bars, 30 s is 12 bars, 80 s is 32 bars, the 10 s cocoon is 4 bars). The match
tracks are fast, and faster with each stage: 150, 160 and 168 beats per minute, tempos chosen so
that one bar is still a whole number of samples (70560, 66150 and 63000). The final-minute
track is at 168 and is exactly 42 bars: 60.0 s.

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
| `stage1` | Its breakdown plays the theme's first eight bars on a square wave, with a tape echo, as a quiet moment between the chorus and the guitar solo. |
| `stage2` | The whole theme as a heavy riff: saw lead, brass section and guitars over a galloping kick. |
| `stage3` | The whole theme for the whole choir (women in unison, tenors an octave below), brass and band; then the second strain for women, tenors and horns. |
| `final_minute` | No theme: the stage 3 hook, climbing a key every eight bars. |
| `cocoon` | Head motif on celesta, like a music box, under a choir cluster. |
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
| `lobby` | The Long Watch (brooding march) | loop | 32 | 80.5 s | [0.25, 80.25] | | -16.1 |
| `briefing` | Situation Room (tense bed) | loop | 8 | 20.5 s | [0.25, 20.25] | | -18.0 |
| `stage1` | Hatchling on Main Street (150 per minute) | loop | 96 | 154.1 s | [0.25, 153.85] | | -17.1 |
| `stage2` | Steel Rain (160 per minute) | loop | 104 | 156.5 s | [0.25, 156.25] | | -16.6 |
| `stage3` | Colossus Overdrive (168 per minute) | loop | 112 | 160.5 s | [0.25, 160.25] | | -16.1 |
| `final_minute` | Sixty Seconds (168 per minute) | loop, with `mark` | 42 | 60.5 s | [0.25, 60.25] | | -16.0 |
| `cocoon` | Chrysalis | one-shot | 4 | 12.5 s | | | -17.1 |
| `intermission` | Redeploy (build) | one-shot | 8 | 23.5 s | | | -16.0 |
| `win_humans` | Port Meridian Stands (fanfare) | one-shot | 5 | 14.5 s | | | -16.0 |
| `win_kaiju` | The City Falls Silent | one-shot | 5 | 14.9 s | | | -16.1 |
| `hearing` | For the Record (somber, bureaucratic) | loop | 12 | 30.5 s | [0.25, 30.25] | | -17.9 |

LUFS is Loudness Units relative to Full Scale (integrated loudness, EBU R128). Full mixes are
mastered to -16. The two beds that sit under speech (`briefing`, `hearing`) are 2 lower on
purpose, and `cocoon` is 1 lower because it plays under the game's heartbeat effect. The match
tracks get a little louder with each stage: -17, -16.5, -16, and -16 for the final minute.
Those figures were measured against the orchestral stage music they replace, which played a
calm base stem (-19, -17 and -16.6) and faded a combat stem in during fights (both together
-16.5, -15.6 and -15.0): each new track sits between its stage's calm and its full fight, because
it is never calm. The table gives the `.ogg` figures; the `.mp3` files measure within 0.2 of them.

Total size: 11.1 MB of `.ogg` and 11.8 MB of `.mp3` (the client loads one format); the four
match tracks are 8.2 MB of it (about 120 kbit/s, like the rest).

### Manifest entries

```json
"stage2": { "base": "audio/music/stage2", "loop": [0.25, 156.25], "bpm": 160, "duration": 156.5 }
```

```json
"final_minute": { "base": "audio/music/final_minute", "loop": [0.25, 60.25], "bpm": 168,
                  "duration": 60.5, "mark": 60.25 }
```

```json
"intermission": { "base": "audio/music/intermission", "bpm": 96, "duration": 23.5, "mark": 20.0 }
```

All six fields are in the contract (`docs/ASSETS.md` section 7; `group` is no longer used by any
cue since the stage stems went). `duration` is the file length in seconds. One-shots have no
`loop`, and that is how the client tells them apart: an entry without `loop` must never be
looped. `mark` is on the cues that are written to land on a game event: the moment, in seconds
from the start of the file, that must coincide with it (`intermission`: the hit at 20.0, when the
next stage begins; `cocoon`: the cut at 10.0, when the molt blast sounds; `final_minute`: the end
of its build at 60.25, the 0.25 s lead-in plus 60 s of music, when the clock runs out). Section 4
says how to use it.

## 3. What is in each cue

Every part is written within the real range of the instrument or voice, no third or second is
held below C3, and nothing but octaves and fifths is held below F2 (the build refuses to run
otherwise; clashes that pass in under a beat are allowed).

**`lobby`, The Long Watch.** 32 bars.
Bars 1 to 4, vamp: plucked basses and cellos (D and A, a slow march), field drum, bass drum, a
held D in the cellos with the violas on the fifth above it, sighing up to B flat and back, and
the theme's rhythm as a timpani signal. Bars 5 to 12, the theme low and plain: horns, cellos
and bassoon in unison over the plucked bass, violins holding a high A. Bars 13 to 20, second
strain: violins and clarinet with violas an octave below, string harmony, bowed basses, the drum
swelling back in, trombones and a timpani roll into the return. Bars 21 to 28, the theme tutti:
trumpets, horns, men's voices (joined by the altos for the second half), tremolo violins,
pulsing violas, trombones in open fifths, tuba, timpani, cymbals. Bars 29 to 32, codetta:
clarinet and bassoon echo the head motif and the texture winds down into the vamp.

**`briefing`, Situation Room.** 8 bars over a D pedal, written to stay out of the way of speech:
held basses and cellos, tremolo violas (the same B flat to A sigh), a held violin line and a
very high one, a timpani pulse on beats 1 and 3, soft field drum, and the head motif once on
English horn in bars 5 and 6. In bar 7 the harmony darkens to E flat over the pedal.

**The match tracks (round 4).** Late-1990s high-end arcade style: fast, driving drums, slap or
synth bass, bright synth leads, orchestra hits, a big hook, and enough sections that a two and a
half minute loop does not wear thin. Original music: none of it imitates any game's soundtrack.
Each is one file (the base and combat stems of the orchestral stage music before them are gone)
and plays at full strength all the time. Each loops seamlessly; its last bars lead back into its
first. The instruments are the soundfont's rock kit ("Power"), slap bass, synth basses, saw,
square and fifth-saw leads, polysynth, synth brass and strings, orchestra hit, distorted and
overdriven guitars, and the orchestra and choir of the other cues.

**`stage1`, Hatchling on Main Street (the hatchling).** 150 per minute, D minor, 96 bars
(153.6 s). The lightest of the three: funk-rock.
- Bars 1 to 8, intro: the rock groove with slap bass, a polysynth arpeggio and synth-brass stabs
  on a 3+3+2 rhythm, an orchestra hit on the downbeat; from bar 5 the riff on the square lead.
- Bars 9 to 24, verse: the square lead in two-bar phrases, answered by synth-brass stabs;
  strings and arpeggio join for the second half.
- Bars 25 to 32, pre-chorus: long rising notes on the saw lead over G minor, B flat, E flat and
  A, half-time drums, then snare on every beat and a snare roll with a cymbal swell.
- Bars 33 to 48, chorus: **the hook**, on saw lead with a square wave an octave below: three
  quick notes in a dotted 3+3+2 rhythm, then a long one (D E F, A), over D minor, B flat, F and
  C; the second phrase climbs to a high D and closes on A with a flat ninth (B flat), the
  monster's cadence. Four-on-the-floor kick with open hi-hats, a crash every four bars, a sub
  bass under the slap bass, orchestra hits on the hook's three quick notes.
- Bars 49 to 56, breakdown: Gragnor's theme on the square lead with a dotted-eighth tape echo,
  kick and hi-hat only, held strings and bass; a snare build and swell into the solo.
- Bars 57 to 72, solo: overdrive guitar, sixteenth runs and arpeggio sweeps over a ride cymbal;
  it ends on D major to lift the key.
- Bars 73 to 88, the chorus a tone up in E minor, with everything in; it turns back through C
  and A major.
- Bars 89 to 96, outro: the riff twice (the second time an octave up on the saw), a tom fill
  into bar 1.

**`stage2`, Steel Rain (the juvenile).** 160 per minute, D minor, 104 bars (156 s). Heavier:
two distorted guitars (left and right, the right one a few cents lower) on power chords and a
galloping palm-muted chug (the old stage 2's gallop, an eighth and two sixteenths), a synth bass
in octaves, the orchestra's marcato violins and timpani, choir shouts.
- Bars 1 to 8, intro: the gallop riff on D with B flat and C stabs, timpani on the accents; from
  bar 5 a synth riff on the fifth-saw lead and violins in sixteenths.
- Bars 9 to 24, verse: the fifth-saw lead over palm-muted guitars and octave bass, synth brass
  answering each phrase.
- Bars 25 to 32, pre-chorus: long rising notes on the saw lead, violins in sixteenths, half-time
  into a snare build and a timpani roll.
- Bars 33 to 48, chorus: **the hook** (A A G A, then up to D: "da, da-da, DA, DA") on the saw lead
  with the real brass section an octave below, choir shouts every two bars, timpani and
  orchestra hits every four, guitars held.
- Bars 49 to 56: Gragnor's theme, whole, as a heavy riff: saw lead, brass and fifth-saw over the
  galloping kick and guitars.
- Bars 57 to 64, breakdown: toms and timpani, choir "ooh", the hook's first bar echoing three
  times, a build.
- Bars 65 to 80, solos traded between the saw lead and the fifth saw, then both together in
  thirds, ending on D major.
- Bars 81 to 96, the chorus a tone up (E minor), turning home through B flat and A.
- Bars 97 to 104, outro: the intro again.

**`stage3`, Colossus Overdrive (the titan).** 168 per minute, D minor with the flat second
(E flat) of the monster's cadence, 112 bars (160 s). The biggest: double-kick drums, the whole
choir (sustained "aah" and shouts), brass section and horns, timpani, taiko and orchestra hits on
top of the band. The intro and the breakdown keep the 3+3+2 accents of the titan's orchestral
music before it.
- Bars 1 to 8, intro: the 3+3+2 riff on D with E flat stabs (guitars, bass, orchestra hits,
  timpani); choir and brass join on the accents from bar 5, the double kick too.
- Bars 9 to 24, verse: the saw lead in running eighths with a square wave an octave below,
  palm-muted guitars, horns, taiko.
- Bars 25 to 32, pre-chorus: long notes climbing to a high A, sopranos and tenors swelling, snare
  build, timpani roll.
- Bars 33 to 48, chorus: **the anthem hook** (a long D, a short A, D, E, then up to F: "DAA-da,
  DA, DA") on saw lead, square and brass section; horns, altos and sopranos hold the chords,
  orchestra hits and timpani on the hook's rhythm, choir shouts, a crash every two bars; its
  second phrase falls through E flat to A and home to D.
- Bars 49 to 56: Gragnor's theme for the whole choir (women in unison, tenors an octave below),
  brass section and saw lead, over a galloping kick and the 3+3+2 riff.
- Bars 57 to 64: the theme's second strain for sopranos, tenors and horns.
- Bars 65 to 72, breakdown: taiko and timpani on the 3+3+2, toms, choir "ooh", the hook echoing,
  then a build.
- Bars 73 to 88, guitar solo (overdrive), brass stabs on the accents; it ends on B flat.
- Bars 89 to 104, the chorus a semitone up (E flat minor); B flat, then A, turn it home.
- Bars 105 to 112, outro: the intro riff, back to bar 1.

**`final_minute`, Sixty Seconds.** 168 per minute, 42 bars: exactly 60.0 s. The danger version
of the titan's track, for the last minute on the clock at any stage.
- Bars 1 and 2, alarm: a siren on a square wave (A and B flat, the flat second again),
  orchestra hits and timpani on every beat.
- Bars 3 to 10, countdown: a stuttering riff on the saw lead, wood blocks ticking every beat.
- Bars 11 to 34: the stage 3 hook three times, a key higher each time: D minor, E minor, F sharp
  minor, with the whole band, choir and brass.
- Bars 35 to 42, the last ten seconds: B flat, C, then A held for four bars (the dominant of D),
  kick in eighths then sixteenths, a snare roll, a timpani roll, choir shouts on every beat, a
  cymbal swell that peaks at the very end. When the music loops, bar 1 is the D the build
  wanted; when the clock runs out instead, the win cue takes over at that moment.

**`cocoon`, Chrysalis.** One-shot, 4 bars: **exactly 10.0 s of music, then silence and ring-out**.
A choir cluster that slides slowly upward (women on A and B flat, men on D and A, sopranos
adding D and E flat), glassy tremolo violins, the head motif on celesta, and a cymbal swell
into the cut at 10.0 s, which is where the game plays the molt blast.

There is **no heartbeat in the music**, on purpose. The heartbeat players hear during the cocoon
is the game's positional sound effect (`kaiju_heartbeat_loop`): it fades with distance, and
following it is how the humans find the cocoon. Music is not positional. An earlier version of
this cue had its own drum heartbeat, which played at full level for everybody, beat at a
different rate (the music is on a 0.625 s beat, the effect beats every 0.84 s) and buried the
clue. The cue now has no drums, nothing that pulses and nothing below about 120 Hz, which is
where the effect lives.

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

### The match tracks

`stage1`, `stage2` and `stage3` are ordinary loops, one per stage, and play at full level all
the time (`client/src/audio/matchAudio.ts`). There are no stems any more: the orchestral stage
music of earlier rounds had a base and a combat stem that faded in with the fight, and the
arcade tracks are never calm, so that part of the game code went with them. (The audio engine
can still play a base and a second stem together; nothing uses it now.)

`final_minute` takes over from the stage's track when the match clock shows 60 seconds or less,
at any stage, and is loaded 20 seconds before that. It is written so that the end of its build
lands as the clock runs out: the game plays it like the intermission (below), with the moment of
`mark` (60.25 s into the file) put on the clock's zero. With a minute left it starts from the top;
with 45 s left (someone who joins late, or a stage that begins after a molt in the last minute)
it starts 15 s in. When the clock runs out the match ends and the win cue takes over; if it loops
instead (it should not), bar 1 follows seamlessly. A molt during the last minute plays the cocoon
and the intermission as usual, and the final minute comes back after them, at the right place.

### Moving between cues

The key is shared, so plain crossfades of 1 to 2 s work everywhere, also between the match
tracks and the orchestral cues at their own tempo. Four places are written to line up with the
game clock:

- **Cocoon (10 s).** Fade the stage's track out over about 1 s and start `cocoon` when the cocoon
  starts. The music stops dead at 10.0 s (`mark`), where the molt blast sound plays. The
  heartbeat is the positional effect and nothing else; the music has none.
- **Intermission.** The hit is at 20.0 s into the file (`mark`). The rule for both cues: if
  the event is `T` seconds away when the file starts, start it at offset `mark - T`. A 20 s
  intermission plays the file from the beginning; the 8 s one (no draft) starts at 12.0, which
  is a half-second pickup, the last three bars of the build and the hit. Work `T` out at the
  moment the source really starts, so that a slow load does not make the hit late. A short
  fade-in is fine (anything up to 0.6 s). Played from the top, an 8 s intermission would be the
  quietest part of the build (-22.6 LUFS) with no hit; from 12.0 it is -13.7 LUFS and ends on
  the hit.
- **Into the next stage.** Start the stage's track when the hit lands; the hit and the track's
  first chord are both D. Bring the track in quickly (0.3 s) and let the intermission ring for
  about 2.5 s instead of cutting it: the ring-out is below -30 dBFS (decibels relative to full
  scale) 1.5 s after the hit. The hit and the new track's first downbeat land together, so the
  overlap is the loudest moment of the music: measured with these fades on the decoded files it
  peaks at -0.5 dBTP into stage 2 and -1.6 into stage 3 (both formats), under the clipping point
  at full volume, and the game's music bus plays at 0.55 (-5 dB) by default.
- **The final minute.** As above: `mark` on the clock's zero.
- **Match end.** Cut the match track (0.5 s fade) and play `win_humans` or `win_kaiju`. Start the
  `hearing` loop when the hearing screen opens.

One-shots (`cocoon`, `intermission`, `win_humans`, `win_kaiju`) have no `loop` in the manifest
and must never be looped. The game code does all of the above (`client/src/audio/matchAudio.ts`
and `audioEngine.ts`; `docs/audio/client-notes-music.md` is the earlier list of what it had to
change, kept for its reasoning).

`lobby`, `briefing` and `hearing` are ordinary loops. `briefing` and `hearing` are meant to run
under the voiced lines; they are already 2 LU quieter than the rest and can be ducked a further
4 to 6 dB while someone is speaking.

## 5. How it is made

```
tools/audio/music/
  build.sh              one command: score review, render, master, encode, verify
  build.py              command-line entry (build.sh calls it)
  mbmusic/
    score.py            note notation, parts, MIDI export (each cue's own tempo; 96 by default)
    orchestra.py        the instruments: soundfont program, real range, seat, mix defaults
                        (the orchestra, and since round 4 the arcade band: rock kit, basses,
                        synth leads and pads, orchestra hit, guitars)
    theme.py            the theme, its harmony and voice leading
    patterns.py         accompaniment patterns that follow the harmony (the orchestral cues)
    arcade.py           the arcade band's writing tools: chord symbols, a rock kit on a
                        sixteenth grid, grooves and fills, bass lines, arpeggios, stabs, pads,
                        power chords, orchestra hits, a tape echo (the match tracks)
    cues/*.py           one file per cue (stage3.py also holds the band the final minute shares)
    tuning.py           intonation measurement; tuning_table.json is its committed result
    synth.py            fluidsynth render of each part, with per-note intonation correction
    dsp.py              hall reverb, filters, loop folding, limiter, loudness
    mixdown.py          mix, master, file layout, encode, manifest
    review.py           composer's review of the written score
    analyze.py          verification, spectrograms, MEASUREMENTS.md
```

`build.sh` with no arguments rebuilds everything (about twelve minutes from an empty cache on two
cores, one to five when only a few parts changed, because rendered parts are cached by content;
the four match tracks alone take about five minutes from empty); `build.sh lobby stage2`
rebuilds only those cues; `build.sh --review` prints the score review; `--no-verify` skips the
measurements. `build.py --verify-only` re-measures the files already built,
`build.py --measure-tuning` re-measures the soundfont's intonation (only needed if the soundfont
changes) and `build.py --measure-tuning-new` measures only the instruments the table does not
have yet, leaving every measured key, and so every older cue, as it was. Intermediate MIDI and WAV files go to `/tmp/mb-scratch/music` (set
`MB_SCRATCH` to move it), never into the repository. A rebuild from an empty cache produces
byte-identical `.ogg` and `.mp3` files (checked by hash).

1. **Score.** Each cue is Python that writes notes into named parts
   (`part.line(5, "D4:1.5 D4:.5 F4:2 | E4:1.5 D4:.5 C4:2", 92)`: bar 5, pitches with lengths in
   beats, bar-line checks, velocity). The theme, its bass and its three inner voices live in
   `theme.py`; the inner voices move by step and against the bass, so the harmony never doubles
   the bass in parallel.
2. **Score review** (`build.sh --review`, also run before every build, which stops on a finding):
   every note inside the instrument's real range; no thirds or seconds sounding below C3 and
   nothing but octaves and fifths below F2, checked across all parts and stems of a cue;
   one-shots not running past their end. It also prints who plays in which bar and how loud,
   and lists every minor second held between two parts for a beat or more, so that each one is
   a decision (the only ones left are the cocoon's deliberate clusters and, in the match tracks,
   passing notes of a lead against a held chord and a lead against its own echo).
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
   strings and low brass right of centre, basses near the middle), and a send to one shared hall.
   Bass parts can also take a low shelf (`sub`, corner at 80 Hz), because the samples are thin at
   the very bottom: measured note by note, the bowed basses have no fundamental below A1 (55 Hz;
   the octave above it sounds instead) and the organ's fundamental is 5 to 9 dB under its own
   octave. The rock kit's kick gets 2 dB of it. The hall is a synthetic impulse response
   (decay 2.6 s at 500 Hz, 1.5 s at 8 kHz, 22 ms pre-delay) kept out of the bass; the arcade
   band sends little to it (drums and basses almost nothing, leads and pads a little), so the
   fast tracks stay tight. The match tracks' balance was set from the same per-part, per-section
   loudness tables: the lead and the snare on top, kick and bass just under them, guitars and
   brass under those, pads and arpeggios well back.
5. **Loop folding.** A loop is rendered once with its whole ring-out; everything that rings past
   the last bar is added back onto the start. Because everything up to here is linear, the result
   is exactly the music playing forever, and the loop start equals what follows the loop end
   sample for sample (verified: the difference in the master is zero).
6. **Master.** One gain per cue to reach the loudness target, then a look-ahead limiter with a
   ceiling of -1.5 dB (a cue of several stems gets one gain curve for all of them, so any mix of
   them is safe). The limiter barely works: at most 1.6 dB of reduction, on under 5% of the
   samples, in any cue (the match tracks: stage 1 1.5 dB on 0.6%, the final minute 0.2 dB, stages
   2 and 3 none; the cocoon: none).
7. **Encode.** ffmpeg, Vorbis quality 4 and MP3 variable bit rate quality 5 (both about
   115 kbit/s for this material), with bit-exact flags so a rebuild gives identical files.

## 6. Verification

Nobody listened to this: it was verified by measurement and by looking at pictures. The numbers
are in `docs/audio/music/MEASUREMENTS.md` (regenerated by every build) and `measurements.json`.

- **Decodes, right length.** All 22 files decode; every decoded length matches the score to the
  sample (0.00 ms error; two of the new `.mp3` files are 0.66 ms long, which is silence after
  the pad and does not move the loop points), and decoded audio lines up with the master at
  offset 0 in both formats.
- **Not silent, not clipped.** True peak of every file is between -5.4 and -0.6 dBTP (the match
  tracks -0.6 to -1.8), and the loudest 0.4 s of every file is above -19 dBFS.
- **Loudness.** Full mixes -16.0 to -16.1 LUFS; beds -18.0 and -17.9; cocoon -17.1; the match
  tracks -17.1, -16.6, -16.1 and -16.0 (`.mp3` within 0.2). Loudness range 3.8 to 4.9 LU for the
  stage tracks (they are meant to be steady) and 6.4 for the final minute, which builds.
- **Shape.** Bar by bar (`MEASUREMENTS.md`, K-weighted level per bar) every stage track has a
  quiet breakdown and loud choruses, and its last chorus, a key higher, is as loud as the first:
  stage 1 breakdown -20 to -22 against -15 to -16.5 in the choruses; stage 2 -17 to -21 against
  -14.5 to -16; stage 3 -17 to -21 against -13.7 to -14.8. The final minute goes -17 to -18 for
  the alarm, -19.5 to -20 for the countdown, -15.4 to -17.3 for the three keys of the hook, and
  -14.4, -14.5, -13.7, -13.9, -14.1, -13.3, -12.4, -11.4 through the eight bars of its last ten
  seconds.
- **Loops are continuous.** In the master the loop is exactly periodic. In the encoded files the
  200 ms around the loop end repeat the 200 ms around the loop start as closely as the codec
  allows (within about 3 dB of the codec's own error), the sample step across the splice is
  ordinary (0.01 to 1.5 times the 99th percentile of the steps around it; a click would be many
  times that), and the jump adds no onset energy (within 0.5 dB of playing straight through).
  Pictures: `docs/audio/music/<id>_seam_ogg.png` and `_seam_mp3.png` show the last 2 s before the
  loop end followed by the first 2 s after the loop start, with a 20 ms waveform across the
  splice.
- **Structure.** `docs/audio/music/<id>.png` are spectrograms with the sections marked; the
  bar-by-bar loudness table in `MEASUREMENTS.md` shows each build (for example the lobby goes
  -21, -18, -18 rising to -14, -13 for the tutti, back to -21).
- **Beat grid.** The strongest onsets of every loop sit within 16 ms (median) of the
  sixteenth-note grid of its own tempo counted from the loop start (the match tracks within
  3 to 5 ms); most of that is instrument attack time.
- **Spectrum.** The match tracks are brighter and heavier at the bottom than the orchestral cues,
  as the style wants: relative to the 500 Hz octave the 63 Hz octave is +1 to +7 dB (the lobby
  -4) and the 4 to 8 kHz octaves -5 to 0 (the lobby -12 to -21).
- **Stereo and mono.** Left and right are within 1.5 dB of each other in every file; summing to
  mono loses 1 to 2.5 dB of loudness (no cancellation).
- **Intonation.** After correction, spot checks of choir, strings, timpani, plucked strings,
  horns and woodwind are within 1 cent of equal temperament (they were up to 48 cents out).
- **Repeatable.** Two builds from an empty cache gave byte-identical files. After the review
  changes below, a rebuild of all thirteen cues left the sixteen files of the eight untouched
  stems bit for bit as they were. Round 4 changed the tools (each cue's own tempo, the arcade
  band's instruments, measuring only new instruments' intonation); the briefing and the cocoon,
  rebuilt before and after the change, came out with identical masters, and the intonation
  table only gained the new instruments.

### After the sound review

An independent review measured every file and asked for four changes. Each was made in the
score and proved on the rebuilt files (all figures from the `.ogg`; the `.mp3` agrees within
0.1 dB). Two of them were about the orchestral stage stems that round 4 replaced, and are kept
for the record.

- **Weight at the bottom grows with the stage** (the stage stems before round 4). Before, the
  biggest stage was the lightest down there. Level in two low bands over the whole file, in
  dBFS (the reviewer's yardstick: mono sum, fourth-order band-pass):

  | | 30 to 60 Hz before | now | 60 to 120 Hz before | now |
  | --- | ---: | ---: | ---: | ---: |
  | `stage1_base` | -32.6 | -32.6 | -28.7 | -28.7 |
  | `stage2_base` | -43.6 | -31.1 | -32.1 | -27.5 |
  | `stage3_base` | -44.6 | -29.9 | -32.4 | -25.8 |
  | stage 1 pair | -30.9 | -30.9 | -26.5 | -26.5 |
  | stage 2 pair | -37.1 | -30.4 | -27.9 | -26.0 |
  | stage 3 pair | -35.8 | -29.1 | -26.4 | -23.8 |

  The review's target for `stage3_base` was -32 or higher and -27 or higher. Stage 1 gets its
  figure from eight bars of loud plucked bass and is nearly empty down there the rest of the
  time (a typical bar is at -44 in the 30 to 60 Hz band); stages 2 and 3 are now steady (a
  typical bar at -31 and -30, quietest bar -36 and -32). In the pictures the bottom of
  `stage3_base.png` is one continuous dark band where it used to be blank.
- **The cocoon has no heartbeat of its own.** Below 120 Hz the music is at -48.6 dBFS (it was
  -25.6, with eleven drum pulses at -21 to -15); the 30 to 60 Hz band is at -85 (was -30) and
  the 60 to 120 Hz band at -64 (was -27). The game's heartbeat effect beats at -15 dBFS in that
  range, so the music leaves it alone. The rest of the cue is as loud as it was, within 0.1 dB
  (the cue as a whole is 1 LU lower because the drums are gone), and it still swells into the
  cut: second by second -28, -23, -20, -20, -19, -19, -18, -17, -15, -12, then the cut.
- **The combat stems never drop out** (before round 4). Bar by bar the combat stems read -25 to
  -26 in bars 17 to 20 of stage 2 (they were -28 to -31) and -24 to -25 in bars 9 to 12 of
  stage 3 (they were -27 to -30), against -18 to -24 everywhere else.
- **The intermission in 8 seconds.** Nothing in the file changed; the manifest now says where
  the hit is (`mark`). Cut from the file as the game should play it: from 0.0 s an 8 s
  intermission is -22.6 LUFS with no hit; from 12.0 s it is -13.7 LUFS, rising second by second
  from -18 to -12, and the hit lands as the stage begins. Followed by the first bar of the
  orchestral stage stems of the time, the overlap peaked at -2.9 dBTP with the base stem and
  -1.2 dBTP with the combat stem as well; the round 4 tracks' figures are in section 4.

## 7. Known weaknesses

- It is a 2008 General MIDI soundfont. The strings and choir are recognisably sampled, the
  choir can only sing "aah" and "ooh", there are no true legato transitions, and drum rolls are
  written out as single strokes, which can sound mechanical when exposed (the lobby vamp, the
  intermission).
- Balance was set from loudness tables per part and section and from spectra, not by ear. A
  listening pass by a person may want a few decibels here and there; the gains are one number
  per part in `cues/*.py`.
- The orchestra is dark above 5 kHz (the samples have little there); the percussion carries the
  top end, so the orchestral cues sound mellower than the match tracks.
- A loop's first pass already contains the reverb tail of "the previous pass" at its very start,
  and the file begins with a quarter-second fade-in before the first downbeat. Both are by
  design (they are what makes the loop seamless) but they are audible on the first play if you
  listen for them.
- **The match tracks (round 4) have not been heard by anyone.** They were written note by note,
  checked by the score review, and verified by measurement and spectrogram, but whether the hooks
  are catchy, whether the guitars sound like guitars and whether two and a half minutes wear thin
  is for the owner's ears. Everything is one number away: tempo, gains, the melodies themselves
  in `cues/stage1.py`, `stage2.py`, `stage3.py` and `final_minute.py`.
- The soundfont's synth leads, slap bass and distorted guitars are 1990s-style samples, which
  suits the brief, but the guitar solos are written-out notes without bends or slides, and the
  drum kit has one sample per drum and level, so fills can sound mechanical.
- The intermission's hit and the next stage's first downbeat land together: the overlap peaks at
  -0.5 dBTP at full volume (section 4). Under the clipping point, and the music bus plays well
  below full, but it is the loudest moment of the music.
- The final minute's countdown section (bars 3 to 10) is quieter than its alarm, on purpose (it
  builds from there), so the first seconds after the alarm may feel like a dip.
