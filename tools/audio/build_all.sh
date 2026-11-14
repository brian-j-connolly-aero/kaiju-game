#!/usr/bin/env bash
# Rebuilds every sound in the game from its generator sources with one command: the music, the
# sound effects and the voice lines (each as .ogg and .mp3 under client/public/assets/audio/,
# with its partial manifest and its measured documentation under docs/audio/), then merges the
# partial manifests into client/public/assets/manifest.json.
#
#   tools/audio/build_all.sh                   everything, every file rebuilt and re-measured
#   tools/audio/build_all.sh --only sfx,voice  only these families (music, sfx, voice)
#   tools/audio/build_all.sh --changed         voice: only the lines whose words, voice or
#                                              processing changed (music and effects are always
#                                              rebuilt whole)
#   tools/audio/build_all.sh --clean           throw away the music's rendered instrument parts
#                                              first, so that every note is rendered again (they
#                                              are the only thing kept from one run to the next)
#   tools/audio/build_all.sh --no-verify       skip each family's measurements, pictures and documents
#   tools/audio/build_all.sh --jobs 2          how many processor cores the build may use (default 2)
#   tools/audio/build_all.sh --list            print the steps and stop
#
# The steps, one after the other:
#   music      tools/audio/music/build.sh          score review, render, master, encode, verify
#   sfx        tools/audio/sfx/build.sh            synthesis, master, encode, verify, docs/audio/SFX.md
#   voice      tools/audio/voice/build.sh --force  script check, speech, processing, encode, verify,
#                                                  docs/audio/VOICE.md, docs/VOICE_SCRIPT.md
#   manifest   npm run assets:manifest             merge the partial manifests into manifest.json
#
# A step that fails does not stop the steps after it (the families are independent, and each
# builder's own checks are part of its step), but the script then ends with exit status 1 and
# names the step. It ends with status 0 only when every step succeeded.
#
# The machine is shared, so the whole build is held to --jobs cores: the builders that take a
# job count are given it, and the run is pinned to that many cores (the music builder always
# starts three synthesizer processes at a time; pinned, they share the cores they are given).
# MB_AUDIO_CPUS names the cores to use (a taskset list such as "2,3"); the default is the last
# ones this shell may use.
#
# Intermediate files (MIDI, WAV masters, logs) go under /tmp/mb-scratch, never into the repository:
#   $MB_SCRATCH_ROOT/music, $MB_SCRATCH_ROOT/voice   MB_SCRATCH_ROOT defaults to /tmp/mb-scratch
#   /tmp/mb-scratch/sfx                              fixed inside the sound effect builder
#   $MB_SCRATCH_ROOT/audio-build/<step>.log          what each step printed
# The music's rendered parts ($MB_SCRATCH_ROOT/music/parts) take about 14 GB of disk.
#
# Needs the asset tools (tools/setup-asset-tools.sh) and Node with the repository's packages
# installed (npm install). More in tools/audio/README.md.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
py="${MB_PYTHON:-/opt/mbtools/venv/bin/python}"
root="${MB_SCRATCH_ROOT:-/tmp/mb-scratch}"
jobs="${MB_AUDIO_JOBS:-2}"
only="music,sfx,voice"
changed=0
clean=0
verify=1
list_only=0

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --only) shift; [ $# -gt 0 ] || { echo "--only needs a list, for example: --only sfx,voice" >&2; exit 2; }
            only="$1" ;;
    --only=*) only="${1#--only=}" ;;
    --changed) changed=1 ;;
    --clean) clean=1 ;;
    --no-verify) verify=0 ;;
    --jobs) shift; [ $# -gt 0 ] || { echo "--jobs needs a number" >&2; exit 2; }
            jobs="$1" ;;
    --jobs=*) jobs="${1#--jobs=}" ;;
    --list) list_only=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

case "$jobs" in
  ''|*[!0-9]*|0) echo "--jobs must be a whole number, 1 or more, not '$jobs'" >&2; exit 2 ;;
