// Hardened drag-to-resize pointer handling — the ONLY sanctioned way to implement a resize
// grip in a family app (first consumers: RepoYeti's changed-files tree grip and its
// file-viewer edge grip).
//
// History: naive per-grip window-listener drags repeatedly "stuck" — the resize kept
// tracking the cursor after the mouse button was released, until the next stray click
// finally delivered a pointerup. A pointerup can be legitimately swallowed by the browser:
// a right/middle press whose release goes to a context menu or autoscroll overlay, a native
// drag or touch-gesture takeover (which fires pointercancel — or nothing), pointer capture
// silently dropped when the captured element is detached mid-drag (a v-if re-render), or
// the button being released outside the window after capture was lost. No single "correct"
// listener covers all of those, so this composable layers every end signal and treats the
// first one that fires as authoritative:
//   · pointerup / pointercancel on the window (bubbling from the capture target)
//   · lostpointercapture on the window — fires on ANY capture teardown, even when the
//     matching pointerup never arrives (window-level because a detached capture target
//     retargets this event to `document`, bypassing element-scoped listeners)
//   · a buttons-mask check on every pointermove: if the primary button is no longer held,
//     the release was missed — end the drag right there. This is the ultimate backstop: a
//     stuck drag cannot survive past the first mouse movement.
//   · window blur (alt-tab / focus steal mid-drag) and component unmount
// onEnd runs exactly once per started drag, no matter which signal ends it.

import { onBeforeUnmount } from "vue";

export interface GripDragHandlers {
  /** Capture the drag's starting state. Return false to reject the drag (missing refs etc.);
   *  any other value — or no return at all — lets the drag proceed. Typed `unknown` rather
   *  than `void | boolean`: only an explicit `false` is ever inspected, and the union form
   *  trips biome's noConfusingVoidType in the consuming apps. */
  onStart?: (e: PointerEvent) => unknown;
  /** Live tracking. Only called while the primary button is verifiably still held. */
  onMove: (e: PointerEvent) => void;
  /** Commit/cleanup. Called exactly once per started drag, however it ended. */
  onEnd: () => void;
}

/**
 * Returns the `pointerdown` handler to bind on the grip element. Bind nothing else — every
 * other listener is attached per-drag and always torn down, whichever way the drag ends.
 */
export function useGripDrag(handlers: GripDragHandlers): (e: PointerEvent) => void {
  let active: (() => void) | null = null; // teardown for the drag in flight

  // Idempotent + re-entrancy-safe: clear `active` before running teardown so a second end
  // signal (pointerup then lostpointercapture fire back-to-back on a normal release) no-ops.
  function end(): void {
    const teardown = active;
    active = null;
    teardown?.();
  }

  function onDown(e: PointerEvent): void {
    // Primary button of the primary pointer only. pointerdown also fires for right/middle
    // presses and extra touch points, and those routinely never get a pointerup (context
    // menu, autoscroll) — the original stuck-drag trigger.
    if (e.button !== 0 || !e.isPrimary) return;
    end(); // never stack two drags on one grip
    if (handlers.onStart?.(e) === false) return;

    const grip = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;

    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      // Primary button no longer down → its pointerup was swallowed somewhere. Stop now.
      if ((ev.buttons & 1) === 0) {
        end();
        return;
      }
      handlers.onMove(ev);
    };
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId === pointerId) end();
    };
    const finish = (): void => end();

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", finish);
    // On the WINDOW, not the grip: when the captured element is detached mid-drag (grips
    // tend to sit inside v-if'd wrappers) the spec retargets lostpointercapture to
    // `document`, so a grip-scoped listener would never see exactly the loss it exists to
    // catch. A window listener sees both routes — the normal element-targeted event bubbles
    // up, and the document-targeted one does too. Filtered by pointerId like pointerup above.
    window.addEventListener("lostpointercapture", up);

    // Keep events streaming to the grip even when the cursor leaves the window. If capture
    // is unavailable the window listeners + buttons check still bound the drag.
    try {
      grip.setPointerCapture?.(pointerId);
    } catch {
      /* stale pointerId or detached element — window listeners still cover the drag */
    }

    active = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", finish);
      window.removeEventListener("lostpointercapture", up);
      if (grip.hasPointerCapture?.(pointerId)) {
        try {
          grip.releasePointerCapture(pointerId);
        } catch {
          /* pointer already gone */
        }
      }
      handlers.onEnd();
    };

    e.preventDefault(); // no text selection / native drag while resizing
  }

  onBeforeUnmount(end);
  return onDown;
}
