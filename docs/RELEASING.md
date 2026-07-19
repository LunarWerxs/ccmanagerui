# Releasing

## Pushing `main` is the release

Auto-update (see the README's Auto-update section) applies each update as a `git pull --ff-only`
against `origin/main`. There is no separate publish step for that path: as soon as `main` moves,
every instance with auto-update enabled will fast-forward to it on its next check. Treat a push to
`main` as user-facing, not as a staging step.

## Recipe

1. **Bump the version.** Update `version` in `package.json`.
2. **Update the changelog.** Move the relevant `[Unreleased]` entries in `CHANGELOG.md` into a new
   `## [X.Y.Z] - YYYY-MM-DD` heading, following the existing Keep a Changelog format already used
   in that file.
3. **Run local CI before pushing**, mirroring what CI runs: `bun install --frozen-lockfile`,
   `bun run lint`, `bun run --cwd web check:i18n`, `bun run build`, `bun test`. Don't rely on
   pushing to find out one of these fails.

   A local pass is one leg of a two-leg matrix. CI runs `[ubuntu-latest, windows-latest]`, so a
   green run on Windows says nothing about Linux. Anything OS-shaped (path handling, filesystem
   watching, process spawning, line endings) needs a real runner before you call it verified.
4. **Commit** the version bump and changelog update.
5. **Push `main`, then wait for CI to go green.** Not the same step as tagging, deliberately: this
   push is the release (see above), so it is the last point at which a red run is still cheap.
   ```sh
   git push origin main
   gh run watch          # or: gh run list --limit 2
   ```
6. **Tag only once `main` is green:**
   ```sh
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
   `git push --follow-tags` bundles both into one command, which is how v0.7.0 shipped to
   auto-update instances before anyone had looked at CI; it then failed the ubuntu leg on a
   win32-only path assertion. Prefer the two steps.

   **If a tag does end up on a red commit,** moving it is cheap while the GitHub Release is still an
   unpublished draft: `gh release delete vX.Y.Z --yes --cleanup-tag`, re-tag the green commit, push
   the tag, let the workflow rebuild. Note that deleting the draft also deletes its release notes,
   so keep a copy and reapply them with `gh release edit vX.Y.Z --notes-file`.

## What the tag push triggers

Pushing a tag matching `v*.*.*` triggers `.github/workflows/release.yml`, which cross-compiles
real executables for every supported OS (Windows x64, Linux x64/arm64, macOS x64/arm64) and
attaches them to a **draft** GitHub Release. The web UI ships as a sidecar `web/dist` folder next
to each binary, not embedded, since Vite's hashed filenames aren't known at compile time. A
maintainer then edits the draft's release notes and publishes it manually; the workflow does not
publish automatically. `workflow_dispatch` on that same workflow runs the build and a boot smoke
test only, with no tag and no release, for validating the pipeline without cutting a version.

## Instance appearance: rename is a display label, not a folder rename

This is unrelated to the release mechanics above, but is release-adjacent operational knowledge
worth keeping next to it: renaming an instance in the Instances manager only ever changes a
display label. It never renames the instance's underlying folder.

- This was a deliberate choice over renaming the folder, because Windows holds a running
  instance's profile folder open; renaming it live is unsafe or outright impossible. A display
  label works even while the instance is running.
- The old folder-rename endpoint, `POST /api/instances/:dir/rename`, and its handler
  `renameInstance()` (`core/lifecycle.ts`), were **removed**. Do not reintroduce a folder-rename
  endpoint; if instance renaming needs revisiting, extend the label instead.
- The folder `name` is unchanged by a rename and remains the **stable ID** that sessions are
  tagged against (`instance-sessions.ts` scans by folder name, not by label).
- Per-instance UI metadata, `{ label, icon, color }`, persists in
  `~/.ccmanagerui/instance-meta.json` (`server/src/core/instance-meta.ts`), keyed by the
  normalized folder path, written atomically the same way as the account cache, and cleaned up
  when the instance is deleted. It's set via `POST /api/instances/:dir/meta`: a present field
  applies, `null` clears it back to the computed default, and an absent field is left unchanged.
- The icon and color **key** sets are defined once, in `server/src/core/shared.ts`
  (`INSTANCE_ICON_KEYS`, 16 glyphs; `INSTANCE_COLOR_KEYS`, 10 colors), re-exported as values from
  `server/src/types.ts`, and consumed on the web side by `web/src/lib/instance-appearance.ts`
  (key to Lucide component, key to a fixed oklch color, plus a deterministic default derived from
  a hash of the folder name so un-customized rows still look visually distinct from each other).
- `CMInstance` carries `label`, `icon`, and `color`, all nullable. The UI shows `label ?? name`
  wherever an instance is displayed (filter dropdown, instance chips), but always filters and
  links by the underlying folder `name`.
