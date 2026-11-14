#!/opt/mbtools/venv/bin/python
"""Builds the voice lines. See build.sh for usage."""

from __future__ import annotations

import argparse
import fnmatch
import json
import sys
import time
from multiprocessing import Pool
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mbvoice import MANIFEST, OUT_DIR, VOICE_DIR  # noqa: E402
from mbvoice.pipeline import build_line, line_plan  # noqa: E402
from mbvoice.script import load_cast, load_lines, load_pronounce  # noqa: E402

STATE = VOICE_DIR / "build_state.json"


def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {"lines": {}}


def save_state(state: dict, order: list[str]) -> None:
    state["lines"] = {i: state["lines"][i] for i in order if i in state["lines"]}
    STATE.write_text(json.dumps(state, indent=1) + "\n")


def write_manifest(state: dict, order: list[str]) -> None:
    voice = {}
    for i in order:
        rec = state["lines"].get(i)
        if rec and (OUT_DIR / f"{i}.ogg").exists() and (OUT_DIR / f"{i}.mp3").exists():
            voice[i] = {"base": f"audio/voice/{i}", "duration": rec["duration"]}
    MANIFEST.write_text(json.dumps({"voice": voice}, indent=2) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description="Build the voice lines of Monster Battle 9001.")
    ap.add_argument("patterns", nargs="*", help="only line ids matching these globs (default: all)")
    ap.add_argument("--force", action="store_true", help="rebuild even if nothing changed")
    ap.add_argument("--no-verify", action="store_true", help="skip measurements, pictures and docs")
    ap.add_argument("--verify-only", action="store_true", help="measure and document the files already built")
    ap.add_argument("--jobs", type=int, default=2, help="worker processes (default 2; the machine is shared)")
    args = ap.parse_args()

    lines = load_lines()
    cast = load_cast()
    pron = load_pronounce()
    from mbvoice import asr, scriptcheck
    errors, warnings = scriptcheck.check(lines, asr.known_words())
    for msg in warnings:
        print("script warning:", msg, file=sys.stderr)
    for msg in errors:
        print("script error:", msg, file=sys.stderr)
    if errors:
        print(f"voice: the script breaks {len(errors)} rules (docs/VOICE_SCRIPT.md, \"Rules for writing new "
              f"lines\"); nothing was built", file=sys.stderr)
        return 1
    order = [l["id"] for l in lines]
    state = load_state()
    t0 = time.time()

    # files of lines that left the script are removed, so the folder always matches the script
    known = set(order)
    if OUT_DIR.exists():
        for f in sorted(OUT_DIR.iterdir()):
            if f.suffix in (".ogg", ".mp3") and f.stem not in known:
                print(f"removing {f.name}: not in the script any more")
                f.unlink()
    for gone in [i for i in state["lines"] if i not in known]:
        del state["lines"][gone]

    plans = {l["id"]: line_plan(l, cast, pron) for l in lines}
    built = 0
    if not args.verify_only:
        jobs = []
        for l in lines:
            if args.patterns and not any(fnmatch.fnmatch(l["id"], p) for p in args.patterns):
                continue
            rec = state["lines"].get(l["id"])
            have = (OUT_DIR / f"{l['id']}.ogg").exists() and (OUT_DIR / f"{l['id']}.mp3").exists()
            if args.force or not have or rec is None or rec.get("hash") != plans[l["id"]]["hash"]:
                jobs.append((l, plans[l["id"]]))
        print(f"voice: {len(lines)} lines in the script, {len(jobs)} to build "
              f"({len(lines) - len(jobs)} unchanged or not selected)")
        if jobs:
            with Pool(max(1, args.jobs)) as pool:
                for rec in pool.imap_unordered(build_line, jobs):
                    state["lines"][rec["id"]] = rec
                    built += 1
                    if built % 20 == 0 or built == len(jobs):
                        print(f"  built {built}/{len(jobs)}", flush=True)
            save_state(state, order)
        write_manifest(state, order)
        print(f"voice: built {built} lines in {time.time() - t0:.0f} s; manifest {MANIFEST.name} has "
              f"{len(json.loads(MANIFEST.read_text())['voice'])} lines")

    if args.no_verify:
        return 0
    from mbvoice import analyze, docgen, scriptdoc
    stale = [i for i in order if state["lines"].get(i, {}).get("hash") != plans[i]["hash"]]
    if stale:
        print(f"voice: {len(stale)} lines are out of date with the script, cast or code "
              f"(for example {stale[0]}); run build.sh without --verify-only", file=sys.stderr)
    report = analyze.verify(lines, cast, state, plans, jobs=args.jobs)
    docgen.write(lines, cast, pron, state, report)
    scriptdoc.write(lines, state, report)
    for msg in report["failures"]:
        print("FAIL:", msg, file=sys.stderr)
    print(f"voice: verified {len(report['lines'])} lines, {len(report['failures'])} failures, "
          f"total {time.time() - t0:.0f} s")
    return 1 if report["failures"] or stale else 0


if __name__ == "__main__":
    sys.exit(main())
