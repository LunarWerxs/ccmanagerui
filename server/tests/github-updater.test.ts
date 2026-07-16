import { describe, expect, test } from 'bun:test'
import { currentTarget, isNewer } from '../src/github-updater'

describe('github-updater version logic', () => {
  test('isNewer: strictly-greater semver only', () => {
    expect(isNewer('0.3.0', '0.2.1')).toBe(true)
    expect(isNewer('0.2.2', '0.2.1')).toBe(true)
    expect(isNewer('1.0.0', '0.9.9')).toBe(true)
    expect(isNewer('0.2.1', '0.2.1')).toBe(false)
    expect(isNewer('0.2.0', '0.2.1')).toBe(false)
    expect(isNewer('0.1.9', '0.2.1')).toBe(false)
  })

  test('isNewer: tolerates a leading v and pre-release/build suffixes', () => {
    expect(isNewer('v0.3.0', '0.2.1')).toBe(true)
    expect(isNewer('0.3.0', 'v0.2.1')).toBe(true)
    // A pre-release/build suffix past the patch number is ignored (compares the numeric triple).
    expect(isNewer('0.3.0-rc1', '0.2.1')).toBe(true)
    expect(isNewer('0.2.1', '0.2.1+build9')).toBe(false)
  })

  test('currentTarget: os-arch matching the release-asset naming', () => {
    const t = currentTarget()
    expect(t).toMatch(/^(windows|darwin|linux)-(x64|arm64)$/)
    // never leaks node's raw 'win32'
    expect(t.startsWith('win32')).toBe(false)
  })
})
