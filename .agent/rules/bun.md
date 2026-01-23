---
trigger: always_on
---

# Package Manager & Runtime Rules

## Goal

Enforce the use of Bun as the exclusive package manager and runtime for this project.

## Constraints

- **NEVER** use `npm`, `yarn`, or `pnpm` commands.
- **NEVER** generate `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.
- **NEVER** suggest installing Node.js if Bun can handle the runtime requirement.

## Instructions

- **Installation:** Always use `bun install`.
- **Adding Packages:** Use `bun add <package>` (or `bun add -d` for dev dependencies).
- **Scripts:** Use `bun run <script>`.
- **Execution:** Prefer running TypeScript/JavaScript files directly with `bun <file>` instead of `node <file>` or `ts-node`.
- **Testing:** Use `bun test` instead of `jest` or `vitest` unless the project configuration explicitly dictates otherwise.
- If you see a `package-lock.json` file, ignore it and warn the user that this project uses `bun.lockb`.
