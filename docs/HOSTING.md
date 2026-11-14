# Hosting Monster Battle 9001 for your friends

This guide is for the person who runs the game on their own computer so that friends can play
over the internet. You do not need to know how to program. You will double-click a file, wait,
and send a link.

How it works, in one paragraph: the game runs inside a **container** (a sealed box that holds
the game and everything it needs, so nothing else on your computer is changed). A free service
from Cloudflare (a large internet company) called a **tunnel** gives your game a public web
address, without you opening anything on your home router. Your friends open that address in
their web browser. The game itself never contacts any other outside service.

## 1. What you need

- A computer with **Windows 10 or Windows 11**. (Linux also works; see section 9.)
- One of these two free programs, which run containers:
  - **Podman Desktop** (from podman-desktop.io), or
  - **Docker Desktop** (from docker.com).

  Either is fine. If you already have one, use that one.
- About **5 GB (gigabytes) of free disk space**: the container program itself, plus about 1.5 GB for the
  game and the building blocks it is built from. (The finished game is about 260 MB, megabytes.)
- About **4 GB of free memory** while hosting. A computer with 8 GB or more is comfortable.
- A normal home internet connection. Five friends playing use very little of it.
- Your friends need: a computer (not a phone or tablet) with a **keyboard and mouse** (a game
  controller works too), and an up-to-date **Chrome, Edge or Firefox** browser. Nothing to
  install. Send them the player guide, **docs/PLAYING.md**, before the evening.

## 2. First-time setup (once)

1. Install **Podman Desktop** or **Docker Desktop**. Accept what the installer suggests. If it
   asks to restart the computer, restart.
2. Open the program once.
   - **Podman Desktop:** it walks you through a short setup. Say yes when it offers to
     **create a Podman machine** (a small hidden Linux computer that runs the containers) and to
     set up **Compose** (the part that starts several containers together). Wait until the
     machine says **Running**.
   - **Docker Desktop:** wait until the bottom-left corner says **Engine running**. You do not
     need a Docker account; you can skip signing in.
3. Put the game folder somewhere easy to find, for example `Documents\monster-battle`. (You may
   have received it as a zip file: right-click it, choose **Extract All**.)
4. Open the game folder, then the **host** folder inside it. You will use four files there:
   - `start.cmd`: start the game and show the link for your friends;
   - `stop.cmd`: stop the game;
   - `update.cmd`: get a newer version and start it;
   - `logs.cmd`: show the game's recent messages (useful when something goes wrong).

The first start builds the game from its source files. That takes **5 to 15 minutes** and needs
the internet (to download the building blocks). Every later start takes seconds.

## 3. Hosting a play session

1. Make sure Podman Desktop or Docker Desktop is open and running. (The start file tries to
   start it for you, but it is quicker if it is already running.)
2. In the **host** folder, double-click **start.cmd**.
   - Windows may ask "Do you want to run this file?" or show a blue "Windows protected your PC"
     box. Choose **More info**, then **Run anyway**. This happens because the file came from
     the internet.
3. A black window opens and shows progress. When it is ready it shows a box like this:

   ```
     MONSTER BATTLE 9001 IS RUNNING

     Send this link to your friends (it is already copied, just paste it):
         https://some-random-words.trycloudflare.com
     Checked just now: this link works.

     Open this one yourself (on this computer):
         http://localhost:2567
   ```

   Before showing the box, the start file opens the public link once through the internet, the
   way your friends will. "Checked just now: this link works." means it is ready to send. If it
   says **"Warning: this link did not answer yet"** instead, a brand-new link sometimes needs a
   minute: wait a minute and open the link yourself; if it still does not open, double-click
   start.cmd again and use the new link it shows.

4. Paste the first link (the one ending in **trycloudflare.com**) into your group chat. It is
   already copied: just press Ctrl+V.
