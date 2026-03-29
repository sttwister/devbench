/**
 * Electron bridge detection — single source of truth.
 *
 * `devbench` is the Electron preload API (null when running in a regular browser).
 * `isElectron` is a convenience boolean.
 */
export const devbench = window.devbench ?? null;
export const isElectron = !!devbench;
