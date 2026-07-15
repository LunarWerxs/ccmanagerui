# misc/Restart-Daemon.ps1 — kill this app's daemon, no exceptions, then relaunch it.
#
# CONTRACT (owner directive, 2026-07-15): a rebuild must NEVER leave you on old code.
# If something of OURS is running, it dies. There is no "left alone", no advisory note,
# no polite skip. The ONLY thing this script won't kill is a process that isn't ours --
# and "is it ours" is now a question with a hard answer instead of a guess.
#
# WHY THE OLD VERSION FAILED (2026-07-15):
# It probed every bun/node listener's /api/health and treated a body with no `service`
# field as "unidentified -> leave it alone". Three Connections Vite DEV SERVERS (ports
# 4180/4204/4273) answer /api/health with 200 OK and an index.html body, because Vite
# serves the SPA fallback for every unknown path. They therefore looked exactly like "a
# daemon that won't say who it is", and the script printed a note asking us to add a
# `service` field to an app (redesign) that has had one all along.
#
# Wait-Daemon.ps1 had the mirror-image bug, and it was the worse of the two: it ACCEPTED
# an unidentified responder as this app (`if (-not $svc -or $svc -eq $AppName)`), latched
# onto one of those Vite servers, read that stranger's start time, and announced
# "STALE DAEMON: you are still being served the OLD code" -- about a daemon that had in
# fact just restarted perfectly. A false alarm isn't harmless: it sends you hunting a bug
# that doesn't exist, and it teaches you to ignore the alarm on the day it's real.
#
# THE IDENTITY RULE (fixes both directions):
# A listener is OURS only if /api/health returns Content-Type `application/json` AND a
# body with `ok: true` AND `service` equal to this app's package.json `name`. Absence of
# identity is never identity; HTML is never identity. That one rule makes the sweep both
# ruthless (anything that IS us dies, including an orphan the pointer forgot) and safe (a
# Vite dev server, a sibling app, or any unrelated node process can never match).
#
# WHY WE ONLY KILL PROCESSES OLDER THAN THIS RUN:
# The tray host runs an auto-restart watchdog. Killing the daemon is expected to bring a
# NEW one back within seconds, and that new one is the whole point -- so the kill targets
# are restricted to processes that started BEFORE this script did. A daemon younger than
# our start stamp is the fresh build arriving, not a survivor. This is also what makes the
# verify loop terminate instead of fighting the watchdog forever.
#
# App-agnostic on purpose: everything derives from package.json `name`, so the same file
# works in ccmanagerui / redesign / repoyeti / devwebui. Keep the four copies identical.

[CmdletBinding()]
param(
  # Repo root. Defaults to the parent of misc/, i.e. the app root.
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  # Stop the daemon but don't relaunch the app afterwards.
  [switch]$NoLaunch,
  # How long to keep killing before admitting defeat.
  [int]$KillTimeoutSeconds = 15
)

$ErrorActionPreference = 'SilentlyContinue'

$pkgPath = Join-Path $Root 'package.json'
if (-not (Test-Path $pkgPath)) {
  Write-Host "  ! No package.json at $Root - cannot identify the app." -ForegroundColor Red
  exit 1
}
$name = (Get-Content $pkgPath -Raw | ConvertFrom-Json).name
$runtimeFile = Join-Path $env:USERPROFILE ".$name\runtime.json"

# Everything alive before this instant is a kill target; anything that appears after it is
# the replacement. Wait-Daemon.ps1 reads the same stamp to prove the daemon now answering
# is younger than the restart, i.e. that it really is a new process.
$restartStart = Get-Date
Set-Content -Path (Join-Path $env:TEMP "$name-restart.stamp") -Value $restartStart.ToString('o') -Encoding ASCII

# --- Identity ------------------------------------------------------------------------------------
# The single source of truth for "is this us". Deliberately strict: a JSON content-type, ok:true,
# and an exact service match. Anything less returns $null and is treated as somebody else's port.
function Get-HealthService {
  param([int]$Port)
  try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
  } catch { return $null }
  # Vite's SPA fallback answers 200 text/html for /api/health. Reject on content-type before we
  # ever look at the body -- that is the check whose absence caused the 2026-07-15 false alarm.
  if (($res.Headers['Content-Type'] -join ',') -notmatch 'application/json') { return $null }
  try { $body = $res.Content | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
  if ($body.ok -ne $true -or -not $body.service) { return $null }
  return [string]$body.service
}

# Was this process alive before we started? Unreadable start time => assume yes and kill it: the
# directive is "never serve old code", so an unprovable process is treated as the old one.
function Test-PredatesRestart {
  param([int]$ProcessId)
  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $proc) { return $false }
  try { return ($proc.StartTime -lt $restartStart) } catch { return $true }
}

# Every process that identifies as this app AND predates this run. Recomputed each pass so the
# loop below is a real verification, not a fire-and-hope.
function Get-StaleTargets {
  param([int]$PointerPort)

  $probe = New-Object System.Collections.Generic.List[int]
  # The pointer's port is probed unconditionally: it's the one port we have a recorded claim on,
  # even if the daemon somehow isn't running under a bun/node image.
  if ($PointerPort) { $probe.Add($PointerPort) }
  # The bun/node prefilter keeps the sweep cheap (a 2s probe per listening port would crawl).
  foreach ($conn in (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)) {
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    # A dead OwningProcess is a zombie socket (a killed daemon's port not yet reaped); it answers
    # nothing and can't be killed, so it drops out naturally.
    if ($proc -and $proc.ProcessName -in @('bun', 'node')) { $probe.Add([int]$conn.LocalPort) }
  }

  $targets = @{}
  foreach ($port in ($probe | Sort-Object -Unique)) {
    if ((Get-HealthService -Port $port) -ne $name) { continue }
    $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $owners) {
      if (-not (Test-PredatesRestart -ProcessId $procId)) { continue }  # the fresh one, leave it
      $targets[[int]$procId] = "serving '$name' on port $port"
    }
  }
  return $targets
}

