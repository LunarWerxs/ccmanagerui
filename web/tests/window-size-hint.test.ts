// Runs the REAL applier against a fully faked window, so its resizeTo / off-screen clamp /
// param-strip / standalone-gate behavior is exercised as actual code, not just typechecked.
// The applier only touches globals inside the function, so replacing `window` wholesale is
// enough; a real Chromium --app forwarded launch stays a manual check. Bun's node-ish test
// env has no `window`, which is exactly why the fake is a clean, total replacement.
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { applyWindowSizeHint } from '../src/lib/window-size-hint'

type FakeOpts = {
  search: string
  standalone?: boolean
  outerWidth?: number
  outerHeight?: number
  screenX?: number
  screenY?: number
}

const g = globalThis as { window?: unknown }
const realWindow = g.window

function stubWindow(opts: FakeOpts) {
  const resizeTo = mock(() => {})
  const moveTo = mock(() => {})
  const replaceState = mock(() => {})
  g.window = {
    location: { search: opts.search, pathname: '/', hash: '' },
    matchMedia: (media: string) => ({ matches: opts.standalone ?? true, media }),
    outerWidth: opts.outerWidth ?? 1280,
    outerHeight: opts.outerHeight ?? 1024,
    screenX: opts.screenX ?? 0,
    screenY: opts.screenY ?? 0,
    screen: { availLeft: 0, availTop: 0, availWidth: 3000, availHeight: 2000 },
    resizeTo,
    moveTo,
    history: { replaceState },
  }
  return { resizeTo, moveTo, replaceState }
}

afterEach(() => {
  g.window = realWindow
})

describe('applyWindowSizeHint', () => {
  test('resizes a standalone window to a valid hint, then strips the param', () => {
    const { resizeTo, replaceState } = stubWindow({ search: '?window-size=1060x800' })
    applyWindowSizeHint()
    expect(resizeTo).toHaveBeenCalledWith(1060, 800)
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  test('preserves other query params while stripping window-size', () => {
    const { replaceState } = stubWindow({ search: '?foo=1&window-size=1060x800' })
    applyWindowSizeHint()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?foo=1')
  })

  test('does not resize a non-standalone tab, but still strips the param', () => {
    const { resizeTo, replaceState } = stubWindow({
      search: '?window-size=1060x800',
      standalone: false,
    })
    applyWindowSizeHint()
    expect(resizeTo).not.toHaveBeenCalled()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  test('does not resize when the window already matches the hint', () => {
    const { resizeTo } = stubWindow({
      search: '?window-size=1060x800',
      outerWidth: 1060,
      outerHeight: 800,
    })
    applyWindowSizeHint()
    expect(resizeTo).not.toHaveBeenCalled()
  })

  test('ignores a garbage hint (no resize) but strips it', () => {
    const { resizeTo, replaceState } = stubWindow({ search: '?window-size=nope' })
    applyWindowSizeHint()
    expect(resizeTo).not.toHaveBeenCalled()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  test('is a no-op with no hint param at all', () => {
    const { resizeTo, replaceState } = stubWindow({ search: '' })
    applyWindowSizeHint()
    expect(resizeTo).not.toHaveBeenCalled()
    expect(replaceState).not.toHaveBeenCalled()
  })

  test('clamps a resized window back onto its own monitor', () => {
    // Parked near the right edge: after growing to 1060 wide on a 3000px-wide work area, the
    // furthest-left it can sit is 3000-1060=1940, so a window at x=2900 is pulled back to 1940.
    const { moveTo } = stubWindow({ search: '?window-size=1060x800', screenX: 2900, screenY: 0 })
    applyWindowSizeHint()
    expect(moveTo).toHaveBeenCalledWith(1940, 0)
  })
})
