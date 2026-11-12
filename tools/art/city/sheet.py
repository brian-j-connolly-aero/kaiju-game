#!/opt/mbtools/venv/bin/python
"""City contact sheets: every state of a building, by day and by night, with people for scale.

    tools/art/city/sheet.py bld_house_a [--out /tmp/mb-scratch/x.png] [--force]

Cells: FRONT (flat, with the scale bar) - THREE-QUARTER - BACK - STREET LEVEL (eye 1.7 m) -
NIGHT (emissive atlas) - DAMAGED - DAMAGED, NIGHT (fires) - RUBBLE (framed like the building)
- CHUNKS (pulled apart). A 1.8 m soldier and the 4.5 m hatchling stand at the front right
corner as dark silhouettes. Writes docs/art/previews/<model>.png. About 4 s per building.
"""
from __future__ import annotations

import math
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if __name__ == "__main__":
    sys.path.insert(0, os.path.join(HERE, "..", "lib"))
    sys.path.insert(0, os.path.join(HERE, ".."))

import numpy as np  # noqa: E402

SHEET_VERSION = "c3"
CELL = (560, 420)


def _emission_mat(name, hexcol, strength=1.0):
    import bpy
    import palette
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*[palette.srgb_to_linear(c) for c in palette.hex_to_rgb(hexcol)], 1.0)
    em.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def _soldier(x, y):
    """A 1.8 m soldier silhouette: legs, body, arms, helmeted head, a rifle."""
    import bpy
    boxes = [((-0.17, -0.08, 0.0), (-0.03, 0.08, 0.85)), ((0.03, -0.08, 0.0), (0.17, 0.08, 0.85)),
             ((-0.22, -0.12, 0.85), (0.22, 0.12, 1.45)), ((-0.32, -0.08, 0.9), (-0.22, 0.08, 1.42)),
             ((0.22, -0.08, 0.9), (0.32, 0.08, 1.42)), ((-0.09, -0.09, 1.45), (0.09, 0.09, 1.56)),
             ((-0.14, -0.14, 1.56), (0.14, 0.14, 1.8)), ((0.26, -0.55, 1.15), (0.32, 0.1, 1.22))]
    verts, faces = [], []
    for lo, hi in boxes:
        b = len(verts)
        for k in range(8):
            verts.append((x + (hi[0] if k & 1 else lo[0]), y + (hi[1] if k & 2 else lo[1]), hi[2] if k & 4 else lo[2]))
        faces += [(b, b + 2, b + 3, b + 1), (b + 4, b + 5, b + 7, b + 6), (b, b + 1, b + 5, b + 4),
                  (b + 2, b + 6, b + 7, b + 3), (b, b + 4, b + 6, b + 2), (b + 1, b + 3, b + 7, b + 5)]
    me = bpy.data.meshes.new("mb_soldier")
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new("mb_soldier", me)
    ob["mb_helper"] = True
    bpy.context.scene.collection.objects.link(ob)
    return [ob]


def _hatchling(x, y):
    import bpy
    import contract
    path = os.path.join(contract.MODELS, "kaiju_lizard_s1.glb")
    if not os.path.exists(path):
        return []
    before = set(bpy.context.scene.objects)
    import mb_preview as P
    with P._quiet():
        bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    for o in new:
        o["mb_helper"] = True
        if o.parent is None:
            o.location = (o.location[0] + x, o.location[1] + y, o.location[2])
    bpy.context.view_layer.update()
    return new


def _paint_helpers(objs, hexcol):
    mat = _emission_mat("mbsheet_silhouette", hexcol)
    for o in objs:
        if o.type == "MESH":
            o.data.materials.clear()
            o.data.materials.append(mat)


def _render(view, size, night, extra_fit, ortho_scale=None, center_z=None):
    import mb_preview as P
    from mathutils import Vector
    tmp = P._tmpdir()
    try:
        with P.posed(view.pose), P._showing(view.show, view.explode):
            pts = P._points()
            fit = pts
            if view.frame:
                with P._showing(view.frame):
                    fit = P._points()
            if extra_fit is not None:
                fit = np.vstack([fit, extra_fit])
            cam = P._solve_camera(view, fit, size[0] / size[1], ortho_scale=ortho_scale, center_z=center_z)
            P._setup_cycles(size, samples=8, bounces=0, denoise=False, transparent=True)
            P._world(lambda nt: P._flat_world(nt, 0.0))
            P._camera_object(cam)
            rot = cam.matrix.to_3x3()
            if night:
                lights = [(rot @ Vector((-0.4, 0.7, 0.6)), 0.10)]
            else:
                lights = [(rot @ Vector((-0.55, 0.65, 0.55)), 0.62), (rot @ Vector((0.80, -0.10, 0.45)), 0.20)]
            if not view.ortho:
                lo, hi = pts.min(axis=0), pts.max(axis=0)
                rad = max(abs(lo[0]), abs(hi[0]), abs(lo[1]), abs(hi[1])) * 1.15 + 0.02
                P._ground_disc(rad)
            with P._preview_materials("sheet", "magenta", glow_strength=1.0, night=night, lights=lights):
                if night:
                    import bpy
                    for mat in bpy.data.materials:
                        if mat.name.startswith("mbprev_") and mat.node_tree:
                            for nd in mat.node_tree.nodes:
                                if nd.bl_idname == "ShaderNodeMapRange":
                                    nd.inputs["To Min"].default_value = 0.035
                                    nd.inputs["To Max"].default_value = 0.10
                img = P._render_to_image(tmp, "view")
    finally:
        P._remove_helpers()
        shutil.rmtree(tmp, ignore_errors=True)
    return img, cam


