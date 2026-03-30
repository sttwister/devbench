import type { ModifierState } from "../hooks/useMobileKeyboard";

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
}: Props) {
  const modClass = (state: ModifierState) =>
    `mobile-kb-btn modifier${state !== "off" ? " active" : ""}${state === "locked" ? " locked" : ""}`;

  return (
    <div
      className="mobile-keyboard-bar"
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* ── Native text input row ──────────────────────────────── */}
      {inputRef && (
        <div className="mobile-native-input-row">
          <div
            ref={inputRef as React.RefObject<HTMLDivElement>}
            contentEditable="plaintext-only"
            role="textbox"
            className="mobile-native-input-field"
            data-placeholder="Type here…"
            enterKeyHint="send"
            onCompositionStart={onInputCompositionStart}
            onCompositionEnd={onInputCompositionEnd}
            onInput={onInputInput}
            onKeyDown={onInputKeyDown}
            // Stop mousedown propagation so the parent's preventDefault
            // doesn't prevent the element from receiving focus on tap.
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── Special keys row ───────────────────────────────────── */}
      <div className="mobile-kb-row">
        <button className="mobile-kb-btn" onClick={() => onSendKey("esc")}>
          Esc
        </button>
        <button className="mobile-kb-btn" onClick={() => onSendKey("tab")}>
          Tab
        </button>
        <button className="mobile-kb-btn" onClick={() => onSendKey("slash")}>
          /
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
    </div>
  );
}
