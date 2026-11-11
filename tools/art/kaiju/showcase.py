"""Review pictures that show more than one model: the growth line-up and the portrait.

    lineup()    all three stages to scale beside a bus and a ten-storey block
                -> docs/art/concept/kaiju_lizard_lineup.png
    portrait()  head and shoulders of the titan, dramatic light, transparent background
                -> client/public/assets/ui/portrait_lizard.png (512 px, what the game shows)
                -> docs/art/concept/portrait_lizard.png        (the same on a dark card, for review)

Both render the exported .glb files, so what ships is what is shown. They are skipped when
the models have not changed since the picture was made (a stamp in the PNG says so).
"""
from __future__ import annotations

import hashlib
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import mb  # noqa: E402
from mathutils import Vector  # noqa: E402  (available once bpy is loaded)
import mb_preview  # noqa: E402
import lizard  # noqa: E402

VERSION = "s4"                      # bump to force these pictures to re-render
UI = os.path.join(mb.ASSETS, "ui")
STAGE_IDS = {1: "kaiju_lizard_s1", 2: "kaiju_lizard_s2", 3: "kaiju_lizard_s3"}
STAGE_NAMES = {1: "HATCHLING", 2: "JUVENILE", 3: "TITAN"}


# ---- stamps -----------------------------------------------------------------------------
def _stamp(*parts) -> str:
    h = hashlib.sha1()
    for stage in (1, 2, 3):
        with open(mb.contract.model_path(STAGE_IDS[stage]), "rb") as f:
            h.update(f.read())
    return f"{mb_preview.PREVIEW_VERSION}|{VERSION}|{h.hexdigest()}|{parts!r}"


def _fresh(png: str, stamp: str) -> bool:
    if not os.path.exists(png):
        return False
    try:
        from PIL import Image
        with Image.open(png) as im:
            return im.info.get("mb_stamp") == stamp
    except Exception:
        return False


def _save(img, path: str, stamp: str) -> str:
    from PIL.PngImagePlugin import PngInfo
    os.makedirs(os.path.dirname(path), exist_ok=True)
    meta = PngInfo()
    meta.add_text("mb_stamp", stamp)
    img.save(path, pnginfo=meta)
    return path


# ---- scene helpers ----------------------------------------------------------------------
def _import(asset: str, at=(0, 0, 0), turn: float = 0.0) -> list:
    """Add an exported model to the current scene at a spot, turned `turn` degrees to its left."""
    before = set(bpy.data.objects)
    with mb.quiet():
        bpy.ops.import_scene.gltf(filepath=mb.contract.model_path(asset), import_shading="NORMALS",
                                  merge_vertices=False)
    new = [o for o in bpy.data.objects if o not in before]
    for ob in new:
        ob.select_set(False)
        if ob.name.split(".")[0] == "weak_point":       # the game shows it only while staggered
            ob.hide_render = True
        if ob.parent is None:
            ob.rotation_mode = "XYZ"
            ob.rotation_euler = (0, 0, math.radians(turn))
            ob.location = Vector(at)
    bpy.context.view_layer.update()
    return new


def _bus() -> mb.Geo:
    """A 12 m city bus, nose toward -Y. A stand-in for scale; the real prop is used when it exists."""
    g = mb.box((2.55, 12.0, 2.55), at=(0, 0, 0.45), anchor="bottom", color="bld_white")
    g.paint("human_cyan", where=lambda c, n: abs(n.z) < 0.5 and c.z < 1.35)
    g += mb.box((2.6, 10.6, 0.95), at=(0, 0.2, 1.75), anchor="bottom", color="glass_dk")
    g += mb.box((2.3, 0.1, 1.1), at=(0, -6.0, 1.55), anchor="bottom", color="glass_dk")
    for y in (-3.9, 3.6):
        for x in (-1.2, 1.2):
            g += mb.box((0.3, 1.0, 1.0), at=(x, y, 0.0), anchor="bottom", color="tire")
    return g.bake_light()


def _block(floors: int = 10) -> mb.Geo:
    """A ten-storey plaster block: 3.3 m per floor, rows of windows, a roof hut."""
    w, d, fh = 22.0, 14.0, 3.3
    h = floors * fh
    g = mb.box((w, d, h), anchor="bottom", color="bld_cream")
    g.paint("bld_roof_dark", where="top")
    for f in range(floors):
        z = f * fh + 1.15
        if f == 0:
            g += mb.box((w * 0.9, 0.3, 2.3), at=(0, -d / 2, 0.3), anchor="bottom", color="bld_teal_glass_dk")
            continue
        g += mb.box((w * 0.9, d + 0.3, 1.5), at=(0, 0, z), anchor="bottom", color="bld_slate_dk")
        g += mb.box((w + 0.3, d * 0.86, 1.5), at=(0, 0, z), anchor="bottom", color="bld_slate_dk")
    g += mb.box((w + 0.8, d + 0.8, 0.6), at=(0, 0, h), anchor="bottom", color="bld_salmon")
    g += mb.box((5.0, 4.0, 2.6), at=(-5, 1, h + 0.6), anchor="bottom", color="bld_cream_dk")
    return g.bake_light()


