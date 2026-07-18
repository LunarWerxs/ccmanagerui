<div align="center">

<img alt="CC Manager UI. Run, queue and orchestrate Claude: many instances, one dashboard" src=".github/og-image.png" width="820" />

### Every Claude on your machine, in one dashboard

[**Website**](https://ccmanagerui.github.io) &nbsp;·&nbsp; [Download](https://github.com/LunarWerxs/CCManagerUI/releases) &nbsp;·&nbsp; [Reference](docs/REFERENCE.md) &nbsp;·&nbsp; [Changelog](CHANGELOG.md)

[![Website](https://img.shields.io/badge/website-ccmanagerui.github.io-c15f3c?style=flat-square)](https://ccmanagerui.github.io)
[![CI](https://img.shields.io/github/actions/workflow/status/LunarWerxs/CCManagerUI/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/LunarWerxs/CCManagerUI/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/LunarWerxs/CCManagerUI?style=flat-square&color=c15f3c)](https://github.com/LunarWerxs/CCManagerUI/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-c15f3c?style=flat-square)](LICENSE)

</div>

---

If you run Claude in more than one place, a couple of isolated Desktop instances on different
accounts, a pile of Claude Code sessions across repos, a terminal or three, nothing shows you all of
it at once. You alt-tab to remember which account is which, whether a session is still going, and
what you asked it to do.

CC Manager UI is one local daemon that reads what is already on your machine and puts it in a single
browser tab.

## What it does

|  |  |
|---|---|
| **See every instance** | Each isolated Claude Desktop instance, which account it is on, live memory and uptime. Open, quit, create or delete them. |
| **Browse every session** | Your Claude Code transcripts, live-tailing, filtered by instance and recency. Open the raw `.jsonl` or copy it out. |
| **Message a session** | Type at the bottom of a transcript and send straight to it. Or pick several and message them all. |
| **Queue up work** | Build a list of `claude` runs, each with its own prompt, model, effort, permissions and account. Run on demand or on a schedule. |
| **Survive a restart** | Dispatched runs reattach after a quit or an update instead of dying. |
| **Sleep through a rate limit** | Sessions stopped by a 5-hour limit resume once the window resets, gated on your weekly usage. Off by default. |

Nothing leaves your machine. No cloud, no account needed to run it.

## Install

**Download** the bundle for your OS from [Releases](https://github.com/LunarWerxs/CCManagerUI/releases),
unzip, and run `CCManagerUI.exe` (or `./ccmanagerui`). Self-contained, no Bun needed. On Windows,
`misc\Tray-Launch.vbs` gives you a tray icon instead of a console window.

**Or from source**, with [Bun](https://bun.sh):

```sh
git clone https://github.com/LunarWerxs/CCManagerUI.git
cd CCManagerUI && bun install
bun run build && bun run start
```

Either way the UI is at <http://localhost:7787>.

> **Just trying it?** Set `CCMANAGERUI_FAKE=1` and dispatch uses a harmless stand-in for the `claude`
> CLI, so nothing touches your quota or your repos. The scheduler is off by default. Note that
> instance actions (open / quit / create / delete) act on **real** Claude Desktop instances; delete
> asks you to type the name.

## Requirements

- **[Bun](https://bun.sh)** if running from source.
- The **`claude` CLI** for dispatch, and/or **Claude Desktop** for instance management.
- **Windows** for the tray launcher. macOS and Linux builds exist and the instance-account code is
  written for them, but they are not verified there yet.
- **Windows instance management needs the classic Claude Desktop build** (the ~217 MB Squirrel
  `.exe` installer). The newer MSIX package cannot be launched with an isolated profile. The
  Instances tab detects this and links the right installer.

## For agents

The whole API is exposed over MCP, so Claude Code, Claude Desktop or Cursor can drive sessions, the
queue, the scheduler and instances directly. Setup and the full tool list are in
[docs/REFERENCE.md](docs/REFERENCE.md).

Agents can also read their own remaining quota before fanning out work:
[docs/AI_USAGE_SELFCHECK.md](docs/AI_USAGE_SELFCHECK.md).

## More

[Reference](docs/REFERENCE.md) covers configuration, the MCP tools, auto-update, the stack, the repo
layout and how to run the checks.

## License

[MIT](LICENSE).
