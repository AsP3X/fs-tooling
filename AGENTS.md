# Agent notes

Binding project rules live in [`.cursor/rules/`](.cursor/rules/). Treat them as requirements.

| Rule | Summary |
|------|---------|
| [`agent.mdc`](.cursor/rules/agent.mdc) | Follow the other rules; no live-tenant attacks |
| [`git-commits.mdc`](.cursor/rules/git-commits.mdc) | Commit/push only on explicit request; `TASK:`/`FIX:`/`BUGFIX:`/`DOCS:`/`CHORE:` |
| [`inline-documentation.mdc`](.cursor/rules/inline-documentation.mdc) | Comment non-trivial TypeScript; `// Human:` / `// Agent:` when useful |
| [`plan-execution.mdc`](.cursor/rules/plan-execution.mdc) | Plans are checklists; verify with `npm run check` |
| [`regression-testing.mdc`](.cursor/rules/regression-testing.mdc) | Preserve match/parse/storage contracts; add tests in the blast radius |
| [`project-layout.mdc`](.cursor/rules/project-layout.mdc) | `src/` is the source of truth; do not edit `dist/` |

Contributor workflow: [CONTRIBUTING.md](CONTRIBUTING.md) · [Local development](docs/local-development.md) · [Architecture](docs/architecture.md).
