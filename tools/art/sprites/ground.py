"""Ground tiles: 64 x 64 pixels, seamless in both directions, a handful of colors each.

Every drawing call wraps around the edges of the tile (coordinates are taken modulo 64), so
a tuft or a crack that leaves on the right comes back in on the left and the tile repeats
without seams. The base color of each tile is its palette anchor from docs/ASSETS.md.
"""
from __future__ import annotations

import math

import numpy as np

from pix import Img, col, mix

T = 64


class Tile:
    """A 64 x 64 opaque picture whose drawing wraps around."""

    def __init__(self, base):
        self.a = np.zeros((T, T, 4), np.uint8)
        self.a[:, :] = col(base)

    def px(self, x, y, c) -> "Tile":
        self.a[int(y) % T, int(x) % T] = col(c)
        return self

    def get(self, x, y):
        return tuple(int(v) for v in self.a[int(y) % T, int(x) % T])

    def hline(self, x0, x1, y, c) -> "Tile":
        for x in range(int(x0), int(x1) + 1):
            self.px(x, y, c)
        return self

    def vline(self, x, y0, y1, c) -> "Tile":
        for y in range(int(y0), int(y1) + 1):
            self.px(x, y, c)
        return self

    def rect(self, x0, y0, x1, y1, c) -> "Tile":
        for y in range(int(y0), int(y1) + 1):
            self.hline(x0, x1, y, c)
        return self

    def art(self, rows, x, y, legend) -> "Tile":
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch not in ". ":
                    self.px(x + i, y + j, legend[ch])
        return self

    def img(self) -> Img:
        return Img.from_array(self.a.copy())


def scatter(rng, n: int, min_dist: float, tries: int = 4000) -> list:
    """n points in the tile, no two closer than min_dist (measured around the edges too)."""
    pts = []
    for _ in range(tries):
        if len(pts) >= n:
            break
        x, y = rng.uniform(0, T), rng.uniform(0, T)
        ok = True
        for (px, py) in pts:
            dx = min(abs(x - px), T - abs(x - px))
            dy = min(abs(y - py), T - abs(y - py))
            if dx * dx + dy * dy < min_dist * min_dist:
                ok = False
                break
        if ok:
            pts.append((x, y))
    return pts


def wrap_noise(rng, period: int, octaves: int = 2) -> np.ndarray:
    """Tileable value noise 0..1 over the tile."""
    from fx import value_noise
    return value_noise(T, T, period, period, rng, octaves)


# ---- asphalt --------------------------------------------------------------------------------

def asphalt() -> Img:
    """Road surface: dark blue-grey with a fine aggregate of lighter and darker grains, a few
    worn patches and two hairline cracks. Kept quiet: roads cover a lot of screen."""
    rng = np.random.default_rng(11)
    base = col("road")                       # #2b3040
    lt, lt2, dk = col("#343a4c"), col("#3e455a"), col("#242836")
    t = Tile(base)
    # worn, slightly lighter patches (big soft shapes from low-frequency noise)
    n = wrap_noise(rng, 32, 2)
    t.a[n > 0.66] = col("#2d3243")
    t.a[n < 0.30] = col("#292e3d")
    # aggregate: single grains and a few 2-pixel grains
    for (x, y) in scatter(rng, 210, 2.2):
        r = rng.random()
        c = lt if r < 0.55 else (dk if r < 0.9 else lt2)
        t.px(x, y, c)
        if rng.random() < 0.18:
            t.px(x + 1, y, c)
    # hairline cracks: short wandering dark lines
    for (x, y), length in zip(scatter(rng, 3, 20), (14, 10, 8)):
        ang = rng.uniform(0, math.pi)
        for _ in range(length):
            t.px(x, y, dk)
            if rng.random() < 0.3:
                t.px(x + 1, y + 1, col("#343a4c"))
            ang += rng.uniform(-0.5, 0.5)
            x += math.cos(ang)
            y += math.sin(ang)
    return t.img()


# ---- sidewalk -------------------------------------------------------------------------------

