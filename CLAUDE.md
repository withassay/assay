# Assay — Project Conventions

## What This Is

Open-source proof system for AI agents. SDK + CLI + GitHub Action that makes agent quality measurable, improvable, and transferable.

## Build Commands

```bash
npm run build       # Compile TypeScript to dist/
npm run lint        # ESLint check
npm run format      # Prettier check
npm run format:fix  # Prettier auto-fix
npm run typecheck   # Type check without emitting
npm test            # Run tests (Vitest)
npm run test:watch  # Run tests in watch mode
```

## Architecture

```
src/
  cli/           # CLI entry point (assay eval, assay report)
  schema/        # Agent proof, eval case, and proof result schemas
  grading/       # Three-layer grading: deterministic → heuristic → LLM-judge
  confidence/    # Confidence scoring and 5-tier maturity system
  report/        # Proof report generation
  index.ts       # Package exports
```

## Code Standards

- Strict TypeScript — no `any`, explicit return types, `noUncheckedIndexedAccess` enabled
- ESM-only (`"type": "module"` in package.json)
- Import paths must include `.js` extension (Node16 module resolution)
- All functions must have explicit error handling
- Tests colocated with source: `foo.ts` → `foo.test.ts`

## Conventions

- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`
- PR branches: `<type>/<issue-number>-<short-description>` (e.g., `feat/2-schemas`)
- One PR per issue unless issues are explicitly bundled
- Code review + security review required before merge

## Key Design Decisions

- **Invoke is a union type:** agent config specifies exactly one of `command` (subprocess) or `http` — never both
- **Known gaps are required:** every agent definition must declare what it does NOT check
- **Three-layer grading:** deterministic (fast/cheap) → heuristic (structural) → LLM-judge (semantic). Cases can use any combination.
- **Confidence is computed, never manual:** derived from eval results, case count, and variance
