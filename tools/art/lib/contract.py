"""The model contract from docs/ASSETS.md as data. Pure Python (no Blender needed).

Shared by mb.py (authoring), validate.py (checking) and the manifest writer, so the three
can never disagree. If ASSETS.md changes, change this file in the same edit.
"""
from __future__ import annotations

import json
import os
import re

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ASSETS = os.path.join(REPO, "client", "public", "assets")
MODELS = os.path.join(ASSETS, "models")
TEXTURES = os.path.join(ASSETS, "textures")
PREVIEWS = os.path.join(REPO, "docs", "art", "previews")
CONCEPT = os.path.join(REPO, "docs", "art", "concept")
ARCHETYPES_JSON = os.path.join(REPO, "tools", "art", "data", "archetypes.json")

# ---- section 3: materials ---------------------------------------------------------------
MAT_VCOL = "vcol"              # lit, vertex color COLOR_0
MAT_GLOW = "glow"              # unlit emissive, vertex color (eyes, weak points, lights)
MAT_ATLAS = "city_atlas"       # lit, UVs into textures/city_atlas.png
MATERIALS = (MAT_VCOL, MAT_GLOW, MAT_ATLAS)

KINDS = ("kaiju", "vehicle", "projectile", "structure", "landmark", "prop", "misc")

# ---- section 3: triangle budgets --------------------------------------------------------
BUDGET_KAIJU_S12 = 2500
BUDGET_KAIJU_S3 = 4000
BUDGET_VEHICLE = 500
BUDGET_CAR = 150
BUDGET_PROP = 80
BUDGET_STRUCTURE = {"small": 120, "medium": 250, "large": 500}
BUDGET_LANDMARK = 1500
BUDGET_CHUNK = 30
# Not named in ASSETS.md; chosen here so every file has a ceiling.
BUDGET_PROJECTILE = 80         # "tiny"
BUDGET_MISC = 500              # cocoon, egg and anything else

CHUNKS_MIN, CHUNKS_MAX = 6, 24

# Props that count as "cars" for the budget (traffic the hatchling crushes).
CAR_IDS = {"prop_car_sedan", "prop_car_taxi", "prop_car_van", "prop_bus", "prop_truck",
           "prop_car_wreck"}

# ---- section 3: required nodes ----------------------------------------------------------
# child -> parent, straight from the tree in ASSETS.md ("spines" is optional)
LIZARD_TREE = {
    "root": None,
    "hips": "root",
    "torso": "hips",
    "neck": "torso", "head": "neck", "jaw": "head", "cam_fp": "head", "mouth": "head",
    "arm_L": "torso", "forearm_L": "arm_L", "hand_L": "forearm_L",
    "arm_R": "torso", "forearm_R": "arm_R", "hand_R": "forearm_R", "hold": "hand_R",
    "weak_point": "torso",
    "leg_L": "hips", "shin_L": "leg_L", "foot_L": "shin_L",
    "leg_R": "hips", "shin_R": "leg_R", "foot_R": "shin_R",
    "tail_1": "hips", "tail_2": "tail_1", "tail_3": "tail_2", "tail_4": "tail_3",
    "tail_5": "tail_4",
}
LIZARD_OPTIONAL = {"spines": "torso"}
KAIJU_COMMON = ["root", "cam_fp", "mouth", "hold", "weak_point"]
LIZARD_HEIGHT = {1: 4.5, 2: 32.0, 3: 115.0}     # meters, by stage

STRUCTURE_STATES = ["intact", "damaged", "rubble"]

REQUIRED_NODES = {
    "army_tank": ["hull", "turret", "barrel", "muzzle", "track_L", "track_R"],
    "air_drone": ["body", "rotor_1", "rotor_2", "rotor_3", "rotor_4"],
    "air_heli": ["body", "rotor_main", "rotor_tail", "gun"],
    "sci_dishtruck": ["hull", "dish", "emitter"],
    "faith_belltruck": ["hull", "bell"],
    "faith_ark": ["base", "lid"],
}

