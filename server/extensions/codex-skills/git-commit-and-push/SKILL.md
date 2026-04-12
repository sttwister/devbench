---
name: git-commit-and-push
version: 1
description: "Commit current changes on a feature branch, push them, and create or reuse a merge request. Use when devbench invokes $git-commit-and-push or when the user asks to commit and push work."
---

# Git Commit and Push

Commit the current work on a feature branch, push it, and create or reuse the review link.

## Invocation Hints

Devbench may append structured hints to the skill invocation. Treat them as authoritative when present.

- `use branch name <branch>`: use that branch name exactly
- `stacked on <branch>`: when using GitButler, stack the target branch on that base branch before committing if needed
- `Commit message: <message>`: use that exact commit message when provided

## Step 0: Detect the backend

Run this in the current repo:

```bash
but status --json 2>/dev/null
```

- If it succeeds and returns JSON, use the GitButler workflow below.
- Otherwise, use the standard git workflow.

## GitButler Workflow

1. Run `but status --json` and inspect the current stacks, branches, and unassigned changes.
2. Prefer the explicit branch name from the invocation. If none was supplied, reuse the branch that already owns the current work; otherwise create a descriptive `feature/...` branch.
3. If the invocation includes `stacked on <branch>`, stack the target branch with `but branch move <target-branch> <base-branch>` before committing when that relationship is not already in place.
4. Commit only the relevant change IDs with:

```bash
but commit <branch> -c -m "<message>" --changes <id1>,<id2> --json --status-after
```

Drop `-c` when the branch already exists.

5. Push the target branch with `but push <branch-id-or-name>`.
6. Check whether an MR already exists for that branch:

```bash
glab mr list --source-branch=<branch-name>
```

7. If no MR exists, create one with:

```bash
glab mr create --fill --yes --source-branch <branch-name> --target-branch develop --remove-source-branch --squash-before-merge
```

8. After `glab mr create`, immediately run `but push <branch-id-or-name>` again. `glab` may push `gitbutler/workspace` as `HEAD`, so the follow-up `but push` restores the correct single-branch history.
9. Present the branch and MR link to the user.

## Standard Git Workflow

1. Run `git status --short` and inspect the diff.
2. Prefer the explicit branch name from the invocation. Never commit directly on `develop`, `master`, or `main`. If you are on one of those branches, create or switch to the requested feature branch first.
3. Stage the relevant files, create a commit with the requested message (or a concise diff-based message when none was provided), and push with:

```bash
git push -u origin <branch-name>
```

4. Check for an existing MR with:

```bash
glab mr list --source-branch=<branch-name>
```

5. If none exists, create one with:

```bash
glab mr create --fill --yes --source-branch <branch-name> --target-branch develop --remove-source-branch --squash-before-merge
```

6. Present the branch and MR link to the user.

## Rules

- Stop and say so if there are no changes to commit.
- Use the explicit branch name from devbench instead of inventing a new one when it is provided.
- Keep one commit/push/MR flow per affected repo and report each result clearly.
- Do not commit unrelated changes just because they are present in the workspace.
