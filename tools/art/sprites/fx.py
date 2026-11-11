"""The effects sheet: 64 x 64 pixel cells, drawn with numpy fields mapped onto short color ramps.

Everything bright (explosion, fire, flash, spark) is pure light on transparent: no dark smoke is
baked in, so the frames work with ordinary alpha blending and with additive blending alike.
Smoke, dust, debris, glow, laser dot, ring, shadow and the white square are drawn white or
near-white: the game tints each particle (dark for smoke, wall color for debris, black for
the blob shadow).

All randomness comes from fixed seeds, so the sheet is the same on every run.
"""
from __future__ import annotations

import math

import numpy as np

from pix import Img, col

S = 64                    # cell size
C = (S - 1) / 2.0         # the center of a cell sits between pixels 31 and 32

# heat ramp: transparent, then deep red to white
HEAT = [
    (0.10, col("#9a2412")),
    (0.26, col("#e8481a")),
    (0.44, col("#ff8a1a")),
    (0.62, col("#ffc21a")),
    (0.78, col("#ffe95e")),
    (0.90, col("#fff8c2")),
    (0.97, col("#ffffff")),
]
SMOKE_TONES = [col("#ffffff"), col("#e3e4ea"), col("#bfc1cc"), col("#9698a8")]      # light to shadow
DUST_TONES = [col("#fffaf0"), col("#f1e7d4"), col("#d9ccb3"), col("#b9aa90")]

_e = np.minimum.reduce(np.meshgrid(np.minimum(np.arange(S), S - 1 - np.arange(S)),
                                   np.minimum(np.arange(S), S - 1 - np.arange(S))))
EDGE_FADE = np.clip((_e + 1) / 4.0, 0, 1).astype(np.float32)      # 0.25 at the border, 1 from 3 px in

BAYER4 = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) + 0.5) / 16.0


def grid():
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
    return xs, ys