# Nodes that must be empties (no mesh): anchors the code reads positions from.
EMPTY_NODES = {"cam_fp", "mouth", "hold", "muzzle"}
# Nodes that must be meshes using only the glow material.
GLOW_NODES = {"weak_point"}

# Plausible overall size (largest dimension, meters) per kind: catches wrong units.
SIZE_RANGE = {
    "kaiju": (0.5, 260.0),
    "vehicle": (0.3, 60.0),
    "projectile": (0.05, 6.0),
    "structure": (1.5, 400.0),
    "landmark": (3.0, 500.0),
    "prop": (0.15, 30.0),
    "misc": (0.05, 300.0),
}

_NAME_OK = re.compile(r"^[A-Za-z0-9_]+$")


def valid_node_name(name: str) -> bool:
    """Node names the client can look up safely (three.js strips other characters)."""
    return bool(_NAME_OK.match(name or ""))


def asset_id(path_or_id: str) -> str:
    base = os.path.basename(path_or_id)
    return base[:-4] if base.lower().endswith(".glb") else base


def model_path(asset: str) -> str:
    """Absolute path of the .glb for an asset id (or pass a path through)."""
    if asset.lower().endswith(".glb") or os.sep in asset:
        return os.path.abspath(asset)
    return os.path.join(MODELS, asset + ".glb")


def kind_of(asset: str) -> str:
    """Manifest `kind` implied by the file name."""
    a = asset_id(asset)
    if a in ("kaiju_cocoon", "kaiju_egg"):
        return "misc"
    if a.startswith("kaiju_"):
        return "kaiju"
    if a.startswith("proj_"):
        return "projectile"
    if a.startswith("bld_"):
        return "structure"
    if a.startswith("lm_"):
        return "landmark"
    if a.startswith("prop_"):
        return "prop"
    if a.startswith(("army_", "air_", "sci_", "faith_")):
        return "vehicle"
    return "misc"


def kaiju_parts(asset: str):
    """('lizard', 3) for 'kaiju_lizard_s3', else None."""
    m = re.match(r"^kaiju_([a-z]+)_s([1-3])$", asset_id(asset))
    return (m.group(1), int(m.group(2))) if m else None


_archetypes_cache: dict | None = None


def archetypes() -> dict:
    """Structure archetypes exported by `npm run export:defs`, keyed by id ({} if absent)."""
    global _archetypes_cache
    if _archetypes_cache is None:
        _archetypes_cache = {}
        if os.path.exists(ARCHETYPES_JSON):
            try:
                with open(ARCHETYPES_JSON, encoding="utf-8") as f:
                    data = json.load(f)
                items = data.get("archetypes", data) if isinstance(data, dict) else data
                if isinstance(items, dict):
                    items = [dict(v, id=v.get("id", k)) for k, v in items.items() if isinstance(v, dict)]
                for it in items:
                    if isinstance(it, dict) and "id" in it:
                        _archetypes_cache[str(it["id"])] = it
            except (OSError, ValueError):
                _archetypes_cache = {}
    return _archetypes_cache


_props_cache: dict | None = None


def prop_def(asset: str) -> dict | None:
    """The game's own numbers for a prop ({"radius", "height"} in meters), from the same
    export as the archetypes (shared/src/city/props.ts), or None if unknown."""
    global _props_cache
    if _props_cache is None:
        _props_cache = {}
        if os.path.exists(ARCHETYPES_JSON):
            try:
                with open(ARCHETYPES_JSON, encoding="utf-8") as f:
                    data = json.load(f)
                for it in (data.get("props", []) if isinstance(data, dict) else []):
                    if isinstance(it, dict):
                        _props_cache[str(it.get("model") or "prop_" + str(it.get("id")))] = it
            except (OSError, ValueError):
                _props_cache = {}
    return _props_cache.get(asset_id(asset))


