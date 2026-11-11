"""intermission: "Redeploy". One-shot: an 8-bar build (exactly 20 s) to a single hit at 20.0 s.

The whole build stands on the dominant (A in the bass, timpani roll). Above it the theme's
cell (long, short, long) climbs one step a bar: A, B flat, C, then D (the head motif itself at
its home pitch in bar 4), E, F, G, and finally A with the major third. More of the orchestra
joins every two bars. The hit at 20.0 s is the D the next stage starts on.
For a shorter intermission, start playback on a bar line (bar n starts at (n - 1) * 2.5 s).
"""
from ..orchestra import BASS_DRUM, CRASH, SNARE, SNARE_ALT
from ..patterns import pulse, swell_into
from ..score import B, Cue, pitch

P = pitch
CLIMB = [("A3", "C4"), ("Bb3", "D4"), ("C4", "E4"), ("D4", "F4"), ("E4", "G4"), ("F4", "A4"),
         ("G4", "Bb4"), ("A4", "C#5")]


def build() -> Cue:
    cue = Cue("intermission", 8, loop=False, title="Redeploy (build)", tail_seconds=3.5,
              sections=[(1, "low strings"), (3, "+ violas, horns"), (5, "+ violins, trombones, snare"),
                        (7, "+ trumpets, choir")])
    s = cue.stem("intermission")
    cell = "{a}:1.5 {a}:.5 {b}:2"

    def climb(part, first: int, last: int, tr: int, v0: int, v1: int, gate: float = 0.95) -> None:
        for bar in range(first, last + 1):
            a, b = CLIMB[bar - 1]
            v = v0 + (v1 - v0) * (bar - first) / max(1, last - first)
            part.line(bar, cell.format(a=a, b=b), int(v), tr=tr, gate=gate)

    vc = s.add("cellos", "cellos", gain=5.0, role="melody")
    bn = s.add("bassoon", "bassoon", gain=2.0, role="melody")
    va = s.add("violas", "violas", gain=3.0, role="melody")
    hn = s.add("horns", "horns", gain=2.0, role="melody")
    v1 = s.add("violins 1", "violins1", gain=3.0, role="melody")
    tb = s.add("trombones", "trombones", gain=3.0, role="melody")
    tp = s.add("trumpets", "trumpets", gain=1.0, role="melody")
    women = s.add("women", "sopranos", gain=1.0, role="melody")
    men = s.add("men", "tenors", gain=1.0, role="melody")
    climb(vc, 1, 4, 0, 92, 100)                # low strings start above the pedal, not in it
    climb(vc, 5, 8, -12, 100, 112)
    climb(bn, 1, 4, 0, 88, 98)
    climb(va, 3, 8, 0, 86, 110)
    climb(hn, 3, 8, 0, 88, 114)
    climb(v1, 5, 8, 12, 96, 114)
    climb(tb, 5, 8, -12, 96, 114)
    climb(tp, 7, 8, 0, 108, 118, gate=0.92)
    climb(women, 7, 8, 0, 104, 114, gate=0.97)
    climb(men, 7, 8, -12, 104, 114, gate=0.97)

    # ---- dominant pedal ---------------------------------------------------------------------------
    cb = s.add("basses", "basses", gain=4.0, role="bass")
    cb.line(1, "A1:16_ A1:16", 96, gate=1.0)
    cb.expr([(0, 92), (16, 110), (31.5, 127)])
    vam = s.add("violas pulse", "violas_marc", gain=-2.0, role="ostinato")
    pulse(vam, 3, [P("A3")] * 4, 70, step=0.25, dur=0.16, accent=12, every=4, cresc=(64, 84))
    v2m = s.add("violins 2 pulse", "violins2_marc", gain=-4.0, role="ostinato")
    # the violins' pulse stays consonant with the climbing cell: A-E, A-D, B flat-D, A-E
    dyads = [["A4", "E5"]] * 2 + [["A4", "D5"]] * 2 + [["Bb4", "D5"]] * 2 + [["A4", "E5"]] * 2
    pulse(v2m, 5, [[P(a), P(b)] for a, b in dyads], 80, step=0.25, dur=0.16, accent=12, every=4, cresc=(72, 104))
    tuba = s.add("tuba", "tuba", gain=0.0, role="bass")
    tuba.line(5, "A1:8_ A1:8", 90, gate=1.0)
    tuba.expr([(16, 80), (31.5, 127)])

    # ---- percussion -------------------------------------------------------------------------------
    tm = s.add("timpani", "timpani", gain=1.0, role="perc")
    tm.roll(0, 32, "A2", 54, 122, step=0.125, dur=0.5, curve=1.6)
    sn = s.add("snare", "snare", gain=0.0, role="perc")
    sn.roll(16, 16, SNARE, 30, 122, curve=1.5, alt=SNARE_ALT)
    bd = s.add("bass drum", "bass_drum", gain=2.0, role="perc")
    for bar in range(1, 9):
        bd.note(B(bar), BASS_DRUM, 0.5, 84 + 4 * bar)
        if bar >= 7:
            bd.note(B(bar, 3), BASS_DRUM, 0.5, 70 + 6 * bar)
    rc = s.add("cymbal swell", "reverse_cymbal", gain=3.0, role="perc")
    swell_into(rc, B(9), 116)

    # ---- the hit at 20.0 s: D, in octaves and fifths -----------------------------------------------
    t = B(9)
    for part, notes, v in ((cb, ["D2"], 124), (tuba, ["D2"], 120), (vc, ["D3"], 120), (va, ["D4"], 118),
                           (v1, ["D5"], 118), (hn, ["D4", "A3"], 120), (tb, ["D3", "A3"], 122),
                           (tp, ["D5", "A4"], 120), (women, ["D4", "A4"], 118), (men, ["D3", "A3"], 118)):
        for n in notes:
            part.note(t, P(n), 1.3, v)
    cb.expr([(31.9, 127), (32, 127)])
    tuba.expr([(31.9, 127), (32, 127)])
    tm.note(t, P("D2"), 2.0, 127)
    bd.note(t, BASS_DRUM, 1.0, 127)
    cy = s.add("cymbals", "cymbals", gain=3.0, role="perc")
    cy.note(t, CRASH, 4.0, 120)
    bell = s.add("tubular bells", "tubular_bells", gain=1.0, role="perc")
    bell.note(t, P("D5"), 4.0, 112)
    return cue
