#!/opt/mbtools/venv/bin/python
# mb-family: props_supply
"""Army supply drop: the crate and its parachute (roadmap phase 2, "army pick-ups").

    /opt/mbtools/venv/bin/python tools/art/props_supply.py                 build, validate, preview
    /opt/mbtools/venv/bin/python tools/art/props_supply.py --no-previews   geometry only (fast)
    /opt/mbtools/venv/bin/python tools/art/props_supply.py --scenes-only   just the street scene

Writes (docs/ASSETS.md section 3, "Supply drop"):
    prop_crate        olive supply crate, 1.6 m on a side, on two skids      node `beacon` on top
    prop_parachute    round canopy 6 m across, eight lines                   node `hook` at the origin
    client/public/assets/manifest.props_supply.json
    docs/art/previews/<id>.png, docs/art/concept/<id>.png,
    docs/art/concept/props_supply_drop.png     a crate coming down and one landed, beside the tank

Each file is one mesh node named after the asset, as every prop, plus ONE EMPTY NODE:

    prop_crate / beacon      the middle of the lid's top. The client puts the light and the smoke
                             here, and it is also the point the crate hangs from: put `beacon`
                             on the parachute's `hook`.
    prop_parachute / hook    where the eight lines meet. It is the model's origin (0, 0, 0): the
                             canopy stands above it, so placing the parachute at a point hangs
                             whatever is at that point (a crate's `beacon`, a soldier's shoulders).

Both are closed on every side or two-sided where thin (they are seen from below while they come
down; the game draws a face from its front only), stay inside the 80-triangle prop budget and
wear the army's colors: olive, khaki and the cyan identification stripe. The emblem on the crate
is a picture (a pale stenciled chevron pointing down: "dropped from above"), no letters, no
star, nothing that is any real country's mark.
"""
import hashlib
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import mb  # noqa: E402
import mb_preview  # noqa: E402
import glb as glbfile  # noqa: E402

FAMILY = "props_supply"
DECAL = 0.02                    # flat pictures sit this far proud of the surface behind them
OLIVE, OLIVE_DK, OLIVE_LT, KHAKI = "army_olive", "army_olive_dk", "army_olive_lt", "army_khaki"
CYAN = "human_cyan"
STENCIL = "#ece6c6"             # pale stencil paint
WEBBING = "#3b3f2b"             # the straps: dark canvas webbing
BELOW = mb.View("FROM BELOW", azimuth=35, elevation=-35, ortho=True)
SHEET = dict(extra=["top", BELOW])

# ---- crate ------------------------------------------------------------------------------------------
CRATE_SIDE = 1.6                # the lid; the body is a little smaller
CRATE_TOP = 1.6                 # the top of the lid
STRAP_PROUD = 0.03


def drop(g: mb.Geo, where) -> mb.Geo:
    """A copy of `g` without the selected faces (faces nobody can see cost triangles)."""
    chosen = set(g.select(where))
    out = mb.Geo()
    for i, f in enumerate(g.f):
        if i not in chosen:
            out.face([g.v[k] for k in f], g.col[i], g.mat[i], g.uv[i])
    return out


def lit(g: mb.Geo, seed: int = 1, amount: float = 0.03) -> mb.Geo:
    """A little painted-in sky light and facet variation."""
    return g.bake_light(top=1.06, bottom=0.78).jitter(amount, seed=seed)


def crate_geo() -> mb.Geo:
    """Supply crate: an olive box 1.5 m square and 1.28 m high on two wooden skids, a lighter
    lid 1.6 m square overhanging it, two dark webbing straps over the lid and down the front
    and back, a pale chevron stenciled on the front and back, the army's cyan stripe on both
    sides and across the lid. 78 triangles."""
    body_w, skid_h, lid_h = 1.5, 0.12, 0.20
    body_h = CRATE_TOP - skid_h - lid_h
    half = body_w / 2
    g = mb.Geo()
    for x in (-0.47, 0.47):                                 # skids; their tops are inside the body
        g += drop(mb.box((0.24, 1.38, skid_h), at=(x, 0, 0), anchor="bottom", color="wood_dk"), "top")
    body = mb.box((body_w, body_w, body_h), at=(0, 0, skid_h), anchor="bottom", color=OLIVE)
    body.paint(OLIVE_DK, where="bottom")
    g += body
    lid = mb.box((CRATE_SIDE, CRATE_SIDE, lid_h), at=(0, 0, CRATE_TOP), anchor="top", color=OLIVE_LT)
    lid.paint(OLIVE, where="side")
    lid.paint(OLIVE_DK, where="bottom")
    g += lid
    lit(g, seed=41)
    for x in (-0.47, 0.47):                                 # straps: over the lid, down front and back
        strap = mb.box((0.17, CRATE_SIDE + 2 * STRAP_PROUD, CRATE_TOP + STRAP_PROUD - skid_h - 0.02),
                       at=(x, 0, CRATE_TOP + STRAP_PROUD), anchor="top", color=WEBBING)
        g += lit(drop(strap, "bottom"), seed=42, amount=0.05)
    zc = skid_h + body_h * 0.50                             # the stencil: a chevron pointing down
    w, t, h = 0.27, 0.19, 0.25                              # half width, thickness, drop of the point
    for s in (-1, 1):
        y = s * (half + DECAL)
        for sx in (-1, 1):
            q = [(sx * w, y, zc + h / 2 + t / 2), (sx * w, y, zc + h / 2 - t / 2 - 0.02), (0, y, zc - h / 2 - t / 2),
                 (0, y, zc - h / 2 + t / 2 + 0.02)]
            if s * sx < 0:
                q.reverse()
            g += mb.polygon(q, color=STENCIL)
        x = s * (half + DECAL)                              # the identification stripe on the sides
        q = [(x, -half + 0.12, zc + 0.14), (x, half - 0.12, zc + 0.14), (x, half - 0.12, zc - 0.14), (x, -half + 0.12, zc - 0.14)]
        if s > 0:
            q.reverse()
        g += mb.polygon(q, color=CYAN)
    z = CRATE_TOP + DECAL                                   # and across the lid, between the straps
    g += mb.polygon([(-0.16, -0.62, z), (0.16, -0.62, z), (0.16, 0.62, z), (-0.16, 0.62, z)], color=CYAN)
    return g


