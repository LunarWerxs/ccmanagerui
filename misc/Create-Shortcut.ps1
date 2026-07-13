# Creates / refreshes the "CCManagerUI" shortcut in the project root. THIN ADAPTER over the
# shared LunarWerx shortcut engine (misc\New-TrayShortcut.ps1, kit-synced — DO NOT EDIT THAT
# FILE HERE; edit lunarwerx-ui/src/tray-host/New-TrayShortcut.ps1 and run `node sync.mjs`).
# The shortcut launches misc\Tray-Launch.vbs (system tray, auto-discovers CCManagerUI-Tray.ps1)
# and carries the icon, so the root has one nice clickable entry. Re-run this if you move or
# rename the folder.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition   # ...\misc
$root = Split-Path -Parent $scriptDir

. (Join-Path $scriptDir "New-TrayShortcut.ps1")

New-TrayShortcut -Root $root -ScriptDir $scriptDir `
  -LnkName "CCManagerUI" `
  -IconFile "CCManagerUI.ico" `
  -Description "Launch CC Manager UI (system tray)"
