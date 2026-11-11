"""cocoon: "Chrysalis". One-shot: 4 bars (exactly 10 s, the length of the cocoon) plus ring-out.

An eerie choir cluster that slides upward, glassy tremolo violins, and the head motif on celesta
like a music box. Everything stops dead at 10.0 s, where the game plays the molt blast.

There is no heartbeat in the music, on purpose. The heartbeat the players hear is the game's
positional sound effect (kaiju_heartbeat_loop): it gets quieter with distance, and following it
is how the humans find the cocoon. Music is not positional, so a heartbeat in this cue would
play at full level for everyone and bury that clue (it also beat at a different rate). So the
cue has no drums and nothing that pulses, and nothing below about 120 Hz, where the effect lives.
It is mastered 1 LU under the other full cues: the choir, strings and celesta sit where they
sat when the cue still carried drums (within 0.1 dB).
"""
from ..patterns import swell_into
from ..score import B, Cue


def build() -> Cue:
    cue = Cue("cocoon", 4, loop=False, title="Chrysalis (eerie choir; the heartbeat is the game's effect)",
              tail_seconds=2.5, sections=[(1, "choir cluster, music box"), (3, "sopranos enter, cluster slides up"),
                                          (4, "swell into the cut")],
              target_lufs=-17.0, mark=10.0)
    s = cue.stem("cocoon")

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
