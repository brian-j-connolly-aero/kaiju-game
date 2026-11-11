"""The hand-written parts of docs/audio/VOICE.md. The tables come from docgen.py."""

INTRO = """\
Every spoken line in the game as a finished sound file: **{lines} lines, {speakers} voices,
{total_s:.0f} seconds of audio**, each as `.ogg` (Vorbis) and `.mp3`
({ogg_mb:.1f} MB and {mp3_mb:.1f} MB in total). The words come from the script,
`shared/src/defs/voiceLines.json` (readable copy: `docs/VOICE_SCRIPT.md`); this page is about how
they are spoken, processed and checked.

- Sound files: `client/public/assets/audio/voice/<lineId>.ogg` and `.mp3`
- Manifest: `client/public/assets/manifest.voice.json` (section `voice`, with each line's length)
- Generator: `tools/audio/voice/` (`build.sh` rebuilds only what changed)
- Numbers behind this page: `docs/audio/voice/measurements.json`, `audition.json`, `experiments.json`

The voices are made by free speech synthesizers that run on the build machine with no network.
**Natural-sounding neural voices were not available on this machine**, so every voice here is
recognizably synthetic: clear, steady and humorless, which suits the deadpan tone, but nobody
will mistake it for an actor. Section 8 explains how to swap in a better synthesizer later; it
is one function.

Nobody listened to these files while they were made (the build machine has no ears). Every
decision below was taken from measurements: a speech recognizer transcribes each clip and the
words it gets wrong are counted, and loudness, peaks, bandwidth, timing and spectrograms are
checked. The last build finished with **{failures} failed checks**. A human listening pass is
still worth doing; section 7 says what to listen for.
"""

CAST_NOTES = """\
"Pitch" is the middle (median) pitch of the voice measured on the unprocessed synthesizer output
of that character's lines; "pace" is words per second while speaking. The three squad voices and
Overlord share one radio channel, so they are spread out on purpose: three different speakers,
pitched roughly 105, 140 and 185 Hz, with Overlord the slowest and lowest.

Why these voices:

- **Overlord** is RHVoice `bdl`, the most intelligible voice on the machine by a wide margin, and
  the only one that stays clear on the radio almost whatever is done to it. Slowed to 88% speed
  and lowered to 82% pitch it loses nothing measurable, so the gravity is free. Command also gets
  the cleanest radio (wider band, less static): it is the base station, the squads are in the
  field.
- **Granite** is Flite `rms`, the deepest natural voice available. Lowering it further with a
  pitch shifter was tried and rejected: two semitones down tripled the error rate.
- **Beacon** is RHVoice `clb`, a precise female voice, spoken slightly faster than the others.
- **Tempest** is RHVoice `alan`, a male voice with a Scottish accent, noticeably higher than
  Granite and Overlord. It is the weakest radio voice by the numbers; the recognizer was trained
  on American speech and marks the accent down on every chain, so part of that is the instrument.
  The other candidates were worse (Flite `awb` is the same speaker in a rougher synthesizer) or
  already in use.
- **Anchor** is RHVoice `slt`, a female voice with the widest frequency range on the machine
  (up to 12 kHz), which is what a clean broadcast voice needs. Pico was the expected choice for
  the anchor and lost on the numbers: about two and a half times the word errors.
- **Chair** is Pico `en-US`, slowed to 90% and lowered to 78% pitch, in the hall. Pico is the only
  speaker left that is not already a radio or news voice, so the hearing does not sound like
  Overlord or the anchor reading the verdict.

Several voices on this machine are the same recorded person inside different synthesizers
(`slt` exists in RHVoice, Flite and Festival; RHVoice `alan` and Flite `awb` are one speaker), so
there are six usable speakers, not sixteen. All six are in use, one per character.
"""

AUDITION_INTRO = """\
Each voice spoke all the lines at its default settings; the recognizer's transcript was compared
with the subtitle text. Lower is better. The recognizer's own floor on this script is about 6%
(it never gets "volley" and often swaps "a" for "the", whoever is speaking).
"""

