"""A small software camera for review pictures: it draws the ground tiles, the cloud rings
and the sprites the way the game does, so the art is judged as the player meets it and not
flattered by a flat mock-up.

What it copies from the client (read these when they change):
  - ground: one tile covers 8 x 8 m, texture coordinates follow the world, nearest sampling
    with blended mipmaps (TILE in client/src/render/ground.ts)
  - sky: the gradient, the sun disc and the three times of day (PRESETS and the dome shader in
    client/src/render/sky.ts), fog by distance
  - clouds: each panorama on an upright ring around the camera, as docs/ASSETS.md section 3
    and clouds.RING describe it (ring_uv below is the mapping, in one place)
  - sprites: upright billboards standing on their bottom edge, nearest sampling, alpha cut
    at one half (the sprite batch in client/src/render/gameRenderer.ts)
Lighting of the ground is approximated by one tint per time of day; that is enough to judge
scale, contrast and readability, which is what these pictures are for.

Axes are the game's: x to the east, y up, z to the north; a heading (yaw) of 0 looks along
+z and grows toward +x; azimuth is measured the same way.
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image

import clouds as _clouds
from pix import Img

METERS_PER_TILE = 8.0


def _lin(c):
    c = np.asarray(c, np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0, 1)
    return np.clip(np.round(np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255), 0, 255).astype(np.uint8)


def _hex(v: int):
    return _lin([(v >> 16) & 255, (v >> 8) & 255, v & 255])


# client/src/render/sky.ts PRESETS (colors as written there), plus one ground tint each.
# The cloud rings are drawn fully opaque here: with the old cloudOpacity (0.9, 0.85, 0.55) the
# ring behind shows through the ring in front as a ghost.
TIMES = {
    "afternoon": dict(top=0x2f7fe0, horizon=0xbfe6ff, ground=0x9fc4dd, fog=0xc4e0f4, cloud=0xffffff, opacity=1.0,
                      sun=(0.45, 0.78, 0.35), disc=0xfffbe6, disc_size=260, tint=(1.0, 1.0, 1.0)),
    "sunset": dict(top=0x3a3a8c, horizon=0xff9a5c, ground=0xc77a5e, fog=0xe9a07c, cloud=0xffc9a8, opacity=1.0,
                   sun=(-0.82, 0.2, -0.45), disc=0xffd08a, disc_size=420, tint=(0.92, 0.72, 0.62)),
    "night": dict(top=0x04071a, horizon=0x1c2a52, ground=0x10162c, fog=0x141d3a, cloud=0x3a466e, opacity=1.0,
                  sun=(-0.3, 0.72, 0.5), disc=0xe8efff, disc_size=200, tint=(0.26, 0.31, 0.50)),
}
FOG = {1: (140, 1500), 2: (280, 2700), 3: (520, 4400)}       # FOG in client/src/render/gameRenderer.ts, by stage


def sun_azimuth(time: str) -> float:
    """Azimuth of the sun or moon, radians (0 = +z, growing toward +x)."""
    s = TIMES[time]["sun"]
    return math.atan2(s[0], s[2])


def sun_elevation(time: str) -> float:
    s = TIMES[time]["sun"]
    return math.asin(s[1] / math.sqrt(s[0] ** 2 + s[1] ** 2 + s[2] ** 2))


def ring_offset(tid: str, time: str = "sunset") -> float:
    """The texture offset (in repeats, 0..1) that puts the middle of the panorama's sun gap
    on the azimuth of the sunset sun. This is the number the client sets as offset.x."""
    n = _clouds.RING[tid]["repeats"]
    x0, width = _clouds.SUN_GAP[tid]
    middle = (x0 + width / 2.0) / _clouds.W
    return (middle + n * sun_azimuth(time) / (2 * math.pi)) % 1.0


def ring_uv(tid: str, az, tan_el, offset: float):
    """THE mapping of a cloud panorama: an upright open cylinder around the camera.
    az: azimuth in radians; tan_el: tangent of the elevation (height on the cylinder in
    radii). Returns u (in repeats; the picture reads left to right as the azimuth falls, so
    it is not mirrored when seen from inside), v (0 at the bottom edge, 1 at the top) and
    the mask of directions that hit the ring."""
    ring = _clouds.RING[tid]
    n = ring["repeats"]
    height = math.pi / n                              # in radii: one repeat is 2 pi / n wide and half as tall
    bottom = math.tan(math.radians(ring["bottom_deg"]))
    u = offset - n * az / (2 * math.pi)
    v = (tan_el - bottom) / height
    return u, v, (v >= 0) & (v < 1)


def ring_top_deg(tid: str) -> float:
    ring = _clouds.RING[tid]
    return math.degrees(math.atan(math.tan(math.radians(ring["bottom_deg"])) + math.pi / ring["repeats"]))


def _mips(arr: np.ndarray) -> list:
    out = [arr.astype(np.float64)]
    while out[-1].shape[0] > 1:
        p = out[-1]
        out.append((p[0::2, 0::2] + p[1::2, 0::2] + p[0::2, 1::2] + p[1::2, 1::2]) / 4.0)
    return out


class View:
    """One picture from one camera."""

    def __init__(self, eye_h: float, yaw_deg: float = 0.0, pitch_deg: float = 0.0, fov_deg: float = 66.0,
                 size=(960, 540), time: str = "afternoon", stage: int = 1):
        self.w, self.h = size
        self.eye_h, self.time, self.fog = eye_h, time, FOG[stage]
        self.f = (self.h / 2.0) / math.tan(math.radians(fov_deg) / 2.0)
        yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
        self.fwd = np.array([math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch)])
        self.right = np.array([-math.cos(yaw), 0.0, math.sin(yaw)])           # screen right (three.js: forward x up)
        self.up = np.cross(self.right, self.fwd)
        xs = (np.arange(self.w) + 0.5 - self.w / 2.0) / self.f
        ys = (self.h / 2.0 - np.arange(self.h) - 0.5) / self.f
        X, Y = np.meshgrid(xs, ys)
        d = X[..., None] * self.right + Y[..., None] * self.up + self.fwd
        self.norm = np.linalg.norm(d, axis=2)
        self.d = d / self.norm[..., None]
        self.img = np.zeros((self.h, self.w, 3))                             # linear light
        self._sky_done = False

    # -- sky -------------------------------------------------------------------------
    def sky(self, textures: dict | None = None, offsets: dict | None = None) -> "View":
        """Gradient dome, sun or moon disc, then the cloud rings (clouds_b behind clouds_a).
        textures: {'clouds_a': Img, 'clouds_b': Img}; offsets default to ring_offset()."""
        t = TIMES[self.time]
        d = self.d
        hgt = d[..., 1]
        top, hor, gr = _hex(t["top"]), _hex(t["horizon"]), _hex(t["ground"])
        up = np.clip(hgt, 0, 1)[..., None] ** 0.55
        dn = np.clip(-hgt * 6.0, 0, 1)[..., None]
        color = np.where(hgt[..., None] >= 0, hor * (1 - up) + top * up, hor * (1 - dn) + gr * dn)
        sun = np.array(t["sun"], np.float64)
        sun /= np.linalg.norm(sun)
        s = d @ sun
        disc_cos = math.cos(math.atan2(t["disc_size"], 6000.0))
        edge = np.clip((s - disc_cos) / 0.0015, 0, 1)
        edge = edge * edge * (3 - 2 * edge)
        color = color + _hex(t["disc"]) * (edge * 0.9 + np.maximum(s, 0) ** 48 * 0.35)[..., None]
        if textures:
            az = np.arctan2(d[..., 0], d[..., 2])
            tan_el = d[..., 1] / np.maximum(np.hypot(d[..., 0], d[..., 2]), 1e-9)
            for tid in ("clouds_b", "clouds_a"):
                if tid not in textures:
                    continue
                tex = textures[tid].a
                th, tw = tex.shape[:2]
                off = (offsets or {}).get(tid, ring_offset(tid))
                u, v, hit = ring_uv(tid, az, tan_el, off)
                x = np.floor((u % 1.0) * tw).astype(int) % tw
                y = np.clip(np.floor((1.0 - v) * th).astype(int), 0, th - 1)
                px = tex[y, x]
                a = (px[..., 3] / 255.0) * hit * t["opacity"]
                rgb = _lin(px[..., :3]) * _hex(t["cloud"])
                color = color * (1 - a[..., None]) + rgb * a[..., None]
        self.img = color
        self._sky_done = True
        return self

    # -- ground ----------------------------------------------------------------------
    def ground(self, tiles: list, surface=None) -> "View":
        """tiles: list of Img; surface(x, z) -> index into tiles for every ground point
        (default: tile 0 everywhere)."""
        if not self._sky_done:
            self.sky()
        d = self.d
        below = d[..., 1] < -1e-5
        t = np.where(below, self.eye_h / np.where(below, -d[..., 1], 1.0), 0.0)
        x, z = d[..., 0] * t, d[..., 2] * t
        idx = surface(x, z) if surface else np.zeros(x.shape, int)
        # mip level: the larger footprint of a screen pixel on the ground, in texels
        px_m = t / self.f / self.norm
        along = px_m / np.maximum(-d[..., 1], 1e-5)
        lod = np.log2(np.maximum(along / (METERS_PER_TILE / 64.0), 1e-6))
        out = np.zeros_like(self.img)
        tint = np.array(TIMES[self.time]["tint"])
        for i, tile in enumerate(tiles):
            mips = _mips(_lin(tile.a[..., :3]))
            sel = below & (idx == i)
            if not sel.any():
                continue
            l = np.clip(lod[sel], 0, len(mips) - 1.001)
            l0 = np.floor(l).astype(int)
            fr = l - l0
            acc = np.zeros((int(sel.sum()), 3))
            uu, vv = x[sel] / METERS_PER_TILE, z[sel] / METERS_PER_TILE
            for level in range(len(mips)):
                weight = np.where(l0 == level, 1 - fr, 0.0) + np.where(l0 + 1 == level, fr, 0.0)
                if not weight.any():
                    continue
                m = mips[level]
                n = m.shape[0]
                samp = m[np.floor((vv % 1.0) * n).astype(int) % n, np.floor((uu % 1.0) * n).astype(int) % n]
                acc += samp * weight[:, None]
            out[sel] = acc * tint
        fogc = _hex(TIMES[self.time]["fog"])
        k = np.clip((t * 1.0 - self.fog[0]) / (self.fog[1] - self.fog[0]), 0, 1)
        k = (k * k * (3 - 2 * k))[..., None]
        out = out * (1 - k) + fogc * k
        self.img = np.where(below[..., None], out, self.img)
        return self

    # -- sprites ---------------------------------------------------------------------
    def sprite(self, cell: Img, x: float, z: float, world_h: float = 2.2, y: float = 0.0) -> "View":
        """An upright billboard standing at (x, y, z), facing the camera."""
        p = np.array([x, y - self.eye_h, z])
        depth = p @ self.fwd
        if depth <= 0.1:
            return self
        sx = self.w / 2.0 + (p @ self.right) / depth * self.f
        sy = self.h / 2.0 - (p @ self.up) / depth * self.f
        hp = world_h / depth * self.f * abs(self.up[1])
        wp = hp * cell.w / cell.h
        if hp < 1:
            return self
        x0, y0 = sx - wp / 2.0, sy - hp
        xs = np.arange(max(0, int(math.floor(x0))), min(self.w, int(math.ceil(x0 + wp))))
        ys = np.arange(max(0, int(math.floor(y0))), min(self.h, int(math.ceil(y0 + hp))))
        if not len(xs) or not len(ys):
            return self
        u = np.floor((xs + 0.5 - x0) / wp * cell.w).astype(int)
        v = np.floor((ys + 0.5 - y0) / hp * cell.h).astype(int)
        okx, oky = (u >= 0) & (u < cell.w), (v >= 0) & (v < cell.h)
        xs, u, ys, v = xs[okx], u[okx], ys[oky], v[oky]
        if not len(xs) or not len(ys):
            return self
        s = cell.a[np.ix_(v, u)]
        a = (s[..., 3] >= 128)[..., None]
        rgb = _lin(s[..., :3]) * np.array(TIMES[self.time]["tint"])
        k = np.clip((depth - self.fog[0]) / (self.fog[1] - self.fog[0]), 0, 1)
        k = k * k * (3 - 2 * k)
        rgb = rgb * (1 - k) + _hex(TIMES[self.time]["fog"]) * k
        region = self.img[np.ix_(ys, xs)]
        self.img[np.ix_(ys, xs)] = np.where(a, rgb, region)
        return self

    def sprites(self, items: list) -> "View":
        """items: (cell, x, z) tuples; drawn far to near."""
        for cell, x, z in sorted(items, key=lambda it: -(it[1] ** 2 + it[2] ** 2)):
            self.sprite(cell, x, z)
        return self

    def pil(self) -> Image.Image:
        return Image.fromarray(_srgb(self.img), "RGB").convert("RGBA")


def unrolled_ring(textures: dict, time: str, px_per_repeat_a: int = 512, below_deg: float = 6.0,
                  offsets: dict | None = None) -> Image.Image:
    """The whole horizon unrolled: azimuth runs left to right over 360 degrees (the left edge
    is due south, the middle is north, east is to the right of it... as the eye turns
    right), the vertical axis is height on the ring. Sky gradient, sun or moon, both rings."""
    n_a = _clouds.RING["clouds_a"]["repeats"]
    width = px_per_repeat_a * n_a
    top = max(math.tan(math.radians(ring_top_deg(t))) for t in _clouds.RING)
    bottom = math.tan(math.radians(-below_deg))
    scale = width / (2 * math.pi)                         # pixels per radian = pixels per radius of height
    height = int(round((top - bottom) * scale))
    # screen x grows to the right = the azimuth falls
    az = math.pi - (np.arange(width) + 0.5) / width * 2 * math.pi
    tan_el = top - (np.arange(height) + 0.5) / scale
    AZ, TE = np.meshgrid(az, tan_el)
    el = np.arctan(TE)
    d = np.stack([np.sin(AZ) * np.cos(el), np.sin(el), np.cos(AZ) * np.cos(el)], axis=2)
    v = View.__new__(View)
    v.w, v.h, v.time, v.d = width, height, time, d
    v.img = np.zeros((height, width, 3))
    v._sky_done = False
    v.sky(textures, offsets)
    return v.pil()
