#!/opt/mbtools/venv/bin/python
"""Builds the Monster Battle 9001 soundtrack. See build.sh and docs/audio/MUSIC.md."""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mbmusic import mixdown  # noqa: E402
from mbmusic.cues import all_cues  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cues", nargs="*", help="cue names to build (default: all)")
    ap.add_argument("--no-encode", action="store_true", help="stop at the mastered WAV in scratch")
    ap.add_argument("--review", action="store_true", help="print the composer's score review and stop")
    ap.add_argument("--verify", action="store_true", help="measure the encoded files and draw spectrograms")
    args = ap.parse_args()

    cues = all_cues(args.cues or None)
    if not cues:
        print("no such cue", file=sys.stderr)
        return 2
    if args.review:
        from mbmusic import review
        return review.run(cues)
    t0 = time.time()
    entries = {}
    if mixdown.MANIFEST.exists() and args.cues:
        entries = json.loads(mixdown.MANIFEST.read_text()).get("music", {})
    for cue in cues:
        entries.update(mixdown.render_cue(cue, encode=not args.no_encode)["manifest"])
    if not args.no_encode:
        mixdown.write_manifest(entries)
    print(f"built {len(cues)} cue(s) in {time.time() - t0:.1f} s")
    if args.verify:
        from mbmusic import analyze
        return analyze.run(cues)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
