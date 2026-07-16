# your-checks/

Your own Architect checks live here. **The core never touches this folder** — self-update only ever
refreshes the shipped core, so your rules stay yours while the core keeps improving underneath them.

A check is any `.mjs` exporting `audit`:

```js
export const audit = {
  id: "my-rule", // unique; SAME id as a core check ⇒ yours SHADOWS the core's
  title: "My rule",
  category: "custom",
  domain: "code", // "code" (your repo) | "hosted" (your cloud, via the MCP vault)
  requires: {}, // {} = any repo; e.g. { ecosystems: ["npm"] }
  gating: false, // true ⇒ blocks `architect --fail-on-drift`
  async run(ctx) {
    // ctx = { root, config, checkConfig, project, vault? }
    return {
      failed: false,
      findings: [
        /* createFinding(...) */
      ],
      report: "",
    };
  },
};
```

Drop it under `your-checks/code/` (or `your-checks/hosted/`) and it auto-registers — no wiring. Copy
`code/example-check.mjs` to start. Import helpers with `import { createFinding, walkFiles } from "connections-arkitect"`.

**Forking / pinning:** set `update.autoUpdate: false` (or pin `update.pinnedVersion`) in `arkitect.config.json`
to stop pulling the core entirely and own it outright — GitHub-fork style.
