"""Preview rendering and posing for mb (import it through `mb`, not directly).

Two kinds of picture, both rendered headless with Cycles on the CPU (2 threads):

  contact_sheet()  front, left side, back and three-quarter views (plus optional extras
                   such as the first-person camera), evenly lit, with a ground line, an
                   origin marker and a scale bar. For checking shape, scale and facing.
  concept()        one lit beauty shot: sky or studio backdrop, key and rim light, soft
                   contact shadow on the ground. For judging whether it looks good.

Both render whatever is in the current scene, so they work the same on a model you just
built and on a .glb loaded back with load_glb(). Faces seen from behind are painted hot
magenta on contact sheets: the game does not draw them, so magenta means a hole in-game.
"""
from __future__ import annotations

import contextlib
import math
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass, field

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

_LIB = os.path.dirname(os.path.abspath(__file__))
if _LIB not in sys.path:
    sys.path.insert(0, _LIB)

import contract  # noqa: E402
import palette  # noqa: E402

PREVIEW_VERSION = "p1"          # bump to force every preview to re-render
THREADS = 2                     # shared 4-core machine: never more than 2
_SCRATCH = "/tmp/mb-scratch"
COLOR_ATTR = "Color"

_FWD = Vector((0.0, -1.0, 0.0))
_LEFT = Vector((1.0, 0.0, 0.0))
_UP = Vector((0.0, 0.0, 1.0))


# =========================================================================================
# Posing
# =========================================================================================
_G2B = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))      # glTF axes -> Blender axes


def _euler_gltf_to_blender(x: float, y: float, z: float) -> Quaternion:
    """three.js style Euler XYZ (degrees, glTF axes) -> Blender quaternion."""
    rg = (Matrix.Rotation(math.radians(x), 3, "X") @ Matrix.Rotation(math.radians(y), 3, "Y")
          @ Matrix.Rotation(math.radians(z), 3, "Z"))
    return (_G2B @ rg @ _G2B.transposed()).to_quaternion()


def _asset_objects():
    return [o for o in bpy.context.scene.objects
            if o.type in ("MESH", "EMPTY") and not o.get("mb_helper")]


def pose(spec: dict) -> None:
    """Rotate named nodes around their pivots, the way the game code will.

    spec = {"jaw": {"x": 25}, "arm_L": (0, 0, -40), "hips": {"y": 10, "move": (0, -0.3, 0)}}
    Angles are degrees in the GAME's axes (glTF / three.js, Euler order XYZ), i.e. exactly
    what a programmer writes as node.rotation.x/y/z:
        x+  pitches the nose down        (jaw opens with x+, head nods with x+)
        y+  turns to the model's left    (yaw, same sign as the game's heading)
        z+  rolls the left side up
    "move" shifts the node in game axes (x left, y up, z forward), in meters.
    Poses are for previews only: export_glb() refuses a posed scene; call clear_pose().
    """
    for name, val in (spec or {}).items():
        ob = bpy.data.objects.get(name)
        if ob is None:
            raise KeyError(f"pose: no node named {name!r}")
        if isinstance(val, dict):
            x, y, z = val.get("x", 0.0), val.get("y", 0.0), val.get("z", 0.0)
            move = val.get("move")
        else:
            x, y, z = val
            move = None
        if "mb_rest" not in ob:
            ob["mb_rest"] = list(ob.location)
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = _euler_gltf_to_blender(x, y, z)
        rest = Vector(ob["mb_rest"])
        if move is not None:
            rest = rest + Vector((move[0], -move[2], move[1]))
        ob.location = rest
    bpy.context.view_layer.update()


def clear_pose() -> None:
    """Put every node back in the rest pose."""
    for ob in _asset_objects():
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = (1, 0, 0, 0)
        ob.rotation_euler = (0, 0, 0)
        if "mb_rest" in ob:
            ob.location = Vector(ob["mb_rest"])
            del ob["mb_rest"]
    bpy.context.view_layer.update()


@contextlib.contextmanager
def posed(spec: dict | None):
    """with mb.posed({...}): render something; the rest pose comes back afterwards."""
    if not spec:
        yield
        return
    pose(spec)
    try:
        yield
    finally:
        clear_pose()


def _matches(name: str, patterns) -> bool:
    for p in patterns:
        if p.endswith("*"):
            if name.startswith(p[:-1]):
                return True
        elif name == p:
            return True
    return False


@contextlib.contextmanager
def _showing(show, explode: float = 0.0):
    """Temporarily hide every node not named in `show` (children follow their parents),
    and optionally spread the chunk_* nodes apart."""
    saved_vis, saved_loc = [], []
    try:
        if show:
            patterns = (show,) if isinstance(show, str) else tuple(show)
            for ob in _asset_objects():
                chain, o = [], ob
                while o is not None:
                    chain.append(o.name)
                    o = o.parent
                saved_vis.append((ob, ob.hide_render))
                ob.hide_render = not any(_matches(n, patterns) for n in chain)
        if explode:
            chunks = [o for o in _asset_objects() if o.name.startswith("chunk_")]
            if chunks:
                bpy.context.view_layer.update()
                mid = sum((o.matrix_world.to_translation() for o in chunks), Vector((0, 0, 0))) / len(chunks)
                for o in chunks:
                    saved_loc.append((o, o.location.copy()))
                    off = (o.matrix_world.to_translation() - mid) * explode
                    off.z = max(off.z, 0.0) + (o.matrix_world.to_translation().z) * explode * 0.5
                    o.location = o.location + off
        bpy.context.view_layer.update()
        yield
    finally:
        for ob, hidden in saved_vis:
            ob.hide_render = hidden
        for ob, loc in saved_loc:
            ob.location = loc
        bpy.context.view_layer.update()


# =========================================================================================
# Loading a .glb back in
# =========================================================================================
def load_glb(asset: str) -> list:
    """Replace the scene with an exported model (asset id or path). Returns its objects.

    After this the scene looks just like it did when the model was built: same node names,
    same axes (Blender frame), so contact_sheet(), concept() and pose() all work on it.
    """
    path = contract.model_path(asset)
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with _quiet():
        bpy.ops.import_scene.gltf(filepath=path, import_shading="NORMALS", merge_vertices=False)
    for ob in bpy.context.scene.objects:
        ob.rotation_mode = "QUATERNION"
        ob.select_set(False)
    bpy.context.view_layer.update()
    return _asset_objects()


