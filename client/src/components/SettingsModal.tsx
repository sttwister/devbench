import { useEffect, useState, useCallback } from "react";
import { fetchSettings, updateSetting } from "../api";
import Icon from "./Icon";

interface Props {
  onClose: () => void;
}

interface TokenField {
  key: string;
  label: string;
  placeholder: string;
}

const TOKEN_FIELDS: TokenField[] = [
  { key: "gitlab_token", label: "GitLab Token", placeholder: "glpat-xxxxxxxxxxxxxxxxxxxx" },
  { key: "github_token", label: "GitHub Token", placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx" },
];

export default function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  const handleEdit = useCallback((key: string) => {
    setEditingKey(key);
    // Don't pre-fill with masked value — user enters fresh
    setEditValue("");
  }, []);

  const handleSave = useCallback(async (key: string) => {
    setSaving(true);
    try {
      await updateSetting(key, editValue);
      // Reload settings to get masked value
      const updated = await fetchSettings();
      setSettings(updated);
      setEditingKey(null);
      setEditValue("");
    } catch (e: any) {
      console.error("Failed to save setting:", e);
    } finally {
      setSaving(false);
    }
  }, [editValue]);

  const handleRemove = useCallback(async (key: string) => {
    setSaving(true);
    try {
      await updateSetting(key, "");
      const updated = await fetchSettings();
      setSettings(updated);
      setEditingKey(null);
    } catch (e: any) {
      console.error("Failed to remove setting:", e);
    } finally {
      setSaving(false);
    }
  }, []);

  const handleCancel = useCallback(() => {
    setEditingKey(null);
    setEditValue("");
  }, []);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal settings-modal">
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="modal-body">
          <h3 className="settings-section-title">Integration Tokens</h3>
          <p className="settings-section-desc">
            Tokens are used to poll MR/PR status from GitLab and GitHub APIs.
          </p>

          {!loaded ? (
            <div className="settings-loading">Loading…</div>
          ) : (
            <div className="settings-tokens">
              {TOKEN_FIELDS.map((field) => {
                const currentValue = settings[field.key];
                const isEditing = editingKey === field.key;
                const hasValue = !!currentValue;

                return (
                  <div key={field.key} className="settings-token-row">
                    <label className="settings-token-label">{field.label}</label>
                    {isEditing ? (
                      <div className="settings-token-edit">
                        <input
                          type="password"
                          className="settings-token-input"
                          placeholder={field.placeholder}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && editValue.trim()) handleSave(field.key);
                            if (e.key === "Escape") handleCancel();
                          }}
                          autoFocus
                          disabled={saving}
                        />
                        <button
                          className="settings-btn save"
                          onClick={() => handleSave(field.key)}
                          disabled={saving || !editValue.trim()}
                        >
                          Save
                        </button>
                        <button
                          className="settings-btn cancel"
                          onClick={handleCancel}
                          disabled={saving}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="settings-token-display">
                        {hasValue ? (
                          <>
                            <code className="settings-token-masked">{currentValue}</code>
                            <button
                              className="settings-btn edit"
                              onClick={() => handleEdit(field.key)}
                            >
                              Change
                            </button>
                            <button
                              className="settings-btn remove"
                              onClick={() => handleRemove(field.key)}
                            >
                              Remove
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="settings-token-empty">Not set</span>
                            <button
                              className="settings-btn edit"
                              onClick={() => handleEdit(field.key)}
                            >
                              Set
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
