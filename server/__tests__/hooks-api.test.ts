import { describe, it, expect } from "vitest";
import { createDatabase } from "../db.ts";

// @lat: [[tests#Hook API]]

/**
 * Tests for the hook API infrastructure: database has_changes tracking,
 * agent-status hook integration, and auto-rename hook integration.
 */
describe("Hook API infrastructure", () => {
  // @lat: [[tests#Hook API#Has Changes Tracking]]
  describe("has_changes tracking", () => {
    it("defaults to false for new sessions", () => {
      const db = createDatabase(":memory:");
      const p = db.addProject("proj", "/tmp/proj");
      const s = db.addSession(p.id, "s1", "claude", "t1");
      expect(s.has_changes).toBe(false);
    });

    it("sets and clears has_changes", () => {
      const db = createDatabase(":memory:");
      const p = db.addProject("proj", "/tmp/proj");
      const s = db.addSession(p.id, "s1", "claude", "t1");

      db.setSessionHasChanges(s.id);
      expect(db.getSession(s.id)!.has_changes).toBe(true);

      db.clearSessionHasChanges(s.id);
      expect(db.getSession(s.id)!.has_changes).toBe(false);
    });

    it("setSessionHasChanges is idempotent", () => {
      const db = createDatabase(":memory:");
      const p = db.addProject("proj", "/tmp/proj");
      const s = db.addSession(p.id, "s1", "claude", "t1");

      db.setSessionHasChanges(s.id);
      db.setSessionHasChanges(s.id);
      expect(db.getSession(s.id)!.has_changes).toBe(true);
    });
  });
});