@contextlib.contextmanager
def _quiet():
    if os.environ.get("MB_VERBOSE"):
        yield
        return
    sys.stdout.flush()
    sys.stderr.flush()
    saved = os.dup(1), os.dup(2)
    null = os.open(os.devnull, os.O_WRONLY)
    try:
        os.dup2(null, 1)
        os.dup2(null, 2)
        yield
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        os.dup2(saved[0], 1)
        os.dup2(saved[1], 2)
        for fd in (*saved, null):
            os.close(fd)


# =========================================================================================
# Views
# =========================================================================================
@dataclass
class View:
    """A camera for a preview.

    Orbit views (the default) circle the model:
        azimuth    0 = camera in front of the model, 90 = at its left side, 180 = behind
        elevation  degrees above the horizon (90 = straight down from above)
        ortho      True for a flat technical view (with ground line and scale bar)
        fov        horizontal field of view in degrees for perspective views
    Node views sit on a named node and look where it looks (the model's forward):
        View("FIRST PERSON", node="cam_fp", fov=80)
    Free views take explicit points in the authoring frame:
        View("LOW ANGLE", eye=(3, -6, 0.4), target=(0, 0, 2))
    pose: an optional pose just for this view (see mb.pose()).
    zoom: > 1 moves closer.
    show: draw only these nodes and what hangs under them, e.g. show=("intact",) or
          show=("chunk_*",): buildings keep all their states in one file, on top of each
          other, so each view must pick one.
    explode: spread the chunk_* nodes apart so the pieces can be told from each other.
    frame: fit the camera to these nodes instead of the ones shown, e.g. frame=("intact",)
          on a rubble view keeps the building's framing so the pile's real size is clear.
    """
    label: str = ""
    azimuth: float = 0.0
    elevation: float = 0.0
    ortho: bool = False
    fov: float = 30.0
    node: str | None = None
    eye: tuple | None = None
    target: tuple | None = None
    pose: dict | None = None
    zoom: float = 1.0
    cull_backfaces: bool | None = None      # None: magenta on orbit views, hidden on node views
    show: tuple | None = None               # only these nodes (and their children); "chunk_*" works
    explode: float = 0.0                    # push chunk_* nodes apart by this fraction (0.4 is clear)
    frame: tuple | None = None              # aim the camera at these nodes instead of what is shown


STANDARD_VIEWS = {
    "front": View("FRONT", azimuth=0, ortho=True),
    "side": View("LEFT SIDE", azimuth=90, ortho=True),
    "left": View("LEFT SIDE", azimuth=90, ortho=True),
    "right": View("RIGHT SIDE", azimuth=-90, ortho=True),
    "back": View("BACK", azimuth=180, ortho=True),
    "top": View("TOP", elevation=90, ortho=True),
    "three_quarter": View("THREE-QUARTER", azimuth=35, elevation=20, fov=28),
    "three_quarter_back": View("THREE-QUARTER BACK", azimuth=145, elevation=20, fov=28),
}
DEFAULT_SHEET = ("front", "side", "back", "three_quarter")


def _view(v) -> View:
    if isinstance(v, View):
        return v
    if v in STANDARD_VIEWS:
        return STANDARD_VIEWS[v]
    raise KeyError(f"unknown view {v!r}; use one of {sorted(STANDARD_VIEWS)} or an mb.View")


def _points() -> np.ndarray:
    """All asset vertices in world space, current pose."""
    bpy.context.view_layer.update()
    chunks = []
    for ob in _asset_objects():
        if ob.type != "MESH" or not len(ob.data.vertices) or ob.hide_render:
            continue
        co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
        ob.data.vertices.foreach_get("co", co)
        m = np.array(ob.matrix_world)
        chunks.append(co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3])
    if not chunks:
        return np.zeros((1, 3))
    return np.vstack(chunks)


def _orbit_axes(azimuth: float, elevation: float):
    """(direction from target to camera, right, up) for an orbit view."""
    az, el = math.radians(azimuth), math.radians(elevation)
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    f = -d
    # looking straight down (or up): "up" on screen is the direction away from the camera's side
    upref = _UP if abs(d.z) < 0.999 else Vector((-math.sin(az), math.cos(az), 0.0)) * (1 if d.z > 0 else -1)
    r = f.cross(upref).normalized()
    u = r.cross(f).normalized()
    return d, r, u


@dataclass
class _Cam:
    matrix: Matrix
    ortho: bool
    ortho_scale: float = 1.0
    fov: float = 30.0
    clip: tuple = (0.01, 1000.0)
    target: Vector = field(default_factory=lambda: Vector((0, 0, 0)))
    right: Vector = field(default_factory=lambda: Vector((1, 0, 0)))
    up: Vector = field(default_factory=lambda: Vector((0, 0, 1)))
    distance: float = 1.0


