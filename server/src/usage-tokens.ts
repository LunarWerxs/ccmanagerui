// server/src/usage-tokens.ts — count the tokens you ACTUALLY spent, from the transcripts.
//
// WHY. The usage endpoint reports a percentage and nothing else: `limit_dollars`, `used_dollars` and
// `remaining_dollars` are all null on a subscription, and there are no token counts anywhere in the
// response. So "98%" is a percentage of a number Anthropic will not tell us. An agent asking "can I
// afford this task?" has no denominator to reason with.
//
// But Claude Code writes every assistant turn to `<CLAUDE_CONFIG_DIR>/projects/**/*.jsonl`, and each
// one carries its exact `usage` block (input / output / cache-read / cache-creation) and its model.
// Those are real, countable units. Summing them over a time window gives a tokens-per-hour rate.
//
// Combine that with the %-per-hour burn rate from usage-history.ts and the denominator falls out:
//
//     tokensPerPercent  =  tokens/hour  ÷  percent/hour
//     remainingTokens   =  remainingPct × tokensPerPercent
//
// That is the whole trick. We never learn Anthropic's real quota; we MEASURE it, in the only units an
// agent can actually budget in.
//
// HONEST LIMITS (surfaced on the result, never hidden):
//   - This sees Claude CODE transcripts on THIS machine only. Usage from the Claude Desktop app, the
//     web UI, or another machine still counts against the same %, but we cannot see its tokens. When
//     that happens the derived tokensPerPercent is an OVER-estimate (we attribute all the % movement
//     to the tokens we can see), so `remainingTokens` reads high. `coverage` says how much to trust it.
//   - The corpus is large (thousands of sessions, GBs). We therefore only scan files whose mtime
//     falls inside the window, which keeps a 5-hour lookback to a handful of files.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TokenSpend } from './types'

/** A Claude config dir's transcript root. */
const projectsDir = (configDir: string): string => join(configDir, 'projects')

/** The default (non-isolated) CLI login. */
export const defaultConfigDir = (): string => join(homedir(), '.claude')

interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// --- weighting: why a raw token SUM is a garbage metric ---------------------------------------
//
// Naively adding the four token counts produces an absurd number: a Claude Code turn re-reads its
// whole cached prefix every time, so `cache_read_input_tokens` is ~500k on EVERY turn. Summing that
// over a thousand turns "measures" hundreds of millions of tokens, which is really just
// (context size x turn count), not work done, and not what burns quota.
//
// Quota burn tracks COST, and the four kinds of token do not cost the same. So we convert everything
// into one unit -- "base-input-token equivalents" -- using the published price ratios. A cache read
// is a tenth of an input token; an output token is five times one.
//
// The absolute unit does not actually matter, because tokensPerPercent is CALIBRATED empirically
// (see usage-budget.ts) and a constant factor cancels out. What matters is that the unit is
// PROPORTIONAL to real cost, so the calibration stays stable as the mix of cache/output/model shifts.
// A raw sum is not proportional to cost, which is exactly why it had to go.
const W_INPUT = 1
const W_CACHE_CREATION = 1.25 // writing to the cache costs a premium
const W_CACHE_READ = 0.1 // reading from it is the cheap part
const W_OUTPUT = 5 // output is the expensive part

/** Price of a model relative to Sonnet (Opus ~5x, Haiku ~0.27x). Quota is shared across models, so a
 *  turn's weight must account for WHICH model spent it, or an Opus-heavy hour reads as cheap. */
function modelMultiplier(model: string): number {
  const m = model.toLowerCase()
  if (m.includes('opus') || m.includes('fable')) return 5
  if (m.includes('haiku')) return 0.27
  return 1 // sonnet + anything unrecognized: the safe middle
}

/** One turn's cost in base-input-token equivalents. Exported for the test. */
export function weighTurn(usage: RawUsage, model: string): number {
  const raw =
    num(usage.input_tokens) * W_INPUT +
    num(usage.cache_creation_input_tokens) * W_CACHE_CREATION +
    num(usage.cache_read_input_tokens) * W_CACHE_READ +
    num(usage.output_tokens) * W_OUTPUT
  return raw * modelMultiplier(model)
}

/**
 * Sum the token usage recorded in one transcript file for turns inside [since, now].
 *
 * Parses line-by-line and skips anything that isn't an assistant turn carrying a `usage` block; a
 * transcript also holds user turns, tool results, and queue-operation records. A malformed line is
 * skipped rather than aborting the file (transcripts are appended live and the last line can be a
 * partial write).
 *
 * Exported for the unit test.
 */
