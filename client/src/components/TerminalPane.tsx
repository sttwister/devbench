import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: number;
  sessionName: string;
  sessionType: "terminal" | "claude" | "pi" | "codex";
  headerActions?: ReactNode;
}

export default function TerminalPane({
  sessionId,
  sessionName,
  sessionType,
  headerActions,
}: Props) {
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

    ws.onmessage = (ev) => term.write(ev.data);

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

    const onResize = () => fitAddon.fit();
    window.addEventListener("resize", onResize);

    const ro = new ResizeObserver(() => fitAddon.fit());
    ro.observe(el);

    term.focus();

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      ws.close();
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div className="terminal-pane">
      <div className="terminal-header">
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
