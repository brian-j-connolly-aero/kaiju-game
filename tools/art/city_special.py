#!/opt/mbtools/venv/bin/python
# mb-family: city_special
"""The special buildings of roadmap phase 2: the three the monster wrecks for a reward.

    bld_substation_a  power substation, 22 x 16 m, 9 m: a fenced gravel yard, two grey-green
                      transformers with three brown ceramic insulators each, two steel gantries
                      with wires between them, a concrete control hut, warning signs (a bolt).
                      Empties spark_00..05 on the insulator tops.
    bld_gasstation_a  gas station, 26 x 20 m, 7 m: a red canopy on four pillars over two pump
                      islands, a shop behind it, a pole sign with a flame, a cage of gas
                      bottles. Empties light_00..03 over the pumps.
    bld_radiomast_a   radio mast, 8 x 8 m, 24 m: a three-legged red and white lattice on a
                      concrete pad, an equipment hut. Empties lamp_00..02 (top, 16 m, 8 m).
                      The mesh node `top` is a spare copy of the top 8 m (pivot on the mast
                      axis at 16 m) for the break-off; `intact` already holds the whole mast.

Built with the city kit (tools/art/city/README.md): one material, the shared atlas (their own
pictures are in tools/art/city/atlas_extra/special.py), damaged, rubble and chunks from the
kit's one generator. What is new here is `special()`: a building that also carries extra
nodes (anchors for the client's effects, the mast's `top`).

The archetypes (substation_a, gasstation_a, radiomast_a) are added in shared/src/city by the
simulation side; until `npm run export:defs` has written them to tools/art/data/archetypes.json
this script uses the sizes in SIZES below (and checks that the two agree afterwards).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import contract  # noqa: E402
from city import atlas, kit, style  # noqa: E402
from city.geom import Face, Mesh, clip, hex_rgb, map_region, plain  # noqa: E402

atlas.load_extensions()          # the sp_* pictures (tools/art/city/atlas_extra/special.py)
UP = np.array([0.0, 0.0, 1.0])

# id -> (class, footprint x, footprint z, height): what the simulation side was given
SIZES = {
    "substation_a": ("special", 22.0, 16.0, 9.0),
    "gasstation_a": ("special", 26.0, 20.0, 7.0),
    "radiomast_a": ("special", 8.0, 8.0, 24.0),
}

RED = "#d7263d"
WHITE = "#f4f2ee"
STEEL = "#aab3bf"
STEEL_DK = "#4a4e58"
CONCRETE = "#c4c0b6"
TRAFO = "#b4c8ae"          # multiplies the grey cladding into transformer grey-green

GAP = 0.004               # between the two faces of a two-sided sheet: no slit to look into

MAST_H = 24.0
MAST_BREAK = 16.0          # the top 8 m is the piece that breaks off
MAST_Z0 = 0.25             # the pad's surface


def _ensure_archetypes():
    """Stand-in archetype records until the game's export has them; a size that disagrees
    with the export is an error (the model would not fit its collision box)."""
    known = contract.archetypes()
    for aid, (cls, w, d, h) in SIZES.items():
        a = known.get(aid)
        if a is None:
            known[aid] = {"id": aid, "model": "bld_" + aid, "class": cls, "footprint": [w, d], "height": h,
                          "sizeClass": contract.size_class_for_dims(w, d, h), "landmark": None}
            continue
        got = contract.archetype_dims(a)
        if got != (w, d, h):
            raise SystemExit(f"city_special: archetype {aid} is {got} in archetypes.json but this script "
                             f"builds {(w, d, h)}: change SIZES and the model together")


_ensure_archetypes()


# ==== small parts =============================================================================
def quad(b, pts, color="#ffffff", region=None, tone=None, unit=None, tag="detail", two_sided=False, into=None):
    """One planar polygon, counter-clockwise seen from its front: a flat color or an atlas
    region (cut at the region's repeats). two_sided adds the back side."""
    pts = [np.asarray(p, float) for p in pts]
    polys = [pts]
    if two_sided:
        n = Face(pts).normal * GAP
        polys.append([p - n for p in reversed(pts)])
    out = []
    for p in polys:
        if region:
            out += map_region(p, region, col=hex_rgb(tone) if tone else (1, 1, 1), tag=tag, unit=unit)
        else:
            out.append(plain(p, color, tag=tag))
    (b.intact if into is None else into).add(out)
    return out


def pic(b, pts, region, fu=(0.0, 1.0), fv=(0.0, 1.0), col=(1, 1, 1), tag="detail", two_sided=False, into=None):
    """A four-corner face (bottom left, bottom right, top right, top left, seen from its front)
    showing part of a region once, never cut: fu, fv are the fractions of the picture used."""
    r = atlas.region(region)

    def uv(fs, ft):
        return r.uv(0.5 + fs * (r.w - 1.0), r.h - 0.5 - ft * (r.h - 1.0))
    pts = [np.asarray(p, float) for p in pts]
    uvs = [uv(fu[0], fv[0]), uv(fu[1], fv[0]), uv(fu[1], fv[1]), uv(fu[0], fv[1])]
    out = [Face(pts, uvs, hex_rgb(col), False, region, tag)]
    if two_sided:
        n = out[0].normal * GAP
        out.append(Face([p - n for p in reversed(pts)], list(reversed(uvs)), hex_rgb(col), False, region, tag))
    (b.intact if into is None else into).add(out)
    return out


def box(b, lo, hi, color="#d8d2c4", sides=("front", "left", "back", "right", "top"), colors=None, tag="detail",
        solid=False, into=None):
    """An axis-aligned box in flat colors, each side shaded a little so corners read.
    `colors` overrides single sides ({"top": "#fff"}); "bottom" is made only when listed."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    quads = {
        "front": [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
        "left": [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
        "back": [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
        "right": [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
        "top": [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
        "bottom": [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)],
    }
    sh = {"front": 0.96, "left": 0.86, "back": 0.8, "right": 0.9, "top": 1.0, "bottom": 0.72}
    for k in sides:
        c = hex_rgb((colors or {}).get(k, color))
        quad(b, quads[k], color=tuple(x * sh[k] for x in c), tag=tag, into=into)
    if solid:
        b.solids.append(np.array([(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)], float))
    return quads


def bar(b, p0, p1, w, d=None, color=STEEL, n=4, out=None, face=None, tag="detail", into=None):
    """An open-ended bar between two points: n = 4 square (8 triangles), n = 3 a triangle with
    one edge pointing toward `out` (6 triangles). `face` builds each side (default: flat color,
    shaded per side)."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    ax = (p1 - p0) / np.linalg.norm(p1 - p0)
    a = np.asarray(out, float) if out is not None else np.cross(ax, UP)
    a = a - ax * float(a @ ax)
    if np.linalg.norm(a) < 1e-6:
        a = np.array([1.0, 0.0, 0.0])
    a /= np.linalg.norm(a)
    c = np.cross(ax, a)
    if n == 3:
        ring = [(a * math.cos(t) + c * math.sin(t)) * w for t in (0.0, 2 * math.pi / 3, 4 * math.pi / 3)]
    else:
        hw, hd = w / 2, (d or w) / 2
        ring = [a * hw + c * hd, -a * hw + c * hd, -a * hw - c * hd, a * hw - c * hd]
    base = hex_rgb(color)
    faces = []
    for k in range(n):
        q = [p0 + ring[k], p0 + ring[(k + 1) % n], p1 + ring[(k + 1) % n], p1 + ring[k]]
        if Face(q).normal @ (ring[k] + ring[(k + 1) % n]) < 0:
            q.reverse()
        sh = (1.0, 0.86, 0.74, 0.9)[k]
        faces.append(face(q, sh) if face else plain(q, tuple(x * sh for x in base), tag=tag))
    (b.intact if into is None else into).add(faces)
    return faces


def frustum(b, center, r0, r1, z0, z1, n=4, region=None, color="#ffffff", cap="#3a3f4a", tag="detail"):
    """An upright n-sided taper with a cap: insulators, bollards."""
    cx, cy = center
    ring = [(math.cos(math.pi / n + 2 * math.pi * k / n), math.sin(math.pi / n + 2 * math.pi * k / n)) for k in range(n)]
    for k in range(n):
        a, c = ring[k], ring[(k + 1) % n]
        q = [(cx + a[0] * r0, cy + a[1] * r0, z0), (cx + c[0] * r0, cy + c[1] * r0, z0),
             (cx + c[0] * r1, cy + c[1] * r1, z1), (cx + a[0] * r1, cy + a[1] * r1, z1)]
        if region:
            sh = (1.0, 0.84, 0.74, 0.9)[k % 4]
            pic(b, q, region, col=(sh, sh, sh), tag=tag)
        else:
            quad(b, q, color=color, tag=tag)
    quad(b, [(cx + a[0] * r1, cy + a[1] * r1, z1) for a in ring], color=cap, tag=tag)


def tag_since(b, start, mark):
    """Mark the faces added since `start` ("detail|mark"): the damage hooks find parts by it."""
    for f in b.intact.faces[start:]:
        f.tag = f"{f.tag.split('|')[0]}|{mark}"


def marked(f, prefix):
    return "|" in f.tag and f.tag.split("|")[-1].startswith(prefix)


def rot_matrix(axis, deg):
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    a = math.radians(deg)
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + math.sin(a) * K + (1 - math.cos(a)) * K @ K


def as_rubble(mesh):
    for f in mesh.faces:
        f.tag = "rubble"
    return mesh


def cbox(b, lo, hi, color, colors=None):
    """A closed box as a chunk."""
    m = Mesh()
    box(b, lo, hi, color=color, colors=colors, into=m, sides=("front", "left", "back", "right", "top", "bottom"))
    return m


def piece(b, faces, floor, x_cut=None, keep_low=True):
    """A chunk from a part's own faces: optionally only the half on one side of x = x_cut
    (closed there with a broken face), closed underneath. floor = (x0, x1, y0, y1, z0, z1)."""
    x0, x1, y0, y1, z0, z1 = floor
    m = Mesh()
    for f in faces:
        g = f.copy()
        if x_cut is not None:
            g = clip(g, (1.0, 0.0, 0.0), x_cut, keep_low)
        if g is not None and g.area > 1e-4:
            m.add(g)
    if x_cut is not None:
        if keep_low:
            x1 = x_cut
            cut = [(x_cut, y0, z0), (x_cut, y1, z0), (x_cut, y1, z1), (x_cut, y0, z1)]
        else:
            x0 = x_cut
            cut = [(x_cut, y1, z0), (x_cut, y0, z0), (x_cut, y0, z1), (x_cut, y1, z1)]
        quad(b, cut, region="rubble", unit=(12.01, 12.01), tag="rubble", into=m)
    quad(b, [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], region="rubble", unit=(12.01, 12.01), tag="rubble",
         into=m)
    return m


# ==== substation_a ============================================================================
def substation_a(b):
    W, D = b.W, b.D
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    # the gravel yard and its chain-link fence (seen from both sides)
    quad(b, [(x0, y0, 0.1), (x1, y0, 0.1), (x1, y1, 0.1), (x0, y1, 0.1)], region="gravel", unit=(W + 0.1, D + 0.1),
         tag="roof")
    yard = kit.Block(x0, x1, y0, y1, 0.0, 2.25, "sp_fence", False, (1, 1, 1))
    fence_w = atlas.region("sp_fence").w * style.PX
    for name in kit.SIDES:
        (ax, ay), (cx, cy), _ = yard.side(name)
        ln = math.dist((ax, ay), (cx, cy))
        pic(b, [(ax, ay, 0.0), (cx, cy, 0.0), (cx, cy, 2.25), (ax, ay, 2.25)], "sp_fence", fu=(0.0, ln / fence_w),
            two_sided=True)
    for x in (-6.5, 2.5):                                       # warning signs on the street side
        pic(b, [(x - 0.7, y0 - 0.07, 0.6), (x + 0.7, y0 - 0.07, 0.6), (x + 0.7, y0 - 0.07, 2.0), (x - 0.7, y0 - 0.07, 2.0)],
            "sp_sign_bolt")
    # two transformers: ribbed grey-green tanks, three ceramic insulators on each
    sparks, chunks = {}, []
    for k, tx in enumerate((-6.3, -0.7)):
        ty = 1.0
        i0 = len(b.intact.faces)
        bx0, bx1, by0, by1, bz = tx - 1.8, tx + 1.8, ty - 1.3, ty + 1.3, 3.0
        for name, (pa, pc) in (("front", ((bx0, by0), (bx1, by0))), ("left", ((bx1, by0), (bx1, by1))),
                               ("back", ((bx1, by1), (bx0, by1))), ("right", ((bx0, by1), (bx0, by0)))):
            reg = "metal_plain" if name in ("front", "back") else "vent"
            unit = None if reg == "metal_plain" else (2.61, 2.91)
            quad(b, [(pa[0], pa[1], 0.1), (pc[0], pc[1], 0.1), (pc[0], pc[1], bz), (pa[0], pa[1], bz)], region=reg,
                 tone=TRAFO, unit=unit, tag="wall")
        quad(b, [(bx0, by0, bz), (bx1, by0, bz), (bx1, by1, bz), (bx0, by1, bz)], color="#9fb39a", tag="roof")
        b.solids.append(np.array([(x, y, z) for x in (bx0, bx1) for y in (by0, by1) for z in (0.0, bz)], float))
        chunks.append(piece(b, b.intact.faces[i0:], (bx0, bx1, by0, by1, 0.1, bz)))
        i1 = len(b.intact.faces)
        for j, dx in enumerate((-1.15, 0.0, 1.15)):
            frustum(b, (tx + dx, ty + 0.2), 0.34, 0.17, bz, bz + 1.5, region="sp_insulator")
            sparks[f"spark_{k * 3 + j:02d}"] = (tx + dx, ty + 0.2, bz + 1.55)
        tag_since(b, i0, f"trafo{k}")
        chunks.append(Mesh([f.copy() for f in b.intact.faces[i1:]]))                     # its three insulators
    # two steel gantries across the yard, three wires between them over the transformers
    gx0, gx1, zb = -9.6, 2.6, 8.2
    for gy in (-4.6, 5.8):
        for gx in (gx0, gx1):
            bar(b, (gx, gy, 0.1), (gx, gy, b.H), 0.5)
            quad(b, [(gx - 0.25, gy - 0.25, b.H), (gx + 0.25, gy - 0.25, b.H), (gx + 0.25, gy + 0.25, b.H),
                     (gx - 0.25, gy + 0.25, b.H)], color=STEEL)
            chunks.append(cbox(b, (gx - 0.25, gy - 0.25, 0.1), (gx + 0.25, gy + 0.25, b.H), STEEL))
        chunks.append(cbox(b, (gx0 + 0.25, gy - 0.3, zb - 0.25), (gx1 - 0.25, gy + 0.3, zb + 0.25), STEEL))
        bar(b, (gx0, gy, zb), (gx1, gy, zb), 0.5, 0.6)
        b.solids.append(np.array([(x, y, z) for x in (gx0 - 0.25, gx1 + 0.25) for y in (gy - 0.3, gy + 0.3)
                                  for z in (0.0, b.H)], float))
    for wx in (-6.8, -3.5, -0.2):
        quad(b, [(wx, -4.6, zb - 0.38), (wx, 5.8, zb - 0.38), (wx, 5.8, zb - 0.26), (wx, -4.6, zb - 0.26)],
             color="#2b2f38", two_sided=True)
    # the control hut at the back left, a warning sign by its door
    i0 = len(b.intact.faces)
    hut = b.block(5.0, 4.0, 3.2, at=(7.4, 4.6, 0.0), facade="concrete_plain", roof="gravel")
    b.door(hut, "front", x=-0.9, kind="door_double")
    b.decal(hut, "front", 1.4, 1.2, 1.2, 1.2, "sp_sign_bolt", offset=0.05)
    chunks.append(piece(b, b.intact.faces[i0:], (hut.x0, hut.x1, hut.y0, hut.y1, 0.0, hut.z1)))
    b.bite_hint = (-11.0, -8.0, 9.4)          # the front right corner: a gantry post snaps off
    # rubble: one transformer tank lying burst on the heap, a bent gantry post
    keep = Mesh()
    bx = box(b, (-2.0, -1.2, 0.0), (2.0, 1.2, 2.2), color="#8fa58b", into=keep)
    _ = bx
    keep.roty(-14.0).rotz(24.0).move(-3.5, 0.5, 0.25)
    post = Mesh()
    bar(b, (0.0, 0.0, 0.0), (0.0, 0.0, 6.5), 0.5, color=STEEL, into=post)
    post.rotx(74.0).rotz(-35.0).move(4.5, 3.0, 0.5)
    b.keepsake = as_rubble(Mesh(keep.faces + post.faces))
    for f in b.keepsake.faces:
        f.col = tuple(c * 0.8 for c in f.col)
    # chunks by hand (see radiomast_a): the tanks, the hut, the gantry posts and beams
    return dict(empties=sparks, chunks=chunks)


# ==== gasstation_a ============================================================================
def gasstation_a(b):
    W, D = b.W, b.D
    z0 = 0.12
    box(b, (-W / 2, -D / 2, 0.0), (W / 2, D / 2, z0), color=CONCRETE, solid=True)        # the forecourt
    # the shop at the back: glass front, plaster sides
    chunks = [cbox(b, (xa, -D / 2, 0.0), (xc, D / 2, z0), CONCRETE) for xa, xc in ((-W / 2, 1.5), (1.5, W / 2))]
    i0 = len(b.intact.faces)
    shop = b.block(12.0, 6.0, 4.5, at=(-1.0, 6.7, 0.0), facade="plaster_plain", ground="shopfront", ground_h=4.5,
                   sides={"left": "plaster_plain", "right": "plaster_plain", "back": "plaster_plain"}, roof="gravel")
    b.door(shop, "front", x=0.0, kind="door_double", z=z0)
    for low in (True, False):
        chunks.append(piece(b, b.intact.faces[i0:], (shop.x0, shop.x1, shop.y0, shop.y1, 0.0, shop.z1), x_cut=-2.2,
                            keep_low=low))
    # the cage of gas bottles beside the shop
    cx0, cx1, cy0, cy1, cz = 6.2, 9.2, 6.2, 7.5, z0 + 1.9
    pic(b, [(cx0, cy0, z0), (cx1, cy0, z0), (cx1, cy0, cz), (cx0, cy0, cz)], "sp_bottles")
    pic(b, [(cx1, cy1, z0), (cx0, cy1, z0), (cx0, cy1, cz), (cx1, cy1, cz)], "sp_bottles")
    pic(b, [(cx1, cy0, z0), (cx1, cy1, z0), (cx1, cy1, cz), (cx1, cy0, cz)], "sp_bottles", fu=(0.0, 0.42))
    pic(b, [(cx0, cy1, z0), (cx0, cy0, z0), (cx0, cy0, cz), (cx0, cy1, cz)], "sp_bottles", fu=(0.0, 0.42))
    quad(b, [(cx0, cy0, cz), (cx1, cy0, cz), (cx1, cy1, cz), (cx0, cy1, cz)], color="#d9dde3")
    # the canopy: red fascia, white underside with two lit panels, on four white pillars
    ax0, ax1, ay0, ay1, az0, az1 = -8.6, 8.6, -8.9, 0.7, 4.9, 5.75
    i0 = len(b.intact.faces)
    box(b, (ax0, ay0, az0), (ax1, ay1, az1), color=RED, sides=("front", "left", "back", "right", "top", "bottom"),
        colors={"top": "#e4e1da", "bottom": WHITE}, solid=True)
    tag_since(b, i0, "canopy")
    xm, ym = -0.9, -4.6
    for xa, xc in ((ax0, xm), (xm, ax1)):
        for ya, yc in ((ay0, ym), (ym, ay1)):
            chunks.append(cbox(b, (xa, ya, az0), (xc, yc, az1), RED, {"top": "#e4e1da", "bottom": WHITE}))
    lights = {}
    n = 0
    for iy in (-6.6, -1.6):
        box(b, (-6.6, iy - 0.6, z0), (6.6, iy + 0.6, z0 + 0.25), color="#d8d2c4")                # the pump island
        pic(b, [(-4.0, iy + 0.9, az0 - 0.03), (4.0, iy + 0.9, az0 - 0.03), (4.0, iy - 0.9, az0 - 0.03),
                (-4.0, iy - 0.9, az0 - 0.03)], "lamp", tag="detail|canopy")
        for px in (-5.7, 5.7):
            bar(b, (px, iy, z0 + 0.25), (px, iy, az0), 0.5, color=WHITE)
        for px in (-2.3, 2.3):
            i0 = len(b.intact.faces)
            ux0, ux1, uy0, uy1, uz0, uz1 = px - 0.7, px + 0.7, iy - 0.4, iy + 0.4, z0 + 0.25, z0 + 0.25 + 2.1
            pic(b, [(ux0, uy0, uz0), (ux1, uy0, uz0), (ux1, uy0, uz1), (ux0, uy0, uz1)], "sp_pump")
            pic(b, [(ux1, uy1, uz0), (ux0, uy1, uz0), (ux0, uy1, uz1), (ux1, uy1, uz1)], "sp_pump")
            quad(b, [(ux1, uy0, uz0), (ux1, uy1, uz0), (ux1, uy1, uz1), (ux1, uy0, uz1)], color="#d9d6cf")
            quad(b, [(ux0, uy1, uz0), (ux0, uy0, uz0), (ux0, uy0, uz1), (ux0, uy1, uz1)], color="#e6e3dc")
            quad(b, [(ux0, uy0, uz1), (ux1, uy0, uz1), (ux1, uy1, uz1), (ux0, uy1, uz1)], color=RED)
            tag_since(b, i0, f"pump{n}")
            chunks.append(piece(b, b.intact.faces[i0:], (ux0, ux1, uy0, uy1, uz0, uz1)))
            b.solids.append(np.array([(x, y, z) for x in (ux0, ux1) for y in (uy0, uy1) for z in (uz0, uz1)], float))
            lights[f"light_{n:02d}"] = (px, iy, uz1 + 0.2)
            n += 1
    # the pole sign at the front left corner: a flame, on both faces
    sx, sy = 11.4, -8.6
    i0 = len(b.intact.faces)
    bar(b, (sx, sy, z0), (sx, sy, 4.8), 0.4, color=WHITE)
    s0, s1, t0, t1, d = sx - 1.1, sx + 1.1, 4.8, b.H, 0.2
    pic(b, [(s0, sy - d, t0), (s1, sy - d, t0), (s1, sy - d, t1), (s0, sy - d, t1)], "sp_sign_flame")
    pic(b, [(s1, sy + d, t0), (s0, sy + d, t0), (s0, sy + d, t1), (s1, sy + d, t1)], "sp_sign_flame")
    box(b, (s0, sy - d, t0), (s1, sy + d, t1), color=RED, sides=("left", "right", "top", "bottom"))
    tag_since(b, i0, "sign")
    chunks.append(Mesh([f.copy() for f in b.intact.faces[i0 + 4:]]))                      # the board, without its pole
    b.solids.append(np.array([(x, y, z) for x in (s0, s1) for y in (sy - d, sy + d) for z in (t0, t1)], float))
    b.bite_hint = (-13.0, -10.0, 6.3)         # the front right corner: the canopy end, not the sign
    # rubble: a slab of the red canopy lying tilted on the heap, the sign's bent pole
    keep = Mesh()
    box(b, (-3.6, -2.2, 0.0), (3.6, 2.2, 0.5), color=RED, colors={"top": "#e4e1da"}, into=keep)
    keep.rotx(-13.0).rotz(-17.0).move(-2.5, -3.0, 0.75)
    pole = Mesh()
    bar(b, (0.0, 0.0, 0.0), (0.0, 0.0, 3.4), 0.4, color=WHITE, into=pole)
    pole.roty(64.0).move(6.5, -7.0, 0.3)
    b.keepsake = as_rubble(Mesh(keep.faces + pole.faces))
    for f in b.keepsake.faces:
        f.col = tuple(c * 0.82 for c in f.col)
    # chunks by hand (see radiomast_a): the shop in two, the canopy in four, the pumps, the sign
    return dict(empties=lights, chunks=chunks)


# ==== radiomast_a =============================================================================
def mast_r(z):
    """Distance of the three legs from the mast's axis at height z."""
    return 1.55 + (0.5 - 1.55) * (z - MAST_Z0) / (MAST_H - MAST_Z0)


def mast_leg(k, z):
    a = math.radians(90.0 + 120.0 * k)          # leg 0 at the back, a flat face toward the street
    r = mast_r(z)
    return np.array([r * math.cos(a), r * math.sin(a), z])


MAST_LEVELS = (MAST_Z0, 5.5, 10.75, MAST_BREAK, 20.0, MAST_H - 0.55)
MAST_LAMPS = {"lamp_00": (0.0, 0.0, MAST_H - 0.4), "lamp_01": (0.0, 0.0, MAST_BREAK - 0.5), "lamp_02": (0.0, 0.0, 8.0)}


def band_face(pts, sh=1.0, tag="detail"):
    """A face of the mast: red and white bands by height, from the band picture."""
    r = atlas.region("sp_mast_bands")
    pts = [np.asarray(p, float) for p in pts]
    uvs = [r.uv(r.w / 2, r.h - 0.5 - min(max(p[2] / MAST_H, 0.0), 1.0) * (r.h - 1.0)) for p in pts]
    return Face(pts, uvs, (sh, sh, sh), False, "sp_mast_bands", tag)


def lamp_body(b, at, r, h, into):
    """A small red lamp (glows at night): two three-sided pyramids base to base."""
    x, y, z = at
    ring = [(x + r * math.cos(t), y + r * math.sin(t), z) for t in (math.radians(a) for a in (270, 30, 150))]
    for k in range(3):
        a, c = ring[k], ring[(k + 1) % 3]
        into.add([plain([a, c, (x, y, z + h)], "#ffffff", swatch="beacon"),
                  plain([c, a, (x, y, z - h)], "#ffffff", swatch="beacon")])


def mast(b, z_lo, z_hi, into):
    """The lattice between two heights: three legs, zig-zag braces on the three faces, the
    lamps. Faces are marked leg / brace<segment> / lamp<n> for the damage hook."""
    start = len(into.faces)
    for k in range(3):
        p0, p1 = mast_leg(k, z_lo), mast_leg(k, min(z_hi, MAST_H - 0.55))
        out = np.array([p0[0], p0[1], 0.0])
        bar(b, p0, p1, 0.17, n=3, out=out, face=lambda q, sh: band_face(q, sh, "detail|leg"), into=into)
    for s in range(len(MAST_LEVELS) - 1):
        za, zc = MAST_LEVELS[s], MAST_LEVELS[s + 1]
        if za < z_lo - 1e-6 or zc > z_hi + 1e-6:
            continue
        for k in range(3):
            i, j = (k, (k + 1) % 3) if s % 2 == 0 else ((k + 1) % 3, k)
            pa, pc = mast_leg(i, za + 0.1), mast_leg(j, zc - 0.1)
            mid = (mast_leg(k, za) + mast_leg((k + 1) % 3, za)) / 2
            nrm = np.array([mid[0], mid[1], 0.0])
            nrm /= np.linalg.norm(nrm)
            w = np.cross(nrm, pc - pa)
            w = w / np.linalg.norm(w) * 0.085
            q = [pa - w, pc - w, pc + w, pa + w]
            if Face(q).normal @ nrm < 0:
                q.reverse()
            into.add([band_face(q, 0.92, f"detail|brace{s}"),
                      band_face([p - nrm * GAP for p in reversed(q)], 0.7, f"detail|brace{s}")])
    if z_hi >= MAST_H - 1e-6:                               # the head: the top lamp between the leg ends
        n0 = len(into.faces)
        lamp_body(b, (0.0, 0.0, MAST_H - 0.4), 0.42, 0.4, into)
        for f in into.faces[n0:]:
            f.tag = "detail|lamp0"
    for n, name in ((1, "lamp_01"), (2, "lamp_02")):
        x, y, z = MAST_LAMPS[name]
        if z_lo <= z < z_hi:
            n0 = len(into.faces)
            lamp_body(b, (x, y, z), 0.26, 0.24, into)
            for f in into.faces[n0:]:
                f.tag = f"detail|lamp{n}"
    return into.faces[start:]


def radiomast_a(b):
    W, D = b.W, b.D
    box(b, (-W / 2, -D / 2, 0.0), (W / 2, D / 2, MAST_Z0), color=CONCRETE, solid=True)      # the concrete pad
    mast(b, MAST_Z0, MAST_H, b.intact)
    for s in range(len(MAST_LEVELS) - 1):                    # what the chunks are cut from
        za, zc = MAST_LEVELS[s], (MAST_H if s == len(MAST_LEVELS) - 2 else MAST_LEVELS[s + 1])
        b.solids.append(np.array([mast_leg(k, z) for k in range(3) for z in (za, zc)], float))
    h0 = len(b.intact.faces)
    hut = b.block(3.0, 2.4, 2.5, at=(-2.3, 2.6, MAST_Z0), facade="concrete_plain", roof="gravel")
    b.door(hut, "front", x=0.0, kind="door_double", size=(1.5, 1.9))
    hut_faces = [f.copy() for f in b.intact.faces[h0:]]
    b.holes = 0
    b.bite_hint = (0.0, 0.0, MAST_H + 12.0)                  # the kit's corner bite stays clear: the hook bends the top

    # the spare top section: the same geometry as the top 8 m of `intact`
    top = Mesh()
    mast(b, MAST_BREAK, MAST_H, top)

    # rubble: the stump of the three legs, bent, with one brace left
    keep = Mesh()
    for k in range(3):
        p0 = mast_leg(k, 0.6)
        p1 = mast_leg(k, 3.6 + 1.1 * k) + np.array([0.5 * (k - 1), -0.4, 0.0])
        bar(b, p0, p1, 0.17, n=3, out=np.array([p0[0], p0[1], 0.0]), face=lambda q, sh: band_face(q, sh * 0.85, "rubble"),
            into=keep)
    b.keepsake = as_rubble(keep)

    def damage(b, m):
        # the top section kinks over toward the street's right; one bay of braces and the
        # middle lamp are gone; soot round the kink
        rot = rot_matrix((0.35, -1.0, 0.0), 21.0)
        hinge = mast_leg(1, MAST_BREAK)
        out = []
        for f in m.faces:
            if marked(f, "brace2") or marked(f, "lamp1"):
                continue
            zs = [p[2] for p in f.pts]
            if max(zs) <= MAST_BREAK + 1e-6 or not ("|" in f.tag):
                out.append(f)
                continue
            parts = [(f, True)] if min(zs) >= MAST_BREAK - 1e-6 else [(clip(f, UP, MAST_BREAK, True), False),
                                                                      (clip(f, UP, MAST_BREAK, False), True)]
            for piece, bend in parts:
                if piece is None:
                    continue
                if bend:
                    piece.pts = [rot @ (p - hinge) + hinge for p in piece.pts]
                out.append(piece)
        for f in out:
            if "|" in f.tag and not marked(f, "lamp"):
                dz = abs(f.center[2] - MAST_BREAK)
                if dz < 5.0:
                    k = 0.5 + 0.1 * dz
                    f.col = tuple(c * k for c in f.col)
        m.faces[:] = out

    b.damage_hook = damage

    # chunks, by hand: the kit cuts chunks on a grid over the whole 8 x 8 x 24 m box and drops
    # cells that are nearly empty, which is every cell a thin mast stands in. So: the pad in
    # two halves, the hut, and the mast's five bays as red and white prisms.
    chunks = []
    for xa, xc in ((-W / 2, 0.3), (0.3, W / 2)):
        m = Mesh()
        box(b, (xa, -D / 2, 0.0), (xc, D / 2, MAST_Z0), color=CONCRETE, into=m,
            sides=("front", "left", "back", "right", "top", "bottom"))
        chunks.append(m)
    m = Mesh(hut_faces)
    quad(b, [(hut.x0, hut.y1, hut.z0), (hut.x1, hut.y1, hut.z0), (hut.x1, hut.y0, hut.z0), (hut.x0, hut.y0, hut.z0)],
         region="rubble", unit=(12.0, 12.0), tag="rubble", into=m)
    chunks.append(m)
    for s in range(len(MAST_LEVELS) - 1):
        za, zc = MAST_LEVELS[s], (MAST_H if s == len(MAST_LEVELS) - 2 else MAST_LEVELS[s + 1])
        m = Mesh()
        lo3, hi3 = [mast_leg(k, za) for k in range(3)], [mast_leg(k, zc) for k in range(3)]
        for k in range(3):
            j = (k + 1) % 3
            m.add(band_face([lo3[k], lo3[j], hi3[j], hi3[k]], (1.0, 0.86, 0.74)[k]))
        m.add([plain([hi3[0], hi3[1], hi3[2]], STEEL_DK), plain([lo3[2], lo3[1], lo3[0]], STEEL_DK)])
        chunks.append(m)
    return dict(empties=dict(MAST_LAMPS), meshes={"top": (top, (0.0, 0.0, MAST_BREAK))}, chunks=chunks)


# ==== registration: a kit building that also carries extra nodes ==============================
def special(aid, fn, district, tone, seed):
    """Like kit.building, plus the extra nodes the building function returns:
    {"empties": {name: (x, y, z)}, "meshes": {name: (Mesh, pivot)}} in the authoring frame."""
    import mb
    from city import destruct
    mid = kit.model_id(aid)

    def build():
        b = kit.Building(aid, district=district, tone=tone, seed=seed)
        extra = fn(b) or {}
        problems = b.fit()
        if problems:
            raise RuntimeError(f"{mid}: the intact model does not fill its archetype box: " + "; ".join(problems))
        states = destruct.derive(b)
        if extra.get("chunks"):
            states.chunks = extra["chunks"]
        kit.make_node("intact", b.intact)
        kit.make_node("damaged", states.damaged)
        kit.make_node("rubble", states.rubble)
        for i, ch in enumerate(states.chunks):
            lo, hi = ch.bounds()
            kit.make_node(f"chunk_{i:02d}", ch, pivot=tuple((lo + hi) / 2))
        for name, (mesh, pivot) in extra.get("meshes", {}).items():
            kit.make_node(name, mesh, pivot=pivot)
        for name, at in extra.get("empties", {}).items():
            mb.empty(name, at=at)
        kit.REGISTRY[mid]["last"] = dict(tris=b.intact.tris, damaged=states.damaged.tris, rubble=states.rubble.tris,
                                         chunks=[c.tris for c in states.chunks],
                                         extra={k: v[0].tris for k, v in extra.get("meshes", {}).items()})

    kit.REGISTRY[mid] = dict(id=aid, district=district, tone=tone, fn=fn, opts={},
                             tint=[style.TONES[t] for t in style.DISTRICTS[district]["walls"]], base=tone)
    mb.asset(mid, kind="structure", concept=False)(build)


special("substation_a", substation_a, district="industry", tone="concrete", seed=41)
special("gasstation_a", gasstation_a, district="suburb", tone="white", seed=42)
special("radiomast_a", radiomast_a, district="industry", tone="concrete", seed=43)


def lineups():
    """Scale pictures: each special building beside buildings the city already has."""
    import mb
    from city import sheet
    out = os.path.join(mb.CONCEPT, "city_special_lineup.png")
    sheet.lineup(["bld_house_a", "bld_gasstation_a", "bld_substation_a", "bld_radiomast_a", "bld_shop_a"], out=out,
                 backdrop="sky", gap=5.0, azimuth=24, elevation=13)
    return out


if __name__ == "__main__":
    rc = kit.run_family("city_special")
    args = sys.argv[1:]
    if rc == 0 and not ({"--no-previews", "--list", "--only"} & set(args)) and not os.environ.get("MB_NO_PREVIEWS"):
        if "--force" in args or os.environ.get("MB_FORCE") or not os.path.exists(os.path.join(contract.CONCEPT, "city_special_lineup.png")):
            print("lineup:", lineups())
    for mid, reg in kit.REGISTRY.items():
        if "last" in reg:
            print(f"{mid}: {reg['last']}")
    raise SystemExit(rc)
