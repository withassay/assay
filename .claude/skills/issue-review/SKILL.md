---
name: issue-review
description: Review a GitHub issue by number. Fetches the issue, analyzes scope, maps dependencies to current codebase state, and produces an implementation plan.
user-invocable: true
---

# Issue Review: #$ARGUMENTS

Review GitHub issue #$ARGUMENTS and produce a structured implementation plan.

## Step 1: Fetch the Issue

```bash
gh issue view $ARGUMENTS
```

Capture: title, labels, body (scope, acceptance criteria, dependencies, out of scope).

## Step 2: Check Dependencies

For each issue listed under **Dependencies**:

```bash
gh issue view <dep-number>
```

Determine if each dependency is closed (merged) or still open. Flag any open blockers.

## Step 3: Assess Current Codebase

Read the relevant source files to understand what exists today. Map acceptance criteria to what's already built vs what needs to be created.

## Step 4: Produce the Review

Output a structured review with these sections:

### Status

- Issue state (open/closed) and labels
- Dependency status: which are merged, which are blocking

### Scope Summary

- One-paragraph summary of what this issue delivers
- Key behaviors and constraints

### Acceptance Criteria Breakdown

For each acceptance criterion:

- **Criterion**: the requirement
- **Status**: not started / partially done / done
- **Approach**: how to implement it (files to create/modify, key decisions)
- **Complexity**: low / medium / high

### Open Questions

Anything ambiguous, underspecified, or worth discussing before implementation.

### Suggested Implementation Order

Numbered list of steps, ordered by dependency chain and complexity. Group into logical commits.
