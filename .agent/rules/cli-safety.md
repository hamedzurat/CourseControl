---
trigger: always_on
---

# CLI Safety Rules

## Goal

Ensure safe execution of shell commands and prevent accidental data loss during agent operations.

## Constraints

- **NEVER** use the `rm` command for deleting files or directories.
- **NEVER** execute destructive commands without verifying the path first.

## Instructions

- When you need to delete a file or directory, you **MUST** use `trash-cli` (or the `trash` command) instead of `rm`.
- If `trash-cli` is not installed or available, stop and request the user to install it; do not fallback to `rm` silently.
- Always use the safe version of commands where possible.
