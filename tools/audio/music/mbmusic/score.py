"""Score notation: parts made of notes on one shared tempo grid.

Everything in the soundtrack sits on one grid: 96 beats per minute, 4/4, so one bar is exactly
2.5 seconds (110250 samples at 44.1 kHz). Positions are in beats from the start of the cue;
bar numbers are 1-based like a printed score.
"""
from __future__ import annotations

import math
import random
import re
import zlib
from fractions import Fraction

import mido

PPQ = 480
BPM = 96
BEATS_PER_BAR = 4
SEC_PER_BEAT = 60.0 / BPM
BAR_SECONDS = SEC_PER_BEAT * BEATS_PER_BAR

_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def pitch(name: str) -> int:
    """'D4' -> 62 (middle C is C4 = 60)."""
    m = re.fullmatch(r"([A-G])([#b]?)(-?\d)", name)
    if not m:
        raise ValueError(f"bad pitch name {name!r}")
    acc = {"#": 1, "b": -1, "": 0}[m.group(2)]
    return 12 * (int(m.group(3)) + 1) + _PC[m.group(1)] + acc


def pitch_name(p: int) -> str:
    return f"{_NAMES[p % 12]}{p // 12 - 1}"


def B(bar: float, beat: float = 1.0) -> float:
    """Absolute beat position of (1-based bar, 1-based beat)."""
    return (bar - 1) * BEATS_PER_BAR + (beat - 1)


def _dur(text: str) -> float:
    return float(Fraction(text)) if "/" in text else float(text)


