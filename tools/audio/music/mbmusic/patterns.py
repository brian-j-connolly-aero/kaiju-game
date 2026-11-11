"""Accompaniment patterns that follow a harmony table (one entry per half bar)."""
from __future__ import annotations

from .score import B, Part, pitch
from .theme import harm_bass, harm_voice


def _bass(harm: list, octave_shift: int = 0, floor: int | None = None) -> list[int]:
    out = [p + 12 * octave_shift for p in harm_bass(harm)]
    if floor is not None:
        out = [p if p >= floor else p + 12 for p in out]
    return out


def gallop(part: Part, bar: float, pitches: list, vel: int, *, accent: int = 14, weak: int = -10,
           cresc: tuple[int, int] | None = None, alt: list | None = None) -> None:
    """The driving cell: an eighth and two sixteenths on every beat. `pitches` has one entry
    (a pitch or a list of pitches) per half bar; `alt` optionally gives the pitch for the two
    sixteenths, which turns the repeated note into a rocking inner part."""
    start = B(bar)
    n = len(pitches)
    for i, ps in enumerate(pitches):
        ps = ps if isinstance(ps, (list, tuple)) else [ps]
        qs = ps if alt is None else (alt[i] if isinstance(alt[i], (list, tuple)) else [alt[i]])
        base = vel if cresc is None else cresc[0] + (cresc[1] - cresc[0]) * i / max(1, n - 1)
        for beat in range(2):
            t = start + i * 2 + beat
            for p in ps:
                part.note(t, p, 0.36, base + (accent if beat == 0 else accent // 2))
            for p in qs:
                part.note(t + 0.5, p, 0.17, base + weak)
                part.note(t + 0.75, p, 0.17, base + weak // 2)


def pulse(part: Part, bar: float, pitches: list, vel: int, *, step: float = 0.5, dur: float = 0.3,
          accent: int = 12, every: int = 2, cresc: tuple[int, int] | None = None) -> None:
    """Repeated notes (eighths by default, sixteenths with step=0.25), accented every `every`."""
    start = B(bar)
    per = int(round(2 / step))
    n = len(pitches)
    for i, ps in enumerate(pitches):
        ps = ps if isinstance(ps, (list, tuple)) else [ps]
        base = vel if cresc is None else cresc[0] + (cresc[1] - cresc[0]) * i / max(1, n - 1)
        for k in range(per):
            for p in ps:
                part.note(start + i * 2 + k * step, p, dur, base + (accent if k % every == 0 else 0))


def drive_bass(part: Part, bar: float, roots: list[int], vel: int, *,
               cresc: tuple[int, int] | None = None) -> None:
    """Bass under the gallop: the same cell at half speed (a quarter and two eighths)."""
    start = B(bar)
    n = len(roots)
    for i, r in enumerate(roots):
        base = vel if cresc is None else cresc[0] + (cresc[1] - cresc[0]) * i / max(1, n - 1)
        t = start + i * 2
        part.note(t, r, 0.8, base + 12)
        part.note(t + 1, r, 0.36, base - 6)
        part.note(t + 1.5, r, 0.36, base)


def voice(harm: list, v: int, tr: int = 0) -> list[int]:
    return [p + tr for p in harm_voice(harm, v)]


def voices(harm: list, vs: tuple[int, ...], tr: int = 0) -> list[list[int]]:
    cols = [harm_voice(harm, v) for v in vs]
    return [[c[i] + tr for c in cols] for i in range(len(harm))]


def bass(harm: list, octave_shift: int = 0, floor: str | None = None) -> list[int]:
    return _bass(harm, octave_shift, pitch(floor) if floor else None)


def stab(part: Part, beat: float, pitches: list[int], vel: int, dur: float = 0.45) -> None:
    for p in pitches:
        part.note(beat, p, dur, vel)


def swell_into(part: Part, downbeat: float, vel: int = 96, key: int = 60) -> None:
    """Reverse-cymbal swell whose peak lands on `downbeat` (the sample peaks 1.4 s after it
    starts, which is 2.25 beats at 96 beats per minute)."""
    part.note(downbeat - 2.25, key, 2.3, vel)


ACCENTS_332 = (0, 3, 6, 8, 11, 14)       # sixteenth positions in a bar: 3+3+2, twice


def motor(part: Part, bar: float, pitches: list, vel: int, *, accents: tuple = ACCENTS_332,
          accent: int = 18, cresc: tuple[int, int] | None = None, dur: float = 0.16) -> None:
    """Unbroken sixteenths with the 3+3+2 accent pattern. `pitches`: one entry per half bar."""
    start = B(bar)
    n = len(pitches)
    for i, ps in enumerate(pitches):
        ps = ps if isinstance(ps, (list, tuple)) else [ps]
        base = vel if cresc is None else cresc[0] + (cresc[1] - cresc[0]) * i / max(1, n - 1)
        for k in range(8):
            pos = (i % 2) * 8 + k
            v = base + (accent if pos in accents else 0)
            for p in ps:
                part.note(start + i * 2 + k * 0.25, p, dur, v)


def hammer(part: Part, bar: float, roots: list, vel: int, *, cresc: tuple[int, int] | None = None,
           fill: bool = True, dur: float = 0.4) -> None:
    """Heavy eighths in 3+3+2: accents on beats 1, 2-and and 4, lighter strokes between."""
    start = B(bar)
    n = len(roots)
    for i, ps in enumerate(roots):
        ps = ps if isinstance(ps, (list, tuple)) else [ps]
        base = vel if cresc is None else cresc[0] + (cresc[1] - cresc[0]) * i / max(1, n - 1)
        for k in range(4):
            pos = (i % 2) * 4 + k                    # eighth position in the bar
            strong = pos in (0, 3, 6)
            if not strong and not fill:
                continue
            for p in ps:
                part.note(start + i * 2 + k * 0.5, p, dur if strong else dur * 0.7,
                          base + (14 if strong else -12))
