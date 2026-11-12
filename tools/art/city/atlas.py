"""The shared city atlas: layout (named regions) and the painter that draws both images.

    client/public/assets/textures/city_atlas.png            daylight colors
    client/public/assets/textures/city_atlas_emissive.png   same layout: what glows at night

1024 x 512 pixels, drawn pixel by pixel for nearest filtering. On facades and roofs one pixel
is 0.1875 m (16 px = one 3 m storey or bay), so every building shares one scale.

Regions have names (`REGIONS["plaster_sash"]`). The kit maps faces onto regions by name; it
never uses raw pixel numbers. Kinds:

    facade   repeats by bays (16 px wide) and storeys (16 px tall, ground strips 24 px);
             a wall is cut at whole region repeats, every piece shows whole windows
    texture  repeats in meters (roofs, plain walls, rubble, awning stripes, railings)
    picture  stretched once over a quad (signs, doors, a single window)
    swatch   one flat color; vertex color does the rest (trim, balconies, roof clutter)

Facades, ground strips, plain walls and doors have a `_dmg` twin of the same size: the
destruction generator swaps a face onto the twin (broken glass, soot, cracks; at night some
of the holes glow with fire).

Blocks reserved for the building families (each family paints only its own block, from its
own file `tools/art/city/atlas_extra/<family>.py`; see README):

    homes      x   0..128, y 256..384     blocks     x 128..256, y 256..384
    industry   x 256..384, y 256..384     landmarks  x 512..1024, y 256..512
    spare      x 384..512, y 256..384; x 0..512, y 384..512; x 384..1024, y 192..256 (kit)
"""
from __future__ import annotations

import importlib
import json
import os
import pkgutil
import zlib
from dataclasses import dataclass, field

import numpy as np

from . import style

W, H = 1024, 512
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
TEXTURES = os.path.join(REPO, "client", "public", "assets", "textures")
COLOR_PNG = os.path.join(TEXTURES, "city_atlas.png")
EMISSIVE_PNG = os.path.join(TEXTURES, "city_atlas_emissive.png")


@dataclass
class Region:
    name: str
    x: int
    y: int
    w: int
    h: int
    kind: str                       # facade | texture | picture | swatch
    bay_px: int = 16                # facade: pixels per bay
    storey_px: int = 16             # facade: pixels per storey (24 for ground strips)
    tint: bool = False              # authored to be tinted (light neutral wall pixels)
    twin: str | None = None         # name of the damaged twin
    owner: str = "kit"
    note: str = ""

    @property
    def bays(self) -> int:
        return self.w // self.bay_px

    @property
    def storeys(self) -> int:
        return self.h // self.storey_px

    @property
    def meters(self) -> tuple[float, float]:
        return self.w * style.PX, self.h * style.PX

    def uv(self, px: float, py: float) -> tuple[float, float]:
        """Blender UV (v up) of a pixel position inside the region (px right, py DOWN)."""
        return (self.x + px) / W, 1.0 - (self.y + py) / H

    def as_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "w": self.w, "h": self.h, "kind": self.kind,
                "bay_px": self.bay_px, "storey_px": self.storey_px, "tint": self.tint,
                "twin": self.twin, "owner": self.owner, "note": self.note}


REGIONS: dict[str, Region] = {}
BLOCKS = {
    "homes": (0, 256, 128, 128),
    "blocks": (128, 256, 128, 128),
    "industry": (256, 256, 128, 128),
    "landmarks": (512, 256, 512, 256),
}


def region(name: str) -> Region:
    try:
        return REGIONS[name]
    except KeyError:
        raise KeyError(f"no atlas region {name!r}; known: {', '.join(sorted(REGIONS))}") from None


def add_region(name, x, y, w, h, kind, twin=False, owner="kit", **kw) -> Region:
    """Register a region (and its damaged twin, placed by the caller with `twin=(x, y)`)."""
    if name in REGIONS:
        raise ValueError(f"atlas region {name!r} defined twice")
    r = Region(name, x, y, w, h, kind, owner=owner, **kw)
    if not (0 <= x and 0 <= y and x + w <= W and y + h <= H):
        raise ValueError(f"atlas region {name!r} leaves the atlas")
    for other in REGIONS.values():
        if x < other.x + other.w and other.x < x + w and y < other.y + other.h and other.y < y + h:
            raise ValueError(f"atlas region {name!r} overlaps {other.name!r}")
    if owner != "kit":
        bx, by, bw, bh = BLOCKS[owner]
        if not (bx <= x and by <= y and x + w <= bx + bw and y + h <= by + bh):
            raise ValueError(f"region {name!r} of family {owner!r} is outside its block {BLOCKS[owner]}")
    REGIONS[name] = r
    if twin:
        tx, ty = twin
        r.twin = name + "_dmg"
        add_region(r.twin, tx, ty, w, h, kind, owner=owner, bay_px=r.bay_px, storey_px=r.storey_px,
                   tint=r.tint, note=f"damaged twin of {name}")
    return r


# ---- the kit's layout ----------------------------------------------------------------------
C = 64   # layout cell


