#!/opt/mbtools/venv/bin/python
"""The city check: buildings against the kit's rules (on top of tools/art/validate.py).

    tools/art/city/check.py bld_house_a [lm_city_hall ...]
    tools/art/city/check.py --all          every bld_*.glb and lm_*.glb in the models folder

Rules (FAIL unless marked WARN):
  nodes      intact, damaged, rubble and chunk_00..chunk_NN (6 to 24, numbered without gaps)
  fit        the intact model fills the archetype's box: width, depth and height each within
             max(0.25 m, 2%) of archetypes.json, centered on the origin, standing on y = 0
  budget     every state within the archetype's budget (tools/art/city/budgets.py)
  chunks     each chunk within 30 triangles, its origin at its own center (within 5% of its
             size); all chunks together cover the intact box (within 15%)
  rubble     inside the footprint (+0.3 m) and no taller than 35% of the building
  material   only `city_atlas` (one material: one draw call per state)
  uv         every texture coordinate inside the atlas, every triangle inside one region
  mask       COLOR_0 alpha is 0, 0.5 or 1 only (the paint mask: never tint, roof, wall)
  tint       faces with alpha 1 exist only on tintable regions (WARN)
  roof       alpha 0.5 exactly on the grey roof regions (atlas Region.roof); an ordinary building
             (kit.roof_masked) has roof faces (WARN if none), a landmark, bridge, special
             building or roofless archetype none
  manifest   the entry has "tint" and "district", and "roof" when the model has roof faces
             (WARN; also WARN when the model is not in a manifest)
Exit code 0 when everything passes.
"""
from __future__ import annotations

import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
sys.path.insert(0, os.path.join(HERE, ".."))

import numpy as np  # noqa: E402

import contract  # noqa: E402
import glb as glbfile  # noqa: E402
from city import atlas, budgets, style  # noqa: E402


class Report:
    def __init__(self, mid):
        self.mid = mid
        self.lines = []

    def add(self, level, rule, msg):
        self.lines.append((level, rule, msg))

    @property
    def ok(self):
        return not any(lv == "FAIL" for lv, _, _ in self.lines)

    def format(self):
        out = [f"city check {self.mid}"]
        for lv, rule, msg in self.lines:
            out.append(f"  {lv:<4}  {rule:<9} {msg}")
        out.append(f"  RESULT: {'PASS' if self.ok else 'FAIL'}")
        return "\n".join(out)


def _prims(g, nodes):
    for n in nodes:
        if n.mesh is None:
            continue
        for p in g.meshes[n.mesh]:
            yield n, p


def _region_rects():
    atlas.load_extensions()
    return [(r.x, r.y, r.x + r.w, r.y + r.h, name) for name, r in atlas.REGIONS.items()]


