// Platform detection for keyboard conventions and on-screen key labels.

const platform = typeof navigator === 'undefined'
  ? ''
  : (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '')

// macOS (not iPhone/iPad: those are touch-first and have no modifier-key shortcuts)
export const IS_MAC = /mac/i.test(platform) && !/iphone|ipad|ipod/i.test(platform)

// The "command" modifier for shortcuts like undo: Cmd on Mac, Ctrl elsewhere
export const isModKey = (e) => (IS_MAC ? e.metaKey : e.ctrlKey)

// Mac keyboard symbols, used in the controls panel and tooltips
export const MAC_KEYS = { ctrl: '⌃', shift: '⇧', cmd: '⌘', option: '⌥' }
