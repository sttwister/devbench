import { useRef } from "react";
import type { ModifierState } from "../hooks/useMobileKeyboard";
import Icon from "./Icon";

interface Props {
  ctrlState: ModifierState;
  altState: ModifierState;
  onToggleCtrl: () => void;
  onToggleAlt: () => void;
  onSendKey: (key: string) => void;

  /** Native input props (mobile-only, rendered above the key row). */
  inputRef?: React.RefObject<HTMLDivElement | null>;
  onInputCompositionStart?: () => void;
  onInputCompositionEnd?: () => void;
  onInputInput?: () => void;
  onInputKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;

  /** Git commit & push action (shown only for agent sessions). */
  onGitCommitPush?: () => void;

  /** Close session action (merge PRs + done + archive). */
  onCloseSession?: () => void;

  /** File upload handler (mobile). */
  onUploadFiles?: (files: File[]) => void;

  /** Selection mode (long-press to select text). */
  selectionMode?: boolean;
  onCopySelection?: () => void;
  onSelectAll?: () => void;
  onCancelSelection?: () => void;
}

/**
 * Floating keyboard bar for mobile / touch-primary devices.
 *
 * Renders a native text <input> (for autocomplete / voice dictation) above
 * the special-key row (Esc, Tab, Ctrl, Alt, arrows).
 *
 * Hidden on desktop via CSS `@media (pointer: coarse)`.
 *
 * `onMouseDown` with `preventDefault` on the bar container prevents
 * the browser from moving focus away from the native input,
 * keeping the virtual keyboard open.
 */
export default function MobileKeyboardBar({
  ctrlState,
  altState,
  onToggleCtrl,
  onToggleAlt,
  onSendKey,
  inputRef,
  onInputCompositionStart,
  onInputCompositionEnd,
  onInputInput,
  onInputKeyDown,
  onGitCommitPush,
  onCloseSession,
  onUploadFiles,
  selectionMode,
  onCopySelection,
  onSelectAll,
  onCancelSelection,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modClass = (state: ModifierState) =>
    `mobile-kb-btn modifier${state !== "off" ? " active" : ""}${state === "locked" ? " locked" : ""}`;

  return (
    <div
      className="mobile-keyboard-bar"
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* ── Native text input row ──────────────────────────────── */}
      {inputRef && (
        <div className={`mobile-native-input-row${selectionMode ? " selection-active" : ""}`}>
          <div
            ref={inputRef as React.RefObject<HTMLDivElement>}
            contentEditable="plaintext-only"
            role="textbox"
            className="mobile-native-input-field"
            data-placeholder="Type here…"
            inputMode="text"
            autoCapitalize="sentences"
            enterKeyHint="send"
            onCompositionStart={onInputCompositionStart}
            onCompositionEnd={onInputCompositionEnd}
            onInput={onInputInput}
            onKeyDown={onInputKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
          />
          {onUploadFiles && (
            <>
              <button
                className="mobile-upload-btn"
                title="Upload file"
                onClick={async () => {
                  if (typeof window.showOpenFilePicker === "function") {
                    try {
                      const handles = await window.showOpenFilePicker({ multiple: true });
                      const files = await Promise.all(handles.map((h: any) => h.getFile()));
                      if (files.length > 0) onUploadFiles!(files);
                    } catch { /* cancelled */ }
                    return;
                  }
                  fileInputRef.current?.click();
                }}
              >
                <Icon name="paperclip" size={18} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="*/*,application/octet-stream"
                multiple
                className="mobile-upload-input"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) onUploadFiles(files);
                  e.target.value = ""; // reset so the same file can be re-selected
                }}
              />
            </>
          )}
          {onCloseSession && (
            <button
              className="mobile-close-session-btn"
              title="Close session (merge + done + archive)"
              onClick={onCloseSession}
            >
              <Icon name="archive" size={18} />
            </button>
          )}
          {onGitCommitPush && (
            <button
              className="mobile-git-push-btn"
              title="Git commit & push"
              onClick={() => onGitCommitPush()}
            >
              <Icon name="git-merge" size={18} />
            </button>
          )}
        </div>
      )}

      {/* ── Special keys row / Selection controls ───────────────── */}
      {selectionMode ? (
        <div className="mobile-kb-row selection-mode">
          <button className="mobile-kb-btn copy-btn" onClick={onCopySelection}>
            <Icon name="copy" size={14} />
            <span>Copy</span>
          </button>
          <button className="mobile-kb-btn select-all-btn" onClick={onSelectAll}>
            Select All
          </button>
          <button className="mobile-kb-btn cancel-btn" onClick={onCancelSelection}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ) : (
        <div className="mobile-kb-row">
          <button className="mobile-kb-btn" onClick={() => onSendKey("esc")}>
            Esc
          </button>
          <button className="mobile-kb-btn" onClick={() => onSendKey("tab")}>
            Tab
          </button>

          <button className={modClass(ctrlState)} onClick={onToggleCtrl}>
            Ctrl
          </button>
          <button className={modClass(altState)} onClick={onToggleAlt}>
            Alt
          </button>

          <div className="mobile-kb-separator" />

          <button className="mobile-kb-btn arrow" onClick={() => onSendKey("left")}>
            ←
          </button>
          <button className="mobile-kb-btn arrow" onClick={() => onSendKey("up")}>
            ↑
          </button>
          <button className="mobile-kb-btn arrow" onClick={() => onSendKey("down")}>
            ↓
          </button>
          <button className="mobile-kb-btn arrow" onClick={() => onSendKey("right")}>
            →
          </button>
        </div>
      )}
    </div>
  );
}