def sidewalk() -> Img:
    """Pavement: staggered concrete slabs, 16 x 16 pixels, each a touch different, with a lit
    upper-left edge, dark joints and the odd chip or stain."""
    rng = np.random.default_rng(12)
    base = col("sidewalk")                   # #b9bcc6
    tones = [base, col("#c1c4cd"), col("#b2b5c0"), col("#bcbfc9")]
    joint, hi, speck_d, speck_l = col("#9a9daa"), col("#cfd2da"), col("#a9acb8"), col("#c9ccd5")
    t = Tile(base)
    for row in range(4):
        off = 8 if row % 2 else 0
        for c in range(4):
            x0, y0 = c * 16 + off, row * 16
            tone = tones[int(rng.integers(len(tones)))]
            t.rect(x0, y0, x0 + 15, y0 + 15, tone)
            t.hline(x0, x0 + 15, y0 + 15, joint)           # joint below
            t.vline(x0 + 15, y0, y0 + 15, joint)           # joint at the right
            t.hline(x0, x0 + 14, y0, hi)                   # lit top edge
            t.vline(x0, y0, y0 + 14, hi)                   # lit left edge
            for _ in range(int(rng.integers(3, 7))):
                sx, sy = x0 + rng.integers(2, 14), y0 + rng.integers(2, 14)
                t.px(sx, sy, speck_d if rng.random() < 0.6 else speck_l)
            if rng.random() < 0.25:                        # a chipped corner
                t.px(x0 + 14, y0 + 14, joint).px(x0 + 13, y0 + 14, speck_d).px(x0 + 14, y0 + 13, speck_d)
            if rng.random() < 0.2:                         # a short crack
                cx, cy = x0 + int(rng.integers(3, 9)), y0 + int(rng.integers(3, 10))
                for i in range(int(rng.integers(3, 6))):
                    t.px(cx + i, cy + (i // 2), speck_d)
    return t.img()


# ---- grass ----------------------------------------------------------------------------------

def grass() -> Img:
    """Lawn: bright model-railway green with darker and lighter tufts of blades and a
    sprinkle of tiny flowers."""
    rng = np.random.default_rng(13)
    base = col("grass")                      # #4fbf5f
    dk, dk2, lt, lt2 = col("#3fa652"), col("#36934a"), col("#63d273"), col("#84e38f")
    t = Tile(base)
    n = wrap_noise(rng, 32, 2)
    t.a[n > 0.64] = col("#53c463")           # sunnier patches
    t.a[n < 0.32] = col("#4bba5b")           # shadier patches
    tufts_dark = [["d.d", ".d."], ["d..", ".d.", ".d."], [".d", "d.", "d."], ["d.d.", ".dd."],
                  ["d...d", ".d.d.", "..d.."], ["d.d.d", ".ddd."]]
    tufts_light = [["l.l", ".l."], [".l", "l."], ["l..", ".l."], ["l"]]
    for (x, y) in scatter(rng, 58, 5.2):
        art = tufts_dark[int(rng.integers(len(tufts_dark)))]
        t.art(art, int(x), int(y), {"d": dk if rng.random() < 0.75 else dk2})
        # a lit blade beside most tufts
        if rng.random() < 0.7:
            la = tufts_light[int(rng.integers(len(tufts_light)))]
            t.art(la, int(x) + int(rng.integers(-1, 3)), int(y) - 2, {"l": lt if rng.random() < 0.7 else lt2})
    for (x, y) in scatter(rng, 60, 4.0):
        t.px(x, y, lt if rng.random() < 0.6 else dk)
    for (x, y), c in zip(scatter(rng, 5, 16.0), ("#ffffff", "#ffe45a", "#ffffff", "#ffb3d1", "#ffe45a")):
        t.px(x, y, c)
        t.px(x, y + 1, dk2)
    return t.img()


# ---- water ----------------------------------------------------------------------------------

def water() -> Img:
    """River and bay: saturated blue with rows of little wave crests (a bright line with a
    darker trough under it) and a few glints. Scroll it slowly in the game for motion."""
    rng = np.random.default_rng(14)
    base = col("water")                      # #2f7fd6
    dk, dk2, lt, lt2 = col("#2a70c4"), col("#2563b3"), col("#62a8f0"), col("#b4dcff")
    t = Tile(base)
    n = wrap_noise(rng, 32, 2)
    t.a[n > 0.62] = col("#3283d9")
    t.a[n < 0.33] = col("#2d7bd1")
    crests = [
        ["..llll...", ".l....ll.", "l.......l"],
        [".lll..", "l...ll"],
        ["..lll.", "ll...l"],
        ["lllll"],
        [".ll.", "l..l"],
    ]
    for i, (x, y) in enumerate(scatter(rng, 26, 9.5)):
        art = crests[int(rng.integers(len(crests)))]
        x, y = int(x), int(y)
        t.art(art, x, y, {"l": lt})
        # the trough: the same shape one row lower, dark
        tr = Tile(base)
        for j, row in enumerate(art):
            for k, ch in enumerate(row):
                if ch == "l" and t.get(x + k, y + j + 1) != lt:
                    t.px(x + k, y + j + 1, dk)
        if i % 4 == 0:                           # a glint on the crest
            t.px(x + len(art[0]) // 2, y, lt2)
            t.px(x + len(art[0]) // 2 + 1, y, lt2)
    for (x, y) in scatter(rng, 30, 5.0):
        t.px(x, y, dk2 if rng.random() < 0.5 else dk)
        t.px(x + 1, y, dk)
    return t.img()


# ---- rubble ---------------------------------------------------------------------------------

def rubble() -> Img:
    """Flattened ground: crushed grey gravel strewn with broken slabs and blocks. Each chunk
    has a lit upper-left edge, a dark lower-right edge and a one-pixel shadow; a few short
    rusty lines are bent reinforcing bars. Everything is spread evenly so no single piece
    gives the repeat away."""
    from PIL import Image, ImageDraw
    rng = np.random.default_rng(16)
    base = col("rubble_grey")                # #8d8d94
    grit = [col("#7f7f87"), col("#85858c"), col("#96969d"), col("#96969d")]
    chunk_tones = [col("#9d9da4"), col("#aaaab1")]
    edge_dark = col("#75757d")
    shadow, hi, rust = col("#5c5c65"), col("#c6c6cc"), col("#7c5f58")
    t = Tile(base)
    # crushed gravel: two sizes of grit
    n = wrap_noise(rng, 8, 2)
    t.a[n > 0.60] = grit[2]
    t.a[n < 0.40] = grit[1]
    for (x, y) in scatter(rng, 260, 1.8):
        c = grit[int(rng.integers(len(grit)))]
        t.px(x, y, c)
        if rng.random() < 0.3:
            t.px(x + 1, y, c)
    for (x, y) in scatter(rng, 40, 5.0):
        t.px(x, y, shadow)
    # reinforcing bars: short kinked rusty lines
    for (x, y) in scatter(rng, 4, 22.0):
        ang = rng.uniform(0, math.pi)
        for i in range(int(rng.integers(6, 10))):
            t.px(x, y, rust)
            t.px(x + 1, y + 1, shadow)
            if i == 4:
                ang += rng.uniform(-0.9, 0.9)
            x += math.cos(ang)
            y += math.sin(ang)
    # chunks: angular pieces, big ones first so small ones lie on top
    sizes = [7.5] * 5 + [5.5] * 9 + [3.6] * 14 + [2.4] * 16
    spots = scatter(rng, len(sizes), 6.5)
    for (cx, cy), r in zip(spots, sizes):
        k = int(rng.integers(4, 7))
        a0 = rng.uniform(0, 2 * math.pi)
        squash = rng.uniform(0.55, 1.0)
        rot = rng.uniform(0, math.pi)
        pts = []
        for i in range(k):
            ang = a0 + (i + rng.uniform(-0.25, 0.25)) / k * 2 * math.pi
            rr = r * rng.uniform(0.75, 1.1)
            px_, py_ = math.cos(ang) * rr, math.sin(ang) * rr * squash
            pts.append((16 + px_ * math.cos(rot) - py_ * math.sin(rot),
                        16 + px_ * math.sin(rot) + py_ * math.cos(rot)))
        m = Image.new("L", (32, 32), 0)
        ImageDraw.Draw(m).polygon(pts, fill=255)
        m = np.asarray(m) > 0
        tone = chunk_tones[int(rng.integers(len(chunk_tones)))]
        if rng.random() < 0.14:                 # a trace of brick or plaster, heavily greyed
            tone = mix("#b87862", base, 0.68) if rng.random() < 0.5 else mix("#ddd3b8", base, 0.6)
        dark = edge_dark
        ox, oy = int(round(cx)) - 16, int(round(cy)) - 16
        pad = np.pad(m, 1)
        lit = m & (~pad[:-2, 1:-1] | ~pad[1:-1, :-2])            # nothing above or to the left
        shade_ = m & (~pad[2:, 1:-1] | ~pad[1:-1, 2:]) & ~lit    # nothing below or to the right
        for j in range(32):
            for i in range(32):
                if m[j, i]:
                    c = hi if (lit[j, i] and r > 3) else (dark if shade_[j, i] else tone)
                    t.px(ox + i, oy + j, c)
                elif (j > 0 and i > 0 and m[j - 1, i - 1]) or (j > 0 and m[j - 1, i] and r > 3):
                    t.px(ox + i, oy + j, shadow)                 # cast shadow, down and right
        if r > 5 and rng.random() < 0.7:        # a crack across a big slab
            x, y = cx - r * 0.5, cy + rng.uniform(-1, 1)
            for i in range(int(r)):
                if m[int(round(y)) - oy, int(round(x)) - ox]:
                    t.px(x, y, dark)
                x += 1
                y += rng.choice([-1, 0, 0, 1]) * 0.6
    return t.img()


TILES = {
    "ground_asphalt": asphalt,
    "ground_sidewalk": sidewalk,
    "ground_grass": grass,
    "ground_water": water,
    "ground_rubble": rubble,
}


def build() -> dict:
    return {name: fn() for name, fn in TILES.items()}


def seam_error(img: Img) -> float:
    """How strongly the wrap-around join shows, compared with the strongest ordinary line
    inside the tile: the mean color step across the left/right (and top/bottom) border
    divided by the largest mean step between any two neighboring columns (rows) inside.
    1.0 or less means the join is no more visible than something the tile already contains."""
    a = img.a[..., :3].astype(np.float32)
    inner_x = np.abs(a[:, 1:] - a[:, :-1]).mean(axis=(0, 2)).max()
    inner_y = np.abs(a[1:, :] - a[:-1, :]).mean(axis=(1, 2)).max()
    wrap_x = np.abs(a[:, 0] - a[:, -1]).mean()
    wrap_y = np.abs(a[0, :] - a[-1, :]).mean()
    return float(max(wrap_x / max(inner_x, 1e-6), wrap_y / max(inner_y, 1e-6)))
