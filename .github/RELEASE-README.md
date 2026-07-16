# CC Manager UI — packaged release

This bundle is a self-contained build: the `CCManagerUI` executable (Bun runtime embedded — no
Bun, Node, or install step needed) plus the prebuilt web UI in `web/dist/`, which must stay next
to the executable.

## Run it

- **Windows**: double-click `CCManagerUI.exe` (or run it from a terminal). For a system-tray icon
  (Open / Restart / Quit) instead of a console window, run `misc\Tray-Launch.vbs` — create a
  shortcut to it with `misc\New-TrayShortcut.ps1`.
- **macOS / Linux**: `./ccmanagerui`

The daemon serves the UI and API on <http://localhost:7787> (it hops to the next free port if
7787 is busy, and prints the real URL). State lives in `~/.ccmanagerui/`.

`./ccmanagerui --version` prints the version; `--mcp` runs the MCP stdio server for
MCP-speaking agents (point your `mcpServers` command at this executable with the `--mcp` arg).

## Requirements

- The `claude` CLI, for dispatching queue runs.
- Claude Desktop (classic Windows installer), for the multi-instance manager.
- macOS / Linux: instance management is source-accurate but less battle-tested than Windows.

## Updating

Packaged builds don't self-update (that's a source-checkout feature) — download the next release
from <https://github.com/LunarWerxs/ccmanagerui/releases>. Your data (`~/.ccmanagerui/`) carries
over unchanged.
