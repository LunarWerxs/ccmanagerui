import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createCodexInstance,
  deleteCodexInstance,
  getCodexInstance,
  listCodexInstances,
  renameCodexInstance,
} from '../src/core/codex-instances'

test('Codex instance lifecycle uses an isolated CODEX_HOME and guarded delete', () => {
  const name = `codex-test-${crypto.randomUUID()}`
  const created = createCodexInstance(name)
  expect(created.ok).toBe(true)
  const id = created.data?.id as string
  const codexHome = created.data?.codexHome as string
  expect(getCodexInstance(id)?.loggedIn).toBe(false)

  writeFileSync(join(codexHome, 'auth.json'), '{}')
  expect(getCodexInstance(id)?.loggedIn).toBe(true)

  const renamed = `${name}-renamed`
  expect(renameCodexInstance(id, renamed).ok).toBe(true)
  expect(listCodexInstances().find((instance) => instance.id === id)?.name).toBe(renamed)

  expect(deleteCodexInstance(id, name).ok).toBe(false)
  expect(getCodexInstance(id)).not.toBeNull()
  expect(deleteCodexInstance(id, renamed).ok).toBe(true)
  expect(getCodexInstance(id)).toBeNull()
})
