// Guardrail for a real bug we hit (2026-07-16): the Sessions "filter by instance" dropdown
// silently stopped opening. Cause — its trigger was wrapped in TWO reka `as-child` layers
// (IconTooltip's internal TooltipTrigger, then DropdownMenuTrigger) and terminated in the kit
// `<Button>` COMPONENT. reka's Primitive-based <Button> doesn't forward the merged open handler
// across a double SlotClone, so the click never reaches the menu. A plain <button> (styled with
// buttonVariants) receives the merged props directly and works — which is exactly why the
// advanced-search popover trigger right next to it (a raw <button>) was fine.
//
// The rule: inside an <IconTooltip>, a reka `*Trigger as-child` whose child is the kit <Button>
// component is broken. Use a raw `<button :class="cn(buttonVariants({...}))">` instead. Also
// catches the raw double-trigger form (`*Trigger as-child` directly inside another
// `*Trigger as-child` wrapping <Button>), which fails for the same reason.
//
// Self-contained by design: it imports nothing from the arkitect core (a bare
// `import "connections-arkitect"` doesn't resolve from a check that lives in the repo rather than
// the runner's node_modules), and returns plain finding objects — which the runner accepts as-is.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ID = "reka-trigger-in-tooltip-uses-kit-button";

// A reka trigger element (DropdownMenuTrigger / PopoverTrigger / TooltipTrigger / …) carrying
// an as-child / asChild binding.
const TRIGGER_OPEN = /<([A-Za-z][\w.]*Trigger)\b[^>]*?\b(?:as-child|asChild|:as-child)\b[^>]*>/g;
// The kit component tag (capital B). A raw <button> (lowercase) is the FIX, so it must not match.
const KIT_BUTTON = /<Button[\s/>]/;

// Dirs never worth scanning. web/src/components/ui is the generated shadcn kit (where <Button>
// itself is defined); misc/ is Windows launcher tooling — both also excluded in arkitect.config.json.
const SKIP_DIRS = new Set([
  "node_modules", "dist", ".git", "tmp", ".arkitect", "coverage", "build", "ui", "misc",
]);

const lineAt = (text, index) => text.slice(0, index).split("\n").length;

/** Recursively yield every .vue file under `dir`, skipping build/vendor/generated trees. */
function* vueFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* vueFiles(p);
    } else if (e.name.endsWith(".vue")) {
      yield p;
    }
  }
}

/** Slice from a trigger's open tag to its matching `</Name>` (best-effort, non-nesting — reka
 *  triggers wrap a single child, so the first close of the same name is correct here). */
function triggerBody(text, name, openEndIndex) {
  const close = text.indexOf(`</${name}>`, openEndIndex);
  return close === -1 ? text.slice(openEndIndex) : text.slice(openEndIndex, close);
}

export function findViolations(text) {
  const hits = [];
  const seen = new Set();
  const record = (idx) => {
    if (!seen.has(idx)) {
      seen.add(idx);
      hits.push(idx);
    }
  };

  // Form 1: inside an <IconTooltip> block, a `*Trigger as-child` wrapping the kit <Button>.
  for (const block of text.matchAll(/<IconTooltip\b[\s\S]*?<\/IconTooltip>/g)) {
    const blockText = block[0];
    const blockStart = block.index;
    TRIGGER_OPEN.lastIndex = 0;
    for (const tg of blockText.matchAll(TRIGGER_OPEN)) {
      const body = triggerBody(blockText, tg[1], tg.index + tg[0].length);
      const btn = body.match(KIT_BUTTON);
      if (btn) record(blockStart + tg.index + tg[0].length + body.indexOf(btn[0]));
    }
  }

  // Form 2: a `*Trigger as-child` directly inside another `*Trigger as-child` wrapping <Button>
  // (the raw double-trigger shape, no IconTooltip). Same double-SlotClone failure.
  TRIGGER_OPEN.lastIndex = 0;
  for (const outer of text.matchAll(TRIGGER_OPEN)) {
    const body = triggerBody(text, outer[1], outer.index + outer[0].length);
    TRIGGER_OPEN.lastIndex = 0;
    const inner = TRIGGER_OPEN.exec(body);
    if (!inner) continue;
    const innerBody = triggerBody(body, inner[1], inner.index + inner[0].length);
    const btn = innerBody.match(KIT_BUTTON);
    if (btn) {
      record(outer.index + outer[0].length + inner.index + inner[0].length + innerBody.indexOf(btn[0]));
    }
  }

  return hits.sort((a, b) => a - b);
}

export const audit = {
  id: ID,
  title: "reka trigger wrapped in a tooltip must use a raw <button>, not the kit <Button>",
  category: "custom",
  domain: "code",
  requires: {},
  gating: true, // block --fail-on-drift: this exact shape silently breaks a control
  async run(ctx) {
    const root = ctx?.root ?? process.cwd();
    const start = existsSync(join(root, "web", "src")) ? join(root, "web", "src") : root;
    const findings = [];

    for (const file of vueFiles(start)) {
      let text;
      try {
        if (statSync(file).size > 2_000_000) continue; // no .vue is this big; skip anything pathological
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (!text.includes("Trigger")) continue;
      const rel = relative(root, file).replace(/\\/g, "/");
      for (const idx of findViolations(text)) {
        findings.push({
          id: ID,
          title: "reka trigger + tooltip wraps the kit <Button> (menu/popover won't open)",
          severity: "error",
          file: rel,
          line: lineAt(text, idx),
          message:
            "A reka *Trigger (as-child) inside an IconTooltip — or nested in another trigger — " +
            "wraps the kit <Button> component. The double as-child clone drops the trigger's open " +
            "handler across the Primitive boundary, so the control never opens.",
          fix: 'Use a raw <button type="button" :class="cn(buttonVariants({ variant, size }))"> instead of the kit <Button>.',
        });
      }
    }

    const failed = findings.length > 0;
    const report = failed
      ? `Found ${findings.length} tooltip-wrapped reka trigger(s) using the kit <Button>:\n` +
        findings.map((f) => `- ${f.file}:${f.line}`).join("\n")
      : "No tooltip-wrapped reka triggers use the kit <Button>. ✓";

    return { failed, findings, report };
  },
};

// ── Standalone CLI (used by CI): `bun|node <thisfile>` prints the report and exits 1 on any
// violation. During an arkitect run the module is only IMPORTED (process.argv[1] = the arkitect
// bin, not this file), so this block is inert there — it fires only on a direct invocation. ──
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const res = await audit.run({ root: process.cwd() });
  console.log(res.report);
  if (res.failed) process.exit(1);
}
