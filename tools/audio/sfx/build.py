#!/opt/mbtools/venv/bin/python
"""Builds the Monster Battle 9001 sound effects. See build.sh and docs/audio/SFX.md."""
import argparse
import fnmatch
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mbsfx import master  # noqa: E402
from mbsfx.registry import load_all  # noqa: E402


def _job(args):
    sid, variant, encode = args
    specs = load_all()
    t0 = time.time()
    info = master.render(specs[sid], variant, encode=encode)
    info["build_seconds"] = round(time.time() - t0, 2)
    return info


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("ids", nargs="*", help="sound ids or patterns such as 'kaiju_roar*' (default: all)")
    ap.add_argument("--no-encode", action="store_true", help="stop at the mastered WAV in scratch")
    ap.add_argument("--no-verify", action="store_true", help="skip measurements, pictures and the docs table")
    ap.add_argument("--verify-only", action="store_true", help="measure the files already built; build nothing")
    ap.add_argument("--jobs", type=int, default=int(os.environ.get("SFX_JOBS", "3")))
    args = ap.parse_args()

    specs = load_all()
    chosen = [s for s in specs.values()
              if not args.ids or any(fnmatch.fnmatch(s.id, pat) for pat in args.ids)]
    if not chosen:
        print("no such sound", file=sys.stderr)
        return 2
    if args.verify_only:
        from mbsfx import analyze
        return analyze.run(specs, only=None if not args.ids else [s.id for s in chosen])
    jobs = [(s.id, v, not args.no_encode) for s in chosen for v in range(1, s.variants + 1)]
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        infos = list(pool.map(_job, jobs, chunksize=1))
    for i in infos:
        note = f"  limiter {i['limiter_db']:.1f} dB" if i["limiter_db"] > 0.05 else ""
        note += f"  soft clip {i['clip_db']:.1f} dB" if i["clip_db"] > 0.05 else ""
        note += f"  codec trim {i['trim_db']:.2f} dB" if i["trim_db"] else ""
        print(f"  {i['name']:28s} {i['seconds']:6.2f} s  {'stereo' if i['channels'] == 2 else 'mono  '}{note}")
    print(f"built {len(jobs)} file(s) for {len(chosen)} sound(s) in {time.time() - t0:.1f} s")
    if args.no_encode:
        return 0
    master.write_manifest(list(specs.values()))
    if args.no_verify:
        return 0
    from mbsfx import analyze
    return analyze.run(specs, only=None if not args.ids else [s.id for s in chosen], build_info=infos)


if __name__ == "__main__":
    raise SystemExit(main())
