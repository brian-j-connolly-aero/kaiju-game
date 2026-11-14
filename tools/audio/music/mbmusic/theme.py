"""The main theme ("Gragnor's theme") and its harmony. Every cue is built from this material.

Key: D minor. The theme is an eight-bar period on one rhythmic cell (long, short, long):

    antecedent  | D  D F  | E  D C  | F  F Bb | A  G E  |     bass  D | C | Bb G | A
    consequent  | D  D F  | E  D C  | G  F Eb | D       |     bass  D | C | Eb A | D

The first two bars (D D F, E D C) are the head motif that every cue quotes. The antecedent sits
on a descending lament bass and stops on the dominant; the consequent closes through the
flattened second (an E flat chord, then A7 with a flat fifth) so the last step of the tune is
E flat falling to D: the "monster" cadence. The second strain (B) answers with the cell turned
downwards and climbs to the dominant to bring the theme back.
"""
from __future__ import annotations

from .score import Part, pitch

HEAD = "D4:1.5 D4:.5 F4:2 | E4:1.5 D4:.5 C4:2"
A1 = HEAD + " | F4:1.5 F4:.5 Bb4:2 | A4:1.5 G4:.5 E4:2"
A2 = HEAD + " | G4:1.5 F4:.5 Eb4:2 | D4:4"
THEME = A1 + " | " + A2
B1 = "Bb4:1.5 A4:.5 G4:2 | A4:1.5 G4:.5 F4:2 | G4:1.5 F4:.5 Eb4:2 | E4:1.5 F4:.5 E4:2"
B2 = "Bb4:1.5 A4:.5 G4:2 | D5:1.5 C5:.5 Bb4:2 | E5:1.5 D5:.5 Bb4:2 | A4:1.5 A4:.5 C#5:2"
STRAIN_B = B1 + " | " + B2

# Harmony per half bar: (bass note in the cello octave, three upper voices low to high).
# The upper voices are led by step and in contrary motion to the bass wherever the bass moves
# by step, so the pad never doubles the bass in parallel fifths or octaves.
HARM_A = [
    ("D3", "A3 D4 F4"), ("D3", "A3 D4 F4"),          # 1  D minor
    ("C3", "C4 E4 G4"), ("C3", "C4 E4 G4"),          # 2  C
    ("Bb2", "D4 F4 Bb4"), ("G2", "D4 G4 Bb4"),       # 3  B flat, G minor
    ("A2", "C#4 G4 A4"), ("A2", "C#4 G4 A4"),        # 4  A7 (the tune carries the fifth)
    ("D3", "D4 F4 A4"), ("D3", "D4 F4 A4"),          # 5  D minor
    ("C3", "E4 G4 C5"), ("C3", "E4 G4 C5"),          # 6  C
    ("Eb3", "Eb4 G4 Bb4"), ("A2", "C#4 G4 A4"),      # 7  E flat, A7 flat 5 (the tune carries E flat)
    ("D3", "D4 F4 A4"), ("D3", "D4 F4 A4"),          # 8  D minor
]
HARM_B = [
    ("G2", "Bb3 D4 G4"), ("G2", "Bb3 D4 G4"),        # 1  G minor
    ("F2", "A3 D4 A4"), ("F2", "A3 D4 A4"),          # 2  D minor over F
    ("Eb2", "Bb3 Eb4 G4"), ("Eb2", "Bb3 Eb4 G4"),    # 3  E flat
    ("A2", "A3 C#4 G4"), ("A2", "A3 C#4 G4"),        # 4  A7
    ("G2", "Bb3 D4 G4"), ("G2", "Bb3 D4 G4"),        # 5  G minor
    ("Bb2", "Bb3 D4 F4"), ("Bb2", "Bb3 D4 F4"),      # 6  B flat
    ("G2", "Bb3 E4 G4"), ("G2", "Bb3 E4 G4"),        # 7  E half-diminished over G
    ("A2", "A3 E4 G4"), ("A2", "A3 E4 G4"),          # 8  A7 (the tune brings the C sharp)
]
# The plain tonic, for vamps and pedal passages
HARM_I = [("D3", "A3 D4 F4")] * 2


def harm_voice(harm: list, voice: int) -> list[int]:
    """Pitches of one upper voice (0 low .. 2 high), one per half bar."""
    return [pitch(v.split()[voice]) for _, v in harm]


def harm_bass(harm: list) -> list[int]:
    return [pitch(b) for b, _ in harm]


def sustain(part: Part, bar: float, pitches: list[int], vel: int, *, tr: int = 0, unit: float = 2.0,
            rearticulate: float = 0.0, gate: float = 0.98, cresc: tuple[int, int] | None = None) -> None:
    """Write a voice as held notes, tying repeated pitches together (a pad voice does not
    re-bow a note it already holds). `rearticulate` > 0 forces a new note at least every that
    many beats (for brass and choir, who need to breathe)."""
    from .score import B
    start = B(bar)
    total = len(pitches) * unit
    i = 0
    while i < len(pitches):
        j = i + 1
        while j < len(pitches) and pitches[j] == pitches[i] and \
                (not rearticulate or (j - i) * unit < rearticulate):
            j += 1
        dur = (j - i) * unit
        v = vel if cresc is None else cresc[0] + (cresc[1] - cresc[0]) * (i * unit) / total
        part.note(start + i * unit, pitches[i] + tr, dur * gate if j < len(pitches) else dur * 0.96, v)
        i = j


def pad(part: Part, bar: float, harm: list, voices: tuple[int, ...], vel: int, **kw) -> None:
    """Sustain one or more of the harmony's upper voices on a part."""
    for v in voices:
        sustain(part, bar, harm_voice(harm, v), vel, **kw)


def power_chord(root: int) -> list[int]:
    """Root, fifth, octave: the open voicing low brass uses so nothing muddy sits down there."""
    return [root, root + 7, root + 12]
