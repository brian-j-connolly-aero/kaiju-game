"""Contract checks for exported models. Pure Python + numpy: parses the .glb itself.

Every rule comes from docs/ASSETS.md section 3 (or protects the client from a file it
could not use). Each rule reports PASS, WARN or FAIL with a plain reason. FAIL means the
file breaks the contract; WARN means "look at this, it is probably a mistake".

Use through tools/art/validate.py (command line) or validate_file() (from scripts).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

import numpy as np

import contract
import glb as glbfile

PASS, WARN, FAIL, INFO = "PASS", "WARN", "FAIL", "INFO"


@dataclass
class Report:
    asset: str
    path: str
    lines: list[tuple[str, str, str]] = field(default_factory=list)

    def add(self, level: str, rule: str, msg: str) -> None:
        self.lines.append((level, rule, msg))

    def check(self, ok: bool, rule: str, good: str, bad: str, level: str = FAIL) -> bool:
        self.add(PASS if ok else level, rule, good if ok else bad)
        return ok

    @property
    def failures(self) -> int:
        return sum(1 for lv, _, _ in self.lines if lv == FAIL)

    @property
    def warnings(self) -> int:
        return sum(1 for lv, _, _ in self.lines if lv == WARN)

    @property
    def ok(self) -> bool:
        return self.failures == 0

    def format(self, only_problems: bool = False) -> str:
        rel = os.path.relpath(self.path, contract.REPO) if self.path.startswith(contract.REPO) else self.path
        out = [f"{self.asset}  ({rel})"]
        for lv, rule, msg in self.lines:
            if only_problems and lv in (PASS, INFO):
                continue
            out.append(f"  {lv:<4}  {rule:<15} {msg}")
        verdict = "PASS" if self.ok else "FAIL"
        out.append(f"  RESULT: {verdict}  ({self.failures} failed, {self.warnings} warning"
                   f"{'' if self.warnings == 1 else 's'})")
        return "\n".join(out)


def _fmt(v) -> str:
    return "[" + ", ".join(f"{float(x):.3f}" for x in v) + "]"


# ---- geometry helpers -------------------------------------------------------------------
def _flat_stats(prim: glbfile.Primitive):
    """(triangles whose 3 normals differ, triangles facing against their normal,
    triangles with a strongly bent normal, zero-area triangles)."""
    if prim.mode != 4 or prim.normals is None or not len(prim.indices):
        return 0, 0, 0, 0
    idx = prim.indices
    n = prim.normals[idx]                         # (t, 3, 3)
    split = (np.abs(n[:, 0] - n[:, 1]).max(axis=1) > 2e-3) | (np.abs(n[:, 0] - n[:, 2]).max(axis=1) > 2e-3)
    p = prim.positions[idx]
    geo = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    area2 = np.linalg.norm(geo, axis=1)
    scale = max(float(np.abs(prim.positions).max()), 1e-6)
    degenerate = area2 < 1e-10 * scale * scale + 1e-14
    geo_n = geo / np.maximum(area2[:, None], 1e-30)
    dots = (geo_n * n[:, 0]).sum(axis=1)
    live = ~degenerate
    return (int(split.sum()), int(((dots < 0.0) & live).sum()), int(((dots >= 0.0) & (dots < 0.5) & live).sum()),
            int(degenerate.sum()))


def _inside_out(g: glbfile.Glb, node: glbfile.Node):
    """(number of closed shells that are inside out, number of closed shells checked)."""
    prims = [p for p in g.meshes[node.mesh] if p.mode == 4 and len(p.indices)]
    if not prims:
        return 0, 0
    pos, tris, base = [], [], 0
    for p in prims:
        pos.append(p.positions)
        tris.append(p.indices + base)
        base += len(p.positions)
    pos = np.vstack(pos)
    tris = np.vstack(tris)
    scale = max(float(np.abs(pos).max()), 1e-6)
    keys = np.round(pos / (scale * 1e-5)).astype(np.int64)
    _, inv = np.unique(keys, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    t = inv[tris]
    t = t[(t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])]
    if not len(t):
        return 0, 0
    parent = np.arange(int(inv.max()) + 1)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b, c in t:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[find(rc)] = ra
    comp = np.array([find(a) for a in t[:, 0]])
    wpos = np.zeros((int(inv.max()) + 1, 3))
    wpos[inv] = pos
    bad = closed = 0
    for c in np.unique(comp):
        ct = t[comp == c]
        directed: dict[tuple[int, int], int] = {}
        for a, b, cc in ct:
            for e in ((a, b), (b, cc), (cc, a)):
                directed[e] = directed.get(e, 0) + 1
        if not all(n == 1 and directed.get((b, a), 0) == 1 for (a, b), n in directed.items()):
            continue                                   # open or non-manifold: cannot judge
        p0, p1, p2 = wpos[ct[:, 0]], wpos[ct[:, 1]], wpos[ct[:, 2]]
        ctr = wpos[np.unique(ct)].mean(axis=0)
        vol = float((np.cross(p1 - ctr, p2 - ctr) * (p0 - ctr)).sum() / 6.0)
        ext = wpos[np.unique(ct)].max(axis=0) - wpos[np.unique(ct)].min(axis=0)
        closed += 1
        if vol < -1e-6 * max(float(np.prod(np.maximum(ext, 1e-9))), 1e-18):
            bad += 1
    return bad, closed


# ---- the rules ---------------------------------------------------------------------------
def validate_file(path: str, kind: str | None = None, size_class: str | None = None,
                  budget: int | None = None, nodes: list[str] | None = None, origin: str | None = None,
                  entry: dict | None = None) -> Report:
    """Check one .glb against the contract. Everything not given is inferred from the
    file name (see contract.py). `entry` is its manifest entry, if it has one."""
    asset = contract.asset_id(path)
    rep = Report(asset, os.path.abspath(path))
    if not os.path.exists(path):
        rep.add(FAIL, "container", "file does not exist")
        return rep
    try:
        g = glbfile.load(path)
    except Exception as e:  # noqa: BLE001 - any parse error is a failed file
        rep.add(FAIL, "container", f"cannot parse: {e}")
        return rep
    j = g.json
    kind = kind or (entry or {}).get("kind") or contract.kind_of(asset)
    structural = kind in ("structure", "landmark")

    # -- container ---------------------------------------------------------------------
    ext_bufs = [b for b in j.get("buffers", []) if "uri" in b]
    rep.check(not ext_bufs and len(j.get("buffers", [])) <= 1, "container",
              f"binary glTF 2.0, self-contained, {g.byte_size / 1024:.1f} KiB",
              "buffers must be embedded in the .glb (found external or multiple buffers)")

    # -- no embedded textures ----------------------------------------------------------
    tex_refs = []
    for m in j.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        for key in ("baseColorTexture", "metallicRoughnessTexture"):
            if key in pbr:
                tex_refs.append(f"{m.get('name')}.{key}")
        for key in ("normalTexture", "occlusionTexture", "emissiveTexture"):
            if key in m:
                tex_refs.append(f"{m.get('name')}.{key}")
    n_img = len(j.get("images", [])) + len(j.get("textures", []))
    rep.check(n_img == 0 and not tex_refs, "no-textures", "no images or textures inside the file",
              f"file embeds textures ({n_img} image/texture records, material refs: {tex_refs or 'none'}); "
              f"materials are swapped in by name, export with mb.export_glb()")

    # -- no animation, skins, cameras, lights ------------------------------------------
    extras = [k for k in ("animations", "skins", "cameras") if j.get(k)]
    if "KHR_lights_punctual" in j.get("extensionsUsed", []):
        extras.append("lights")
    if any("targets" in p for m in j.get("meshes", []) for p in m.get("primitives", [])):
        extras.append("morph targets")
    rep.check(not extras, "no-animation", "no animations, armatures, morphs, cameras or lights",
              f"file contains {', '.join(extras)}: animation is done in code, models are rigid nodes")
    req = j.get("extensionsRequired", [])
    used = [e for e in j.get("extensionsUsed", []) if e != "KHR_lights_punctual"]
    if req:
        rep.add(FAIL, "extensions", f"requires glTF extensions the client does not promise: {req}")
    elif used:
        rep.add(WARN, "extensions", f"uses glTF extensions: {used}")

    # -- nodes: names and transforms ---------------------------------------------------
    reach = g.reachable()
    names = [n.name for n in reach]
    bad_names = [n for n in names if not contract.valid_node_name(n)]
    dupes = sorted({n for n in names if names.count(n) > 1})
    unreachable = len(g.nodes) - len(reach)
    rep.check(not bad_names and not dupes and not unreachable, "node-names",
              f"{len(names)} node(s), names unique and plain",
              "; ".join(filter(None, [
                  f"names with characters other than letters, digits, underscore: {bad_names}" if bad_names else "",
                  f"duplicate names: {dupes}" if dupes else "",
                  f"{unreachable} node(s) not attached to the scene" if unreachable else ""])))
    moved = [n.name for n in reach if n.has_rotation or n.has_scale or n.has_matrix]
    rep.check(not moved, "transforms", "all nodes are position-only (transforms applied)",
              f"nodes with rotation, scale or a matrix (apply all transforms): {moved[:8]}"
              f"{' ...' if len(moved) > 8 else ''}")

    # -- materials and vertex attributes -----------------------------------------------
    mesh_nodes = [n for n in reach if n.mesh is not None]
    prim_count = 0
    mat_use: dict[str, int] = {}
    problems: list[str] = []
    for n in mesh_nodes:
        for p in g.meshes[n.mesh]:
            prim_count += 1
            mname = p.material if p.material is not None else "(none)"
            mat_use[mname] = mat_use.get(mname, 0) + p.tris
            if p.mode != 4:
                problems.append(f"{n.name}: primitive is not a triangle list (mode {p.mode})")
            if p.normals is None:
                problems.append(f"{n.name}: no NORMAL attribute")
            if p.material in (contract.MAT_VCOL, contract.MAT_GLOW) and p.colors is None:
                problems.append(f"{n.name}: material {p.material} needs vertex colors (COLOR_0)")
            if p.material == contract.MAT_ATLAS:
                if p.uvs is None:
                    problems.append(f"{n.name}: material city_atlas needs UVs (TEXCOORD_0)")
                elif len(p.uvs) and (p.uvs.min() < -1e-4 or p.uvs.max() > 1 + 1e-4):
                    problems.append(f"{n.name}: UVs outside 0..1 (the atlas cannot repeat)")
    bad_mats = sorted(m for m in mat_use if m not in contract.MATERIALS)
    rep.check(not bad_mats, "materials",
              "materials: " + ", ".join(f"{m} ({t} tris)" for m, t in sorted(mat_use.items())),
              f"only {list(contract.MATERIALS)} are allowed, found {bad_mats}")
    unused = sorted(set(g.materials) - set(mat_use))
    if unused:
        rep.add(WARN, "materials", f"materials in the file that no mesh uses: {unused}")
    rep.check(not problems, "attributes", f"{prim_count} primitive(s), all with the attributes their material needs",
              "; ".join(problems[:6]) + (" ..." if len(problems) > 6 else ""))

    # -- flat shading, winding ---------------------------------------------------------
    split = flipped = bent = degenerate = 0
    for n in mesh_nodes:
        for p in g.meshes[n.mesh]:
            a, b, c, d = _flat_stats(p)
            split, flipped, bent, degenerate = split + a, flipped + b, bent + c, degenerate + d
    total_tris = g.tris()
    rep.check(split == 0, "flat-shading", "every triangle has one normal for all three corners (flat)",
              f"{split} of {total_tris} triangles are smooth-shaded (corners have different normals)")
    rep.check(flipped == 0, "winding", "triangle winding agrees with the normals",
              f"{flipped} triangle(s) wind against their normal (they would render inside out)")
    if bent:
        rep.add(WARN, "winding", f"{bent} triangle(s) lie far from their face normal (a badly bent polygon; "
                                 f"use Geo.triangulate())")
    if degenerate:
        rep.add(WARN, "degenerate", f"{degenerate} zero-area triangle(s): wasted budget")
    inside = shells = 0
    worst: list[str] = []
    for n in mesh_nodes:
        b, c = _inside_out(g, n)
        inside, shells = inside + b, shells + c
        if b:
            worst.append(n.name)
    rep.check(inside == 0, "inside-out", f"{shells} closed shell(s), all facing outward",
              f"{inside} closed shell(s) are inside out (faces point inward; the game culls back faces) in: {worst[:6]}")

    # -- required nodes ----------------------------------------------------------------
    required = list(nodes) if nodes is not None else contract.required_nodes(asset, kind)
    present = set(names)
    missing = [n for n in required if n not in present]
    if required:
        rep.check(not missing, "required-nodes", f"all {len(required)} required nodes present",
                  f"missing required nodes: {missing}")
    else:
        rep.add(INFO, "required-nodes", "no specific node names required for this asset")
    anchor_problems = []
    for name in sorted(present & contract.EMPTY_NODES):
        if g.node(name).mesh is not None:
            anchor_problems.append(f"{name} must be an empty (it has a mesh)")
    for name in sorted(present & contract.GLOW_NODES):
        mats = g.node_materials(name)
        if not mats:
            anchor_problems.append(f"{name} must be a mesh (it is an empty)")
        elif set(mats) != {contract.MAT_GLOW}:
            anchor_problems.append(f"{name} must use only the glow material (uses {mats})")
    if present & (contract.EMPTY_NODES | contract.GLOW_NODES):
        rep.check(not anchor_problems, "anchors", "anchors are empties, weak point glows",
                  "; ".join(anchor_problems))
    kp = contract.kaiju_parts(asset)
    if kp and kp[0] == "lizard":
        wrong = []
        tree = dict(contract.LIZARD_TREE)
        tree.update({k: v for k, v in contract.LIZARD_OPTIONAL.items() if k in present})
        for child, parent in tree.items():
            node = g.node(child)
            if node is None:
                continue
            actual = g.nodes[node.parent].name if node.parent is not None else None
            if actual != parent:
                wrong.append(f"{child} is under {actual}, expected {parent}")
        rep.check(not wrong, "hierarchy", "lizard rig hierarchy matches the contract tree",
                  "; ".join(wrong[:6]) + (" ..." if len(wrong) > 6 else ""))
    if kind == "prop":
        # one mesh node; the only other nodes allowed are anchors (empties) such as `grip`
        extra = [n.name for n in reach if n.mesh is None and n.name not in contract.PROP_ANCHORS]
        rep.check(len(mesh_nodes) == 1 and not extra, "single-mesh", "one mesh node, as props must be",
                  f"props are one mesh each (plus anchors {sorted(contract.PROP_ANCHORS)}); found "
                  f"{len(mesh_nodes)} mesh node(s) in {len(reach)} node(s)" + (f", extra nodes {extra}" if extra else ""))

    # -- left/right, facing ------------------------------------------------------------
    lr_bad, lr_pairs = [], 0
    for name in names:
        if "_L" not in name:
            continue
        twin = name.replace("_L", "_R", 1) if (name.endswith("_L") or "_L_" in name) else None
        if not twin or twin not in present:
            continue
        lr_pairs += 1
        xl, xr = _node_x(g, name), _node_x(g, twin)
        if not xl > xr + 1e-6:
            lr_bad.append(f"{name} (x = {xl:.3f}) should be at +X, {twin} (x = {xr:.3f}) at -X")
    if lr_pairs:
        rep.check(not lr_bad, "left-right", f"{lr_pairs} left/right pair(s): _L on +X, _R on -X (not mirrored)",
                  "left and right are swapped: " + "; ".join(lr_bad[:4]))
    facing = []
    for name in ("cam_fp", "mouth", "muzzle", "head"):
        node = g.node(name)
        if node is not None and node.position[2] <= 0:
            facing.append(f"{name} is at z = {node.position[2]:.3f}; the front of a model is +Z")
    for name in ("tail_3", "tail_4", "tail_5"):
        node = g.node(name)
        if node is not None and node.position[2] >= 0:
            facing.append(f"{name} is at z = {node.position[2]:.3f}; tails point to -Z")
    if any(g.node(n) is not None for n in ("cam_fp", "mouth", "muzzle", "head", "tail_5")):
        rep.check(not facing, "facing", "front anchors are toward +Z (model faces +Z)", "; ".join(facing))
    else:
        rep.add(INFO, "facing", "no front anchor in this model: check the contact sheet's FRONT view by eye")

    # -- origin, size, budget ----------------------------------------------------------
    scope_nodes = g.subtree("intact") if structural and g.node("intact") else None
    bounds = g.bounds(scope_nodes)
    if bounds is None:
        rep.add(FAIL, "size", "the file has no geometry")
        return rep
    lo, hi = bounds
    size = hi - lo
    mode = origin or contract.origin_mode(asset, kind)
    if mode == "ground":
        tol = max(0.02, 0.01 * float(size[1]))
        ok = abs(lo[1]) <= tol
        inside_fp = lo[0] - 1e-6 <= 0 <= hi[0] + 1e-6 and lo[2] - 1e-6 <= 0 <= hi[2] + 1e-6
        rep.check(ok and inside_fp, "origin",
                  f"stands on the ground (lowest point y = {lo[1]:.3f}), origin inside the footprint",
                  (f"lowest point is y = {lo[1]:.3f}; the model must stand on y = 0. " if not ok else "")
                  + ("the origin is outside the model's footprint. " if not inside_fp else ""))
        off_x = abs((lo[0] + hi[0]) / 2) / max(float(size[0]), 1e-6)
        if off_x > 0.2 and inside_fp:
            rep.add(WARN, "origin", f"model is off-center sideways by {off_x * 100:.0f}% of its width")
    elif mode == "center":
        inside_box = all(lo[k] - 1e-6 <= 0 <= hi[k] + 1e-6 for k in range(3))
        rep.check(inside_box, "origin", "origin is inside the model (flying things pivot at their middle)",
                  f"origin is outside the model's bounds {_fmt(lo)} .. {_fmt(hi)}")
        off = max(abs((lo[k] + hi[k]) / 2) / max(float(size[k]), 1e-6) for k in range(3))
        if off > 0.3 and inside_box:
            rep.add(WARN, "origin", f"model is off-center by {off * 100:.0f}% of its size")
    else:
        rep.add(INFO, "origin", "origin not checked (free)")

    rng = contract.SIZE_RANGE.get(kind, (0.01, 1000.0))
    biggest = float(size.max())
    size_ok = rng[0] <= biggest <= rng[1]
    size_msg = f"{size[0]:.2f} wide x {size[1]:.2f} tall x {size[2]:.2f} long (m)"
    rep.check(size_ok, "size", size_msg,
              f"{size_msg}: outside the plausible {rng[0]} to {rng[1]} m for a {kind}. Units are meters.")
    if kp and kp[0] == "lizard":
        want = contract.LIZARD_HEIGHT[kp[1]]
        rep.check(abs(size[1] - want) <= 0.10 * want, "true-size", f"height {size[1]:.2f} m matches stage {kp[1]} ({want} m)",
                  f"height is {size[1]:.2f} m; stage {kp[1]} of the lizard is authored at {want} m (within 10%)")
    if asset in ("kaiju_egg", "kaiju_cocoon"):
        rep.check(abs(size[1] - 1.0) <= 0.05, "true-size", "1 m tall (scaled in code)",
                  f"height is {size[1]:.2f} m; eggs and cocoons are authored 1 m tall")
    pdef = contract.prop_def(asset) if kind == "prop" else None
    if pdef and isinstance(pdef.get("height"), (int, float)) and isinstance(pdef.get("radius"), (int, float)):
        want_h, want_r = float(pdef["height"]), float(pdef["radius"])
        reach = float(max(abs(lo[0]), abs(hi[0]), abs(lo[2]), abs(hi[2])))
        msg = (f"the game treats this prop as {want_h:g} m tall with a {want_r:g} m radius; "
               f"the model is {size[1]:.2f} m tall and reaches {reach:.2f} m from its origin")
        if abs(size[1] - want_h) > 0.2 * want_h or reach > 1.5 * want_r:
            rep.add(WARN, "prop-size", msg + " (height should be within 20%, reach within 1.5 x the radius)")
        else:
            rep.add(PASS, "prop-size", msg)
    dims = contract.archetype_dims(contract.archetype_for(asset)) if structural else None
    if dims:
        w, d, h = dims
        dev = max(abs(size[0] - w) / w, abs(size[2] - d) / d, abs(size[1] - h) / h)
        msg = f"archetype is {w:g} x {d:g} footprint, {h:g} tall; model is {size[0]:.2f} x {size[2]:.2f}, {size[1]:.2f} tall"
        if dev > 0.15:
            rep.add(FAIL, "archetype", msg + " (more than 15% off: collision boxes come from the archetype)")
        elif dev > 0.05:
            rep.add(WARN, "archetype", msg + " (more than 5% off)")
        else:
            rep.add(PASS, "archetype", msg)

    limit, why = contract.budget_for(asset, kind, size_class)
    if budget is not None:
        limit, why = budget, "explicit budget"
    counted = g.tris(scope_nodes)
    label = "intact state" if scope_nodes is not None else "whole file"
    rep.check(counted <= limit, "budget", f"{counted} triangles ({label}), budget {limit} ({why})",
              f"{counted} triangles ({label}) is over the budget of {limit} ({why})")

    if structural:
        _structure_rules(rep, g, limit, lo, hi)

    # -- manifest entry agrees with the file -------------------------------------------
    if entry is not None:
        diffs = []
        if entry.get("file") != f"models/{asset}.glb":
            diffs.append(f"file is {entry.get('file')!r}, expected 'models/{asset}.glb'")
        if entry.get("kind") not in contract.KINDS:
            diffs.append(f"kind {entry.get('kind')!r} is not one of {list(contract.KINDS)}")
        ghost = [n for n in entry.get("nodes", []) if n not in present]
        if ghost:
            diffs.append(f"lists nodes that are not in the file: {ghost}")
        if "size" not in entry or np.abs(np.array(entry["size"], dtype=float) - np.array(g.size(scope_nodes))).max() > 0.002:
            diffs.append(f"size {entry.get('size')} but the file measures {g.size(scope_nodes)}")
        if entry.get("tris") != counted:
            diffs.append(f"tris {entry.get('tris')} but the file has {counted}")
        n_chunks = sum(1 for n in names if n.startswith("chunk_"))
        if n_chunks and entry.get("chunks") != n_chunks:
            diffs.append(f"chunks {entry.get('chunks')} but the file has {n_chunks}")
        rep.check(not diffs, "manifest", "manifest entry matches the file",
                  "manifest entry is stale (re-run the family script): " + "; ".join(diffs))
    return rep


def _node_x(g: glbfile.Glb, name: str) -> float:
    """Sideways position of a node: the middle of its geometry, or its pivot if it has none."""
    b = g.bounds(g.subtree(name))
    if b is not None:
        return float((b[0][0] + b[1][0]) / 2)
    return float(g.node(name).position[0])


def _structure_rules(rep: Report, g: glbfile.Glb, limit: int, lo, hi) -> None:
    size = hi - lo
    for state in ("damaged", "rubble"):
        nodes = g.subtree(state)
        if not nodes:
            continue                                    # already reported by required-nodes
        tris = g.tris(nodes)
        b = g.bounds(nodes)
        if b is None:
            rep.add(FAIL, "states", f"{state} has no geometry")
            continue
        rep.check(tris <= limit, "states", f"{state}: {tris} triangles (budget {limit})",
                  f"{state}: {tris} triangles is over the budget of {limit}")
        slo, shi = b
        tol = 0.05 * np.maximum(size, 0.1)
        outside = bool((slo[[0, 2]] < lo[[0, 2]] - tol[[0, 2]]).any() or (shi[[0, 2]] > hi[[0, 2]] + tol[[0, 2]]).any())
        if state == "rubble":
            rep.check(not outside, "states", "rubble stays within the footprint",
                      f"rubble spills outside the intact footprint: {_fmt(slo)} .. {_fmt(shi)}")
            if shi[1] > 0.4 * hi[1]:
                rep.add(WARN, "states", f"rubble is {shi[1]:.2f} m tall, {shi[1] / hi[1] * 100:.0f}% of the building: "
                                        f"it should be a low pile")
        else:
            drift = float(np.abs(np.concatenate([slo - lo, shi - hi])).max() / max(float(size.max()), 1e-6))
            if drift > 0.10:
                rep.add(WARN, "states", f"damaged silhouette differs from intact by {drift * 100:.0f}% of its size "
                                        f"(it should be the same silhouette with holes)")
    chunks = sorted(n.name for n in g.reachable() if n.name.startswith("chunk_"))
    expect = [f"chunk_{i:02d}" for i in range(len(chunks))]
    ok = contract.CHUNKS_MIN <= len(chunks) <= contract.CHUNKS_MAX and chunks == expect
    rep.check(ok, "chunks", f"{len(chunks)} chunks, numbered chunk_00..chunk_{max(len(chunks) - 1, 0):02d}",
              f"need {contract.CHUNKS_MIN} to {contract.CHUNKS_MAX} chunks named chunk_00, chunk_01, ... "
              f"(found {len(chunks)}: {chunks[:4]}{' ...' if len(chunks) > 4 else ''})")
    heavy, off_center, pts = [], [], []
    for name in chunks:
        node = g.node(name)
        tris = g.node_tris(name)
        if tris > contract.BUDGET_CHUNK:
            heavy.append(f"{name} ({tris})")
        if node.mesh is None:
            off_center.append(f"{name} (no mesh)")
            continue
        local = np.vstack([p.positions for p in g.meshes[node.mesh] if len(p.positions)])
        ext = local.max(axis=0) - local.min(axis=0)
        mid = (local.max(axis=0) + local.min(axis=0)) / 2
        if (np.abs(mid) > 0.2 * np.maximum(ext, 0.05)).any():
            off_center.append(name)
        pts.append(g.world_positions([node]))
    if chunks:
        rep.check(not heavy, "chunks", f"every chunk is within {contract.BUDGET_CHUNK} triangles",
                  f"chunks over {contract.BUDGET_CHUNK} triangles: {heavy[:6]}")
        rep.check(not off_center, "chunks", "every chunk's origin is at its own center",
                  f"chunks whose origin is not at their center (they would tumble wrongly): {off_center[:6]}")
    if pts:
        allp = np.vstack(pts)
        drift = float(np.abs(np.concatenate([allp.min(axis=0) - lo, allp.max(axis=0) - hi])).max()
                      / max(float(size.max()), 1e-6))
        if drift > 0.15:
            rep.add(WARN, "chunks", f"chunks together differ from the intact shape by {drift * 100:.0f}% of its size")


# ---- manifests ---------------------------------------------------------------------------
def validate_manifest(path: str) -> list[Report]:
    """Validate every model listed in a partial manifest (and that its entry is current)."""
    import json
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    reports = []
    for asset, entry in sorted(data.get("models", {}).items()):
        glb_path = os.path.join(contract.ASSETS, entry.get("file", f"models/{asset}.glb"))
        reports.append(validate_file(glb_path, kind=entry.get("kind"), entry=entry))
    return reports
