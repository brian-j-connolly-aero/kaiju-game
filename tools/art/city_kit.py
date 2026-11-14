#!/opt/mbtools/venv/bin/python
# mb-family: city_kit order=10
"""The city kit's shared textures: city_atlas.png and city_atlas_emissive.png.

Paints both atlases (tools/art/city/atlas.py, plus every family's block from
tools/art/city/atlas_extra/), writes the layout for people (tools/art/city/atlas_layout.json,
docs/art/previews/city_kit_atlas.png) and the manifest entries
(client/public/assets/manifest.city_kit.json). Runs before the building families, which
preview with these images. About 3 seconds.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)

import mb  # noqa: E402
from city import atlas  # noqa: E402


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--list" in argv:
        print("city_atlas\ncity_atlas_emissive")
        return 0
    cv = atlas.write(layout_json=os.path.join(HERE, "city", "atlas_layout.json"))
    if "--no-previews" not in argv and not os.environ.get("MB_NO_PREVIEWS"):
        atlas.preview(os.path.join(mb.PREVIEWS, "city_kit_atlas.png"), cv)
    man = mb.Manifest("city_kit")
    man.add_texture("city_atlas")
    man.add_texture("city_atlas_emissive")
    man.write()
    print(f"city_kit: {len(atlas.REGIONS)} regions -> {os.path.relpath(atlas.COLOR_PNG, atlas.REPO)}, "
          f"{os.path.relpath(atlas.EMISSIVE_PNG, atlas.REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
