# CC Manager UI system-tray host (Windows). THIN ADAPTER over the shared LunarWerx
# tray-host engine (misc\Tray-Host.ps1, kit-synced — DO NOT EDIT THAT FILE HERE; edit
# lunarwerx-ui/src/tray-host/Tray-Host.ps1 and run `node sync.mjs`). This file's only job
# is to declare what makes CC Manager UI different from its siblings (ReDesign/RepoYeti/
# DevWebUI) — mutex name, daemon start command, shutdown protocol, icon, etc. — as a
# $TrayConfig hashtable, then hand off to the engine. See Tray-Host.ps1's header comment
# for the full $TrayConfig contract (every key below is documented there).
#
# Launch it via Tray-Launch.vbs (which auto-discovers the sibling *-Tray.ps1 and runs it
# hidden; the port comes from this file's own param() default, not the .vbs). The
# daemon serves the built Vue SPA + API on one port. The shortcut launches FAST with the
# existing build; use the tray's "Rebuild & Restart" to rebuild the GUI from source and
# restart the daemon. This script lives in misc/; the repo root (one level up) IS the app
# root (server/, web/).
#
# Port handling: -Port is the PREFERRED port. If it's busy, the daemon picks the next free
# port itself and records where it landed in ~/.ccmanagerui/runtime.json — the engine never
# assumes the port; it reads the real URL from there (validated by /api/health).
param([int]$Port = 7787, [switch]$SelfTest)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$appRoot = Split-Path -Parent $scriptDir

# Dev-only gate for "Rebuild & Restart": a distributed build ships a prebuilt web\dist and no
# server\src tree, so rebuilding there would just fail. Dev-only via CCMANAGERUI_DEV=1 — public/
# source-checkout users never see "Rebuild & Restart"; they use misc/Rebuild.bat instead.
$isDevTree = ($env:CCMANAGERUI_DEV -eq "1")

# Release layout (the GitHub-release zip): a compiled CCManagerUI.exe sits at the app root, next
# to web\dist — start THAT instead of `bun server/src/index.ts`, skip the bun-based first run, and
# don't require bun on PATH at all (the exe embeds its runtime). A source checkout has no exe at
# the root, so this stays the dev/bun path there.
$exeFile = Join-Path $appRoot "CCManagerUI.exe"
$isCompiledTree = Test-Path $exeFile

# Config dir honours CCMANAGERUI_HOME (matches server/src/config.ts CONFIG_DIR), else
# ~/.ccmanagerui — so the runtime pointer + daemon log path the engine reads always track
# where the daemon writes.
$cmHome = if ($env:CCMANAGERUI_HOME) { $env:CCMANAGERUI_HOME } else { Join-Path $env:USERPROFILE ".ccmanagerui" }
$infoFile = Join-Path $cmHome "runtime.json"
$logPath = Join-Path $cmHome "logs\daemon.log"

# First run (blocking, once, cold start only): install deps and build the GUI if missing.
$firstRun = {
  param($root)
  if (-not (Test-Path (Join-Path $root "node_modules"))) { & cmd.exe /c "cd /d `"$root`" && bun install" | Out-Null }
  if (-not (Test-Path (Join-Path $root "web\dist"))) { & cmd.exe /c "cd /d `"$root`" && bun run build" | Out-Null }
}

$TrayConfig = @{
  DisplayName          = "CC Manager UI"
  ServiceName          = "ccmanagerui"                  # health body.service must match (case-sensitive)
  IconFile             = "CCManagerUI.ico"
  Port                 = $Port
  UrlHost              = "localhost"
  InfoFile             = $infoFile
  DaemonLogPath        = $logPath
  StartCommand         = if ($isCompiledTree) { "`"$exeFile`"" } else { "bun server/src/index.ts" }
  StartEnv             = @{}                            # PortEnvVar covers PORT; token env var added below
  PortEnvVar           = "PORT"
  EntryFile            = if ($isCompiledTree) { "CCManagerUI.exe" } else { "server\src\index.ts" }
  FirstRun             = if ($isCompiledTree) { $null } else { $firstRun }
  RebuildCommand       = "bun run build"
  RebuildLogName       = "CCManagerUI-Rebuild.log"
  IsDevTree            = $isDevTree
  SentinelFile         = $null                          # CCManagerUI has no shutdown sentinel (in-memory intentionalStop only)
  ShutdownTokenEnvVar  = "CCMANAGERUI_SHUTDOWN_TOKEN"
  ShutdownHeaderPrefix = "x-ccmanagerui"
  OnStrayDaemon        = "attach"                        # adopt a live daemon rather than spawning a 2nd one
  # OLD's watchdog had no ownership gate — it unconditionally relaunched on any health-check
  # failure regardless of who started the daemon. Opt out of the engine's DevWebUI-derived default
  # (which stands the watchdog down for an attached instance owned by another session) to preserve
  # that parity: an attached daemon crashing still gets revived by this tray.
  WatchdogRequiresOwnership = $false
  # Portable-window sizing (engine: Open-AppUi). First-run size = the daemon's measured
  # PORTABLE_WINDOW_SIZE (server/src/config.ts — the sessions sidebar rail-collapses below a
  # 1024px viewport, so 1060 outer clears it with slack; 800 tall ≈ the header + ~10 session
  # rows), so a COLD tray start (tray boots the daemon and opens the window itself, before
  # the daemon's own POST /api/portable-window path exists) stops opening a never-seen
  # profile at ~the whole work area. NO PortableWindowSizeHint: this web build has no
  # ?window-size applier (no resizeTo anywhere in web/src), so the hint would ride every URL
  # as an inert param — enable it only after porting devwebui's web/src/lib/window-size-hint.ts.
  PortableWindowSize   = @{ Width = 1060; Height = 800 }
  SelfTestMarker       = "CCMANAGERUI_TRAY_SELFTEST"
  MenuOpenLabel        = "Open CC Manager UI"
  MutexName            = "CCManagerUITrayHost"
  RuntimeCheckCommand  = if ($isCompiledTree) { $exeFile } else { "bun" }   # Get-Command accepts a full exe path
  ScriptDir            = $scriptDir
  Root                 = $appRoot
  # OLD script's background worker (Restart / Rebuild & Restart) waited 15s for the daemon to
  # rebind (was hardcoded Wait-ForUrl ... 15000 on both paths) — pin it explicitly rather than
  # inherit the engine's 12s family default, which would time out 3s earlier than before.
  WorkerWaitSec        = 15
}

# Dot-source the shared engine (kit-synced copy — never edit in-place) and hand off.
. (Join-Path $scriptDir "Tray-Host.ps1")

if ($SelfTest) {
  Invoke-TrayHostSelfTest $TrayConfig
} else {
  Start-TrayHost $TrayConfig
}
