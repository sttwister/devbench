import { useEffect, useRef, useState } from "react";

interface Props {
  sessionName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

export default function RenameSessionPopup({ sessionName, onConfirm, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(sessionName);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) onConfirm(trimmed);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    e.stopPropagation();
  };

  return (
    <div className="new-session-popup-backdrop" onClick={onCancel}>
      <div
        className="new-session-popup rename-session-popup"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rename-session-popup-title">Rename session</div>
        <input
          ref={inputRef}
          className="rename-session-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={onCancel}
        />
        <div className="new-session-popup-hint">
          <kbd>Enter</kbd> to confirm · <kbd>Esc</kbd> to cancel
        </div>
      </div>
    </div>
  );
}
