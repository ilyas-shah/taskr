# taskr — project constitution

## What this is
A Node.js CLI task manager. Commands: add, list, done, delete, search.
Storage: SQLite via node:sqlite built-in. DB file: taskr.db in the project root (overridable with TASKR_DB_PATH env var for tests). MCP tooling connects to the same file via .mcp.json.

## Tech rules
- Node.js with no external dependencies (built-ins only)
- One file per command in src/commands/
- Entry point: src/index.js
- Tests in tests/ using Node's built-in test runner (node:test)

## Code style
- ESM modules (import/export)
- Async/await, no callbacks
- Descriptive variable names — no single-letter variables outside loops

## Agent rules
- Always run  after any structural change to verify it boots
- Never modify tests/ without being asked — that's the QA agent's domain
- After writing code, summarise what changed in 3 bullet points max

## Standard feature pipeline
Every new feature follows this chain — do not skip steps:
1. @planner   — produce the implementation plan
2. @coder     — implement per the plan
3. @qa-tester — write and run tests
4. @pr-reviewer — review code + tests, must output PASS before we ship
