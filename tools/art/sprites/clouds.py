"""Sky: towering cumulus as pixel art with alpha, in the spirit of flight-combat game skies.

Each texture is a 512 x 256 horizon panorama: a side view of clouds standing on the horizon.
It wraps seamlessly left to right and never top to bottom. In the game it is the inside of an
upright ring (an open cylinder) around the camera: u runs around the ring, v runs up, the
bottom edge sits 5 degrees below the horizon. It must never be laid on a horizontal plane.
The numbers of the mapping are RING below; build.py writes them into the manifest.

Sky shows through everywhere there is no cloud: every panorama has clear gaps that reach all
the way down, one of them wide enough for the sunset sun (SUN_GAP). The lowest range
dissolves toward the bottom edge. Clouds are authored in neutral daylight (warm white tops,
slate-blue shadows); the game tints them for sunset and night.

How a cloud is made:
  1. A silhouette is built from overlapping ellipses: stems, shoulders and bulging heads
     standing on a flat base.
  2. The silhouette is packed with spheres, big in the middle and small at the rim.
  3. Every pixel is lit from the upper left three ways at once: by the broad dome of the
     whole mass, by the little sphere nearest the viewer (the cauliflower lumps), and by how
     much cloud the light had to cross to reach it (thick parts fall into shadow).
  4. The light value is cut into six flat tones and tidied into clean pixel clusters.
Far ranges are drawn first with a paler, lower-contrast ramp so the near towers stand in
front of them.
"""
from __future__ import annotations

import math

import numpy as np
from scipy import ndimage

from pix import Img, col

W, H = 512, 256

# tone ramps, darkest first
NEAR = [col("#3f4c6c"), col("#62729a"), col("#91a1c2"), col("#c3cfe4"), col("#eaeff6"), col("#fffcf0")]
MID = [col("#62729a"), col("#8292b6"), col("#a6b4cf"), col("#cad5e6"), col("#e8edf5"), col("#fbfaf3")]
FAR = [col("#91a1c2"), col("#a4b2ce"), col("#bac6dc"), col("#d0d9e9"), col("#e2e8f2"), col("#f0f3f8")]

LIGHT = np.array([-0.55, -0.70, 0.45], np.float32)
LIGHT /= np.linalg.norm(LIGHT)


def tower(rng, cx: float, base_y: float, height: float, width: float, head: float = 1.0,
          lean: float = 0.0) -> list:
    """Ellipses (x, y, rx, ry) for one cumulus tower: a broad foot, a body that narrows a
    little as it climbs, a round head that swells again, and buds on both flanks all the way
    up. `head` scales the head, `lean` pushes the top sideways (in widths)."""
    out = []
    n = max(3, int(round(height / (width * 0.40))))
    for i in range(n):
        t = i / (n - 1)
        waist = 1.0 - 0.30 * math.sin(min(t, 0.75) / 0.75 * math.pi * 0.5)     # 1 at the foot, 0.7 up high
        rx = width * waist * rng.uniform(0.88, 1.12)
        if i == n - 1:
            rx = width * 0.74 * head * rng.uniform(0.95, 1.08)
        ry = rx * rng.uniform(0.66, 0.82)
        x = cx + lean * width * t + rng.uniform(-0.14, 0.14) * width * (0.3 + t)
        y = base_y - t * (height - ry) - (ry * 0.3 if i == 0 else 0)
        out.append((x, y, rx, ry))
        # buds: smaller heads swelling out of the flanks
        for side in (-1, 1):
            if i < n - 1 and rng.random() < 0.8:
                br = rx * rng.uniform(0.42, 0.66)
                out.append((x + side * rx * rng.uniform(0.62, 0.92), y + rng.uniform(-0.35, 0.25) * ry,
                            br, br * rng.uniform(0.75, 0.95)))
    # a crown of small heads on top
    top = min(out, key=lambda e: e[1] - e[3])
    for _ in range(3):
        br = top[2] * rng.uniform(0.32, 0.5)
        out.append((top[0] + rng.uniform(-0.7, 0.7) * top[2], top[1] - top[3] * rng.uniform(0.45, 0.8), br, br * 0.9))
    return out


def anvil(rng, cx: float, y: float, left: float, right: float, thick: float) -> list:
    """The flat spreading top of a giant: a long wedge blown out to the left, a shorter
    shelf to the right, built from a row of flattened ellipses that thin toward the tips."""
    out = []
    x = cx - left
    while x < cx + right:
        k = 1.0 - 0.55 * abs((x - cx) / (left if x < cx else right)) ** 1.5      # thinner toward the tips
        rx = thick * 1.9 * rng.uniform(0.85, 1.15)
        out.append((x, y + thick * (1 - k) * 0.5 + rng.uniform(-1.5, 1.5), rx, thick * k * rng.uniform(0.9, 1.1)))
        x += rx * 0.7
    return out