@mb.asset("prop_crate", sheet=SHEET, concept=dict(azimuth=32, elevation=18))
def prop_crate():
    mb.node("prop_crate", crate_geo())
    mb.empty("beacon", at=(0, 0, CRATE_TOP + STRAP_PROUD), parent="prop_crate")


# ---- parachute --------------------------------------------------------------------------------------
CHUTE_R = 3.0                   # the canopy is 6 m across its corners
CHUTE_RIM = 4.7                 # the rim hangs this far above the hook
CHUTE_TOP = 6.7
CHUTE_N = 8


def gore(center) -> int:
    """Which of the canopy's eight panels a point is on."""
    return int(math.floor(math.degrees(math.atan2(center.y, center.x)) / (360.0 / CHUTE_N) + 1e-6)) % CHUTE_N


def parachute_geo() -> mb.Geo:
    """Round parachute: an eight-panel dome 6 m across and 2 m high, panels olive and khaki in
    turn, a cyan cap on top (the army's identification color, seen from above), dark inside,
    and eight lines from the rim's corners down to one point 4.7 m below it. 80 triangles."""
    n = CHUTE_N
    dome = mb.lathe([(CHUTE_R, CHUTE_RIM), (2.62, CHUTE_RIM + 1.02), (1.42, CHUTE_RIM + 1.74), (0.0, CHUTE_TOP)], n=n,
                    phase=0.0, color=OLIVE, cap_bottom=False)
    for i in range(len(dome.f)):
        c = dome.face_center(i)
        if math.hypot(c.x, c.y) < 1.0:
            dome.paint(CYAN, where=[i])
        elif gore(c) % 2:
            dome.paint(KHAKI, where=[i])
    dome.bake_light(top=1.08, bottom=0.84).jitter(0.03, seed=51)
    inside = mb.lathe([(CHUTE_R, CHUTE_RIM), (0.0, CHUTE_TOP - 0.45)], n=n, phase=0.0, color=OLIVE_DK,
                      cap_bottom=False).flip()
    for i in range(len(inside.f)):
        if gore(inside.face_center(i)) % 2:
            inside.paint(mb.shade(KHAKI, 0.62), where=[i])
    g = dome + inside
    for k in range(n):                                      # lines: flat ribbons, each turned 45 degrees
        a = 2 * math.pi * k / n                             # so that no view sees them all edge-on
        top = mb.V(math.cos(a) * CHUTE_R, math.sin(a) * CHUTE_R, CHUTE_RIM)
        b = a + math.radians(45 if k % 2 else -45)
        across = mb.V(math.cos(b), math.sin(b), 0)
        q = [top - across * 0.075, top + across * 0.075, across * 0.03, across * -0.03]
        nrm = (q[1] - q[0]).cross(q[2] - q[0]).normalized() * 0.008
        color = "#d8d2b4" if k % 2 else "#c4be9e"
        g += mb.polygon([p + nrm for p in q], color=color)              # two faces a hair apart: a
        g += mb.polygon([p - nrm for p in reversed(q)], color=mb.shade(color, 0.8))   # ribbon seen from both sides
    return g


@mb.asset("prop_parachute", sheet=SHEET, concept=dict(azimuth=30, elevation=4))
def prop_parachute():
    mb.node("prop_parachute", parachute_geo())
    mb.empty("hook", at=(0, 0, 0), parent="prop_parachute")