def _solve_camera(view: View, pts: np.ndarray, aspect: float, margin: float = 1.22,
                  ortho_scale: float | None = None, center_z: float | None = None) -> _Cam:
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    radius = float(np.linalg.norm(hi - lo)) / 2 or 1.0
    if view.node is not None:
        ob = bpy.data.objects.get(view.node)
        if ob is None:
            raise KeyError(f"view {view.label!r}: no node named {view.node!r}")
        bpy.context.view_layer.update()
        fix = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        m = ob.matrix_world.normalized() @ fix
        return _Cam(matrix=m, ortho=False, fov=view.fov, clip=(radius * 0.004, radius * 40 + 10),
                    target=m.to_translation(), distance=radius)
    if view.eye is not None:
        eye = Vector(view.eye)
        tgt = Vector(view.target) if view.target is not None else Vector((lo + hi) / 2)
        f = (tgt - eye).normalized()
        r = f.cross(_UP).normalized() if abs(f.z) < 0.999 else Vector((1, 0, 0))
        u = r.cross(f).normalized()
        m = Matrix(((r.x, u.x, -f.x, eye.x), (r.y, u.y, -f.y, eye.y), (r.z, u.z, -f.z, eye.z), (0, 0, 0, 1)))
        dist = (tgt - eye).length
        return _Cam(matrix=m, ortho=False, fov=view.fov, clip=(max(dist * 0.01, 0.01), dist * 20 + radius * 20),
                    target=tgt, right=r, up=u, distance=dist)
    d, r, u = _orbit_axes(view.azimuth, view.elevation)
    center = Vector((lo + hi) / 2)
    rel = pts - np.array(center)
    px, py, pd = rel @ np.array(r), rel @ np.array(u), rel @ np.array(d)
    # recenter on the projected extents so the model sits in the middle of the frame
    cx, cy = (px.min() + px.max()) / 2, (py.min() + py.max()) / 2
    center = center + r * cx + u * cy
    if view.ortho and center_z is not None and abs(view.elevation) < 1:
        center.z = center_z
    rel = pts - np.array(center)
    px, py, pd = rel @ np.array(r), rel @ np.array(u), rel @ np.array(d)
    if view.ortho:
        need = max(np.abs(px).max() * 2, np.abs(py).max() * 2 * aspect, 1e-3) * margin / view.zoom
        scale = ortho_scale if ortho_scale is not None else need
        if abs(view.elevation) < 1:
            center = center - u * (scale / aspect * 0.035)      # room under the ground line
        dist = radius * 4 + 1
        eye = center + d * dist
        m = Matrix(((r.x, u.x, d.x, eye.x), (r.y, u.y, d.y, eye.y), (r.z, u.z, d.z, eye.z), (0, 0, 0, 1)))
        return _Cam(matrix=m, ortho=True, ortho_scale=scale, clip=(0.01, dist * 2 + radius * 4),
                    target=center, right=r, up=u, distance=dist)
    th = math.tan(math.radians(view.fov) / 2)
    tv = th / aspect
    margin = 1.0 + (margin - 1.0) * 0.6            # perspective views can sit a little tighter
    dist = 1.0
    for _ in range(4):          # fit, then slide the target until the picture is centered
        rel = pts - np.array(center)
        px, py, pd = rel @ np.array(r), rel @ np.array(u), rel @ np.array(d)
        dist = float(max((pd + np.abs(px) / th * margin).max(), (pd + np.abs(py) / tv * margin).max()))
        dist = max(dist, 1e-3)
        depth = np.maximum(dist - pd, 1e-6)
        sx, sy = px / (depth * th), py / (depth * tv)
        mx, my = (sx.min() + sx.max()) / 2, (sy.min() + sy.max()) / 2
        if abs(mx) < 0.01 and abs(my) < 0.01:
            break
        center = center + r * (mx * dist * th) + u * (my * dist * tv)
    dist /= view.zoom
    eye = center + d * dist
    m = Matrix(((r.x, u.x, d.x, eye.x), (r.y, u.y, d.y, eye.y), (r.z, u.z, d.z, eye.z), (0, 0, 0, 1)))
    return _Cam(matrix=m, ortho=False, fov=view.fov, clip=(max(dist * 0.02, 0.005), dist * 30 + radius * 30),
                target=center, right=r, up=u, distance=dist)


# =========================================================================================
# Preview materials
# =========================================================================================
def _sock(sockets, identifier: str):
    """Socket by identifier (Mix nodes have several sockets with the same display name)."""
    for s in sockets:
        if s.identifier == identifier:
            return s
    raise KeyError(identifier)


def _mix_rgb(nt, a=None, b=None, factor=None, blend: str = "MIX"):
    """A color Mix node; a, b, factor are sockets to link or constant values. Returns (node, result)."""
    node = nt.nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    node.blend_type = blend
    for ident, val in (("A_Color", a), ("B_Color", b), ("Factor_Float", factor)):
        sock = _sock(node.inputs, ident)
        if val is None:
            continue
        if hasattr(val, "is_linked"):
            nt.links.new(val, sock)
        else:
            sock.default_value = val
    return node, _sock(node.outputs, "Result_Color")


def _placeholder_atlas():
    """A numbered-looking color grid used when textures/city_atlas.png does not exist yet."""
    img = bpy.data.images.get("mb_atlas_placeholder")
    if img is not None:
        return img
    n, cells = 128, 8
    px = np.zeros((n, n, 4), dtype=np.float32)
    cs = n // cells
    for j in range(cells):
        for i in range(cells):
            import colorsys
            r, g, b = colorsys.hsv_to_rgb(((i * 3 + j * 5) % 16) / 16.0, 0.35, 0.9 if (i + j) % 2 else 0.7)
            px[j * cs:(j + 1) * cs, i * cs:(i + 1) * cs, :3] = (r, g, b)
            px[j * cs:j * cs + 1, i * cs:(i + 1) * cs, :3] *= 0.5
            px[j * cs:(j + 1) * cs, i * cs:i * cs + 1, :3] *= 0.5
    px[..., 3] = 1.0
    img = bpy.data.images.new("mb_atlas_placeholder", n, n, alpha=False)
    img.pixels.foreach_set(px.reshape(-1))
    return img


ATLAS_OVERRIDE: dict[str, str | None] = {"color": None, "emissive": None}


def set_preview_atlas(color_png: str | None, emissive_png: str | None = None) -> None:
    """Use these images for `city_atlas` faces in previews instead of the shipped
    client/public/assets/textures/city_atlas.png (handy while the atlas is being drawn).
    Pass None to go back to the shipped atlas. Previews only: nothing is embedded in .glb."""
    ATLAS_OVERRIDE["color"] = color_png
    ATLAS_OVERRIDE["emissive"] = emissive_png


def _atlas_image(emissive: bool = False):
    path = ATLAS_OVERRIDE["emissive" if emissive else "color"] or os.path.join(
        contract.TEXTURES, "city_atlas_emissive.png" if emissive else "city_atlas.png")
    if os.path.exists(path):
        for img in bpy.data.images:
            if img.get("mb_src") == path:
                return img
        img = bpy.data.images.load(path)
        img["mb_src"] = path
        return img
    return None if emissive else _placeholder_atlas()


