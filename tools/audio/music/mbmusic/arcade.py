"""The arcade band's writing tools, for the match tracks of round 4 (stage1, stage2, stage3,
final_minute): chord symbols, a rock kit on a sixteenth-note grid, basses, arpeggios, stabs,
pads, power chords, orchestra hits and echoes.

Every helper writes notes into parts at positions in beats from the start of the cue (score.B),
so they work at any tempo. Rhythms are strings with one character per sixteenth note (spaces
and | are ignored), repeated bar by bar over as many bars as the harmony lasts (a rhythm shorter
than a bar is the start of each bar, the rest silent); chords are symbols such as
"Dm", "Bb", "A7", "Gm", "Esus4", one or more per bar ("C A" splits the bar in two).
"""
from __future__ import annotations

import re

from .score import BEATS_PER_BAR, B, Part, pitch

# The Power kit (General MIDI drum map)
KICK = 36
SNARE = 38
SNARE_ALT = 40
CLAP = 39
HAT = 42
HAT_PEDAL = 44
HAT_OPEN = 46
CRASH = 49
CRASH_ALT = 57
RIDE = 51
RIDE_BELL = 53
CHINA = 52
SPLASH = 55
TOMS = {"1": 50, "2": 48, "3": 47, "4": 45, "5": 43, "6": 41}      # high to low
CYMBALS = {"C": (CRASH, 116), "D": (CRASH_ALT, 112), "S": (SPLASH, 96), "K": (CHINA, 104),
           "R": (RIDE, 84), "B": (RIDE_BELL, 92)}
LEVELS = {"X": 118, "x": 96, "o": 74, "g": 46}
STEP = 0.25                                                         # one sixteenth, in beats

_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
QUALITY = {"": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10), "m7": (0, 3, 7, 10), "maj7": (0, 4, 7, 11),
           "dim": (0, 3, 6), "sus4": (0, 5, 7), "sus2": (0, 2, 7), "5": (0, 7), "aug": (0, 4, 8),
           "7b9": (0, 4, 7, 10, 13)}


def chord(sym: str) -> tuple[int, tuple[int, ...]]:
    """'Bb' -> (10, (0, 4, 7)): root pitch class and the intervals above it."""
    m = re.fullmatch(r"([A-G])([#b]?)(.*)", sym)
    if not m or m.group(3) not in QUALITY:
        raise ValueError(f"bad chord {sym!r}")
    root = (_PC[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]) % 12
    return root, QUALITY[m.group(3)]


def pcs(sym: str) -> list[int]:
    root, ivs = chord(sym)
    return sorted({(root + i) % 12 for i in ivs})


def root_in(sym: str, lo: int) -> int:
    """The chord's root in the octave from `lo` up."""
    root, _ = chord(sym)
    return lo + (root - lo) % 12


class Harmony:
    """A chord progression from a bar on: 'Dm | Bb | F | C A' (one or more chords per bar)."""

    def __init__(self, bar: float, text: str):
        self.bar = bar
        self.spans: list[tuple[float, float, str]] = []     # absolute start beat, beats, symbol
        t = B(bar)
        for cell in text.split("|"):
            syms = cell.split()
            if not syms:
                continue
            d = BEATS_PER_BAR / len(syms)
            for s in syms:
                chord(s)
                self.spans.append((t, d, s))
                t += d
        self.start = B(bar)
        self.end = t

    @property
    def bars(self) -> int:
        return int(round((self.end - self.start) / BEATS_PER_BAR))

    def at(self, beat: float) -> str:
        for s, d, sym in self.spans:
            if s - 1e-9 <= beat < s + d - 1e-9:
                return sym
        return self.spans[-1][2]

    def shifted(self, semitones: int) -> "Harmony":
        """The same progression a number of semitones up (for a key change)."""
        names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
        out = Harmony.__new__(Harmony)
        out.bar, out.start, out.end = self.bar, self.start, self.end
        out.spans = []
        for s, d, sym in self.spans:
            m = re.fullmatch(r"([A-G][#b]?)(.*)", sym)
            root, _ = chord(sym)
            out.spans.append((s, d, names[(root + semitones) % 12] + m.group(2)))
        return out