esac
case "$root" in
  /) echo "MB_SCRATCH_ROOT must not be /" >&2; exit 2 ;;
  /*) ;;
  *) echo "MB_SCRATCH_ROOT must be an absolute path, not '$root'" >&2; exit 2 ;;
esac

# the families asked for, always built in the same order
steps=()
for f in ${only//,/ }; do
  case "$f" in
    music|sfx|voice) ;;
    *) echo "unknown family '$f' (the families are music, sfx, voice)" >&2; exit 2 ;;
  esac
done
for f in music sfx voice; do
  case ",$only," in *",$f,"*) steps+=("$f") ;; esac
done
[ "${#steps[@]}" -gt 0 ] || { echo "nothing to build" >&2; exit 2; }
steps+=(manifest)

# step_command <step>: sets `cmd`, the command line of that step
step_command() {
  local extra=()
  [ "$verify" = 1 ] || extra+=(--no-verify)
  case "$1" in
    music)
      cmd=(env "MB_SCRATCH=$root/music" "$here/music/build.sh" ${extra[@]+"${extra[@]}"}) ;;
    sfx)
      cmd=("$here/sfx/build.sh" --jobs "$jobs" ${extra[@]+"${extra[@]}"}) ;;
    voice)
      [ "$changed" = 1 ] || extra=(--force ${extra[@]+"${extra[@]}"})
      cmd=(env "MB_SCRATCH=$root/voice" "$here/voice/build.sh" --jobs "$jobs" ${extra[@]+"${extra[@]}"}) ;;
    manifest)
      cmd=(npm run assets:manifest) ;;
  esac
}

if [ "$list_only" = 1 ]; then
  for s in "${steps[@]}"; do
    step_command "$s"
    printf '%-9s' "$s"; printf ' %q' "${cmd[@]}"; printf '\n'
  done
  exit 0
fi

# ---- tools: checked now, not after twenty minutes of building ------------------------------
[ -x "$py" ] || { echo "missing $py: run tools/setup-asset-tools.sh" >&2; exit 1; }
for tool in ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || { echo "missing $tool: run tools/setup-asset-tools.sh" >&2; exit 1; }
done
for tool in node npm; do
  command -v "$tool" >/dev/null || { echo "missing $tool: install Node (see README.md), then run npm install" >&2; exit 1; }
done
cd "$repo" || exit 1

# ---- hold the whole build to $jobs cores ----------------------------------------------------
# The pin is put on this shell, and every process a builder starts inherits it.
pinned=""
if command -v taskset >/dev/null; then
  cpus="${MB_AUDIO_CPUS:-}"
  if [ -z "$cpus" ]; then
    # what this shell may use, for example "0-3" or "0,2-5", as a plain list of core numbers
    allowed="$(taskset -cp $$ 2>/dev/null | sed 's/.*: *//')"
    list=()
    IFS=',' read -r -a ranges <<< "$allowed"
    for r in ${ranges[@]+"${ranges[@]}"}; do
      case "$r" in
        *-*) for ((c = ${r%-*}; c <= ${r#*-}; c++)); do list+=("$c"); done ;;
        ?*) list+=("$r") ;;
      esac
    done
    if [ "${#list[@]}" -gt "$jobs" ]; then
      cpus="$(IFS=,; echo "${list[*]: -$jobs}")"
    fi
  fi
  if [ -n "$cpus" ]; then
    if taskset -cp "$cpus" $$ >/dev/null 2>&1; then
      pinned="$cpus"
    else
      echo "note: could not pin the build to cores $cpus; it runs unpinned" >&2
    fi
  fi
else
  echo "note: taskset is not installed, so the build is not pinned; the music builder may use three cores for a while" >&2
fi
export SFX_JOBS="$jobs"

logs="$root/audio-build"
mkdir -p "$logs" || { echo "cannot create $logs" >&2; exit 1; }

echo "audio build: ${steps[*]}"
if [ -n "$pinned" ]; then
  echo "  $jobs job(s), pinned to core(s) $pinned; scratch under $root; logs in $logs"
else
  echo "  $jobs job(s), not pinned; scratch under $root; logs in $logs"
fi

# --clean: the rendered instrument parts are the one thing a builder reuses from an earlier run
# (the effects are always synthesized again, and --force does the same for the voice lines)
if [ "$clean" = 1 ]; then
  case " ${steps[*]} " in
    *" music "*) echo "  emptying $root/music/parts"; rm -rf -- "$root/music/parts" ;;
    *) echo "  --clean: nothing to empty (only the music keeps rendered parts)" ;;
  esac
