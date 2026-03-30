import type { ModifierState } from "../hooks/useMobileKeyboard";

interface Props {
  ctrlState: ModifierState;
  altState: ModifierState;
  onToggleCtrl: () => void;
  onToggleAlt: () => void;
  onSendKey: (key: string) => void;
}

/**
 * Floating keyboard bar for mobile / touch-primary devices.
 *
 * Renders Esc, Tab, Ctrl (sticky), Alt (sticky), and arrow keys.
 * Hidden on desktop via CSS `@media (pointer: coarse)`.
 *
 * `onMouseDown` with `preventDefault` on the bar container prevents
 * the browser from moving focus away from the terminal textarea,
 * keeping the virtual keyboard open.
 */
export default function MobileKeyboardBar({
  ctrlState,
  altState,
  onToggleCtrl,
  onToggleAlt,
  onSendKey,
}: Props) {
  const modClass = (state: ModifierState) =>
    `mobile-kb-btn modifier${state !== "off" ? " active" : ""}${state === "locked" ? " locked" : ""}`;

  return (
    <div
      className="mobile-keyboard-bar"
      onMouseDown={(e) => e.preventDefault()}
    >
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
  );
}