def bayer(w: int = S, h: int = S) -> np.ndarray:
    return np.tile(BAYER4, (h // 4 + 1, w // 4 + 1))[:h, :w]


def smooth(t):
    return t * t * (3 - 2 * t)


def value_noise(w: int, h: int, px: int, py: int, rng, octaves: int = 1) -> np.ndarray:
    """Tileable value noise in 0..1: random lattice with period (px, py) pixels, smooth
    interpolation, each further octave at half the period and half the strength."""
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for _ in range(octaves):
        gx, gy = max(1, w // px), max(1, h // py)
        lat = rng.random((gy, gx)).astype(np.float32)
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        fx, fy = xs / px, ys / py
        x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
        tx, ty = smooth(fx - x0), smooth(fy - y0)
        a = lat[y0 % gy, x0 % gx]
        b = lat[y0 % gy, (x0 + 1) % gx]
        c = lat[(y0 + 1) % gy, x0 % gx]
        d = lat[(y0 + 1) % gy, (x0 + 1) % gx]
        out += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty)
        total += amp
        amp *= 0.5
        px, py = max(1, px // 2), max(1, py // 2)
    return out / total


def ring_noise(n: int, rng) -> np.ndarray:
    """n random values in -1..1 around a circle, for wobbling a radius by angle."""
    return rng.uniform(-1, 1, n).astype(np.float32)


def sample_ring(vals: np.ndarray, theta: np.ndarray) -> np.ndarray:
    n = len(vals)
    f = (theta % (2 * math.pi)) / (2 * math.pi) * n
    i0 = np.floor(f).astype(int)
    t = smooth(f - i0)
    return vals[i0 % n] * (1 - t) + vals[(i0 + 1) % n] * t


def heat_to_img(heat: np.ndarray, ramp=HEAT) -> Img:
    """Map a heat field (0..1) onto the fire ramp; below the first stop is transparent."""
    out = np.zeros((heat.shape[0], heat.shape[1], 4), np.uint8)
    for lo, c in ramp:
        out[heat >= lo] = c
    return Img.from_array(out)


def deposit(heat: np.ndarray, x: float, y: float, v: float) -> None:
    xi, yi = int(round(x)), int(round(y))
    if 0 <= xi < heat.shape[1] and 0 <= yi < heat.shape[0]:
        if v > heat[yi, xi]:
            heat[yi, xi] = v


def streak(heat: np.ndarray, x0, y0, x1, y1, v0: float, v1: float, dotted: bool = False) -> None:
    """A one-pixel line whose heat runs from v0 at (x0, y0) to v1 at (x1, y1)."""
    n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    for i in range(n + 1):
        t = i / n
        if dotted and i % 2 == 1:
            continue
        deposit(heat, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, v0 + (v1 - v0) * t)


def star(heat: np.ndarray, x: float, y: float, arm: int, v: float, diag: bool = False) -> None:
    """A little plus-shaped twinkle (with short diagonals when diag is set)."""
    deposit(heat, x, y, v)
    for d in range(1, arm + 1):
        f = v * (1 - 0.28 * d)
        for dx, dy in ((d, 0), (-d, 0), (0, d), (0, -d)):
            deposit(heat, x + dx, y + dy, f)
    if diag:
        for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            deposit(heat, x + dx, y + dy, v * 0.6)


# ---- the sparkler explosion ---------------------------------------------------------------

def explosion_frames(seed: int = 9001, frames: int = 8, ground: bool = False) -> list:
    """Model-city pyrotechnics: a white-hot core that bursts into fountains of sparks. The
    sparks fly out fast, slow down, sag under gravity, fork at their tips and twinkle out.
    ground=False: a burst in the air, centered in the cell. ground=True: a charge going off
    on the ground: the core sits on the bottom edge of the cell and the sparks go up in a fan
    and rain back down."""
    rng = np.random.default_rng(seed)
    xs, ys = grid()
    cy = 58.5 if ground else C                 # the row the burst starts from
    dx, dy = xs - C, ys - cy
    dist = np.hypot(dx, dy)
    theta = np.arctan2(dy, dx)
    lumps = [ring_noise(9, rng) for _ in range(frames)]
    grain = [value_noise(S, S, 8, 8, rng, 2) for _ in range(frames)]
    n_spikes = 9
    spike_phase = rng.uniform(0, math.pi)
    spike_amp = ring_noise(n_spikes, rng) * 0.5 + 0.5

    # sparks: several waves, each a full circle of directions
    sparks = []
    for count, birth, lo, hi in ((26, 0.0, 25, 34), (20, 0.75, 18, 30), (16, 1.5, 13, 26), (12, 2.3, 9, 20)):
        off = rng.uniform(0, 2 * math.pi)
        for i in range(count):
            ang = off + (i + rng.uniform(-0.45, 0.45)) / count * 2 * math.pi
            sp = {
                "ang": ang, "reach": rng.uniform(lo, hi), "birth": birth + rng.uniform(0, 0.5),
                "life": rng.uniform(3.4, 6.4), "tw": rng.random() < 0.38, "big": rng.random() < 0.12,
                "ox": 0.0, "oy": 0.0,
                "g": rng.uniform(0.16, 0.36), "tau": rng.uniform(1.2, 1.9), "trail": rng.uniform(1.3, 2.0),
            }
            if ground:
                # fold the full circle into a fan that opens upward; the ones that go straight
                # up fly highest, and everything falls back harder
                u = ((ang / (2 * math.pi)) % 1.0) * 2 - 1
                sp["ang"] = -math.pi / 2 + u * 1.12
                sp["reach"] *= 0.72 + 0.98 * math.cos(u * 1.12) ** 1.5
                sp["g"] *= 1.9
                sp["life"] += 0.6
            sparks.append(sp)

    def pos(sp, age):
        r = sp["reach"] * (1 - math.exp(-age / sp["tau"]))
        return (C + sp["ox"] + math.cos(sp["ang"]) * r,
                cy + sp["oy"] + math.sin(sp["ang"]) * r + sp["g"] * age * age)

    # forks: a spark splits into two or three short ones at its tip, like a sparkler
    forks = []
    for sp in list(sparks):
        if rng.random() < 0.55:
            split_age = rng.uniform(1.4, 2.8)
            x, y = pos(sp, split_age)
            for _ in range(int(rng.integers(2, 4))):
                forks.append({
                    "ang": sp["ang"] + rng.uniform(-1.2, 1.2), "reach": rng.uniform(4, 10),
                    "birth": sp["birth"] + split_age, "life": rng.uniform(1.8, 3.4), "tw": True, "big": False,
                    "ox": x - C, "oy": y - cy, "g": rng.uniform(0.2, 0.45), "tau": 0.9, "trail": 0.8,
                })
    sparks += forks

    core_r = [7.0, 14.5, 16.0, 12.0, 7.5, 0, 0, 0]
    core_h = [1.3, 1.25, 1.0, 0.82, 0.62, 0.45, 0, 0]
    out = []
    for f in range(frames):
        heat = np.zeros((S, S), np.float32)
        # --- core: a spiky fireball that shrinks as it cools, never a dull blob
        if core_r[f] > 0:
            spikes = np.abs(np.cos(theta * n_spikes / 2 + spike_phase + 0.3 * f)) ** 6
            spikes = spikes * (0.4 + 0.6 * sample_ring(spike_amp, theta + 0.2 * f))
            r = core_r[f] * (1 + 0.14 * sample_ring(lumps[f], theta) + (0.55 if f >= 1 else 0.3) * spikes)
            h = core_h[f] * (1 - (dist / np.maximum(r, 0.5)) ** 2)
            h += (grain[f] - 0.5) * (0.16 + 0.07 * f)
            heat = np.maximum(heat, np.where(dist < r, np.clip(h, 0, 1), 0))
        # --- flash rays on the first frames
        if f <= 1:
            n_rays = 12
            for i in range(n_rays):
                ang = 0.35 + i / n_rays * 2 * math.pi + rng.uniform(-0.1, 0.1)
                length = (rng.uniform(25, 31) if i % 3 == 0 else rng.uniform(13, 21)) * (1.0 if f == 0 else 0.85)
                if ground:
                    ang = -math.pi / 2 + (i / (n_rays - 1) - 0.5) * 2.7 + (ang % 0.2 - 0.1)
                    length *= 1.0 + 0.45 * math.cos((i / (n_rays - 1) - 0.5) * 2.7)
                r0 = core_r[f] * 0.6
                streak(heat, C + math.cos(ang) * r0, cy + math.sin(ang) * r0,
                       C + math.cos(ang) * length, cy + math.sin(ang) * length, 1.0, 0.48 if f == 0 else 0.34)
        # --- sparks
        for sp in sparks:
            age = f + 0.6 - sp["birth"]
            if age <= 0.05 or age > sp["life"]:
                continue
            k = age / sp["life"]
            fade = 1.0 if k < 0.4 else 1.0 - 0.72 * (k - 0.4) / 0.6
            x1, y1 = pos(sp, age)
            x0, y0 = pos(sp, max(0.0, age - sp["trail"] * (1.0 - 0.5 * k)))
            streak(heat, x0, y0, x1, y1, 0.34 * fade, 1.0 * fade, dotted=k > 0.72)
            blink = (f + int(sp["ang"] * 7)) % 2 == 0
            if sp["tw"] and k > 0.3 and blink:
                big = sp["big"] and k < 0.7
                star(heat, x1, y1, 2 if big else 1, min(1.0, fade + 0.3), diag=big)
            elif k > 0.8 and blink:
                deposit(heat, x1, y1, 0.8)
        heat *= EDGE_FADE                     # sparks thin out before the cell border cuts them
        if ground:
            heat[ys > cy + 0.5] = 0           # nothing below the ground line
        img = heat_to_img(heat)
        # --- glow around the core: loose opaque orange pixels, denser toward the middle
        if f <= 3 and core_r[f] > 0:
            halo = Img(S, S)
            hr = core_r[f] * 1.2 + (6 if f < 3 else 3)
            b = bayer()
            m = (dist < hr) & (b < 0.6 * np.clip(1 - dist / hr, 0, 1) ** 0.8) & (ys <= cy + 0.5)
            halo.a[m] = col("#ff8a1a") if f < 2 else col("#e8481a")
            halo.blit(img)
            img = halo
        out.append(img)
    return out


# ---- smoke and dust -------------------------------------------------------------------------

def puff_frames(tones, seed: int, frames: int = 6, flat: float = 1.0, rise: float = 1.0,
                reach: float = 15.0, lobe: float = 10.0) -> list:
    """A billowing puff: a handful of round lobes that swell, drift apart and then shrink
    away one by one, so the cloud breaks into wisps instead of fading as a block.
    `flat` > 1 squashes the lobes and spreads them sideways (ground dust), `rise` is how far
    the cloud climbs, `reach` how far the lobes wander, `lobe` their size."""
    rng = np.random.default_rng(seed)
    xs, ys = grid()
    n = 9
    ang = rng.uniform(0, 2 * math.pi, n)
    rad = np.sqrt(rng.uniform(0.02, 1.0, n))
    size = rng.uniform(0.6, 1.0, n)
    size[0], rad[0] = 1.0, 0.1                              # one big lobe in the middle
    drift = rng.uniform(0.5, 1.5, n)
    fade_at = rng.uniform(0.3, 0.7, n)                      # when each lobe starts to shrink
    grain = value_noise(S, S, 6, 6, rng, 2)
    light = np.array([-0.55, -0.83], np.float32)            # from the upper left
    alphas = [255, 255, 255, 220, 170, 110]
    out = []
    for f in range(frames):
        t = f / (frames - 1)
        grow = 0.5 + 0.5 * (1 - (1 - min(1.0, t * 1.6)) ** 2)      # fast at first, then easing
        best = np.full((S, S), -9.0, np.float32)
        tone = np.zeros((S, S), np.float32)
        for i in range(n):
            shrink = 1.0 if t <= fade_at[i] else 1.0 - 0.6 * ((t - fade_at[i]) / (1 - fade_at[i])) ** 1.4
            out_ = reach * rad[i] * (0.35 + 0.65 * (1 - (1 - t) ** 1.5))
            cx = C + math.cos(ang[i]) * out_ * flat
            cy = C + 5 - rise * 9 * t * drift[i] + math.sin(ang[i]) * out_ / flat * 0.85
            r = lobe * size[i] * grow * shrink
            ex, ey = (xs - cx) / (r * flat), (ys - cy) / r
            field = 1 - (ex * ex + ey * ey)
            z = np.sqrt(np.clip(field, 0, 1))
            lit = (ex * light[0] + ey * light[1]) * 0.8 + z * 0.5
            sel = field > best
            tone = np.where(sel, lit, tone)
            best = np.where(sel, field, best)
        solid = best > 0.03 + (grain - 0.5) * (0.10 + 0.45 * t)       # wispier edges with age
        shade_v = tone + (grain - 0.5) * 0.18
        idx = np.zeros((S, S), int)
        idx[shade_v < 0.50] = 1
        idx[shade_v < 0.12] = 2
        idx[shade_v < -0.26] = 3
        arr = np.zeros((S, S, 4), np.uint8)
        for k, c in enumerate(tones):
            m = solid & (idx == k)
            arr[m] = (c[0], c[1], c[2], alphas[min(f, len(alphas) - 1)])
        out.append(Img.from_array(arr))
    return out


def smoke_frames() -> list:
    return puff_frames(SMOKE_TONES, seed=31, rise=1.0, reach=16.5, lobe=13.0)


def dust_frames() -> list:
    return puff_frames(DUST_TONES, seed=47, flat=1.35, rise=0.4, reach=12.5, lobe=9.5)


# ---- fire -----------------------------------------------------------------------------------

def fire_frames(seed: int = 5, frames: int = 6) -> list:
    """A looping fire with its base on the bottom edge of the cell: three tongues of
    different heights that lick and sway. Tileable noise scrolls upward by exactly its own
    period over the loop, so frame 6 would be frame 0 again."""
    rng = np.random.default_rng(seed)
    period = 48
    n1 = value_noise(S, period, 16, 16, rng, 1)             # big tongues
    n2 = value_noise(S, period, 8, 8, rng, 1)               # small licks
    sway = value_noise(S, period, 32, 24, rng, 1)
    xs, ys = grid()
    base_y = S - 2.0
    tongues = ((0.0, 1.0, 13.0, 0), (-12.0, 0.66, 10.0, 21), (12.5, 0.78, 10.5, 43))   # x, height, half width, noise shift
    out = []
    for f in range(frames):
        sh = (f * period) // frames
        total = np.zeros((S, S), np.float32)
        for tx, th, tw, shift in tongues:
            rows = ((np.arange(S)[:, None] + sh + shift) % period) * np.ones((1, S), int)
            cols = ((np.arange(S)[None, :] + shift) % S) * np.ones((S, 1), int)
            a = n1[rows, cols]
            b2 = n2[rows, cols]
            sw = sway[rows, cols]
            up = np.clip((base_y - ys) / ((S - 5.0) * th), 0, 1.3)        # 0 at the base, 1 at this tongue's top
            half = tw * (1 - np.clip(up, 0, 1) * 0.6) + 1.5
            side = np.abs(xs - C - tx - (sw - 0.5) * 15 * up) / half
            body = 1 - side ** 2
            # temperature: hot at the base, cooling with height; noise pulls licks out of it
            heat = 1.05 * body - up * 1.12 + (a - 0.5) * (0.5 + 1.0 * up) + (b2 - 0.5) * (0.2 + 0.5 * up)
            heat += np.clip(0.22 - up, 0, 1) * 0.9 * body                 # a steady white-hot root
            heat = np.where((ys > base_y) | (side > 1.2), 0, heat)
            total = np.maximum(total, heat)
        out.append(heat_to_img(np.clip(total, 0, 0.98)))
    return out


# ---- single cells ---------------------------------------------------------------------------

def flash_frames() -> list:
    """Muzzle flash, 3 frames: a hard star, a smaller hollow star, a last ember ring."""
    rng = np.random.default_rng(12)
    xs, ys = grid()
    dx, dy = xs - C, ys - C
    dist = np.hypot(dx, dy)
    theta = np.arctan2(dy, dx)
    out = []
    spikes = 8
    jitter = ring_noise(spikes, rng)
    for f, (r_core, r_spike, peak) in enumerate(((11, 30, 1.2), (9, 23, 0.95), (5, 14, 0.7))):
        lobe = np.abs(np.cos(theta * spikes / 2 + 0.4 + f * 0.35)) ** 5
        long_ = 0.62 + 0.38 * np.abs(np.cos(theta * 2 + 0.4 + f * 0.35)) ** 3
        r = r_core + (r_spike - r_core) * lobe * long_ * (1 + 0.15 * sample_ring(jitter, theta))
        heat = peak * (1 - (dist / np.maximum(r, 1)) ** 1.6)
        heat = np.where(dist < r, heat, 0)
        if f == 1:
            heat -= np.clip(1 - dist / (r_core * 0.7), 0, 1) * 0.35
        out.append(heat_to_img(np.clip(heat, 0, 1)))
    return out


def spark_cell() -> Img:
    """One spark: a four-point star, white core, tintable."""
    heat = np.zeros((S, S), np.float32)
    xs, ys = grid()
    dx, dy = np.abs(xs - C), np.abs(ys - C)
    # long thin arms on the axes, short ones on the diagonals
    arm_ = np.maximum(0, 1 - np.maximum(dx, dy) / 22.0) * (np.minimum(dx, dy) < 1.0 + 3.2 * (1 - np.maximum(dx, dy) / 22.0) ** 2)
    diag = np.maximum(0, 1 - (dx + dy) / 15.0) * (np.abs(dx - dy) < 1.5)
    core = np.maximum(0, 1 - np.hypot(dx, dy) / 6.5)
    heat = np.maximum.reduce([arm_ * 0.95, diag * 0.8, core * 1.3])
    ramp = [(0.08, col("#ffd27a")), (0.3, col("#ffe9a0")), (0.52, col("#fff8d8")), (0.75, col("#ffffff"))]
    return heat_to_img(np.clip(heat, 0, 1), ramp)


def soft_disc(radius: float, stops, color="#ffffff") -> Img:
    """White disc whose alpha follows `stops` = [(r / radius, alpha 0..1), ...]."""
    xs, ys = grid()
    d = np.hypot(xs - C, ys - C) / radius
    a = np.interp(d, [s[0] for s in stops], [s[1] for s in stops], right=0.0)
    arr = np.zeros((S, S, 4), np.uint8)
    c = col(color)
    arr[..., 0], arr[..., 1], arr[..., 2] = c[0], c[1], c[2]
    arr[..., 3] = np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
    return Img.from_array(arr)


def glow_cell() -> Img:
    """Soft additive glow: bright middle, long gentle falloff to nothing at the cell edge."""
    xs, ys = grid()
    d = np.clip(np.hypot(xs - C, ys - C) / 31.5, 0, 1)
    a = (1 - d) ** 2.2
    a = np.maximum(a, np.clip(1 - d / 0.16, 0, 1))
    arr = np.full((S, S, 4), 255, np.uint8)
    arr[..., 3] = np.round(a * 255).astype(np.uint8)
    return Img.from_array(arr)


def laserdot_cell() -> Img:
    """The dot a targeting laser paints: a hard core, a tight halo and a thin cross flare."""
    xs, ys = grid()
    dx, dy = np.abs(xs - C), np.abs(ys - C)
    d = np.hypot(dx, dy)
    a = np.clip(1 - d / 13.0, 0, 1) ** 1.8 * 0.85
    a = np.maximum(a, (d <= 4.6) * 1.0)
    flare = np.clip(1 - np.maximum(dx, dy) / 29.0, 0, 1) ** 1.3 * (np.minimum(dx, dy) < 0.9)
    a = np.maximum(a, flare * 0.9)
    arr = np.full((S, S, 4), 255, np.uint8)
    arr[..., 3] = np.round(np.clip(a, 0, 1) * 255).astype(np.uint8)
    return Img.from_array(arr)


def ring_cell() -> Img:
    """Shockwave ring: a crisp bright front with a broken, dithered wake behind it."""
    rng = np.random.default_rng(3)
    xs, ys = grid()
    d = np.hypot(xs - C, ys - C)
    theta = np.arctan2(ys - C, xs - C)
    wob = sample_ring(ring_noise(24, rng), theta)
    r_out = 29.5
    front = (d <= r_out) & (d > r_out - 2.4)
    wake_w = 9.0 + 3.0 * wob
    k = np.clip((d - (r_out - 2.4 - wake_w)) / wake_w, 0, 1)        # 0 inside, 1 at the front
    wake = (d <= r_out - 2.4) & (k > 0) & (bayer() < k ** 1.6 * 0.95)
    arr = np.zeros((S, S, 4), np.uint8)
    arr[wake] = (255, 255, 255, 150)
    arr[front] = (255, 255, 255, 255)
    return Img.from_array(arr)


def shadow_cell() -> Img:
    """Blob shadow, authored white (the game tints it black): a soft-edged disc."""
    return soft_disc(31.0, [(0.0, 0.85), (0.55, 0.7), (0.8, 0.35), (1.0, 0.0)])


def white_cell() -> Img:
    return Img(S, S, "#ffffff")


def debris_cells() -> list:
    """Four chunks of broken wall, near-white so the game can tint them with the building's
    color: a wedge of plaster, a slab, a shard and a scatter of crumbs. Dark outline."""
    lt, md, dk, vdk = col("#ffffff"), col("#dfe0e6"), col("#b3b5c0"), col("#8b8d9b")
    line = col("#2a2c38")
    out = []

    def poly(img: Img, pts, c):
        from PIL import Image, ImageDraw
        m = Image.new("L", (S, S), 0)
        ImageDraw.Draw(m).polygon([(float(x), float(y)) for x, y in pts], fill=255)
        img.a[np.asarray(m) > 0] = c

    # 1: a chunky wedge: top face lit, front face mid, side face dark
    a = Img(S, S)
    poly(a, [(14, 24), (34, 14), (50, 22), (30, 33)], lt)
    poly(a, [(14, 24), (30, 33), (33, 50), (18, 42)], md)
    poly(a, [(30, 33), (50, 22), (47, 40), (33, 50)], dk)
    a.line(22, 30, 25, 36, dk).line(25, 36, 23, 41, dk)             # a crack
    a.px(38, 20, md).px(39, 21, md).px(28, 22, md)
    a.outline(line)
    out.append(a)
    # 2: a flat slab seen at an angle
    b = Img(S, S)
    poly(b, [(10, 30), (40, 16), (54, 24), (24, 39)], lt)
    poly(b, [(10, 30), (24, 39), (24, 46), (10, 37)], md)
    poly(b, [(24, 39), (54, 24), (54, 31), (24, 46)], dk)
    b.line(30, 26, 36, 30, md).line(36, 30, 41, 28, md)
    b.outline(line)
    out.append(b)
    # 3: a sharp shard
    c = Img(S, S)
    poly(c, [(18, 46), (30, 12), (38, 30)], lt)
    poly(c, [(30, 12), (46, 40), (38, 30)], md)
    poly(c, [(18, 46), (38, 30), (46, 40), (30, 50)], dk)
    c.outline(line)
    out.append(c)
    # 4: crumbs
    d = Img(S, S)
    for (cx, cy, r) in ((20, 24, 6), (40, 20, 4.5), (34, 38, 7.5), (16, 42, 3.5), (48, 34, 3)):
        pts = []
        rng = np.random.default_rng(int(cx * 7 + cy))
        for i in range(6):
            ang = i / 6 * 2 * math.pi + rng.uniform(-0.3, 0.3)
            rr = r * rng.uniform(0.75, 1.1)
            pts.append((cx + math.cos(ang) * rr, cy + math.sin(ang) * rr))
        poly(d, pts, md)
        top = [(x, y) for x, y in pts]
        poly(d, [top[3], top[4], top[5], (cx, cy), ], lt)
        poly(d, [top[0], top[1], top[2], (cx, cy)], dk)
    d.outline(line)
    out.append(d)
    return out


def build() -> dict:
    """Every effect as a list of 64 x 64 frames, keyed by sprite id."""
    return {
        "fx_explosion": explosion_frames(),
        "fx_explosion_ground": explosion_frames(seed=77, ground=True),
        "fx_smoke": smoke_frames(),
        "fx_dust": dust_frames(),
        "fx_fire": fire_frames(),
        "fx_debris": debris_cells(),
        "fx_flash": flash_frames(),
        "fx_spark": [spark_cell()],
        "fx_glow": [glow_cell()],
        "fx_laserdot": [laserdot_cell()],
        "fx_ring": [ring_cell()],
        "fx_shadow": [shadow_cell()],
        "fx_white": [white_cell()],
    }
