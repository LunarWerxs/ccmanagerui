import { ref } from 'vue'

/**
 * Shared shell width: the app frames itself at a comfortable reading width and only
 * widens when the active view genuinely benefits (e.g. a session transcript is open).
 * Module-scope singleton so any view can request width and App.vue just renders it.
 */
export const SHELL_BASE_MAX = 1000
export const SHELL_WIDE_MAX = 1600

const wide = ref(false)

export function useShellWidth() {
  return { wide }
}