5. The game also opens in your own browser at **http://localhost:2567**. Use that address
   yourself: it is faster for you because it does not travel through the internet.
6. You can close the black window. The game keeps running.
7. In the game, enter your name and **create a room**. The room has a **four-letter code**.
   - The **link button** next to the code copies an invite link that opens your room directly.
     It works for your friends, even though you are playing on `localhost`. Paste it into your
     group chat. A friend who has never played is first asked for a name (one box; Enter joins),
     and anyone can change their name in the room by clicking it.
   - The **code** works too: friends open the link from step 4, enter their name, choose
     **join** and type the code.
8. Five players in total: one plays the monster, four play the army squads. Empty seats are
   played by the computer, so you can also start with fewer friends.
9. Opening the game the first time downloads about 2 MB (megabytes) for the game and its city;
   on an ordinary home connection that takes a few seconds, and a bar shows how far it is.
   Sounds and voices follow in the background. If you update the game while friends still have
   the old page open, their page reloads itself when they next join.

## 4. Stopping

Double-click **stop.cmd** in the host folder. Everyone in a game is disconnected and the public
link stops working.

If you do not stop it, the game keeps running in the background until you shut down the
computer, and **starts again by itself** the next time Podman or Docker starts. Stop it when you
are done if you do not want that.

## 5. Updating to a newer version

- **If you received a new zip file:** double-click **stop.cmd**. Extract the new zip **over**
  the old game folder (say yes to replacing files). Your `.env` settings file, if you made one,
  is kept. Then double-click **start.cmd**. It notices the changes and rebuilds the game (a few
  minutes).
- **If your game folder was copied with Git** (a tool developers use to share code): double-click
  **update.cmd**. It fetches the newest version, rebuilds and starts.

`update.cmd` also clears away old builds of the game so they do not fill up your disk.

## 6. If something goes wrong

Read the last lines in the black window first: they say in plain words what the problem is.

1. **"Podman is installed but not running" or "Docker is installed but not running".**
   Open Podman Desktop (start the Podman machine) or Docker Desktop (wait for "Engine running"),
   then double-click start.cmd again.
2. **"Neither Podman Desktop nor Docker Desktop is installed".**
   Install one of them (section 2). If you just installed it, restart the computer.
3. **The port is already in use** (the messages mention "port" or "address already in use").
   Another program, or an older copy of the game, uses the number 2567. First double-click
   stop.cmd, then start.cmd. If that does not help: in the game folder, make a copy of
   `.env.example` named `.env` (see section 7, step 4), change the line `MB_PORT=2567` to
   `MB_PORT=2568`, save, and start again. Your own address is then http://localhost:2568.
4. **The public link does not appear** ("The public link is not ready yet").
   Wait one minute and double-click start.cmd again: it shows the link once Cloudflare has handed
   it out. If it still does not appear, double-click logs.cmd and look at the lines that start
   with "tunnel". Some company or school networks block tunnels; try at home.
5. **Your friends cannot connect, but you can play on localhost.**
   - Check they used the newest link: **the link changes every time you start the game**.
   - The link must start with `https://` and end with `trycloudflare.com`.
   - If the page opens but joining fails, double-click stop.cmd and start.cmd, and send the new
     link.
   - Ask them to use Chrome, Edge or Firefox on a computer.