def _steps(pattern: str) -> str:
    return "".join(c for c in pattern if c not in " |")


def _grid(harm_or_bar, pattern: str, bars: int | None = None):
    """(absolute beat, character) for every step of a pattern repeated bar by bar. A pattern
    shorter than a bar is the start of the bar ("C" is one crash on the downbeat)."""
    steps = _steps(pattern)
    if len(steps) % 16:
        steps += "." * (16 - len(steps) % 16)
    if isinstance(harm_or_bar, Harmony):
        start, n = harm_or_bar.start, int(round((harm_or_bar.end - harm_or_bar.start) / STEP))
    else:
        start = B(harm_or_bar)
        n = (bars if bars is not None else max(1, len(steps) // 16)) * 16
    for i in range(n):
        c = steps[i % len(steps)]
        yield start + i * STEP, c, i, steps, n


def _held(steps: str, i: int, n: int) -> int:
    """How many steps a note at step i lasts: itself plus the '-' that follow it."""
    k = 1
    while i + k < n and steps[(i + k) % len(steps)] == "-":
        k += 1
    return k


# ---- drums ------------------------------------------------------------------------------------
class Kit:
    """The rock kit, one part per drum group so each can be mixed: kick, snare, hats, toms, cymbals."""

    def __init__(self, stem, *, gains: dict[str, float] | None = None):
        g = {"kick": 0.0, "snare": 0.0, "hats": 0.0, "toms": 0.0, "cym": 0.0}
        g.update(gains or {})
        self.kick = stem.add("kick", "kick", gain=g["kick"], role="perc")
        self.snare = stem.add("snare", "kit_snare", gain=g["snare"], role="perc")
        self.hats = stem.add("hats", "hats", gain=g["hats"], role="perc")
        self.toms = stem.add("toms", "toms", gain=g["toms"], role="perc")
        self.cym = stem.add("cymbals", "kit_cymbals", gain=g["cym"], role="perc")

    def bar(self, bar: float, *, kick: str = "", snare: str = "", hats: str = "", toms: str = "",
            cym: str = "", bars: int = 1, scale: float = 1.0) -> None:
        """One bar (or `bars` bars) of the kit. Characters: X x o g (accent .. ghost), '.' rest.
        Snare: 'f' a flam. Hats: 'O' open, 'P' pedal. Toms: 1 to 6, high to low ('!' adds an
        accent to the next tom). Cymbals: C crash, D second crash, S splash, K china, R ride, B bell."""
        if kick:
            for t, c, *_ in _grid(bar, kick, bars):
                if c in LEVELS:
                    self.kick.note(t, KICK, 0.2, LEVELS[c] * scale)
        if snare:
            for t, c, i, *_ in _grid(bar, snare, bars):
                if c in LEVELS:
                    self.snare.note(t, SNARE if c in "Xx" or i % 2 == 0 else SNARE_ALT, 0.2, LEVELS[c] * scale)
                elif c == "f":
                    self.snare.note(t - 0.06, SNARE_ALT, 0.1, 54 * scale)
                    self.snare.note(t, SNARE, 0.2, 116 * scale)
        if hats:
            for t, c, *_ in _grid(bar, hats, bars):
                if c in LEVELS:
                    self.hats.note(t, HAT, 0.12, LEVELS[c] * scale * 0.92)
                elif c == "O":
                    self.hats.note(t, HAT_OPEN, 0.24, 92 * scale)
                elif c == "P":
                    self.hats.note(t, HAT_PEDAL, 0.12, 70 * scale)
        if toms:
            accent = False
            for t, c, *_ in _grid(bar, toms, bars):
                if c == "!":
                    accent = True
                elif c in TOMS:
                    self.toms.note(t, TOMS[c], 0.3, (120 if accent else 100) * scale)
                    accent = False
        if cym:
            for t, c, *_ in _grid(bar, cym, bars):
                if c in CYMBALS:
                    key, v = CYMBALS[c]
                    self.cym.note(t, key, 1.5 if c in "CDKS" else 0.3, v * scale)

    def roll(self, start: float, beats: float, v0: int, v1: int, step: float = 0.25) -> None:
        """A snare build: even strokes from v0 to v1 (alternating the two snare samples)."""
        self.snare.roll(start, beats, SNARE, v0, v1, step=step, dur=0.15, alt=SNARE_ALT)


# Grooves: one bar each (kick, snare, hats); the songs pick them per section.
GROOVES = {
    # straight rock: kick 1, 3, 3-and; backbeat; sixteenth hats
    "rock": ("X.....x.X.x.....", "....X.......X...", "xgxgxgxgxgxgxgxg"),
    "rock2": ("X.x...x.X.......", "....X.......X..g", "xgxgxgxgxgxgxgOg"),
    # four on the floor with open hats on the off-beats
    "drive": ("X...X...X...X...", "....X.......X...", "g.O.g.O.g.O.g.O."),
    "drive2": ("X...X...X...X.x.", "....X..g....X...", "gxOxgxOxgxOxgxOx"),
    # half time: the snare on 3, eighth hats
    "half": ("X.......x.x.....", "........X.......", "x.o.x.o.x.o.x.o."),
    # double kick sixteenths under a backbeat (stage 3, the titan)
    "double": ("XxxxXxxxXxxxXxxx", "....X.......X...", "x.x.x.x.x.x.x.x."),
    # gallop: kick in eighth-two-sixteenths
    "gallop": ("X.xxX.xxX.xxX.xx", "....X.......X...", "x.o.x.o.x.o.x.o."),
    # breakbeat: syncopated kick, ghosted snare
    "break": ("X.....X...X..x..", "....X..g.g..X..g", "xgxgxgxgxgxgxgxg"),
    # only the pulse (breakdowns)
    "pulse": ("X...X...X...X...", "................", "x.o.x.o.x.o.x.o."),
    "sparse": ("X.......X.......", "................", "o...o...o...o..."),
}

FILLS = {
    "toms4": dict(snare="X.x.X.x.X.x.....", toms="............1234"),         # last beat: toms down
    "toms8": dict(snare="X.x.X.x.........", toms="........11223456"),         # last two beats
    "snare16": dict(snare="X.x.X.x.xxxxXXXX"),
    "flam": dict(snare="X.x.X.x.f..f..f."),
    "stop": dict(kick="X.......X.X.X...", snare="........X.X.X...", hats="x.x.x.x........."),
}


def groove(kit: Kit, bar: int, bars: int, style: str, *, fill: str | None = "toms4", every: int = 8,
           crash: bool = True, crash_every: int = 0, scale: float = 1.0, kick: str | None = None,
           hats: str | None = None, snare: str | None = None) -> None:
    """`bars` bars of a groove from `bar`, a fill on the last bar of every `every`, a crash on the
    first bar (and every `crash_every` bars after it)."""
    k, s, h = GROOVES[style]
    k, s, h = kick or k, snare or s, hats or h
    for i in range(bars):
        b = bar + i
        last = fill and (i + 1) % every == 0
        f = FILLS[fill] if last else {}
        if last:
            # the fill takes the second half of the bar: kick and hats stop where the toms start
            kick_ = f.get("kick", k[:8] + "." * 8 if "toms" in f else k)
            hats_ = f.get("hats", h[:8] + "." * 8)
        else:
            kick_, hats_ = k, h
        kit.bar(b, kick=kick_, snare=f.get("snare", s), hats=hats_, toms=f.get("toms", ""), scale=scale)
        if (i == 0 and crash) or (crash_every and i % crash_every == 0 and i > 0):
            kit.bar(b, cym="C", scale=scale)


# ---- bass ---------------------------------------------------------------------------------------
def bass(part: Part, harm: Harmony, pattern: str, vel: int, *, lo: int | str = "A1", gate: float = 0.85,
         accent: int = 14) -> None:
    """A bass line on the sixteenth grid that follows the harmony. Characters: R root (accent),
    r root, O octave (accent: the slap 'pop'), o octave, F fifth, f fifth soft, 7 the flat
    seventh, 3 the third, g ghost note (muted, very short), '-' holds the note before, '.' rest."""
    lo = pitch(lo) if isinstance(lo, str) else lo
    for t, c, i, steps, n in _grid(harm, pattern):
        if c in ".-":
            continue
        sym = harm.at(t)
        r = root_in(sym, lo)
        _, ivs = chord(sym)
        third = r + (ivs[1] if len(ivs) > 1 and ivs[1] in (3, 4) else 4)
        p = {"R": r, "r": r, "O": r + 12, "o": r + 12, "F": r + 7, "f": r + 7, "7": r + 10, "3": third,
             "g": r}[c]
        v = vel + (accent if c in "RO" else 0) - (10 if c in "f" else 0) - (30 if c == "g" else 0)
        k = _held(steps, i, n)
        d = 0.08 if c == "g" else max(0.1, k * STEP * gate)
        part.note(t, p, d, v)


def long_bass(part: Part, harm: Harmony, vel: int, *, lo: int | str = "A1", octave: bool = False) -> None:
    """One held root per chord (breakdowns), with the octave above if asked."""
    lo = pitch(lo) if isinstance(lo, str) else lo
    for s, d, sym in harm.spans:
        r = root_in(sym, lo)
        part.note(s, r, d * 0.97, vel)
        if octave:
            part.note(s, r + 12, d * 0.97, vel - 8)


# ---- harmony parts ------------------------------------------------------------------------------
def voicings(sym: str, lo: int, hi: int, n: int = 3) -> list[list[int]]:
    """Every close-position voicing of n notes of the chord between lo and hi."""
    tones = pcs(sym)
    out = []
    for p in range(lo, hi + 1):
        if p % 12 not in tones:
            continue
        v = [p]
        q = p
        while len(v) < n:
            q += 1
            if q % 12 in tones:
                v.append(q)
        if v[-1] <= hi:
            out.append(v)
    return out


class Voicer:
    """Voice-leads a chord progression: each chord takes the voicing nearest the last one."""

    def __init__(self, lo: int | str, hi: int | str, n: int = 3, start: list[int] | None = None):
        self.lo = pitch(lo) if isinstance(lo, str) else lo
        self.hi = pitch(hi) if isinstance(hi, str) else hi
        self.n = n
        self.prev = start

    def __call__(self, sym: str) -> list[int]:
        cands = voicings(sym, self.lo, self.hi, self.n)
        if not cands:
            raise ValueError(f"no voicing of {sym} in range")
        if self.prev is None:
            mid = (self.lo + self.hi) / 2
            best = min(cands, key=lambda v: abs(sum(v) / len(v) - mid))
        else:
            best = min(cands, key=lambda v: (sum(abs(a - b) for a, b in zip(v, self.prev)), v[0]))
        self.prev = best
        return best


def pad(part: Part, harm: Harmony, vel: int, *, lo: int | str = "A3", hi: int | str = "E5", n: int = 3,
        voicer: Voicer | None = None, gate: float = 0.98) -> Voicer:
    """Held chords, voice-led, one per chord of the harmony (a repeated chord is held on)."""
    vc = voicer or Voicer(lo, hi, n)
    spans = harm.spans
    i = 0
    while i < len(spans):
        s, d, sym = spans[i]
        j = i + 1
        while j < len(spans) and spans[j][2] == sym:
            d += spans[j][1]
            j += 1
        for p in vc(sym):
            part.note(s, p, d * gate, vel)
        i = j
    return vc


def stabs(part: Part, harm: Harmony, rhythm: str, vel: int, *, lo: int | str = "A3", hi: int | str = "E5",
          n: int = 3, gate: float = 0.7, voicer: Voicer | None = None, top: int = 0) -> Voicer:
    """Chord stabs on a rhythm (X x o g, '-' holds). `top` adds the top note an octave up."""
    vc = voicer or Voicer(lo, hi, n)
    last_sym, last_v = None, None
    for t, c, i, steps, nn in _grid(harm, rhythm):
        if c not in LEVELS:
            continue
        sym = harm.at(t)
        if sym != last_sym:
            last_v = vc(sym)
            last_sym = sym
        k = _held(steps, i, nn)
        for p in last_v + ([last_v[-1] + 12] if top else []):
            part.note(t, p, max(0.1, k * STEP * gate), LEVELS[c] * vel / 100)
    return vc


def arp(part: Part, harm: Harmony, vel: int, *, lo: int | str = "A4", n: int = 4, shape: str = "up",
        step: float = STEP, accent: int = 10, gate: float = 0.8, rhythm: str | None = None) -> None:
    """Arpeggio over the chord tones from `lo` up (n notes), one per step: shapes up, down,
    updown, or 'pattern:0213' (indices into the n notes). `rhythm` (X x o g . per sixteenth)
    can thin it out."""
    lo = pitch(lo) if isinstance(lo, str) else lo
    t = harm.start
    k = 0
    steps = _steps(rhythm) if rhythm else None
    while t < harm.end - 1e-9:
        sym = harm.at(t)
        tones = pcs(sym)
        notes = []
        p = lo
        while len(notes) < n:
            if p % 12 in tones:
                notes.append(p)
            p += 1
        if shape == "up":
            order = list(range(n))
        elif shape == "down":
            order = list(range(n - 1, -1, -1))
        elif shape == "updown":
            order = list(range(n)) + list(range(n - 2, 0, -1))
        else:
            order = [int(ch) for ch in shape.split(":")[1]]
        ch = steps[k % len(steps)] if steps else "x"
        if ch in LEVELS:
            v = vel + (accent if k % 4 == 0 else 0) if not steps else LEVELS[ch] * vel / 100
            part.note(t, notes[order[k % len(order)]], step * gate, v)
        t += step
        k += 1


def power(part: Part, harm: Harmony, rhythm: str, vel: int, *, lo: int | str = "D2", gate: float = 0.85,
          octave: bool = True) -> None:
    """Guitar power chords (root, fifth and octave) on a rhythm: X x o accents, 'm' palm-muted
    (root and fifth, short and soft), '-' holds."""
    lo = pitch(lo) if isinstance(lo, str) else lo
    for t, c, i, steps, n in _grid(harm, rhythm):
        if c not in LEVELS and c != "m":
            continue
        r = root_in(harm.at(t), lo)
        if c == "m":
            for p in (r, r + 7):
                part.note(t, p, 0.14, vel - 22)
            continue
        k = _held(steps, i, n)
        for p in (r, r + 7) + ((r + 12,) if octave else ()):
            part.note(t, p, max(0.12, k * STEP * gate), LEVELS[c] * vel / 100)


def hits(part: Part, harm: Harmony, rhythm: str, vel: int, *, lo: int | str = "C4", fifth: bool = False,
         dur: float = 0.6) -> None:
    """Orchestra hits on the chord's root (and fifth), on a rhythm."""
    lo = pitch(lo) if isinstance(lo, str) else lo
    for t, c, *_ in _grid(harm, rhythm):
        if c not in LEVELS:
            continue
        r = root_in(harm.at(t), lo)
        for p in (r, r + 7) if fifth else (r,):
            part.note(t, p, dur, LEVELS[c] * vel / 100)


def echo(src: Part, dst: Part, *, delay: float = 0.75, scale: float = 0.5, start: float = 0.0,
         end: float = 1e9, repeats: int = 1) -> None:
    """A tape-style echo: the notes of `src` between two beats, again `delay` beats later and
    softer (each repeat softer again), into another part (so it can sit further back)."""
    for s, d, p, v in list(src.notes):
        if start <= s < end:
            for k in range(1, repeats + 1):
                dst.note(s + k * delay, p, d, v * scale ** k)


def swell(part: Part, downbeat: float, sec_per_beat: float, key: int = 60, vel: int = 90) -> None:
    """Reverse-cymbal swell whose peak lands on `downbeat` (the sample peaks 1.4 s after it starts)."""
    lead = 1.4 / sec_per_beat
    part.note(downbeat - lead, key, lead + 0.05, vel)
