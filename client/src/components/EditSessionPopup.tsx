import { useEffect, useRef, useState, useCallback } from "react";
import type { Session } from "../api";
import {
  updateSessionSource,
  removeMrUrl,
  addMrUrl,
  detectSourceType,
  getSourceLabel,
} from "../api";
import Icon from "./Icon";
import MrBadge from "./MrBadge";

interface Props {
  session: Session;
  onClose: () => void;
  onUpdated: () => void;
}

export default function EditSessionPopup({ session, onClose, onUpdated }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const mrInputRef = useRef<HTMLInputElement>(null);

  const [sourceUrl, setSourceUrl] = useState(session.source_url ?? "");
  const [sourceEditing, setSourceEditing] = useState(false);
  const [mrUrls, setMrUrls] = useState(session.mr_urls);
  const [newMrUrl, setNewMrUrl] = useState("");
  const [addingMr, setAddingMr] = useState(false);
  const [busy, setBusy] = useState(false);

  // Sync if session data changes while popup is open
  useEffect(() => {
    setMrUrls(session.mr_urls);
  }, [session.mr_urls]);

  useEffect(() => {
    if (sourceEditing) sourceInputRef.current?.focus();
  }, [sourceEditing]);

  useEffect(() => {
    if (addingMr) mrInputRef.current?.focus();
  }, [addingMr]);

  // Focus the popup on mount
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleSaveSource = useCallback(async () => {
    const url = sourceUrl.trim() || null;
    setBusy(true);
    try {
      await updateSessionSource(session.id, url);
      setSourceEditing(false);
      onUpdated();
    } catch (e: any) {
      console.error("Failed to update source:", e);
    } finally {
      setBusy(false);
    }
  }, [session.id, sourceUrl, onUpdated]);

  const handleRemoveMr = useCallback(async (url: string) => {
    setBusy(true);
    try {
      await removeMrUrl(session.id, url);
      setMrUrls((prev) => prev.filter((u) => u !== url));
      onUpdated();
    } catch (e: any) {
      console.error("Failed to remove MR URL:", e);
    } finally {
      setBusy(false);
    }
  }, [session.id, onUpdated]);

  const handleAddMr = useCallback(async () => {
    const url = newMrUrl.trim();
    if (!url) return;
    setBusy(true);
    try {
      await addMrUrl(session.id, url);
      setNewMrUrl("");
      setAddingMr(false);
      setMrUrls((prev) => prev.includes(url) ? prev : [...prev, url]);
      onUpdated();
    } catch (e: any) {
      console.error("Failed to add MR URL:", e);
    } finally {
      setBusy(false);
    }
  }, [session.id, newMrUrl, onUpdated]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (sourceEditing) {
        setSourceEditing(false);
        setSourceUrl(session.source_url ?? "");
      } else if (addingMr) {
        setAddingMr(false);
        setNewMrUrl("");
      } else {
        onClose();
      }
    }
  };

  const detectedType = sourceUrl.trim() ? detectSourceType(sourceUrl.trim()) : null;
  const detectedLabel = sourceUrl.trim() ? getSourceLabel(sourceUrl.trim()) : null;

  return (
    <div className="new-session-popup-backdrop" onClick={handleBackdropClick}>
      <div
        className="edit-session-popup"
        ref={ref}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="edit-session-popup-header">
          <span className="edit-session-popup-title">Edit Session</span>
          <button
            className="edit-session-popup-close"
            onClick={onClose}
            title="Close"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* ── Source URL ─────────────────────────────────── */}
        <div className="edit-session-section">
          <div className="edit-session-label">Source URL</div>
          {sourceEditing ? (
            <div className="edit-session-source-edit">
              <input
                ref={sourceInputRef}
                type="text"
                className="edit-session-input"
                placeholder="Paste a JIRA, Linear, Sentry, GitHub, or Slack URL..."
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") handleSaveSource();
                  if (e.key === "Escape") {
                    setSourceEditing(false);
                    setSourceUrl(session.source_url ?? "");
                  }
                }}
                disabled={busy}
              />
              {detectedType && (
                <div className="edit-session-source-detected">
                  <span className="source-type-tag">{detectedType}</span>
                  {detectedLabel && <span className="source-label">{detectedLabel}</span>}
                </div>
              )}
              <div className="edit-session-actions-row">
                <button
                  className="edit-session-btn save"
                  onClick={handleSaveSource}
                  disabled={busy}
                >
                  Save
                </button>
                <button
                  className="edit-session-btn cancel"
                  onClick={() => {
                    setSourceEditing(false);
                    setSourceUrl(session.source_url ?? "");
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="edit-session-source-display">
              {session.source_url ? (
                <span className="edit-session-source-value" title={session.source_url}>
                  {detectedLabel || session.source_url}
                </span>
              ) : (
                <span className="edit-session-empty">No source URL</span>
              )}
              <button
                className="edit-session-btn-icon"
                onClick={() => setSourceEditing(true)}
                title={session.source_url ? "Edit source URL" : "Add source URL"}
              >
                <Icon name={session.source_url ? "pencil" : "plus"} size={12} />
              </button>
              {session.source_url && (
                <button
                  className="edit-session-btn-icon danger"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await updateSessionSource(session.id, null);
                      setSourceUrl("");
                      onUpdated();
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                  title="Remove source URL"
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── MR/PR Links ────────────────────────────────── */}
        <div className="edit-session-section">
          <div className="edit-session-label">MR / PR Links</div>
          {mrUrls.length > 0 ? (
            <div className="edit-session-mr-list">
              {mrUrls.map((url) => {
                return (
                  <div key={url} className="edit-session-mr-item">
                    <MrBadge
                      url={url}
                      status={session.mr_statuses?.[url]}
                      className="edit-session-mr-badge"
                    />
                    <span className="edit-session-mr-url" title={url}>
                      {url}
                    </span>
                    <button
                      className="edit-session-btn-icon danger"
                      onClick={() => handleRemoveMr(url)}
                      disabled={busy}
                      title="Remove this link"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="edit-session-empty">No MR/PR links detected</div>
          )}

          {addingMr ? (
            <div className="edit-session-mr-add">
              <input
                ref={mrInputRef}
                type="text"
                className="edit-session-input"
                placeholder="Paste a MR/PR URL..."
                value={newMrUrl}
                onChange={(e) => setNewMrUrl(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") handleAddMr();
                  if (e.key === "Escape") {
                    setAddingMr(false);
                    setNewMrUrl("");
                  }
                }}
                disabled={busy}
              />
              <div className="edit-session-actions-row">
                <button
                  className="edit-session-btn save"
                  onClick={handleAddMr}
                  disabled={busy || !newMrUrl.trim()}
                >
                  Add
                </button>
                <button
                  className="edit-session-btn cancel"
                  onClick={() => {
                    setAddingMr(false);
                    setNewMrUrl("");
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="edit-session-add-mr-btn"
              onClick={() => setAddingMr(true)}
            >
              <Icon name="plus" size={12} />
              <span>Add MR/PR link</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
