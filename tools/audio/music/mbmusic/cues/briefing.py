"""briefing: "Situation Room", a tense bed under the voiced briefing. 8 bars, 20 s loop.

Everything sits on a D pedal and stays out of the way of speech: a low held fifth, a slow
timpani pulse like a second hand, a soft field-drum figure, tremolo violas sighing B flat to A,
and the head motif once, on English horn, in bars 5 and 6.
"""
from ..orchestra import SNARE, SNARE_ALT
from ..score import B, Cue
from ..theme import HEAD


def build() -> Cue:
    cue = Cue("briefing", 8, loop=True, title="Situation Room (tense bed)", target_lufs=-18.0,
              sections=[(1, "pedal and pulse"), (5, "head motif, English horn"), (7, "flat-second colour")])
    s = cue.stem("briefing")

    cb = s.add("basses", "basses", gain=1.0, role="bass")
    cb.line(1, "D2:16_ D2:16", 78, gate=1.0)
    cb.expr([(B(1), 96), (B(3), 116), (B(5), 100), (B(7), 122), (B(9), 96)])
    vc = s.add("cellos", "cellos", gain=4.0, role="pad")
    vc.line(1, "D3+A3:16_ D3+A3:16", 70, gate=1.0)
    vc.expr([(B(1), 90), (B(3), 112), (B(5), 96), (B(7), 120), (B(9), 90)])

    # the sigh: A, up to B flat when the harmony darkens, back to A
    va = s.add("violas tremolo", "violas_trem", gain=5.0, role="pad")
    va.line(1, "A3:8_ | Bb3:4_ | A3:4_ | A3:8_ | Bb3:4_ | A3:4", 68, gate=1.0)
    va.expr([(B(1), 80), (B(3), 112), (B(4), 88), (B(7), 118), (B(8), 96), (B(9), 80)])
    v2 = s.add("violins held", "violins2", gain=2.0, role="pad")
    v2.line(1, "F4:8_ | G4:4_ | F4:4_ | F4:8_ | G4+Eb4:4_ | F4:4", 62, gate=1.0)
    v2.expr([(B(1), 70), (B(3), 104), (B(4), 76), (B(7), 110), (B(8), 84), (B(9), 70)])
    hi = s.add("violins high", "violins1", gain=-1.0, role="pad")
    hi.line(1, "D6:16_ D6:16", 50, gate=1.0)
    hi.expr([(B(1), 60), (B(5), 96), (B(9), 60)])

    eh = s.add("english horn", "english_horn", gain=5.0, role="melody")
    eh.line(5, HEAD, 82, gate=0.96)

    tm = s.add("timpani", "timpani", gain=0.0, role="perc")
    for bar in range(1, 9):
        tm.line(bar, "D2:1 r:1 D2:1, r:1" if bar != 8 else "D2:1 r:1 D2:1, r:.5 A2:.25, A2:.25", 80)
    sn = s.add("field drum", "snare", gain=3.0, role="perc")
    for bar in range(1, 9):
        sn.hits(bar, "o.......g.....gg" if bar % 2 else "o.....g.o...g.gg", SNARE, scale=0.9)
    sn.notes = [(st, d, SNARE_ALT if i % 2 else p, v) for i, (st, d, p, v) in enumerate(sorted(sn.notes))]
    return cue