class Sky:
    """Accumulates cloud masses into a depth buffer with per-pixel light."""

    def __init__(self):
        self.depth = np.full((H, W), -1e9, np.float32)
        self.micro = np.zeros((H, W), np.float32)          # light on the nearest small sphere
        self.macro = np.zeros((H, W), np.float32)          # light on the dome of the whole mass
        self.thick = np.zeros((H, W), np.float32)          # cloud between the pixel and the sun, 0..1
        self.layer = np.full((H, W), -1, np.int16)
        self.base = np.zeros((H, W), np.float32)
        self.top = np.ones((H, W), np.float32)

    def _sphere(self, cx, cy, r, zc, layer, fields) -> None:
        x0, x1 = int(math.floor(cx - r)), int(math.ceil(cx + r))
        y0, y1 = max(0, int(math.floor(cy - r))), min(H - 1, int(math.ceil(cy + r)))
        if y1 < y0:
            return
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1].astype(np.float32)
        dx, dy = (xs - cx) / r, (ys - cy) / r
        d2 = dx * dx + dy * dy
        nz = np.sqrt(np.clip(1 - d2, 0, 1))
        z = layer * 10000.0 + zc + nz * r
        lam = dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2]
        sub = (np.arange(y0, y1 + 1)[:, None], (np.arange(x0, x1 + 1) % W)[None, :])
        win = (d2 <= 1.0) & (z > self.depth[sub]) & (ys <= fields["base_y"])
        self.depth[sub] = np.where(win, z, self.depth[sub])
        self.micro[sub] = np.where(win, lam, self.micro[sub])
        self.layer[sub] = np.where(win, layer, self.layer[sub])
        self.base[sub] = np.where(win, fields["base_y"], self.base[sub])
        self.top[sub] = np.where(win, fields["height"], self.top[sub])
        self.macro[sub] = np.where(win, fields["macro"][sub], self.macro[sub])
        self.thick[sub] = np.where(win, fields["thick"][sub], self.thick[sub])

    def mass(self, rng, ellipses, base_y: float, layer: int, r_max: float, density: float = 1.0,
             r_min: float = 3.5) -> None:
        """One cloud mass: the union of `ellipses`, cut flat at base_y, packed with spheres."""
        rows = np.arange(H, dtype=np.float32)[:, None]
        cols = np.arange(W, dtype=np.float32)[None, :]
        region = np.zeros((H, W), bool)
        for (ex, ey, rx, ry) in ellipses:
            # an ellipse that barely pokes above the base would leave a thin wedge: lift it
            ey = min(ey, base_y - 0.45 * ry)
            d = (cols - ex + W / 2) % W - W / 2
            region |= (d / rx) ** 2 + ((rows - ey) / ry) ** 2 <= 1.0
        region &= rows <= base_y
        # round off thin wedges and spikes where ellipses meet the base or each other
        yy, xx = np.mgrid[-4:5, -4:5]
        disc = (xx * xx + yy * yy) <= 18
        wide = np.concatenate([region, region, region], axis=1)
        region = ndimage.binary_opening(wide, structure=disc)[:, W:2 * W]
        if not region.any():
            return
        wide = np.concatenate([region, region, region], axis=1)
        dt = ndimage.distance_transform_edt(wide)[:, W:2 * W].astype(np.float32)
        # macro shape: a dome over the silhouette; its slope gives the broad light and shade
        big = max(8.0, float(dt.max()))
        dome = big * np.sqrt(np.clip(1 - (1 - np.clip(dt / big, 0, 1)) ** 2, 0, 1))
        dome = ndimage.gaussian_filter(np.concatenate([dome, dome, dome], axis=1), 2.5)[:, W:2 * W]
        gy, gx = np.gradient(dome)
        gx = (np.roll(dome, -1, axis=1) - np.roll(dome, 1, axis=1)) / 2.0
        nrm = np.sqrt(gx * gx + gy * gy + 1.0)
        macro = (-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) / nrm
        # thickness toward the sun: how much of this mass lies up and to the left of the pixel
        thick = np.zeros((H, W), np.float32)
        reach = int(max(24, big * 2.2))
        steps = 12
        for k in range(1, steps + 1):
            sx = int(round(-LIGHT[0] / 0.89 * reach * k / steps))
            sy = int(round(-LIGHT[1] / 0.89 * reach * k / steps))
            shifted = np.roll(region, sx, axis=1)
            shifted = np.concatenate([np.zeros((sy, W), bool), shifted[:H - sy]], axis=0) if sy > 0 else shifted
            thick += shifted
        thick /= steps
        height = float(base_y - np.nonzero(region.any(axis=1))[0].min())
        fields = {"base_y": base_y, "height": max(height, 1.0), "macro": macro, "thick": thick}
        ys, xs = np.nonzero(region)
        n = int(len(ys) / 60.0 * density)
        pick = rng.choice(len(ys), size=min(n, len(ys)), replace=False)
        order = sorted(pick, key=lambda i: -dt[ys[i], xs[i]])          # big ones first
        for i in order:
            y, x = float(ys[i]), float(xs[i])
            d = float(dt[int(y), int(x)])
            r = float(np.clip(d * rng.uniform(0.8, 1.15) + 1.5, r_min, r_max))
            zc = rng.uniform(0.0, 0.7) * r_max + (r_max - r) * 0.4
            self._sphere(x, y, r, zc, layer, fields)

    def render(self, ramps, floor_fade: float = 30.0, base_fade=(0.0, 0.0, 0.0)) -> Img:
        """Cut the light into flat tones; the picture dissolves toward its bottom edge."""
        covered = self.layer >= 0
        rows = np.arange(H, dtype=np.float32)[:, None] * np.ones((1, W), np.float32)
        up = np.clip((self.base - rows) / np.maximum(self.top, 1), 0, 1)       # 0 at the base, 1 at the top
        s = 0.5 + 0.5 * (0.54 * self.macro + 0.46 * self.micro)
        s = s + 0.10 * (up - 0.5) - 0.21 * (self.thick - 0.35)
        s = np.where(self.base - rows < 5, s - (5 - (self.base - rows)) * 0.07, s)     # flat dark bottoms
        cuts = [0.34, 0.46, 0.575, 0.69, 0.815]
        tone = np.zeros((H, W), np.int16)
        for c in cuts:
            tone += (s >= c).astype(np.int16)
        tone = np.where(covered & (rows >= 2), tone, -1)      # the top rows stay clear sky
        layer = self.layer.copy()
        # pinholes between spheres: an empty pixel almost surrounded by cloud becomes cloud
        for _ in range(2):
            solid = tone >= 0
            p = np.pad(np.concatenate([solid[:, -1:], solid, solid[:, :1]], axis=1), ((1, 1), (0, 0)))
            near = sum(p[dy:dy + H, dx:dx + W].astype(np.int16) for dy in range(3) for dx in range(3))
            hole = ~solid & (near >= 6) & (rows >= 2)
            for shift in (1, -1):                          # take the tone from above, else from below
                src_t, src_l = np.roll(tone, shift, axis=0), np.roll(layer, shift, axis=0)
                take = hole & (tone < 0) & (src_t >= 0)
                tone = np.where(take, src_t, tone)
                layer = np.where(take, src_l, layer)
        for _ in range(3):
            tone = majority(tone)
        out = np.zeros((H, W, 4), np.uint8)
        for li, ramp in enumerate(ramps):
            for k, c in enumerate(ramp):
                out[(layer == li) & (tone == k)] = c
        a = np.clip((H - 1 - rows) / floor_fade, 0, 1)
        for li, bf in enumerate(base_fade):
            if bf > 0:
                a = np.where(layer == li, np.minimum(a, np.clip((self.base - rows) / bf, 0, 1)), a)
        a = np.ceil(a * 5) / 5.0                                                # five flat steps
        out[..., 3] = np.where(tone >= 0, np.round(a * 255), 0).astype(np.uint8)
        out[out[..., 3] == 0] = 0
        return Img.from_array(out)


