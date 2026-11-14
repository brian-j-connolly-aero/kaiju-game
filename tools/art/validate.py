#!/opt/mbtools/venv/bin/python
"""Check exported models against the art contract (docs/ASSETS.md section 3).

Reads the .glb files themselves (no Blender needed) and prints PASS, WARN or FAIL per rule.

    tools/art/validate.py prop_hydrant                  an asset id (looks in client/public/assets/models/)
    tools/art/validate.py path/to/file.glb              any .glb file
    tools/art/validate.py client/public/assets/manifest.props.json
                                                        every model in a partial manifest, and that
                                                        each entry still matches its file
    tools/art/validate.py --all                         every partial manifest, plus stray .glb files

Options:
    --kind KIND          kaiju | vehicle | projectile | structure | landmark | prop | misc
                         (default: from the file name: prop_ -> prop, bld_ -> structure, ...)
    --size-class CLASS   small | medium | large: triangle budget of a structure
    --budget N           override the triangle budget
    --nodes a,b,c        node names that must exist (default: from the contract for known ids)
    --origin MODE        ground (stands on y = 0) | center (flies) | free
    --strict             warnings count as failures
    -q, --quiet          print only problems and the result line

Exit code 0 if everything passes, 1 otherwise.
"""
import argparse
import glob
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

import contract  # noqa: E402
import validation  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Check models against the art contract.",
                                 epilog="See the top of this file or tools/art/README.md for examples.")
    ap.add_argument("targets", nargs="*", help="asset ids, .glb paths or manifest.<family>.json paths")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--kind", choices=contract.KINDS)
    ap.add_argument("--size-class", choices=sorted(contract.BUDGET_STRUCTURE))
    ap.add_argument("--budget", type=int)
    ap.add_argument("--nodes")
    ap.add_argument("--origin", choices=("ground", "center", "free"))
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args(argv)

    reports = []
    targets = list(args.targets)
    if args.all:
        partials = sorted(p for p in glob.glob(os.path.join(contract.ASSETS, "manifest.*.json")))
        targets.extend(partials)
    if not targets:
        ap.print_help()
        return 2
    listed = set()
    for t in targets:
        if t.endswith(".json"):
            reps = validation.validate_manifest(t)
            listed.update(r.asset for r in reps)
            reports.extend(reps)
        else:
            nodes = [n.strip() for n in args.nodes.split(",") if n.strip()] if args.nodes else None
            reports.append(validation.validate_file(contract.model_path(t), kind=args.kind,
                                                    size_class=args.size_class, budget=args.budget,
                                                    nodes=nodes, origin=args.origin))
    if args.all:
        for path in sorted(glob.glob(os.path.join(contract.MODELS, "*.glb"))):
            if contract.asset_id(path) not in listed:
                rep = validation.validate_file(path)
                rep.add(validation.WARN, "manifest", "this file is not listed in any partial manifest")
                reports.append(rep)

    failed = 0
    for rep in reports:
        bad = not rep.ok or (args.strict and rep.warnings)
        failed += bool(bad)
        print(rep.format(only_problems=args.quiet))
        if args.strict and rep.warnings and rep.ok:
            print("  (--strict: warnings count as failures)")
        print()
    total_w = sum(r.warnings for r in reports)
    print(f"{len(reports)} file(s) checked: {len(reports) - failed} passed, {failed} failed, {total_w} warning(s)")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