def _preview_material(kind: str, style: str, backface: str, glow_strength: float, night: bool,
                      lights=()):
    """kind: vcol | glow | city_atlas.

    style 'sheet': all lighting is computed in the shader from the face normal (a sky/ground
    ambient plus the directional `lights` = [(direction_to_light, strength), ...]), so the
    result is noise-free and looks like the game's simple lighting.
    style 'lit': a plain diffuse surface for path tracing with real lights and shadows.
    """
    name = f"mbprev_{kind}"
    mat = bpy.data.materials.new(name)
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    N, L = nt.nodes.new, nt.links.new
    out = N("ShaderNodeOutputMaterial")
    vc = N("ShaderNodeVertexColor")
    vc.layer_name = COLOR_ATTR
    color = vc.outputs["Color"]
    emissive_tex = None
    if kind == contract.MAT_ATLAS:
        tex = N("ShaderNodeTexImage")
        tex.image = _atlas_image()
        tex.interpolation = "Closest"
        _, color = _mix_rgb(nt, tex.outputs["Color"], vc.outputs["Color"], 1.0, "MULTIPLY")
        if night and _atlas_image(True) is not None:
            emissive_tex = N("ShaderNodeTexImage")
            emissive_tex.image = _atlas_image(True)
            emissive_tex.interpolation = "Closest"
    geo = N("ShaderNodeNewGeometry")
    if kind == contract.MAT_GLOW:
        front = N("ShaderNodeEmission")
        L(color, front.inputs["Color"])
        front.inputs["Strength"].default_value = glow_strength
        front_out = front.outputs["Emission"]
    else:
        diff = N("ShaderNodeBsdfDiffuse")
        L(color, diff.inputs["Color"])
        front_out = diff.outputs["BSDF"]
        if style == "sheet":
            sep = N("ShaderNodeSeparateXYZ")
            L(geo.outputs["Normal"], sep.inputs["Vector"])
            rng = N("ShaderNodeMapRange")
            rng.inputs["From Min"].default_value = -1.0
            rng.inputs["From Max"].default_value = 1.0
            rng.inputs["To Min"].default_value = 0.22      # light from the ground
            rng.inputs["To Max"].default_value = 0.44      # light from the sky
            L(sep.outputs["Z"], rng.inputs["Value"])
            total = rng.outputs["Result"]
            for direction, strength in lights:
                dot = N("ShaderNodeVectorMath")
                dot.operation = "DOT_PRODUCT"
                L(geo.outputs["Normal"], dot.inputs[0])
                dot.inputs[1].default_value = tuple(Vector(direction).normalized())
                lam = N("ShaderNodeMath")
                lam.operation = "MAXIMUM"
                L(dot.outputs["Value"], lam.inputs[0])
                lam.inputs[1].default_value = 0.0
                mul = N("ShaderNodeMath")
                mul.operation = "MULTIPLY"
                L(lam.outputs["Value"], mul.inputs[0])
                mul.inputs[1].default_value = strength
                add = N("ShaderNodeMath")
                add.operation = "ADD"
                L(total, add.inputs[0])
                L(mul.outputs["Value"], add.inputs[1])
                total = add.outputs["Value"]
            shade = N("ShaderNodeEmission")
            L(color, shade.inputs["Color"])
            L(total, shade.inputs["Strength"])
            front_out = shade.outputs["Emission"]
        if emissive_tex is not None:
            lit = N("ShaderNodeEmission")
            L(emissive_tex.outputs["Color"], lit.inputs["Color"])
            lit.inputs["Strength"].default_value = glow_strength
            add2 = N("ShaderNodeAddShader")
            L(front_out, add2.inputs[0])
            L(lit.outputs["Emission"], add2.inputs[1])
            front_out = add2.outputs["Shader"]
    if backface == "show":
        L(front_out, out.inputs["Surface"])
        return mat
    if backface == "cull":
        back = N("ShaderNodeBsdfTransparent")
        back_out = back.outputs["BSDF"]
    else:
        back = N("ShaderNodeEmission")
        back.inputs["Color"].default_value = (1.0, 0.0, 0.85, 1.0)
        back.inputs["Strength"].default_value = 1.0
        back_out = back.outputs["Emission"]
    mix = N("ShaderNodeMixShader")
    L(geo.outputs["Backfacing"], mix.inputs["Fac"])
    L(front_out, mix.inputs[1])
    L(back_out, mix.inputs[2])
    L(mix.outputs["Shader"], out.inputs["Surface"])
    return mat


@contextlib.contextmanager
def _preview_materials(style: str, backface: str, glow_strength: float = 1.0, night: bool = False,
                       lights=()):
    saved = []
    made: dict[str, object] = {}
    for ob in _asset_objects():
        if ob.type != "MESH":
            continue
        me = ob.data
        if not len(me.materials):
            me.materials.append(None)
        for i, m in enumerate(me.materials):
            base = (m.name.split(".")[0] if m is not None else contract.MAT_VCOL)
            if base.startswith("mbprev_"):
                continue
            kind = base if base in contract.MATERIALS else contract.MAT_VCOL
            if kind not in made:
                made[kind] = _preview_material(kind, style, backface, glow_strength, night, lights)
            saved.append((me, i, m))
            me.materials[i] = made[kind]
    try:
        yield
    finally:
        for me, i, m in saved:
            me.materials[i] = m
        for mat in made.values():
            bpy.data.materials.remove(mat)


# =========================================================================================
# Rendering
# =========================================================================================
def _helper(ob):
    ob["mb_helper"] = True
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _remove_helpers() -> None:
    for ob in [o for o in bpy.context.scene.objects if o.get("mb_helper")]:
        data = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if data is not None and data.users == 0:
            for coll in (bpy.data.cameras, bpy.data.lights, bpy.data.meshes):
                if data.name in coll and coll[data.name] == data:
                    coll.remove(data)
                    break
    for mat in [m for m in bpy.data.materials if m.name.startswith("mbprev_") and m.users == 0]:
        bpy.data.materials.remove(mat)


def _camera_object(cam: _Cam):
    cd = bpy.data.cameras.new("mb_cam")
    cd.sensor_fit = "HORIZONTAL"
    if cam.ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = cam.ortho_scale
    else:
        cd.type = "PERSP"
        cd.angle = math.radians(cam.fov)
    cd.clip_start, cd.clip_end = cam.clip
    ob = _helper(bpy.data.objects.new("mb_cam", cd))
    ob.matrix_world = cam.matrix
    bpy.context.scene.camera = ob
    return ob


