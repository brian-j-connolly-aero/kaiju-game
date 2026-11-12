"""Ground tiles: 64 x 64 pixels, seamless in both directions, a handful of colors each.

Every drawing call wraps around the edges of the tile (coordinates are taken modulo 64), so
a tuft or a crack that leaves on the right comes back in on the left and the tile repeats
without seams. The base color of each tile is its palette anchor from docs/ASSETS.md.

Scale: the game lays one tile over 8 x 8 meters (TILE in client/src/render/ground.ts), so a
ground pixel is 12.5 cm, almost twice the 6.9 cm of a character pixel. A paving slab one
meter across is 8 pixels; anything drawn larger than a few pixels is larger than a person.
The tiles cover most of the screen and are seen at grazing angles from a soldier's eye and
from far above by a titan, so they are kept quiet: any strong repeating mark shows up as a
lattice across the whole city.
"""
from __future__ import annotations

import math

import numpy as np

from pix import Img, col, mix

T = 64
METERS_PER_TILE = 8.0        # how the game maps a tile (see above)


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
    """Pavement, the base land of the whole city and so the most-seen texture in the game:
    plain square slabs on a straight grid, 8 x 8 pixels each (one meter in the game), parted
    by one quiet joint line. No bevels and no running bond (they read as a brick wall laid
    flat); the slabs differ in brightness by no more than 2 percent, so no lattice shows
    from a titan's height. The slab tone is a touch lighter than the palette anchor so that
    slabs and joints together average to the anchor #b9bcc6."""
    rng = np.random.default_rng(12)
    joint = col("#a9acb8")
    tones = [col("#bec1ca"), col("#bbbec7"), col("#c1c4cd"), col("#bec1ca")]       # within 2% of each other
    speck_d, speck_l = col("#b6b9c3"), col("#c5c8d0")
    t = Tile(tones[0])
    for row in range(8):
        for c in range(8):
            x0, y0 = c * 8, row * 8
            t.rect(x0, y0, x0 + 7, y0 + 7, tones[int(rng.integers(len(tones)))])
            t.hline(x0, x0 + 7, y0 + 7, joint)             # joint below
            t.vline(x0 + 7, y0, y0 + 7, joint)             # joint at the right
            if rng.random() < 0.3:                         # a grain of grit on some slabs
                t.px(x0 + rng.integers(1, 6), y0 + rng.integers(1, 6), speck_d if rng.random() < 0.6 else speck_l)
    return t.img()


# ---- grass ----------------------------------------------------------------------------------

def grass() -> Img:
    """Lawn: bright model-railway green with darker and lighter tufts of blades and two
    tiny flowers."""
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
    # two flowers only, white and pink: more of them line up into a lattice from above, and
    # yellow is reserved for charging volleys
    for (x, y), c in zip(scatter(rng, 2, 24.0), ("#dff5e1", "#ffb3d1")):
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
    """Flattened ground. The design says destroyed ground turns flat grey, and soldiers have
    to read against it, so this is the quietest tile after asphalt: fine grit within ten
    percent of the anchor #8d8d94, at most six broken slabs a little lighter than the grit,
    each with a one-pixel shadow along its lower right side only (no light rim), and three
    small brick-red flecks."""
    from PIL import Image, ImageDraw
    rng = np.random.default_rng(16)
    base = col("rubble_grey")                # #8d8d94
    grit_dk, grit_lt = col("#84848b"), col("#95959c")       # about 6% either side
    grit_dk2 = col("#7f7f86")                               # 10% down, used sparingly
    slab_tones = [col("#96969d"), col("#9a9aa1")]
    shadow = col("#77777e")
    brick = col("#9c6f66")
    t = Tile(base)
    # crushed gravel: soft patches, then single grains
    n = wrap_noise(rng, 16, 2)
    t.a[n > 0.62] = col("#919198")
    t.a[n < 0.38] = col("#89898f")
    for (x, y) in scatter(rng, 230, 2.0):
        r = rng.random()
        c = grit_dk if r < 0.5 else (grit_lt if r < 0.93 else grit_dk2)
        t.px(x, y, c)
        if rng.random() < 0.25:
            t.px(x + 1, y, c)
    # six slabs, about a meter across, well apart so none of them pairs up into a pattern
    spots = scatter(rng, 6, 19.0)
    for k, (cx, cy) in enumerate(spots):
        r = 4.6 + 2.2 * rng.random()
        sides = int(rng.integers(4, 6))
        a0 = rng.uniform(0, 2 * math.pi)
        squash = rng.uniform(0.6, 0.9)
        rot = rng.uniform(0, math.pi)
        pts = []
        for i in range(sides):
            ang = a0 + (i + rng.uniform(-0.2, 0.2)) / sides * 2 * math.pi
            rr = r * rng.uniform(0.8, 1.1)
            px_, py_ = math.cos(ang) * rr, math.sin(ang) * rr * squash
            pts.append((16 + px_ * math.cos(rot) - py_ * math.sin(rot),
                        16 + px_ * math.sin(rot) + py_ * math.cos(rot)))
        m = Image.new("L", (32, 32), 0)
        ImageDraw.Draw(m).polygon(pts, fill=255)
        m = np.asarray(m) > 0
        tone = slab_tones[k % len(slab_tones)]
        ox, oy = int(round(cx)) - 16, int(round(cy)) - 16
        for j in range(32):
            for i in range(32):
                if m[j, i]:
                    t.px(ox + i, oy + j, tone)
                elif j > 0 and i > 0 and m[j - 1, i - 1]:
                    t.px(ox + i, oy + j, shadow)             # the one shadow line, down and right
        if k % 2 == 0:                          # a hairline crack across every other slab
            x, y = cx - r * 0.45, cy + rng.uniform(-1, 1)
            for i in range(int(r * 0.9)):
                if 0 <= int(round(y)) - oy < 32 and 0 <= int(round(x)) - ox < 32 and m[int(round(y)) - oy, int(round(x)) - ox]:
                    t.px(x, y, base)
                x += 1
                y += rng.choice([-1, 0, 0, 1]) * 0.5
    # three brick flecks: what is left of a wall
    for (x, y) in scatter(rng, 3, 20.0):
        t.px(x, y, brick).px(x + 1, y, brick)
        t.px(x + 1, y + 1, shadow)
    return t.img()


