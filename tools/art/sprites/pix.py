"""Pixel-art kit for Monster Battle 9001 sprites and tiny textures.

Everything here is plain numpy and pillow (no Blender). An `Img` is a small RGBA picture
with integer pixel coordinates, (0, 0) at the top left, y growing downward. Colors are hex
strings, palette names (tools/art/lib/palette.py and NAMED below) or (r, g, b[, a]) tuples.

    img = Img(24, 32)
    img.art(["..GG..", ".GHHh."], x=9, y=5, legend={"G": "#8a9a48", "H": "#5d6d30", "h": "#3b4a22"})
    img.limb(11, 21, 14, 28, 3, "#48552a")      # a leg: a thick line with clean pixel steps
    img.outline("#161821")                      # dark outline around the silhouette
    sheet = Sheet(512, 128, 24, 32); sheet.put(0, 0, img); sheet.save(path)

Preview helpers (`upscale`, `on_backdrop`, `strip`, `grid`, `label`) make the review pictures.
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import palette as _palette  # noqa: E402  (pure Python: the named colors of the whole game)

ASSETS = os.path.join(REPO, "client", "public", "assets")
SPRITES = os.path.join(ASSETS, "sprites")
TEXTURES = os.path.join(ASSETS, "textures")
PREVIEWS = os.path.join(REPO, "docs", "art", "previews")

OUTLINE = "#15161f"          # the dark outline of every character and prop sprite

# Extra names used only by sprites (the game-wide palette is tools/art/lib/palette.py).
NAMED = {
    "outline": OUTLINE,
    "clear": (0, 0, 0, 0),
}


def col(c, alpha: int | None = None) -> tuple[int, int, int, int]:
    """Resolve any color spelling to an (r, g, b, a) tuple of 0..255 integers."""
    if c is None:
        return (0, 0, 0, 0)
    if isinstance(c, str):
        key = c.strip()
        if key in NAMED:
            v = NAMED[key]
            if not isinstance(v, str):
                return tuple(v)  # type: ignore[return-value]
            key = v
        if not key.startswith("#"):
            key = _palette.PALETTE[key]
        h = key.lstrip("#")
        if len(h) == 3:
            h = "".join(ch * 2 for ch in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) if len(h) == 8 else 255
    else:
        r, g, b = int(c[0]), int(c[1]), int(c[2])
        a = int(c[3]) if len(c) > 3 else 255
    if alpha is not None:
        a = alpha
    return (r, g, b, a)


def hexof(c) -> str:
    r, g, b, _ = col(c)
    return "#%02x%02x%02x" % (r, g, b)


def mix(a, b, t: float) -> tuple[int, int, int, int]:
    """Blend two colors (t = 0 gives a, t = 1 gives b), alpha included."""
    ca, cb = col(a), col(b)
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(ca, cb))  # type: ignore[return-value]


def shade(c, amount: float) -> tuple[int, int, int, int]:
    """Painted darker (< 1) or lighter (> 1) version of a color, like palette.shade."""
    return col(_palette.shade(hexof(c), amount), col(c)[3])


class Img:
    """A small RGBA picture with pixel-exact drawing."""

    def __init__(self, w: int, h: int, fill=None):
        self.a = np.zeros((h, w, 4), np.uint8)
        if fill is not None:
            self.a[:, :] = col(fill)

    # -- basics -----------------------------------------------------------------------
    @property
    def w(self) -> int:
        return self.a.shape[1]

    @property
    def h(self) -> int:
        return self.a.shape[0]

    def copy(self) -> "Img":
        out = Img(1, 1)
        out.a = self.a.copy()
        return out

    @staticmethod
    def from_array(arr) -> "Img":
        out = Img(1, 1)
        out.a = np.ascontiguousarray(arr, dtype=np.uint8)
        return out

    def pil(self) -> Image.Image:
        return Image.fromarray(self.a, "RGBA")

    def inside(self, x: int, y: int) -> bool:
        return 0 <= x < self.w and 0 <= y < self.h

    def px(self, x, y, c) -> "Img":
        x, y = int(x), int(y)
        if self.inside(x, y):
            self.a[y, x] = col(c)
        return self

    def get(self, x, y) -> tuple[int, int, int, int]:
        if not self.inside(x, y):
            return (0, 0, 0, 0)
        return tuple(int(v) for v in self.a[y, x])  # type: ignore[return-value]

    def opaque(self, x, y) -> bool:
        return self.inside(x, y) and self.a[y, x, 3] > 0

    # -- shapes -----------------------------------------------------------------------
    def rect(self, x0, y0, x1, y1, c) -> "Img":
        """Filled rectangle, both corners included."""
        x0, x1 = sorted((int(x0), int(x1)))
        y0, y1 = sorted((int(y0), int(y1)))
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(self.w - 1, x1), min(self.h - 1, y1)
        if x1 >= x0 and y1 >= y0:
            self.a[y0:y1 + 1, x0:x1 + 1] = col(c)
        return self

    def hline(self, x0, x1, y, c) -> "Img":
        return self.rect(x0, y, x1, y, c)

    def vline(self, x, y0, y1, c) -> "Img":
        return self.rect(x, y0, x, y1, c)

    def line(self, x0, y0, x1, y1, c) -> "Img":
        """One-pixel line (Bresenham)."""
        x0, y0, x1, y1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.px(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy
        return self

    def limb(self, x0, y0, x1, y1, width: int, c, edge=None, edge_side: int = -1) -> "Img":
        """A thick line with hand-pixeled steps: steep lines get `width` pixels in every row,
        shallow lines `width` pixels in every column, so the thickness never wobbles.
        `edge` paints one border pixel (left or top when edge_side is -1) in a second color."""
        x0, y0, x1, y1 = float(x0), float(y0), float(x1), float(y1)
        lo = -((width - 1) // 2)
        hi = width // 2
        if abs(y1 - y0) >= abs(x1 - x0):
            if y1 < y0:
                x0, y0, x1, y1 = x1, y1, x0, y0
            n = int(round(y1 - y0))
            for i in range(n + 1):
                t = i / n if n else 0.0
                xc = int(np.floor(x0 + (x1 - x0) * t + 0.5))
                y = int(round(y0)) + i
                self.rect(xc + lo, y, xc + hi, y, c)
                if edge is not None and width > 1:
                    self.px(xc + (lo if edge_side < 0 else hi), y, edge)
        else:
            if x1 < x0:
                x0, y0, x1, y1 = x1, y1, x0, y0
            n = int(round(x1 - x0))
            for i in range(n + 1):
                t = i / n if n else 0.0
                yc = int(np.floor(y0 + (y1 - y0) * t + 0.5))
                x = int(round(x0)) + i
                self.rect(x, yc + lo, x, yc + hi, c)
                if edge is not None and width > 1:
                    self.px(x, yc + (lo if edge_side < 0 else hi), edge)
        return self

    def disc(self, cx: float, cy: float, r: float, c) -> "Img":
        """Filled circle; cx, cy may sit on half pixels."""
        ys, xs = np.mgrid[0:self.h, 0:self.w]
        m = (xs - cx) ** 2 + (ys - cy) ** 2 <= r * r
        self.a[m] = col(c)
        return self

    def ellipse(self, cx: float, cy: float, rx: float, ry: float, c) -> "Img":
        ys, xs = np.mgrid[0:self.h, 0:self.w]
        m = ((xs - cx) / max(rx, 1e-6)) ** 2 + ((ys - cy) / max(ry, 1e-6)) ** 2 <= 1.0
        self.a[m] = col(c)
        return self

    def mask(self, m, c) -> "Img":
        """Paint every pixel where the boolean array `m` is true."""
        self.a[m] = col(c)
        return self

    # -- pictures in pictures ---------------------------------------------------------
    def art(self, rows, x: int, y: int, legend: dict, flip: bool = False) -> "Img":
        """Stamp ASCII pixel art: one character per pixel, '.' and ' ' are empty, every
        other character is looked up in `legend` (missing characters raise)."""
        for j, row in enumerate(rows):
            n = len(row)
            for i, ch in enumerate(row):
                if ch in ". ":
                    continue
                xx = x + (n - 1 - i if flip else i)
                self.px(xx, y + j, legend[ch])
        return self

    def blit(self, other: "Img", x: int = 0, y: int = 0, flip: bool = False) -> "Img":
        """Paste another picture; its opaque pixels replace ours (no blending)."""
        src = other.a[:, ::-1] if flip else other.a
        for j in range(other.h):
            yy = y + j
            if not 0 <= yy < self.h:
                continue
            for i in range(other.w):
                xx = x + i
                if 0 <= xx < self.w and src[j, i, 3] > 0:
                    self.a[yy, xx] = src[j, i]
        return self

    def over(self, other: "Img", x: int = 0, y: int = 0) -> "Img":
        """Alpha-composite another picture over this one (for soft effects)."""
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(self.w, x + other.w), min(self.h, y + other.h)
        if x1 <= x0 or y1 <= y0:
            return self
        dst = self.a[y0:y1, x0:x1].astype(np.float32) / 255.0
        src = other.a[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32) / 255.0
        sa, da = src[..., 3:4], dst[..., 3:4]
        oa = sa + da * (1 - sa)
        rgb = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
        out = np.concatenate([rgb, oa], axis=2)
        self.a[y0:y1, x0:x1] = np.clip(np.round(out * 255), 0, 255).astype(np.uint8)
        return self

    def flipped(self) -> "Img":
        return Img.from_array(self.a[:, ::-1].copy())

    def shifted(self, dx: int, dy: int) -> "Img":
        out = Img(self.w, self.h)
        out.blit(self, dx, dy)
        return out

    def recolor(self, mapping: dict) -> "Img":
        """Swap exact colors: {old: new}."""
        out = self.copy()
        for old, new in mapping.items():
            o = col(old)
            m = np.all(self.a == np.array(o, np.uint8), axis=2)
            out.a[m] = col(new)
        return out

    # -- outlines ---------------------------------------------------------------------
    def solid(self) -> np.ndarray:
        return self.a[..., 3] > 0

    def edge_mask(self, diagonal: bool = False) -> np.ndarray:
        """Empty pixels that touch an opaque one (4 neighbors, or 8 with diagonal=True)."""
        s = self.solid()
        p = np.pad(s, 1)
        near = p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
        if diagonal:
            near |= p[:-2, :-2] | p[:-2, 2:] | p[2:, :-2] | p[2:, 2:]
        return near & ~s

    def outline(self, c=OUTLINE, diagonal: bool = False) -> "Img":
        """Dark outline around the whole silhouette, drawn on the empty pixels next to it."""
        self.a[self.edge_mask(diagonal)] = col(c)
        return self

    def stamp(self, part: "Img", x: int = 0, y: int = 0, sep=None) -> "Img":
        """Paste `part` in front. With `sep`, the pixels of this picture that border the
        part get the `sep` color first: an inner outline that separates an arm or a weapon
        from the body behind it (the silhouette outline is added later by `outline`)."""
        if sep is not None:
            layer = Img(self.w, self.h)
            layer.blit(part, x, y)
            m = layer.edge_mask() & self.solid()
            self.a[m] = col(sep)
        return self.blit(part, x, y)

    def colors(self) -> set:
        """The distinct opaque colors (r, g, b) in the picture."""
        m = self.a[..., 3] > 0
        return {tuple(int(v) for v in px[:3]) for px in self.a[m]}


class Sheet:
    """A sprite sheet: a grid of equal cells, column 0 at the left, row 0 at the top."""

    def __init__(self, width: int, height: int, cell_w: int, cell_h: int):
        self.img = Img(width, height)
        self.cw, self.ch = cell_w, cell_h
        self.cols, self.rows = width // cell_w, height // cell_h

    def put(self, col_: int, row: int, cell: Img) -> None:
        if cell.w != self.cw or cell.h != self.ch:
            raise ValueError(f"cell is {cell.w}x{cell.h}, the sheet wants {self.cw}x{self.ch}")
        if not (0 <= col_ < self.cols and 0 <= row < self.rows):
            raise ValueError(f"cell ({col_}, {row}) is outside the {self.cols}x{self.rows} sheet")
        self.img.a[row * self.ch:(row + 1) * self.ch, col_ * self.cw:(col_ + 1) * self.cw] = cell.a

    def cell(self, col_: int, row: int) -> Img:
        return Img.from_array(self.img.a[row * self.ch:(row + 1) * self.ch,
                                         col_ * self.cw:(col_ + 1) * self.cw].copy())

    def save(self, path: str) -> str:
        return save_png(self.img, path)


def clean_alpha(arr: np.ndarray) -> np.ndarray:
    """Fully transparent pixels get rgb 0 so files are stable and compress well."""
    out = arr.copy()
    out[out[..., 3] == 0] = 0
    return out


def save_png(img, path: str) -> str:
    """Write an Img (or RGBA array) as an optimized PNG; creates the folder."""
    arr = img.a if isinstance(img, Img) else np.asarray(img, np.uint8)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    Image.fromarray(clean_alpha(arr), "RGBA").save(path, optimize=True)
    return path


# ---- review pictures ---------------------------------------------------------------------

def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # very old pillow
        return ImageFont.load_default()


def upscale(img, k: int) -> Image.Image:
    """Nearest-neighbor enlargement by an integer factor."""
    pil = img.pil() if isinstance(img, Img) else img
    return pil.resize((pil.width * k, pil.height * k), Image.NEAREST)


def backdrop(w: int, h: int, kind="checker", cell: int = 8) -> Image.Image:
    """Review backgrounds: 'checker' (two greys), or any color."""
    if kind == "checker":
        ys, xs = np.mgrid[0:h, 0:w]
        m = ((xs // cell) + (ys // cell)) % 2 == 0
        arr = np.zeros((h, w, 4), np.uint8)
        arr[m] = (86, 90, 104, 255)
        arr[~m] = (70, 74, 88, 255)
        return Image.fromarray(arr, "RGBA")
    return Image.new("RGBA", (w, h), col(kind))


def on_backdrop(img, kind="checker", k: int = 1, cell: int = 8) -> Image.Image:
    """Enlarge by k and lay over a review background."""
    big = upscale(img, k)
    bg = backdrop(big.width, big.height, kind, cell * k if kind == "checker" else cell)
    bg.alpha_composite(big)
    return bg


def label(text: str, width: int, height: int = 22, size: int = 14, bg="#20222c", fg="#e8eaf2") -> Image.Image:
    bar = Image.new("RGBA", (width, height), col(bg))
    ImageDraw.Draw(bar).text((6, (height - size) // 2 - 1), text, fill=col(fg), font=_font(size))
    return bar


def hstack(images, gap: int = 0, bg="#20222c") -> Image.Image:
    images = [im for im in images if im is not None]
    w = sum(im.width for im in images) + gap * (len(images) - 1)
    h = max(im.height for im in images)
    out = Image.new("RGBA", (w, h), col(bg))
    x = 0
    for im in images:
        out.paste(im, (x, 0))
        x += im.width + gap
    return out


def vstack(images, gap: int = 0, bg="#20222c") -> Image.Image:
    images = [im for im in images if im is not None]
    w = max(im.width for im in images)
    h = sum(im.height for im in images) + gap * (len(images) - 1)
    out = Image.new("RGBA", (w, h), col(bg))
    y = 0
    for im in images:
        out.paste(im, (0, y))
        y += im.height + gap
    return out


def strip(frames, k: int = 8, kind="checker", gap: int = 0) -> Image.Image:
    """Animation strip: the frames side by side, enlarged."""
    return hstack([on_backdrop(f, kind, k) for f in frames], gap=gap)


def save_preview(pil: Image.Image, path: str) -> str:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    pil.convert("RGB").save(path, optimize=True)
    return path
