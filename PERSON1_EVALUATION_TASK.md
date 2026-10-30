# Person 1 Evaluation Task

> **CRITICAL RULE:** Do NOT edit, modify, rewrite, or alter any part of this Markdown document, the evaluation rubric (`EVALUATION.md`), or the assigned PRPs during the evaluation process. Record discrepancies as findings only; do not change the underlying criteria.

## Task Scope

Evaluate these assigned Product Requirement Prompts (PRPs):

- [PRP 01 - Todo CRUD Operations](PRPs/01-todo-crud-operations.md)
- [PRP 02 - Priority System](PRPs/02-priority-system.md)
- [PRP 10 - Calendar View](PRPs/10-calendar-view.md)

Use [EVALUATION.md](EVALUATION.md) as the evaluation rubric and [ASSIGNMENTS.md](ASSIGNMENTS.md) for ownership and reporting expectations. This is an evaluation task, not an implementation task: inspect the repository, run relevant existing tests, execute self-test/verification routines, and report findings. Do not modify application code or change requirements while evaluating.

---

## Task Execution Instructions

Complete the following three stages in order. Do not skip a stage. At each stage gate, present the requested output and wait for confirmation before proceeding.

### STAGE 1: SCOPE, DEPENDENCIES, AND REVIEW PLAN

Before evaluating implementation:

- Read `EVALUATION.md`, all three assigned PRPs, and any directly relevant dependency requirements.
- Identify the implementation files, API routes, database/schema code, UI components, and **unit/integration/E2E test suites** that cover the assigned features.
- Respect the stated dependency order: PRP 01 is the foundation for PRP 02 and PRP 10; PRP 02 defines the priority behavior and colors used by PRP 10. Check PRP 08 only where priority-filter behavior or combined filters affect PRP 02. Check PRP 11 only for calendar route protection and authentication test setup.
- List the feature requirements, edge cases, and the **specific self-test commands or test suites** you will run to verify functionality. Identify any likely blockers such as missing unit tests or unavailable external services.
- Use `EVALUATION.md` as the authoritative evaluation baseline. The PRPs provide detailed requirements and context, but they do not override the evaluation checklist. If they conflict, evaluate against `EVALUATION.md`, record the discrepancy in the findings, and **do not edit the rubric**. In particular, the rubric requires a delete confirmation dialog while PRP 01 says deletion has no confirmation dialog; assess this item against the rubric requirement and note the PRP conflict.

**Stage 1 deliverable:** A concise review plan with files to inspect, **unit/self-test commands to run**, dependencies, and known ambiguities.

**STOP:** Present the plan and wait for approval before starting Stage 2.

---

### STAGE 2: EVIDENCE-BASED FEATURE EVALUATION & SELF-TESTING

After the plan is approved, evaluate the existing implementation against both the feature-specific checklist and acceptance criteria in `EVALUATION.md` and the detailed user flows, technical requirements, edge cases, testing requirements, and acceptance criteria in each assigned PRP.

For each feature, review the applicable areas below, run the necessary self-tests, and record concrete evidence (file paths, symbols, **unit test execution results**, or reproducible behavior):

#### PRP 01: Todo CRUD Operations
- Database fields, defaults, indexes, ownership scoping, and cascade behavior for subtasks/tag links.
- Create/list/read-one/update/delete API behavior, authentication and ownership checks, request validation, and error responses.
- Required trimmed title and due-date validation, including the minimum one-minute future rule and Singapore timezone handling.
- Create/edit UI, Overdue/Pending/Completed sections, counts, completion toggle, edit cancellation, deletion, and optimistic update rollback on failure.
- Sorting and re-sectioning after creation, edits, and completion changes.
- **Self-Test & Automated Coverage:** Execute and document outcomes for CRUD unit tests, validation failure checks, and E2E test runs.

#### PRP 02: Priority System
- Three allowed priority values, database non-null/default behavior, and API validation for create and update.
- Priority badges, create/edit controls, accessible light/dark color contrast, filtering, and immediate re-sorting after edits.
- Sorting by priority and due date for Overdue/Pending items, creation-date tie-breaking, and the specified Completed-section behavior.
- Interaction with combined filters and recurring-todo inheritance where relevant; record cross-PRP dependencies for the relevant owner.
- **Self-Test & Automated Coverage:** Execute contrast validation tests, filter integration checks, and the performance unit test suite (including the stated 500-todo sorting performance target).

#### PRP 10: Calendar View
- Protected `/calendar` route, current Singapore month default, valid/invalid `?month=YYYY-MM` handling, and URL updates for navigation.
- Fixed 6-by-7 grid, day headers, today/weekend/past styling, and previous/next/today navigation.
- Correct Singapore-local placement of due-dated todos, priority colors, overflow behavior, holiday data/schema/API/seeding, and day-detail modal.
- Timezone boundaries, leap-year February, invalid month values, holidays sharing a date with todos, and undated todos.
- **Self-Test & Automated Coverage:** Execute calendar grid generation unit tests, holiday seeding verification, modal interaction tests, and unauthenticated route protection checks.

For every checklist item, use one of these statuses:
- `Verified`: implementation evidence and a **passing unit/self-test check** support the requirement.
- `Implemented, unverified`: implementation appears present, but no adequate test was run or available.
- `Partial`: only part of the requirement is implemented or verified.
- `Missing`: no supporting implementation or test was found.
- `Blocked`: evaluation was prevented by an environmental or dependency issue; explain it.
- `Ambiguous`: the rubric and PRP conflict or the requirement cannot be interpreted consistently; do not score it until resolved.

Do not mark an item verified based only on code presence when behavior can be tested. Run relevant checks, report exact command outputs, and distinguish a product defect from a missing unit test or an environment blocker. Do not make implementation changes or alter this evaluation file to get a test to pass.

**Stage 2 deliverable:** A completed evidence checklist for each of the three PRPs, including **unit test outcomes and self-test verification logs**, with findings and unresolved questions recorded.

**STOP:** Present the per-feature results and wait for approval before calculating scores and finalizing Stage 3.

---

### STAGE 3: SCORE, CROSS-CHECK, AND FINAL REPORT

- Assign each assigned feature the score specified by `EVALUATION.md`: