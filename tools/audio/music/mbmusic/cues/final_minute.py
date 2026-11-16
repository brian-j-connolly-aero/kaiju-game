"""final_minute: "Sixty Seconds" (the last minute of the match clock, any stage). 168 beats per
minute, 42 bars: exactly 60.0 s, then it loops.

The danger version of the titan's track: the same band, choir and orchestra (stage3.band), an
alarm, a ticking clock, and the stage 3 hook climbing a tone at a time (D minor, E minor,
F sharp minor) into a ten-second build on the dominant that ends exactly at the loop end. The
game starts it when the clock shows a minute left and starts it part-way in when less is left
(the manifest's `mark`, 60.25 s into the file: the 0.25 s lead-in plus the 42 bars), so the end
of the build lands as the clock runs out, whenever the music began.

    bars  1-2   alarm: the siren (A and B flat on a square wave), orchestra hits on every beat
    bars  3-10  the countdown riff on saw lead, wood blocks ticking
    bars 11-18  the stage 3 hook in D minor
    bars 19-26  the hook in E minor
    bars 27-34  the hook in F sharp minor
    bars 35-42  the last ten seconds: B flat, C, then A held, a snare roll, timpani, everything up
"""
from ..arcade import Harmony, bass, groove, hits, long_bass, pad, stabs, swell
from ..orchestra import WOODBLOCK_HI, WOODBLOCK_LO
from ..score import B, Cue
from .stage3 import BASS_16, HELD, HOOK, HOOK_HITS, band, guitars, shouts

BPM = 168

RIFF = ("D6:.5 A5:.25 A5:.25 D6:.5 A5:.25 A5:.25 F6:.5 E6:.5 D6:.5 C6:.5 | "
        "D6:.5 Bb5:.25 Bb5:.25 D6:.5 Bb5:.25 Bb5:.25 F6:.5 D6:.5 C6:.5 Bb5:.5 | "
        "E6:.5 C6:.25 C6:.25 E6:.5 C6:.25 C6:.25 G6:.5 E6:.5 D6:.5 C6:.5 | "
        "C#6:.5 A5:.25 A5:.25 C#6:.5 A5:.25 A5:.25 E6:1 A6:1 | "
        "D6:.5 A5:.25 A5:.25 D6:.5 A5:.25 A5:.25 F6:.5 E6:.5 D6:.5 C6:.5 | "
        "D6:.5 Bb5:.25 Bb5:.25 D6:.5 Bb5:.25 Bb5:.25 F6:.5 D6:.5 C6:.5 Bb5:.5 | "
        "Eb6:.5 Bb5:.25 Bb5:.25 Eb6:.5 Bb5:.25 Bb5:.25 G6:.5 F6:.5 Eb6:.5 D6:.5 | "
        "C#6:.5 A5:.25 A5:.25 C#6:.5 A5:.25 A5:.25 E6:1 C#6:1")
HOOK8 = HOOK.split(" | ")[:8]
HOOK_H = "Dm | C | Bb | A | Dm | C | Eb | A"
BUILD = "Bb | Bb | C | C | A | A | A | A"
BUILD_MEL = "F6:2 D6:2 | F6:2 Bb6:2 | G6:2 E6:2 | G6:2 C7:2 | A6:2 E6:2 | C#6:1 E6:1 A6:2 | A6:4 | A6:2 E6:1 C#6:1"


