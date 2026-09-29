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
      fontSize: isTouchDevice ? 11 : 14,
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

    // Handle OSC 52 (clipboard) escape sequences from tmux.
    // When tmux has `set-clipboard external` (the default), it emits OSC 52
    // after mouse-based text selection.  xterm.js does not handle this by
    // default, so we register a custom handler that writes to the browser
    // clipboard, bridging tmux selections to the user's system clipboard.
    const osc52 = term.parser.registerOscHandler(52, (data) => {
      // Format: "Pc;Pd" where Pc = selection target, Pd = base64 content or "?"
      const idx = data.indexOf(";");
      if (idx === -1) return false;
      const payload = data.slice(idx + 1);
      if (payload === "?" || !payload) return false; // query request, ignore
      try {
        // atob yields one char per byte; decode the bytes as UTF-8 so
        // diacritics and other multi-byte characters survive.
        const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
        const text = new TextDecoder().decode(bytes);
        navigator.clipboard.writeText(text).catch(() => {});
      } catch { /* invalid base64 */ }
      return true;
    });

    termRef.current = term;
    fitRef.current = fitAddon;
    console.log(`[ws-debug] useTerminal: xterm created at ${performance.now().toFixed(0)}`);

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
      osc52.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [containerRef]);

  return { termRef, fitRef };
}
