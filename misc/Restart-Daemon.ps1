# misc/Restart-Daemon.ps1 — find this app's running daemon and stop it, however it was started.
#
# WHY THIS EXISTS (learned the hard way, 2026-07-14):
# The old restart logic trusted ONE thing: the port recorded in `~/.<app>/runtime.json`. If that
# file was missing or stale it printed "App does not appear to be running", killed nothing, and
# relaunched the shortcut -- which no-ops against the tray's single-instance mutex. The result is
# the worst possible failure mode: `Rebuild.bat` reports success, the build IS fresh on disk, and
# the daemon serving it is hours old. You rebuild over and over and nothing changes.
#
# That is exactly what happened: a daemon ran for 10h39m on stale code while every rebuild
# "succeeded". runtime.json had been lost (a second daemon exiting calls clearInstanceInfo(), which
# deletes the pointer belonging to the survivor), and there was no tray supervising it either.
#
# THE FIX: do not trust the pointer file as the only source of truth. The daemon already tells us
# who it is -- `GET /api/health` returns `{ service: "<app>" }`, which is the very contract the
# single-instance guard relies on. So: collect candidate ports (the pointer, PLUS every port a
# bun/node process is actually listening on), probe each one, and stop only the processes that
# IDENTIFY THEMSELVES as this app. That is both more robust (finds an orphan the pointer forgot)
# and safer (it can never kill a sibling app, because the identity has to match).
#
# App-agnostic on purpose: everything is derived from package.json `name`, so the same file works in
# ccmanagerui / redesign / repoyeti / devwebui.

[CmdletBinding()]
param(
  # Repo root. Defaults to the parent of misc/, i.e. the app root.
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  # Stop the daemon but don't relaunch the app afterwards.
  [switch]$NoLaunch
)

$ErrorActionPreference = 'SilentlyContinue'

$pkgPath = Join-Path $Root 'package.json'
if (-not (Test-Path $pkgPath)) {
  Write-Host "  ! No package.json at $Root - cannot identify the app." -ForegroundColor Red
  exit 1
}
$name = (Get-Content $pkgPath -Raw | ConvertFrom-Json).name
$runtimeFile = Join-Path $env:USERPROFILE ".$name\runtime.json"

# Record WHEN this restart began. Wait-Daemon.ps1 reads it to assert that the daemon now answering is
# YOUNGER than this moment, i.e. that it really is a new process and not the old one that never died.
# Without this, "the daemon is up" proves nothing: the stale daemon was up the whole time too.
Set-Content -Path (Join-Path $env:TEMP "$name-restart.stamp") -Value (Get-Date).ToString('o') -Encoding ASCII

# --- 1. Candidate ports ------------------------------------------------------------------------
# The pointer is a hint, not the truth. Union it with every port a bun/node process is listening on,
# so an orphaned daemon the pointer forgot is still found.
$candidates = New-Object System.Collections.Generic.List[int]
$pointerPort = $null
if (Test-Path $runtimeFile) {
  try {
    $pointerPort = (Get-Content $runtimeFile -Raw | ConvertFrom-Json).port
    if ($pointerPort) { $candidates.Add([int]$pointerPort) }
  } catch { }
}

foreach ($conn in (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)) {
  $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  # A dead OwningProcess is a zombie socket (a killed daemon's port not yet reaped by Windows).
  # It cannot be killed and it does not answer health, so it is skipped naturally below.
  if ($proc -and $proc.ProcessName -in @('bun', 'node')) { $candidates.Add([int]$conn.LocalPort) }
}

$ports = $candidates | Sort-Object -Unique
if (-not $ports) {
  Write-Host "  No bun/node listeners found - the app does not appear to be running."
}

# --- 2. Probe each candidate and stop only OUR daemon -------------------------------------------
# `/api/health` -> { ok: true, service: "<name>" }. Matching on `service` is what makes this safe:
# a sibling LunarWerx app listening on a nearby port answers with a DIFFERENT name and is left alone.
#
# Not every app in the family stamps `service` on its health body. When it is ABSENT we must not
# guess (killing an unidentified bun/node listener could take out an unrelated dev server), so we
# fall back to the old, narrow rule: trust it only if it is the exact port the pointer file names.
# That keeps such an app no worse off than before, while apps that DO identify themselves get the
# orphan-finding upgrade.
$stopped = @()
$unidentified = @()
foreach ($port in $ports) {
  $health = $null
  try { $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2 } catch { continue }
  if (-not $health) { continue }

  $isOurs = $false
  if ($health.PSObject.Properties.Name -contains 'service' -and $health.service) {
    $isOurs = ($health.service -eq $name)
  } elseif ($pointerPort -and [int]$pointerPort -eq [int]$port) {
    $isOurs = $true   # no identity on the wire; the pointer is all we have
  } else {
    $unidentified += $port
  }
  if (-not $isOurs) { continue }

  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($procId in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
    # /T so the daemon's children (a dispatch runner, a spawned claude) go with it.
    taskkill /PID $procId /T /F *> $null
    $stopped += [pscustomobject]@{ Port = $port; Pid = $procId }
  }
}

if ($unidentified.Count -gt 0 -and $stopped.Count -eq 0) {
  Write-Host ("  Note: port(s) {0} answer /api/health but do not say WHICH app they are," -f ($unidentified -join ', ')) -ForegroundColor Yellow
  Write-Host "        so they were left alone. Add `service: '$name'` to this app's /api/health body" -ForegroundColor Yellow
  Write-Host "        to make an orphaned daemon findable here." -ForegroundColor Yellow
}

if ($stopped.Count -gt 0) {
  foreach ($s in $stopped) {
    $orphanNote = if ($pointerPort -and [int]$pointerPort -eq [int]$s.Port) { '' } else { '  (the pointer file did NOT know about this one)' }
    Write-Host ("  Stopped {0} on port {1} (pid {2}).{3}" -f $name, $s.Port, $s.Pid, $orphanNote)
  }
} elseif ($ports) {
  Write-Host "  No running '$name' daemon found (nothing answered /api/health as '$name')."
}

# A pointer that survives the daemon is a landmine for the NEXT restart, so clear it.
if (Test-Path $runtimeFile) { Remove-Item $runtimeFile -Force -ErrorAction SilentlyContinue }

# --- 3. Relaunch --------------------------------------------------------------------------------
if ($NoLaunch) { exit 0 }

$lnk = Get-ChildItem -LiteralPath $Root -Filter *.lnk -ErrorAction SilentlyContinue | Select-Object -First 1
if ($lnk) {
  Start-Process -FilePath $lnk.FullName
  Write-Host "  Relaunched via the desktop shortcut."
} else {
  Write-Host "  No .lnk shortcut in the repo root - launch the app manually."
}