AUDITION_REMARKS = {
    "rhvoice bdl": "Cast: Overlord",
    "rhvoice clb": "Cast: Beacon",
    "flite rms": "Cast: Granite",
    "rhvoice slt": "Cast: Anchor",
    "rhvoice alan": "Cast: Tempest",
    "pico en-US": "Cast: Chair (lowered and slowed)",
    "flite kal16": "Robotic (older technique); not needed",
    "festival slt (hts)": "Same speaker as RHVoice `slt`, less clear",
    "flite awb": "Same speaker as RHVoice `alan`, less clear",
    "flite slt": "Same speaker as RHVoice `slt`, less clear",
    "pico en-GB": "British accent the recognizer cannot follow; pleasant but unverifiable",
    "rhvoice evgeniy-eng": "Heavy accent; half the words lost",
    "espeak en-us": "Robotic; the recognizer loses nine words in ten",
    "espeak en-gb": "Robotic; as above",
    "espeak en-gb-x-rp": "Robotic; as above",
    "espeak en-gb-scotland": "Robotic; as above",
}

ESPEAK_VARIANTS = """\
eSpeak NG also ships {n} voice variants (male, female, whisper, croak and so on). All of them were
auditioned on a sample of {lines} lines. None is usable: the median variant loses {median:.0f}% of the
words. Best: {best}. Worst: {worst}. eSpeak's buzzy formant sound is very clear to people who are
used to it and nearly opaque to this recognizer, so these numbers overstate how bad it is, but no
variant came close to the voices that were cast.
"""

EXPERIMENTS_INTRO = """\
Before settling the chains, candidate voice settings were run through a first version of each
chain (radio with 7 dB of overdrive and an unducked static bed at -30 dB; hall with reverberation
at -12 dB and early reflections at -9 dB). The first-pass chains were harsher than the final ones,
so the "through the chain" numbers here are worse than the finished lines in section 4; what
matters in these tables is the order of the candidates.
"""

CHAINS_INTRO = """\
All chains work at 44.1 kHz. Before its chain, every line is trimmed of leading and trailing
silence and its pauses between sentences are brought within the limits in the table at the end of
this section (synthesizers leave anything from 0.2 to 0.7 s). After its chain, every line is set
to **{target} LUFS** (Loudness Units relative to Full Scale: the broadcast measure of how loud
something sounds, integrated over the clip with silence gated out) and peak-limited to
{ceiling} dBTP (decibels true peak) so that lossy encoding cannot clip. That is the same loudness
as the full music mixes, so voice sits level with the music and the client should duck the music
under speech (section 3).
"""

CHAIN_TEXT = {
    "radio": """\
What a field radio does to a voice, in this order: band-pass (the corners are `band_hz`), a small
resonant peak where a handset speaker honks, a fast compressor with look-ahead (the automatic
gain control of the set), a soft clipper for light overdrive, and the band-pass again. Under it
lies a static bed (hiss with slow flutter and sparse crackle) that drops while a word is spoken
and comes back in the gaps, the way a receiver's noise does. At the start a key click and a
55 ms falling burst of static; at the end a 95 ms squelch tail that is cut off, and the key click.
Static and squelch pass through the same band-pass as the voice. Mono.
""",
    "broadcast": """\
A news studio microphone: low rumble removed, a little warmth, presence and air, gentle
compression, and a faint studio tone under everything (air-conditioning rumble, a trace of hiss
and mains hum, 44 dB below the voice) so the anchor does not speak out of dead digital silence.
Mono.
""",
    "hall": """\
A large hearing room, built as an impulse response: twelve early reflections from walls, floor
and ceiling over the first 110 ms, then a diffuse tail that takes `rt60_s` seconds to die away
(faster in the treble). The reverberation is turned down while a word is being spoken and comes
up in the pauses and after the last word, which is how film dialogue keeps its words in a big
room. The room rings for `ring_s` seconds after the last word. Stereo: the voice is in the
middle, the room is wide.
""",
}

