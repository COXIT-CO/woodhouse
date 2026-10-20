<!--
Sync Impact Report
- Version change: (none, initial) → 1.0.0
- Modified principles: none (initial ratification)
- Added sections: Core Principles (5), Additional Constraints, Development Workflow, Governance
- Removed sections: none
- Follow-up TODOs: TODO(RATIFICATION_DATE) — original project inception date not recorded; using
  first commit date as a proxy is inaccurate, left as TODO pending user confirmation.
-->
# Woodhouse Constitution

## Core Principles

### I. Zero-Dependency Bias
The project ships with zero runtime dependencies and a minimal devDependency set
(`esbuild`, `typescript`, `@types/chrome`, `@types/node`). New dependencies — runtime or dev —
MUST NOT be added without strong justification recorded in the change's plan (why an existing
dependency or a small amount of hand-written code cannot serve instead). Rationale: the extension's
small footprint and store-review posture depend on staying dependency-light.

### II. No Framework
The panel UI is vanilla TypeScript/DOM built on a hand-rolled hyperscript helper
(`src/panel/dom.ts`). React, Vue, or any other UI framework MUST NOT be introduced, regardless of
what `docs/ARCHITECTURE.md`'s aspirational tech-stack section describes. Rationale: the current
implementation deliberately diverged from that early design doc toward a minimal, dependency-free
build; treat the doc as stale, not as a mandate.

### III. Local-Only Processing (NON-NEGOTIABLE)
No feature MAY cause network egress of captured traffic, console data, or analysis results, and no
telemetry MAY be added. All analysis MUST run locally (in-page, service worker, or the analysis Web
Worker). Rationale: "nothing ever leaves your browser" is the project's core privacy promise, stated
in the README, the manifest description, and `docs/ARCHITECTURE.md` — violating it undermines the
product's reason to exist.

### IV. Match Existing House Style
New and modified code MUST follow the conventions documented in `CLAUDE.md`: no classes, `unknown`
over `any`, string-literal unions instead of enums, no `throw`/custom Error classes (failures become
fallback values or `Finding` objects), SCREAMING_SNAKE_CASE tunables, capped collections for anything
that can grow unboundedly, section-banner comments for long functions, and terse comments only where
behavior isn't obvious from naming. Rationale: consistency keeps a single-author-style codebase
readable; deviating creates visible seams.

### V. Minimal Chrome Permissions
The manifest's `permissions` MUST stay minimal (`storage` today) and `host_permissions` MUST stay
scoped no more broadly than currently required. Any new permission requires explicit justification
in the feature's plan, weighed against Chrome Web Store review friction. Rationale: minimal
permissions are both a privacy commitment and a store-approval risk mitigation, per
`docs/OPEN-QUESTIONS.md` and `docs/PLAN.md`'s risk table.

## Additional Constraints

- No test framework is adopted beyond the existing hand-rolled `node:assert/strict` runner in
  `tests/analysis.test.ts`; new pure-function analysis logic SHOULD gain fixture-based tests there,
  but UI/panel-layer code is not required to have automated tests, matching current project scope.
- No linter/formatter config exists; formatting (2-space indent, double quotes, semicolons) is
  hand-maintained and MUST be matched by inspection, not by adding tooling as a side effect of an
  unrelated feature.
- Build output (`dist/`, `dist-tests/`) is checked into git by existing convention; new build steps
  MUST NOT change this without a separate, explicit decision.

## Development Workflow

- Features proceed through the Spec Kit flow: `/speckit-specify` → `/speckit-plan` →
  `/speckit-tasks` → `/speckit-implement`, with `/speckit-clarify`, `/speckit-analyze`, and
  `/speckit-checklist` available as optional quality gates.
- Each plan MUST name the concrete files it will touch and confirm those changes are consistent
  with Principles I–V above before implementation begins.
- Constitution compliance is a plan-time check, not a post-hoc one: `/speckit-plan` MUST reject or
  flag any approach that violates a Core Principle rather than deferring the conflict to review.

## Governance

This constitution supersedes ad-hoc practice for any work done through the Spec Kit workflow.
Amendments require: (1) a documented reason, (2) an explicit version bump per the rules below, and
(3) update of this file in the same change that motivated the amendment — no silent drift.

Versioning policy (semantic):
- MAJOR: backward-incompatible principle removal or redefinition.
- MINOR: new principle or materially expanded guidance.
- PATCH: clarification, wording, or non-semantic fixes.

All Spec Kit-driven plans and implementations MUST verify compliance with this constitution before
proceeding; complexity or deviation must be justified in the plan, not assumed acceptable.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): confirm original project start date | **Last Amended**: 2026-09-05
