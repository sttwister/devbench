import { useEffect, useCallback, useRef } from "react";
import { uploadFile } from "../api";

/**
 * Handles image/file paste and drag-and-drop on the terminal container.
 *
 * When a file is pasted (Ctrl+V / Cmd+V with an image on the clipboard)
 * or dragged-and-dropped onto the terminal, it is uploaded to the server's
 * tmp directory and the resulting file path is injected into the terminal
 * as if the user had typed it.
 *
 * On touch devices this hook is a no-op — the mobile keyboard bar provides
 * a dedicated upload button instead.
 */
export function useTerminalFileUpload(
  containerRef: React.RefObject<HTMLDivElement | null>,
  wsRef: React.RefObject<WebSocket | null>,
) {
  const uploadingRef = useRef(false);

  const sendToTerminal = useCallback(
    (text: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(text);
    },
    [wsRef],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || uploadingRef.current) return;
      uploadingRef.current = true;

      try {
        const paths: string[] = [];
        for (const file of files) {
          const filePath = await uploadFile(file);
          paths.push(filePath);
        }
        // Inject all paths separated by spaces
        sendToTerminal(paths.join(" "));
      } catch (e) {
        console.error("[file-upload] Upload failed:", e);
      } finally {
        uploadingRef.current = false;
      }
    },
    [sendToTerminal],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Skip on touch devices — the mobile upload button handles this
    const isTouchDevice =
      typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
    if (isTouchDevice) return;

    // ── Paste handler ────────────────────────────────────────
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        handleFiles(files);
      }
      // If no files, let xterm handle the text paste normally
    };

    // ── Drag & drop handlers ─────────────────────────────────
    let dragCounter = 0;

    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) {
        el.classList.add("drag-over");
      }
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        el.classList.remove("drag-over");
      }
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      el.classList.remove("drag-over");

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) {
        handleFiles(files);
      }
    };

    // Use capture phase so we see the paste event *before* xterm's
    // handler (which calls stopPropagation, blocking the bubble phase).
    el.addEventListener("paste", onPaste, true);
    el.addEventListener("dragenter", onDragEnter);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);

    return () => {
      el.removeEventListener("paste", onPaste, true);
      el.removeEventListener("dragenter", onDragEnter);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
      el.classList.remove("drag-over");
    };
  }, [containerRef, handleFiles]);

  return { handleFiles };
}
