#!/opt/mbtools/venv/bin/python
# mb-family: city_blocks
"""Port Meridian's blocks: apartments, offices, the campus hall and the downtown towers.

    bld_apartment_a  brick walk-up, balcony stack, water tank and stair hut on the roof
    bld_apartment_b  white seafront block: balcony bands, roof terrace, pool and sun deck
    bld_apartment_c  concrete slab on front pillars, ribbon windows, glass stair tower
    bld_office_a     stone office, cornice, two-storey setback, plant room
    bld_office_b     teal glass slab with stone ends, setback top under a floating roof
    bld_office_c     dark glass and stone piers, copper pyramid crown with four pinnacles
    bld_campus_a     long lecture / pilgrim hall: arcade, slate roof, entrance pavilion, lantern
    bld_tower_b      chamfered blue glass tower, three stepped tiers, glowing lantern, mast
    bld_tower_c      notched dark glass tower with a steep slanted roof edged in light

Built from the city kit's parts (tools/art/city/README.md). The damaged, rubble and chunk
states come from the kit's one generator; this file only sets hints (bite position, seed).
Seeds are chosen so that the kit's bites (the missing corner and the wall holes) never
overlap (overlapping bites leave inside faces of one bite showing in the other) and so that
one hole opens on the street front.
Parts the kit does not have are the small helpers below (polygon walls, cheap balconies,
pillars, a light water tank, sloped walls); they use only the shared atlas.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from city import atlas, kit, style  # noqa: E402
from city.geom import map_region, plain  # noqa: E402

UP = np.array([0.0, 0.0, 1.0])
STONE = "#e6dfcf"        # pale stone trim (fins, piers, slab edges)
STEEL = "#4a4e58"
LIGHT = "#ebe8e0"


# ==== helpers the kit does not have ==========================================================
def ring_walls(b, poly, z0, z1, region, *, tint=False, tone=None, tag="wall", plain_col=None):
    """Walls round a convex plan polygon (counter-clockwise seen from above), z0 to z1.
    Facades stretch to whole bays like Building.wall. plain_col: flat-colored walls instead."""
    n = len(poly)
    for i in range(n):
        p0, p1 = poly[i], poly[(i + 1) % n]
        if plain_col:
            b.intact += plain([(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z1), (p0[0], p0[1], z1)],
                              plain_col, tag=tag)
        else:
            b.wall(p0, p1, z0, z1, region, tint=tint, tone=tone, tag=tag)


def cap(b, poly, z, region="gravel", col=None, tag="roof"):
    pts = [(p[0], p[1], z) for p in poly]
    if col:
        b.intact += plain(pts, col, tag=tag)
    else:
        b.intact += map_region(pts, region, tag=tag)


def solid_prism(b, poly, z0, z1):
    b.solids.append(np.array([(p[0], p[1], z) for p in poly for z in (z0, z1)], float))


def octagon(w, d, c, cx=0.0, cy=0.0):
    """Plan of a w x d rectangle with its corners chamfered by c (counter-clockwise)."""
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
    return [(x0 + c, y0), (x1 - c, y0), (x1, y0 + c), (x1, y1 - c), (x1 - c, y1), (x0 + c, y1), (x0, y1 - c),
            (x0, y0 + c)]


def rect(w, d, cx=0.0, cy=0.0):
    return [(cx - w / 2, cy - d / 2), (cx + w / 2, cy - d / 2), (cx + w / 2, cy + d / 2), (cx - w / 2, cy + d / 2)]


def banded(b, w, d, h, at, *, band=0.6, band_region="cornice", roof="tar", sides=None, **kw):
    """A flat-roofed block finished by a cornice band at the top of its walls, the roof on top
    of the band. Looks like a parapet from the street, but has no thin inner walls (the kit's
    parapet shows the back of its outer wall wherever a bite eats the inner one). Returns the
    Block with z1 at the roof surface."""
    import dataclasses
    blk = b.block(w, d, h, at=at, roof=False, sides=sides, solid=False, **kw)
    for name in kit.SIDES:
        if sides and name in sides and sides[name] is None:
            continue
        a, c, _n = blk.side(name)
        b.wall(a, c, blk.z1, blk.z1 + band, band_region)
    zt = blk.z1 + band
    poly = rect(w, d, at[0], at[1])
    cap(b, poly, zt, roof)
    solid_prism(b, poly, at[2], zt)
    return dataclasses.replace(blk, z1=zt, top=zt)


def balcony(b, blk, side, x0, x1, z, *, depth=style.BALCONY_DEPTH, rail="rail_metal", slab=0.22,
            floor=LIGHT, edge="#f4f2ec", two_sided=True):
    """A light balcony (14 triangles): floor, slab edge and ends, underside, a two-sided railing.
    Its faces are remembered as one group: when the damage takes any of them, it takes all."""
    first = len(b.intact.faces)
    a, c, n = blk.side(side)
    a, c, n = np.array([*a, 0.0]), np.array([*c, 0.0]), np.array([*n, 0.0])
    t = (c - a) / np.linalg.norm(c - a)
    mid = (a + c) / 2
    p0, p1 = mid + t * x0 + UP * z, mid + t * x1 + UP * z
    q0, q1 = p0 + n * depth, p1 + n * depth
    d = UP * slab
    rh = style.RAIL
    b.intact += plain([q0, q1, p1, p0], floor)
    b.intact += plain([q0 - d, q1 - d, q1, q0], edge)
    b.intact += plain([p0 - d, p1 - d, q1 - d, q0 - d], "#9a968c", tag="underside")
    rail_band(b, q0, q1, rail, two_sided=two_sided)
    # the two ends of the slab
    b.intact += plain([p0 - d, q0 - d, q0, p0], edge)
    b.intact += plain([q1 - d, p1 - d, p1, q1], edge)
    _group(b, b.intact.faces[first:])


def _key(f):
    return tuple(np.round(f.center, 2))


def _group(b, faces):
    """Faces that stand or fall together in the damaged state (balconies, thin parts)."""
    if not hasattr(b, "groups"):
        b.groups = []
        b.damage_hook = _damage_hook
    b.groups.append({_key(f) for f in faces})


def _drop_broken_groups(b, mesh):
    """Damage hook: a group that lost any face to a bite loses all of them (no floating ends)."""
    have = {_key(f) for f in mesh.faces}
    dead = set()
    for g in getattr(b, "groups", []):
        if not g <= have:
            dead |= g
    if dead:
        mesh.faces[:] = [f for f in mesh.faces if _key(f) not in dead]


def _reline_roofs(b, mesh):
    """Damage hook: the kit drops a pitched roof's whole underside when a bite opens it (so it
    is not seen from above), which leaves the slope's back showing through the broken gable.
    Give the remaining pieces of such a slope a lowered, reversed lining instead."""
    from city.geom import Face
    lost = []
    for f in b.intact.faces:
        if f.tag == "underside" and abs(f.normal[2]) < 0.99:
            k = _key(f)
            if not any(_key(g) == k for g in mesh.faces if g.tag == "underside"):
                lost.append(-f.normal)
    if not lost:
        return
    add = []
    for f in mesh.faces:
        if f.tag == "roof" and any(float(f.normal @ n) > 0.999 for n in lost):
            pts = [p - UP * 0.22 for p in reversed(f.pts)]
            add.append(plain(pts, "#8a8478", tag="interior"))
    mesh.faces.extend(add)
    _ = Face


def _damage_hook(b, mesh):
    _drop_broken_groups(b, mesh)
    _reline_roofs(b, mesh)


def rail_band(b, q0, q1, rail="rail_metal", rh=style.RAIL, two_sided=True):
    """A two-sided railing from q0 to q1 (ground points with z), one stretched picture each way."""
    q0, q1 = np.asarray(q0, float), np.asarray(q1, float)
    ln = float(np.linalg.norm(q1 - q0))
    r = atlas.region(rail)
    tile = r.w * style.PX
    reps = max(1, round(ln / tile))
    unit = (ln / reps, rh)
    b.intact += map_region([q0, q1, q1 + UP * rh, q0 + UP * rh], rail, tag="detail", unit=unit, origin=q0)
    if two_sided:
        # the back face sits 3 cm behind the front one, so the two never fight for the same pixels
        nrm = np.cross(q1 - q0, UP)
        nrm = nrm / np.linalg.norm(nrm) * 0.03
        q0b, q1b = q0 - nrm, q1 - nrm
        b.intact += map_region([q1b, q0b, q0b + UP * rh, q1b + UP * rh], rail, tag="detail", unit=unit, origin=q1b)


def pillar(b, x, y, z0, z1, s=0.8, col=STONE, solid=False):
    """A square column: four sides only (8 triangles)."""
    h = s / 2
    poly = rect(s, s, x, y)
    ring_walls(b, poly, z0, z1, None, plain_col=col, tag="detail")
    if solid:
        solid_prism(b, poly, z0, z1)


def slab(b, x0, y0, x1, y1, z, th, col=STONE, top="#c9c4b8", region=None, solid=False):
    """A thin flat slab with edges, top and underside (canopies, floating roofs)."""
    b.box((x0, y0, z), (x1, y1, z + th), color=col, top=region, bottom=False, solid=solid)
    if region is None:
        b.intact.faces[-1].col = tuple(int(top[i:i + 2], 16) / 255 for i in (1, 3, 5))
    b.intact += plain([(x0, y1, z), (x1, y1, z), (x1, y0, z), (x0, y0, z)], "#8a8478", tag="underside")


def water_tank(b, x, y, z, r=1.4, h=2.0, stand=1.0):
    """A light water tank: a steel stand, six staved sides, a conical lid (about 30 triangles)."""
    s = r * 0.8
    ring_walls(b, rect(2 * s, 2 * s, x, y), z, z + stand, None, plain_col=STEEL, tag="detail")
    b.prism((x, y), r, z + stand, z + stand + h, n=6, region="staves", top=None)
    b.cone((x, y), r * 1.08, z + stand + h, z + stand + h + r * 0.55, n=6, color=STEEL)
    return z + stand + h + r * 0.55


def sloped_wall(b, p0, p1, z0, zt0, zt1, region, *, unit=None, origin_z=None, plain_col=None, tag="wall"):
    """A wall from p0 to p1 whose top runs from zt0 (above p0) to zt1 (above p1)."""
    pts = [(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], zt1), (p0[0], p0[1], zt0)]
    if plain_col:
        b.intact += plain(pts, plain_col, tag=tag)
        return
    r = atlas.region(region)
    if unit is None:
        length = math.dist(p0, p1)
        nb = max(1, round(length / style.BAY))
        unit = (r.bays * length / nb, r.storeys * style.STOREY)
    b.intact += map_region(pts, region, tag=tag, unit=unit, origin=(p0[0], p0[1], origin_z if origin_z is not None else z0))


# ==== apartments =============================================================================
@kit.building("apartment_a", district="oldtown", tone="sand", seed=5)
def apartment_a(b):
    # A six-storey brick walk-up: plain brick flanks, a stack of balconies in the middle of
    # the front, a white stone entrance with a canopy; on the roof a water tank on its stand,
    # the stair hut and two chimney stacks. A brick stair wing at the back gives the roof an L.
    body = banded(b, 18.0, 10.4, 18.0, (0.0, -0.7, 0.0), facade="brick_sash", band=0.4, roof="tar")
    b.door(body, "front", x=0.0, kind="door_double")
    b.box((-2.1, body.y0 - 1.05, 3.0), (2.1, body.y0, 3.25), color=STONE, top="white", bottom=True)
    for s in range(2, 7):
        balcony(b, body, "front", -3.4, 3.4, (s - 1) * 3.0 + 0.0, depth=1.1)
    # back stair wing (blank brick with a tall window strip) rising one storey over the roof
    wing = b.block(6.0, 2.6, 20.0, at=(-4.5, body.y1 + 1.3, 0.0), facade="brick_plain",
                   sides={"front": None}, roof="tar")
    b.wall((wing.x0, wing.y0), (wing.x1, wing.y0), body.z1, wing.z1, "brick_plain")
    b.wall((wing.x1 - 1.5, wing.y1 + 0.05), (wing.x0 + 1.5, wing.y1 + 0.05), 3.0, 18.0, "glass_blue", tag="detail")
    # roof: water tank, chimneys
    top = water_tank(b, 5.0, 1.0, body.z1, r=1.2, h=1.1, stand=0.2)
    _ = top
    for x in (-7.8, 7.8):
        b.chimney(x, 3.9, body.z1, body.z1 + 1.5, w=1.2, d=0.8)
    b.bite_hint = (8.0, -6.0, 18.5)


@kit.building("apartment_b", district="boardwalk", tone="white", seed=10)
def apartment_b(b):
    # Eight storeys of white plaster, square: a balcony on every upper storey across the front
    # and the left (the sea side), a shop and cafe ground floor, and a roof terrace with a pool,
    # a sun-deck pavilion under a floating white roof (it reads as a seafront hotel).
    body = b.block(16.0, 14.8, 25.5, at=(0.0, 0.6, 0.0), facade="plaster_sash", ground="shopfront",
                   sides={"back": ("plaster_plain", "plaster_sash")}, parapet=0.0, roof="gravel")
    b.door(body, "front", x=0.0, kind="door_double")
    b.awning(body, "front", -6.5, -1.6, stripes="awning_blue", depth=1.2)
    b.awning(body, "front", 1.6, 6.5, stripes="awning_blue", depth=1.2)
    for s in range(2, 8):
        z = style.GROUND + (s - 1) * 3.0
        balcony(b, body, "front", -7.7, 7.7, z, rail="rail_glass")
    zr = body.z1
    # roof terrace: glass rail round the edge
    for side in ("front", "left", "back", "right"):
        a, c, n = body.side(side)
        rail_band(b, (a[0], a[1], zr), (c[0], c[1], zr), "rail_glass")
    # the pool (front left) with a white rim
    b.intact += plain([(-5.0, -5.0, zr + 0.04), (3.0, -5.0, zr + 0.04), (3.0, 0.4, zr + 0.04), (-5.0, 0.4, zr + 0.04)],
                      "#f4f2ec", tag="roof")
    b.intact += plain([(-4.5, -4.5, zr + 0.08), (2.5, -4.5, zr + 0.08), (2.5, -0.1, zr + 0.08), (-4.5, -0.1, zr + 0.08)],
                      "#5fc3e4", tag="roof")
    # the sun-deck pavilion at the back: glass box under a floating white roof
    pav = b.block(9.0, 4.5, 2.3, at=(0.0, 5.0, zr), facade="lobby", roof=False, solid=True)
    _ = pav
    slab(b, -6.2, 1.8, 6.2, 8.0, zr + 2.3, 0.2, col="#f4f2ec", top="#f4f2ec")
    b.bite_hint = (-8.0, -7.0, 26.0)


@kit.building("apartment_c", district="downtown", tone="concrete", seed=5)
def apartment_c(b):
    # A ten-storey concrete slab with ribbon windows, lifted on a row of pillars at the front
    # (a glass lobby set back under it), blank end walls, a glass stair tower on its right end
    # that rises above the roof, and lift rooms on the roof.
    zb = style.GROUND
    lobby = b.block(21.0, 10.0, zb, at=(1.5, 2.0, 0.0), facade="lobby", roof=False)
    b.door(lobby, "front", x=-3.0, kind="door_double")
    slabb = b.block(21.0, 13.3, 30.0, at=(1.5, 0.35, zb), facade="strip_concrete",
                    sides={"left": "concrete_plain", "right": "concrete_plain"})
    b.intact += plain([(slabb.x0, slabb.y1, zb), (slabb.x1, slabb.y1, zb), (slabb.x1, slabb.y0, zb),
                       (slabb.x0, slabb.y0, zb)], "#9a968c", tag="underside")
    for x in (-7.5, -1.5, 4.5, 10.5):
        pillar(b, x, -5.7, 0.0, zb, s=0.9, col="#cfcac0", solid=True)
    # the glass stair tower on the right end, running past the roof
    stair = b.block(3.0, 6.0, 36.0, at=(-10.5, 0.0, 0.0), facade="glass_blue",
                    sides={"left": None}, parapet=0.0, roof="tar")
    b.wall((stair.x1, stair.y0), (stair.x1, stair.y1), slabb.z1, stair.z1, "concrete_plain")
    # concrete fins down the front, one between every two window bays
    for x in (-6.0, 0.0, 6.0):
        x0 = 1.5 + x
        y0 = slabb.y0
        for side in (-1, 1):
            xa = x0 + side * 0.15
            q = [(xa, y0 - 0.7, zb), (xa, y0, zb), (xa, y0, slabb.z1), (xa, y0 - 0.7, slabb.z1)]
            if side < 0:
                q = [q[1], q[0], q[3], q[2]]
            b.intact += plain(q, "#cfcac0", tag="detail")
        b.intact += plain([(x0 - 0.15, y0 - 0.7, zb), (x0 + 0.15, y0 - 0.7, zb), (x0 + 0.15, y0 - 0.7, slabb.z1),
                           (x0 - 0.15, y0 - 0.7, slabb.z1)], "#dcd8ce", tag="detail")
        for z, up in ((slabb.z1, True), (zb, False)):
            q = [(x0 - 0.15, y0 - 0.7, z), (x0 + 0.15, y0 - 0.7, z), (x0 + 0.15, y0, z), (x0 - 0.15, y0, z)]
            b.intact += plain(q if up else list(reversed(q)), "#dcd8ce", tag="detail")
    # a glass stair window up the blank left end
    b.wall((slabb.x1 + 0.05, -1.5), (slabb.x1 + 0.05, 1.5), zb + 1.5, slabb.z1 - 1.5, "glass_blue", tag="detail")
    # lift rooms and vents on the roof
    zr = slabb.z1
    b.roof_box(6.0, 1.0, zr, 5.0, 4.0, 1.5, region="concrete_plain", top="white")
    b.roof_box(-2.5, 1.0, zr, 3.0, 4.0, 2.0, region="concrete_plain", top="white")
    b.roof_box(1.5, -3.5, zr, 2.0, 1.4, 1.0, region="vent", top="white")
    b.bite_hint = (11.0, -7.0, 34.0)


# ==== offices ================================================================================
@kit.building("office_a", district="downtown", tone="stone", seed=13)
def office_a(b):
    # Twelve storeys of pale stone in a stepped "wedding cake": a rusticated base and seven
    # storeys to a heavy cornice, three set-back storeys, one more set-back storey, and a
    # wooden water tank on a steel stand at the very top beside a plant room.
    base = banded(b, 20.0, 19.2, 25.5, (0, 0.4, 0), facade="stone_grid", ground="plinth", band=0.75,
                  roof="gravel")
    b.door(base, "front", x=0.0, kind="door_double")
    b.box((-3.0, -10.0, 3.4), (3.0, base.y0, 3.7), color="#3a4256", top="white", bottom=True)
    mid = banded(b, 15.0, 14.4, 9.0, (0, 0.4, base.z1), facade="stone_grid", band=0.5, roof="gravel")
    top = banded(b, 9.0, 9.0, 3.0, (0, 1.0, mid.z1), facade="stone_grid", band=0.4, roof="tar")
    b.roof_box(-4.6, 4.0, mid.z1, 3.2, 3.0, 1.8, region="metal_plain", top="white")
    water_tank(b, 1.2, 2.0, top.z1, r=1.6, h=1.7, stand=0.6)
    b.bite_hint = (-10.0, -10.0, 26.0)


@kit.building("office_b", district="downtown", tone="stone", seed=10)
def office_b(b):
    # A glass slab: teal glass on the long faces between blank stone end walls, a glass lobby,
    # and a top set back from the front under a floating roof on slim columns.
    zl = style.GROUND
    lob = b.block(21.0, 15.0, zl, at=(0, 1.5, 0), facade="lobby", roof=False)
    b.door(lob, "front", x=0.0, kind="door_double")
    b.intact += plain([(-10.5, 9.0, zl), (10.5, 9.0, zl), (10.5, -9.0, zl), (-10.5, -9.0, zl)], "#9a968c",
                      tag="underside")
    shaft = b.block(21.0, 18.0, 42.0, at=(0, 0, zl), facade="glass_teal",
                    sides={"left": None, "right": None}, roof="tar")
    # stone end walls stand proud of the glass
    for x in (-11.25, 11.25):
        b.box((x - 0.75, -9.0, 0.0), (x + 0.75, 9.0, 52.5), color=STONE, top="white", solid=True)
    for x, side in ((-12.0, "right"), (12.0, "left")):
        end = kit.Block(x - 0.0, x, -9.0, 9.0, 0.0, 52.5, "glass_teal", False, (1, 1, 1)) if x > 0 else \
            kit.Block(x, x + 0.0, -9.0, 9.0, 0.0, 52.5, "glass_teal", False, (1, 1, 1))
        a, c, nn = end.side(side)
        mid = ((a[0] + c[0]) / 2 + nn[0] * 0.04, (a[1] + c[1]) / 2)
        pa, pc = (mid[0], mid[1] + (-1.5 if x > 0 else 1.5)), (mid[0], mid[1] + (1.5 if x > 0 else -1.5))
        b.wall(pa, pc, style.GROUND + 1.5, 51.0, "glass_teal", tag="detail")
    top = b.block(21.0, 11.0, 6.0, at=(0, 3.5, shaft.z1), facade="glass_teal", roof="tar",
                  sides={"left": None, "right": None})
    # the floating roof over the terrace
    for x in (-9.0, 9.0):
        pillar(b, x, -8.0, shaft.z1, top.z1 + 2.0, s=0.5)
    slab(b, -12.0, -9.0, 12.0, 9.0, top.z1 + 2.0, 0.5, col="#f2efe8", top="#d8d4ca")
    b.roof_box(-4.0, 4.0, top.z1, 5.0, 4.0, 1.8, region="metal_plain", top="white")
    b.bite_hint = (12.0, -9.0, 50.0)


@kit.building("office_c", district="downtown", tone="stone", seed=12)
def office_c(b):
    # Twenty storeys: a stone base, a dark glass shaft held by four stone corner piers, and a
    # copper crown: a stone band, a steep pyramid with a beacon and a small pyramid on each pier.
    pod = banded(b, 22.0, 22.0, 10.5, (0, 0, 0), facade="stone_grid", ground="plinth", band=0.6,
                 roof="gravel")
    b.door(pod, "front", x=0.0, kind="door_double")
    shaft = b.block(16.0, 16.0, 48.0, at=(0, 0, pod.z1), facade="glass_dark", roof=None)
    band = b.block(16.0, 16.0, 1.5, at=(0, 0, shaft.z1), facade="cornice", roof=None)
    z1 = band.z1
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * 8.0, sy * 8.0
            pier = kit.Block(x - 1.5, x + 1.5, y - 1.5, y + 1.5, pod.z1, z1 + 1.5, "stone_grid", False, (1, 1, 1))
            outer = ["left" if sx > 0 else "right", "back" if sy > 0 else "front"]
            for side in ("front", "left", "back", "right"):
                a, c, _n = pier.side(side)
                if side in outer:
                    b.wall(a, c, pod.z1, z1 - 1.5, "stone_grid")
                    b.wall(a, c, z1 - 1.5, z1 + 1.5, "cornice")
                else:
                    b.wall(a, c, z1, z1 + 1.5, "cornice")
                    # the strip of this inner side that stands out past the glass shaft
                    a2, c2 = np.array(a, float), np.array(c, float)
                    k = 0 if abs(a2[0] - c2[0]) > 1e-6 else 1
                    edge = 8.0 * np.sign(a2[k] + c2[k])
                    lo_pt = a2.copy()
                    lo_pt[k] = edge
                    pa, pc = (lo_pt, c2) if abs(c2[k]) > abs(a2[k]) else (a2, lo_pt)
                    b.intact += plain([(pa[0], pa[1], pod.z1), (pc[0], pc[1], pod.z1), (pc[0], pc[1], z1),
                                       (pa[0], pa[1], z1)], "#d9d2c0", tag="wall")
            cap(b, rect(3.0, 3.0, x, y), z1 + 1.5, col="#d8d2c4")
            solid_prism(b, rect(3.0, 3.0, x, y), pod.z1, z1 + 1.5)
            b.cone((x, y), 2.1, z1 + 1.5, z1 + 5.0, n=4, region="copper", phase=math.pi / 4)
    b.cone((0, 0), 8.0 * math.sqrt(2) * 0.98, z1, 66.4, n=4, region="copper", phase=math.pi / 4)
    b.solids.append(np.array([(-8, -8, z1), (8, -8, z1), (8, 8, z1), (-8, 8, z1), (0, 0, 66.4)], float))
    b.antenna(0.0, 0.0, 66.0, 68.0, beacon=True, r=0.2)
    b.bite_hint = (9.5, -9.5, 62.0)


@kit.building("campus_a", district="university", tone="stone", seed=29)
def campus_a(b):
    # A long hall: arcade on the ground floor, two storeys of windows, a slate roof, an entrance
    # pavilion with its own gable on the front and a small lantern on the ridge.
    hall = b.block(43.25, 12.6, 9.0, at=(0, 1.325, 0), facade="plaster_sash", ground="arcade", roof=False)
    ridge = b.gable(hall, rise=4.1, along="x", roof="tile_slate")
    pav = b.block(10.5, 3.5, 9.0, at=(0, -6.0, 0), facade="plaster_sash", ground="arcade", roof=False,
                  sides={"back": None})
    b.gable(pav, rise=4.0, along="y", roof="tile_slate")
    b.door(pav, "front", x=0.0, kind="door_double")
    # the lantern on the ridge
    zr = ridge
    b.prism((0, hall.cy), 1.3, zr - 0.6, zr + 1.2, n=8, region="lobby", top=None)
    b.cone((0, hall.cy), 1.6, zr + 1.2, 16.0, n=8, region="copper")
    ring = [(1.6 * math.cos(math.pi / 8 + k * math.pi / 4), hall.cy + 1.6 * math.sin(math.pi / 8 + k * math.pi / 4),
             zr + 1.2) for k in range(8)]
    b.intact += plain(list(reversed(ring)), "#8a8478", tag="underside")
    for x in (-16.0, 16.0):
        b.chimney(x, hall.cy + 2.5, zr - 1.4, zr + 0.4, w=1.0, d=0.8, region="brick_plain")
    b.bite_hint = (-21.0, -6.0, 12.0)
    b.damage_hook = _damage_hook


# ==== towers =================================================================================
@kit.building("tower_b", district="downtown", tone="stone", seed=13)
def tower_b(b):
    # 130 m: a chamfered blue glass shaft on a chamfered stone base, three stepped tiers with
    # stone bands, a glowing lantern and a mast with a beacon.
    base = octagon(30.0, 30.0, 6.0)
    ring_walls(b, base, 0.0, style.GROUND, "lobby")
    ring_walls(b, base, style.GROUND, 6.0, "cornice")
    cap(b, base, 6.0, "gravel")
    solid_prism(b, base, 0.0, 6.0)
    shaft = octagon(27.0, 27.0, 7.0)
    zs = 6.0 + 28 * 3.0
    ring_walls(b, shaft, 6.0, zs, "glass_blue")
    ring_walls(b, shaft, zs, zs + 1.5, "cornice")
    cap(b, shaft, zs + 1.5, "tar")
    solid_prism(b, shaft, 6.0, zs + 1.5)
    # white stone trim folded round every corner of the shaft (one strip on each face)
    for k in range(8):
        p = np.array(shaft[k])
        for q in (np.array(shaft[k - 1]), np.array(shaft[(k + 1) % 8])):
            along = (q - p) / np.linalg.norm(q - p)
            nrm = np.array([along[1], -along[0]]) if q is not None else None
            # outward normal of the face p-q: the polygon is counter-clockwise
            e = p - q if np.allclose(q, shaft[k - 1]) else q - p
            e = e / np.linalg.norm(e)
            nrm = np.array([e[1], -e[0]])
            a = p + nrm * 0.06
            d = a + along * 0.55
            pts = [(a[0], a[1], 6.0), (d[0], d[1], 6.0), (d[0], d[1], zs), (a[0], a[1], zs)]
            if np.dot(np.cross(np.array(pts[1]) - np.array(pts[0]), UP)[:2], nrm) < 0:
                pts = [pts[1], pts[0], pts[3], pts[2]]
            b.intact += plain(pts, STONE, tag="detail")
    z = zs + 1.5
    for w, c, h in ((22.0, 5.5, 12.0), (16.0, 4.0, 9.0), (10.5, 2.8, 6.0)):
        tier = octagon(w, w, c)
        ring_walls(b, tier, z, z + h, "glass_blue")
        ring_walls(b, tier, z + h, z + h + 1.2, "cornice")
        cap(b, tier, z + h + 1.2, col="#7d828c")
        solid_prism(b, tier, z, z + h + 1.2)
        z += h + 1.2
    lant = octagon(6.0, 6.0, 1.8)
    ring_walls(b, lant, z, z + 3.2, "lit_glass")
    cap(b, lant, z + 3.2, col="#c9ccd2")
    solid_prism(b, lant, z, z + 3.2)
    z += 0.2
    b.antenna(0.0, 0.0, z + 3.0, 130.0, beacon=True, r=0.3)
    # entrance
    b.decal(kit.Block(-9, 9, -15, 15, 0, 6, "lobby", False, (1, 1, 1)), "front", 0.0, 0.0, 2.25, 2.625,
            "door_double")
    b.box((-5.0, -15.5, 3.4), (5.0, -15.0, 3.7), color="#3a4256", top="white", bottom=True)
    b.bite_hint = (-12.0, -12.0, 112.0)


@kit.building("tower_c", district="downtown", tone="stone", seed=10)
def tower_c(b):
    # 165 m, the tallest ordinary tower: dark glass on a notched square plan (white stone in
    # the notches), a steep roof slanting up from the street side to the back, its edges lit.
    W, n = 28.0, 3.0
    h = W / 2
    zf, zk = 120.0, 160.0            # slanted roof: front edge, back edge
    zl = style.GROUND

    def ztop(y):
        return zf + (y + h) / W * (zk - zf)

    poly = [(-h + n, -h), (h - n, -h), (h - n, -h + n), (h, -h + n), (h, h - n), (h - n, h - n), (h - n, h),
            (-h + n, h), (-h + n, h - n), (-h, h - n), (-h, -h + n), (-h + n, -h + n)]
    glass = atlas.region("glass_dark")
    for i in range(len(poly)):
        p0, p1 = poly[i], poly[(i + 1) % len(poly)]
        main = math.dist(p0, p1) > n + 0.1
        if main:
            b.wall(p0, p1, 0.0, zl, "lobby")
            length = math.dist(p0, p1)
            nb = round(length / style.BAY)
            sloped_wall(b, p0, p1, zl, ztop(p0[1]), ztop(p1[1]), "glass_dark",
                        unit=(glass.bays * length / nb, glass.storeys * style.STOREY), origin_z=zl)
        else:
            sloped_wall(b, p0, p1, 0.0, ztop(p0[1]), ztop(p1[1]), None, plain_col=STONE)
    # two plant floors: dark louvred bands across the glass at a third and two thirds
    for i in range(len(poly)):
        p0, p1 = poly[i], poly[(i + 1) % len(poly)]
        if math.dist(p0, p1) > n + 0.1:
            nx, ny = (p1[1] - p0[1]) / math.dist(p0, p1), -(p1[0] - p0[0]) / math.dist(p0, p1)
            q0 = (p0[0] + nx * 0.06, p0[1] + ny * 0.06)
            q1 = (p1[0] + nx * 0.06, p1[1] + ny * 0.06)
            for zb in (zl + 13 * 3.0, zl + 26 * 3.0):
                b.intact += plain([(q0[0], q0[1], zb), (q1[0], q1[1], zb), (q1[0], q1[1], zb + 2.2),
                                   (q0[0], q0[1], zb + 2.2)], "#b9b4a8", tag="detail")
    # the slanted roof in three convex pieces, dark glass
    pieces = [[(-h + n, -h), (h - n, -h), (h - n, h), (-h + n, h)],
              [(h - n, -h + n), (h, -h + n), (h, h - n), (h - n, h - n)],
              [(-h, -h + n), (-h + n, -h + n), (-h + n, h - n), (-h, h - n)]]
    for pc in pieces:
        pts = [(x, y, ztop(y)) for x, y in pc]
        b.intact += map_region(pts, "glass_roof", tag="roof", u_axis=(1, 0, 0),
                               v_axis=np.array([0.0, 1.0, (zk - zf) / W]) / math.hypot(1.0, (zk - zf) / W))
        b.solids.append(np.array([(x, y, z) for x, y in pc for z in (0.0, ztop(y))], float))
    # lit edges: the front eave, the two long slanted edges and the back ridge
    e = 1.0
    g = e / 2
    b.beam((-h + n, -h + g, zf + g), (h - n, -h + g, zf + g), e, region="lit_glass")
    b.beam((-h + n, h - g, zk + g), (h - n, h - g, zk + g), e, region="lit_glass")
    for x in (-h + g, h - g):
        b.beam((x, -h + n, ztop(-h + n) + g), (x, h - n, ztop(h - n) + g), e, region="lit_glass")
    # entrance and a mast at the back
    b.decal(kit.Block(-h + n, h - n, -h, h, 0, zl, "lobby", False, (1, 1, 1)), "front", 0.0, 0.0, 2.25, 2.625,
            "door_double")
    b.box((-6.0, -h - 0.45, 3.4), (6.0, -h, 3.7), color="#3a4256", top="white", bottom=True)
    b.antenna(0.0, h - 4.0, ztop(h - 4.0), 165.0, beacon=True, r=0.35)
    b.bite_hint = (h, -h, zf + 6.0)

# ==== the family picture ======================================================================
FAMILY_ROWS = (
    # front row, left to right, fronts on the far curb of the street
    (("bld_campus_a", 0.0), ("bld_apartment_a", 0.0), ("bld_apartment_b", 0.0), ("bld_apartment_c", 0.0),
     ("bld_office_a", 0.0)),
    # back row, one block further
    (("bld_office_b", 0.0), ("bld_office_c", 0.0), ("bld_tower_b", 0.0), ("bld_tower_c", 0.0)),
)


def family_shot(out=None, size=(1600, 900), samples=16):
    """docs/art/concept/city_blocks.png: every building of this family at true relative scale on
    a short piece of downtown street, by day, with cars, lamps, trees, the hatchling and soldiers.
    Run with: tools/art/city_blocks.py --family-shot"""
    import bpy
    import contract
    import mb
    from city import sheet

    mb.reset()

    def place(mid, x, y):
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=contract.model_path(mid))
        new = [o for o in bpy.context.scene.objects if o not in before]
        keep = [o for o in new if o.parent is None and o.name.split(".")[0] in ("intact",)] or \
            [o for o in new if o.parent is None]
        if mid.startswith("bld_"):
            for o in new:
                if o not in keep:
                    bpy.data.objects.remove(o, do_unlink=True)
        for o in keep:
            o.location = (o.location[0] + x, o.location[1] + y, o.location[2])
        return keep

    gap = 6.0
    curb = 10.0
    rows_y = (curb, curb + 16.0 + 14.0)          # second row behind a 14 m back street
    import contract as C
    for row, y0 in zip(FAMILY_ROWS, rows_y):
        widths = [C.archetypes()[m.split("_", 1)[1]]["footprint"][0] for m, _ in row]
        total = sum(widths) + gap * (len(row) - 1)
        x = -total / 2 + (-4.0 if y0 > curb else 0.0)
        for (mid, _), w in zip(row, widths):
            d = C.archetypes()[mid.split("_", 1)[1]]["footprint"][1]
            place(mid, x + w / 2, y0 + d / 2)
            x += w + gap
    # the street: asphalt, two curbs and sidewalks, lane dashes (vertex colors, picture only)
    g = mb.Geo()

    def quad(x0, y0, x1, y1, z, col):
        g.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], color=col)

    L = 85.0
    quad(-L, -7.0, L, 7.0, 0.02, "#4a4d55")
    quad(-L, -11.0, L, -7.0, 0.15, "#b9b5ac")
    quad(-L, 7.0, L, curb + 0.0, 0.15, "#b9b5ac")
    quad(-L, curb + 16.0, L, curb + 30.0, 0.02, "#4a4d55")
    for k in range(-int(L // 5), int(L // 5)):
        quad(k * 5.0, -0.12, k * 5.0 + 2.6, 0.12, 0.04, "#efe9d8")
    mb.node("street", g)
    # props for scale along the street
    for mid, x, y in (("prop_car_sedan", -40.0, -3.2), ("prop_car_taxi", 18.0, 3.4), ("prop_bus", 52.0, -3.4),
                      ("prop_car_van", -8.0, 3.4), ("prop_lamp", -60.0, 8.2), ("prop_lamp", -20.0, 8.2),
                      ("prop_lamp", 20.0, 8.2), ("prop_lamp", 60.0, 8.2), ("prop_tree_a", -72.0, -9.0),
                      ("prop_tree_b", -30.0, -9.0), ("prop_tree_a", 10.0, -9.0), ("prop_tree_b", 44.0, -9.0)):
        path = contract.model_path(mid)
        if os.path.exists(path):
            place(mid, x, y)
    # the hatchling on the street and a few soldiers on the near sidewalk
    lizard = contract.model_path("kaiju_lizard_s1")
    if os.path.exists(lizard):
        for o in place("kaiju_lizard_s1", -58.0, 0.5):
            o.rotation_mode = "QUATERNION"
    mat = bpy.data.materials.new("mbsheet_olive")
    bsdf = next(n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.16, 0.2, 0.08, 1.0)
    for x in (-50.0, -48.6, -47.4):
        for o in sheet._soldier(x, -9.0):
            o.data.materials.append(mat)
    for o in bpy.context.scene.objects:
        o.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()
    out = out or os.path.join(contract.CONCEPT, "city_blocks.png")
    return mb.concept("city_blocks", out=out, backdrop="sky", azimuth=22.0, elevation=8.0, fov=30.0, zoom=1.05,
                      size=size, samples=samples)


if __name__ == "__main__":
    if "--family-shot" in sys.argv:
        print(family_shot())
        raise SystemExit(0)
    raise SystemExit(kit.run_family("city_blocks"))
