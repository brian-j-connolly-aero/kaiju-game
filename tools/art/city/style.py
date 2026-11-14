"""The building style as numbers: sizes in meters, the atlas pixel scale, district colors.

Everything a building artist needs to make scale read the same on every building lives
here, so the kit, the atlas painter and docs/art/CITY_ART.md never disagree.
"""
from __future__ import annotations

# ---- scale --------------------------------------------------------------------------------
PX = 0.1875            # meters per atlas pixel on facades and roofs (16 px = 3 m)
STOREY = 3.0           # upper storey, floor to floor (16 px)
GROUND = 4.5           # ground storey of shops, blocks and offices (24 px)
BAY = 3.0              # one window per bay (16 px)
WINDOW = (1.5, 1.875)  # width, height of an ordinary window (8 x 10 px)
SILL = 0.75            # window sill above its floor (4 px)
DOOR = (1.125, 2.25)   # house door with its frame (6 x 12 px)
DOOR_DOUBLE = (2.25, 2.625)   # shop and lobby doors (12 x 14 px)
DOOR_GARAGE = (3.0, 2.25)     # house garage (16 x 12 px)
DOOR_ROLLER = (3.75, 3.75)    # loading door (20 x 20 px)
PARAPET = 0.75         # flat-roof parapet above the roof surface
CORNICE = 0.375        # cornice band (2 px) on shops and old blocks
EAVE = 0.375           # how far a pitched roof overhangs the wall
BALCONY_DEPTH = 1.2
RAIL = 1.0             # balcony and parapet railing height
SIGN_BAND = 1.125      # fascia sign band over a shopfront (6 px)
PERSON = 1.8           # the soldier
HATCHLING = 4.5        # the kaiju at stage 1

# Footprint and height tolerance: the simulation collides with the archetype's box, so the
# whole intact model (overhangs, antennas and all) must fill that box and stay inside it.
FIT_TOL_ABS = 0.25     # meters
FIT_TOL_REL = 0.02     # of the dimension; the larger of the two applies


def fit_tolerance(dim: float) -> float:
    return max(FIT_TOL_ABS, FIT_TOL_REL * dim)


# ---- color --------------------------------------------------------------------------------
# Wall tones (sRGB). A wall marked tintable is authored in its building's default tone; the
# client may replace it per building with one of the district's colors (CITY_ART.md, "tint").
TONES = {
    "cream": "#f3e3b3", "salmon": "#f2a48b", "sky": "#a8d4f0", "mint": "#a9e5c5",
    "mustard": "#e3c04f", "peach": "#f6c9a0", "lilac": "#c9b5e8", "lime": "#cfe8a0",
    "white": "#f5f2ea", "rose": "#efb3b8", "ochre": "#e6b566", "sand": "#ead2a0",
    "stone": "#ddd6c6", "slate": "#8fa0b5", "seafoam": "#b4e3dc", "concrete": "#bdb9b0",
}

# District color families (CITY_ART.md section 3). "walls": tint colors a building of that
# district may take; "roof": its roof region; "accent": awnings, doors, trim.
DISTRICTS = {
    "suburb":     dict(walls=["cream", "salmon", "sky", "mint", "peach", "lime", "white", "lilac"],
                       roof="tile_red", accent=["#d7263d", "#2f62c9", "#3fa652"]),
    "oldtown":    dict(walls=["ochre", "sand", "salmon", "cream", "peach", "mustard"],
                       roof="tile_red", accent=["#b8432f", "#2e6b4f", "#7a3b69"]),
    "temple":     dict(walls=["white", "rose", "cream", "peach", "sand"],
                       roof="tile_terra", accent=["#c4552d", "#e3c04f", "#2e6b4f"]),
    "downtown":   dict(walls=["stone", "slate", "white", "concrete", "sky"],
                       roof="gravel", accent=["#2f62c9", "#d7263d", "#3a4256"]),
    "university": dict(walls=["stone", "sand", "cream"],
                       roof="tile_slate", accent=["#7a2e3b", "#2e6b4f"]),
    "industry":   dict(walls=["concrete", "slate", "sand", "mustard"],
                       roof="metal", accent=["#e3b23c", "#c5553d", "#3a4256"]),
    "harbor":     dict(walls=["sky", "seafoam", "white", "slate", "salmon"],
                       roof="tile_slate", accent=["#c5553d", "#2f7fd6", "#e3b23c"]),
    "boardwalk":  dict(walls=["white", "seafoam", "peach", "sky", "rose"],
                       roof="tile_slate", accent=["#d7263d", "#2f7fd6", "#f2a48b"]),
}

RUBBLE = ["#8d8d94", "#9a9aa1", "#7b7b82", "#a6a6ac"]   # the anchor and three neighbors
SCORCH = "#3b3632"
TRIM = "#f8f6f0"         # window trim, cornices, railings (white paint)
METAL = "#8a96a8"
METAL_DK = "#4f5866"
RUST = "#a4553a"
GLASS_DAY = "#2c3e5c"