# ---- plaza ----------------------------------------------------------------------------------

def plaza() -> Img:
    """Civic squares (the city's plaza areas): big pale sandstone flags, 16 x 16 pixels (two
    meters) on a straight grid, warmer and twice the size of the pavement's slabs so a square
    reads as a place of its own. One quiet joint line, tones within 3 percent of each other,
    a little grit; no bevels and no bond (they read as a wall laid flat). Slabs and joints
    together average to the client's plaza color #d6cdb8."""
    rng = np.random.default_rng(17)
    joint = col("#c4bba6")
    tones = [col("#d9d1bd"), col("#d7cfba"), col("#dcd4c0"), col("#d9d1bd"), col("#d6ceb9")]
    speck_d, speck_l = col("#cfc6b1"), col("#e1d9c6")
    t = Tile(tones[0])
    for row in range(4):
        for c in range(4):
            x0, y0 = c * 16, row * 16
            t.rect(x0, y0, x0 + 15, y0 + 15, tones[int(rng.integers(len(tones)))])
            t.hline(x0, x0 + 15, y0 + 15, joint)
            t.vline(x0 + 15, y0, y0 + 15, joint)
            for _ in range(int(rng.integers(1, 4))):       # a few grains of grit on each flag
                t.px(x0 + rng.integers(1, 14), y0 + rng.integers(1, 14), speck_d if rng.random() < 0.6 else speck_l)
    return t.img()


# ---- far ------------------------------------------------------------------------------------

def far() -> Img:
    """The plain round the city, out to where the fog ends: seen only far off and at a grazing
    angle, under fog. Muted grey-green scrub in soft patches (no blades, no flowers, no lines),
    the quietest tile of all, so that 18 kilometers of it never show the 8 m repeat."""
    rng = np.random.default_rng(18)
    base = col("#7c9a78")
    t = Tile(base)
    n = wrap_noise(rng, 32, 2)
    t.a[n > 0.62] = col("#80a07c")
    t.a[n < 0.36] = col("#78956f")
    m = wrap_noise(rng, 16, 1)
    t.a[(m > 0.70) & (n > 0.45)] = col("#84a37f")
    for (x, y) in scatter(rng, 70, 4.0):
        t.px(x, y, col("#748f70") if rng.random() < 0.55 else col("#86a482"))
    return t.img()


TILES = {
    "ground_asphalt": asphalt,
    "ground_sidewalk": sidewalk,
    "ground_grass": grass,
    "ground_water": water,
    "ground_rubble": rubble,
    "ground_plaza": plaza,
    "ground_far": far,
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


ANCHORS = {
    "ground_asphalt": "road", "ground_sidewalk": "sidewalk", "ground_grass": "grass",
    "ground_water": "water", "ground_rubble": "rubble_grey",
    "ground_plaza": "#d6cdb8", "ground_far": "#7c9a78",       # the client's own colors for them
}


def anchor_error(name: str, img: Img) -> int:
    """How far the tile's average color is from its palette anchor: the largest difference
    of the three channels, in steps of 1/255."""
    avg = img.a[..., :3].reshape(-1, 3).astype(np.float64).mean(axis=0)
    want = np.array(col(ANCHORS[name])[:3], np.float64)
    return int(np.ceil(np.abs(avg - want).max() - 1e-9))


def busyness(img: Img) -> float:
    """How loud the tile is: the spread of its brightness (5th to 95th percentile of
    luminance, 0..1). Rubble must stay under 0.07, about half of its first version."""
    a = img.a[..., :3].astype(np.float64) / 255.0
    lum = a @ np.array([0.2126, 0.7152, 0.0722])
    lo, hi = np.percentile(lum, [5, 95])
    return float(hi - lo)