def majority(tone: np.ndarray) -> np.ndarray:
    """3 x 3 mode filter on the tone map (wraps left to right), keeping the outline: a pixel
    that disagrees with most of its neighbors takes their tone."""
    padded = np.concatenate([tone[:, -1:], tone, tone[:, :1]], axis=1)
    padded = np.pad(padded, ((1, 1), (0, 0)), mode="edge")
    counts = np.zeros((7, H, W), np.int16)
    for dy in range(3):
        for dx in range(3):
            nb = padded[dy:dy + H, dx:dx + W]
            for k in range(7):
                counts[k] += (nb == k - 1)
    best = counts[1:].argmax(axis=0)
    best_n = counts[1:].max(axis=0)
    own_n = np.take_along_axis(counts, (tone + 1)[None].astype(np.int64), axis=0)[0]
    change = (tone >= 0) & (own_n <= 3) & (best_n >= 4)
    return np.where(change, best, tone).astype(np.int16)


def bank(rng, x0: float, x1: float, base_y: float, lo: float, hi: float, width: float,
         taper: float = 0.0) -> list:
    """A row of low heads between x0 and x1: the distant ranges and the shoulders of towers.
    Coordinates may run past the right edge (x1 > W): the picture wraps. With `taper` the
    heads get lower toward both ends of the row (0 = all alike, 1 = down to `lo`)."""
    out = []
    x = x0
    while x < x1:
        w = width * rng.uniform(0.7, 1.3)
        t = (x - x0) / max(x1 - x0, 1.0)
        k = 1.0 - taper * (1.0 - math.sin(math.pi * min(max(t, 0.0), 1.0)))
        out += tower(rng, x, base_y, lo + (rng.uniform(lo, hi) - lo) * k, w, head=rng.uniform(0.9, 1.2))
        x += w * rng.uniform(1.0, 1.5)
    return out


