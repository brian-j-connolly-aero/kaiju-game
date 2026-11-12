#!/opt/mbtools/venv/bin/python
# mb-family: city_samples
"""The city kit's three proof buildings: bld_house_a, bld_tower_a, bld_factory_a.

Each is built from kit parts only; the damaged, rubble and chunk states come from the kit's
one destruction generator. Also the worked examples for the building artists.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)

from city import kit, style  # noqa: E402


@kit.building("house_a", district="suburb", tone="cream", seed=3)
def house_a(b):
    # A front-gabled house (the attic is its second storey) with a garage wing on its left.
    main = b.block(6.0, 9.25, 3.4, at=(-1.125, 0.0, 0.0), facade="plaster_sash", roof=False)
    b.gable(main, rise=2.6, along="y", roof="tile_red")
    b.door(main, "front", x=1.4, kind="door_red")
    b.box((main.x0 + 3.3, main.y0 - 0.45, 2.35), (main.x0 + 5.4, main.y0, 2.5), color="#f2efe8", top="white", bottom=True)  # door hood
    b.chimney(-3.0, 1.8, 3.0, 5.9, region="brick_plain")
    wing = b.block(2.25, 6.0, 2.6, at=(3.0, 1.25, 0.0), facade="plaster_plain", roof=False,
                   sides={"right": None})                                   # against the house: no wall
    b.shed(wing, rise=0.75, high="right", roof="tile_red")
    b.door(wing, "front", x=0.0, kind="door_garage")


@kit.building("tower_a", district="downtown", tone="stone", seed=5)
def tower_a(b):
    # Stone podium with a glass lobby, a teal glass shaft with white corner fins, a plant-room
    # crown and a mast with a beacon (the mast tip is the archetype's 95 m).
    pod = b.block(25.6, 24.6, 9.0, at=(0.0, 0.65, 0.0), facade="stone_grid", ground="lobby", parapet=0.6)
    b.door(pod, "front", x=0.0, kind="door_double")
    b.box((-6.0, -12.95, 4.0), (6.0, pod.y0, 4.45), color="#3a4256", top="white", bottom=True)  # entrance canopy
    shaft = b.block(22.0, 22.0, 76.0, at=(0, 0, 9.0), facade="glass_teal", roof="tar")
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * 11.0, sy * 11.0
            b.box((x - 0.6, y - 0.6, 9.0), (x + 0.6, y + 0.6, 86.2), color="#f4f5f7", top="white")
    crown = b.block(16.0, 16.0, 3.6, at=(0, 0, 85.0), facade="metal_clad", parapet=0.6, parapet_region="cornice")
    b.decal(crown, "front", 0.0, 85.4, 5.2, 2.6, "sign_rings", offset=0.1)
    b.roof_box(-4.5, 3.0, 89.2, 4.0, 3.0, 1.8)
    b.antenna(3.0, -2.0, 89.2, 95.0, beacon=True, r=0.35)


@kit.building("factory_a", district="industry", tone="concrete", seed=7)
def factory_a(b):
    # A brick works shed under four north-light teeth, a concrete office on its left front,
    # loading doors on the front, one round brick chimney at the back.
    shed = b.block(30.0, 24.0, 7.5, at=(-3.0, 0.0, 0.0), facade="brick_works", roof=False)
    b.sawtooth(shed, teeth=4, rise=3.0, roof="metal", glass="glass_roof")
    for x in (-9.0, 1.0):
        b.door(shed, "front", x=x, kind="door_roller")
    b.door(shed, "right", x=4.0, kind="door_roller")
    office = b.block(6.0, 13.0, 6.6, at=(15.0, -5.5, 0.0), facade="strip_concrete", parapet=0.5,
                     parapet_region="concrete_plain")
    b.door(office, "front", x=0.0, kind="door_double")
    b.sign(office, "front", "wrench", x=0.0, z=3.4, height=1.4)
    b.prism((-14.0, 8.5), 1.15, 0.0, 14.0, n=8, region="brick_plain", top="dark", solid=True)


if __name__ == "__main__":
    raise SystemExit(kit.run_family("city_samples"))
