---
name: git-commit-and-push
description: Use when the user says "/git-commit-and-push" or asks to commit and push current git changes. Commits on a feature branch and pushes to remote, presenting the MR/PR creation link from the push output. Handles multiple repositories when changes span backend and frontend.
---

# Git Commit and Push

Commit current git changes on a feature branch and push to remote. Supports multi-repo sessions.

## Step 0 — Detect Version Control Backend

For each affected repo, check if GitButler is initialized:

```bash
but status --json 2>/dev/null
```

- If this succeeds (exit 0 and returns JSON), use the **GitButler workflow** below.
- If it fails or `but` is not installed, use the **Standard Git workflow**.

---

## GitButler Workflow

Uses `but` for all operations — committing, pushing, and PR/MR creation. Never mix in `git` write commands or `glab`/`gh` CLI tools.

### 1. Identify affected repositories

Run `but status --json` in every working directory from the current session. A repo is "affected" if it has `unassignedChanges` or uncommitted changes in stacks.

### 2. Commit changes

For **each** affected repo:

a. Run `but status --json` to get change IDs and existing stacks/branches.
b. Review changes: check `unassignedChanges` and any stack changes to understand what changed.
c. **Determine the branch to use:**
   - If a suggested branch name was given (e.g. `use branch name feature/foo`), use it.
   - If `stacked on <old-branch>` was also given, the new branch must be created **on top of** the old one (see step d).
   - If no suitable branch exists in `but status --json`: create one with `but branch new <descriptive-name>`.
   - If a suitable branch already exists (present in `but status --json`): use its ID from the status output.
d. **If stacking is required** (`stacked on <old-branch>` hint was given):
   After creating the new branch, immediately stack it on the old one:
   ```bash
   but branch move <new-branch> <old-branch>
   ```
   Then re-run `but status --json` to get fresh IDs before committing.
e. Commit with explicit change IDs:
   - **New branch** (just created with `but branch new`): use `-c` to create-and-commit in one step:
     ```bash
     but commit <branch> -c -m "<message>" --changes <id1>,<id2> --json --status-after
     ```
   - **Existing branch** (already has commits / an open MR): do **NOT** use `-c` — that would recreate the branch head and rewrite history, forcing a force-push:
     ```bash
     but commit <branch> -m "<message>" --changes <id1>,<id2> --json --status-after
     ```
   The `--status-after` output has fresh IDs — no need for a redundant `but status`.

### 3. Push and create PR/MR

For **each** committed repo:

a. Check if a PR/MR already exists:
   ```bash
   but branch show <branch> --review --json
   ```
   Inspect the `reviews` array in the output.

   - **PR/MR already exists and is open** (no `mergedAt`): push the new commit(s) with a normal push — do **not** force-push:
     ```bash
     but push <branch>
     ```
     Note the existing PR/MR URL from the `reviews` array and present it to the user.

   - **PR/MR already exists but is merged** (has `mergedAt`): the previous PR was completed but the session continued with new work. Push first, then create a **new** PR via the forge CLI since `but pr new` will refuse to create a duplicate:
     ```bash
     but push <branch>
     gh pr create --base master --head <branch> --title "<commit title>" --body "<commit body>"
     ```
     For GitLab, use `glab mr create --fill --yes --source-branch <branch> --target-branch develop --remove-source-branch --squash-before-merge` instead.
     This is the one exception to the "never use gh/glab in GitButler repos" rule.
     After the MR is created, force-enable "Delete source branch" and "Squash commits" via the API (same steps as in section 3b below).

b. **If no PR/MR exists**, create one:
   ```bash
   but pr new <branch> -t --json --status-after
   ```
   `-t` uses the commit message as the default title/description, skipping interactive prompts. This command handles both the push and PR/MR creation in one step. The target branch is determined by the project's GitButler target config (`but config target`).

   **Note:** If forge auth is not configured, `but pr new` will fail. In that case, fall back to pushing with `but push <branch>` and inform the user to run `but config forge auth` to enable PR creation, or create the PR manually on the forge.

   **After a successful MR creation on GitLab**, enable "Delete source branch" and "Squash commits" on the MR.
   The `glab mr update` flags `--remove-source-branch` and `--squash-before-merge` **toggle** those settings, so instead use the GitLab REST API directly to force them `true` regardless of their current state.

   **Important:** Always extract the MR IID fresh from `glab mr list` in the correct repo directory. Never reuse an MR IID from a previous repo — MR numbers are project-scoped and differ between repos. Run the list and update as **separate** bash tool calls, not combined with `;`:
   ```bash
   # Step 1: Get the MR IID (run from the correct repo directory)
   glab mr list --source-branch=<branch> 2>&1 | tail -5
   ```
   Parse the MR IID (the number after `!`) from the output, then:
   ```bash
   # Step 2: Update squash settings (filter output to avoid leaking full JSON)
   glab api --method PUT "projects/:id/merge_requests/$MR_IID" \
     --field squash=true --field remove_source_branch=true 2>&1 \
     | grep -oE '"(squash|force_remove_source_branch)":[^,}]+'
   ```