def fit(ellipses: list, x0: float, x1: float) -> list:
    """Squeeze a group of ellipses sideways, all by the same factor, until it lies inside
    x0..x1. The group keeps its shape (nothing is cut off or lined up against the limit), so
    it ends where it is told to and the gap beside it stays clear."""
    lo = min(x - rx for (x, _y, rx, _ry) in ellipses)
    hi = max(x + rx for (x, _y, rx, _ry) in ellipses)
    a, b = max(lo, x0), min(hi, x1)
    k = (b - a) / (hi - lo)
    return [(a + (x - lo) * k, y, rx * k, ry) for (x, y, rx, ry) in ellipses]


# How the game maps each panorama (docs/ASSETS.md section 3): `repeats` copies around the full
# circle, the bottom edge `bottom_deg` below the horizon, the picture kept at its 2:1 shape.
# `sun_gap` is the clear gap (first column, width in pixels) meant for the sunset sun.
RING = {
    "clouds_a": {"repeats": 4, "bottom_deg": -5.0},
    "clouds_b": {"repeats": 3, "bottom_deg": -5.0},
}
SUN_GAP = {"clouds_a": (258, 72), "clouds_b": (414, 58)}


def clouds_a() -> Img:
    """The dramatic one: two great towers with their shoulders, each over its own stretch of
    distant range. Two clear gaps: the sunset sun's (SUN_GAP) between the towers and one
    across the wrap."""
    sky = Sky()
    rng = np.random.default_rng(41)
    far = fit(bank(rng, 64, 250, H - 26, 30, 62, 24, taper=0.5), 50, 264)
    far += fit(bank(rng, 343, 486, H - 26, 30, 62, 24, taper=0.5), 329, 500)
    sky.mass(rng, far, base_y=H - 26, layer=0, r_max=12, density=1.3, r_min=4.5)
    rng = np.random.default_rng(43)
    mid = fit(bank(rng, 70, 104, H - 46, 44, 76, 26) + bank(rng, 216, 240, H - 46, 40, 66, 24), 56, 258)
    mid += fit(bank(rng, 349, 376, H - 46, 44, 72, 26) + bank(rng, 456, 476, H - 46, 40, 70, 24), 335, 494)
    sky.mass(rng, mid, base_y=H - 46, layer=1, r_max=18, density=1.2)
    # the great tower with a second head and broad shoulders
    rng = np.random.default_rng(51)
    e = tower(rng, 150, H - 62, 180, 50, head=1.25, lean=0.12)
    e += tower(rng, 110, H - 62, 112, 40, head=1.15, lean=-0.1)
    e += tower(rng, 200, H - 62, 84, 40, head=1.1, lean=0.15)
    e += bank(rng, 96, 214, H - 62, 30, 48, 30)
    sky.mass(rng, e, base_y=H - 62, layer=2, r_max=26, density=1.1)
    # its neighbor: shorter, leaning the other way
    rng = np.random.default_rng(151)
    e = tower(rng, 396, H - 66, 136, 40, head=1.3, lean=-0.15)
    e += tower(rng, 438, H - 66, 80, 34, head=1.1, lean=0.1)
    e += bank(rng, 366, 442, H - 66, 28, 44, 26)
    sky.mass(rng, e, base_y=H - 66, layer=2, r_max=23, density=1.1)
    return sky.render([FAR, MID, NEAR], base_fade=(22.0, 0.0, 0.0))