fi

# The voice builder keeps the measurements of a line for as long as its words, voice and
# processing stay the same, even when --force has just rebuilt its files. A full build has to
# measure the files it built, so the kept measurements are set aside for the voice step, which
# then measures all the lines again. If the builder stops before it has written new ones, the
# old ones are put back (also when this script is interrupted).
voice_measurements="$repo/docs/audio/voice/measurements.json"
voice_kept=""
restore_voice_measurements() {
  if [ -n "$voice_kept" ] && [ -f "$voice_kept" ]; then
    if [ -f "$voice_measurements" ]; then rm -f -- "$voice_kept"; else mv -- "$voice_kept" "$voice_measurements"; fi
  fi
  voice_kept=""
}
trap restore_voice_measurements EXIT

# ---- run ------------------------------------------------------------------------------------
t_start=$SECONDS
results=()
failed=""
for s in "${steps[@]}"; do
  step_command "$s"
  log="$logs/$s.log"
  echo
  printf '=== %s:' "$s"; printf ' %q' "${cmd[@]}"; printf '\n'
  t0=$SECONDS
  if [ "$s" = voice ] && [ "$changed" = 0 ] && [ "$verify" = 1 ] && [ -f "$voice_measurements" ]; then
    voice_kept="$logs/voice-measurements.kept.json"
    mv -- "$voice_measurements" "$voice_kept" || voice_kept=""
  fi
  "${cmd[@]}" 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  restore_voice_measurements
  if [ "$rc" = 0 ]; then
    state="ok"
  else
    state="FAILED (exit status $rc)"
    failed="$failed $s"
  fi
  results+=("$(printf '%-9s %5d s  %-25s %s' "$s" $((SECONDS - t0)) "$state" "$log")")
done

# ---- summary --------------------------------------------------------------------------------
echo
echo "=== summary"
for r in "${results[@]}"; do echo "  $r"; done
total=$((SECONDS - t_start))
printf '  %-9s %5d s  (%d min %02d s)\n' total "$total" $((total / 60)) $((total % 60))

# What the build changed compared with the last commit. Information only: nothing is written.
# A rebuild from unchanged sources should leave every .ogg and .mp3 exactly as it was.
if command -v git >/dev/null && git --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  n_all=$(find client/public/assets/audio -type f \( -name '*.ogg' -o -name '*.mp3' \) | wc -l)
  n_audio=$(git --no-optional-locks status --porcelain -- client/public/assets/audio | wc -l)
  n_rest=$(git --no-optional-locks status --porcelain -- 'client/public/assets/manifest*.json' \
    docs/audio docs/VOICE_SCRIPT.md tools/audio/voice/build_state.json | wc -l)
  echo "  against the last commit: $n_audio of $n_all sound files differ, and $n_rest manifest, document, picture and build-state files"
  if [ "$n_audio" != 0 ] || [ "$n_rest" != 0 ]; then
    echo "  (list them: git status --short client/public/assets docs/audio docs/VOICE_SCRIPT.md tools/audio)"
  fi
fi

if [ -n "$failed" ]; then
  echo "audio build FAILED in:$failed" >&2
  exit 1
fi
echo "audio build finished: every step succeeded"