def _layout() -> None:
    # tower curtain walls: 4 bays x 8 storeys
    for i, (name, note) in enumerate([("glass_teal", "tower glass, teal"), ("glass_dark", "tower glass, dark"),
                                       ("glass_blue", "office glass, sky blue, white spandrels")]):
        add_region(name, (2 * i) * C, 0, C, 2 * C, "facade", twin=((2 * i + 1) * C, 0), note=note)
    upper = [("plaster_sash", True, "plaster wall, white sash windows (tintable)"),
             ("brick_sash", False, "red brick, white windows, stone lintels"),
             ("clapboard", True, "painted boards, windows with shutters (tintable)"),
             ("stone_grid", False, "pale stone grid, deep office windows"),
             ("strip_concrete", False, "concrete, ribbon windows")]
    for i, (name, tint, note) in enumerate(upper):
        add_region(name, (6 + 2 * i) * C, 0, C, C, "facade", twin=((7 + 2 * i) * C, 0), tint=tint, note=note)
    row1 = [("metal_clad", "facade", False, "corrugated cladding, high strip windows"),
            ("brick_works", "facade", False, "works brick, tall steel windows"),
            ("plaster_plain", "texture", True, "plaster, no windows (tintable)"),
            ("brick_plain", "texture", False, "brick, no windows"),
            ("concrete_plain", "texture", False, "concrete, no windows")]
    for i, (name, kind, tint, note) in enumerate(row1):
        add_region(name, (6 + 2 * i) * C, C, C, C, kind, twin=((7 + 2 * i) * C, C), tint=tint, note=note)
    # ground storeys, 4 bays x one 4.5 m storey (24 px); twin below each
    ground = [("shopfront", True, "shop window, display, blank sign band on top (tintable frame)"),
              ("lobby", False, "stone and full-height glass"),
              ("loading", False, "concrete, high windows, dark plinth"),
              ("arcade", True, "columns and shaded arches (tintable)"),
              ("plinth", False, "rusticated stone base, small windows")]
    for i, (name, tint, note) in enumerate(ground):
        add_region(name, i * C, 2 * C, C, 24, "facade", storey_px=24, twin=(i * C, 2 * C + 24), tint=tint, note=note)
    add_region("cornice", 0, 2 * C + 48, C, 8, "texture", note="stone cornice with dentils")
    add_region("cornice_white", 0, 2 * C + 56, C, 8, "texture", note="white painted cornice (tintable)", tint=True)
    add_region("rail_metal", C, 2 * C + 48, C, 6, "texture", note="balcony / parapet railing, metal bars")
    add_region("rail_glass", C, 2 * C + 56, C, 6, "texture", note="glass balustrade")
    add_region("awning_red", 5 * C, 2 * C, C, 16, "texture", note="canvas stripes, 0.75 m")
    add_region("awning_green", 5 * C, 2 * C + 16, C, 16, "texture")
    add_region("awning_blue", 5 * C, 2 * C + 32, C, 16, "texture")
    add_region("awning_gold", 5 * C, 2 * C + 48, C, 16, "texture")
    roofs = [("tile_red", "clay tiles, red"), ("tile_slate", "slate, blue grey"),
             ("tile_terra", "terracotta tiles (Temple Hill)"), ("gravel", "flat roof gravel"),
             ("metal", "corrugated metal roof"), ("glass_roof", "glazed roof, iron frame"),
             ("copper", "weathered copper, standing seams"), ("tar", "dark tar roof, patches")]
    for i, (name, note) in enumerate(roofs):
        add_region(name, (6 + i) * C, 2 * C, C, C, "texture", note=note)
    add_region("interior", 14 * C, 2 * C, C, C, "texture", note="broken-open floors (cavities)")
    add_region("rubble", 15 * C, 2 * C, C, C, "texture", note="broken concrete and brick")
    # signs: 4 x 4 pictures of 32 x 16 px (6 x 3 m boards; scale freely, keep 2:1)
    for k, name in enumerate(SIGNS):
        add_region(f"sign_{name}", (k % 4) * 32, 3 * C + (k // 4) * 16, 32, 16, "picture", note="picture sign")
    # doors and single windows (pictures), each with its twin
    dx, dy = 2 * C, 3 * C
    for k, name in enumerate(("door_red", "door_green", "door_blue")):
        add_region(name, dx + k * 16, dy, 16, 16, "picture", twin=(dx + k * 16, dy + 16), tint=True,
                   note="a door bay: replaces one window bay of a storey (door 1.125 x 2.25 m)")
    add_region("door_double", dx + 48, dy, 12, 14, "picture", twin=(dx + 48, dy + 16), note="double glass door 2.25 x 2.625 m")
    add_region("door_garage", dx, dy + 34, 16, 12, "picture", twin=(dx + 18, dy + 34), note="garage 3 x 2.25 m")
    ex = 6 * C
    add_region("door_roller", ex, dy, 20, 20, "picture", twin=(ex + 21, dy), note="loading door 3.75 x 3.75 m")
    add_region("window_single", ex + 42, dy, 8, 10, "picture", twin=(ex + 51, dy), note="one window 1.5 x 1.875 m (gables, dormers)", tint=True)
    add_region("vent", ex + 42, dy + 12, 16, 8, "texture", note="louvres for plant rooms and AC boxes")
    add_region("metal_plain", 3 * C, 3 * C, C, C, "texture", twin=(4 * C, 3 * C), note="corrugated cladding, no windows")
    # swatches, 8 x 8: the flat color everything without a picture uses
    sw = [("white", "#ffffff", None), ("lamp", "#fff4d6", "#ffd27a"), ("beacon", "#d7263d", "#ff3a3a"),
          ("neon_pink", "#f2a4c8", "#ff5fb0"), ("neon_mint", "#b4f0d8", "#5dffc0"), ("glass", style.GLASS_DAY, None),
          ("lit_glass", "#6f8fb8", "#ffe2a0"), ("dark", "#1d1f26", None)]
    for k, (name, col, emi) in enumerate(sw):
        add_region(name, 5 * C + (k % 4) * 16 + 4, 3 * C + (k // 4) * 16 + 4, 8, 8, "swatch",
                   note=f"color {col}" + (f", glows {emi}" if emi else ""))
        SWATCHES[name] = (col, emi)
    add_region("staves", 5 * C, 3 * C + 32, 16, 16, "texture", note="wooden water tank staves")
    add_region("grille", 5 * C + 16, 3 * C + 32, 16, 16, "texture", note="metal grille")


SIGNS = ["cup", "loaf", "fish", "shoe", "scissors", "key", "glasses", "bowl",
         "cone", "flower", "wrench", "book", "pill", "note", "rings", "chevron"]
SWATCHES: dict[str, tuple] = {}
_layout()


# =========================================================================================
# painting
# =========================================================================================
def hexrgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


@dataclass
class Canvas:
    col: np.ndarray = field(default_factory=lambda: np.zeros((H, W, 3), np.float32))
    emi: np.ndarray = field(default_factory=lambda: np.zeros((H, W, 3), np.float32))

    def view(self, r: Region):
        return self.col[r.y:r.y + r.h, r.x:r.x + r.w], self.emi[r.y:r.y + r.h, r.x:r.x + r.w]


def rng_for(name: str) -> np.random.Generator:
    return np.random.default_rng(zlib.crc32(name.encode()))


def noise(rng, shape, amount):
    return (rng.random(shape[:2])[..., None] - 0.5) * 2 * amount


def fill(a, color, rng=None, amount=0.0):
    a[...] = hexrgb(color) if isinstance(color, str) else color
    if rng is not None and amount:
        a += noise(rng, a.shape, amount)


# Window lights at night (emissive), a few warm and cool tones
LIGHTS_HOME = ["#ffcf70", "#ffd88a", "#ffe6b0", "#ffc060", "#a8d0ff"]
LIGHTS_OFFICE = ["#e8f0ff", "#f4f7ff", "#d6e6ff", "#fff3d8"]


class Windows:
    """Collects where the panes are, so the damaged twin and the night lights can find them."""

    def __init__(self, shape):
        self.label = np.zeros(shape[:2], np.int32)
        self.n = 0

    def add(self, y0, y1, x0, x1, lab=None):
        if lab is None:
            self.n += 1
            lab = self.n
        self.label[y0:y1, x0:x1] = lab
        return lab


def light_windows(emi, win: Windows, rng, share: float, tones, dim=1.0, curtains=None):
    for lab in range(1, win.n + 1):
        if rng.random() >= share:
            continue
        m = win.label == lab
        c = hexrgb(tones[rng.integers(len(tones))]) * dim
        emi[m] = c
        ys, xs = np.nonzero(m)
        if len(ys) and rng.random() < 0.35:           # a lamp-lit lower half, a darker top
            top = ys.min() + (ys.max() - ys.min() + 1) // 3
            emi[m & (np.arange(m.shape[0])[:, None] < top)] *= 0.55


# ---- window drawing ----------------------------------------------------------------------
def sash_window(c, win, y, x, rng, frame="#ffffff", glass=style.GLASS_DAY, w=8, h=10, sill=True,
                bars=True, shutters=None, lintel=None):
    """A window with its top-left frame corner at (y, x)."""
    fr, gl = hexrgb(frame), hexrgb(glass)
    if lintel is not None:
        c[y - 1, x - 1:x + w + 1] = hexrgb(lintel)
    else:
        c[y - 1, x:x + w] *= 0.82                      # shadow under the head
    c[y:y + h, x:x + w] = fr
    c[y + 1:y + h - 1, x + 1:x + w - 1] = gl
    # a sky reflection: two light pixels in the top corner of each pane
    c[y + 1, x + 1] = gl * 1.9
    c[y + 2, x + 1] = gl * 1.45
    if w >= 8:
        c[y + 1, x + w // 2 + 1] = gl * 1.6
    if rng.random() < 0.3:                             # curtains
        cur = hexrgb(["#f2c4a8", "#d8e8c8", "#f0e0a8", "#c8d8f0", "#e8c0d0"][rng.integers(5)])
        c[y + 1:y + h - 1, x + 1] = cur
        c[y + 1:y + h - 1, x + w - 2] = cur
    if bars:
        c[y + h // 2 - 1, x + 1:x + w - 1] = fr
        if w >= 8:
            c[y + 1:y + h - 1, x + w // 2 - 1 + (w % 2)] = fr * 0.97
    lab = win.add(y + 1, y + h - 1, x + 1, x + w - 1)
    if bars:
        win.label[y + h // 2 - 1, x + 1:x + w - 1] = 0
    if sill:
        c[y + h, x - 1:x + w + 1] = fr
        c[y + h + 1, x - 1:x + w + 1] *= 0.8
    if shutters is not None:
        sh = hexrgb(shutters)
        for sx in (x - 2, x + w):
            c[y:y + h, sx:sx + 2] = sh
            c[y + 1:y + h:2, sx:sx + 2] = sh * 0.8
    return lab


# ---- region painters ---------------------------------------------------------------------
PAINTERS = {}


def painter(*names):
    def deco(fn):
        for n in names:
            PAINTERS[n] = fn
        return fn
    return deco


WALL_TINT = "#dcd8cf"      # tintable wall pixels: light neutral, frames brighter


@painter("plaster_sash")
def _plaster(cv, r, rng):
    c, e = cv.view(r)
    fill(c, WALL_TINT, rng, 5)
    win = Windows(c.shape)
    for by in range(r.storeys):
        for bx in range(r.bays):
            sash_window(c, win, by * 16 + 2, bx * 16 + 4, rng)
        c[by * 16 + 15, :] *= 0.93                      # storey line, faint
    light_windows(e, win, rng, 0.55, LIGHTS_HOME)
    return win


def brick(c, rng, base="#b65740", mortar="#8c4a3c"):
    fill(c, base, rng, 10)
    hgt = c.shape[0]
    tone = rng.random((hgt // 3 + 2, c.shape[1] // 4 + 2))
    for y in range(hgt):
        for x in range(c.shape[1]):
            k = tone[y // 3, (x + (2 if (y // 3) % 2 else 0)) // 4]
            c[y, x] *= 0.9 + 0.2 * k
    c[2::3, :] = hexrgb(mortar)
    for y in range(0, hgt, 3):
        off = 2 if (y // 3) % 2 else 0
        c[y:y + 2, off::4] = (c[y:y + 2, off::4] * 0.85)


@painter("brick_sash")
def _brick_sash(cv, r, rng):
    c, e = cv.view(r)
    brick(c, rng)
    win = Windows(c.shape)
    for by in range(r.storeys):
        for bx in range(r.bays):
            sash_window(c, win, by * 16 + 3, bx * 16 + 4, rng, lintel="#e6dccb", h=9)
    light_windows(e, win, rng, 0.5, LIGHTS_HOME)
    return win


@painter("clapboard")
def _clap(cv, r, rng):
    c, e = cv.view(r)
    fill(c, "#e4e2dc", rng, 3)
    c[1::2, :] *= 0.9
    win = Windows(c.shape)
    for by in range(r.storeys):
        for bx in range(r.bays):
            if bx % 2 == 0 or rng.random() < 0.5:
                sash_window(c, win, by * 16 + 2, bx * 16 + 5, rng, w=6, shutters="#2e6b4f" if (by + bx) % 3 else "#2f62c9")
    light_windows(e, win, rng, 0.55, LIGHTS_HOME)
    return win


@painter("stone_grid")
def _stone_grid(cv, r, rng):
    c, e = cv.view(r)
    fill(c, "#d8d0bf", rng, 4)
    win = Windows(c.shape)
    for by in range(r.storeys):
        y = by * 16
        c[y + 13:y + 16, :] = hexrgb("#c9c0ad")                  # spandrel
        c[y + 13, :] = hexrgb("#ece6d8")
        for bx in range(r.bays):
            x = bx * 16
            c[y:y + 16, x] = hexrgb("#ece6d8")                    # pilaster edge
            c[y:y + 16, x + 15] = hexrgb("#b9b09c")
            c[y + 1:y + 12, x + 2:x + 14] = hexrgb("#9a927f")     # reveal
            c[y + 2:y + 12, x + 3:x + 13] = hexrgb("#33435e")
            c[y + 2:y + 12, x + 7:x + 9] = hexrgb("#7d8494")      # mullion
            c[y + 3, x + 4] = hexrgb("#7f9ec4")
            c[y + 3, x + 10] = hexrgb("#7f9ec4")
            win.add(y + 2, y + 12, x + 3, x + 7)
            win.add(y + 2, y + 12, x + 9, x + 13)
    light_windows(e, win, rng, 0.7, LIGHTS_OFFICE)
    return win


@painter("strip_concrete")
def _strip(cv, r, rng):
    c, e = cv.view(r)
    fill(c, "#c3beb3", rng, 6)
    win = Windows(c.shape)
    for by in range(r.storeys):
        y = by * 16
        c[y + 3:y + 11, :] = hexrgb("#3a4a62")
        c[y + 3, :] = hexrgb("#5d6a7c")
        c[y + 11, :] = hexrgb("#8e8a80")
        for x in range(0, r.w, 8):
            c[y + 3:y + 11, x] = hexrgb("#5d6a7c")
            c[y + 4, x + 2] = hexrgb("#8aa6c8")
            win.add(y + 4, y + 11, x + 1, x + 8)
    light_windows(e, win, rng, 0.6, LIGHTS_HOME + LIGHTS_OFFICE)
    return win


def corrugated(c, rng, base=style.METAL, period=2):
    fill(c, base, rng, 4)
    c[:, ::period] *= 0.84
    # streaks of weather
    for _ in range(c.shape[1] // 6):
        x = rng.integers(c.shape[1])
        y0 = rng.integers(c.shape[0])
        c[y0:y0 + rng.integers(4, 14), x] *= 0.9


@painter("metal_clad")
def _metal(cv, r, rng):
    c, e = cv.view(r)
    corrugated(c, rng)
    win = Windows(c.shape)
    for by in range(r.storeys):
        y = by * 16
        c[y + 2:y + 8, :] = hexrgb("#4d6470")
        c[y + 2, :] = hexrgb("#d9dde2")
        c[y + 7, :] = hexrgb("#d9dde2")
        for x in range(0, r.w, 4):
            c[y + 2:y + 8, x] = hexrgb("#d9dde2")
            c[y + 3, x + 1] = hexrgb("#8fb0bd")
            win.add(y + 3, y + 7, x + 1, x + 4)
        c[y + 15, :] *= 0.75
    light_windows(e, win, rng, 0.45, ["#fff2c8", "#e8f0ff"], dim=0.9)
    return win


@painter("brick_works")
def _works(cv, r, rng):
    c, e = cv.view(r)
    brick(c, rng, base="#a24c38", mortar="#7a3e30")
    win = Windows(c.shape)
    for by in range(r.storeys):
        y = by * 16
        for bx in range(r.bays):
            x = bx * 16
            c[y + 1:y + 15, x + 3:x + 13] = hexrgb("#d9cdb6")          # stone surround
            c[y + 2:y + 14, x + 4:x + 12] = hexrgb("#3d4d55")
            c[y + 2, x + 4] = c[y + 2, x + 11] = hexrgb("#d9cdb6")    # rounded top
            for gx in range(x + 4, x + 12, 3):
                c[y + 2:y + 14, gx] = hexrgb("#6f7c80")
            for gy in range(y + 5, y + 14, 3):
                c[gy, x + 4:x + 12] = hexrgb("#6f7c80")
            c[y + 3, x + 5] = hexrgb("#8fb0bd")
            win.add(y + 3, y + 14, x + 5, x + 11)
    light_windows(e, win, rng, 0.5, ["#ffd38a", "#fff0c8"], dim=0.9)
    return win


@painter("plaster_plain")
def _pplain(cv, r, rng):
    c, _ = cv.view(r)
    fill(c, WALL_TINT, rng, 5)
    for _ in range(6):                                  # faint stains
        y, x = rng.integers(r.h - 4), rng.integers(r.w - 4)
        c[y:y + 3, x:x + 4] *= 0.97


@painter("brick_plain")
def _bplain(cv, r, rng):
    brick(cv.view(r)[0], rng)


@painter("concrete_plain")
def _cplain(cv, r, rng):
    c, _ = cv.view(r)
    fill(c, "#c3beb3", rng, 7)
    c[::16, :] *= 0.9                                    # formwork lines every 3 m
    c[:, ::21] *= 0.94


@painter("metal_plain")
def _mplain(cv, r, rng):
    corrugated(cv.view(r)[0], rng)


@painter("glass_teal", "glass_dark", "glass_blue")
def _glass(cv, r, rng):
    c, e = cv.view(r)
    spec = {
        "glass_teal": dict(glass="#3f9fa8", hi="#8fd8dc", mull="#d6e4e6", band="#2c6f78", lights=0.45),
        "glass_dark": dict(glass="#263248", hi="#55688c", mull="#a8875a", band="#1a2232", lights=0.4),
        "glass_blue": dict(glass="#5f8fcc", hi="#b8d8f6", mull="#f2f4f6", band="#eef0f2", lights=0.5),
    }[r.name]
    fill(c, spec["glass"], rng, 4)
    hgt, wid = c.shape[:2]
    # big diagonal reflections of sky, the same across the whole region
    yy, xx = np.mgrid[0:hgt, 0:wid]
    stripe = ((xx + yy * 0.6) % 46) < 9
    c[stripe] = c[stripe] * 0.6 + hexrgb(spec["hi"]) * 0.4
    grad = (1.0 - (yy % 16) / 16.0 * 0.15)[..., None]
    c *= grad
    win = Windows(c.shape)
    for by in range(r.storeys):
        y = by * 16
        c[y + 13:y + 16, :] = hexrgb(spec["band"])
        if r.name == "glass_blue":
            c[y + 13, :] = hexrgb("#c9ced6")
        for x in range(0, wid, 8):
            c[y:y + 16, x] = hexrgb(spec["mull"])
            win.add(y, y + 13, x + 1, x + 8)
    light_windows(e, win, rng, spec["lights"], LIGHTS_OFFICE, dim=0.95)
    return win


@painter("shopfront")
def _shop(cv, r, rng):
    c, e = cv.view(r)
    fill(c, WALL_TINT, rng, 3)
    win = Windows(c.shape)
    c[0:6, :] = hexrgb("#ecebe6")                        # blank sign band (the sign quad goes here)
    c[5, :] *= 0.85
    c[20:24, :] = hexrgb("#55505a")                      # bulkhead
    for bx in range(r.bays):
        x = bx * 16
        c[7:20, x:x + 16] = hexrgb("#ffffff")
        c[8:19, x + 1:x + 15] = hexrgb("#2f4058")
        c[8:19, x + 8] = hexrgb("#ffffff")
        c[9, x + 2] = c[9, x + 9] = hexrgb("#8fb0d0")
        for k in range(6):                               # goods on display
            gx = x + 2 + k * 2 + (1 if k >= 3 else 0)
            gy = 15 + rng.integers(0, 3)
            c[gy:19, gx] = hexrgb(["#e0372f", "#f2c14e", "#3fa652", "#f29b85", "#8f6fd0", "#ffffff"][rng.integers(6)])
        win.add(8, 19, x + 1, x + 8)
        win.add(8, 19, x + 9, x + 15)
    e[...] = 0
    for lab in range(1, win.n + 1):                      # shops: most windows lit
        if rng.random() < 0.8:
            m = win.label == lab
            e[m] = hexrgb(["#fff0c0", "#ffe39a", "#f4f7ff"][rng.integers(3)])
    return win


@painter("lobby")
def _lobby(cv, r, rng):
    c, e = cv.view(r)
    fill(c, "#d8d0bf", rng, 4)
    c[0:4, :] = hexrgb("#c9c0ad")
    c[3, :] = hexrgb("#ece6d8")
    win = Windows(c.shape)
    for bx in range(r.bays):
        x = bx * 16
        c[5:24, x + 1:x + 15] = hexrgb("#3c3f48")
        c[6:24, x + 2:x + 14] = hexrgb("#33435e")
        c[6:24, x + 8] = hexrgb("#3c3f48")
        c[7, x + 3] = c[7, x + 10] = hexrgb("#7f9ec4")
        win.add(6, 24, x + 2, x + 8)
        win.add(6, 24, x + 9, x + 14)
    light_windows(e, win, rng, 0.85, ["#fff3d8", "#f4f7ff"])
    return win


@painter("loading")
def _loading(cv, r, rng):
    c, e = cv.view(r)
    fill(c, "#c3beb3", rng, 6)
    c[18:24, :] = hexrgb("#6a6862")
    c[18, :] = hexrgb("#8e8a80")
    win = Windows(c.shape)
    for bx in range(r.bays):
        x = bx * 16
        c[3:8, x + 3:x + 13] = hexrgb("#dcdcd6")
        c[4:7, x + 4:x + 12] = hexrgb("#4d6470")
        win.add(4, 7, x + 4, x + 12)
    light_windows(e, win, rng, 0.4, ["#fff2c8"], dim=0.8)
    return win


@painter("arcade")
def _arcade(cv, r, rng):
    c, e = cv.view(r)
    fill(c, WALL_TINT, rng, 4)
    win = Windows(c.shape)
    for bx in range(r.bays):
        x = bx * 16
        c[6:24, x + 3:x + 13] = hexrgb("#4a4440")                     # shade under the arch
        c[6, x + 3] = c[6, x + 12] = hexrgb(WALL_TINT)
        c[7, x + 3] = c[7, x + 12] = hexrgb(WALL_TINT)
        c[6, x + 4] = c[6, x + 11] = hexrgb(WALL_TINT)
        c[10:22, x + 6:x + 10] = hexrgb("#5f4c3e")                    # a door deep inside
        c[22:24, x:x + 16] = hexrgb("#c8c0b0")
        c[5, x + 2:x + 14] = hexrgb("#f4f2ee")
        win.add(10, 22, x + 6, x + 10)
    light_windows(e, win, rng, 0.6, ["#ffcf70", "#ffe6b0"], dim=0.8)
    return win


@painter("plinth")
def _plinth(cv, r, rng):
    c, e = cv.view(r)
    fill(c, "#cfc6b2", rng, 5)
    for y in range(0, 24, 4):                                          # rusticated courses
        c[y, :] = hexrgb("#a89f8c")
        off = 0 if (y // 4) % 2 else 6
        c[y:y + 4, off::12] = hexrgb("#a89f8c")
    win = Windows(c.shape)
    for bx in range(r.bays):
        x = bx * 16
        c[6:16, x + 4:x + 12] = hexrgb("#efe9dc")
        c[7:15, x + 5:x + 11] = hexrgb("#33435e")
        c[8, x + 6] = hexrgb("#7f9ec4")
        win.add(7, 15, x + 5, x + 11)
    light_windows(e, win, rng, 0.6, LIGHTS_OFFICE)
    return win


@painter("cornice", "cornice_white")
def _cornice(cv, r, rng):
    c, _ = cv.view(r)
    base = "#e3dccb" if r.name == "cornice" else "#f2f0ea"
    fill(c, base, rng, 2)
    c[0, :] = hexrgb(base) * 1.05
    c[3:5, ::3] *= 0.72                                                 # dentils
    c[r.h - 1, :] *= 0.7


@painter("rail_metal", "rail_glass")
def _rail(cv, r, rng):
    c, _ = cv.view(r)
    if r.name == "rail_metal":
        fill(c, "#3a3f4a")
        c[:, ::3] = hexrgb("#e8eaee")
        c[0, :] = hexrgb("#f4f5f7")
        c[r.h - 1, :] = hexrgb("#c9ccd2")
    else:
        fill(c, "#8fc0d6")
        c[1:3, :] = hexrgb("#b8dcec")
        c[0, :] = hexrgb("#f4f5f7")
        c[:, ::16] = hexrgb("#d6dade")


@painter("awning_red", "awning_green", "awning_blue", "awning_gold")
def _awning(cv, r, rng):
    c, _ = cv.view(r)
    col = {"awning_red": "#d7263d", "awning_green": "#2e8a57", "awning_blue": "#2f62c9",
           "awning_gold": "#e3a83c"}[r.name]
    fill(c, "#f7f5ef")
    for x in range(r.w):
        if (x // 4) % 2 == 0:
            c[:, x] = hexrgb(col)
    c[0:2, :] *= 0.85                                                   # top, near the wall
    c[r.h - 2:, :] *= 0.9                                               # valance
    c[r.h - 1, 2::4] *= 0.6                                             # scalloped edge


def roof_tiles(c, rng, base, line, rows=2, joint=3):
    fill(c, base, rng, 8)
    hgt, wid = c.shape[:2]
    for y in range(0, hgt, rows):
        c[y, :] = hexrgb(line)
        off = (y // rows) % 2 * (joint // 2 + 1)
        c[y + 1:y + rows, off::joint] *= 0.86
    for _ in range(wid // 3):                                           # a few odd tiles
        y, x = rng.integers(hgt), rng.integers(wid)
        c[y, x:x + 2] *= 0.85 + 0.3 * rng.random()


@painter("tile_red", "tile_slate", "tile_terra", "gravel", "metal", "glass_roof", "copper", "tar")
def _roofs(cv, r, rng):
    c, e = cv.view(r)
    if r.name == "tile_red":
        roof_tiles(c, rng, "#c25a3e", "#8e3a2a")
    elif r.name == "tile_slate":
        roof_tiles(c, rng, "#64708a", "#454e62", rows=2, joint=4)
    elif r.name == "tile_terra":
        roof_tiles(c, rng, "#dd8752", "#a95a32", rows=2, joint=2)
    elif r.name == "gravel":
        fill(c, "#a3a5ab", rng, 14)
        spots = rng.random((r.h, r.w)) < 0.08
        c[spots] *= 0.8
    elif r.name == "metal":
        corrugated(c, rng, base="#9aa3b0")
        for _ in range(5):
            y, x = rng.integers(r.h - 6), rng.integers(r.w - 6)
            c[y:y + rng.integers(2, 6), x:x + rng.integers(2, 5)] = hexrgb(style.RUST) * (0.85 + 0.3 * rng.random())
    elif r.name == "glass_roof":
        fill(c, "#9cc8d8", rng, 6)
        c[:, ::8] = hexrgb("#3f6b5a")
        c[::5, :] = hexrgb("#3f6b5a")
        e[...] = np.where((c.sum(axis=2) > 400)[..., None], hexrgb("#c8b47a") * 0.35, 0)
    elif r.name == "copper":
        fill(c, "#62b5a0", rng, 10)
        c[:, ::6] = hexrgb("#4a9583")
        c[:, 1::6] *= 1.08
    elif r.name == "tar":
        fill(c, "#4c5160", rng, 6)
        for _ in range(8):
            y, x = rng.integers(r.h - 8), rng.integers(r.w - 8)
            c[y:y + rng.integers(3, 9), x:x + rng.integers(3, 9)] *= 0.85


@painter("interior")
def _interior(cv, r, rng):
    c, e = cv.view(r)
    fill(c, "#3e3632", rng, 10)
    for y in range(0, r.h, 16):                                         # floor slabs every 3 m
        c[y:y + 2, :] = hexrgb("#9a948a")
        c[y + 2, :] = hexrgb("#2a2422")
    for _ in range(14):                                                 # broken walls and beams
        x = rng.integers(r.w)
        y = rng.integers(r.h)
        c[y:y + rng.integers(3, 12), x] = hexrgb("#6a5f58")
    embers = rng.random((r.h, r.w)) < 0.05
    e[embers] = hexrgb("#ff7a2a") * (0.5 + 0.5 * rng.random((int(embers.sum()), 1)))
    glow = rng.random((r.h, r.w)) < 0.02
    e[glow] = hexrgb("#ffb347")


@painter("rubble")
def _rubble(cv, r, rng):
    c, _ = cv.view(r)
    fill(c, style.RUBBLE[0], rng, 6)
    for _ in range(90):                                                 # chunks with a lit top
        y, x = rng.integers(r.h), rng.integers(r.w)
        s = rng.integers(2, 6)
        tone = hexrgb(style.RUBBLE[rng.integers(4)])
        if rng.random() < 0.12:
            tone = hexrgb("#b65740")                                    # a bit of brick
        c[y:y + s, x:x + s] = tone
        c[y, x:x + s] = tone * 1.15
        c[min(y + s, r.h - 1), x:x + s] = tone * 0.6
    for _ in range(6):                                                  # rebar
        y, x = rng.integers(r.h - 6), rng.integers(r.w - 6)
        for k in range(rng.integers(3, 8)):
            if y + k < r.h and x + k < r.w:
                c[y + k, x + k] = hexrgb("#5b4038")


@painter(*[f"sign_{n}" for n in SIGNS])
def _sign(cv, r, rng):
    c, e = cv.view(r)
    paint_sign(r.name[5:], c, e, rng)


@painter("door_red", "door_green", "door_blue")
def _door(cv, r, rng):
    c, e = cv.view(r)
    col = {"door_red": "#b8322e", "door_green": "#2e6b4f", "door_blue": "#2f4f8f"}[r.name]
    fill(c, WALL_TINT, rng, 5)
    c[1:16, 4:12] = hexrgb("#ffffff")                                   # frame
    c[0, 4:12] *= 0.85
    c[2:4, 5:11] = hexrgb("#e8c878")                                    # fanlight
    e[2:4, 5:11] = hexrgb("#ffcf70") * 0.85
    c[4, 5:11] = hexrgb("#ffffff")
    c[5:16, 5:11] = hexrgb(col)
    c[6:9, 6:10] = hexrgb(col) * 0.82                                   # panels
    c[10:14, 6:10] = hexrgb(col) * 0.82
    c[10, 9] = hexrgb("#e3c04f")                                        # knob
    c[15, 3:13] = hexrgb("#bdb9b0")                                     # step


@painter("door_double")
def _door_double(cv, r, rng):
    c, e = cv.view(r)
    fill(c, "#3c3f48")
    c[1:14, 1:11] = hexrgb("#33435e")
    c[1:14, 6] = hexrgb("#3c3f48")
    c[7, 4:6] = c[7, 7:9] = hexrgb("#c9ccd2")
    c[2, 2] = c[2, 8] = hexrgb("#7f9ec4")
    e[1:14, 1:6] = e[1:14, 7:11] = hexrgb("#fff0c8") * 0.9


@painter("door_garage")
def _garage(cv, r, rng):
    c, _ = cv.view(r)
    fill(c, "#f4f2ee")
    c[1:12, 1:15] = hexrgb("#d9d6cf")
    c[2:12:2, 1:15] = hexrgb("#bdb9b0")


@painter("door_roller")
def _roller(cv, r, rng):
    c, _ = cv.view(r)
    fill(c, "#5b6270")
    c[1:20, 1:19] = hexrgb("#a6adb8")
    c[2:20:2, 1:19] = hexrgb("#8a929e")
    c[1, 1:19] = hexrgb("#e3a83c")


@painter("window_single")
def _single(cv, r, rng):
    c, e = cv.view(r)
    fill(c, WALL_TINT)
    win = Windows(c.shape)
    c[0:10, 0:8] = hexrgb("#ffffff")
    c[1:9, 1:7] = hexrgb(style.GLASS_DAY)
    c[4, 1:7] = hexrgb("#ffffff")
    c[1, 1] = hexrgb(style.GLASS_DAY) * 1.9
    win.add(1, 9, 1, 7)
    win.label[4, 1:7] = 0
    e[win.label > 0] = hexrgb("#ffcf70")
    return win


@painter("vent")
def _vent(cv, r, rng):
    c, _ = cv.view(r)
    fill(c, "#c9ccd2")
    c[1:7:2, 1:15] = hexrgb("#6a707c")


@painter("staves")
def _staves(cv, r, rng):
    c, _ = cv.view(r)
    fill(c, "#8a6a4a", rng, 10)
    c[:, ::3] *= 0.8
    c[3, :] = c[12, :] = hexrgb("#4a4e58")


@painter("grille")
def _grille(cv, r, rng):
    c, _ = cv.view(r)
    fill(c, "#9aa3b0")
    c[::3, :] = hexrgb("#5b6270")
    c[:, ::3] = hexrgb("#5b6270")


def _swatch(cv, r, rng):
    col, emi = SWATCHES[r.name]
    c, e = cv.view(r)
    c[...] = hexrgb(col)
    if emi:
        e[...] = hexrgb(emi)


# ---- signs: pictures only, never words ----------------------------------------------------
SIGN_BOARDS = {"cup": "#6b3f2a", "loaf": "#e3a83c", "fish": "#2f7fd6", "shoe": "#7a3b69",
               "scissors": "#2e6b4f", "key": "#3a4256", "glasses": "#f4f2ee", "bowl": "#d7263d",
               "cone": "#f2a4c8", "flower": "#3fa652", "wrench": "#e3b23c", "book": "#7a2e3b",
               "pill": "#f4f2ee", "note": "#1d1f26", "rings": "#2c6f78", "chevron": "#d7263d"}
SIGN_INK = {"glasses": "#1d1f26", "pill": "#2f62c9", "loaf": "#6b3f2a", "cone": "#7a3b69",
            "wrench": "#1d1f26"}
SIGN_NEON = {"cup": "#ffd27a", "loaf": "#fff0c8", "fish": "#7fd8ff", "shoe": "#ff8ad0",
             "scissors": "#7dffc8", "key": "#ffe08a", "glasses": "#a8d0ff", "bowl": "#fff0c8",
             "cone": "#ff8ad0", "flower": "#ffb0d8", "wrench": "#ffe08a", "book": "#ffd27a",
             "pill": "#a8d0ff", "note": "#d0a8ff", "rings": "#7dffe0", "chevron": "#ff9a9a"}


def paint_sign(name, c, e, rng):
    from PIL import Image, ImageDraw
    board = SIGN_BOARDS[name]
    ink = SIGN_INK.get(name, "#ffffff")
    img = Image.new("RGB", (32, 16), board)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 31, 15], outline="#f4f2ee" if board != "#f4f2ee" else "#3a4256")
    if name == "cup":
        d.rectangle([11, 6, 19, 12], fill=ink); d.rectangle([20, 7, 22, 10], outline=ink)
        d.line([13, 2, 13, 4], fill=ink); d.line([16, 2, 16, 4], fill=ink)
        d.line([9, 13, 21, 13], fill=ink)
    elif name == "loaf":
        d.ellipse([7, 4, 25, 12], fill=ink)
        for x in (11, 15, 19):
            d.line([x, 5, x + 2, 9], fill=board)
    elif name == "fish":
        d.ellipse([7, 5, 21, 11], fill=ink); d.polygon([(21, 8), (26, 4), (26, 12)], fill=ink)
        d.point((10, 7), fill=board)
    elif name == "shoe":
        d.polygon([(8, 5), (13, 5), (14, 8), (24, 9), (25, 12), (8, 12)], fill=ink)
        d.line([8, 12, 25, 12], fill=board)
    elif name == "scissors":
        d.ellipse([7, 3, 12, 7], outline=ink); d.ellipse([7, 9, 12, 13], outline=ink)
        d.line([12, 6, 25, 11], fill=ink); d.line([12, 10, 25, 5], fill=ink)
    elif name == "key":
        d.ellipse([6, 4, 13, 11], outline=ink, width=2)
        d.line([13, 8, 25, 8], fill=ink, width=2); d.line([22, 8, 22, 11], fill=ink); d.line([25, 8, 25, 11], fill=ink)
    elif name == "glasses":
        d.ellipse([6, 5, 14, 11], outline=ink, width=2); d.ellipse([18, 5, 26, 11], outline=ink, width=2)
        d.line([14, 7, 18, 7], fill=ink)
    elif name == "bowl":
        d.chord([8, 2, 24, 13], 0, 180, fill=ink)
        d.line([10, 3, 13, 7], fill=ink); d.line([14, 2, 15, 7], fill=ink)
    elif name == "cone":
        d.ellipse([11, 2, 20, 8], fill="#f4f2ee"); d.polygon([(11, 7), (20, 7), (15, 14)], fill=ink)
    elif name == "flower":
        for dx, dy in ((0, -3), (3, 0), (0, 3), (-3, 0)):
            d.ellipse([16 + dx - 2, 7 + dy - 2, 16 + dx + 2, 7 + dy + 2], fill="#f2a4c8")
        d.ellipse([14, 5, 18, 9], fill="#e3c04f"); d.line([16, 10, 16, 14], fill=ink)
    elif name == "wrench":
        d.line([9, 12, 21, 4], fill=ink, width=2); d.ellipse([19, 1, 25, 7], outline=ink, width=2)
        d.point((23, 3), fill=board)
    elif name == "book":
        d.polygon([(7, 4), (15, 5), (15, 13), (7, 12)], fill=ink); d.polygon([(17, 5), (25, 4), (25, 12), (17, 13)], fill=ink)
    elif name == "pill":
        d.rounded_rectangle([8, 5, 24, 11], radius=3, fill=ink); d.rectangle([16, 5, 24, 11], fill="#d7263d")
        d.rounded_rectangle([8, 5, 24, 11], radius=3, outline=ink)
    elif name == "note":
        d.ellipse([9, 9, 13, 13], fill=ink); d.ellipse([18, 8, 22, 12], fill=ink)
        d.line([13, 4, 13, 11], fill=ink); d.line([22, 3, 22, 10], fill=ink); d.line([13, 4, 22, 3], fill=ink, width=2)
    elif name == "rings":
        d.ellipse([8, 3, 18, 13], outline=ink, width=2); d.ellipse([14, 3, 24, 13], outline="#9fe0c0", width=2)
    elif name == "chevron":
        d.line([8, 4, 16, 11, 24, 4], fill=ink, width=3)
    a = np.asarray(img, dtype=np.float32)
    c[...] = a
    ink_px = np.abs(a - hexrgb(board)).sum(axis=2) > 40
    border = np.zeros_like(ink_px)
    border[0, :] = border[-1, :] = True
    border[:, 0] = border[:, -1] = True
    e[ink_px & ~border] = hexrgb(SIGN_NEON[name])
    e[border] = hexrgb(SIGN_NEON[name]) * 0.55


# ---- damaged twins ------------------------------------------------------------------------
def damage(src: Region, dst: Region, cv: Canvas, win: Windows | None, rng) -> None:
    """Paint `dst` as a wrecked copy of `src`: broken glass, soot, cracks; fire at night."""
    sc, se = cv.view(src)
    c, e = cv.view(dst)
    c[...] = sc
    e[...] = 0
    hgt, wid = c.shape[:2]
    hole = hexrgb("#1c1714")
    if win is not None and win.n:
        for lab in range(1, win.n + 1):
            m = win.label == lab
            ys, xs = np.nonzero(m)
            if not len(ys):
                continue
            roll = rng.random()
            if roll < 0.6:                                         # broken: a dark hole
                c[m] = hole
                # jagged edge: a few frame pixels knocked out
                for _ in range(3):
                    k = rng.integers(len(ys))
                    yy, xx = ys[k] + rng.integers(-1, 2), xs[k] + rng.integers(-1, 2)
                    if 0 <= yy < hgt and 0 <= xx < wid:
                        c[yy, xx] = hole
                if rng.random() < 0.15:                            # fire inside
                    rows = ys.max() - ys.min() + 1
                    for yy, xx in zip(ys, xs):
                        t = (yy - ys.min()) / max(rows - 1, 1)
                        e[yy, xx] = hexrgb("#ff6a1a") * (0.55 + 0.45 * t) + hexrgb("#402000") * rng.random()
                    c[m] = hexrgb("#3a1e12")
                # soot plume above the window
                x0, x1, top = xs.min(), xs.max() + 1, ys.min()
                for k in range(1, 12):
                    yy = top - k
                    if yy < 0:
                        break
                    spread = k // 4
                    a = max(0.0, 0.55 - k * 0.045)
                    c[yy, max(0, x0 - spread):min(wid, x1 + spread)] *= (1.0 - a)
            elif roll < 0.8:                                       # cracked: glass gone grey
                c[m] = c[m] * 0.6 + hexrgb("#6a6a70") * 0.4
    # cracks in the wall
    for _ in range(max(2, wid * hgt // 900)):
        y, x = rng.integers(hgt), rng.integers(wid)
        for k in range(rng.integers(5, 14)):
            if 0 <= y < hgt and 0 <= x < wid:
                c[y, x] *= 0.45
            y += 1
            x += rng.integers(-1, 2)
    # scorch at the bottom edge and a general grime
    yy = np.arange(hgt)[:, None, None]
    c *= 0.88 + 0.12 * (yy / max(hgt - 1, 1))
    c += noise(rng, c.shape, 6)


# =========================================================================================
def extension_modules():
    """The building families' own atlas painters: tools/art/city/atlas_extra/<family>.py.
    Each defines REGIONS = [dict(name, x, y, w, h, kind, ...)] inside its block and
    paint(canvas, region, rng) (see README)."""
    pkg = os.path.join(HERE, "atlas_extra")
    mods = []
    if os.path.isdir(pkg):
        for info in sorted(pkgutil.iter_modules([pkg]), key=lambda i: i.name):
            if info.name.startswith("_"):
                continue
            mods.append(importlib.import_module(f"city.atlas_extra.{info.name}"))
    return mods


_EXT_LOADED = False


def load_extensions():
    global _EXT_LOADED
    if _EXT_LOADED:
        return
    _EXT_LOADED = True
    for mod in extension_modules():
        owner = getattr(mod, "FAMILY")
        for spec in getattr(mod, "REGIONS", []):
            spec = dict(spec)
            name = spec.pop("name")
            x, y, w, h, kind = (spec.pop(k) for k in ("x", "y", "w", "h", "kind"))
            add_region(name, x, y, w, h, kind, owner=owner, **spec)
            PAINTERS.setdefault(name, getattr(mod, "paint"))


def paint_all() -> Canvas:
    load_extensions()
    cv = Canvas()
    cv.col[...] = hexrgb("#3a3f4a")        # unassigned pixels: calm grey (never sampled)
    cv.col[256:, :] = hexrgb("#3a3f4a")    # reserved blocks: calm grey until a family paints
    cv.col[192:256, 384:] = hexrgb("#3a3f4a")
    wins: dict[str, Windows | None] = {}
    for name, r in REGIONS.items():
        if r.kind == "swatch":
            _swatch(cv, r, rng_for(name))
            continue
        if name.endswith("_dmg") and r.note.startswith("damaged twin"):
            continue
        fn = PAINTERS.get(name)
        if fn is None:
            raise RuntimeError(f"atlas region {name!r} has no painter")
        wins[name] = fn(cv, r, rng_for(name))
    for name, r in REGIONS.items():
        if r.twin:
            damage(r, REGIONS[r.twin], cv, wins.get(name), rng_for(r.twin))
    cv.col = np.clip(cv.col, 0, 255)
    cv.emi = np.clip(cv.emi, 0, 255)
    return cv


def write(color_png: str = COLOR_PNG, emissive_png: str = EMISSIVE_PNG, layout_json: str | None = None):
    from PIL import Image
    cv = paint_all()
    os.makedirs(os.path.dirname(color_png), exist_ok=True)
    Image.fromarray(cv.col.round().astype(np.uint8), "RGB").save(color_png, optimize=True)
    Image.fromarray(cv.emi.round().astype(np.uint8), "RGB").save(emissive_png, optimize=True)
    if layout_json:
        with open(layout_json, "w", encoding="utf-8") as f:
            json.dump({"size": [W, H], "meters_per_px": style.PX, "blocks": BLOCKS,
                       "regions": {k: v.as_dict() for k, v in REGIONS.items()}}, f, indent=1)
    return cv


def preview(out: str, cv: Canvas | None = None, scale: int = 2) -> str:
    """A labeled picture of both atlases, for people (docs/art/previews/city_kit_atlas.png)."""
    from PIL import Image, ImageDraw, ImageFont
    cv = cv or paint_all()
    col = Image.fromarray(cv.col.round().astype(np.uint8), "RGB").resize((W * scale, H * scale), Image.NEAREST)
    emi = Image.fromarray(cv.emi.round().astype(np.uint8), "RGB").resize((W * scale, H * scale), Image.NEAREST)
    pad = 40
    sheet = Image.new("RGB", (W * scale, (H * scale + pad) * 2), (24, 26, 33))
    d = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=22)
    d.text((10, 8), "city_atlas.png (day): 1024 x 512, 16 px = 3 m", font=font, fill=(236, 238, 242))
    sheet.paste(col, (0, pad))
    d.text((10, H * scale + pad + 8), "city_atlas_emissive.png (night): same layout", font=font, fill=(236, 238, 242))
    sheet.paste(emi, (0, H * scale + 2 * pad))
    small = ImageFont.load_default(size=11)
    for oy in (pad, H * scale + 2 * pad):
        for name, r in REGIONS.items():
            if r.kind == "swatch" or name.startswith("sign_") or r.w < 16:
                continue
            x0, y0 = r.x * scale, r.y * scale + oy
            d.rectangle([x0, y0, x0 + r.w * scale - 1, y0 + r.h * scale - 1], outline=(255, 217, 26))
            d.text((x0 + 3, y0 + 2), name, font=small, fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
        for fam, (bx, by, bw, bh) in BLOCKS.items():
            d.rectangle([bx * scale, by * scale + oy, (bx + bw) * scale - 1, (by + bh) * scale + oy - 1],
                        outline=(30, 200, 224), width=2)
            d.text((bx * scale + 6, by * scale + oy + bh * scale - 18), f"reserved: {fam}", font=small,
                   fill=(30, 200, 224))
    sheet.save(out, optimize=True)
    return out