def _sun(direction_to_light: Vector, strength: float, color=(1, 1, 1), angle_deg: float = 0.0,
         shadow: bool = False):
    ld = bpy.data.lights.new("mb_sun", "SUN")
    ld.energy = strength
    ld.color = color
    ld.angle = math.radians(angle_deg)
    ld.use_shadow = shadow
    ob = _helper(bpy.data.objects.new("mb_sun", ld))
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = direction_to_light.normalized().to_track_quat("Z", "Y")
    return ob


def _setup_cycles(size, samples: int, bounces: int, denoise: bool, transparent: bool) -> None:
    with _quiet():
        _setup_cycles_inner(size, samples, bounces, denoise, transparent)


def _setup_cycles_inner(size, samples: int, bounces: int, denoise: bool, transparent: bool) -> None:
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.render.threads_mode = "FIXED"
    sc.render.threads = THREADS
    sc.render.resolution_x, sc.render.resolution_y = int(size[0]), int(size[1])
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.dither_intensity = 0.0
    sc.render.use_compositing = False
    sc.render.use_sequencer = False
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.max_bounces = bounces
    sc.cycles.diffuse_bounces = bounces
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    sc.cycles.volume_bounces = 0
    sc.cycles.transparent_max_bounces = 16
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.seed = 0
    sc.cycles.use_denoising = False
    if denoise:
        try:
            sc.cycles.denoiser = "OPENIMAGEDENOISE"
            sc.cycles.use_denoising = True
        except Exception:
            sc.cycles.use_denoising = False
    try:
        sc.view_settings.view_transform = "Standard"
        sc.view_settings.look = "None"
    except Exception:
        pass
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0


def _world(build) -> None:
    sc = bpy.context.scene
    w = bpy.data.worlds.get("mb_world") or bpy.data.worlds.new("mb_world")
    sc.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    build(nt)


def _render_to_image(tmpdir: str, name: str):
    from PIL import Image
    path = os.path.join(tmpdir, name + ".png")
    bpy.context.scene.render.filepath = path
    with _quiet():
        bpy.ops.render.render(write_still=True)
    if not os.path.exists(path):
        raise RuntimeError("render produced no image (Cycles needs an absolute, writable output path)")
    with Image.open(path) as im:
        return im.convert("RGBA")


def _tmpdir() -> str:
    os.makedirs(_SCRATCH, exist_ok=True)
    return tempfile.mkdtemp(prefix="mbprev_", dir=_SCRATCH)


def render_view(view, size=(600, 450), ortho_scale: float | None = None, center_z: float | None = None,
                ground_disc: bool = False):
    """Render one evenly lit view of the current scene. Returns (PIL RGBA image, camera info).

    This is the building block of contact_sheet(); use it directly for one-off checks:
        img, _ = mb.render_view("front"); img.save("/tmp/mb-scratch/x.png")
    """
    view = _view(view)
    tmp = _tmpdir()
    try:
        with posed(view.pose), _showing(view.show, view.explode):
            pts = _points()
            fit = pts
            if view.frame:
                with _showing(view.frame):
                    fit = _points()
            cam = _solve_camera(view, fit, size[0] / size[1], ortho_scale=ortho_scale, center_z=center_z)
            cull = view.cull_backfaces if view.cull_backfaces is not None else view.node is not None
            _setup_cycles(size, samples=8, bounces=0, denoise=False, transparent=True)
            _world(lambda nt: _flat_world(nt, 0.0))
            _camera_object(cam)
            rot = cam.matrix.to_3x3()
            lights = [(rot @ Vector((-0.55, 0.65, 0.55)), 0.62),      # key: upper left of the camera
                      (rot @ Vector((0.80, -0.10, 0.45)), 0.20)]      # fill: from the right
            if ground_disc:
                lo, hi = pts.min(axis=0), pts.max(axis=0)
                rad = max(abs(lo[0]), abs(hi[0]), abs(lo[1]), abs(hi[1])) * 1.15 + 0.02
                _ground_disc(rad)
            with _preview_materials("sheet", "cull" if cull else "magenta", lights=lights):
                img = _render_to_image(tmp, "view")
    finally:
        _remove_helpers()
        shutil.rmtree(tmp, ignore_errors=True)
    return img, cam


def _flat_world(nt, strength: float, color=(1, 1, 1)) -> None:
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (*color, 1.0)
    bg.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def _ground_disc(radius: float, n: int = 48):
    """A faint disc centered on the origin: shows the footprint and where the origin is."""
    me = bpy.data.meshes.new("mb_disc")
    verts = [(radius * math.cos(2 * math.pi * k / n), radius * math.sin(2 * math.pi * k / n), 0.0)
             for k in range(n)]
    me.from_pydata(verts, [], [list(range(n))])
    me.update()
    mat = bpy.data.materials.get("mbprev_disc") or bpy.data.materials.new("mbprev_disc")
    nt = mat.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.065, 0.075, 0.10, 1.0)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    me.materials.append(mat)
    ob = _helper(bpy.data.objects.new("mb_disc", me))
    ob.location = (0, 0, -radius * 0.002)
    return ob


# ---- contact sheet ----------------------------------------------------------------------
_BG = (58, 63, 76)
_BG2 = (46, 50, 62)
_INK = (236, 238, 242)
_DIM = (160, 168, 182)


def _font(size: int):
    from PIL import ImageFont
    return ImageFont.load_default(size=size)


def _nice_length(max_len: float) -> float:
    """Largest 1/2/5 x 10^k length not above max_len (for scale bars)."""
    if max_len <= 0:
        return 1.0
    k = math.floor(math.log10(max_len))
    for m in (5, 2, 1):
        if m * 10 ** k <= max_len:
            return m * 10 ** k
    return 10 ** k


def _fmt_m(v: float) -> str:
    if v >= 1:
        return f"{v:g} m"
    return f"{v * 100:g} cm"


def _scene_facts() -> dict:
    """Size, triangle and node counts of the current scene in the rest pose."""
    pts = _points()
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    objs = [o for o in _asset_objects() if not o.hide_render]
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == "MESH")
    return {"size": (hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]), "tris": tris, "nodes": len(objs)}


