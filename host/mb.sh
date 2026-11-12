#!/usr/bin/env bash
# Monster Battle 9001 hosting helper for Linux and WSL (Windows Subsystem for Linux).
#
#   host/mb.sh start     build if needed, start the game and the tunnel, print the links
#   host/mb.sh stop      stop everything
#   host/mb.sh update    get the newest copy of the game (git), then start again
#   host/mb.sh logs      show the most recent messages from the game and the tunnel
#   host/mb.sh link      print the links again
#
# Uses podman if it works, otherwise docker. Guide: docs/HOSTING.md.

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
ENGINE=""
find_engine() {
  local have_podman=0 have_docker=0
  command -v podman >/dev/null 2>&1 && have_podman=1
  command -v docker >/dev/null 2>&1 && have_docker=1
  if [ $have_podman = 0 ] && [ $have_docker = 0 ]; then
    fail "Neither Podman nor Docker is installed.
Install one of them, then run this again:
  - Podman:  on Ubuntu or WSL type   sudo apt install podman podman-compose
  - Docker:  install Docker Desktop on Windows and turn on its WSL integration,
             or on Linux follow https://docs.docker.com/engine/install/"
  fi
  if [ $have_podman = 1 ] && podman info >/dev/null 2>&1; then
    ENGINE=podman
  elif [ $have_docker = 1 ] && docker info >/dev/null 2>&1; then
    ENGINE=docker
  elif [ $have_podman = 1 ]; then
    fail "Podman is installed but not answering.
If you use Podman Desktop on Windows, open it and press Start on the Podman machine.
On Linux, check that   podman info   works for your user."
  else
    fail "Docker is installed but not running.
Open Docker Desktop and wait until it says it is running, then try again.
(On Linux without Docker Desktop:   sudo systemctl start docker)"
  fi
  if ! $ENGINE compose version >/dev/null 2>&1; then
    if [ $ENGINE = podman ]; then
      fail "Podman works, but its compose part is missing.
Install it with   sudo apt install podman-compose   (or in Podman Desktop: Settings, Resources, Compose, Setup)."
    else
      fail "Docker works, but its compose part is missing. Install the Docker Compose plugin
(it comes with Docker Desktop; on Linux:   sudo apt install docker-compose-plugin)."
    fi
  fi
}
compose() { $ENGINE compose "$@"; }

# ---- helpers --------------------------------------------------------------------------------
wait_for_game() {
  say "Waiting for the game to answer on $LOCAL_URL ..."
  local _
  for _ in $(seq 1 90); do
    if command -v curl >/dev/null 2>&1; then
      curl -fsS -m 3 "$LOCAL_URL/healthz" >/dev/null 2>&1 && return 0
    elif command -v wget >/dev/null 2>&1; then
      wget -q -T 3 -O /dev/null "$LOCAL_URL/healthz" 2>/dev/null && return 0
    else
      # No download tool here: ask the server from inside its own container.
      compose exec -T game node -e "fetch('http://127.0.0.1:2567/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1 && return 0
    fi
    sleep 2
  done
  return 1
}

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
  if [ -n "$TOKEN" ]; then
    # Named tunnel: your own address. The quick tunnel is not needed.
    compose stop tunnel >/dev/null 2>&1
    compose --profile named up -d --build game named-tunnel || fail "The game could not be built or started. The messages above say why."
  else
    compose --profile named stop named-tunnel >/dev/null 2>&1
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