def archetype_for(asset: str) -> dict | None:
    a = asset_id(asset)
    for prefix in ("bld_", "lm_"):
        if a.startswith(prefix):
            return archetypes().get(a[len(prefix):]) or archetypes().get(a)
    return None


def archetype_dims(arch: dict):
    """(width, depth, height) from an archetype record, tolerant of field spellings."""
    if not arch:
        return None
    fp = arch.get("footprint")
    w = d = None
    if isinstance(fp, (list, tuple)) and len(fp) >= 2:
        w, d = fp[0], fp[1]
    elif isinstance(fp, dict):
        w = fp.get("w", fp.get("width", fp.get("x")))
        d = fp.get("d", fp.get("depth", fp.get("z", fp.get("y"))))
    h = arch.get("height", arch.get("h"))
    if all(isinstance(v, (int, float)) for v in (w, d, h)):
        return float(w), float(d), float(h)
    return None


def size_class(asset: str, hint: str | None = None) -> str | None:
    """'small' | 'medium' | 'large' for a structure: from a hint, else from the archetype.

    Mirrors archetypeSizeClass() in shared/src/city/archetypes.ts: by bounding volume,
    under 2500 cubic meters is small, under 30000 medium, otherwise large.
    """
    if hint in BUDGET_STRUCTURE:
        return hint
    arch = archetype_for(asset)
    if arch:
        for key in ("sizeClass", "size_class"):
            v = arch.get(key)
            if isinstance(v, str) and v.lower() in BUDGET_STRUCTURE:
                return v.lower()
        dims = archetype_dims(arch)
        if dims:
            return size_class_for_dims(*dims)
    return None


def size_class_for_dims(width: float, depth: float, height: float) -> str:
    volume = width * depth * height
    if volume < 2500:
        return "small"
    if volume < 30000:
        return "medium"
    return "large"


def budget_for(asset: str, kind: str | None = None, size_cls: str | None = None) -> tuple[int, str]:
    """(triangle budget, human-readable reason) for an asset."""
    a = asset_id(asset)
    kind = kind or kind_of(a)
    if kind == "kaiju":
        kp = kaiju_parts(a)
        if kp and kp[1] == 3:
            return BUDGET_KAIJU_S3, "kaiju stage 3"
        return BUDGET_KAIJU_S12, "kaiju stage 1 or 2"
    if kind == "vehicle":
        return BUDGET_VEHICLE, "vehicle"
    if kind == "projectile":
        return BUDGET_PROJECTILE, "projectile (tiny)"
    if kind == "prop":
        if a in CAR_IDS or a.startswith("prop_car_"):
            return BUDGET_CAR, "car"
        return BUDGET_PROP, "prop"
    if kind == "landmark":
        return BUDGET_LANDMARK, "landmark"
    if kind == "structure":
        cls = size_class(a, size_cls)
        if cls:
            return BUDGET_STRUCTURE[cls], f"{cls} structure"
        return BUDGET_STRUCTURE["large"], "structure (size class unknown, using large)"
    return BUDGET_MISC, "misc"


def required_nodes(asset: str, kind: str | None = None) -> list[str]:
    """Node names the contract requires for this asset (may be empty)."""
    a = asset_id(asset)
    kind = kind or kind_of(a)
    if a in REQUIRED_NODES:
        return list(REQUIRED_NODES[a])
    kp = kaiju_parts(a)
    if kp:
        return list(LIZARD_TREE) if kp[0] == "lizard" else list(KAIJU_COMMON)
    if kind in ("structure", "landmark"):
        return list(STRUCTURE_STATES)
    return []


def origin_mode(asset: str, kind: str | None = None) -> str:
    """'ground' (stands on y = 0), 'center' (flies: origin at its own middle)."""
    a = asset_id(asset)
    kind = kind or kind_of(a)
    if kind == "projectile" or a.startswith("air_"):
        return "center"
    return "ground"