def _project(p, eye, target, fov_deg: float, size) -> tuple[float, float]:
    """Pixel position of a model-space point for a free camera (same math as mb.View(eye=, target=))."""
    eye, target, p = Vector(eye), Vector(target), Vector(p)
    f = (target - eye).normalized()
    r = f.cross(Vector((0, 0, 1))).normalized()
    u = r.cross(f).normalized()
    rel = p - eye
    depth = rel.dot(f)
    th = math.tan(math.radians(fov_deg) / 2)
    tv = th * size[1] / size[0]
    return (size[0] / 2 * (1 + rel.dot(r) / (depth * th)), size[1] / 2 * (1 - rel.dot(u) / (depth * tv)))


# =========================================================================================
def lineup(force: bool = False) -> str:
    out = os.path.join(mb.CONCEPT, "kaiju_lizard_lineup.png")
    stamp = _stamp("lineup")
    if not force and _fresh(out, stamp):
        return out
    from PIL import Image, ImageDraw

    mb.reset()
    turn = -24                                       # everyone turns a little to their right, toward the camera
    spots = {"bus": -98.0, 1: -84.0, "block": -60.0, 2: -24.0, 3: 48.0}
    bus_path = mb.contract.model_path("prop_bus")
    if os.path.exists(bus_path):
        _import("prop_bus", at=(spots["bus"], 0, 0), turn=turn)
    else:
        mb.node("lineup_bus", _bus().rz(turn).move(spots["bus"], 0, 0))
    mb.node("lineup_block", _block().rz(-12).move(spots["block"], 6, 0))
    for stage in (1, 2, 3):
        _import(STAGE_IDS[stage], at=(spots[stage], 0, 0), turn=turn)

    size = (1600, 900)
    eye, target, fov = (-40.0, -560.0, 30.0), (-0.5, 0.0, 50.0), 26.0
    view = mb.View("", eye=eye, target=target, fov=fov)
    tmp = os.path.join("/tmp/mb-scratch", "kaiju-lineup")
    os.makedirs(tmp, exist_ok=True)
    main = Image.open(mb.concept("lineup", out=os.path.join(tmp, "main.png"), backdrop="sky", view=view, size=size,
                                 samples=10, sun_azimuth=-40, sun_elevation=48)).convert("RGB")
    # inset: the hatchling and the bus, close up
    eye2, target2, fov2 = (-95.0, -52.0, 4.0), (-91.0, 0.0, 2.5), 32.0
    inset_size = (600, 338)
    inset = Image.open(mb.concept("lineup_inset", out=os.path.join(tmp, "inset.png"), backdrop="sky",
                                  view=mb.View("", eye=eye2, target=target2, fov=fov2), size=inset_size, samples=10,
                                  sun_azimuth=-40, sun_elevation=48)).convert("RGB")
    d = ImageDraw.Draw(main)
    ink, dim = (20, 24, 34), (60, 68, 86)
    f_big, f_small = mb_preview._font(26), mb_preview._font(18)

    def label(x_world, text, sub, dy=0):
        x, y = _project((x_world, 0, 0), eye, target, fov, size)
        tw = d.textlength(text, font=f_big)
        d.text((x - tw / 2, y + 16 + dy), text, font=f_big, fill=ink)
        sw = d.textlength(sub, font=f_small)
        d.text((x - sw / 2, y + 48 + dy), sub, font=f_small, fill=dim)

    label(spots[3], STAGE_NAMES[3], "stage 3 · 115 m")
    label(spots[2], STAGE_NAMES[2], "stage 2 · 32 m")
    label(spots["block"], "ten-storey block", "33 m")
    # height ticks for the two big ones
    for stage, h in ((2, 32.0), (3, 115.0)):
        x0, y0 = _project((spots[stage] + (16 if stage == 2 else 58), 0, 0), eye, target, fov, size)
        _, y1 = _project((spots[stage] + (16 if stage == 2 else 58), 0, h), eye, target, fov, size)
        x0, y0, y1 = round(x0), round(y0), round(y1)
        d.line([(x0, y0), (x0, y1)], fill=dim, width=2)
        for yy in (y0, y1):
            d.line([(x0 - 7, yy), (x0 + 7, yy)], fill=dim, width=2)
        d.text((x0 + 10, (y0 + y1) / 2 - 10), f"{h:g} m", font=f_small, fill=dim)
    # paste the inset bottom left, with a frame and a pointer to where it sits in the big picture
    ix, iy = 28, 78
    px, py = _project((-91, 0, 2.5), eye, target, fov, size)
    d.line([(px, iy + inset_size[1]), (px, py - 22)], fill=(255, 122, 26), width=3)
    bx0, by0 = _project((spots["bus"] - 8, 0, 6.5), eye, target, fov, size)
    bx1, by1 = _project((spots[1] + 4, 0, -1.0), eye, target, fov, size)
    d.rectangle([bx0, by0, bx1, by1], outline=(255, 122, 26), width=3)
    main.paste(inset, (ix, iy))
    d.rectangle([ix - 2, iy - 2, ix + inset_size[0] + 1, iy + inset_size[1] + 1], outline=(255, 122, 26), width=4)
    di = ImageDraw.Draw(main)
    di.rectangle([ix, iy + inset_size[1] - 38, ix + inset_size[0], iy + inset_size[1]], fill=(24, 26, 33))
    di.text((ix + 12, iy + inset_size[1] - 32), "HATCHLING  stage 1 · 4.5 m    beside a 12 m bus", font=f_small,
            fill=(236, 238, 242))
    d.text((24, 18), "GRAGNOR  ·  one kaiju, three molts, to scale", font=f_big, fill=ink)
    return _save(main, out, stamp)


