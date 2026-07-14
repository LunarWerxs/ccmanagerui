# misc/Wait-Daemon.ps1 — confirm the daemon came back, and PROVE it is serving the code we just built.
#
# WHY: the failure this guards against is silent. On 2026-07-14 a daemon served 10h39m-old code
# while every `Rebuild.bat` run printed "Done." The build was genuinely fresh on disk; the process
# serving it simply never restarted. Nothing in the flow ever looked, so nothing ever complained.
#
# So a rebuild is not "done" when the script ends. It is done when a daemon answers /api/health as
# this app AND that process started AFTER we stopped the old one. The second half is the whole point:
# a daemon that is merely UP proves nothing, because the stale one was up the entire time.
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

# The moment the restart began, if we have it. Only trust a FRESH stamp: an old one left behind by a
# previous rebuild would make an otherwise-fine daemon look stale.
$restartedAt = $null
if (Test-Path $stampFile) {
  try {
    $parsed = [datetime]::Parse((Get-Content $stampFile -Raw).Trim())
    if (((Get-Date) - $parsed).TotalMinutes -lt 10) { $restartedAt = $parsed }
  } catch { }
}

function Find-Daemon {
  param([string]$AppName)
  foreach ($conn in (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)) {
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -notin @('bun', 'node')) { continue }
    try { $health = Invoke-RestMethod "http://127.0.0.1:$($conn.LocalPort)/api/health" -TimeoutSec 2 } catch { continue }
    $svc = $health.service
    # Apps that don't stamp `service` still answer; accept them rather than report a false "down".
    if (-not $svc -or $svc -eq $AppName) {
      return [pscustomobject]@{ Port = $conn.LocalPort; Pid = $proc.Id; Started = $proc.StartTime; Named = [bool]$svc }
    }
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
  Write-Host "  ! The daemon did NOT come back within $TimeoutSeconds seconds." -ForegroundColor Red
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
