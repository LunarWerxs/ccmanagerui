// Bun test preload (wired in bunfig.toml). Points CCMANAGERUI_DB at a throwaway sqlite file and
// CCMANAGERUI_HOME at a temp dir so the suite never reads or writes the REAL server/data db or
// ~/.ccmanagerui runtime pointer. Without this, the auto-update tests' clamp calls persist their
// synthetic values (e.g. intervalSecs 900) into the developer's live settings table.
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const scratch = mkdtempSync(path.join(os.tmpdir(), 'ccmanagerui-test-'))
process.env.CCMANAGERUI_HOME = scratch
process.env.CCMANAGERUI_DB = path.join(scratch, 'ccmanagerui-test.db')
// Isolate per-run dispatch logs (+ the detached runner's spec/status sidecars) too, so the
// dispatch tests never write into the real server/data/run-logs.
process.env.CCMANAGERUI_RUN_LOG_DIR = path.join(scratch, 'run-logs')
mkdirSync(process.env.CCMANAGERUI_RUN_LOG_DIR, { recursive: true })
