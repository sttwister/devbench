# Bundled skills

The `git-commit-and-push` skill exists in two locations that must stay in sync:

- **User-installed copy**: `~/.claude/skills/git-commit-and-push/SKILL.md` (and `~/.codex/skills/` for Codex)
- **Bundled copy**: `server/extensions/skills/git-commit-and-push/SKILL.md`

When editing either copy, **always update the other** so they remain identical. The bundled copy is what gets deployed to new users on install/update.

After updating the bundled skill, **bump the hook version** in `server/extensions/claude-hook.js` and/or `server/extensions/codex-hook.js` (the `// devbench-hook vN` comment). The extension manager tracks versions via these comments — without a bump, existing users won't see the "update available" indicator and won't get the new skill.
