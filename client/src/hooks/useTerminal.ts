import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

/**
 * Creates and manages an xterm.js Terminal instance.
 * Handles mounting, fitting, resize observation, and cleanup.
 *
 * Returns refs to the terminal and fit addon so other hooks can use them.
 */
export function useTerminal(containerRef: React.RefObject<HTMLDivElement | null>) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // On touch devices, disable xterm's built-in stdin.  Its hidden textarea
    // breaks mobile autocomplete & voice dictation (cleared on blur → diffs
    // against empty → re-sends everything).  A dedicated native <input> in
    // MobileKeyboardBar handles input instead.
    const isTouchDevice =
      typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: isTouchDevice ? 10 : 14,
      disableStdin: isTouchDevice,
      fontFamily: '"JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
        black: "#0d1117",
        red: "#ff7b72",
        green: "#7ee787",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#e6edf3",
        brightBlack: "#484f58",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(el);

    termRef.current = term;
    fitRef.current = fitAddon;

    // Initial fit needs a frame so the container has dimensions
    requestAnimationFrame(() => fitAddon.fit());

    // Resize handling
    const onResize = () => fitAddon.fit();
    window.addEventListener("resize", onResize);

    const ro = new ResizeObserver(() => fitAddon.fit());
    ro.observe(el);

    // On desktop, auto-focus so keystrokes go to the terminal immediately.
    // On touch devices, skip — focusing opens the virtual keyboard.
    if (!isTouchDevice) {
      term.focus();
    }

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [containerRef]);

  return { termRef, fitRef };
}
