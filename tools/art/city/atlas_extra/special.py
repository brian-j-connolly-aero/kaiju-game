"""Atlas pictures for the special buildings (tools/art/city_special.py): the power substation,
the gas station and the radio mast. They live in the industry block, which nothing else uses.

    sp_fence         chain-link fence panel, 24 m long x 2.25 m (the substation yard)
    sp_mast_bands    six red and white bands, bottom white, top red (the mast; sampled by height)
    sp_sign_flame    the gas station's sign: a flame on a white board (glows at night)
    sp_sign_bolt     high-voltage warning: a black bolt in a yellow triangle
    sp_pump          the front of a fuel pump: lit screen, red panel, hose (no digits)
    sp_bottles       a cage of gas bottles behind mesh
    sp_insulator     ribbed brown ceramic

No letters or numbers anywhere: pictures only.
"""
import numpy as np

from city import atlas

FAMILY = "industry"

REGIONS = [
    dict(name="sp_fence", x=256, y=256, w=128, h=12, kind="texture", note="chain-link fence, 24 x 2.25 m"),
    dict(name="sp_mast_bands", x=256, y=272, w=8, h=48, kind="picture", note="mast bands, red on top"),
    dict(name="sp_sign_flame", x=268, y=272, w=16, h=16, kind="picture", note="flame sign (gas station)"),
    dict(name="sp_sign_bolt", x=288, y=272, w=16, h=16, kind="picture", note="high-voltage warning sign"),
    dict(name="sp_pump", x=308, y=272, w=8, h=12, kind="picture", note="fuel pump front 1.5 x 2.25 m"),
    dict(name="sp_bottles", x=320, y=272, w=16, h=10, kind="picture", note="gas bottle cage 3 x 1.9 m"),
    dict(name="sp_insulator", x=340, y=272, w=4, h=8, kind="picture", note="ribbed ceramic insulator"),
]

RED = "#d7263d"
WHITE = "#f4f2ee"


def _rgb(h):
    return atlas.hexrgb(h)


def _fence(c, e, rng):
    h, w = c.shape[:2]
    c[...] = _rgb("#4d5766")                                    # what shows through the mesh
    for y in range(h):
        for x in range(w):
            if (x + y) % 4 == 0 or (x - y) % 4 == 0:
                c[y, x] = _rgb("#aab3bf")
    c += atlas.noise(rng, c.shape, 5)
    c[0, :] = _rgb("#d9dde3")                                   # top rail
    c[1, :] = _rgb("#8d97a5")
    c[:, ::16] = _rgb("#d9dde3")                                # posts every 3 m
    c[:, 1::16] = _rgb("#7c8694")
    c[h - 2:, :] = _rgb("#a39e93")                              # concrete kerb
    c[h - 2, :] = _rgb("#bdb9b0")


def _bands(c, e, rng):
    h = c.shape[0]
    step = h // 6
    for k in range(6):
        c[k * step:(k + 1) * step, :] = _rgb(RED if k % 2 == 0 else WHITE)
    c += atlas.noise(rng, c.shape, 3)


def _flame(c, e, rng):
    c[...] = _rgb(WHITE)
    c[0, :] = c[-1, :] = c[:, 0] = c[:, -1] = _rgb(RED)
    c[1, 1:-1] = c[-2, 1:-1] = c[1:-1, 1] = c[1:-1, -2] = _rgb(RED)
    outer = ["......#.....", ".....##.....", ".....###....", "....####.#..", "..#.#####...", "..#######.#.",
             ".#########..", ".##########.", ".##########.", ".##########.", "..########..", "...######..."]
    inner = ["............", "............", "............", "............", "......#.....", ".....##.....",
             ".....###....", "....####....", "....#####...", "....#####...", "....####....", ".....##....."]
    for y, (ro, ri) in enumerate(zip(outer, inner)):
        for x in range(12):
            if ri[x] == "#":
                c[2 + y, 2 + x] = _rgb("#ffd23a")
                e[2 + y, 2 + x] = _rgb("#ffe27a")
            elif ro[x] == "#":
                c[2 + y, 2 + x] = _rgb("#f0641e")
                e[2 + y, 2 + x] = _rgb("#ff7a2a")
    e[2:-2, 2:-2] = np.maximum(e[2:-2, 2:-2], _rgb("#6a6458"))        # the lit board


def _bolt(c, e, rng):
    c[...] = _rgb(WHITE)
    c[0, :] = c[-1, :] = c[:, 0] = c[:, -1] = _rgb("#3a3f4a")
    for y in range(2, 14):                                           # yellow triangle, black edge
        half = (y - 1) // 2 + 1
        x0, x1 = 8 - half, 7 + half
        c[y, x0:x1 + 1] = _rgb("#ffd91a")
        c[y, x0] = c[y, x1] = _rgb("#1d1f26")
    c[13, 1:15] = _rgb("#1d1f26")
    for y, xs in ((5, (8,)), (6, (7, 8)), (7, (7,)), (8, (6, 7, 8, 9)), (9, (8,)), (10, (7, 8)), (11, (7,))):
        for x in xs:
            c[y, x] = _rgb("#1d1f26")


def _pump(c, e, rng):
    c[...] = _rgb(WHITE)
    c[0:2, :] = _rgb(RED)                                            # lit top band
    e[0:2, :] = _rgb("#ff5a4a")
    c[2, :] = _rgb("#c9ccd2")
    c[3:6, 1:6] = _rgb("#1d2a33")                                    # the screen: two glowing bars
    c[4, 2:5] = _rgb("#7fe8c0")
    e[3:6, 1:6] = _rgb("#1f4a40")
    e[4, 2:5] = _rgb("#7fe8c0")
    c[7:12, 0:6] = _rgb(RED)                                         # lower panel
    c[7, 0:6] = _rgb("#e9505f")
    c[3:10, 6] = _rgb("#1d1f26")                                     # hose down the side, nozzle
    c[9, 5] = c[10, 5] = _rgb("#1d1f26")
    c[3, 7] = c[4, 7] = _rgb("#8a96a8")
    c[11, :] = _rgb("#3a3f4a")                                       # plinth


def _bottles(c, e, rng):
    c[...] = _rgb("#39414e")
    cols = ["#f08a2e", "#3f7fd0", "#f08a2e", "#d9dde3", "#3f7fd0"]
    for k, col in enumerate(cols):
        x = 1 + k * 3
        c[3:9, x:x + 2] = _rgb(col)
        c[2, x:x + 2] = _rgb(col) * 0.8
        c[1, x] = _rgb("#c9ccd2")                                    # the valve
        c[3:9, x + 1] *= 0.82
    c[::3, :] = c[::3, :] * 0.6 + _rgb("#aab3bf") * 0.4              # mesh bars
    c[:, 0] = c[:, -1] = _rgb("#d9dde3")
    c[0, :] = _rgb("#d9dde3")
    c[-1, :] = _rgb("#7c8694")


def _insulator(c, e, rng):
    for y in range(c.shape[0]):
        c[y, :] = _rgb("#b8623c" if y % 2 == 0 else "#7a3a22")
    c[:, 0] *= 0.85


_PAINT = {"sp_fence": _fence, "sp_mast_bands": _bands, "sp_sign_flame": _flame, "sp_sign_bolt": _bolt,
          "sp_pump": _pump, "sp_bottles": _bottles, "sp_insulator": _insulator}


def paint(cv, r, rng):
    c, e = cv.view(r)
    _PAINT[r.name](c, e, rng)
    return None