def _decorate_cell(img, view: View, cam: _Cam, size):
    """Compose one rendered view over the cell background with label, ground line, scale bar."""
    from PIL import Image, ImageDraw
    w, h = size
    cell = Image.new("RGBA", (w, h), _BG + (255,))
    d = ImageDraw.Draw(cell)
    if cam.ortho:
        ppm = w / cam.ortho_scale                                   # pixels per meter

        def to_px(p):
            rel = Vector(p) - cam.target
            return (w / 2 + rel.dot(cam.right) * ppm, h / 2 - rel.dot(cam.up) * ppm)

        if abs(cam.up.z) > 0.99:                                    # side-on views: ground at z = 0
            gy = to_px((0, 0, 0))[1]
            d.rectangle([0, gy, w, h], fill=_BG2 + (255,))
            d.line([(0, gy), (w, gy)], fill=(120, 128, 144, 255), width=1)
            ox = to_px((0, 0, 0))[0]
            d.polygon([(ox, gy + 2), (ox - 6, gy + 12), (ox + 6, gy + 12)], fill=(255, 217, 26, 255))
        else:                                                       # top view: crosshair at the origin
            ox, oy = to_px((0, 0, 0))
            d.line([(ox - 9, oy), (ox + 9, oy)], fill=(255, 217, 26, 255), width=1)
            d.line([(ox, oy - 9), (ox, oy + 9)], fill=(255, 217, 26, 255), width=1)
    cell.alpha_composite(img)
    d = ImageDraw.Draw(cell)
    f_label, f_small = _font(17), _font(13)
    d.text((10, 8), view.label, font=f_label, fill=_INK)
    if cam.ortho:
        ppm = w / cam.ortho_scale
        bar = _nice_length(cam.ortho_scale * 0.25)
        bx1, by = w - 12, 26                                        # scale bar: top right
        bx0 = bx1 - bar * ppm
        d.line([(bx0, by), (bx1, by)], fill=_INK, width=2)
        d.line([(bx0, by - 4), (bx0, by + 4)], fill=_INK, width=2)
        d.line([(bx1, by - 4), (bx1, by + 4)], fill=_INK, width=2)
        txt = _fmt_m(bar)
        d.text((bx1 - d.textlength(txt, font=f_small), by - 19), txt, font=f_small, fill=_INK)
        # which way the model faces / which side is its left, as seen in this view
        fr, lr = _FWD.dot(cam.right), _LEFT.dot(cam.right)
        y = h - 20
        if abs(fr) > 0.7:
            txt = "front >" if fr > 0 else "< front"
            x = w - 10 - d.textlength(txt, font=f_small) if fr > 0 else 10
            d.text((x, y), txt, font=f_small, fill=_DIM)
        elif abs(lr) > 0.7:
            a, b = ("model's right", "model's left") if lr > 0 else ("model's left", "model's right")
            d.text((10, y), a, font=f_small, fill=_DIM)
            d.text((w - 10 - d.textlength(b, font=f_small), y), b, font=f_small, fill=_DIM)
    return cell


