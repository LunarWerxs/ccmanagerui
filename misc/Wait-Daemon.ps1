# misc/Wait-Daemon.ps1 — confirm the daemon came back, and PROVE it is serving the code we just built.
#
# WHY: the failure this guards against is silent. On 2026-07-14 a daemon served 10h39m-old code
# while every `Rebuild.bat` run printed "Done." The build was genuinely fresh on disk; the process
# serving it simply never restarted. Nothing in the flow ever looked, so nothing ever complained.
#
# So a rebuild is not "done" when the script ends. It is done when a daemon answers /api/health as
# THIS app AND that process started AFTER we stopped the old one. The second half is the whole point:
# a daemon that is merely UP proves nothing, because the stale one was up the entire time too.
#
# HOW THIS SCRIPT ITSELF LIED (2026-07-15), and the rule that fixes it:
# The old Find-Daemon accepted any responder that didn't contradict us --
#   if (-not $svc -or $svc -eq $AppName) { return ... }
# -- so a health body with no `service` field counted as this app. Vite dev servers answer
# /api/health with the SPA fallback (200 OK, text/html, an index.html body), so one of Michael's
# Connections dev planes on port 4273 was mistaken for redesign; this script read THAT stranger's
# start time, found it older than the stamp, and reported "STALE DAEMON: you are still being served
# the OLD code" while the real redesign daemon was up on port 5178 serving the fresh build.
#
# The rule now matches Restart-Daemon.ps1 exactly: a responder is this app only with a JSON
# content-type, `ok: true`, and `service` EQUAL to package.json `name`. Silence is not identity.
# An unidentified responder is a stranger, so we keep looking rather than latch onto it and lie in
# either direction (a false "stale" is as costly as a false "fresh" -- it burns your time hunting a
# bug that doesn't exist, and it trains you to ignore the alarm on the day it's real).
#
# How it knows when the rebuild started: Restart-Daemon.ps1 drops a timestamp file when it runs.
# If that stamp is present and recent, the daemon must be younger than it. If there is no stamp
# (someone ran this script on its own), there is nothing to compare against, so this degrades to a
# plain "is it up?" check rather than inventing a threshold and crying wolf.

[CmdletBinding()]
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  # How long to give the tray to bring the daemon back up.
  [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'SilentlyContinue'

$name = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).name
$stampFile = Join-Path $env:TEMP "$name-restart.stamp"
$runtimeFile = Join-Path $env:USERPROFILE ".$name\runtime.json"

# The moment the restart began, if we have it. Only trust a FRESH stamp: an old one left behind by a
# previous rebuild would make an otherwise-fine daemon look stale.
$restartedAt = $null
if (Test-Path $stampFile) {
  try {
    $parsed = [datetime]::Parse((Get-Content $stampFile -Raw).Trim())
    if (((Get-Date) - $parsed).TotalMinutes -lt 10) { $restartedAt = $parsed }
  } catch { }
}

# Identical identity rule to Restart-Daemon.ps1: JSON content-type + ok:true + exact service match.
# Returns the service name, or $null for "not one of ours".
function Get-HealthService {
  param([int]$Port)
  try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
  } catch { return $null }
  if (($res.Headers['Content-Type'] -join ',') -notmatch 'application/json') { return $null }
  try { $body = $res.Content | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
  if ($body.ok -ne $true -or -not $body.service) { return $null }
  return [string]$body.service
}

function Find-Daemon {
  param([string]$AppName)

  # The pointer names the port the daemon actually bound, so try it first -- it's both the fastest
  # path and the authoritative one. It is still validated by identity, never trusted on its own.
  $ports = New-Object System.Collections.Generic.List[int]
  if (Test-Path $runtimeFile) {
    try {
      $recorded = (Get-Content $runtimeFile -Raw | ConvertFrom-Json).port
      if ($recorded) { $ports.Add([int]$recorded) }
    } catch { }
  }
  foreach ($conn in (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)) {
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -in @('bun', 'node')) { $ports.Add([int]$conn.LocalPort) }
  }

  foreach ($port in ($ports | Select-Object -Unique)) {
    if ((Get-HealthService -Port $port) -ne $AppName) { continue }
    $procId = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -First 1
    $proc = if ($procId) { Get-Process -Id $procId -ErrorAction SilentlyContinue } else { $null }
    if (-not $proc) { continue }
    return [pscustomobject]@{ Port = $port; Pid = $proc.Id; Started = $proc.StartTime }
  }
  return $null
}

# do/while so a 0-second timeout still probes once.
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  $found = Find-Daemon -AppName $name
  if ($found) { break }
  Start-Sleep -Milliseconds 700
} while ((Get-Date) -lt $deadline)

if (-not $found) {
  Write-Host ""
  Write-Host "  ! No daemon identifying as '$name' came back within $TimeoutSeconds seconds." -ForegroundColor Red
  Write-Host "    Launch the app from its shortcut / tray, then reload the page."
  exit 1
}

$age = (Get-Date) - $found.Started

# The proof that matters. Allow a couple of seconds of slack for clock/handoff jitter.
if ($restartedAt -and $found.Started -lt $restartedAt.AddSeconds(-2)) {
  Write-Host ""
  Write-Host "  ! STALE DAEMON: '$name' answers on port $($found.Port) (pid $($found.Pid))," -ForegroundColor Red
  Write-Host ("    but that process started {0:hh\:mm\:ss} ago, BEFORE this rebuild restarted it." -f $age) -ForegroundColor Red
  Write-Host "    You are still being served the OLD code." -ForegroundColor Red
  Write-Host "    Try:  powershell -ExecutionPolicy Bypass -File misc\Restart-Daemon.ps1" -ForegroundColor Yellow
  Remove-Item $stampFile -Force -ErrorAction SilentlyContinue
  exit 1
}

Remove-Item $stampFile -Force -ErrorAction SilentlyContinue
if ($restartedAt) {
  Write-Host ("  OK: '{0}' is live on port {1} (pid {2}), started {3:N0}s ago - it IS the fresh build." -f $name, $found.Port, $found.Pid, $age.TotalSeconds)
} else {
  Write-Host ("  '{0}' is live on port {1} (pid {2}), up for {3:hh\:mm\:ss}. (No restart stamp, so freshness was not asserted.)" -f $name, $found.Port, $found.Pid, $age)
}
exit 0