### 4. Present results

Present all PR/MR links to the user, clearly labeled by repo.

### GitButler Rules

- Use CLI IDs from `but status --json` output; never hardcode IDs.
- Use `--changes` with comma-separated file/hunk IDs: `--changes a1,b2`.
- Always add `--json --status-after` to mutation commands.
- Use `but push` (not `git push`) for pushing.
- Never use `glab` or `gh` in GitButler repos — use `but pr` instead.

---

## Standard Git Workflow

For repos where GitButler is not initialized. Uses standard `git` + `glab`/`gh`.

### 1. Identify affected repositories

Check `git status` in every working directory from the current session. A repo is "affected" if it has staged or unstaged changes.

### 2. Commit changes

For **each** affected repo:

- Run `git status` and `git diff` to understand changes.
- Check current branch. **Refuse to commit on `develop` or `master`** — suggest a feature branch and confirm with user first.
- Stage relevant files and create a commit with a message relevant to that repo's changes.

### 3. Push and create PR/MR

For **each** committed repo:

a. Push the branch:
   ```bash
   git push -u origin <branch-name>
   ```

b. Check if an MR already exists:
   ```bash
   glab mr list --source-branch=<branch-name>
   ```
   Parse the text output (`glab mr list` has no `--output json` flag).

c. If no existing MR found, create one:
   ```bash
   glab mr create --fill --yes --source-branch <branch-name> --target-branch develop --remove-source-branch --squash-before-merge
   ```

   **After a successful MR creation on GitLab**, enable "Delete source branch" and "Squash commits" on the MR.
   The `glab mr create` flags `--remove-source-branch` and `--squash-before-merge` are unreliable (they may toggle instead of force-enable), so use the GitLab REST API directly to force them `true`.

   **Important:** Extract the MR IID fresh from `glab mr list` in the correct repo directory. Run the list and update as **separate** bash tool calls:
   ```bash
   # Step 1: Get the MR IID (run from the correct repo directory)
   glab mr list --source-branch=<branch-name> 2>&1 | tail -5
   ```
   Parse the MR IID (the number after `!`) from the output, then:
   ```bash
   # Step 2: Update squash settings (filter output to avoid leaking full JSON)
   glab api --method PUT "projects/:id/merge_requests/$MR_IID" \
     --field squash=true --field remove_source_branch=true 2>&1 \
     | grep -oE '"(squash|force_remove_source_branch)":[^,}]+'
   ```

### 4. Present results

Present all MR links to the user, clearly labeled by repo.

---

## General Rules

- **Always `cd` into each repo's directory** before running any `but`, `git`, `glab`, or `gh` commands for that repo. Many CLI tools (especially `glab api` with `projects/:id`) resolve the project from the git remote in the current working directory. When a session spans multiple repos, running commands from the wrong directory will target the wrong project.
- **Multi-repo isolation**: When working across multiple repos, **never carry over IDs, branch names, or MR numbers from one repo to another**. MR IIDs are project-scoped — MR !384 in repo A is a completely different MR from !384 in repo B. Always extract identifiers fresh from CLI output for each repo. Process each repo's commit → push → MR creation → MR update steps fully before moving to the next repo.
- **Separate bash calls per operation**: Don't chain unrelated commands with `;` in a single bash call, especially across repos. Each logical step (list MRs, update MR settings, etc.) should be its own bash tool call so errors are visible and IDs aren't mixed up.
- **NEVER commit or push directly on `develop` or `master`.**
- **Branch naming**: Always use `feature/` prefix with a descriptive name: `feature/add-user-auth`, `feature/fix-logout-hang`. Never use `fix/`, `bugfix/`, or other prefixes — always `feature/`.
- Each repo gets its own commit with a message relevant to the changes in that repo.
- Present a clear summary at the end: which repos were committed/pushed, with their PR/MR links.
