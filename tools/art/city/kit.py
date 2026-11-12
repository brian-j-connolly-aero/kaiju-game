"""The building kit: assemble a Port Meridian building from parts on the shared atlas.

    from city import kit

    @kit.building("house_a", district="suburb", tone="cream")
    def house_a(b):
        body = b.block(8.4, 9.0, 3.4, facade="plaster_sash", tint=True)
        b.gable(body, rise=2.6, roof="tile_red")
        b.door(body, "front", x=-1.5, kind="door_red")
        b.chimney(2.0, 1.5, body.z1, 5.9)

    if __name__ == "__main__":
        raise SystemExit(kit.run_family("homes"))

Coordinates are the authoring frame: x = the building's own left, -y = its front (the side
facing the street), z = up, meters, origin on the ground in the middle of the footprint.
The archetype's box is `b.W` wide (x), `b.D` deep (y), `b.H` tall. The whole intact model,
overhangs and antennas included, must fill that box and stay inside it (style.fit_tolerance).

Every face uses the one `city_atlas` material. The destruction states (damaged, rubble,
chunks) are derived from the intact building by `destruct.derive`, the same for every
building; a building only adds hints (`b.keepsake`, `b.bite_hint`).
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass

import numpy as np

from . import atlas, style
from .geom import Face, Mesh, hex_rgb, map_region, plain

UP = np.array([0.0, 0.0, 1.0])


# ---- archetypes ---------------------------------------------------------------------------
def archetype(aid: str) -> dict:
    import contract
    a = contract.archetypes().get(aid)
    if a is None:
        raise KeyError(f"archetype {aid!r} is not in tools/art/data/archetypes.json (npm run export:defs)")
    return a


def model_id(aid: str) -> str:
    a = archetype(aid)
    return a.get("model") or (("lm_" if a.get("landmark") else "bld_") + aid)


@dataclass
class Block:
    """A box-shaped body that was added with Building.block()."""
    x0: float
    x1: float
    y0: float
    y1: float
    z0: float
    z1: float          # top of the walls (the roof surface of a flat roof)
    upper: str
    tint: bool
    tone: tuple
    top: float = 0.0   # top of the parapet, if any

    @property
    def w(self):
        return self.x1 - self.x0

    @property
    def d(self):
        return self.y1 - self.y0

    @property
    def h(self):
        return self.z1 - self.z0

    @property
    def cx(self):
        return (self.x0 + self.x1) / 2

    @property
    def cy(self):
        return (self.y0 + self.y1) / 2

    def side(self, name: str):
        """(start, end, outward normal) of a wall at ground level, seen from outside left to right."""
        x0, x1, y0, y1 = self.x0, self.x1, self.y0, self.y1
        return {
            "front": ((x0, y0), (x1, y0), (0, -1)),
            "left": ((x1, y0), (x1, y1), (1, 0)),
            "back": ((x1, y1), (x0, y1), (0, 1)),
            "right": ((x0, y1), (x0, y0), (-1, 0)),
        }[name]


SIDES = ("front", "left", "back", "right")
BAY_DOORS = ("door_red", "door_green", "door_blue")      # bay-sized pictures (3 m storey)


class Building:
    """One archetype under construction. Parts go into `self.intact`."""

    def __init__(self, aid: str, district: str = "suburb", tone: str | None = None, seed: int = 1):
        a = archetype(aid)
        self.id = aid
        self.model = model_id(aid)
        self.cls = a.get("class")
        self.landmark = bool(a.get("landmark"))
        self.W, self.D = float(a["footprint"][0]), float(a["footprint"][1])
        self.H = float(a["height"])
        self.district = district
        fam = style.DISTRICTS[district]
        self.tone = hex_rgb(style.TONES.get(tone or fam["walls"][0], tone or "#ffffff"))
        self.tint_colors = [style.TONES[t] for t in fam["walls"]]
        self.intact = Mesh()
        self.solids: list[np.ndarray] = []      # convex volumes (corner points) for chunks and cavities
        self.keepsake: Mesh | None = None       # the piece that stays recognizable on the rubble
        self.bite_hint: tuple | None = None     # (x, y, z) where damage should bite first
        self.holes: int | None = None           # holes the damage punches through walls (None: 1 to 3 by height)
        self.rng = np.random.default_rng(seed)
        self.seed = seed
        self.damage_hook = None                 # fn(building, damaged_mesh) for bespoke damage

    # ---- walls ---------------------------------------------------------------------------
    def wall(self, p0, p1, z0, z1, region: str, *, tint=False, tone=None, storey=None, bays=None,
             tag="wall") -> list:
        """A vertical wall from ground point p0 to p1 (outside on the right-hand... seen from
        outside, p0 is left), from z0 to z1, textured with `region`. Facades stretch slightly
        so the wall holds whole bays and whole storeys."""
        p0 = np.array([p0[0], p0[1], z0], float)
        p1 = np.array([p1[0], p1[1], z0], float)
        pts = [p0, p1, p1 + UP * (z1 - z0), p0 + UP * (z1 - z0)]
        r = atlas.region(region)
        col = tone if tone is not None else (self.tone if tint else (1, 1, 1))
        unit = None
        length = float(np.linalg.norm(p1 - p0))
        if r.kind == "facade":
            sh = storey or (style.STOREY if r.storey_px == 16 else style.GROUND)
            nb = bays or max(1, round(length / style.BAY))
            ns = max(1, round((z1 - z0) / sh))
            unit = (r.bays * length / nb, r.storeys * (z1 - z0) / ns)
        faces = map_region(pts, region, col=col, tint=tint and r.tint, tag=tag, origin=p0, unit=unit)
        self.intact += faces
        return faces

    def block(self, w, d, h, at=(0.0, 0.0, 0.0), *, facade="plaster_sash", ground=None,
              ground_h=style.GROUND, sides: dict | None = None, roof="gravel", parapet=0.0,
              parapet_region=None, tint=None, tone=None, solid=True) -> Block:
        """A box body: four walls in bands (an optional ground storey, then `facade`), a flat
        top. `sides` overrides a side: {"left": "plaster_plain"} or {"back": (ground, upper)}.
        `roof` maps the top (None leaves it plain; covered by a pitched roof anyway).
        `parapet` raises the walls that much above the roof with an inner face and a cap."""
        cx, cy, z0 = at
        x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
        z1 = z0 + h
        tint = atlas.region(facade).tint if tint is None else tint
        tone_c = hex_rgb(tone) if tone is not None else self.tone
        blk = Block(x0, x1, y0, y1, z0, z1, facade, tint, tone_c, z1 + parapet)
        for name in SIDES:
            gr, up = ground, facade
            if sides and name in sides:
                spec = sides[name]
                gr, up = (spec if isinstance(spec, tuple) else (None if spec is not None else ground, spec))
                if up is None:
                    continue
            a, b, _ = blk.side(name)
            z = z0
            if gr:
                self.wall(a, b, z, z + ground_h, gr, tint=tint, tone=tone_c)
                z += ground_h
            if z1 > z + 1e-6:
                self.wall(a, b, z, z1, up, tint=tint, tone=tone_c)
            if parapet > 0:
                pr = parapet_region or ("cornice" if atlas.region(up).tint is False else "plaster_plain")
                self.wall(a, b, z1, z1 + parapet, pr, tint=tint and atlas.region(pr).tint, tone=tone_c,
                          tag="wall")
        top = z1
        if parapet > 0:
            t = min(0.3, w / 6, d / 6)
            # inner faces (facing the roof) and the cap
            ix0, ix1, iy0, iy1 = x0 + t, x1 - t, y0 + t, y1 - t
            inner = [((ix1, iy0), (ix0, iy0)), ((ix1, iy1), (ix1, iy0)), ((ix0, iy1), (ix1, iy1)),
                     ((ix0, iy0), (ix0, iy1))]
            cap_col = tuple(c * 0.92 for c in (tone_c if tint else hex_rgb("#d8d2c4")))
            for (ax, ay), (bx, by) in inner:
                self.intact += Face([np.array(p, float) for p in
                                     [(ax, ay, z1), (bx, by, z1), (bx, by, z1 + parapet), (ax, ay, z1 + parapet)]],
                                    None, cap_col, False, None, "detail")
            zc = z1 + parapet
            ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            iring = [(ix0, iy0), (ix1, iy0), (ix1, iy1), (ix0, iy1)]
            for k in range(4):
                a, b = ring[k], ring[(k + 1) % 4]
                ia, ib = iring[k], iring[(k + 1) % 4]
                self.intact += plain([(a[0], a[1], zc), (b[0], b[1], zc), (ib[0], ib[1], zc), (ia[0], ia[1], zc)],
                                     "#f2efe8", tag="detail")
            for f in self.intact.faces[-8:]:
                if f.uv is None:
                    from .geom import white_uv
                    f.uv = white_uv(len(f.pts))
                    f.region = "white"
            x0r, x1r, y0r, y1r = ix0, ix1, iy0, iy1
        else:
            x0r, x1r, y0r, y1r = x0, x1, y0, y1
        roof_pts = [(x0r, y0r, top), (x1r, y0r, top), (x1r, y1r, top), (x0r, y1r, top)]
        if roof is False:
            pass                       # covered by a pitched roof: no hidden top face
        elif roof:
            self.intact += map_region(roof_pts, roof, tag="roof")
        else:
            self.intact += plain(roof_pts, "#8a8d96", tag="roof")
        if solid:
            self.solids.append(_box_pts(x0, x1, y0, y1, z0, z1 + parapet))
        return blk

    # ---- roofs ---------------------------------------------------------------------------
    def gable(self, blk: Block, rise: float, *, along: str | None = None, overhang=style.EAVE,
              roof="tile_red", end_region=None, window=True) -> float:
        """A pitched roof with two slopes and two gable ends. The ridge runs along the longer
        side unless `along` = "x" or "y". Returns the ridge height."""
        along = along or ("x" if blk.w >= blk.d else "y")
        z0, zr = blk.z1, blk.z1 + rise
        o = overhang
        end_region = end_region or ("plaster_plain" if atlas.region(blk.upper).tint else _plain_of(blk.upper))
        er = atlas.region(end_region)
        ecol = blk.tone if er.tint and blk.tint else (1, 1, 1)
        # the slope drops a little over the overhang so the eave sits below the wall top
        drop = rise * o / (blk.d / 2 if along == "x" else blk.w / 2)
        if along == "x":
            xa, xb = blk.x0 - o, blk.x1 + o
            ym = blk.cy
            front = [(xa, blk.y0 - o, z0 - drop), (xb, blk.y0 - o, z0 - drop), (xb, ym, zr), (xa, ym, zr)]
            back = [(xb, blk.y1 + o, z0 - drop), (xa, blk.y1 + o, z0 - drop), (xa, ym, zr), (xb, ym, zr)]
            ends = [[(blk.x1, blk.y0, z0), (blk.x1, blk.y1, z0), (blk.x1, ym, zr)],
                    [(blk.x0, blk.y1, z0), (blk.x0, blk.y0, z0), (blk.x0, ym, zr)]]
            ze = z0 - drop
            under = [[(blk.x0, blk.y1 + o, ze), (blk.x1, blk.y1 + o, ze), (blk.x1, blk.y1, ze), (blk.x0, blk.y1, ze)],
                     [(blk.x0, blk.y0, ze), (blk.x1, blk.y0, ze), (blk.x1, blk.y0 - o, ze), (blk.x0, blk.y0 - o, ze)]]
        else:
            ya, yb = blk.y0 - o, blk.y1 + o
            xm = blk.cx
            front = [(blk.x1 + o, ya, z0 - drop), (blk.x1 + o, yb, z0 - drop), (xm, yb, zr), (xm, ya, zr)]
            back = [(blk.x0 - o, yb, z0 - drop), (blk.x0 - o, ya, z0 - drop), (xm, ya, zr), (xm, yb, zr)]
            ends = [[(blk.x0, blk.y0, z0), (blk.x1, blk.y0, z0), (xm, blk.y0, zr)],
                    [(blk.x1, blk.y1, z0), (blk.x0, blk.y1, z0), (xm, blk.y1, zr)]]
            ze = z0 - drop
            under = [[(blk.x0 - o, blk.y0, ze), (blk.x0 - o, blk.y1, ze), (blk.x0, blk.y1, ze), (blk.x0, blk.y0, ze)],
                     [(blk.x1, blk.y0, ze), (blk.x1, blk.y1, ze), (blk.x1 + o, blk.y1, ze), (blk.x1 + o, blk.y0, ze)]]
        self.intact += map_region(front, roof, tag="roof")
        self.intact += map_region(back, roof, tag="roof")
        # the underside: each slope again, reversed and a little lower (cheaper than soffits,
        # and no hole from below anywhere along the overhangs)
        for slope in (front, back):
            low = [np.array(p, float) + np.array([0.0, 0.0, -0.22]) for p in reversed(slope)]
            self.intact += plain(low, "#8a8478", tag="underside")
        _ = under
        self._roof_trim(front, back, along, blk, o)
        for tri in ends:
            self.intact += map_region(tri, end_region, col=ecol, tint=blk.tint and er.tint, tag="wall")
            if window and rise >= 2.2:
                a, b, top = (np.array(p, float) for p in tri)
                mid = (a + b) / 2
                n = np.cross(b - a, UP)
                n /= np.linalg.norm(n)
                along_v = (b - a) / np.linalg.norm(b - a)
                ww, wh = style.WINDOW
                # the window must sit inside the gable triangle: its top corners stay under the
                # verge boards (0.22 m below the slope) with a little margin. It may drop a
                # little below the wall top (into the wall plate) to fit a low gable; if it
                # still does not fit, the gable has no window.
                half = np.linalg.norm(b - a) / 2
                limit = z0 + rise * (1.0 - (ww / 2) / half) - 0.22 - 0.1
                zc = min(z0 + rise * 0.18, limit - wh)
                if zc >= z0 - 0.35:
                    c0 = mid + n * 0.03 + UP * (zc - mid[2])
                    q = [c0 - along_v * ww / 2, c0 + along_v * ww / 2, c0 + along_v * ww / 2 + UP * wh,
                         c0 - along_v * ww / 2 + UP * wh]
                    self.intact += map_region(q, "window_single", col=ecol, tint=blk.tint, tag="wall")
        pts = [p for p in front + back]
        self.solids.append(np.array([*pts], float))
        return zr

    def _roof_trim(self, front, back, along, blk, o, board=0.22):
        """Verge boards along the gable edges, a fascia under each eave and the soffits under
        the gable overhangs, so the roof has an edge and no hole from below."""
        trim = "#f2efe8"
        F = [np.array(p, float) for p in front]
        B = [np.array(p, float) for p in back]
        down = np.array([0.0, 0.0, -board])
        # eave fascias: the low edges F[0]-F[1] and B[0]-B[1]
        for e0, e1 in ((F[0], F[1]), (B[0], B[1])):
            self.intact += plain([e0 + down, e1 + down, e1, e0], trim)
        # verges: the sloped edges at both gable ends, outward along the ridge
        ax = np.array([1.0, 0, 0]) if along == "x" else np.array([0, 1.0, 0])
        for eave, ridge in ((F[0], F[3]), (F[1], F[2]), (B[1], B[2]), (B[0], B[3])):
            out = ax if (eave @ ax) > (blk.cx if along == "x" else blk.cy) else -ax
            q = [eave + down, ridge + down, ridge, eave]
            f = Face(q)
            if f.normal @ out < 0:
                q = [ridge + down, eave + down, eave, ridge]
            self.intact += plain(q, trim)

    def hip(self, blk: Block, rise: float, *, overhang=style.EAVE, roof="tile_red") -> float:
        """A hipped roof: four slopes. Returns the top height."""
        o = overhang
        z0, zr = blk.z1, blk.z1 + rise
        x0, x1, y0, y1 = blk.x0 - o, blk.x1 + o, blk.y0 - o, blk.y1 + o
        drop = rise * o / (min(blk.w, blk.d) / 2)
        ze = z0 - drop
        half = min(x1 - x0, y1 - y0) / 2
        if x1 - x0 >= y1 - y0:
            ra, rb = (x0 + half, (y0 + y1) / 2, zr), (x1 - half, (y0 + y1) / 2, zr)
            faces = [[(x0, y0, ze), (x1, y0, ze), rb, ra], [(x1, y1, ze), (x0, y1, ze), ra, rb],
                     [(x1, y0, ze), (x1, y1, ze), rb], [(x0, y1, ze), (x0, y0, ze), ra]]
        else:
            ra, rb = ((x0 + x1) / 2, y0 + half, zr), ((x0 + x1) / 2, y1 - half, zr)
            faces = [[(x1, y0, ze), (x1, y1, ze), rb, ra], [(x0, y1, ze), (x0, y0, ze), ra, rb],
                     [(x0, y0, ze), (x1, y0, ze), ra], [(x1, y1, ze), (x0, y1, ze), rb]]
        for f in faces:
            self.intact += map_region(f, roof, tag="roof")
        self.intact += plain([(x0, y1, ze), (x1, y1, ze), (x1, y0, ze), (x0, y0, ze)], "#6a6660", tag="detail")
        self.solids.append(np.array([p for f in faces for p in f], float))
        return zr

    def shed(self, blk: Block, rise: float, *, high: str = "back", overhang=style.EAVE, roof="tile_red",
             end_region=None) -> float:
        """A mono-pitch (lean-to) roof rising toward the `high` side ("front", "back", "left",
        "right"), overhanging the low eave. Returns the top height."""
        end_region = end_region or ("plaster_plain" if atlas.region(blk.upper).tint else _plain_of(blk.upper))
        er = atlas.region(end_region)
        ecol = blk.tone if er.tint and blk.tint else (1, 1, 1)
        z0, zt = blk.z1, blk.z1 + rise
        x0, x1, y0, y1 = blk.x0, blk.x1, blk.y0, blk.y1
        o = overhang
        if high in ("back", "front"):
            run = y1 - y0
            dz = rise * o / run
            if high == "back":
                slope = [(x0 - o, y0 - o, z0 - dz), (x1 + o, y0 - o, z0 - dz), (x1 + o, y1, zt), (x0 - o, y1, zt)]
                tall = [(x1, y1, z0), (x0, y1, z0), (x0, y1, zt), (x1, y1, zt)]
                tris = [[(x1, y0, z0), (x1, y1, z0), (x1, y1, zt)], [(x0, y1, z0), (x0, y0, z0), (x0, y1, zt)]]
            else:
                slope = [(x0 - o, y0, zt), (x1 + o, y0, zt), (x1 + o, y1 + o, z0 - dz), (x0 - o, y1 + o, z0 - dz)]
                tall = [(x0, y0, z0), (x1, y0, z0), (x1, y0, zt), (x0, y0, zt)]
                tris = [[(x1, y0, z0), (x1, y1, z0), (x1, y0, zt)], [(x0, y1, z0), (x0, y0, z0), (x0, y0, zt)]]
        else:
            run = x1 - x0
            dz = rise * o / run
            if high == "left":
                slope = [(x0 - o, y0 - o, z0 - dz), (x1, y0 - o, zt), (x1, y1 + o, zt), (x0 - o, y1 + o, z0 - dz)]
                tall = [(x1, y0, z0), (x1, y1, z0), (x1, y1, zt), (x1, y0, zt)]
                tris = [[(x0, y0, z0), (x1, y0, z0), (x1, y0, zt)], [(x1, y1, z0), (x0, y1, z0), (x1, y1, zt)]]
            else:
                slope = [(x0, y0 - o, zt), (x1 + o, y0 - o, z0 - dz), (x1 + o, y1 + o, z0 - dz), (x0, y1 + o, zt)]
                tall = [(x0, y1, z0), (x0, y0, z0), (x0, y0, zt), (x0, y1, zt)]
                tris = [[(x0, y0, z0), (x1, y0, z0), (x0, y0, zt)], [(x1, y1, z0), (x0, y1, z0), (x0, y1, zt)]]
        self.intact += map_region(slope, roof, tag="roof")
        self.intact += map_region(tall, end_region, col=ecol, tint=blk.tint and er.tint, tag="wall")
        for t in tris:
            self.intact += map_region(t, end_region, col=ecol, tint=blk.tint and er.tint, tag="wall")
        # underside (a lowered, reversed copy) and boards on the three free edges
        S = [np.array(p, float) for p in slope]
        down = np.array([0.0, 0.0, -0.22])
        self.intact += plain([p + down for p in reversed(S)], "#8a8478", tag="underside")
        c = np.mean(S, axis=0)
        for k in range(4):
            e0, e1 = S[k], S[(k + 1) % 4]
            if abs(e0[2] - zt) < 1e-6 and abs(e1[2] - zt) < 1e-6:
                continue                                  # the high edge sits against the wall
            q = [e0 + down, e1 + down, e1, e0]
            mid = (e0 + e1) / 2
            f = Face(q)
            out = mid - c
            out[2] = 0
            if f.normal @ out < 0:
                q = [e1 + down, e0 + down, e0, e1]
            self.intact += plain(q, "#f2efe8", tag="detail")
        self.solids.append(np.array(slope + tall, float))
        return zt

    def sawtooth(self, blk: Block, teeth: int, rise: float, *, roof="metal", glass="glass_roof",
                 end_region=None) -> float:
        """North-light roof: `teeth` slopes rising toward the back, each with a glazed vertical
        face looking back (+y). Gable-end triangles take `end_region`."""
        end_region = end_region or _plain_of(blk.upper)
        z0 = blk.z1
        step = blk.d / teeth
        pts = []
        for k in range(teeth):
            ya, yb = blk.y0 + k * step, blk.y0 + (k + 1) * step
            slope = [(blk.x0, ya, z0), (blk.x1, ya, z0), (blk.x1, yb, z0 + rise), (blk.x0, yb, z0 + rise)]
            self.intact += map_region(slope, roof, tag="roof")
            glazing = [(blk.x1, yb, z0), (blk.x0, yb, z0), (blk.x0, yb, z0 + rise), (blk.x1, yb, z0 + rise)]
            self.intact += map_region(glazing, glass, tag="roof", unit=(atlas.region(glass).w * style.PX,
                                                                          atlas.region(glass).h * style.PX))
            for tri in ([(blk.x1, ya, z0), (blk.x1, yb, z0), (blk.x1, yb, z0 + rise)],
                        [(blk.x0, yb, z0), (blk.x0, ya, z0), (blk.x0, yb, z0 + rise)]):
                self.intact += map_region(tri, end_region, tag="wall", origin=(0, 0, z0))
            self.solids.append(np.array(slope + [(blk.x0, yb, z0), (blk.x1, yb, z0)], float))
        return z0 + rise

    # ---- parts -------------------------------------------------------------------------
    def box(self, lo, hi, *, color="#d8d2c4", region=None, top=None, bottom=False, tag="detail",
            solid=False, tint=False, tone=None) -> Mesh:
        """An axis-aligned box from corner lo to hi. Sides use `region` (or a flat color),
        the top `top` (default: same as the sides). No bottom unless asked. `tone` multiplies a
        region's picture (orange containers from the grey metal, a white tank...)."""
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        quads = {
            "front": [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
            "left": [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
            "back": [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
            "right": [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
            "top": [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
        }
        if bottom:
            quads["bottom"] = [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)]
        m = Mesh()
        for k, q in quads.items():
            reg = (top if top is not None else region) if k == "top" else region
            if reg:
                r = atlas.region(reg)
                col = self.tone if (tint and r.tint) else (hex_rgb(tone) if tone else (1, 1, 1))
                if r.kind == "swatch" and not tone:
                    col = (1, 1, 1)
                m += map_region(q, reg, col=col, tint=tint and r.tint, tag=tag)
            else:
                m += plain(q, color, tag=tag)
        self.intact += m
        if solid:
            self.solids.append(_box_pts(x0, x1, y0, y1, z0, z1))
        return m

    def prism(self, center, radius, z0, z1, *, n=8, radius_top=None, color="#d8d2c4", region=None,
              top="white", top_color=None, tag="detail", solid=False, phase=None, tone=None) -> Mesh:
        """An upright n-sided prism (tanks, drums, columns), or a taper with radius_top."""
        cx, cy = center
        rt = radius if radius_top is None else radius_top
        ph = math.pi / n if phase is None else phase
        ring = [(math.cos(ph + 2 * math.pi * k / n), math.sin(ph + 2 * math.pi * k / n)) for k in range(n)]
        m = Mesh()
        circumference = 2 * math.pi * radius
        for k in range(n):
            a, b = ring[k], ring[(k + 1) % n]
            q = [(cx + a[0] * radius, cy + a[1] * radius, z0), (cx + b[0] * radius, cy + b[1] * radius, z0),
                 (cx + b[0] * rt, cy + b[1] * rt, z1), (cx + a[0] * rt, cy + a[1] * rt, z1)]
            if region:
                m += map_region(q, region, tag=tag, col=hex_rgb(tone) if tone else (1, 1, 1))
            else:
                m += plain(q, color, tag=tag)
        if rt > 1e-6 and top:
            capp = [(cx + a[0] * rt, cy + a[1] * rt, z1) for a in ring]
            m += plain(capp, top_color or color, tag=tag) if top == "white" else map_region(capp, top, tag=tag)
        self.intact += m
        if solid:
            self.solids.append(np.array([p for f in m.faces for p in f.pts], float))
        _ = circumference
        return m

    def cone(self, center, radius, z0, z1, *, n=8, color="#c25a3e", region=None, tag="roof", phase=None) -> Mesh:
        cx, cy = center
        ph = math.pi / n if phase is None else phase
        ring = [(cx + radius * math.cos(ph + 2 * math.pi * k / n), cy + radius * math.sin(ph + 2 * math.pi * k / n), z0)
                for k in range(n)]
        m = Mesh()
        for k in range(n):
            tri = [ring[k], ring[(k + 1) % n], (cx, cy, z1)]
            m += map_region(tri, region, tag=tag) if region else plain(tri, color, tag=tag)
        self.intact += m
        return m

    def dome(self, center, radius, z0, *, height=None, n=8, rings=3, region="copper", tag="roof") -> Mesh:
        """A faceted dome (n sides, `rings` bands) sitting on z0."""
        cx, cy = center
        h = height or radius
        m = Mesh()
        prof = [(radius * math.cos(math.pi / 2 * k / rings), z0 + h * math.sin(math.pi / 2 * k / rings))
                for k in range(rings + 1)]
        for j in range(rings):
            (r0, za), (r1, zb) = prof[j], prof[j + 1]
            for k in range(n):
                a0 = 2 * math.pi * k / n
                a1 = 2 * math.pi * (k + 1) / n
                p = [(cx + r0 * math.cos(a0), cy + r0 * math.sin(a0), za), (cx + r0 * math.cos(a1), cy + r0 * math.sin(a1), za),
                     (cx + r1 * math.cos(a1), cy + r1 * math.sin(a1), zb), (cx + r1 * math.cos(a0), cy + r1 * math.sin(a0), zb)]
                m += map_region(p, region, tag=tag)
        self.intact += m
        self.solids.append(np.array([p for f in m.faces for p in f.pts], float))
        return m

    def chimney(self, x, y, z0, z1, w=0.9, d=0.7, region="brick_plain") -> Mesh:
        m = self.box((x - w / 2, y - d / 2, z0), (x + w / 2, y + d / 2, z1), region=region, top="dark")
        return m

    def roof_box(self, x, y, z, w, d, h, region="vent", top="white", color="#c9ccd2") -> Mesh:
        """Plant rooms, AC boxes, stair huts on a flat roof."""
        return self.box((x - w / 2, y - d / 2, z), (x + w / 2, y + d / 2, z + h), region=region, top=top,
                        color=color)

    def water_tank(self, x, y, z, r=1.6, h=2.6, legs=1.6) -> None:
        """A wooden water tank on legs, for apartment roofs."""
        for sx in (-1, 1):
            for sy in (-1, 1):
                lx, ly = x + sx * r * 0.6, y + sy * r * 0.6
                self.box((lx - 0.12, ly - 0.12, z), (lx + 0.12, ly + 0.12, z + legs), color="#4a4e58", top=None)
        self.prism((x, y), r, z + legs, z + legs + h, n=8, region="staves", top="white", top_color="#4a4e58")
        self.cone((x, y), r * 1.05, z + legs + h, z + legs + h + r * 0.6, n=8, color="#4a4e58")

    def antenna(self, x, y, z0, z1, beacon=True, r=0.15) -> None:
        self.prism((x, y), r, z0, z1 - (0.5 if beacon else 0), n=4, color="#c9ccd2", top=None)
        if beacon:
            self.box((x - 0.3, y - 0.3, z1 - 0.5), (x + 0.3, y + 0.3, z1), region="beacon")

    def door(self, blk: Block, side: str, x: float = 0.0, kind: str = "door_red", z: float | None = None,
             size=None) -> None:
        """A door picture on a wall, `x` meters from the wall's middle (seen from outside)."""
        if kind in BAY_DOORS and size is None:
            # a house door replaces one whole window bay: snap to the bay, take its size
            a, b, _ = blk.side(side)
            length = math.dist(a, b)
            nb = max(1, round(length / style.BAY))
            bw = length / nb
            k = min(nb - 1, max(0, int(math.floor((x + length / 2) / bw))))
            x = -length / 2 + (k + 0.5) * bw
            ns = max(1, round(blk.h / style.STOREY))
            self.decal(blk, side, x, blk.z0 if z is None else z, bw, blk.h / ns, kind, offset=0.02, tint=blk.tint)
            return
        size = size or {"door_double": style.DOOR_DOUBLE, "door_garage": style.DOOR_GARAGE,
                        "door_roller": style.DOOR_ROLLER}.get(kind, style.DOOR)
        a, b, _ = blk.side(side)
        room = math.dist(a, b) - 0.3
        if size[0] > room:                       # never wider than the wall it sits on
            size = (room, size[1] * room / size[0])
        self.decal(blk, side, x, blk.z0 if z is None else z, size[0], size[1], kind)

    def decal(self, blk: Block, side: str, x: float, z: float, w: float, h: float, region: str,
              offset: float = 0.04, tint=False) -> None:
        """A picture laid flat on a wall (doors, signs, a single window)."""
        a, b, n = blk.side(side)
        a, b = np.array([*a, 0.0]), np.array([*b, 0.0])
        n = np.array([*n, 0.0])
        t = (b - a) / np.linalg.norm(b - a)
        c = (a + b) / 2 + t * x + n * offset
        q = [c - t * w / 2 + UP * z, c + t * w / 2 + UP * z, c + t * w / 2 + UP * (z + h), c - t * w / 2 + UP * (z + h)]
        col = blk.tone if (tint and atlas.region(region).tint) else (1, 1, 1)
        self.intact += map_region(q, region, col=col, tint=tint and atlas.region(region).tint, tag="detail")

    def sign(self, blk: Block, side: str, picture: str, x: float = 0.0, z: float | None = None,
             height: float = 1.6, blade: bool = False) -> None:
        """A picture sign (style.SIGNS / atlas SIGNS: "cup", "fish", ...): flat on the fascia, or
        a blade sign sticking out from the wall, readable from up and down the street."""
        region = f"sign_{picture}"
        w = height * 2
        if z is None:
            z = blk.z0 + style.GROUND - style.SIGN_BAND + 0.05
        if not blade:
            self.decal(blk, side, x, z, w, height, region, offset=0.08)
            return
        a, b, n = blk.side(side)
        a, b, n = np.array([*a, 0.0]), np.array([*b, 0.0]), np.array([*n, 0.0])
        t = (b - a) / np.linalg.norm(b - a)
        base = (a + b) / 2 + t * x
        bw = height * 2 * 0.6
        p0 = base + n * 0.2 + UP * z
        p1 = base + n * (0.2 + bw) + UP * z
        q1 = [p1, p0, p0 + UP * height * 0.6, p1 + UP * height * 0.6]
        q2 = [p0, p1, p1 + UP * height * 0.6, p0 + UP * height * 0.6]
        self.intact += map_region(q1, region, tag="detail")
        self.intact += map_region(q2, region, tag="detail")

    def awning(self, blk: Block, side: str, x0: float, x1: float, *, z: float | None = None, depth=1.5,
               drop=0.7, stripes="awning_red") -> None:
        """A canvas awning over a shopfront, from x0 to x1 along the wall (from its middle)."""
        a, b, n = blk.side(side)
        a, b, n = np.array([*a, 0.0]), np.array([*b, 0.0]), np.array([*n, 0.0])
        t = (b - a) / np.linalg.norm(b - a)
        mid = (a + b) / 2
        z = blk.z0 + style.GROUND - style.SIGN_BAND - 0.15 if z is None else z
        w0 = mid + t * x0 + UP * z
        w1 = mid + t * x1 + UP * z
        f0 = w0 + n * depth - UP * drop
        f1 = w1 + n * depth - UP * drop
        val = 0.35
        self.intact += map_region([f0, f1, w1, w0], stripes, tag="detail")
        self.intact += map_region([f0 - UP * val, f1 - UP * val, f1, f0], stripes, tag="detail",
                                  origin=f0 - UP * val)
        self.intact += plain([w0, f0 - UP * val, f0], "#e8e4da", tag="detail")
        self.intact += plain([w1, f1, f1 - UP * val], "#e8e4da", tag="detail")
        self.intact += plain([w0, w1, f1 - UP * val, f0 - UP * val], "#8a8478", tag="detail")

    def balconies(self, blk: Block, side: str, storeys, *, x0=None, x1=None, rail="rail_metal",
                  first_floor=None, storey=style.STOREY, depth=style.BALCONY_DEPTH) -> None:
        """A balcony band (slab and railing) on each listed storey (1 = first floor above the
        ground storey), from x0 to x1 along the wall (default: the whole wall less 0.6 m)."""
        a, b, n = blk.side(side)
        a, b, n = np.array([*a, 0.0]), np.array([*b, 0.0]), np.array([*n, 0.0])
        length = float(np.linalg.norm(b - a))
        t = (b - a) / length
        mid = (a + b) / 2
        x0 = -length / 2 + 0.6 if x0 is None else x0
        x1 = length / 2 - 0.6 if x1 is None else x1
        base = blk.z0 + (style.GROUND if first_floor is None else first_floor)
        for s in storeys:
            z = base + (s - 1) * storey
            p0, p1 = mid + t * x0 + UP * z, mid + t * x1 + UP * z
            q0, q1 = p0 + n * depth, p1 + n * depth
            slab = 0.2
            self.intact += plain([q0, q1, p1, p0], "#ebe8e0", tag="detail")                    # floor
            self.intact += plain([p0 - UP * slab, p1 - UP * slab, q1 - UP * slab, q0 - UP * slab], "#9a968c", tag="detail")
            self.intact += plain([q0 - UP * slab, q1 - UP * slab, q1, q0], "#f2efe8", tag="detail")  # slab edge
            rh = style.RAIL
            self.intact += map_region([q0, q1, q1 + UP * rh, q0 + UP * rh], rail, tag="detail")
            self.intact += map_region([q1, q0, q0 + UP * rh, q1 + UP * rh], rail, tag="detail")   # seen from inside
            for e0, e1 in ((p0, q0), (q1, p1)):
                self.intact += plain([e0, e1, e1 + UP * rh, e0 + UP * rh], "#3a3f4a", tag="detail")

    def beam(self, p0, p1, width=0.4, depth=None, *, color="#c5553d", region=None, tag="detail") -> Mesh:
        """A square bar between two points: girders, crane booms, lattice members, legs."""
        p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
        d = p1 - p0
        d /= np.linalg.norm(d)
        a = np.cross(d, UP)
        if np.linalg.norm(a) < 1e-6:
            a = np.array([1.0, 0.0, 0.0])
        a /= np.linalg.norm(a)
        bvec = np.cross(a, d)
        hw, hd = width / 2, (depth or width) / 2
        ring = [a * hw + bvec * hd, -a * hw + bvec * hd, -a * hw - bvec * hd, a * hw - bvec * hd]
        m = Mesh()
        for k in range(4):
            q = [p0 + ring[k], p0 + ring[(k + 1) % 4], p1 + ring[(k + 1) % 4], p1 + ring[k]]
            if Face(q).normal @ (ring[k] + ring[(k + 1) % 4]) < 0:
                q.reverse()
            m += map_region(q, region, tag=tag) if region else plain(q, color, tag=tag)
        for end, sgn in ((p1, 1.0), (p0, -1.0)):
            q = [end + r for r in ring]
            if Face(q).normal @ (d * sgn) < 0:
                q.reverse()
            m += plain(q, color, tag=tag)
        self.intact += m
        return m

    def upturns(self, blk: Block, z: float, *, overhang=style.EAVE, lift=0.8, color="#c4552d") -> None:
        """Turned-up roof corners (shrines, the temple): a small two-sided horn at each eave
        corner of a hipped roof, rising `lift` meters."""
        o = overhang
        for sx in (-1, 1):
            for sy in (-1, 1):
                cx = blk.cx + sx * (blk.w / 2 + o)
                cy = blk.cy + sy * (blk.d / 2 + o)
                tip = np.array([cx + sx * 0.35, cy + sy * 0.35, z + lift])
                a = np.array([cx - sx * 1.2, cy, z])
                bb = np.array([cx, cy - sy * 1.2, z])
                c0 = np.array([cx, cy, z])
                for tri in ([a, c0, tip], [c0, bb, tip]):
                    self.intact += plain(tri, color)
                    self.intact += plain(list(reversed(tri)), color)

    def add(self, mesh: Mesh, solid: bool = False) -> Mesh:
        self.intact += mesh
        if solid:
            self.solids.append(mesh.points())
        return mesh

    # ---- checks ------------------------------------------------------------------------
    def fit(self) -> list[str]:
        """Problems with the intact model against the archetype box (empty list = fits)."""
        lo, hi = self.intact.bounds()
        size = hi - lo
        out = []
        for label, got, want in (("width", size[0], self.W), ("depth", size[1], self.D), ("height", size[2], self.H)):
            tol = style.fit_tolerance(want)
            if abs(got - want) > tol:
                out.append(f"{label} {got:.2f} m, archetype {want:g} m (tolerance {tol:.2f} m)")
        cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
        if abs(cx) > style.FIT_TOL_ABS or abs(cy) > style.FIT_TOL_ABS:
            out.append(f"footprint is off-center by ({cx:.2f}, {cy:.2f}) m")
        if abs(lo[2]) > 0.02:
            out.append(f"lowest point is z = {lo[2]:.2f} m, must be 0")
        return out


def _box_pts(x0, x1, y0, y1, z0, z1):
    return np.array([(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], float)


def _plain_of(region: str) -> str:
    """The window-less wall that goes with a facade."""
    return {"plaster_sash": "plaster_plain", "clapboard": "plaster_plain", "brick_sash": "brick_plain",
            "brick_works": "brick_plain", "metal_clad": "metal_plain", "strip_concrete": "concrete_plain",
            "stone_grid": "concrete_plain"}.get(region, "concrete_plain")


# =========================================================================================
# export
# =========================================================================================
def to_geo(mesh: Mesh):
    import mb
    from .geom import white_uv
    g = mb.Geo()
    for f in mesh.faces:
        uv = f.uv if f.uv else white_uv(len(f.pts))
        g.face([tuple(p) for p in f.pts], color=tuple(f.col), mat="city_atlas", uv=uv)
    return g


def make_node(name: str, mesh: Mesh, pivot=(0.0, 0.0, 0.0)):
    """Create the node and write the tint mask (COLOR_0 alpha) per face."""
    import mb
    g = to_geo(mesh)
    if len(g.f) != len(mesh.faces):
        # faces that collapsed while building the Geo: drop their flags to keep order
        kept = [f for f in mesh.faces if len(f.pts) >= 3]
        mesh = Mesh(kept)
    ob = mb.node(name, g, pivot=pivot)
    colors = ob.data.color_attributes[mb.COLOR_ATTR]
    flags = [1.0 if f.tint else 0.0 for f in mesh.faces]
    if len(flags) == len(ob.data.polygons):
        for poly in ob.data.polygons:
            a = flags[poly.index]
            for li in poly.loop_indices:
                c = colors.data[li].color
                colors.data[li].color = (c[0], c[1], c[2], a)
    return ob


# =========================================================================================
# registration and the family runner
# =========================================================================================
REGISTRY: dict[str, dict] = {}


def building(aid: str, district: str = "suburb", tone: str | None = None, seed: int = 1, **opts):
    """Register a building function for an archetype id. The function receives a Building
    and adds the intact parts; the kit derives the other states and exports the file."""
    import mb
    from . import destruct

    def deco(fn):
        mid = model_id(aid)

        def build():
            b = Building(aid, district=district, tone=tone, seed=seed)
            fn(b)
            problems = b.fit()
            if problems:
                raise RuntimeError(f"{mid}: the intact model does not fill its archetype box: " + "; ".join(problems))
            states = destruct.derive(b)
            make_node("intact", b.intact)
            make_node("damaged", states.damaged)
            make_node("rubble", states.rubble)
            for i, ch in enumerate(states.chunks):
                lo, hi = ch.bounds()
                make_node(f"chunk_{i:02d}", ch, pivot=tuple((lo + hi) / 2))
            REGISTRY[mid]["last"] = dict(tris=b.intact.tris, damaged=states.damaged.tris,
                                         rubble=states.rubble.tris, chunks=[c.tris for c in states.chunks])
        kind = "landmark" if archetype(aid).get("landmark") else "structure"
        REGISTRY[mid] = dict(id=aid, district=district, tone=tone, fn=fn, opts=opts,
                             tint=[style.TONES[t] for t in style.DISTRICTS[district]["walls"]],
                             base=tone)
        mb.asset(mid, kind=kind, concept=False)(build)
        return fn
    return deco


def run_family(family: str, argv=None) -> int:
    """Build the registered buildings with the pipeline (export, validate, manifest), then
    add the kit's own steps: the tint entry in the manifest, the city check and the city
    contact sheet (docs/art/previews/<model>.png). Same command line as mb.run_family."""
    import mb
    from . import check, sheet

    argv = list(sys.argv[1:] if argv is None else argv)
    no_previews = "--no-previews" in argv or bool(os.environ.get("MB_NO_PREVIEWS"))
    force = "--force" in argv or bool(os.environ.get("MB_FORCE"))
    if "--list" in argv:
        return mb.run_family(family, argv)
    passthrough = [a for a in argv if a not in ("--force",)]
    if "--no-previews" not in passthrough:
        passthrough.append("--no-previews")       # the kit renders its own sheet below
    rc = mb.run_family(family, passthrough)
    only = set()
    if "--only" in argv:
        only = {s.strip() for s in argv[argv.index("--only") + 1].split(",") if s.strip()}
    built = [m for m in REGISTRY if not only or m in only]
    # manifest: add the tint entry the client needs for per-building wall colors
    import json
    path = os.path.join(atlas.REPO, "client", "public", "assets", f"manifest.{family}.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for mid in built:
        entry = data.get("models", {}).get(mid)
        if entry is None:
            continue
        reg = REGISTRY[mid]
        b = Building(reg["id"], district=reg["district"], tone=reg["tone"])
        entry["tint"] = {
            "part": "wall plaster",
            "mask": "COLOR_0 alpha: 1 = wall that takes the building's color, 0 = never tint",
            "blend": "multiply",
            "base": _hex(b.tone),
            "colors": reg["tint"],
            "hint": "multiply masked faces by color / base (per channel): the wall then shows the color",
        }
        entry["district"] = reg["district"]
    m = mb.Manifest(family)
    m.data = data
    m.write()
    bad = 0
    for mid in built:
        rep = check.check_model(mid)
        print(rep.format())
        bad += 0 if rep.ok else 1
        if not no_previews:
            sheet.city_sheet(mid, force=force)
    if bad:
        print(f"  CITY CHECK FAILED for {bad} model(s)")
    return rc or (1 if bad else 0)


def _hex(c) -> str:
    return "#" + "".join(f"{int(round(x * 255)):02x}" for x in c)
