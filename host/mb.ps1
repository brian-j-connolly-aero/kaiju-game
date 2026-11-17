# Monster Battle 9001 hosting helper for Windows (PowerShell 5.1 or newer).
#
#   start.cmd   build if needed, start the game and the tunnel, print the links
#   stop.cmd    stop everything
#   update.cmd  get the newest copy of the game (git), then start again
#   logs.cmd    show the most recent messages from the game and the tunnel
#   savelog.cmd save everything the game and the tunnel wrote since they started into one dated
#               text file in "Monster Battle logs" on the desktop (stop.cmd and update.cmd save
#               one first too, because stopping throws the messages away)
#
# The .cmd files run this script:  powershell -ExecutionPolicy Bypass -File mb.ps1 <action>
# Uses Podman if it works, otherwise Docker. Guide: docs\HOSTING.md.
# Keep this file plain ASCII: Windows PowerShell 5.1 misreads other characters.

param(
    [ValidateSet('start', 'stop', 'update', 'logs', 'link', 'savelog')]
    [string]$Action = 'start'
)

# Programs such as podman write normal progress to the error stream; that must not stop us.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

function Say([string]$Text) { Write-Host $Text }

function Fail([string]$Text) {
    Write-Host ''
    Write-Host "PROBLEM: $Text" -ForegroundColor Yellow
    Write-Host ''
    exit 1
}