def _cell(img, view, cam, size, night):
    import mb_preview as P
    from PIL import Image, ImageDraw
    if not night:
        return P._decorate_cell(img, view, cam, size)
    cell = Image.new("RGBA", size, (14, 18, 34, 255))
    cell.alpha_composite(img)
    d = ImageDraw.Draw(cell)
    d.text((10, 8), view.label, font=P._font(17), fill=(236, 238, 242))
    return cell


def city_sheet(mid: str, out: str | None = None, force: bool = False) -> str:
    import mb
    import mb_preview as P
    import contract
    from PIL import Image, ImageDraw
    from PIL.PngImagePlugin import PngInfo
    from . import budgets

    out = out or os.path.join(contract.PREVIEWS, f"{mid}.png")
    path = contract.model_path(mid)
    import hashlib
    with open(path, "rb") as f:
        sha = hashlib.sha1(f.read()).hexdigest()
    atlas_sha = ""
    for p in (os.path.join(contract.TEXTURES, "city_atlas.png"), os.path.join(contract.TEXTURES, "city_atlas_emissive.png")):
        if os.path.exists(p):
            with open(p, "rb") as f:
                atlas_sha += hashlib.sha1(f.read()).hexdigest()[:10]
    stamp = f"{SHEET_VERSION}|{sha}|{atlas_sha}"
    if not force and mb._stamp_ok(out, stamp):
        return out
    mb.load_glb(path)
    aid = mid.split("_", 1)[1]
    arch = contract.archetypes()[aid]
    W, D = arch["footprint"]
    H = arch["height"]
    # scale figures at the front right corner (the model's right is -x; the front is -y)
    sx, sy = -W / 2 - 1.2, -D / 2 - 1.0
    extra = np.array([(sx - 6.0, sy - 2.5, 0.0), (sx + 0.4, sy + 0.4, 4.5)])
    V = P.View
    views = [
        (V("FRONT", azimuth=0, ortho=True, show=("intact",)), False),
        (V("THREE-QUARTER", azimuth=35, elevation=20, fov=28, show=("intact",)), False),
        (V("BACK", azimuth=150, elevation=18, fov=28, show=("intact",)), False),
        (V("STREET LEVEL (eye 1.7 m)", eye=(sx - 4 - W * 0.25, sy - 9 - D * 0.35, 1.7),
           target=(0.0, 0.0, min(H * 0.45, 9.0)), fov=62, show=("intact",)), False),
        (V("NIGHT (emissive atlas)", azimuth=35, elevation=20, fov=28, show=("intact",)), True),
        (V("DAMAGED", azimuth=35, elevation=20, fov=28, show=("damaged",), frame=("intact",)), False),
        (V("DAMAGED, NIGHT", azimuth=215, elevation=20, fov=28, show=("damaged",), frame=("intact",)), True),
        (V("RUBBLE", azimuth=35, elevation=20, fov=28, show=("rubble",), frame=("intact",)), False),
        (V("CHUNKS (pulled apart)", azimuth=35, elevation=20, fov=28, show=("chunk_*",), explode=0.45), False),
    ]
    cells = []
    for v, night in views:
        helpers = _soldier(sx, sy) + _hatchling(sx - 3.2, sy - 0.6)    # the render removes them again
        _paint_helpers(helpers, "#5a6278" if night else "#2b3040")
        fit = extra if v.eye is None else None
        img, cam = _render(v, CELL, night, fit)
        cells.append(_cell(img, v, cam, CELL, night))
    # facts
    import glb as glbfile
    g = glbfile.load(path)
    tri = {s: g.tris(g.subtree(s)) for s in ("intact", "damaged", "rubble")}
    n_chunks = sum(1 for n in g.node_names() if n.startswith("chunk_"))
    cols, rows = 3, 3
    head = 54
    sheet = Image.new("RGB", (cols * CELL[0] + 4, head + rows * CELL[1] + 4), (24, 26, 33))
    d = ImageDraw.Draw(sheet)
    d.text((12, 8), f"{mid}   ({aid}, {arch['class']}, {W:g} x {D:g} m, {H:g} m tall)", font=P._font(22),
           fill=(236, 238, 242))
    lim = budgets.budget(aid)
    info = (f"triangles: intact {tri['intact']}, damaged {tri['damaged']}, rubble {tri['rubble']} (budget {lim} each); "
            f"{n_chunks} chunks.   Scale: 1.8 m soldier, 4.5 m hatchling (dark silhouettes).")
    d.text((12, 34), info, font=P._font(14), fill=(160, 168, 182))
    for i, c in enumerate(cells):
        sheet.paste(c.convert("RGB"), ((i % cols) * (CELL[0] + 2), head + (i // cols) * (CELL[1] + 2)))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    meta = PngInfo()
    meta.add_text("mb_stamp", stamp)
    sheet.save(out, pnginfo=meta)
    return out


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="+")
    ap.add_argument("--out")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    from city import sheet as _s
    for mid in a.ids:
        print(_s.city_sheet(mid, out=a.out, force=True))