# ---- scene shot -------------------------------------------------------------------------------------
def geo_from_glb(asset: str) -> mb.Geo:
    """Any exported model as loose geometry, to dress a scene with."""
    data = glbfile.load(mb.contract.model_path(asset))
    out = mb.Geo()
    for n in data.reachable():
        if n.mesh is None:
            continue
        for prim in data.meshes[n.mesh]:
            pts = prim.positions @ n.world[:3, :3].T + n.world[:3, 3]
            cols = glbfile.linear_to_srgb(prim.colors[:, :3]) if prim.colors is not None else None
            for tri in prim.indices:
                color = tuple(float(c) for c in cols[tri[0]]) if cols is not None else "white"
                out.face([mb.from_gltf(pts[k]) for k in tri], color, prim.material if prim.material in ("vcol", "glow") else "vcol")
    return out


def glb_point(asset: str, node: str) -> mb.Vector:
    """A node's position in the authoring frame, read from the exported file."""
    data = glbfile.load(mb.contract.model_path(asset))
    return mb.from_gltf(data.node(node).world[:3, 3])


CURB = 0.15


def street(length: float = 90.0) -> mb.Geo:
    g = mb.box((length, 16, 0.2), at=(0, 0, 0), anchor="top", color="road")
    for s in (1, -1):
        g += mb.box((length, 30, 0.2 + CURB), at=(0, s * 23.0, CURB), anchor="top", color="sidewalk" if s > 0 else "grass")
    for x in range(-int(length / 2) + 2, int(length / 2), 6):
        g += mb.box((2.8, 0.18, 0.02), at=(x, 0, 0), anchor="bottom", color="white")
    return g


def build_drop() -> None:
    """A landed crate in the street beside the tank, a car and the street furniture, and a
    second crate coming down under its parachute the way the client hangs it: the crate's
    `beacon` on the parachute's `hook`."""
    mb.reset()
    g = mb.Geo()
    spots = [("prop_lamp", -9.5, 9.0, 0, CURB), ("prop_bench", -6.5, 8.9, 0, CURB),
             ("prop_hydrant", 7.8, 8.8, 0, CURB), ("prop_tree_a", 12.0, 11.5, 0, CURB),
             ("prop_kiosk", 2.5, 11.0, 0, CURB), ("prop_car_sedan", -8.5, 5.6, -90, 0),
             ("army_tank", 5.2, 2.2, -70, 0), ("prop_crate", -1.6, 1.2, 14, 0)]
    for asset, x, y, heading, z in spots:
        try:
            g += geo_from_glb(asset).rz(heading).move(x, y, z)
        except Exception as err:
            print(f"  drop scene: left out {asset} ({type(err).__name__}: {err})")
    hang = glb_point("prop_crate", "beacon")
    hook = mb.V(-6.0, 2.6, 5.6)                             # where the falling crate's lid is now
    g += geo_from_glb("prop_crate").rz(-20).move(*(hook - hang))
    g += geo_from_glb("prop_parachute").move(*hook)
    mb.node("ground", street().move(0, 0, 0.03))
    mb.node("things", g.move(0, 0, 0.03))


SCENE_OPTS = {
    "drop": dict(backdrop="sky", size=(1400, 900), samples=12, sun_azimuth=-45, sun_elevation=44,
                 view=mb.View("", eye=(3.0, -24.0, 7.5), target=(-1.5, 4.0, 5.0), fov=50)),
}


def render_scenes(force: bool = False, out_dir: str | None = None) -> None:
    with open(os.path.abspath(__file__), "rb") as f:
        src = hashlib.sha1(f.read()).hexdigest()
    for asset in ("prop_crate", "prop_parachute", "army_tank"):
        path = mb.contract.model_path(asset)
        if os.path.exists(path):
            src += mb._file_sha(path)
    for name, build in (("drop", build_drop),):
        out = os.path.join(out_dir or mb.CONCEPT, f"props_supply_{name}.png")
        opts = SCENE_OPTS[name]
        stamp = f"{mb_preview.PREVIEW_VERSION}|{src}|{opts!r}"
        if not force and mb._stamp_ok(out, stamp):
            continue
        build()
        mb.concept(name, out=out, stamp=stamp, **opts)
        print(f"  scene: {os.path.relpath(out, mb.REPO)}")


if __name__ == "__main__":
    argv = sys.argv[1:]
    scenes_only = "--scenes-only" in argv
    out_dir = None
    if "--scene-out" in argv:                               # scratch folder for the scene while iterating
        i = argv.index("--scene-out")
        out_dir = argv[i + 1]
        del argv[i:i + 2]
    argv = [a for a in argv if a != "--scenes-only"]
    code = 0 if scenes_only else mb.run_family(FAMILY, argv)
    quick = any(a in argv for a in ("--no-previews", "--no-concept", "--list")) or \
        os.environ.get("MB_NO_PREVIEWS") or os.environ.get("MB_NO_CONCEPT")
    partial = any(a == "--only" or a.startswith("--only=") for a in argv)
    if code == 0 and (scenes_only or not (quick or partial)):
        render_scenes(force=scenes_only or "--force" in argv or bool(os.environ.get("MB_FORCE")), out_dir=out_dir)
    raise SystemExit(code)
