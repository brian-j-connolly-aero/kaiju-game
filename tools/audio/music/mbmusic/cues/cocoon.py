"""cocoon: "Chrysalis". One-shot: 4 bars (exactly 10 s, the length of the cocoon) plus ring-out.

A heartbeat that speeds up (one beat in two, then three in a bar, then every beat), an eerie
choir cluster that slides upward, glassy tremolo violins, and the head motif on celesta like a
music box. Everything stops dead at 10.0 s, where the game plays the molt blast.
"""
from ..orchestra import BASS_DRUM, TAIKO_LONG
from ..patterns import swell_into
from ..score import B, Cue


def build() -> Cue:
    cue = Cue("cocoon", 4, loop=False, title="Chrysalis (heartbeat and eerie choir)", tail_seconds=2.5,
              sections=[(1, "slow heartbeat"), (3, "faster"), (4, "every beat")])
    s = cue.stem("cocoon")

    # ---- heartbeat: lub-dub on a muffled bass drum with a taiko under the first stroke ---------
    hb = s.add("heartbeat", "bass_drum", gain=4.0, lp=220, rev=0.12, role="perc")
    tk = s.add("heartbeat body", "percussion", gain=-2.0, lp=180, rev=0.12, role="perc")
    beats = [B(1), B(1, 3), B(2), B(2, 3), B(3), B(3, 2.5), B(3, 4), B(4), B(4, 2), B(4, 3), B(4, 4)]
    for i, t in enumerate(beats):
        v = 84 + int(36 * i / (len(beats) - 1))
        hb.note(t, BASS_DRUM, 0.3, v)
        hb.note(t + 0.34, BASS_DRUM, 0.3, v - 22)
        tk.note(t, TAIKO_LONG, 0.4, v - 6)

    # ---- eerie choir: a cluster that slides upward ---------------------------------------------
    wo = s.add("women ooh", "women_ooh", gain=9.0, role="pad")
    wo.line(1, "A4+Bb4:16", 78, gate=0.995)
    wo.bend([(0, 0.0), (8, 0.0), (16, 0.7)])
    wo.expr([(0, 50), (6, 96), (8, 84), (15.6, 127)])
    so = s.add("sopranos", "sopranos", gain=3.0, role="pad")
    so.line(3, "D5:4_ D5+Eb5:4", 84, gate=0.99)
    so.bend([(8, 0.0), (12, 0.0), (16, 0.5)])
    so.expr([(8, 40), (12, 90), (15.6, 127)])
    men = s.add("men ooh", "men_ooh", gain=7.0, role="pad")
    men.line(1, "D3+A3:16", 76, gate=0.995)
    men.expr([(0, 60), (8, 96), (15.6, 124)])

    # ---- glass: tremolo violins, very high ------------------------------------------------------
    vt = s.add("violins tremolo", "violins_trem", gain=2.0, role="pad")
    vt.line(1, "D6+Eb6:16", 62, gate=0.995)
    vt.expr([(0, 40), (8, 84), (15.6, 127)])

    # ---- the head motif as a music box ------------------------------------------------------------
    ce = s.add("celesta", "celesta", gain=5.0, role="melody")
    ce.line(1, "r:2 D6:1.5 D6:.5 | F6:2 E6:1.5 D6:.5 | C6:2 r:2", 82)
    ce.line(1, "r:2 D5:1.5 D5:.5 | F5:2 E5:1.5 D5:.5 | C5:2 r:2", 64)

    rc = s.add("cymbal swell", "reverse_cymbal", gain=3.0, role="perc")
    swell_into(rc, B(5), 108)
    return cue
