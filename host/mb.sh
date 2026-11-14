#!/usr/bin/env bash
# Monster Battle 9001 hosting helper for Linux and WSL (Windows Subsystem for Linux).
#
#   host/mb.sh start     build if needed, start the game and the tunnel, print the links
#   host/mb.sh stop      stop everything
#   host/mb.sh update    get the newest copy of the game (git), then start again
#   host/mb.sh logs      show the most recent messages from the game and the tunnel
#   host/mb.sh link      print the links again
#
# Uses Podman if it works and has a compose program ("podman compose", or the separate
# podman-compose for older Podman), otherwise Docker. Guide: docs/HOSTING.md.

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT" || exit 1

say()  { printf '%s\n' "$*"; }
fail() { printf '\nPROBLEM: %s\n\n' "$*" >&2; exit 1; }

# ---- settings from .env (optional) ----------------------------------------------------------
env_value() {
  # Prints the value of one KEY=value line in .env, without quotes; empty when missing.
  [ -f "$ROOT/.env" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ROOT/.env" | tail -n 1 | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}
PORT="$(env_value MB_PORT)"; PORT="${PORT:-2567}"
TOKEN="$(env_value TUNNEL_TOKEN)"
PUBLIC_URL="$(env_value MB_PUBLIC_URL)"
LOCAL_URL="http://localhost:$PORT"

# ---- container engine -----------------------------------------------------------------------
ENGINE=""        # podman or docker
COMPOSE=()       # the compose program, as the words to run
ENGINE_NOTE=""   # one line shown at start when the setup is one this was not tried with

podman_version() { podman --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -n 1; }
podman_is_old() {
  # True for Podman before 4.7, which has no "podman compose" of its own (Ubuntu 22.04 has 3.4).
  local v major minor
  v="$(podman_version)"; major="${v%%.*}"; minor="${v#*.}"
  case "$major$minor" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -lt 4 ] || { [ "$major" -eq 4 ] && [ "$minor" -lt 7 ]; }
}

first_error() {
  # The first line a command writes to its error output ("" when it wrote none).
  "$@" 2>&1 >/dev/null | grep -v '^[[:space:]]*$' | head -n 1
}
DOCKER_FIXES="  - If it mentions 'permission denied':   sudo usermod -aG docker \$USER
    then close this terminal and open a new one (the change only counts in a new terminal).
  - If it says it cannot connect, or asks whether Docker is running:   sudo service docker start
  - If it mentions a 'context':   docker context use default"

find_engine() {
  local have_podman=0 have_docker=0 podman_ok=0 docker_ok=0
  command -v podman >/dev/null 2>&1 && have_podman=1
  command -v docker >/dev/null 2>&1 && have_docker=1
  if [ $have_podman = 0 ] && [ $have_docker = 0 ]; then
    fail "Neither Podman nor Docker is installed.
Install one of them, then run this again (docs/HOSTING.md, section 9, has the details):
  - Ubuntu 24.04 or newer, also in WSL:   sudo apt install podman podman-compose aardvark-dns
  - Ubuntu 22.04, also in WSL:            sudo apt install docker.io docker-compose-v2
  - Or install Docker Desktop on Windows and turn on its WSL integration."
  fi
  [ $have_podman = 1 ] && podman info >/dev/null 2>&1 && podman_ok=1
  [ $have_docker = 1 ] && docker info >/dev/null 2>&1 && docker_ok=1

  # Podman first, then Docker. Each one also needs its compose program.
  if [ $podman_ok = 1 ] && podman compose version >/dev/null 2>&1; then
    ENGINE=podman; COMPOSE=(podman compose)
  elif [ $podman_ok = 1 ] && command -v podman-compose >/dev/null 2>&1; then
    # Older Podman has no "podman compose"; the separate podman-compose program does that job.
    ENGINE=podman; COMPOSE=(podman-compose)
    if podman_is_old; then
      ENGINE_NOTE="Note: Podman $(podman_version) is older than this was tried with. If the start fails, docs/HOSTING.md section 9 lists what to use instead."
    fi
  elif [ $docker_ok = 1 ] && docker compose version >/dev/null 2>&1; then
    ENGINE=docker; COMPOSE=(docker compose)
  elif [ $podman_ok = 1 ] && podman_is_old && [ $have_docker = 1 ] && [ $docker_ok = 0 ]; then
    fail "This computer's Podman ($(podman_version)) is too old to start the game, so the game uses Docker
here. Docker is installed, but it does not answer. Docker's own message:
    $(first_error docker info)
Try the line that fits, then run this again:
$DOCKER_FIXES"
  elif [ $podman_ok = 1 ] && podman_is_old && [ $docker_ok = 1 ]; then
    fail "This computer's Podman ($(podman_version)) is too old to start the game, so the game uses Docker
here. Docker works, but its compose part does not. Docker's own message:
    $(first_error docker compose version)
Install it with   sudo apt install docker-compose-v2   and run this again. If it is installed
already,   type -a docker   shows whether 'docker' here is really Docker or a stand-in for Podman."
  elif [ $podman_ok = 1 ] && podman_is_old; then
    fail "Podman works, but this computer has Podman $(podman_version), which is too old to start
the game by itself (Ubuntu 22.04 comes with it, and has no podman-compose to add).
Either of these fixes it:
  - Use Docker instead:
        sudo apt update
        sudo apt install docker.io docker-compose-v2
        sudo usermod -aG docker \$USER
    then close this terminal, open a new one and run this again.
  - Or use Ubuntu 24.04 or newer, where   sudo apt install podman podman-compose aardvark-dns   works.
docs/HOSTING.md, section 9, has the details."
  elif [ $podman_ok = 1 ]; then
    fail "Podman works, but its compose part is missing.
Install it with   sudo apt update && sudo apt install podman-compose
(or in Podman Desktop: Settings, Resources, Compose, Setup)."
  elif [ $docker_ok = 1 ]; then
    fail "Docker works, but its compose part does not. Docker's own message:
    $(first_error docker compose version)
Install the Docker Compose plugin (it comes with Docker Desktop; on Ubuntu:
sudo apt install docker-compose-v2)."
  elif [ $have_podman = 1 ]; then
    fail "Podman is installed but not answering.
If you use Podman Desktop on Windows, open it and press Start on the Podman machine.
On Linux, check that   podman info   works for your user."
  else
    fail "Docker is installed but does not answer. Docker's own message:
    $(first_error docker info)
With Docker Desktop: open it and wait until it says it is running, then try again.
On Linux or in WSL, try the line that fits:
$DOCKER_FIXES"
  fi
}
compose() { "${COMPOSE[@]}" "$@"; }

# ---- helpers --------------------------------------------------------------------------------
fetch_ok() {
  # True when the address answers with success within $2 seconds. $3 is the same address as
  # seen from inside the game's container, for computers without curl or wget.
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m "$2" "$1" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T "$2" -O /dev/null "$1" 2>/dev/null
  else
    compose exec -T game node -e "fetch('$3',{signal:AbortSignal.timeout($2*1000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1
  fi
}

wait_for_game() {
  say "Waiting for the game to answer on $LOCAL_URL ..."
  local _
  for _ in $(seq 1 90); do
    fetch_ok "$LOCAL_URL/healthz" 3 "http://127.0.0.1:2567/healthz" && return 0
    sleep 2
  done
  return 1
}

LINK_CHECK_SECONDS=40
check_link() {
  # Asks the game for its health through the public address, the way a friend's browser goes.
  # That proves the tunnel works end to end, and tells the game its public address so that the
  # link button in a room copies an invite that works for friends. A fresh quick tunnel can
  # take a little while to answer, so this keeps trying for about LINK_CHECK_SECONDS. The
  # outcome goes into LINK_STATUS (one line, shown under the link); it never stops the start.
  local link="$1" deadline=$((SECONDS + LINK_CHECK_SECONDS))
  [ -n "$link" ] || return 0
  say "Checking that the public link answers through the internet (up to a minute) ..."
  while :; do
    if fetch_ok "$link/healthz" 5 "$link/healthz"; then
      LINK_STATUS="Checked just now: this link works."
      return 0
    fi
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep 3
  done
  LINK_STATUS="Warning: this link did not answer yet. Wait a minute and try it; if it still fails, run host/start.sh again."
  return 0
}
LINK_STATUS=""

quick_link() {
  # The newest trycloudflare.com address in the tunnel's log ("" while there is none yet).
  # api.trycloudflare.com is where cloudflared asks for an address, never an address itself.
  compose logs tunnel 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | grep -v '^https://api\.' | tail -n 1
}

wait_for_link() {
  say "Waiting for the tunnel to hand out its public address ..." >&2
  local _ link
  for _ in $(seq 1 45); do
    link="$(quick_link)"
    if [ -n "$link" ]; then printf '%s' "$link"; return 0; fi
    sleep 2
  done
  return 1
}

print_links() {
  local link="$1"
  say ""
  say "=================================================================="
  say "  MONSTER BATTLE 9001 IS RUNNING"
  say ""
  if [ -n "$link" ]; then
    say "  Send this link to your friends:"
    say "      $link"
    [ -z "$LINK_STATUS" ] || say "  $LINK_STATUS"
  else
    say "  The public link is not ready yet. Run   host/mb.sh link   in a minute,"
    say "  or see docs/HOSTING.md, 'If something goes wrong'."
  fi
  say ""
  say "  Open this one yourself (on this computer):"
  say "      $LOCAL_URL"
  say ""
  say "  To stop:   host/stop.sh"
  say "=================================================================="
  say ""
}

current_link() {
  if [ -n "$TOKEN" ]; then printf '%s' "$PUBLIC_URL"; else quick_link; fi
}

# ---- actions --------------------------------------------------------------------------------
do_start() {
  find_engine
  say "Using $ENGINE. Building the game if anything changed (the first time takes a few minutes) ..."
  [ -z "$ENGINE_NOTE" ] || say "$ENGINE_NOTE"
  if [ -n "$TOKEN" ]; then
    # Named tunnel: your own address. The quick tunnel is not needed.
    compose stop tunnel >/dev/null 2>&1
    compose --profile named up -d --build game named-tunnel || fail "The game could not be built or started. The messages above say why."
  else
    compose --profile named stop named-tunnel >/dev/null 2>&1
    # Quick tunnel: an MB_PUBLIC_URL left in .env from a named tunnel would put the wrong
    # address in the game's invites. (Set here, it wins over .env.)
    export MB_PUBLIC_URL=""
    compose up -d --build game tunnel || fail "The game could not be built or started. The messages above say why."
  fi
  if ! wait_for_game; then
    compose logs --tail 30 game
    fail "The game did not answer within three minutes. Its last messages are above.
If they mention the port, another program uses port $PORT: see docs/HOSTING.md."
  fi
  local link=""
  if [ -n "$TOKEN" ]; then
    link="$PUBLIC_URL"
    [ -n "$link" ] || say "Named tunnel started. Put your address in MB_PUBLIC_URL in .env to have it printed here."
  else
    link="$(wait_for_link)" || link=""
    [ -n "$link" ] || compose logs --tail 20 tunnel
  fi
  check_link "$link"
  print_links "$link"
}

do_stop() {
  find_engine
  say "Stopping Monster Battle 9001 ..."
  compose --profile named down --remove-orphans || fail "Could not stop everything. The messages above say why."
  say "Stopped. Nothing is running any more."
}

do_update() {
  if [ -d "$ROOT/.git" ] && command -v git >/dev/null 2>&1; then
    say "Getting the newest copy of the game ..."
    git -C "$ROOT" pull --ff-only || fail "Could not get the newest copy (git pull failed). The messages above say why."
  else
    say "This folder is not a git copy. Unpack the newer copy of the game over this folder"
    say "(keep your .env file), then run this again or run host/start.sh."
  fi
  do_start
  # Old builds of the game pile up otherwise; this only removes images nothing uses.
  $ENGINE image prune -f >/dev/null 2>&1 || true
}

do_logs() {
  find_engine
  compose --profile named logs --tail 200
}

do_link() {
  find_engine
  print_links "$(current_link)"
}

case "${1:-start}" in
  start)  do_start ;;
  stop)   do_stop ;;
  update) do_update ;;
  logs)   do_logs ;;
  link)   do_link ;;
  *) say "Usage: host/mb.sh start | stop | update | logs | link"; exit 2 ;;
esac