6. **The invite link from the link button starts with `http://localhost`.**
   The game has not heard from its public link yet (the start file said "Warning: this link did
   not answer yet", or the game was restarted on its own). Double-click start.cmd again and wait
   for "Checked just now: this link works.", then leave the room and create a new one. Until
   then, send the four-letter code instead: it always works.
7. **The game feels laggy** (things jump or react late).
   - Close other heavy programs on the host computer (games, video calls, many browser tabs).
   - The host should play on `http://localhost:2567`, not on the public link.
   - The quick tunnel routes everyone through Cloudflare; friends far away (another continent)
     will feel some delay. A named tunnel (section 7) is usually a little steadier.
   - If one friend's connection is weak, a wired connection instead of Wi-Fi helps.
8. **The link changes every time.** That is how the free quick tunnel works. If you want an
   address that never changes, use your own domain (section 7).

If none of this helps, double-click **logs.cmd**, select everything in the window, copy it and
send it to whoever gave you the game.

## 7. Using your own domain (a named tunnel; optional)

You only need this if you want a fixed address such as `https://kaiju.example.com`. It needs a
free **Cloudflare account** and a **domain** (a web address you own) that is managed by
Cloudflare.

1. Sign in at dash.cloudflare.com.
2. Go to **Zero Trust**, then **Networks**, then **Tunnels** (the names in Cloudflare's menus
   change from time to time; look for "Tunnels"). Choose **Create a tunnel**, type **Cloudflared**,
   and give it a name such as `monster-battle`.
3. Cloudflare shows install commands containing a long code after the word `--token` (or
   `run`). Copy only that long code. This is your **tunnel token**. Treat it like a password.
4. In the game folder, find the file `.env.example`. Make a copy of it in the same folder and
   name the copy `.env` (just ".env", nothing before the dot). Open it with Notepad.
   (If Windows hides the file extension, turn on **View, Show, File name extensions** in File
   Explorer so the file is not called `.env.txt` by mistake.)
5. Fill in two lines and save:
   ```
   TUNNEL_TOKEN=the-long-code-you-copied
   MB_PUBLIC_URL=https://kaiju.example.com
   ```
6. Back in Cloudflare, add a **public hostname** to the tunnel: choose your subdomain and
   domain (for example `kaiju` and `example.com`), service type **HTTP** (the ordinary web
   kind), address
   **game:2567**. Save.
7. Double-click start.cmd. The box now shows your own address, and the link button in a room
   copies invites with it.

To go back to the quick tunnel, empty the `TUNNEL_TOKEN=` and `MB_PUBLIC_URL=` lines in `.env`
and start again.

Never send your `.env` file to anyone, and never upload it. It is already excluded from the
game's shared files.

## 8. About the quick tunnel (the trycloudflare.com link)

- It is free and needs no account. Cloudflare offers it for testing and trying things out.
- **The address changes on every start.** Send the new one each time.
- There is **no guarantee it stays up**. It usually works for an evening of play; if it drops,
  stop and start again and send the new link.
- **Anyone who has the link can open the game page.** The address is long and random, so
  strangers are unlikely to find it, but do not post it publicly. The game holds no personal
  data; at worst a stranger could join an empty room.
- It works only while your computer is on, awake and connected. Turn off sleep mode for the
  evening.

## 9. Linux, and WSL (Windows Subsystem for Linux)

The same steps work from a Linux terminal, in the game folder:

```
host/start.sh       start, and print the links
host/stop.sh        stop
host/update.sh      get the newest version (Git) and start again
host/logs.sh        recent messages
host/mb.sh link     print the links again
```

The scripts use Podman if it works, otherwise Docker. What to install depends on the Ubuntu
version, also inside WSL (`lsb_release -ds` shows which one you have):

- **Ubuntu 24.04 or newer:** `sudo apt install podman podman-compose`. This is the setup the
  scripts were tried with (Podman 4.9).
- **Ubuntu 22.04:** its Podman (version 3.4) is too old and it offers no `podman-compose`, so
  use Docker there:
  ```
  sudo apt update
  sudo apt install docker.io docker-compose-v2
  sudo usermod -aG docker $USER
  ```
  Then close the terminal and open a new one. If the start script says Docker is not running,
  start it with `sudo service docker start`. Podman can stay installed; the script picks
  Docker by itself. (This route was checked against Ubuntu's package lists, not run.)
- Docker Desktop on Windows also works from WSL once its WSL integration is turned on.

Play in a browser on Windows, at http://localhost:2567: WSL passes that address through. Keep
the WSL terminal window open while you host, because Windows may stop WSL (and the game with
it) when its last window closes. Put the game folder on WSL's own disk (for example in your
home folder), not under `/mnt/c`, where building is much slower.

## 10. Without containers (for people who have Node.js)

If the computer has **Node.js 22** (a program that runs JavaScript) installed:

1. In a terminal in the game folder, run `npm ci` once (installs the building blocks).
2. Run `npm run host`. It builds the game and starts it on http://localhost:2567. Leave the
   terminal open; press Ctrl+C to stop.
3. For friends, run Cloudflare's tunnel program **cloudflared** in a second terminal (download
   it from Cloudflare's website, "cloudflared downloads"):
   ```
   cloudflared tunnel --url http://localhost:2567
   ```
   It prints the trycloudflare.com link to send. Ctrl+C stops it.

## 11. What was tested, and what was not

Honest status of this hosting package, as of the release round before the first five-player
playtest. It was tried on a Linux test machine, not on Windows.

**Tested there, and working:**

- Building the container image with Podman, from a clean copy of the game. The finished image
  is about 260 MB (measured: 256 MB).
- In the release round, the image was built again from the final game and run on the test
  machine: the health check answered, the page, all 65 models (40 of them buildings), the
  pictures, the music, the sound effects and the 221 voice lines were all in it and served,
  and five browser windows played a whole match against it (the monster grew to stage 3)
  with no errors. A first visit downloads about 2.2 MB and showed the home screen in under
  3 seconds over a simulated 10 megabit-per-second connection. (Before this round the game
  sent its files uncompressed: 8.7 MB and about 8 seconds.)
- Running it: the health check answers, the game page loads, and a browser without a window
  (driven by a program) reached the home screen and created a room with no errors.
- Stopping it: the game shuts down cleanly in under a second.
- The Linux start, stop, logs and link scripts (`host/*.sh`) with Podman, using both kinds of
  Compose program (the one Podman Desktop installs on Windows, and `podman-compose`): the game
  was built, started, reached at the local address and through the internal address the tunnel
  uses, and stopped again. The messages for "nothing installed" and "not running" were checked.
- The script's check for a Docker-only computer picked Docker correctly (building with Docker
  itself could not be finished on the test machine for a reason that only exists there).
