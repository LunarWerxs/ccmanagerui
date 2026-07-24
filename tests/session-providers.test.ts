import { expect, test } from 'bun:test'
import { openCodePartsToTailEvents } from '../server/src/opencode-sessions'
import { sessionMarkKey } from '../server/src/sessions'
import { codexEventToTailEvents, isCodexInjectedUserText } from '../server/src/transcript'

test('Codex injected runtime blocks are not rendered as human messages', () => {
  expect(
    isCodexInjectedUserText('<environment_context>machine details</environment_context>'),
  ).toBe(true)
  expect(isCodexInjectedUserText('# AGENTS.md instructions for D:\\work')).toBe(true)
  expect(
    codexEventToTailEvents({
      timestamp: '2026-07-23T12:00:00Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<recommended_plugins>...</recommended_plugins>' }],
      },
    }),
  ).toEqual([])
})

test('Codex rollout messages and tools map to the shared tail model', () => {
  const message = codexEventToTailEvents({
    timestamp: '2026-07-23T12:00:00Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: '  Fixed the issue.  ' }],
    },
  })
  expect(message).toEqual([
    {
      role: 'assistant',
      kind: 'text',
      text: 'Fixed the issue.',
      tool_name: null,
      timestamp: '2026-07-23T12:00:00Z',
    },
  ])

  const tool = codexEventToTailEvents({
    type: 'response_item',
    payload: { type: 'function_call', name: 'shell_command', arguments: '{"command":"bun test"}' },
  })
  expect(tool[0]?.kind).toBe('tool_use')
  expect(tool[0]?.tool_name).toBe('shell_command')
})

test('OpenCode text and tool parts map to the shared tail model while reasoning stays hidden', () => {
  const events = openCodePartsToTailEvents('assistant', 1000, [
    { data: { type: 'reasoning', text: 'private chain' }, timeCreatedAt: 1000 },
    { data: { type: 'text', text: 'Done.' }, timeCreatedAt: 2000 },
    {
      data: {
        type: 'tool',
        tool: 'read',
        state: { input: { file: 'README.md' }, output: 'contents', time: { completed: 4000 } },
      },
      timeCreatedAt: 3000,
    },
  ])
  expect(events.map((event) => event.kind)).toEqual(['text', 'tool_use', 'tool_result'])
  expect(events.some((event) => event.text.includes('private chain'))).toBe(false)
})

test('non-Claude done marks are namespaced to avoid cross-provider UUID collisions', () => {
  expect(sessionMarkKey('claude', 'same-id')).toBe('same-id')
  expect(sessionMarkKey('codex', 'same-id')).toBe('codex:same-id')
  expect(sessionMarkKey('opencode', 'same-id')).toBe('opencode:same-id')
})