def build() -> Cue:
    cue = Cue("final_minute", 42, loop=True, bpm=BPM, title="Sixty Seconds (the last minute, any stage)",
              sections=[(1, "alarm"), (3, "countdown"), (11, "hook, D minor"), (19, "E minor"),
                        (27, "F sharp minor"), (35, "last ten seconds")],
              target_lufs=-16.0, mark=60.25)
    s = cue.stem("final_minute")
    spb = cue.sec_per_beat
    p = band(s)
    kit = p["kit"]
    siren = s.add("siren", "square_lead", gain=-1.0, pan=0.3, role="melody")
    clock = s.add("wood blocks", "percussion", gain=-4.0, pan=-0.3, role="perc")

    # ---- the alarm --------------------------------------------------------------------------------
    ha = Harmony(1, "Dm | A")
    kit.bar(1, kick="X...X...X...X...", snare="X...X...X...X...", hats="x.x.x.x.x.x.x.x.", bars=2)
    kit.bar(1, cym="C")
    kit.bar(2, toms="............1234")
    siren.line(1, " ".join(["A5:.5 Bb5:.5"] * 8), 104, gate=0.95)
    hits(p["hit"], ha, "X...X...X...X...", 110)
    hits(p["timp"], ha, "X...X...X...X...", 108, lo="D2")
    bass(p["bass"], ha, "R.r.R.r.R.r.R.r.", 96, lo="C1")
    guitars(p, ha, "X.m.X.m.X.m.X.m.", 102)
    shouts(p, ha, "X...............", 106)

    # ---- the countdown riff -----------------------------------------------------------------------
    hr = Harmony(3, HOOK_H)
    groove(kit, 3, 8, "drive2", fill="toms8")
    bass(p["bass"], hr, BASS_16, 92, lo="C1")
    guitars(p, hr, "X.mmX.mmX.mmX.mm", 100)
    p["saw"].line(3, RIFF, 108, gate=0.85)
    p["sq"].line(3, RIFF, 98, gate=0.85, tr=-12)
    stabs(p["brass"], hr, "X.....X.....X...", 96, lo="F4", hi="F5")
    for i in range(32):
        clock.note(B(3) + i, WOODBLOCK_HI if i % 2 == 0 else WOODBLOCK_LO, 0.2, 100 if i % 2 == 0 else 86)
    swell(p["fx"], B(11), spb)

    # ---- the hook, three keys ---------------------------------------------------------------------
    for k, (bar, tr) in enumerate(((11, 0), (19, 2), (27, 4))):
        h = Harmony(bar, HOOK_H).shifted(tr)
        groove(kit, bar, 8, "double", fill="toms8" if k < 2 else "snare16", crash_every=2)
        bass(p["bass"], h, BASS_16, 92 + 2 * k, lo="C1")
        guitars(p, h, HELD, 100 + 2 * k)
        for part, v, octave in ((p["saw"], 112, 0), (p["sq"], 102, -12), (p["brass"], 106, -12)):
            part.line(bar, " | ".join(HOOK8), v + 2 * k, gate=0.94, tr=tr + octave)
        pad(p["horns"], h, 90 + 2 * k, lo="F3", hi="D5")
        pad(p["alt"], h, 88 + 2 * k, lo="A3", hi="D5", n=2)
        pad(p["sop"], h, 86 + 2 * k, lo="D4", hi="A5", n=2)
        for b in (bar, bar + 4):
            hits(p["hit"], Harmony(b, h.at(B(b))), HOOK_HITS, 112)
            hits(p["timp"], Harmony(b, h.at(B(b))), HOOK_HITS, 108, lo="D2")
            shouts(p, Harmony(b + 2, h.at(B(b + 2))), "X.....x.........", 106)
        if k:
            swell(p["fx"], B(bar), spb, vel=80)

    # ---- the last ten seconds ---------------------------------------------------------------------
    hb = Harmony(35, BUILD)
    for i in range(8):
        kit.bar(35 + i, kick="X.X.X.X.X.X.X.X." if i < 4 else "XxxxXxxxXxxxXxxx",
                snare="X.X.X.X.X.X.X.X." if i < 2 else "XxXxXxXxXxXxXxXx" if i < 4 else "",
                hats="x.x.x.x.x.x.x.x." if i < 4 else "", cym="C......." if i % 2 == 0 else "")
    kit.roll(B(39), 16, 70, 126, step=0.125)
    p["timp"].roll(B(39), 16, "A2", 64, 120, step=0.125, dur=0.2)
    bass(p["bass"], Harmony(35, "Bb | Bb | C | C"), BASS_16, 94, lo="C1")
    long_bass(p["bass"], Harmony(39, "A | A | A | A"), 100, lo="C1")
    guitars(p, Harmony(35, "Bb | Bb | C | C"), "X.X.X.X.X.X.X.X.", 104)
    guitars(p, Harmony(39, "A | A | A | A"), "X-------------x-", 106)
    p["saw"].line(35, BUILD_MEL, 112, gate=0.95, cresc=(104, 124))
    p["brass"].line(35, BUILD_MEL, 104, gate=0.95, tr=-12, cresc=(96, 120))
    pad(p["horns"], hb, 96, lo="F3", hi="D5")
    pad(p["sop"], hb, 92, lo="D4", hi="A5", n=2)
    pad(p["alt"], hb, 90, lo="A3", hi="D5", n=2)
    pad(p["ten"], hb, 90, lo="C3", hi="F4", n=2)
    hits(p["hit"], hb, "X...X...X...X...", 108)
    shouts(p, Harmony(35, "Bb | Bb | C | C"), "X.......X.......", 104)
    shouts(p, Harmony(39, "A | A | A | A"), "X...X...X...X...", 110)
    swell(p["fx"], B(43), spb, vel=96)                 # peaks on the loop end: the clock's zero
    return cue
