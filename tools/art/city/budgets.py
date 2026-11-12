"""Triangle budgets per archetype, derived from how many of each the real city has.

COUNTS: structures per archetype in Port Meridian (generatePortMeridian, default seed),
measured with tools/art/city/count_city.ts (re-run it if the city changes; see README).

The rule (CITY_ART.md section 5):
- every state (intact, damaged, rubble) of an archetype stays within its budget;
- budgets never exceed the class ceilings of docs/ASSETS.md (small 120, medium 250,
  large 500, landmark 1500), which the pipeline's validate.py enforces;
- the whole intact city, sum of count x budget, must stay under CITY_CAP (900,000), with the
  room left over kept for the props, the kaiju and the army on screen.
Most archetypes get their class ceiling: at those numbers the intact city is about half of
the cap. A few simple shapes (tanks, warehouses, the container stack) get less.
"""
from __future__ import annotations

CITY_CAP = 900_000

COUNTS = {
    "house_a": 333, "house_b": 299, "house_c": 441, "rowhouse_a": 361, "shop_a": 132, "shop_b": 188,
    "shop_c": 135, "apartment_a": 159, "apartment_b": 97, "apartment_c": 62, "office_a": 51,
    "office_b": 35, "office_c": 28, "tower_a": 21, "tower_b": 12, "tower_c": 12, "factory_a": 46,
    "factory_b": 7, "warehouse_a": 24, "bridge_a": 5, "meridian_tower": 1, "city_hall": 1, "tank_a": 31,
    "crane_a": 15, "container_a": 55, "campus_a": 38, "pavilion_a": 24, "shrine_a": 72, "bridge_b": 1,
    "tidewater_cathedral": 1, "anchor_field": 1, "tidewheel": 1, "halcyon_observatory": 1,
    "farewell_light": 1, "kiln_point_power": 1, "sevenfold_temple": 1, "grand_station": 1,
    "signal_mast": 1, "gasworks": 1, "founders_clock": 1,
}

# triangles per state
BUDGETS = {
    # homes and shops (small class, ceiling 120)
    "house_a": 120, "house_b": 120, "house_c": 120, "rowhouse_a": 120,
    "shop_a": 120, "shop_b": 120, "shop_c": 120, "pavilion_a": 120, "shrine_a": 120,
    # blocks (medium 250 / large 500)
    "apartment_a": 250, "apartment_b": 250, "apartment_c": 250,
    "office_a": 250, "office_b": 250, "office_c": 500, "campus_a": 250,
    "tower_a": 500, "tower_b": 500, "tower_c": 500,
    # industry and bridges
    "factory_a": 250, "factory_b": 250, "warehouse_a": 220, "tank_a": 200, "crane_a": 250,
    "container_a": 120, "bridge_a": 250, "bridge_b": 500,
    # landmarks
    "meridian_tower": 1500, "city_hall": 1500, "tidewater_cathedral": 1500, "anchor_field": 1500,
    "tidewheel": 1500, "halcyon_observatory": 1500, "farewell_light": 1500, "kiln_point_power": 1500,
    "sevenfold_temple": 1500, "grand_station": 1500, "signal_mast": 1500, "gasworks": 1500,
    "founders_clock": 1500,
}

CHUNK_TRIS = 30
CHUNKS = (6, 24)


def budget(aid: str) -> int:
    return BUDGETS[aid]


def city_total() -> int:
    return sum(COUNTS.get(a, 0) * b for a, b in BUDGETS.items())


def table() -> list[tuple]:
    import contract
    rows = []
    for aid, b in BUDGETS.items():
        a = contract.archetypes().get(aid, {})
        rows.append((aid, a.get("class"), a.get("sizeClass") if not a.get("landmark") else "landmark",
                     COUNTS.get(aid, 0), b, COUNTS.get(aid, 0) * b))
    return rows


if __name__ == "__main__":
    import os
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
    total = 0
    for aid, cls, sc, n, b, s in table():
        total += s
        print(f"| {aid} | {cls} | {sc} | {n} | {b} | {s:,} |")
    print(f"total {total:,} of {CITY_CAP:,}")