def clouds_b() -> Img:
    """The broad one: an anvil-topped giant with its lesser heads, and a low bank with one
    small tower that runs across the wrap (so the left and right edges meet inside one
    cloud). Two clear gaps, one on each side of the giant; the right one is the sunset
    sun's (SUN_GAP)."""
    sky = Sky()
    rng = np.random.default_rng(42)
    far = fit(bank(rng, 182, 408, H - 24, 28, 58, 24, taper=0.5), 168, 422)
    far += fit(bank(rng, 488, 616, H - 24, 28, 58, 24, taper=0.5), 474, 630)       # crosses the wrap
    sky.mass(rng, far, base_y=H - 24, layer=0, r_max=11, density=1.3, r_min=4.5)
    rng = np.random.default_rng(44)
    mid = fit(bank(rng, 188, 212, H - 42, 44, 74, 28) + bank(rng, 384, 402, H - 42, 44, 72, 28), 174, 416)
    mid += fit(bank(rng, 494, 520, H - 42, 40, 70, 26) + bank(rng, 586, 606, H - 42, 40, 70, 26), 480, 624)
    sky.mass(rng, mid, base_y=H - 42, layer=1, r_max=17, density=1.2)
    rng = np.random.default_rng(61)
    e = tower(rng, 290, H - 58, 168, 62, head=1.15)
    e += anvil(rng, 282, H - 58 - 170, 128, 78, 17)
    e += tower(rng, 228, H - 58, 104, 40, head=1.2, lean=-0.1)
    e += tower(rng, 356, H - 58, 84, 36, head=1.15, lean=0.12)
    e += bank(rng, 214, 380, H - 58, 28, 46, 28)
    sky.mass(rng, e, base_y=H - 58, layer=2, r_max=25, density=1.1)
    rng = np.random.default_rng(161)
    e = tower(rng, 548, H - 68, 104, 36, head=1.3, lean=0.1)                        # crosses the wrap
    e += bank(rng, 506, 576, H - 68, 26, 44, 24)
    sky.mass(rng, e, base_y=H - 68, layer=2, r_max=20, density=1.15)
    return sky.render([FAR, MID, NEAR], base_fade=(22.0, 0.0, 0.0))


def build() -> dict:
    return {"clouds_a": clouds_a(), "clouds_b": clouds_b()}


LOW_ROWS = (150, 210)        # the rows of the low bank: where a wall of cloud would hide the horizon
GAP_ROWS = (110, 205)        # a clear gap is clear from above the low bank down to the dissolve rows
SUN_ROWS = (90, 205)         # the sunset sun (12 degrees up, 4 degrees in radius) lies inside these rows on both rings


def wrap_error(img: Img, rows=(120, 210), window: int = 32, hop: int = 8) -> float:
    """Left/right seam check. The color step across the wrap, averaged over a band of
    `window` rows, divided by the 99th percentile of the same measure over all the ordinary
    neighboring columns in that band; the worst band between `rows` counts. Around 1 or less
    means the seam is no stronger than the edges the painting is full of; the build fails
    above 1.5. (A band, not the whole height: a seam only 30 rows tall must not be averaged
    away. Colors are weighted by alpha so clear sky counts as no step.)"""
    a = img.a.astype(np.float32)
    pm = np.concatenate([a[..., :3] * a[..., 3:4] / 255.0, a[..., 3:4]], axis=2)
    step = np.abs(np.roll(pm, -1, axis=1) - pm).mean(axis=2)       # [y, x]: between x and x + 1; the last column is the wrap
    worst = 0.0
    for y0 in range(rows[0], rows[1] - window + 2, hop):
        band = step[y0:y0 + window].mean(axis=0)
        ordinary = float(np.percentile(band[:-1], 99))
        if ordinary > 1e-6:
            worst = max(worst, float(band[-1]) / ordinary)
    return worst


def clear_gaps(img: Img, rows=GAP_ROWS) -> list:
    """Runs of completely clear columns (first column, width), found around the wrap."""
    clear = (img.a[rows[0]:rows[1] + 1, :, 3] == 0).all(axis=0)
    if clear.all():
        return [(0, W)]
    start = int(np.argmin(clear))                  # begin at a covered column so no run is split by the wrap
    out, run = [], 0
    for i in range(1, W + 1):
        x = (start + i) % W
        if clear[x]:
            run += 1
        elif run:
            out.append(((x - run) % W, run))
            run = 0
    return sorted(out)


def low_coverage(img: Img, rows=LOW_ROWS) -> float:
    """Share of the low bank's rows that is covered by cloud, 0..1."""
    return float((img.a[rows[0]:rows[1] + 1, :, 3] > 0).mean())


def gap_is_clear(img: Img, gap, rows=GAP_ROWS) -> bool:
    x0, width = gap
    cols = np.arange(x0, x0 + width) % W
    return not (img.a[rows[0]:rows[1] + 1][:, cols, 3] > 0).any()