class Part:
    """One instrument line (one MIDI channel, rendered on its own so it can be mixed)."""

    def __init__(self, name: str, inst: str, *, gain: float = 0.0, pan: float | None = None,
                 rev: float | None = None, width: float | None = None, ofs: int | None = None,
                 atk_ms: float | None = None, tune: float = 0.0, hp: float | None = None,
                 lp: float | None = None, sub: float | None = None, human_ms: float | None = None,
                 human_vel: int = 4, role: str = ""):
        from .orchestra import INSTRUMENTS
        self.name = name
        self.inst = INSTRUMENTS[inst]
        self.gain = gain                      # dB trim on top of the instrument default
        self.pan = self.inst.pan if pan is None else pan
        self.rev = self.inst.rev if rev is None else rev
        self.width = self.inst.width if width is None else width
        self.ofs = self.inst.ofs if ofs is None else ofs          # sample start offset (marcato)
        self.atk_ms = self.inst.atk_ms if atk_ms is None else atk_ms
        self.tune = tune                      # cents, for section detune
        self.hp = self.inst.hp if hp is None else hp
        self.lp = self.inst.lp if lp is None else lp
        self.sub = self.inst.sub if sub is None else sub          # dB of low-shelf lift (bass weight)
        self.human_ms = self.inst.human_ms if human_ms is None else human_ms
        self.human_vel = human_vel
        self.role = role or self.inst.family  # melody / bass / pad / ostinato / perc: for the review
        self.notes: list[tuple[float, float, int, int]] = []     # start beat, beats, pitch, velocity
        self.ccs: list[tuple[float, int, int]] = []              # beat, controller, value
        self.bends: list[tuple[float, int]] = []                 # beat, -8192..8191

    # ---- writing notes -------------------------------------------------------------------
    def note(self, start: float, p: int | str, dur: float, vel: int) -> None:
        if isinstance(p, str):
            p = pitch(p)
        self.notes.append((float(start), float(dur), int(p), int(max(1, min(127, round(vel))))))

    def line(self, bar: float, text: str, vel: int = 80, *, beat: float = 1.0, gate: float = 0.92,
             tr: int = 0, cresc: tuple[int, int] | None = None, min_gap: float = 0.0) -> float:
        """Write a line in a compact text notation and return the beat where it ends.

        Tokens are separated by spaces:
          D4:1.5      a note, 1.5 beats long          D3+A3+D4:2   a chord
          r:1         a rest                           |            bar-line check (must land on a bar)
          @96         set the velocity from here on
        Suffixes after the duration:  >  accent   ^  heavy accent   ,  ghost (soft)
                                      '  staccato  _  full length (tenuto / slur into the next)
        Durations are in beats and may be fractions (1/3). `tr` transposes in semitones.
        """
        start = B(bar, beat)
        tokens = text.split()
        total = sum(_dur(t.split(":")[1].rstrip(">^,'_")) for t in tokens if ":" in t)
        pos = 0.0
        v = vel
        for tok in tokens:
            if tok == "|":
                at = start + pos
                if abs(at / BEATS_PER_BAR - round(at / BEATS_PER_BAR)) > 1e-6:
                    raise ValueError(f"{self.name}: bar line at beat {at} is not on a bar "
                                     f"(line starting bar {bar}): {text!r}")
                continue
            if tok.startswith("@"):
                v = int(tok[1:])
                continue
            head, rest = tok.split(":")
            mods = ""
            while rest and rest[-1] in ">^,'_":
                mods = rest[-1] + mods
                rest = rest[:-1]
            d = _dur(rest)
            if head != "r":
                nv = v
                if cresc is not None and total > 0:
                    nv = cresc[0] + (cresc[1] - cresc[0]) * pos / total
                if ">" in mods:
                    nv += 14
                if "^" in mods:
                    nv += 26
                if "," in mods:
                    nv -= 22
                g = gate
                if "'" in mods:
                    g = min(gate, 0.45)
                if "_" in mods:
                    g = 1.0
                sounding = max(d * g, min(d, 0.08)) - min_gap
                for name in head.split("+"):
                    self.note(start + pos, pitch(name) + tr, sounding, nv)
            pos += d
        return start + pos

    def hits(self, bar: float, pattern: str, key: int | str, *, levels: dict[str, int] | None = None,
             step: float = 0.25, dur: float = 0.2, scale: float = 1.0) -> None:
        """Rhythm pattern on a grid (default sixteenths), one character per step, for one bar or
        more.  X accent, x normal, o soft, g ghost, . rest.  Spaces and | are ignored."""
        lv = {"X": 112, "x": 90, "o": 68, "g": 44}
        if levels:
            lv.update(levels)
        if isinstance(key, str):
            key = pitch(key)
        i = 0
        for ch in pattern:
            if ch in " |":
                continue
            if ch != ".":
                self.note(B(bar) + i * step, key, dur, lv[ch] * scale)
            i += 1

    def roll(self, start: float, beats: float, key: int | str, v0: int, v1: int, *,
             step: float = 1 / 12, dur: float = 0.2, curve: float = 1.0, alt: int | None = None) -> None:
        """Drum roll written out as single strokes with a crescendo or diminuendo. `alt` is a
        second sample of the same drum for every other stroke (left hand, right hand), which
        keeps the roll from sounding like one sample repeated."""
        if isinstance(key, str):
            key = pitch(key)
        n = max(1, int(round(beats / step)))
        for i in range(n):
            f = (i / max(1, n - 1)) ** curve
            v = v0 + (v1 - v0) * f
            self.note(start + i * step, alt if (alt is not None and i % 2) else key, dur,
                      v - (5 if i % 2 else 0))

    def expr(self, points: list[tuple[float, int]], cc: int = 11, step: float = 0.125) -> None:
        """Expression (volume swell) curve: linear ramps between (absolute beat, 0..127)."""
        points = sorted(points)
        for (b0, v0), (b1, v1) in zip(points, points[1:]):
            n = max(1, int(round((b1 - b0) / step)))
            for i in range(n):
                self.ccs.append((b0 + (b1 - b0) * i / n, cc, int(round(v0 + (v1 - v0) * i / n))))
        self.ccs.append((points[-1][0], cc, int(points[-1][1])))

    def bend(self, points: list[tuple[float, float]], step: float = 0.0625) -> None:
        """Pitch bend curve in semitones (range +/-2): linear ramps between (beat, semitones)."""
        points = sorted(points)
        for (b0, v0), (b1, v1) in zip(points, points[1:]):
            n = max(1, int(round((b1 - b0) / step)))
            for i in range(n):
                s = v0 + (v1 - v0) * i / n
                self.bends.append((b0 + (b1 - b0) * i / n, int(max(-8192, min(8191, s / 2 * 8192)))))
        self.bends.append((points[-1][0], int(max(-8192, min(8191, points[-1][1] / 2 * 8192)))))

    # ---- export ----------------------------------------------------------------------------
    def end_beat(self) -> float:
        return max((s + d for s, d, _, _ in self.notes), default=0.0)

    def timed_notes(self, seed_text: str) -> list[list]:
        """The notes as they will be played: [start beat, end beat, pitch, velocity], with the
        section's small timing and velocity looseness applied (seeded, so every build is the same)."""
        rng = random.Random(zlib.crc32(f"{seed_text}/{self.name}".encode()))
        # one small timing offset per attack point (a section plays together), a little extra
        # per note, and a few points of velocity
        jitter_by_start: dict[float, float] = {}
        timed = []
        for start, dur, p, vel in sorted(self.notes):
            base = jitter_by_start.setdefault(start, rng.gauss(0, self.human_ms) / 1000.0 / SEC_PER_BEAT)
            j = base + rng.gauss(0, self.human_ms * 0.3) / 1000.0 / SEC_PER_BEAT
            s = max(0.0, start + j)
            v = max(1, min(127, vel + rng.randint(-self.human_vel, self.human_vel)))
            timed.append([s, max(s + 0.03, start + dur), p, v])
        # a repeated pitch must be released before it is struck again, or the old note-off
        # would silence the new note
        last_on_pitch: dict[int, list] = {}
        for n in sorted(timed, key=lambda n: n[0]):
            prev = last_on_pitch.get(n[2])
            if prev is not None and prev[1] > n[0] - 0.02:
                prev[1] = max(prev[0] + 0.01, n[0] - 0.02)
            last_on_pitch[n[2]] = n
        return timed

    def to_midi(self, total_beats: float, timed: list[list], tune_cents: float = 0.0) -> mido.MidiFile:
        """One-track MIDI file for this part (or for the subset of its notes in `timed`, which
        is how the synth renders each intonation group). `total_beats` fixes the render length."""
        inst = self.inst
        ch = 9 if inst.drums else 0
        ev: list[tuple[int, int, mido.Message]] = []      # tick, order, message

        def add(beat: float, order: int, msg: mido.Message) -> None:
            ev.append((max(0, int(round(beat * PPQ))), order, msg))

        def cc(beat: float, control: int, value: int, order: int = 1) -> None:
            add(beat, order, mido.Message("control_change", channel=ch, control=control,
                                          value=max(0, min(127, int(value)))))

        def nrpn(gen: int, value: int) -> None:
            v = max(0, min(16383, int(value) + 8192))
            cc(0, 99, 120, 0)
            cc(0, 98, gen, 0)
            cc(0, 38, v & 127, 0)        # fluidsynth applies the value when the MSB (6) arrives,
            cc(0, 6, v >> 7, 0)          # so the LSB has to be sent first

        if inst.bank and not inst.drums:
            cc(0, 0, inst.bank, 0)
        add(0, 0, mido.Message("program_change", channel=ch, program=inst.program))
        cc(0, 7, 100, 0)
        cc(0, 10, 64, 0)
        cc(0, 91, 0, 0)
        cc(0, 93, 0, 0)
        if not any(c == 11 and b <= 0 for b, c, _ in self.ccs):
            cc(0, 11, 127, 0)
        if self.ofs:
            nrpn(0, self.ofs)                                # sample start offset, in samples
        if self.atk_ms:
            # volume-envelope attack: generator 34, timecents relative to the 1 ms default, scale 2
            nrpn(34, int(round(1200 * math.log2(self.atk_ms / 1.0) / 2)))
        if tune_cents:
            nrpn(52, int(round(max(-99, min(99, tune_cents)))))   # fine tune in cents
        for beat, control, value in self.ccs:
            cc(beat, control, value)
        for beat, value in self.bends:
            add(beat, 1, mido.Message("pitchwheel", channel=ch, pitch=value))
        for s, e, p, v in timed:
            add(s, 3, mido.Message("note_on", channel=ch, note=p, velocity=v))
            add(e, 2, mido.Message("note_off", channel=ch, note=p, velocity=0))

        ev.sort(key=lambda e: (e[0], e[1]))
        mid = mido.MidiFile(ticks_per_beat=PPQ)
        track = mido.MidiTrack()
        mid.tracks.append(track)
        track.append(mido.MetaMessage("set_tempo", tempo=int(round(60_000_000 / BPM)), time=0))
        now = 0
        for tick, _, msg in ev:
            track.append(msg.copy(time=tick - now))
            now = tick
        end = max(now, int(round(total_beats * PPQ)))
        track.append(mido.MetaMessage("end_of_track", time=end - now))
        return mid