SWEEPS_INTRO = """\
One setting changed at a time, measured on real lines (word error rate of the finished clip;
"unprocessed" is the same lines straight from the synthesizer). The recognizer is much less
tolerant of noise, distortion and reverberation than a person, so these sweeps err on the side of
clarity. Differences of two or three points are within the noise of the measurement.
"""

CLIENT = """\
- **Files and manifest.** `manifest.voice.json` has one entry per line id:
  `{ "base": "audio/voice/<lineId>", "duration": seconds }`. `duration` is the length of the whole
  file including squelch or reverb tail (the `.mp3` can be up to 0.05 s longer because of frame
  padding). Use it to time subtitles and to queue lines.
- **Do not add `radio_open` / `radio_close` around these files.** The radio lines already begin
  with a key click and end with a squelch tail (about 0.09 s before the first word and 0.14 s
  after the last). Those two effects from the sound-effects set remain useful for radio moments
  without a voice line.
- **One line at a time per listener.** Radio lines are mono and sit in one band; two at once turn
  to mush. Queue them; drop a queued line if it is more than about three seconds stale. The
  briefing lines are meant to play back to back in script order with about 0.3 s between them.
- **Duck the music.** Lines are mastered to -16 LUFS, the same as the full music mixes. Lower the
  music by 6 dB (4 to 6 dB for `briefing` and `hearing`, which are already quieter) while a line
  plays, and let loud sound effects win over chatter.
- **The hearing lines are stereo** (the room is wide); everything else is mono. Play voice lines
  flat, not positioned in the 3D scene.
- **Subtitles** come from the `text` field of the script, never from this folder. Two radio lines
  are spoken from a respelling (section 5); the subtitle is unchanged.
- **Who speaks.** The script's `speaker` field has the name for the subtitle label. Squads
  without a voice of their own (the fourth squad, "Anvil") fall back to Overlord's lines, as
  `pickVoiceLine` in `shared/src/defs/voice.ts` already does.
"""

ASR_INTRO = """\
The recognizer is pocketsphinx with its stock American English models (nothing tuned to our
script; every script word is in its dictionary). Each clip is transcribed four times: straight
from the synthesizer, as the finished master, and decoded back from the `.ogg` and the `.mp3`
that ship. Word error rate is wrong, missing and extra words divided by the words in the
subtitle. A person hears far better than this recognizer, so the numbers are a floor, useful for
comparing voices and settings and for finding lines that need attention.
"""

ASR_READING = """\
How to read it: the "unprocessed" column is the synthesizer and the recognizer's own limits; the
gap to the right of it is what the chain costs. The broadcast chain costs almost nothing. The
radio chain costs the most, as it should: it removes everything below 330 Hz and above 3.3 kHz,
which people are used to from telephones and the recognizer is not. Encoding to `.ogg` or `.mp3`
changes little.
"""

WEAK_INTRO = """\
The lines the recognizer does worst on, from the decoded `.ogg`. These are the ones to listen to
first and the first candidates for a rewrite or a respelling.
"""

WEAK_AFTER = """\
Patterns in the misses: single-word radio sentences ("Charged.", "Contact.", "Time.") give the
recognizer nothing to hold on to; callsigns at the start of a line ("Granite", "Beacon",
"Tempest") are rare words it does not expect; "volley" is never recognized from any voice. None
of these is a pronunciation fault, and a listener with the subtitle in front of them will have no
trouble, but short one-word lines are the ones most likely to be lost under game noise.
"""

PRONOUNCE_INTRO = """\
`tools/audio/voice/pronounce.json` holds what is fed to the synthesizer where the plain text
comes out wrong. The subtitle text is never changed. Respellings can be per word (for every
voice, or for one engine or one engine and voice) or a whole replacement line. Each was accepted
only when it lowered the recognizer's errors on the lines it touches without raising them
elsewhere.
"""

MEASURE_INTRO = """\
Measured on the encoded files after decoding them again with `ffmpeg` (`.ogg` at quality
{ogg_q}, `.mp3` at variable bit rate quality {mp3_q}; 44.1 kHz). Target loudness {target} LUFS.
"""