export function sumTranscriptTokens(text: string, sinceMs: number): TokenSpend {
  const spend: TokenSpend = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
    raw: 0,
    weighted: 0,
    byModel: {},
    turns: 0,
  }
  for (const line of text.split('\n')) {
    if (!line || line.charCodeAt(0) !== 123 /* '{' */) continue
    // Cheap pre-filter: skip the ~90% of lines that cannot contribute, before paying for JSON.parse.
    if (!line.includes('"usage"')) continue

    let rec: { type?: string; timestamp?: string; message?: { model?: string; usage?: RawUsage } }
    try {
      rec = JSON.parse(line)
    } catch {
      continue // partial trailing write, or a line we don't understand
    }
    // Only an ASSISTANT turn spends quota. A user turn or tool result can carry a `usage` echo, and
    // counting those would double-count the same spend.
    if (rec.type !== 'assistant') continue
    const usage = rec.message?.usage
    if (!usage) continue
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : Number.NaN
    if (!Number.isFinite(ts) || ts < sinceMs) continue

    const input = num(usage.input_tokens)
    const output = num(usage.output_tokens)
    const cacheRead = num(usage.cache_read_input_tokens)
    const cacheCreation = num(usage.cache_creation_input_tokens)
    const model = rec.message?.model ?? 'unknown'
    const weighted = weighTurn(usage, model)

    spend.input += input
    spend.output += output
    spend.cacheRead += cacheRead
    spend.cacheCreation += cacheCreation
    spend.raw += input + output + cacheRead + cacheCreation
    spend.weighted += weighted
    spend.turns += 1

    const m = spend.byModel[model] ?? { weighted: 0, output: 0, turns: 0 }
    m.weighted += weighted
    m.output += output
    m.turns += 1
    spend.byModel[model] = m
  }
  return spend
}

function mergeSpend(a: TokenSpend, b: TokenSpend): TokenSpend {
  const byModel = { ...a.byModel }
  for (const [model, m] of Object.entries(b.byModel)) {
    const cur = byModel[model] ?? { weighted: 0, output: 0, turns: 0 }
    byModel[model] = {
      weighted: cur.weighted + m.weighted,
      output: cur.output + m.output,
      turns: cur.turns + m.turns,
    }
  }
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    raw: a.raw + b.raw,
    weighted: a.weighted + b.weighted,
    turns: a.turns + b.turns,
    byModel,
  }
}

const EMPTY: TokenSpend = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  raw: 0,
  weighted: 0,
  turns: 0,
  byModel: {},
}

/** Every *.jsonl under a transcripts root whose mtime is at/after `sinceMs`. The mtime filter is what
 *  keeps this cheap: the corpus is thousands of files and gigabytes, but a 5-hour window touches only
 *  the handful that were actually written to. */
function recentTranscripts(root: string, sinceMs: number): string[] {
  const hits: string[] = []
  let projects: string[]
  try {
    projects = readdirSync(root)
  } catch {
    return hits // no transcripts for this config dir (never used, or not logged in)
  }
  for (const proj of projects) {
    const dir = join(root, proj)
    let files: string[]
    try {
      files = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const p = join(dir, f)
      try {
        if (statSync(p).mtimeMs >= sinceMs) hits.push(p)
      } catch {
        // vanished mid-scan (a session being rotated); skip
      }
    }
  }
  return hits
}

/**
 * Total tokens spent since `since`, across the given Claude config dirs (default: the plain
 * `~/.claude` login). Reads only the transcripts touched inside the window.
 */
export function tokensSince(since: Date, configDirs: string[] = [defaultConfigDir()]): TokenSpend {
  const sinceMs = since.getTime()
  let spend = EMPTY
  for (const dir of configDirs) {
    for (const file of recentTranscripts(projectsDir(dir), sinceMs)) {
      try {
        spend = mergeSpend(spend, sumTranscriptTokens(readFileSync(file, 'utf8'), sinceMs))
      } catch {
        // unreadable/locked file: skip rather than fail the whole count
      }
    }
  }
  return spend
}

/**
 * The empirically-measured size of one percent of the weekly quota, in tokens.
 *
 * `tokensPerHour / burnPctPerHour`. Returns null when either input is missing or the burn is zero
 * (dividing by a zero burn is how you get an infinite, useless answer).
 */
export function tokensPerPercent(
  tokensPerHour: number | null,
  burnPctPerHour: number | null,
): number | null {
  if (tokensPerHour === null || burnPctPerHour === null) return null
  if (burnPctPerHour <= 0 || tokensPerHour <= 0) return null
  return tokensPerHour / burnPctPerHour
}