class Stem:
    """A group of parts that is mixed down to one audio file."""

    def __init__(self, name: str):
        self.name = name
        self.parts: list[Part] = []

    def add(self, name: str, inst: str, **kw) -> Part:
        p = Part(name, inst, **kw)
        self.parts.append(p)
        return p


class Cue:
    """One piece of music: a loop or a one-shot, made of one stem or a base and a combat stem."""

    def __init__(self, name: str, bars: float, *, loop: bool, group: str | None = None,
                 title: str = "", tail_seconds: float = 0.0, sections: list[tuple[int, str]] | None = None,
                 target_lufs: float = -16.0, notes: str = "", mark: float | None = None):
        self.name = name
        self.bars = bars
        self.loop = loop
        self.group = group
        self.title = title
        self.tail_seconds = tail_seconds      # one-shots: ring-out after the last bar
        self.sections = sections or []        # (first bar, label) for spectrogram annotation
        self.target_lufs = target_lufs        # of the full mix (all stems together)
        self.notes = notes
        # one-shots written to land on a game event: seconds into the file of that moment (the
        # intermission's hit, the cocoon's cut). It goes into the manifest so the game can start
        # the file late and still land on time.
        self.mark = mark
        self.stems: list[Stem] = []

    def stem(self, name: str) -> Stem:
        s = Stem(name)
        self.stems.append(s)
        return s

    @property
    def beats(self) -> float:
        return self.bars * BEATS_PER_BAR

    @property
    def seconds(self) -> float:
        return self.bars * BAR_SECONDS