CHECKS_PASSED = """\
Every check passed on every file: both formats exist and decode at 44.1 kHz with the expected
channel count; length matches the manifest; loudness within 0.8 LU of the target; true peak below
-0.5 dBTP; clean start and end (no clicks from cut waveforms); radio lines band-limited; no line
longer than 8 s (13 s for the hearing) or slower than 1.1 s per word; nothing in the folder that
is not in the script.
"""

WEAK_POINTS = """\
- **The voices are synthetic.** Flat intonation, no acting, and the same sentence melody every
  time. Overlord cannot sound grim, only slow and low. This is the main limit and only a better
  synthesizer or actors will lift it (section 8).
- **Nobody has heard these.** Loudness, peaks, band, timing and word recognition are measured;
  whether Granite sounds like a veteran is not measurable. A listening pass should check: that
  the three squads are told apart at once; that the squelch at each end is noticeable but not
  annoying after fifty lines; that the hall on the chair reads as a big room and not as a
  bathroom; that the lowered Pico voice for the chair sounds grave and not ill.
- **Tempest is the least clear radio voice** by the recognizer (see section 4). If it is hard to
  follow by ear as well, the quickest fix is to give Tempest RHVoice `bdl` at a higher pitch
  (one line in `cast.json`), at the cost of sounding more like Overlord.
- **The chair's reverberation is a compromise.** It is held down under the words so they stay
  clear, and blooms in the pauses and at the end. In a recognizer's ears it still costs words;
  for a person with subtitles on the end screen it should be comfortable.
- **Two voices are band-limited at the source.** RHVoice `clb` and `alan` and Pico stop at about
  7.5 kHz. On the radio that does not matter (everything above 3.7 kHz is removed anyway); the
  chair sounds a little duller than the anchor.
- **Granite's synthesizer (Flite) has a slightly rougher, buzzier sound** than the RHVoice
  voices. Under the radio chain most of that is masked, and it suits the character, but it is
  the lowest-fidelity voice in the cast.
- **One-word lines** are short of cues for any listener in a noisy match. If playtests show they
  get lost, the script is the place to fix it.
"""

SWAP = """\
Everything that touches a speech engine is in one function:
`synthesize(text, voice)` in `tools/audio/voice/mbvoice/synth.py`. It takes the text to speak and
a voice description from `cast.json` and returns mono samples and their sample rate. To use a
better synthesizer (a neural voice, a cloud service used at build time, or recordings of
actors):

1. Add a branch for a new `engine` name in `synthesize` that returns the samples for the text
   (for recordings: load `recordings/<lineId>.wav`).
2. Point the speakers in `cast.json` at it (`"voice": {{ "engine": "<new>", "voice": "<name>" }}`).
3. Run `tools/audio/voice/build.sh`. Trimming, pauses, the radio, broadcast and hall chains,
   loudness, encoding, the manifest, the recognizer check and this page all follow unchanged.

With natural voices the radio chain can afford to be rougher again: raise `drive_db` and
`static_db` for the squads in `cast.json` and watch the error table.
""".replace("{{", "{").replace("}}", "}")

REBUILD = """\
```
tools/audio/voice/build.sh                 # build what changed, verify, regenerate this page
tools/audio/voice/build.sh --force         # rebuild every line
tools/audio/voice/build.sh 'v_clock_*'     # only matching line ids
tools/audio/voice/build.sh --verify-only   # re-measure the files that are there
tools/audio/voice/audition.py raw          # re-run the audition (then: audition.py espeak, audition.py summary)
tools/audio/voice/experiments.py <group>   # re-run casting and chain experiments (then: experiments.py summary)
npm run assets:manifest                    # merge manifest.voice.json into manifest.json
```

A line is rebuilt when its spoken text (script text or respelling), its speaker's voice or chain
settings in `cast.json`, or the processing code changed; `tools/audio/voice/build_state.json`
remembers what each file was built from. The build is seeded per line, so rebuilding gives the
same audio. A full build takes a few minutes on two cores. Intermediate WAV files go to
`/tmp/mb-scratch/voice/`, never into the repository. Outputs are in `{out}`.
"""