- `npm run host` (section 10): built and started the game, and the same browser check passed.
- The invite link (added later): the game learning its public address from requests that
  arrive through the quick tunnel, reporting it, and the link button building invites from it
  are covered by automatic tests that send requests the way the tunnel passes them on. The
  Linux start script's link check was tried against a stand-in for the tunnel: the game
  answered through it and then knew its public address; a link that never answered gave the
  warning after about 40 seconds without stopping the start; a link that only started answering
  after 10 seconds was reported as working.

**Not tested:**

- **The tunnel.** The test machine is not allowed to open a public tunnel, so no
  trycloudflare.com link was ever created. In the script test the tunnel was replaced by a
  stand-in that prints a made-up link, which checked that the script finds and shows the link.
  The real tunnel program was downloaded and its settings were checked against its own help
  text. Your first start is the first real test of the public link. That the tunnel passes its
  own address on to the game (which the invite link relies on) was checked by reading the
  tunnel program's source code, not by running it.
- **The Windows files** (`start.cmd`, `stop.cmd`, `update.cmd`, `logs.cmd` and `mb.ps1`) have
  **never been run**. They were checked line by line against the PowerShell version every Windows
  computer has (5.1), but not executed. That includes the new link check in `mb.ps1`.
- Podman Desktop and Docker Desktop on Windows, and Docker on any computer.
- The named tunnel with your own domain (section 7).
- The update script with Git (`update.cmd`, `host/update.sh`).

So the first time, try it a day before the play session: double-click start.cmd, open the
public link on your phone (just to see the page load; the game itself needs a computer), then
double-click stop.cmd.
