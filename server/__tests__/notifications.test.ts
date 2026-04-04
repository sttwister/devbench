// @lat: [[tests#Notifications#Notification Lifecycle]]
import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase } from "../db.ts";

describe("Notifications", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    db = createDatabase(":memory:");
    db.addProject("test-project", "/tmp/test");
  });

  function addActiveSession(name = "test-session", type: "claude" | "pi" | "codex" | "terminal" = "claude") {
    return db.addSession(1, name, type, `devbench_1_${Date.now()}_${Math.random()}`);
  }

  it("setSessionNotified sets notified_at for a session", () => {
    const session = addActiveSession();
    expect(session.notified_at).toBeNull();

    const changed = db.setSessionNotified(session.id);
    expect(changed).toBe(true);

    const updated = db.getSession(session.id)!;
    expect(updated.notified_at).not.toBeNull();
  });

  it("setSessionNotified is a no-op if already notified", () => {
    const session = addActiveSession();
    db.setSessionNotified(session.id);

    const first = db.getSession(session.id)!;
    // Second call should not change the timestamp
    const changed = db.setSessionNotified(session.id);
    expect(changed).toBe(false);

    const second = db.getSession(session.id)!;
    expect(second.notified_at).toBe(first.notified_at);
  });

  it("clearSessionNotified clears the notification", () => {
    const session = addActiveSession();
    db.setSessionNotified(session.id);
    expect(db.getSession(session.id)!.notified_at).not.toBeNull();

    db.clearSessionNotified(session.id);
    expect(db.getSession(session.id)!.notified_at).toBeNull();
  });

  it("getNotifiedSessionIds returns only active sessions with notifications", () => {
    const s1 = addActiveSession("s1");
    const s2 = addActiveSession("s2");
    const s3 = addActiveSession("s3");

    db.setSessionNotified(s1.id);
    db.setSessionNotified(s2.id);
    // s3 is not notified

    const ids = db.getNotifiedSessionIds();
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);
    expect(ids).not.toContain(s3.id);
  });

  it("getNotifiedSessionIds excludes archived sessions", () => {
    const session = addActiveSession();
    db.setSessionNotified(session.id);
    db.archiveSession(session.id);

    const ids = db.getNotifiedSessionIds();
    expect(ids).not.toContain(session.id);
  });

  it("re-notification works after clear cycle", () => {
    const session = addActiveSession();

    // First notification
    db.setSessionNotified(session.id);
    expect(db.getNotifiedSessionIds()).toContain(session.id);

    // User views session → clear
    db.clearSessionNotified(session.id);
    expect(db.getNotifiedSessionIds()).not.toContain(session.id);

    // Agent finishes again → re-notify
    const changed = db.setSessionNotified(session.id);
    expect(changed).toBe(true);
    expect(db.getNotifiedSessionIds()).toContain(session.id);
  });

  it("deleting a session removes its notification", () => {
    const session = addActiveSession();
    db.setSessionNotified(session.id);
    expect(db.getNotifiedSessionIds()).toContain(session.id);

    db.removeSession(session.id);
    expect(db.getNotifiedSessionIds()).not.toContain(session.id);
  });
});