# A daemon that has HUNG (won't answer /api/health) can't be found by identity, so the recorded
# pointer is the only handle on it. Guarded against PID reuse: the process must still be a
# bun/node image AND its start time must line up with the startedAt the daemon recorded.
function Get-HungPointerTarget {
  param($Info)
  if (-not $Info -or -not $Info.pid) { return $null }
  $proc = Get-Process -Id ([int]$Info.pid) -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.ProcessName -notin @('bun', 'node')) { return $null }
  if (-not (Test-PredatesRestart -ProcessId $proc.Id)) { return $null }
  if ($Info.startedAt) {
    try {
      $recorded = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$Info.startedAt).LocalDateTime
      # The daemon writes startedAt within a second or two of booting. A recycled PID now owned by
      # an unrelated bun/node run won't land anywhere near it.
      if ([math]::Abs(($proc.StartTime - $recorded).TotalSeconds) -gt 120) { return $null }
    } catch { }
  }
  return $proc.Id
}

# --- Stop ----------------------------------------------------------------------------------------
$info = $null
if (Test-Path $runtimeFile) {
  try { $info = Get-Content $runtimeFile -Raw | ConvertFrom-Json } catch { }
}
$pointerPort = if ($info.port) { [int]$info.port } else { 0 }

$killed = @{}
$deadline = (Get-Date).AddSeconds($KillTimeoutSeconds)
$survivors = @{}

while ($true) {
  $targets = Get-StaleTargets -PointerPort $pointerPort
  $hungPid = Get-HungPointerTarget -Info $info
  if ($hungPid -and -not $targets.ContainsKey([int]$hungPid)) {
    $targets[[int]$hungPid] = "recorded in runtime.json but not answering /api/health (hung)"
  }

  if ($targets.Count -eq 0) { break }   # nothing of ours from before this run is left: verified.

  if ((Get-Date) -gt $deadline) { $survivors = $targets; break }

  foreach ($procId in $targets.Keys) {
    # /T reaps whatever the daemon actually parented. Note what it does NOT reach, and must not:
    # work the app has already dispatched. ccmanagerui launches a run's supervisor through WMI
    # (Win32_Process.Create) precisely so it is parented to WmiPrvSE, outside this tree AND outside
    # the daemon's job object -- restarting the app is not a reason to destroy a run in flight.
    # (The old comment here claimed the opposite -- "so the dispatch runner and its claude go with
    # it" -- which contradicts dispatch.ts's contract and, read literally, describes a bug.
    # Verified 2026-07-15: a run survives this exact taskkill with no daemon alive at all, and the
    # reopened app reattaches and finalizes it 'completed'. ccmanagerui guards the property with the
    # WmiPrvSE-parent test in server/tests/dispatch.test.ts.)
    taskkill /PID $procId /T /F *> $null
    if (-not $killed.ContainsKey($procId)) {
      $killed[$procId] = $targets[$procId]
      Write-Host ("  Killed pid {0} - {1}." -f $procId, $targets[$procId])
    }
  }
  Start-Sleep -Milliseconds 400   # let Windows reap them, then re-verify on the next pass
}

if ($survivors.Count -gt 0) {
  Write-Host ""
  Write-Host "  ! COULD NOT KILL the old '$name' daemon within $KillTimeoutSeconds seconds:" -ForegroundColor Red
  foreach ($procId in $survivors.Keys) {
    Write-Host ("    pid {0} - {1}" -f $procId, $survivors[$procId]) -ForegroundColor Red
  }
  Write-Host "    It is still serving the OLD code. Kill it by hand, then re-run." -ForegroundColor Red
  exit 1
}

if ($killed.Count -eq 0) {
  Write-Host "  Nothing of '$name' was running (verified via /api/health identity, not a guess)."
}

# A pointer that outlives its daemon is a landmine for the NEXT restart, so clear it -- but only if
# it still describes a process that's gone. A daemon revived by the tray watchdog during the kill
# loop has already rewritten this file, and deleting ITS pointer would strand the launcher.
if (Test-Path $runtimeFile) {
  $current = $null
  try { $current = Get-Content $runtimeFile -Raw | ConvertFrom-Json } catch { }
  $ownerAlive = $current.pid -and (Get-Process -Id ([int]$current.pid) -ErrorAction SilentlyContinue)
  if (-not $ownerAlive) { Remove-Item $runtimeFile -Force -ErrorAction SilentlyContinue }
}

# --- Relaunch ------------------------------------------------------------------------------------
if ($NoLaunch) { exit 0 }

# The tray's watchdog may already have revived the daemon (that's the fresh build, and it's fine):
# launching the shortcut then loses the single-instance mutex and exits harmlessly.
$lnk = Get-ChildItem -LiteralPath $Root -Filter *.lnk -ErrorAction SilentlyContinue | Select-Object -First 1
if ($lnk) {
  Start-Process -FilePath $lnk.FullName
  Write-Host "  Relaunched via the desktop shortcut."
} else {
  Write-Host "  No .lnk shortcut in the repo root - launch the app manually."
}
exit 0
