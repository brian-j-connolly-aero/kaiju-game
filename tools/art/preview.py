#!/opt/mbtools/venv/bin/python
"""Re-render any exported model: a contact sheet and/or a concept shot from a .glb.

    tools/art/preview.py prop_hydrant                       both pictures, into /tmp/mb-scratch/preview/
    tools/art/preview.py path/to/file.glb --sheet           only the contact sheet
    tools/art/preview.py kaiju_lizard_s1 --concept --backdrop sunset --az 40 --el 4
    tools/art/preview.py kaiju_lizard_s1 --pose "jaw.x=25,arm_L.x=-60,arm_R.x=-60" --cam cam_fp
    tools/art/preview.py bld_shop_a --show intact --extra top

Options:
    --sheet / --concept    which pictures (default: both)
    --out DIR              where to write (default /tmp/mb-scratch/preview); --docs writes to
                           docs/art/previews and docs/art/concept instead (the committed copies)
    --pose SPEC            rotate joints first: node.axis=degrees, comma separated, in the
                           game's axes (x+ nose down, y+ turn left, z+ left side up)
    --cam NODE[:FOV]       add a view from a node, looking forward (e.g. cam_fp:80); repeatable
    --extra VIEW           add a standard view: top, right, three_quarter_back; repeatable
    --show NODES           draw only these nodes, comma separated ("intact" or "chunk_*")
    --backdrop NAME        sky | sunset | night | studio | none   (concept shot)
    --az --el --fov --zoom orbit camera of the concept shot
    --atlas PNG            use this image for city_atlas faces instead of the shipped atlas
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import mb  # noqa: E402


def parse_pose(spec: str) -> dict:
    pose: dict = {}
    for part in filter(None, (p.strip() for p in spec.split(","))):
        try:
            target, value = part.split("=")
            node, axis = target.rsplit(".", 1)
            if axis not in ("x", "y", "z"):
                raise ValueError
            pose.setdefault(node, {})[axis] = float(value)
        except ValueError:
            raise SystemExit(f"bad --pose entry {part!r}: write node.axis=degrees, e.g. jaw.x=25")
    return pose


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Re-render an exported model.",
                                 epilog="See the top of this file or tools/art/README.md for examples.")
    ap.add_argument("asset", help="asset id or path to a .glb")
    ap.add_argument("--sheet", action="store_true")
    ap.add_argument("--concept", action="store_true")
    ap.add_argument("--out", default="/tmp/mb-scratch/preview")
    ap.add_argument("--docs", action="store_true")
    ap.add_argument("--pose", default="")
    ap.add_argument("--cam", action="append", default=[])
    ap.add_argument("--extra", action="append", default=[])
    ap.add_argument("--show", default="")
    ap.add_argument("--backdrop", default="sky", choices=["sky", "sunset", "night", "studio", "none"])
    ap.add_argument("--az", type=float, default=32.0)
    ap.add_argument("--el", type=float, default=9.0)
    ap.add_argument("--fov", type=float, default=32.0)
    ap.add_argument("--zoom", type=float, default=1.0)
    ap.add_argument("--atlas")
    args = ap.parse_args(argv)

    name = mb.contract.asset_id(args.asset)
    both = not (args.sheet or args.concept)
    pose = parse_pose(args.pose) or None
    show = tuple(s.strip() for s in args.show.split(",") if s.strip()) or None
    if args.atlas:
        mb.set_preview_atlas(os.path.abspath(args.atlas))
    mb.load_glb(args.asset)
    if args.sheet or both:
        extra = list(args.extra)
        for cam in args.cam:
            node, _, fov = cam.partition(":")
            extra.append(mb.View(f"FROM {node}", node=node, fov=float(fov) if fov else 80.0))
        out = os.path.join(mb.PREVIEWS if args.docs else args.out, f"{name}.png" if args.docs else f"{name}_sheet.png")
        print(mb.contact_sheet(name, out=out, extra=extra, pose=pose, show=show))
    if args.concept or both:
        out = os.path.join(mb.CONCEPT if args.docs else args.out, f"{name}.png" if args.docs else f"{name}_concept.png")
        print(mb.concept(name, out=out, backdrop=None if args.backdrop == "none" else args.backdrop,
                         azimuth=args.az, elevation=args.el, fov=args.fov, zoom=args.zoom, pose=pose, show=show))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
