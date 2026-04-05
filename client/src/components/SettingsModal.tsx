import { useEffect, useState, useCallback } from "react";
import { fetchSettings, updateSetting, validateToken, type TokenValidation } from "../api";
import {
  getNotificationSoundEnabled,
  setNotificationSoundEnabled,
  getBrowserNotificationsEnabled,
  setBrowserNotificationsEnabled,
  requestNotificationPermission,
  getNotificationPermission,
} from "../hooks/useNotifications";
import Icon from "./Icon";

interface Props {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onClose: () => void;
  hasUnreadNotifications?: boolean;
}

interface TokenField {
  key: string;
  label: string;
  placeholder: string;
  hint: string;
  hintUrl: string;
  scopes: string;
}

const TOKEN_FIELDS: TokenField[] = [
  {
    key: "gitlab_token",
    label: "GitLab Token",
    placeholder: "glpat-xxxxxxxxxxxxxxxxxxxx",
    hint: "Create a Personal Access Token",
    hintUrl: "https://gitlab.com/-/user_settings/personal_access_tokens",
    scopes: "read_api",
  },
  {
    key: "github_token",
    label: "GitHub Token",
    placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx",
    hint: "Create a Fine-grained Personal Access Token",
    hintUrl: "https://github.com/settings/personal-access-tokens/new",
    scopes: "Pull requests: Read",
  },
  {
    key: "linear_token",
    label: "Linear Token",
    placeholder: "lin_api_xxxxxxxxxxxxxxxxxxxx",
    hint: "Create a Personal API Key",
    hintUrl: "https://linear.app/settings/api",
    scopes: "read, write (for issue state transitions)",
  },
  {
    key: "jira_base_url",
    label: "JIRA Base URL",
    placeholder: "https://mycompany.atlassian.net",
    hint: "Your JIRA instance URL",
    hintUrl: "https://support.atlassian.com/jira-software-cloud/docs/what-is-jira-software/",
    scopes: "e.g. https://mycompany.atlassian.net",
  },
  {
    key: "jira_token",
    label: "JIRA Token",
    placeholder: "email@company.com:api-token or PAT",
    hint: "Create an API Token",
    hintUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    scopes: "email:token (Cloud) or PAT (Data Center)",
  },
  {
    key: "slack_token",
    label: "Slack Token",
    placeholder: "xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx",
    hint: "Create a Slack App with Bot Token",
    hintUrl: "https://api.slack.com/apps",
    scopes: "channels:history, channels:read, files:read",
  },
];

export default function SettingsPane({ sidebarOpen, setSidebarOpen, onClose, hasUnreadNotifications }: Props) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [validations, setValidations] = useState<Record<string, { testing: boolean; result?: TokenValidation }>>({});

  // Notification preferences (localStorage-backed)
  const [soundEnabled, setSoundEnabled] = useState(getNotificationSoundEnabled);
  const [browserNotifEnabled, setBrowserNotifEnabled] = useState(getBrowserNotificationsEnabled);
  const [notifPermission, setNotifPermission] = useState(getNotificationPermission);

  useEffect(() => {
    fetchSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  // "q" to close settings (when not editing a field)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "q") {
        onClose();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleTest = useCallback(async (key: string) => {
    setValidations((v) => ({ ...v, [key]: { testing: true } }));
    try {
      const result = await validateToken(key);
      setValidations((v) => ({ ...v, [key]: { testing: false, result } }));
    } catch {
      setValidations((v) => ({ ...v, [key]: { testing: false, result: { valid: false, error: "Request failed" } } }));
    }
  }, []);

  const handleEdit = useCallback((key: string) => {
    setEditingKey(key);
    setEditValue("");
    setValidations((v) => { const next = { ...v }; delete next[key]; return next; });
  }, []);

  const handleSave = useCallback(async (key: string) => {
    setSaving(true);
    setValidations((v) => { const next = { ...v }; delete next[key]; return next; });
    try {
      await updateSetting(key, editValue);
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
    setValidations((v) => { const next = { ...v }; delete next[key]; return next; });
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

  return (
    <main className="main-content">
      <div className="settings-pane">
        <div className="settings-header">
          <button
            className={`sidebar-open-btn${hasUnreadNotifications ? " has-notifications" : ""}`}
            onClick={() => setSidebarOpen(true)}
            title="Open sidebar"
          >
            <Icon name="menu" size={20} />
          </button>
          <Icon name="settings" size={18} />
          <h2>Settings</h2>
          <div className="settings-header-spacer" />
          <button className="icon-btn" onClick={onClose} title="Close settings (Esc)">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-content">
            <section className="settings-section">
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
                    const validation = validations[field.key];

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
                                  className="settings-btn test"
                                  onClick={() => handleTest(field.key)}
                                  disabled={validation?.testing}
                                >
                                  {validation?.testing ? "Testing…" : "Test"}
                                </button>
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
                        {validation?.result && (
                          <div className={`settings-token-validation ${validation.result.valid ? "valid" : "invalid"}`}>
                            {validation.result.valid
                              ? <><Icon name="check-circle" size={13} /> Connected as <strong>{validation.result.user}</strong></>
                              : <><Icon name="alert-circle" size={13} /> {validation.result.error}</>
                            }
                          </div>
                        )}
                        <div className="settings-token-hint">
                          <a href={field.hintUrl} target="_blank" rel="noopener noreferrer">
                            {field.hint} ↗
                          </a>
                          <span className="settings-token-scopes">Required scope: <code>{field.scopes}</code></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="settings-section">
              <h3 className="settings-section-title">Notifications</h3>
              <p className="settings-section-desc">
                Get notified when agent sessions finish work and are waiting for your input.
              </p>

              <div className="settings-notifications">
                <div className="settings-notification-row">
                  <label className="settings-notification-label">
                    <input
                      type="checkbox"
                      checked={soundEnabled}
                      onChange={(e) => {
                        setSoundEnabled(e.target.checked);
                        setNotificationSoundEnabled(e.target.checked);
                      }}
                    />
                    Notification sound
                  </label>
                  <span className="settings-notification-hint">Play a ding when a session needs attention</span>
                </div>

                <div className="settings-notification-row">
                  <label className="settings-notification-label">
                    <input
                      type="checkbox"
                      checked={browserNotifEnabled}
                      onChange={(e) => {
                        setBrowserNotifEnabled(e.target.checked);
                        setBrowserNotificationsEnabled(e.target.checked);
                        if (e.target.checked && notifPermission === "default") {
                          requestNotificationPermission().then(setNotifPermission);
                        }
                      }}
                    />
                    Browser notifications
                  </label>
                  <span className="settings-notification-hint">
                    {notifPermission === "granted"
                      ? "Desktop notifications enabled"
                      : notifPermission === "denied"
                        ? "Notifications blocked by browser — check site permissions"
                        : "Will request permission when enabled"}
                  </span>
                  {browserNotifEnabled && notifPermission === "default" && (
                    <button
                      className="settings-btn edit"
                      onClick={() => requestNotificationPermission().then(setNotifPermission)}
                    >
                      Request Permission
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