# =========================================================================================
PORTRAIT_POSE = {"torso": {"y": 8}, "neck": {"y": 8, "x": -4}, "head": {"y": 12, "x": -6, "z": -4}, "jaw": {"x": 28},
                 "arm_L": {"z": 6}, "arm_R": {"x": -18, "z": -10}}
# warm key from one side, a warmer ember rim from behind, a little fill: a monster-movie poster.
# (The rim is not cold: a blue-white rim turned the spines cyan, which is the humans' color.)
PORTRAIT_LIGHT = dict(zenith="#0d1020", horizon="#2a2f45", ground="#30343f", key=("#ffd0a0", 3.4),
                      rim=("#ffb27a", 4.2), ambient=0.30, clouds=0.0, cloud="#ffffff", night=False, glow=3.2)


PORTRAIT_FOV = 27.0


def PORTRAIT_EYE(h: float):
    return (0.58 * h, -1.32 * h, 0.60 * h)


def PORTRAIT_TARGET(h: float):
    return (0.0, -0.20 * h, 0.715 * h)


def portrait(force: bool = False) -> str:
    out = os.path.join(UI, "portrait_lizard.png")
    card = os.path.join(mb.CONCEPT, "portrait_lizard.png")
    stamp = _stamp("portrait", PORTRAIT_POSE, PORTRAIT_LIGHT, PORTRAIT_FOV, PORTRAIT_EYE(1.0), PORTRAIT_TARGET(1.0))
    if not force and _fresh(out, stamp) and _fresh(card, stamp):
        return out
    from PIL import Image, ImageDraw, ImageFilter

    mb.load_glb(STAGE_IDS[3])
    bpy.data.objects["weak_point"].hide_render = True       # as in play: shown only while staggered
    h = lizard.HEIGHT[3]
    # camera: low, in front and to the creature's left of the head, looking up at the face;
    # the head fills most of the frame and the eyes sit on its upper third
    view = mb.View("", eye=PORTRAIT_EYE(h), target=PORTRAIT_TARGET(h), fov=PORTRAIT_FOV)
    saved = mb_preview.BACKDROPS["studio"]
    mb_preview.BACKDROPS["studio"] = PORTRAIT_LIGHT
    tmp = os.path.join("/tmp/mb-scratch", "kaiju-lineup")
    os.makedirs(tmp, exist_ok=True)
    try:
        raw = mb.concept("portrait", out=os.path.join(tmp, "portrait.png"), backdrop=None, view=view, size=(512, 512),
                         samples=24, pose=PORTRAIT_POSE, sun_azimuth=-60, sun_elevation=38)
    finally:
        mb_preview.BACKDROPS["studio"] = saved
    img = Image.open(raw).convert("RGBA")
    _save(img, out, stamp)
    # review card: the same picture over a dark vignette with an ember glow behind the head
    bg = Image.new("RGBA", (512, 512), (16, 14, 22, 255))
    glow = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([70, 40, 470, 440], fill=(255, 110, 30, 150))
    bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(70)))
    bg.alpha_composite(img)
    _save(bg.convert("RGB"), card, stamp)
    return out
