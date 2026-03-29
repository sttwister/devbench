import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { SessionType } from "../api";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: number;
  sessionName: string;
  sessionType: SessionType;
  headerLeft?: ReactNode;
  headerActions?: ReactNode;
  onSessionEnded?: () => void;
  onSessionRenamed?: (newName: string) => void;
  onMrLinkFound?: () => void;
}

export default function TerminalPane({
  sessionId,
  sessionName,
  sessionType,
  headerLeft,
  headerActions,
  onSessionEnded,
  onSessionRenamed,
  onMrLinkFound,
}: Props) {
  const onSessionEndedRef = useRef(onSessionEnded);
  onSessionEndedRef.current = onSessionEnded;
  const onSessionRenamedRef = useRef(onSessionRenamed);
  onSessionRenamedRef.current = onSessionRenamed;
  const onMrLinkFoundRef = useRef(onMrLinkFound);
  onMrLinkFoundRef.current = onMrLinkFound;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
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

    // Initial fit needs a frame so the container has dimensions
    requestAnimationFrame(() => fitAddon.fit());

    // --- WebSocket connection -------------------------------------------
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/terminal/${sessionId}`);

    ws.onopen = () => {
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(
          "\x01" + JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows })
        );
      }
    };

    ws.onmessage = (ev) => {
      const data = ev.data as string;
      // Intercept server control messages (prefixed with \x01)
      if (typeof data === "string" && data.charCodeAt(0) === 1) {
        try {
          const msg = JSON.parse(data.slice(1));
          if (msg.type === "session-ended") {
            term.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
            onSessionEndedRef.current?.();
            return;
          }
          if (msg.type === "session-renamed" && msg.name) {
            onSessionRenamedRef.current?.(msg.name);
            return;
          }
          if (msg.type === "mr-links-changed") {
            onMrLinkFoundRef.current?.();
            return;
          }
        } catch {}
      }
      term.write(data);
    };

    ws.onclose = () =>
      term.write("\r\n\x1b[90m[session disconnected]\x1b[0m\r\n");

    ws.onerror = () =>
      term.write("\r\n\x1b[31m[connection error]\x1b[0m\r\n");

    // Terminal → server
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    // Resize handling
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("\x01" + JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    // --- Touch scrolling for mobile ------------------------------------
    // All sessions run inside tmux which uses the alternate screen buffer,
    // so xterm.js's own scrollback is always empty.  On desktop, mouse-
    // wheel events are forwarded by xterm.js as SGR mouse reports that
    // tmux understands.  Touch events don't generate wheel events.
    //
    // We use Pointer Events with setPointerCapture() instead of touch
    // events.  xterm.js's DOM renderer replaces child elements when tmux
    // redraws the screen; if the original touch-target element is removed
    // the browser fires touchcancel and stops delivering events.  Pointer
    // capture locks all subsequent pointer events to our stable container
    // element regardless of DOM mutations underneath.
    //
    // The pointermove handler only accumulates the pixel delta (O(1)).
    // Actual scrolling is deferred to requestAnimationFrame so all deltas
    // within one display frame are batched into a single operation:
    //
    //  • Mouse-mode active (tmux): batched SGR mouse-wheel escape
    //    sequences sent in one WebSocket message.
    //  • Mouse-mode inactive: term.scrollLines().
    let pointerStartY: number | null = null;
    let accumulatedDelta = 0;
    let scrollRafId: number | null = null;
    let wasTap = true;
    const xtermEl = el.querySelector(".xterm") as HTMLElement | null;

    const flushScroll = () => {
      scrollRafId = null;
      const lineHeight = term.options.fontSize ?? 14;
      const lines = Math.trunc(accumulatedDelta / lineHeight);
      if (lines === 0) return;

      const mouseActive = xtermEl?.classList.contains("enable-mouse-events");
      if (mouseActive && ws.readyState === WebSocket.OPEN) {
        const button = lines > 0 ? 65 : 64;
        const col = Math.max(1, Math.floor((term.cols || 80) / 2));
        const row = Math.max(1, Math.floor((term.rows || 24) / 2));
        const seq = `\x1b[<${button};${col};${row}M`;
        ws.send(seq.repeat(Math.abs(lines)));
      } else {
        term.scrollLines(lines);
      }
      accumulatedDelta -= lines * lineHeight;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      el.setPointerCapture(e.pointerId);
      pointerStartY = e.clientY;
      accumulatedDelta = 0;
      wasTap = true;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || pointerStartY === null) return;

      accumulatedDelta += pointerStartY - e.clientY;
      pointerStartY = e.clientY;
      wasTap = false;

      if (scrollRafId === null) {
        scrollRafId = requestAnimationFrame(flushScroll);
      }

      e.preventDefault();
    };

    const handlePointerUpOrCancel = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;

      if (wasTap) term.focus();

      pointerStartY = null;
      if (scrollRafId !== null) {
        cancelAnimationFrame(scrollRafId);
        scrollRafId = null;
      }
      flushScroll();
      accumulatedDelta = 0;
    };

    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointermove", handlePointerMove, { passive: false });
    el.addEventListener("pointerup", handlePointerUpOrCancel);
    el.addEventListener("pointercancel", handlePointerUpOrCancel);

    // --- Resize handling -----------------------------------------------
    const onResize = () => fitAddon.fit();
    window.addEventListener("resize", onResize);

    const ro = new ResizeObserver(() => fitAddon.fit());
    ro.observe(el);

    term.focus();

    return () => {
      if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUpOrCancel);
      el.removeEventListener("pointercancel", handlePointerUpOrCancel);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      ws.close();
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div className="terminal-pane">
      <div className="terminal-header">
        {headerLeft}
        <span className="terminal-icon">
          {sessionType === "claude" ? "🤖" : sessionType === "pi" ? "🥧" : sessionType === "codex" ? "🧬" : "🖥"}
        </span>
        <span className="terminal-title">{sessionName}</span>
        <div className="terminal-header-spacer" />
        {headerActions}
      </div>
      <div className="terminal-container" ref={containerRef} />
    </div>
  );
}