def check_model(mid: str) -> Report:
    rep = Report(mid)
    path = contract.model_path(mid)
    if not os.path.exists(path):
        rep.add("FAIL", "file", f"{path} does not exist")
        return rep
    g = glbfile.load(path)
    aid = mid.split("_", 1)[1]
    arch = contract.archetypes().get(aid)
    if arch is None:
        rep.add("FAIL", "fit", f"archetype {aid!r} not in archetypes.json")
        return rep
    names = [n.name for n in g.reachable()]
    chunks = sorted(n for n in names if n.startswith("chunk_"))
    need = ["intact", "damaged", "rubble"]
    missing = [n for n in need if n not in names]
    expect = [f"chunk_{i:02d}" for i in range(len(chunks))]
    ok = not missing and chunks == expect and budgets.CHUNKS[0] <= len(chunks) <= budgets.CHUNKS[1]
    rep.add("PASS" if ok else "FAIL", "nodes",
            f"intact, damaged, rubble, {len(chunks)} chunks" if ok else f"missing {missing}, chunks {chunks[:3]}..")
    if missing:
        return rep
    W, D = arch["footprint"]
    H = arch["height"]
    lo, hi = g.bounds(g.subtree("intact"))
    size = hi - lo
    bad = []
    top = contract.model_height(aid, H)       # above the box only with a slim part (contract.TALL_PARTS)
    for label, got, want in (("width", size[0], W), ("height", size[1], top), ("depth", size[2], D)):
        tol = style.fit_tolerance(want)
        if abs(got - want) > tol:
            bad.append(f"{label} {got:.2f} vs {want:g} (tolerance {tol:.2f})")
    mid_xz = ((lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2)
    if max(abs(mid_xz[0]), abs(mid_xz[1])) > style.FIT_TOL_ABS:
        bad.append(f"off-center by {mid_xz[0]:.2f}, {mid_xz[1]:.2f} m")
    if abs(lo[1]) > 0.02:
        bad.append(f"lowest point y = {lo[1]:.3f}")
    rep.add("FAIL" if bad else "PASS", "fit",
            "; ".join(bad) if bad else f"{size[0]:.2f} x {size[2]:.2f} m, {size[1]:.2f} m tall = archetype {W:g} x {D:g} x {H:g}"
            + (f" (a slim part reaches {top:g} m)" if top != H else ""))
    limit = budgets.budget(aid)
    for state in ("intact", "damaged", "rubble"):
        t = g.tris(g.subtree(state))
        rep.add("PASS" if t <= limit else "FAIL", "budget", f"{state} {t} triangles (budget {limit})")
    # chunks
    heavy, off = [], []
    pts = []
    for name in chunks:
        node = g.node(name)
        if g.node_tris(name) > budgets.CHUNK_TRIS:
            heavy.append(f"{name} ({g.node_tris(name)})")
        local = np.vstack([p.positions for p in g.meshes[node.mesh]]) if node.mesh is not None else np.zeros((1, 3))
        ext = local.max(axis=0) - local.min(axis=0)
        midp = (local.max(axis=0) + local.min(axis=0)) / 2
        if (np.abs(midp) > 0.05 * np.maximum(ext, 0.1)).any():
            off.append(name)
        pts.append(g.world_positions([node]))
    rep.add("FAIL" if heavy else "PASS", "chunks", f"over {budgets.CHUNK_TRIS} triangles: {heavy}" if heavy else
            f"every chunk within {budgets.CHUNK_TRIS} triangles")
    rep.add("FAIL" if off else "PASS", "chunks", f"origin not at center: {off}" if off else "every chunk's origin at its own center")
    if pts:
        allp = np.vstack(pts)
        drift = float(np.abs(np.concatenate([allp.min(axis=0) - lo, allp.max(axis=0) - hi])).max() / max(size.max(), 1e-6))
        rep.add("FAIL" if drift > 0.15 else "PASS", "chunks", f"together they match the intact box within {drift * 100:.0f}%")
    # rubble
    rlo, rhi = g.bounds(g.subtree("rubble"))
    inside = rlo[0] >= -W / 2 - 0.3 and rhi[0] <= W / 2 + 0.3 and rlo[2] >= -D / 2 - 0.3 and rhi[2] <= D / 2 + 0.3
    low = rhi[1] <= 0.35 * H + 0.01
    rep.add("PASS" if inside and low else "FAIL", "rubble",
            f"{rhi[1]:.2f} m tall, inside the footprint: {inside}")
    # materials, uv, the paint mask (walls 1, roofs 0.5, the rest 0)
    rects = _region_rects()
    mats, uv_bad, uv_cross, alpha_bad, tint_wrong = set(), 0, 0, 0, 0
    from city import kit
    masked = kit.roof_masked(aid)
    # roof triangles in intact and in every node; 0.5 off a grey roof; a grey roof without 0.5;
    # a colored roof (tile_red, gravel...) on an ordinary building, which the kit turns grey
    roof_tris, roof_any, roof_off, roof_bare, roof_colored = 0, 0, 0, 0, 0
    tintable = {name for name, r in atlas.REGIONS.items() if r.tint}
    grey_roofs = {name for name, r in atlas.REGIONS.items() if r.roof}
    intact_nodes = {n.index for n in g.subtree("intact")}
    for n, p in _prims(g, g.reachable()):
        mats.add(p.material)
        if p.uvs is None:
            uv_bad += len(p.indices)
            continue
        uv = p.uvs
        if uv.min() < -1e-4 or uv.max() > 1 + 1e-4:
            uv_bad += 1
        px = uv[:, 0] * atlas.W
        py = uv[:, 1] * atlas.H
        has_alpha = p.colors is not None and p.colors.shape[1] == 4
        for tri in p.indices:
            xs, ys = px[tri], py[tri]
            reg = None
            for x0, y0, x1, y1, name in rects:
                if xs.min() >= x0 - 0.01 and xs.max() <= x1 + 0.01 and ys.min() >= y0 - 0.01 and ys.max() <= y1 + 0.01:
                    reg = name
                    break
            if reg is None:
                uv_cross += 1
                continue
            a = float(p.colors[tri[0], 3]) if has_alpha else 1.0
            if a > 0.75 and reg not in tintable:
                tint_wrong += 1
            roof = 0.25 <= a <= 0.75
            if roof and reg not in grey_roofs:
                roof_off += 1
            elif not roof and reg in grey_roofs:
                roof_bare += 1
            elif roof:
                roof_any += 1
                roof_tris += int(n.index in intact_nodes)
            if masked and reg in kit.GREY_ROOFS:
                roof_colored += 1
        if has_alpha:
            a = p.colors[:, 3]
            alpha_bad += int(((a > 0.01) & (np.abs(a - 0.5) > 0.01) & (a < 0.99)).sum())
    rep.add("PASS" if mats == {contract.MAT_ATLAS} else "FAIL", "material", f"materials: {sorted(map(str, mats))}")
    rep.add("PASS" if not uv_bad and not uv_cross else "FAIL", "uv",
            "every triangle maps inside one atlas region" if not uv_bad and not uv_cross else
            f"{uv_bad} outside the atlas, {uv_cross} triangles straddle regions")
    rep.add("PASS" if not alpha_bad else "FAIL", "mask",
            "alpha is 0, 0.5 or 1" if not alpha_bad else f"{alpha_bad} vertices with an alpha other than 0, 0.5, 1")
    if tint_wrong:
        rep.add("WARN", "tint", f"{tint_wrong} tinted triangles on regions not authored for tinting")
    if roof_off or roof_bare:
        rep.add("FAIL", "roof", f"{roof_off} triangles with the roof mask off the grey roofs, "
                                f"{roof_bare} grey roof triangles without it")
    elif not masked:
        rep.add("PASS" if not roof_any else "FAIL", "roof",
                "keeps its own roof colors (no roof mask)" if not roof_any else
                f"{roof_any} roof triangles, but this archetype keeps its own roof colors")
    elif roof_colored:
        rep.add("FAIL", "roof", f"{roof_colored} triangles on colored roofs ({', '.join(sorted(kit.GREY_ROOFS))}): "
                                f"an ordinary building's roofs are grey (build it with the kit)")
    else:
        rep.add("PASS" if roof_tris else "WARN", "roof",
                f"intact: {roof_tris} roof triangles take the district's roof color" if roof_tris else
                "no roof faces: an ordinary building with a roof marks it (tools/art/README.md section 9)")
    # manifest
    entry = None
    for mf in glob.glob(os.path.join(contract.ASSETS, "manifest.*.json")):
        if mf.endswith("manifest.json"):
            continue
        with open(mf, encoding="utf-8") as f:
            data = json.load(f)
        if mid in data.get("models", {}):
            entry = data["models"][mid]
    if entry is None:
        rep.add("WARN", "manifest", "not listed in any partial manifest")
    else:
        need = ("tint", "district", "roof") if roof_tris else ("tint", "district")
        miss = [k for k in need if k not in entry]
        stray = ["roof"] if "roof" in entry and not roof_tris else []
        rep.add("WARN" if miss or stray else "PASS", "manifest",
                f"entry lacks {miss}" if miss else f"entry has {stray} but the model no roof faces" if stray else
                f"entry has {', '.join(need)}")
    return rep


def main(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--all" in args:
        args = [contract.asset_id(p) for p in sorted(glob.glob(os.path.join(contract.MODELS, "bld_*.glb")) +
                                                      glob.glob(os.path.join(contract.MODELS, "lm_*.glb")))]
    if not args:
        print(__doc__)
        return 2
    bad = 0
    for mid in args:
        rep = check_model(contract.asset_id(mid))
        print(rep.format())
        bad += 0 if rep.ok else 1
    print(f"{len(args)} building(s): {len(args) - bad} passed, {bad} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