# ---- settings from .env (optional) ----------------------------------------------------------
function Get-EnvValue([string]$Name) {
    $file = Join-Path $Root '.env'
    if (-not (Test-Path -LiteralPath $file)) { return '' }
    $value = ''
    foreach ($line in Get-Content -LiteralPath $file) {
        if ($line -match "^\s*$Name\s*=\s*(.*)$") {
            $value = $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $value
}

$Port = Get-EnvValue 'MB_PORT'
if (-not $Port) { $Port = '2567' }
$Token = Get-EnvValue 'TUNNEL_TOKEN'
$PublicUrl = Get-EnvValue 'MB_PUBLIC_URL'
$LocalUrl = "http://localhost:$Port"

# ---- container engine -----------------------------------------------------------------------
$script:Engine = $null

function Test-Quietly([string]$Exe, [string[]]$Arguments) {
    # True when the command runs and succeeds; its output is thrown away.
    try {
        & $Exe @Arguments *> $null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Find-Engine {
    $hasPodman = [bool](Get-Command podman -ErrorAction SilentlyContinue)
    $hasDocker = [bool](Get-Command docker -ErrorAction SilentlyContinue)
    if (-not $hasPodman -and -not $hasDocker) {
        Fail ("Neither Podman Desktop nor Docker Desktop is installed.`n" +
              "Install one of them (Podman Desktop: https://podman-desktop.io , Docker Desktop: https://www.docker.com/products/docker-desktop/ ),`n" +
              "restart the computer if it asks you to, open it once, then double-click start.cmd again.")
    }

    if ($hasPodman) {
        if (Test-Quietly 'podman' @('info')) {
            $script:Engine = 'podman'
        } else {
            Say 'Podman is not running yet. Trying to start the Podman machine (this can take a minute) ...'
            & podman machine start *> $null
            if (Test-Quietly 'podman' @('info')) { $script:Engine = 'podman' }
        }
    }
    if (-not $script:Engine -and $hasDocker) {
        if (Test-Quietly 'docker' @('info')) {
            $script:Engine = 'docker'
        } else {
            $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
            if (Test-Path -LiteralPath $desktop) {
                Say 'Docker Desktop is not running yet. Starting it (this can take a minute or two) ...'
                Start-Process -FilePath $desktop | Out-Null
                for ($i = 0; $i -lt 60; $i++) {
                    Start-Sleep -Seconds 3
                    if (Test-Quietly 'docker' @('info')) { $script:Engine = 'docker'; break }
                }
            }
        }
    }
    if (-not $script:Engine) {
        if ($hasPodman) {
            Fail ("Podman is installed but not running.`n" +
                  "Open Podman Desktop. If it offers to create or start a Podman machine, do that and wait until it says 'Running'.`n" +
                  "Then double-click start.cmd again.")
        }
        Fail ("Docker is installed but not running.`n" +
              "Open Docker Desktop and wait until it says 'Engine running'. Then double-click start.cmd again.")
    }
    if (-not (Test-Quietly $script:Engine @('compose', 'version'))) {
        if ($script:Engine -eq 'podman') {
            Fail ("Podman works, but its Compose part is missing.`n" +
                  "In Podman Desktop open Settings, then Resources, find Compose and press Setup. Then try again.")
        }
        Fail 'Docker works, but its Compose part is missing. Reinstall or update Docker Desktop, then try again.'
    }
}

function Invoke-Compose([string[]]$Arguments) {
    # Out-Host shows the messages to the person instead of returning them from this function.
    & $script:Engine compose @Arguments | Out-Host
    return ($LASTEXITCODE -eq 0)
}

function Get-ComposeText([string[]]$Arguments) {
    # Everything the command prints, as plain text (both output streams).
    $lines = & $script:Engine compose @Arguments 2>&1 | ForEach-Object { "$_" }
    return ($lines -join "`n")
}

# ---- helpers --------------------------------------------------------------------------------
function Test-Game {
    try {
        $r = Invoke-WebRequest -Uri "$LocalUrl/healthz" -UseBasicParsing -TimeoutSec 3
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Wait-Game {
    Say "Waiting for the game to answer on $LocalUrl ..."
    for ($i = 0; $i -lt 90; $i++) {
        if (Test-Game) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

$script:LinkStatus = ''

function Test-Link([string]$Link) {
    # Asks the game for its health through the public address, the way a friend's browser goes.
    # That proves the tunnel works end to end, and tells the game its public address so that the
    # link button in a room copies an invite that works for friends. A fresh quick tunnel can
    # take a little while to answer, so this keeps trying for about 40 seconds. The outcome goes
    # into $script:LinkStatus (one line, shown under the link); it never stops the start.
    if (-not $Link) { return }
    Say 'Checking that the public link answers through the internet (up to a minute) ...'
    # Older Windows set-ups do not offer the secure connection Cloudflare needs unless asked.
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch { }
    $deadline = (Get-Date).AddSeconds(40)
    while ($true) {
        try {
            $r = Invoke-WebRequest -Uri "$Link/healthz" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($r.StatusCode -eq 200) {
                $script:LinkStatus = 'Checked just now: this link works.'
                return
            }
        } catch { }
        if ((Get-Date) -ge $deadline) { break }
        Start-Sleep -Seconds 3
    }
    $script:LinkStatus = 'Warning: this link did not answer yet. Wait a minute and try it; if it still fails, double-click start.cmd again.'
}

function Get-QuickLink {
    # The newest trycloudflare.com address in the tunnel's log, or '' when there is none yet.
    $text = Get-ComposeText @('logs', 'tunnel')
    # api.trycloudflare.com is where cloudflared asks for an address, never an address itself.
    $link = ''
    foreach ($m in [regex]::Matches($text, 'https://[a-z0-9-]+\.trycloudflare\.com')) {
        if ($m.Value -ne 'https://api.trycloudflare.com') { $link = $m.Value }
    }
    return $link
}

function Wait-QuickLink {
    Say 'Waiting for the tunnel to hand out its public address ...'
    for ($i = 0; $i -lt 45; $i++) {
        $link = Get-QuickLink
        if ($link) { return $link }
        Start-Sleep -Seconds 2
    }
    return ''
}

function Show-Links([string]$Link) {
    Say ''
    Say '=================================================================='
    Write-Host '  MONSTER BATTLE 9001 IS RUNNING' -ForegroundColor Green
    Say ''
    if ($Link) {
        Say '  Send this link to your friends (it is already copied, just paste it):'
        Write-Host "      $Link" -ForegroundColor Cyan
        if ($script:LinkStatus) {
            $color = 'Green'
            if ($script:LinkStatus.StartsWith('Warning')) { $color = 'Yellow' }
            Write-Host "  $($script:LinkStatus)" -ForegroundColor $color
        }
        try { Set-Clipboard -Value $Link } catch { }
    } else {
        Say '  The public link is not ready yet. Wait a minute and double-click'
        Say "  start.cmd again, or see docs\HOSTING.md, 'If something goes wrong'."
    }
    Say ''
    Say '  Open this one yourself (on this computer):'
    Write-Host "      $LocalUrl" -ForegroundColor Cyan
    Say ''
    Say '  The game keeps running when you close this window.'
    Say '  To stop it, double-click stop.cmd in the host folder.'
    Say '=================================================================='
    Say ''
}

function Get-CurrentLink {
    if ($Token) { return $PublicUrl }
    return (Get-QuickLink)
}

# ---- saving the log -------------------------------------------------------------------------
function Get-LogFolder {
    # On the desktop, where it is easy to find; in the game folder when there is no desktop.
    $folder = $null
    try {
        $desktop = [Environment]::GetFolderPath('Desktop')
        if ($desktop -and (Test-Path -LiteralPath $desktop)) { $folder = Join-Path $desktop 'Monster Battle logs' }
    } catch { }
    if (-not $folder) { $folder = Join-Path $Root 'logs' }
    if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
    return $folder
}

function Get-ServiceLog([string[]]$Before, [string]$Service) {
    # Everything one part wrote since it started, each line with its time. Older compose
    # programs may not know the two options; then it asks again without them.
    $text = Get-ComposeText ($Before + @('logs', '--no-color', '--timestamps', $Service))
    if ($LASTEXITCODE -ne 0) { $text = Get-ComposeText ($Before + @('logs', $Service)) }
    return $text
}

function Save-Logs {
    # Writes everything the game and the tunnel wrote since they started, with a few facts about
    # this computer, into one dated text file. Returns its path, or '' when there was nothing.
    $game = Get-ServiceLog @() 'game'
    # Only a real game log (it starts with the server's own first line), not a message saying
    # there is no game.
    if (-not ($game -match 'Monster Battle 9001 server on port')) { return '' }
    $tunnel = Get-ServiceLog @() 'tunnel'
    $named = Get-ServiceLog @('--profile', 'named') 'named-tunnel'

    $out = New-Object System.Collections.Generic.List[string]
    $out.Add("Monster Battle 9001: the game's log, saved $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') (this computer's clock)")
    $out.Add('')
    $out.Add('---- This computer ----')
    try {
        $cs = Get-CimInstance Win32_ComputerSystem
        $os = Get-CimInstance Win32_OperatingSystem
        $out.Add("Windows: $($os.Caption) $($os.Version)")
        $out.Add("Processors: $($cs.NumberOfLogicalProcessors), memory: $([math]::Round($cs.TotalPhysicalMemory / 1GB, 1)) GB")
    } catch { $out.Add('(could not read the processors and memory)') }
    $out.Add("Container program: $script:Engine")
    try {
        if ($script:Engine -eq 'podman') {
            $vm = & podman info --format '{{.Host.CPUs}} processors, {{.Host.MemTotal}} bytes of memory' 2>&1 | Out-String
        } else {
            $vm = & docker info --format '{{.NCPU}} processors, {{.MemTotal}} bytes of memory' 2>&1 | Out-String
        }
        $out.Add("Its virtual machine: $($vm.Trim())")
    } catch { }
    $out.Add('')
    $out.Add('---- Running now ----')
    $out.Add((Get-ComposeText @('--profile', 'named', 'ps', '-a')))
    try {
        $health = Invoke-WebRequest -Uri "$LocalUrl/healthz" -UseBasicParsing -TimeoutSec 3
        $out.Add("Health and timing: $($health.Content)")
    } catch { $out.Add('Health and timing: the game did not answer') }
    $out.Add('')
    $out.Add('---- The game ----')
    $out.Add($game)
    $out.Add('')
    $out.Add('---- The quick tunnel ----')
    $out.Add($tunnel)
    if ($named.Trim()) {
        $out.Add('')
        $out.Add('---- The named tunnel ----')
        $out.Add($named)
    }

    $file = Join-Path (Get-LogFolder) ("monster-battle-log_" + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.txt')
    Set-Content -LiteralPath $file -Value ($out -join "`r`n") -Encoding UTF8
    return $file
}

function Save-LogAction {
    Find-Engine
    Say "Saving everything the game and the tunnel wrote since they started ..."
    $file = Save-Logs
    if (-not $file) {
        Fail ("There is nothing to save: the game is not running, or it was stopped (stopping throws its messages away;`n" +
              "stop.cmd saves them first, into the 'Monster Battle logs' folder on your desktop).")
    }
    Say ''
    Say '=================================================================='
    Write-Host '  THE GAME LOG IS SAVED' -ForegroundColor Green
    Say ''
    Say '  It is this file (the folder opens by itself):'
    Write-Host "      $file" -ForegroundColor Cyan
    Say ''
    Say '  Send it to whoever gave you the game, with who played which side.'
    Say '  The game keeps running; saving again later saves everything again.'
    Say '=================================================================='
    Say ''
    try { Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$file`"" | Out-Null } catch { }
}

# ---- actions --------------------------------------------------------------------------------
function Start-Game {
    Find-Engine
    Say "Using $script:Engine. Building the game if anything changed (the first time takes a few minutes) ..."
    if ($Token) {
        # Named tunnel: your own address. The quick tunnel is not needed.
        Get-ComposeText @('stop', 'tunnel') | Out-Null
        $ok = Invoke-Compose @('--profile', 'named', 'up', '-d', '--build', 'game', 'named-tunnel')
    } else {
        Get-ComposeText @('--profile', 'named', 'stop', 'named-tunnel') | Out-Null
        # Quick tunnel: an MB_PUBLIC_URL left in .env from a named tunnel would put the wrong
        # address in the game's invites. Set here, it wins over .env. (PowerShell removes a
        # variable set to nothing, so it is one space, which the game reads as empty.)
        $env:MB_PUBLIC_URL = ' '
        $ok = Invoke-Compose @('up', '-d', '--build', 'game', 'tunnel')
    }
    if (-not $ok) { Fail 'The game could not be built or started. The messages above say why.' }

    if (-not (Wait-Game)) {
        Invoke-Compose @('logs', '--tail', '30', 'game') | Out-Null
        Fail ("The game did not answer within three minutes. Its last messages are above.`n" +
              "If they mention the port, another program uses port ${Port}: see docs\HOSTING.md.")
    }

    if ($Token) {
        $link = $PublicUrl
        if (-not $link) { Say 'Named tunnel started. Put your address in MB_PUBLIC_URL in .env to have it printed here.' }
    } else {
        $link = Wait-QuickLink
        if (-not $link) { Invoke-Compose @('logs', '--tail', '20', 'tunnel') | Out-Null }
    }
    Test-Link $link
    Show-Links $link
    # Open the game for the host, on this computer, without going through the tunnel.
    try { Start-Process $LocalUrl } catch { }
}

function Stop-Game {
    Find-Engine
    # Stopping throws the game's messages away: keep them first.
    $file = Save-Logs
    if ($file) { Say "Saved the game's log first: $file" }
    Say 'Stopping Monster Battle 9001 ...'
    if (-not (Invoke-Compose @('--profile', 'named', 'down', '--remove-orphans'))) {
        Fail 'Could not stop everything. The messages above say why.'
    }
    Say 'Stopped. Nothing is running any more.'
}

function Update-Game {
    # A newer game replaces the running one and its messages: keep them first.
    Find-Engine
    $file = Save-Logs
    if ($file) { Say "Saved the game's log first: $file" }
    $hasGit = [bool](Get-Command git -ErrorAction SilentlyContinue)
    if ((Test-Path -LiteralPath (Join-Path $Root '.git')) -and $hasGit) {
        Say 'Getting the newest copy of the game ...'
        & git -C $Root pull --ff-only
        if ($LASTEXITCODE -ne 0) { Fail 'Could not get the newest copy (git pull failed). The messages above say why.' }
    } else {
        Say 'This folder is not a git copy. Unzip the newer copy of the game over this folder'
        Say '(keep your .env file), then double-click update.cmd or start.cmd again.'
    }
    Start-Game
    # Old builds of the game pile up otherwise; this only removes images nothing uses.
    & $script:Engine image prune -f *> $null
}

function Show-Logs {
    Find-Engine
    Invoke-Compose @('--profile', 'named', 'logs', '--tail', '200') | Out-Null
}

switch ($Action) {
    'start'  { Start-Game }
    'stop'   { Stop-Game }
    'update' { Update-Game }
    'logs'   { Show-Logs }
    'savelog' { Save-LogAction }
    'link'   { Find-Engine; Show-Links (Get-CurrentLink) }
}
exit 0