def contact_sheet(name: str, out: str | None = None, views=DEFAULT_SHEET, extra=(), pose: dict | None = None,
                  show=None, cell=(600, 450), title: str | None = None, stamp: str | None = None) -> str:
    """Render the review sheet of the current scene to docs/art/previews/<name>.png.

    views:  the standard four ("front", "side", "back", "three_quarter"); also available:
            "right", "top", "three_quarter_back".
    extra:  more views appended after them: names from the list above or mb.View objects,
            e.g. extra=[mb.View("FIRST PERSON", node="cam_fp", fov=80,
                                pose={"arm_L": {"x": -70}, "arm_R": {"x": -70}})]
    pose:   a pose (see mb.pose()) applied to every view that has none of its own.
    show:   draw only these nodes (and their children) in every view that does not say
            otherwise, e.g. show=("intact",). See mb.View.
    out:    another output path (use /tmp/mb-scratch/... while iterating).
    Returns the path written. Ortho views share one scale, show the ground line (y = 0),
    a yellow marker at the origin and a scale bar; magenta marks faces seen from behind.
    """
    from PIL import Image, ImageDraw
    from PIL.PngImagePlugin import PngInfo

    out = out or os.path.join(contract.PREVIEWS, f"{name}.png")
    all_views = [_view(v) for v in list(views) + list(extra)]
    if pose or show:
        all_views = [View(**{**v.__dict__, "pose": v.pose or pose, "show": v.show or show}) for v in all_views]
    with _showing(show):
        facts = _scene_facts()
    w, h = cell
    aspect = w / h
    # one shared scale and ground height for the flat views
    scale, center_z = None, None
    flat = [v for v in all_views if v.ortho and v.node is None and v.eye is None]
    if flat:
        scales, centers = [], []
        for v in flat:
            with posed(v.pose), _showing(v.show, v.explode):
                c = _solve_camera(v, _points(), aspect)
                scales.append(c.ortho_scale)
                if abs(v.elevation) < 1:
                    centers.append(c.target.z)
        scale = max(scales)
        center_z = sum(centers) / len(centers) if centers else None
    cells = []
    for v in all_views:
        img, cam = render_view(v, cell, ortho_scale=scale if v.ortho else None,
                               center_z=center_z if v.ortho else None,
                               ground_disc=not v.ortho and v.node is None)
        cells.append(_decorate_cell(img, v, cam, cell))
    n = len(cells)
    cols = 2 if n <= 4 else 3
    rows = (n + cols - 1) // cols
    head = 46
    gap = 2
    sheet = Image.new("RGB", (cols * w + (cols - 1) * gap, head + rows * h + (rows - 1) * gap), (24, 26, 33))
    d = ImageDraw.Draw(sheet)
    d.text((12, 10), title or name, font=_font(22), fill=_INK)
    sx, sy, sz = facts["size"]
    info = (f"{sx:.2f} wide x {sy:.2f} tall x {sz:.2f} long (m)   {facts['tris']} triangles   "
            f"{facts['nodes']} node{'s' if facts['nodes'] != 1 else ''}")
    d.text((sheet.width - 12 - d.textlength(info, font=_font(15)), 16), info, font=_font(15), fill=_DIM)
    for i, c in enumerate(cells):
        sheet.paste(c.convert("RGB"), ((i % cols) * (w + gap), head + (i // cols) * (h + gap)))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    meta = PngInfo()
    if stamp:
        meta.add_text("mb_stamp", stamp)
    sheet.save(out, pnginfo=meta)
    return out


# ---- concept shot -----------------------------------------------------------------------
BACKDROPS = {
    # zenith, horizon, ground: sRGB hex; key/rim: (hex, strength); ambient: world light strength
    "sky": dict(zenith="#2a66c8", horizon="#cfe4f5", ground="#8f95a3", key=("#fff1d6", 2.7),
                rim=("#cfeaff", 2.4), ambient=0.55, clouds=0.95, cloud="#ffffff", night=False, glow=2.0),
    "sunset": dict(zenith="#3b3a8c", horizon="#ffb36b", ground="#8c7a80", key=("#ffb070", 2.6),
                   rim=("#ff6fa8", 2.4), ambient=0.5, clouds=0.9, cloud="#ffd9c2", night=False, glow=2.5),
    "night": dict(zenith="#070b1c", horizon="#1d2a52", ground="#3a3f52", key=("#9db8ff", 1.3),
                  rim=("#ff8a3a", 2.6), ambient=0.3, clouds=0.6, cloud="#3a4468", night=True, glow=4.0),
    "studio": dict(zenith="#20232c", horizon="#4b5162", ground="#565c6e", key=("#fff4e6", 2.7),
                   rim=("#9fd8ff", 2.6), ambient=0.5, clouds=0.0, cloud="#ffffff", night=False, glow=2.0),
}


def _lin(hexcolor: str):
    return tuple(palette.srgb_to_linear(c) for c in palette.hex_to_rgb(hexcolor))


def _sky_world(nt, bd: dict) -> None:
    """Gradient sky with a flat layer of cumulus for the camera; plain soft light for the model."""
    N, L = nt.nodes.new, nt.links.new
    out = N("ShaderNodeOutputWorld")
    tc = N("ShaderNodeTexCoord")
    sep = N("ShaderNodeSeparateXYZ")
    L(tc.outputs["Generated"], sep.inputs["Vector"])
    # height above the horizon -> horizon..zenith
    rng = N("ShaderNodeMapRange")
    rng.interpolation_type = "SMOOTHSTEP"
    rng.inputs["From Min"].default_value = 0.0
    rng.inputs["From Max"].default_value = 0.75
    L(sep.outputs["Z"], rng.inputs["Value"])
    _, sky = _mix_rgb(nt, (*_lin(bd["horizon"]), 1.0), (*_lin(bd["zenith"]), 1.0), rng.outputs["Result"])
    if bd["clouds"] > 0:
        # Cumulus: 3D noise looked up along the view direction, squashed vertically so the
        # clouds come out wider than tall, in a band above the horizon.
        def cloud_noise(lift: float):
            scale = N("ShaderNodeVectorMath")
            scale.operation = "MULTIPLY_ADD"
            scale.inputs[1].default_value = (2.6, 2.6, 7.5)
            scale.inputs[2].default_value = (3.1, 1.7, lift)
            L(tc.outputs["Generated"], scale.inputs[0])
            noise = N("ShaderNodeTexNoise")
            noise.inputs["Scale"].default_value = 1.0
            noise.inputs["Detail"].default_value = 6.0
            noise.inputs["Roughness"].default_value = 0.6
            L(scale.outputs["Vector"], noise.inputs["Vector"])
            return noise.outputs[0]

        density = cloud_noise(0.0)
        above = cloud_noise(0.55)             # the same clouds, sampled a little higher up
        cov = N("ShaderNodeMapRange")
        cov.interpolation_type = "SMOOTHSTEP"
        cov.inputs["From Min"].default_value = 0.515
        cov.inputs["From Max"].default_value = 0.56
        L(density, cov.inputs["Value"])
        # keep them off the very horizon and thin them out toward the top of the sky
        low = N("ShaderNodeMapRange")
        low.interpolation_type = "SMOOTHSTEP"
        low.inputs["From Min"].default_value = 0.02
        low.inputs["From Max"].default_value = 0.10
        L(sep.outputs["Z"], low.inputs["Value"])
        high = N("ShaderNodeMapRange")
        high.interpolation_type = "SMOOTHSTEP"
        high.inputs["From Min"].default_value = 0.55
        high.inputs["From Max"].default_value = 0.98
        high.inputs["To Min"].default_value = 1.0
        high.inputs["To Max"].default_value = 0.0
        L(sep.outputs["Z"], high.inputs["Value"])
        amount = cov.outputs["Result"]
        for factor in (low.outputs["Result"], high.outputs["Result"], bd["clouds"]):
            mul = N("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            L(amount, mul.inputs[0])
            if hasattr(factor, "is_linked"):
                L(factor, mul.inputs[1])
            else:
                mul.inputs[1].default_value = factor
            amount = mul.outputs["Value"]
        # bright tops, shaded bases: where there is cloud above, it is in shadow
        white = (*_lin(bd["cloud"]), 1.0)
        zen, hor = _lin(bd["zenith"]), _lin(bd["horizon"])
        base = tuple(0.35 * w + 0.35 * h + 0.30 * z for w, h, z in zip(white[:3], hor, zen)) + (1.0,)
        shade = N("ShaderNodeMapRange")
        shade.interpolation_type = "SMOOTHSTEP"
        shade.inputs["From Min"].default_value = 0.50
        shade.inputs["From Max"].default_value = 0.60
        L(above, shade.inputs["Value"])
        _, cloud_col = _mix_rgb(nt, white, base, shade.outputs["Result"])
        _, sky = _mix_rgb(nt, sky, cloud_col, amount)
    cam_bg = N("ShaderNodeBackground")
    L(sky, cam_bg.inputs["Color"])
    cam_bg.inputs["Strength"].default_value = 1.0
    # what lights the model: a soft blend of zenith and horizon, no clouds, fixed strength
    amb = tuple(0.5 * a + 0.5 * b for a, b in zip(_lin(bd["zenith"]), _lin(bd["horizon"])))
    peak = max(amb) or 1.0
    amb = tuple(0.35 + 0.65 * c / peak for c in amb)
    light_bg = N("ShaderNodeBackground")
    light_bg.inputs["Color"].default_value = (*amb, 1.0)
    light_bg.inputs["Strength"].default_value = bd["ambient"]
    lp = N("ShaderNodeLightPath")
    mix = N("ShaderNodeMixShader")
    L(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    L(light_bg.outputs["Background"], mix.inputs[1])
    L(cam_bg.outputs["Background"], mix.inputs[2])
    L(mix.outputs["Shader"], out.inputs["Surface"])


def _ground_plane(radius: float, bd: dict, fade_start: float, fade_end: float, tile: float):
    """Huge ground that takes shadows near the model and melts into the horizon far away.
    A faint checker of `tile`-meter squares gives the eye a floor to stand the model on."""
    me = bpy.data.meshes.new("mb_ground")
    r = radius
    me.from_pydata([(-r, -r, 0), (r, -r, 0), (r, r, 0), (-r, r, 0)], [], [[0, 1, 2, 3]])
    me.update()
    mat = bpy.data.materials.new("mbprev_ground")
    nt = mat.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)
    N, L = nt.nodes.new, nt.links.new
    diff = N("ShaderNodeBsdfDiffuse")
    base = _lin(bd["ground"])
    geo = N("ShaderNodeNewGeometry")
    checker = N("ShaderNodeTexChecker")
    checker.inputs["Scale"].default_value = 1.0 / tile
    checker.inputs["Color1"].default_value = (*base, 1.0)
    checker.inputs["Color2"].default_value = (*(c * 0.88 for c in base), 1.0)
    L(geo.outputs["Position"], checker.inputs["Vector"])
    L(checker.outputs["Color"], diff.inputs["Color"])
    far = N("ShaderNodeEmission")
    far.inputs["Color"].default_value = (*_lin(bd["horizon"]), 1.0)
    cd = N("ShaderNodeCameraData")
    rng = N("ShaderNodeMapRange")
    rng.interpolation_type = "SMOOTHSTEP"
    rng.inputs["From Min"].default_value = fade_start
    rng.inputs["From Max"].default_value = fade_end
    L(cd.outputs["View Distance"], rng.inputs["Value"])
    mix = N("ShaderNodeMixShader")
    L(rng.outputs["Result"], mix.inputs["Fac"])
    L(diff.outputs["BSDF"], mix.inputs[1])
    L(far.outputs["Emission"], mix.inputs[2])
    out = N("ShaderNodeOutputMaterial")
    L(mix.outputs["Shader"], out.inputs["Surface"])
    me.materials.append(mat)
    return _helper(bpy.data.objects.new("mb_ground", me))


def concept(name: str, out: str | None = None, backdrop: str | None = "sky", azimuth: float = 32.0,
            elevation: float = 9.0, fov: float = 32.0, zoom: float = 1.0, pose: dict | None = None,
            view: View | None = None, show=None, size=(960, 600), samples: int = 12, ground: bool = True,
            sun_azimuth: float = -50.0, sun_elevation: float = 42.0, stamp: str | None = None) -> str:
    """Render a lit beauty shot of the current scene to docs/art/concept/<name>.png.

    backdrop:  "sky" (afternoon), "sunset", "night", "studio", or None for a transparent
               background with no ground (portraits, slides).
    azimuth, elevation, fov, zoom: the orbit camera (see mb.View). A low elevation looks
               up at the model and makes it feel big.
    view:      or pass a complete mb.View (node cameras work too).
    pose:      a pose for the shot (see mb.pose()).
    show:      draw only these nodes (and their children), e.g. show=("intact",).
    sun_azimuth, sun_elevation: where the key light comes from, relative to the camera
               (negative azimuth = from the camera's left). The rim light sits opposite.
    size, samples: picture size in pixels and render quality (the picture is denoised);
               the defaults take about 10 seconds.
    Returns the path written.
    """
    from PIL.PngImagePlugin import PngInfo

    out = out or os.path.join(contract.CONCEPT, f"{name}.png")
    bd = BACKDROPS[backdrop or "studio"]
    v = view or View("", azimuth=azimuth, elevation=elevation, fov=fov, zoom=zoom)
    tmp = _tmpdir()
    try:
        with posed(pose or v.pose), _showing(show or v.show, v.explode):
            pts = _points()
            lo, hi = pts.min(axis=0), pts.max(axis=0)
            radius = float(np.linalg.norm(hi - lo)) / 2 or 1.0
            cam = _solve_camera(v, pts, size[0] / size[1], margin=1.22)
            _setup_cycles(size, samples=samples, bounces=2, denoise=True, transparent=backdrop is None)
            _world(lambda nt: _sky_world(nt, bd))
            _camera_object(cam)
            # lights are placed relative to the camera's heading so every angle is well lit
            m = cam.matrix.to_3x3()
            heading = math.atan2((m @ Vector((0, 0, 1))).x, -(m @ Vector((0, 0, 1))).y)   # camera azimuth

            def from_dir(az_deg, el_deg):
                a = heading + math.radians(az_deg)
                e = math.radians(el_deg)
                return Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))

            _sun(from_dir(sun_azimuth, sun_elevation), bd["key"][1], _lin(bd["key"][0]), angle_deg=2.5, shadow=True)
            rim = _sun(from_dir(sun_azimuth + 185.0, 28.0), bd["rim"][1], _lin(bd["rim"][0]), angle_deg=4.0,
                       shadow=True)
            # the rim light touches the model only: no second shadow on the ground
            receivers = bpy.data.collections.new("mb_rim_receivers")
            for ob in _asset_objects():
                receivers.objects.link(ob)
            rim.light_linking.receiver_collection = receivers
            if ground and backdrop is not None:
                eye = cam.matrix.to_translation()
                d_model = (eye - Vector((lo + hi) / 2)).length
                _ground_plane(max(radius * 400, 200.0), bd, d_model + radius * 2.5, d_model + radius * 14,
                              tile=_nice_length(radius * 0.9))
            with _preview_materials("lit", "cull", glow_strength=bd["glow"], night=bd["night"]):
                img = _render_to_image(tmp, "concept")
    finally:
        _remove_helpers()
        coll = bpy.data.collections.get("mb_rim_receivers")
        if coll is not None:
            bpy.data.collections.remove(coll)
        shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    meta = PngInfo()
    if stamp:
        meta.add_text("mb_stamp", stamp)
    if backdrop is None:
        img.save(out, pnginfo=meta)
    else:
        img.convert("RGB").save(out, pnginfo=meta)
    return out
