# Todo App - Feature Completeness Evaluation

This document provides a comprehensive checklist for evaluating the completeness of the Todo App implementation, including all core features, testing, and deployment to cloud platforms.

## Person 4: Implementation Verification

**Verified:** 2026-10-30. **Scope:** PRPs 06 (tags) and 08 (search/filtering). The Person 4 acceptance flows pass in the current implementation: 13 Person 4 unit tests and 38 desktop/mobile Playwright cases (all 21 shared unit tests also pass). This does not mark other owners' application features or production deployment complete.

- **Search contract resolved:** PRP 08 explicitly excludes tag-name text search. Search covers todo/subtask titles; tags have their own composable filter. Feature 08 below now follows that contract instead of the older conflicting tag-name search checklist.
- **Contrast contract resolved:** Custom tag colors use black or white text for AA contrast. Always-white text cannot meet AA on arbitrary pale colors. Browser tests check representative colors in both themes.
- **Edit integration delivered:** `tagDB.replaceForTodo(todoId, tagIds, userId)` atomically validates ownership and replaces associations, deduplicates IDs, supports an empty selection, and participates in the caller's transaction. The full todo-update handler now uses it, and the full task editor supports multi-select tags, cancellation and clearing all tags. The independent Task tags dialog remains available.
- **Optimistic integration verified:** Pending creation and full-task edits use the selected tag objects, so tag-filter results reflect the optimistic state. Delayed creation stays visible under its tag filter; failure rolls back the row and retains the selected tags/title for retry.
- **Import integration delivered:** `tagDB.findByName(name, userId)` and `findOrCreateByName(userId, input)` use trimmed names and SQLite NOCASE matching. Resolution returns `{ tag, created }`, preserves an existing tag's color, and rolls back with an outer import transaction. This is the tag contract for Person 5, not a claim that import itself exists.
- **Subtask/template integration delivered:** After a successful mutation, dispatch `window.dispatchEvent(new Event('todo-app:todos-changed'))` from client code. The workspace refetches nested todos and reapplies filters; tests cover renamed/deleted checklist items and newly created checklist-bearing tasks without implementing Person 3's endpoints.
- **Performance evidence:** All-filter recomputation over 1000 todos passes the under-100ms unit gate; warmed tag CRUD requests pass the under-300ms average gate. Cold Next.js compilation is excluded from that steady-state API metric.
- **Review outcome:** User flows, validation, ownership, failure recovery, empty/deleted-tag states, storage errors, accessibility, and cross-owner contracts are reviewed and covered. No standalone Person 4 implementation task remains; consuming these contracts in the other owners' features remains their integration work.

## Person 3: PRP Review

**Reviewed:** 2026-10-30. **Scope:** [PRP 05 - Subtasks & Progress Tracking](PRPs/05-subtasks-progress.md) and [PRP 07 - Template System](PRPs/07-template-system.md), as assigned in [ASSIGNMENTS.md](ASSIGNMENTS.md).

**Result:** Both PRPs have useful user flows and acceptance criteria, but need the clarifications below before implementation. This is a requirements review, not verification of working software: this repository has no application source, database, or executable tests. Existing implementation checkboxes remain unchanged.

### PRP 05: Subtasks & Progress Tracking

**User flows:** Adding, toggling, deleting, expanding/collapsing, and parent deletion are described. Independence between parent and checklist completion is explicit. The API supports renaming, but there is no rename interaction or acceptance test; decide whether renaming belongs in v1.

**Technical requirements and findings:**

| ID | Priority | Finding and Evidence | Recommended Resolution / Discriminating Check |
|---|---|---|---|
| P3-05-01 | High | In PRP 05's API examples, PUT only comments on ownership and DELETE performs no ownership lookup. The declared `subtaskDB.update/delete` signatures also take no user ID. The prose requires authorization, but copying these examples would not enforce it. | Specify the actual subtask-to-todo ownership lookup or user-scoped mutation contract. For each POST/PUT/DELETE route, test unauthenticated 401, foreign-owned/missing resource 404, and no database changes after rejection. |
| P3-05-02 | High | POST calls `title.trim()` without checking its runtime type; PUT forwards arbitrary JSON to the database helper without demonstrating the required blank-title rejection. Non-boolean completion values, malformed JSON, and invalid path IDs have no defined handling. | Define runtime schemas, allowed update fields, positive integer IDs, and consistent 400 responses. Test null, arrays, numeric titles, whitespace, invalid completion values, and empty updates. |
| P3-05-03 | Medium | The edge cases require optimistic toggles, while the UI examples wait for fetch and refresh. They do not inspect HTTP errors, preserve a failed add, or roll back changes. Optimism alone also cannot guarantee the last user intent when requests arrive out of order. | Choose per-row serialization/pending controls or a versioned update policy; define visible errors and rollback/retry behavior. Delay and fail requests in tests, then verify the final checkbox and server value agree. |
| P3-05-04 | Medium | `MAX(position) + 1` does not specify the empty-list default or deterministic tie handling. The shared progress function has no module location; importing its runtime implementation from `lib/db.ts` into the UI would cross the server-only database boundary. | Define `COALESCE(MAX(position), -1) + 1`, stable ordering, and a client-safe home for progress logic. Test first insert, deletion gaps, and subsequent insertion; verify client imports do not load SQLite. |

**Edge cases:** Zero subtasks, deleting the last incomplete item, cascade deletion, whitespace titles, and cross-user access are covered in prose. Add reload persistence, malformed requests, network failures, and deterministic rapid-toggle behavior. Verify foreign keys on the actual test connection; an absent UI row alone does not prove cascade deletion.

**Acceptance and testing gaps:**

- Add a rename decision and corresponding acceptance criteria if retained.
- Test both directions of parent/checklist independence, including an already-completed parent with an incomplete checklist.
- Keep the listed progress unit tests; add API tests for authorization, input validation, first position, ordering, and persistence after reload.
- Extend E2E checks for failure recovery, last-subtask deletion hiding the progress display, and accessible checkbox/delete/expand controls.
- Agree a representative dataset and timing method before asserting the under-300ms API and immediate-render targets. Coverage cannot be measured until tests and source exist.

### PRP 07: Template System

**User flows:** Save, quick use, manager use, and confirmed deletion are described. Snapshot semantics and exclusion of tags/concrete due dates are clear. However, the draft checklist editor and due-date-offset capture are not specified, so the complete recurring-template save flow cannot yet be followed from the supplied UI example.

**Technical requirements and findings:**

| ID | Priority | Finding and Evidence | Recommended Resolution / Discriminating Check |
|---|---|---|---|
| P3-07-01 | High | The use example calls `subtaskDB.create({ todo_id, title, position })` and `findAllByTodo`, but PRP 05 defines `create(todoId, data)` and `findByTodoId`. PRP 07 normalizes positions on save despite its lossless title/position round-trip test. | Adopt one shared helper contract and decide whether fidelity means exact numeric positions or relative order. Test a checklist with position gaps saved and instantiated through that contract. |
| P3-07-02 | High | Todo creation occurs before checklist parsing/insertion, with no transaction. A later insert failure can leave a partial todo. `JSON.parse` success does not ensure an array of valid checklist entries: `null`, `{}`, or `[null]` can still fail after the parent is created. | Validate decoded shape and entries before mutation; atomically create the todo and all subtasks. Preserve the documented empty-checklist fallback for malformed stored JSON and decide the policy for valid JSON with invalid shape. Inject a second-insert failure and assert no partial parent or children remain. |
| P3-07-03 | High | PRP 03 requires recurring todos to have due dates. PRP 07 recommends rejecting recurring templates without an offset, but its POST example does not enforce this and its save modal never submits an offset. PRP 01 also requires a due date at least one minute in the future. | Choose save-time rejection as a concrete rule, define an offset input or conversion from the draft due date, and revalidate on use. Test missing, zero, negative, fractional, and invalid offsets with a fixed Singapore clock, including crossing midnight. |
| P3-07-04 | High | Casting request JSON to `CreateTemplateDto` does not validate names, priorities, recurrence/reminder enums, or nested subtask titles. A reminder can be saved without an offset and instantiated without a due date. | Share the owning features' runtime validation rules on create/update/use. Decide reject-versus-clear for reminders without due dates with Person 2. Test malformed payloads and corrupt stored templates without partial writes. |
| P3-07-05 | Medium | PUT is listed but has no update DTO, edit flow, validation, or tests in PRP 07. Feature 07 below additionally expects template editing and category filtering, neither specified by the PRP's UI flow. | Explicitly include these behaviors and acceptance tests, or agree their deferral and align the checklist. Define omitted versus null fields and snapshot isolation when an update occurs. |
| P3-07-06 | Medium | The PRP explicitly overrides the user guide's exclusion of subtasks. Template actions also lack specified pending/error/retry behavior; duplicate submissions can create unintended copies. | Agree checklist capture as authoritative and correct the guide in a follow-up. Specify pending controls and failure recovery while preserving intentional repeated use. Test delayed/failed save, use, and delete requests. |

**Edge cases:** Duplicate names, deletion races, no subtasks, malformed stored JSON, and snapshot independence are addressed. Add structurally invalid JSON, partial database failures, repeated intentional use versus duplicate clicks, invalid offsets, and cross-user updates/deletes. Clarify whether use that has already read a template may finish when deletion races with it.

**Acceptance and testing gaps:**

- Add integration tests for all five routes: unauthenticated 401, foreign-owned/missing IDs 404, user-scoped lists, invalid bodies 400, and no unauthorized mutation.
- Test transaction rollback and shape validation separately from JSON syntax fallback; serialization-only unit tests cannot demonstrate safe template instantiation.
- Verify two uses produce distinct IDs, fresh incomplete todos/subtasks, preserved checklist order, no tags, and no changes to the template or earlier instances after later edits/deletion.
- Complete the E2E draft-checklist and recurring-offset save flows; verify displayed Singapore due dates against a fixed clock rather than assuming a `Z` timestamp is displayed correctly.
- Add empty-library, duplicate-name, accessible modal/focus, failure recovery, and 50+ template / 20+ subtask layout checks. Define how the under-300ms target is measured.

### Questions and Cross-PRP Handoffs

These are recorded handoffs, not completed decisions or notifications to other team members.

| Owner | Dependency / Question | Required Agreement |
|---|---|---|
| Person 1 (PRP 01) | How does an unsaved todo acquire checklist entries for template capture? Will every todo response include ordered subtasks even when collapsed? | Define draft checklist state, nested response shape, database foreign-key initialization, shared creation validation, and transaction participation. |
| Person 1 (PRP 02) | Will template save/update/use share the priority validator and medium default? | Reuse the same allowed values and invalid-value response. |
| Person 2 (PRPs 03/04) | Should recurring instances copy a checklist, and should copied entries reset? Are reminders without due-date offsets rejected or cleared? | Agree checklist recurrence semantics, allowed reminder values, recurrence invariants, and offset validation before implementing template use. |
| Person 4 (PRP 08) | Search requires nested subtask titles. How do subtask changes and template use refresh the searched collection? | Verify collapsed checklist matches, renamed/deleted title refresh, and immediately searchable template-created subtasks without leaking another user's data. |
| Person 5 (PRP 09) | Do imported checklist entries follow the same title/order validation, and are templates intentionally excluded from portability? | Align subtask validation/order preservation and explicitly document the template export/import boundary. |
| Person 5 (PRP 11) | How will two-user sessions be provisioned for API tests? | Provide reusable authenticated fixtures for 401/404 and unchanged-database authorization assertions on subtask and template routes. |
| Person 3 | Resolve P3-07-01 jointly across the two owned PRPs; settle rename/edit/filter scope and the guide conflict. | Keep one canonical checklist contract and synchronize PRPs, guide, and evaluation criteria after decisions. |

**Review completion:** User flows, technical requirements, edge cases, acceptance criteria, and testing requirements reviewed for both assigned PRPs. Open findings and dependency questions are recorded above; implementation readiness and runtime verification remain pending.

---

## 📋 Table of Contents
1. [Core Features Evaluation](#core-features-evaluation)
2. [Testing & Quality Assurance](#testing--quality-assurance)
3. [Performance & Optimization](#performance--optimization)
4. [Deployment Readiness](#deployment-readiness)
5. [Vercel Deployment](#vercel-deployment)
6. [Railway Deployment](#railway-deployment)
7. [Post-Deployment Checklist](#post-deployment-checklist)

---

## Core Features Evaluation

### ✅ Feature 01: Todo CRUD Operations
**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Verified

**Implementation Checklist:**
- [ ] Database schema created with all required fields
- [ ] API endpoint: `POST /api/todos` (create)
- [ ] API endpoint: `GET /api/todos` (read all)
- [ ] API endpoint: `GET /api/todos/[id]` (read one)
- [ ] API endpoint: `PUT /api/todos/[id]` (update)
- [ ] API endpoint: `DELETE /api/todos/[id]` (delete)
- [ ] Singapore timezone validation for due dates
- [ ] Todo title validation (non-empty, trimmed)
- [ ] Due date must be in future (minimum 1 minute)
- [ ] UI form for creating todos
- [ ] UI display in sections (Overdue, Active, Completed)
- [ ] Toggle completion checkbox
- [ ] Edit todo modal/form
- [ ] Delete confirmation dialog
- [ ] Optimistic UI updates

**Testing:**
- [ ] E2E test: Create todo with title only
- [ ] E2E test: Create todo with all metadata
- [ ] E2E test: Edit todo
- [ ] E2E test: Toggle completion
- [ ] E2E test: Delete todo
- [ ] E2E test: Past due date validation

**Acceptance Criteria:**
- [ ] Can create todo with just title
- [ ] Can create todo with priority, due date, recurring, reminder
- [ ] Todos sorted by priority and due date
- [ ] Completed todos move to Completed section
- [ ] Delete cascades to subtasks and tags

---

### ✅ Feature 02: Priority System
**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Verified

**Implementation Checklist:**
- [ ] Database: `priority` field added to todos table
- [ ] Type definition: `type Priority = 'high' | 'medium' | 'low'`
- [ ] Priority validation in API routes
- [ ] Default priority set to 'medium'
- [ ] Priority badge component (red/yellow/blue)
- [ ] Priority dropdown in create/edit forms
- [ ] Priority filter dropdown in UI
- [ ] Todos auto-sort by priority
- [ ] Dark mode color compatibility

**Testing:**
- [ ] E2E test: Create todo with each priority level
- [ ] E2E test: Edit priority
- [ ] E2E test: Filter by priority
- [ ] E2E test: Verify sorting (high→medium→low)
- [ ] Visual test: Badge colors in light/dark mode

**Acceptance Criteria:**
- [ ] Three priority levels functional
- [ ] Color-coded badges visible
- [ ] Automatic sorting by priority works
- [ ] Filter shows only selected priority
- [ ] WCAG AA contrast compliance

---

### ✅ Feature 03: Recurring Todos
**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Verified

**Implementation Checklist:**
- [ ] Database: `is_recurring` and `recurrence_pattern` fields
- [ ] Type: `type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly'`
- [ ] Validation: Recurring todos require due date
- [ ] "Repeat" checkbox in create/edit forms
- [ ] Recurrence pattern dropdown
- [ ] Next instance creation on completion
- [ ] Due date calculation logic (daily/weekly/monthly/yearly)
- [ ] Inherit: priority, tags, reminder, recurrence pattern
- [ ] 🔄 badge display with pattern name

**Testing:**
- [ ] E2E test: Create daily recurring todo
- [ ] E2E test: Create weekly recurring todo
- [ ] E2E test: Complete recurring todo creates next instance
- [ ] E2E test: Next instance has correct due date
- [ ] E2E test: Next instance inherits metadata
- [ ] Unit test: Due date calculations for each pattern

**Acceptance Criteria:**
- [ ] All four patterns work correctly
- [ ] Next instance created on completion
- [ ] Metadata inherited properly
- [ ] Date calculations accurate (Singapore timezone)
- [ ] Can disable recurring on existing todo

#### PRP Review: Person 2
**Review status:** Needs clarification before implementation. User flow, technical requirements, edge cases, acceptance criteria, and tests reviewed in [PRP 03](PRPs/03-recurring-todos.md).

**Findings:**
- **High — completion is not atomic or concurrency-safe.** The example updates the current todo, inserts the next instance, then copies tags as separate operations, despite describing the work as atomic. A failure can leave a completed todo without its successor or with missing tags; concurrent completion requests can both observe `completed = false` and create successors. Perform the state transition, successor insert, and tag copy in one database transaction with a durable idempotency guard.
- **High — undoing completion can create another successor.** PRP 01 permits unchecking a completed todo. After the first completion creates a successor, unchecking and completing the original again passes the documented `false → true` check and can create a duplicate occurrence. Define undo/recompletion behavior and persist enough occurrence/lineage state to enforce it.
- **Medium — month/year clamping can permanently shift the schedule.** Calculating each occurrence from the prior due date means Jan 31 → Feb 28 → Mar 28, and Feb 29 → Feb 28 can remain on Feb 28 in later years. This may conflict with the stated same-day-of-month/year intent. Specify whether the original anchor date is retained and add multi-cycle tests.
- **Medium — stopping recurrence has ambiguous scope.** Unchecking Repeat affects only the edited instance. A successor already created remains recurring and can continue the sequence. Clarify whether “stop” means this instance only or the entire logical series; the schema currently has no series identifier.
- **Medium — completion may copy stale metadata.** The example creates the successor from `existing`, even though the same PUT first applies `body` to produce `updated`. If completion and field edits arrive together, the successor will not inherit the values just submitted, contrary to the “current values at completion time” edge case.

**Questions for the owner:**
- Should monthly/yearly recurrence retain the original date as its anchor after a clamped occurrence?
- Does disabling Repeat stop only the edited todo or the full series, including an already-created successor? What should undoing and re-completing do?
- Can completion and metadata edits occur in the same PUT, and should the successor inherit the updated values?

**Testing gaps:** Add tests for concurrent completion, uncomplete/recomplete, a multi-cycle month-end and leap-day schedule, stopping after a successor exists, and completing while changing inherited fields. Existing date unit tests cover single-step calculations but not these behaviors.

---

### ✅ Feature 04: Reminders & Notifications
**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Verified

**Implementation Checklist:**
- [ ] Database: `reminder_minutes` and `last_notification_sent` fields
- [ ] Custom hook: `useNotifications` in `lib/hooks/`
- [ ] API endpoint: `GET /api/notifications/check`
- [ ] "Enable Notifications" button with permission request
- [ ] Reminder dropdown (7 timing options)
- [ ] Reminder dropdown disabled without due date
- [ ] Browser notification on reminder time
- [ ] Polling system (every 30 seconds)
- [ ] Duplicate prevention via `last_notification_sent`
- [ ] 🔔 badge display with timing

**Testing:**
- [ ] Manual test: Enable notifications (browser permission)
- [ ] Manual test: Receive notification at correct time
- [ ] E2E test: Set reminder on todo
- [ ] E2E test: Reminder badge displays correctly
- [ ] E2E test: API returns todos needing notification
- [ ] Unit test: Reminder time calculation (Singapore timezone)

**Acceptance Criteria:**
- [ ] Permission request works
- [ ] All 7 timing options available
- [ ] Notifications fire at correct time
- [ ] Only one notification per reminder
- [ ] Works in Singapore timezone

#### PRP Review: Person 2
**Review status:** Needs clarification before implementation. User flow, technical requirements, edge cases, acceptance criteria, and tests reviewed in [PRP 04](PRPs/04-reminders-notifications.md).

**Findings:**
- **High — granted permission is not restored in client state after reload.** The hook initializes `permission` to `default` and only changes it after requesting permission. The browser remembers the grant, but a reload leaves the UI showing “Enable Notifications” and prevents polling. Initialize/synchronize state from `Notification.permission` when the client mounts and when the page becomes active.
- **High — “exactly once” conflicts with the polling design.** The endpoint returns unclaimed reminders and the client displays the notification before stamping it. Two tabs or overlapping polls can both display before either PUT completes; the `tag` option does not provide a server-side exactly-once guarantee. Choose and document at-most-once or best-effort delivery, and define an atomic claim/lease flow if duplicate suppression is required.
- **Medium — the query includes arbitrarily stale reminders.** It checks only that the reminder window has opened; it has no upper bound at `due_date` or a grace-window cutoff. A todo can therefore notify days after its due date. Choose the intended late-notification policy and align the query, user flow, and boundary tests.
- **Medium — API validation and shared types are incomplete.** PRP 01's `UpdateTodoInput` does not include `last_notification_sent`, although this PRP requires clients to update it through PUT. This PRP also does not specify server validation for the seven allowed `reminder_minutes` values or reject a reminder without a due date; UI disabling alone can be bypassed.

**Questions for the owner:**
- Is delivery intended to be at-most-once or best-effort, and should late reminders fire after the due date? What grace period applies?
- Should notification stamps use the existing todo PUT contract or a dedicated claim/acknowledgement endpoint?
- Must the API reject unsupported offsets and reminders without due dates, in addition to enforcing those rules in the UI?

**Testing gaps:** Add tests for permission restoration after reload and permission revocation, simultaneous/overlapping polls, reminders after the due date and chosen grace boundary, invalid reminder offsets, and API updates that stamp `last_notification_sent` without accidentally clearing or overwriting it.

**Cross-PRP follow-ups:**
- **Person 1 (PRP 01):** Align `UpdateTodoInput` and PUT handling with the notification-stamp contract; define ownership/validation for that field and ensure due-date/reminder edits reset it without racing a notification stamp. Specify one due-date storage format that SQLite comparisons can interpret consistently as Singapore time.
- **Person 3 (PRP 07):** Templates can carry reminder settings while due dates are calculated from an optional offset. Define whether a reminder template without a due-date offset is rejected or has its reminder cleared, so created todos cannot have an unanchored reminder.
- **Person 4 (PRP 06):** Include tag association writes in the recurrence transaction/consistency contract, since recurring instances copy tags through the tag system.

---

### ✅ Feature 05: Subtasks & Progress Tracking
**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Verified

**Implementation Checklist:**
- [ ] Database: `subtasks` table with CASCADE delete
- [ ] API endpoint: `POST /api/todos/[id]/subtasks`
- [ ] API endpoint: `PUT /api/subtasks/[id]`
- [ ] API endpoint: `DELETE /api/subtasks/[id]`
- [ ] Expandable subtasks section in UI
- [ ] Add subtask input field
- [ ] Subtask checkboxes
- [ ] Delete subtask button
- [ ] Progress bar component
- [ ] Progress calculation (completed/total * 100)
- [ ] Progress display: "X/Y completed (Z%)"
- [ ] Green bar at 100%, blue otherwise

**Testing:**
- [ ] E2E test: Expand subtasks section
- [ ] E2E test: Add multiple subtasks
- [ ] E2E test: Toggle subtask completion
- [ ] E2E test: Progress bar updates
- [ ] E2E test: Delete subtask
- [ ] E2E test: Delete todo cascades to subtasks
- [ ] Unit test: Progress calculation

**Acceptance Criteria:**
- [ ] Can add unlimited subtasks
- [ ] Can toggle completion
- [ ] Progress updates in real-time
- [ ] Visual progress bar accurate
- [ ] Cascade delete works

---

### ✅ Feature 06: Tag System
**Status:** Verified (Person 4, 2026-10-30)

**Implementation Checklist:**
- [x] Database: `tags` and `todo_tags` tables
- [x] API endpoint: `GET /api/tags`
- [x] API endpoint: `POST /api/tags`
- [x] API endpoint: `PUT /api/tags/[id]`
- [x] API endpoint: `DELETE /api/tags/[id]`
- [x] API endpoint: `POST /api/todos/[id]/tags`
- [x] API endpoint: `DELETE /api/todos/[id]/tags`
- [x] "Manage Tags" modal
- [x] Tag creation form (name + color picker)
- [x] Tag list with edit/delete buttons
- [x] Tag selection: multi-select pills on create, checkboxes when editing task tags
- [x] Tag badges on todos (colored)
- [x] Click badge to filter by tag
- [x] Tag filter indicator with clear button

**Testing:**
- [x] E2E test: Create tag
- [x] E2E test: Edit tag name/color, including partial updates
- [x] E2E test: Delete tag
- [x] E2E test: Assign multiple tags to todo
- [x] E2E test: Filter by tag
- [x] E2E test: Duplicate tag name validation
- [x] Unit test: Tag name validation
- [x] Unit tests: atomic replacement, import name resolution, ownership, outer rollback and 60-task cascade
- [x] E2E tests: 401/404 checks, failed-assignment rollback/retry, focus restoration, contrast and warm API latency

**Acceptance Criteria:**
- [x] Tags unique per user
- [x] Custom colors work
- [x] Editing tag updates all todos
- [x] Deleting tag removes from todos
- [x] Filter works correctly

---

### ✅ Feature 07: Template System
**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Verified

**Implementation Checklist:**
- [ ] Database: `templates` table
- [ ] API endpoint: `GET /api/templates`
- [ ] API endpoint: `POST /api/templates`
- [ ] API endpoint: `PUT /api/templates/[id]`
- [ ] API endpoint: `DELETE /api/templates/[id]`
- [ ] API endpoint: `POST /api/templates/[id]/use`
- [ ] "Save as Template" button
- [ ] Save template modal (name, description, category)
- [ ] "Use Template" button
- [ ] Template selection modal
- [ ] Category filter in template modal
- [ ] Template preview (shows settings)
- [ ] Subtasks JSON serialization
- [ ] Due date offset calculation

**Testing:**
- [ ] E2E test: Save todo as template
- [ ] E2E test: Create todo from template
- [ ] E2E test: Template preserves settings
- [ ] E2E test: Subtasks created from template
- [ ] E2E test: Edit template
- [ ] E2E test: Delete template
- [ ] Unit test: Subtasks JSON serialization

**Acceptance Criteria:**
- [ ] Can save current todo as template
- [ ] Templates include all metadata
- [ ] Using template creates new todo
- [ ] Subtasks recreated from JSON
- [ ] Category filtering works

---

### ✅ Feature 08: Search & Filtering
**Status:** Verified (Person 4, 2026-10-30; PRP 08 search scope)

**Implementation Checklist:**
- [x] Search input field at top of page
- [x] Real-time filtering (no submit button)
- [x] Case-insensitive search
- [x] Search matches todo titles
- [x] Search matches subtask titles (tag names are filtered separately, per PRP 08)
- [x] Priority filter dropdown
- [x] Tag filter (dropdown or click badge)
- [x] Combined filters (AND logic)
- [x] Filter summary/indicator
- [x] Clear all filters button and independent tag-filter clearing
- [x] Empty state for no results
- [x] Debounced search (300ms), cached computation and immediate clear
- [x] Advanced completion/date filters, saved preset preview/apply/delete and account-scoped browser persistence

**Testing:**
- [x] E2E test: Search by title
- [x] E2E test: Search by subtask title
- [x] E2E test: Filter by priority
- [x] E2E test: Filter by tag
- [x] E2E test: Combine multiple filters
- [x] E2E test: Clear filters
- [x] Performance test: Filter 1000 todos < 100ms
- [x] E2E tests: deterministic debounce, Singapore dates, section counts, presets, deleted tags, storage failures and empty accounts
- [x] E2E test: checklist changes become searchable through the shared refresh event

**Acceptance Criteria:**
- [x] Search is case-insensitive
- [x] Includes subtask titles in search; supports tag filtering separately
- [x] Filters combine with AND
- [x] Real-time updates
- [x] Clear message for empty results

---

### ✅ Feature 09: Export & Import
**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Verified

**Implementation Checklist:**
- [ ] API endpoint: `GET /api/todos/export`
- [ ] API endpoint: `POST /api/todos/import`
- [ ] Export button in UI
- [ ] Import button with file picker
- [ ] JSON format with version field
- [ ] Export includes: todos, subtasks, tags, associations
- [ ] Import validation (format, required fields)
- [ ] ID remapping on import
- [ ] Tag name conflict resolution (reuse existing)
- [ ] Success message with counts
- [ ] Error handling for invalid JSON

**Testing:**
- [ ] E2E test: Export todos
- [ ] E2E test: Import valid file
- [ ] E2E test: Import invalid JSON (error shown)
- [ ] E2E test: Import preserves all data
- [ ] E2E test: Imported todos appear immediately
- [ ] Unit test: ID remapping logic
- [ ] Unit test: JSON validation

**Acceptance Criteria:**
- [ ] Export creates valid JSON
- [ ] Import validates format
- [ ] All relationships preserved
- [ ] No duplicate tags created
- [ ] Error messages clear

---

### ✅ Feature 10: Calendar View
**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Verified

**Implementation Checklist:**
- [ ] Database: `holidays` table seeded with Singapore holidays
- [ ] API endpoint: `GET /api/holidays`
- [ ] Calendar page route: `/calendar`
- [ ] Calendar generation logic (weeks/days)
- [ ] Month navigation (prev/next/today buttons)
- [ ] Day headers (Sun-Sat)
- [ ] Current day highlighted
- [ ] Weekend styling
- [ ] Holiday display with names
- [ ] Todos appear on due dates
- [ ] Todo count badge on days
- [ ] Click day to view todos modal
- [ ] URL state management (`?month=YYYY-MM`)

**Testing:**
- [ ] E2E test: Calendar loads current month
- [ ] E2E test: Navigate to prev/next month
- [ ] E2E test: Today button works
- [ ] E2E test: Todo appears on correct date
- [ ] E2E test: Holiday appears on correct date
- [ ] E2E test: Click day opens modal
- [ ] Unit test: Calendar generation

**Acceptance Criteria:**
- [ ] Calendar displays correctly
- [ ] Holidays shown
- [ ] Todos on correct dates
- [ ] Navigation works
- [ ] Modal shows day's todos

---

### ✅ Feature 11: Authentication (WebAuthn)
**Status:** ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Verified

**Implementation Checklist:**
- [ ] Database: `users` and `authenticators` tables
- [ ] API endpoint: `POST /api/auth/register-options`
- [ ] API endpoint: `POST /api/auth/register-verify`
- [ ] API endpoint: `POST /api/auth/login-options`
- [ ] API endpoint: `POST /api/auth/login-verify`
- [ ] API endpoint: `POST /api/auth/logout`
- [ ] API endpoint: `GET /api/auth/me`
- [ ] Auth utility: `lib/auth.ts` (createSession, getSession, deleteSession)
- [ ] Middleware: `middleware.ts` (protect routes)
- [ ] Login page: `/login`
- [ ] Registration flow
- [ ] Login flow
- [ ] Logout button
- [ ] Session cookie (HTTP-only, 7-day expiry)
- [ ] Protected routes redirect to login

**Testing:**
- [ ] E2E test: Register new user (virtual authenticator)
- [ ] E2E test: Login existing user
- [ ] E2E test: Logout clears session
- [ ] E2E test: Protected route redirects unauthenticated
- [ ] E2E test: Login page redirects authenticated
- [ ] Unit test: JWT creation/verification

**Acceptance Criteria:**
- [ ] Registration works with passkey
- [ ] Login works with passkey
- [ ] Session persists 7 days
- [ ] Logout clears session immediately
- [ ] Protected routes secured

---

## Testing & Quality Assurance

### Unit Tests
- [ ] Database CRUD operations tested
- [ ] Date/time calculations tested (Singapore timezone)
- [ ] Progress calculation tested
- [ ] ID remapping tested
- [ ] Validation functions tested
- [ ] All utility functions have tests

### E2E Tests (Playwright)
- [ ] All 11 feature test files created
- [ ] `tests/helpers.ts` with reusable methods
- [ ] Virtual authenticator configured
- [ ] Singapore timezone set in config
- [ ] All critical user flows tested
- [ ] Tests pass consistently (3 consecutive runs)

### Code Quality
- [ ] ESLint configured and passing
- [ ] TypeScript strict mode enabled
- [ ] No TypeScript errors
- [ ] No console.errors in production
- [ ] Proper error handling in all API routes
- [ ] Loading states for async operations

### Accessibility
- [ ] WCAG AA contrast ratios met
- [ ] Keyboard navigation works for all actions
- [ ] Screen reader labels on interactive elements
- [ ] Focus indicators visible
- [ ] ARIA attributes where needed
- [ ] Lighthouse accessibility score > 90

### Browser Compatibility
- [ ] Tested in Chrome/Edge (Chromium)
- [ ] Tested in Firefox
- [ ] Tested in Safari
- [ ] Mobile Chrome tested
- [ ] Mobile Safari tested
- [ ] WebAuthn works in all supported browsers

---

## Performance & Optimization

### Frontend Performance
- [ ] Page load time < 2 seconds
- [ ] Time to interactive < 3 seconds
- [ ] First contentful paint < 1 second
- [ ] Todo operations < 500ms
- [ ] Search/filter updates < 100ms
- [ ] Lazy loading for large lists (if > 100 todos)
- [ ] Images optimized (if any)
- [ ] Bundle size < 500KB (gzipped)

### Backend Performance
- [ ] API responses < 300ms (average)
- [ ] Database queries optimized (indexes)
- [ ] Prepared statements used everywhere
- [ ] No N+1 query problems
- [ ] Efficient joins for related data

### Database Optimization
- [ ] Indexes on foreign keys
- [ ] Index on `user_id` columns
- [ ] Index on `due_date` for filtering
- [ ] Database file size reasonable (< 100MB for 10k todos)

---

## Deployment Readiness

### Environment Configuration
- [ ] Environment variables documented
- [ ] `.env.example` file created
- [ ] JWT_SECRET configured
- [ ] RP_ID set for production domain
- [ ] RP_NAME set for production

### Security Checklist
- [ ] HTTP-only cookies in production
- [ ] Secure flag on cookies (HTTPS)
- [ ] SameSite cookies configured
- [ ] No sensitive data in logs
- [ ] Rate limiting configured (optional but recommended)
- [ ] CORS properly configured
- [ ] SQL injection prevention (prepared statements)
- [ ] XSS prevention (React escaping)

### Production Readiness
- [ ] Production build succeeds (`npm run build`)
- [ ] Production build tested locally
- [ ] Error boundaries implemented
- [ ] 404 page exists
- [ ] 500 error page exists
- [ ] Logging configured (errors, warnings)
- [ ] Analytics configured (optional)

---

## Vercel Deployment

### Prerequisites
- [ ] Vercel account created
- [ ] Vercel CLI installed: `npm i -g vercel`
- [ ] Project connected to GitHub repository

### Deployment Steps

#### Step 1: Prepare Project
```bash
# Ensure production build works
npm run build

# Test production build locally
npm start
```

#### Step 2: Configure Environment Variables
In Vercel Dashboard:
- [ ] `JWT_SECRET` - Random 32+ character string
- [ ] `RP_ID` - Your domain (e.g., `your-app.vercel.app`)
- [ ] `RP_NAME` - Your app name (e.g., "Todo App")
- [ ] `RP_ORIGIN` - Full URL (e.g., `https://your-app.vercel.app`)

#### Step 3: Deploy via CLI
```bash
# Login to Vercel
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

#### Step 4: Deploy via GitHub Integration
- [ ] Connect GitHub repository in Vercel dashboard
- [ ] Configure build settings:
  - Framework Preset: **Next.js**
  - Build Command: `npm run build`
  - Output Directory: `.next`
  - Install Command: `npm install`
- [ ] Add environment variables in Vercel dashboard
- [ ] Enable automatic deployments on `main` branch

### Vercel Configuration File
Create `vercel.json`:
```json
{
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "framework": "nextjs",
  "regions": ["sin1"]
}
```

### Post-Deployment Verification (Vercel)
- [ ] App loads at Vercel URL
- [ ] WebAuthn registration works on production domain
- [ ] WebAuthn login works
- [ ] All API routes accessible
- [ ] Database persists (SQLite in Vercel file system)
- [ ] Singapore timezone works correctly
- [ ] Environment variables loaded
- [ ] HTTPS enabled (automatic)
- [ ] No console errors
- [ ] Performance acceptable

### Vercel-Specific Notes
⚠️ **SQLite Limitation**: Vercel uses serverless functions. SQLite database will reset on each deployment. Consider:
- [ ] Use Vercel Postgres for persistent storage
- [ ] Or migrate to Railway for persistent SQLite
- [ ] Or use external database (Supabase, PlanetScale)

---

## Railway Deployment

### Prerequisites
- [ ] Railway account created: https://railway.app
- [ ] Railway CLI installed: `npm i -g @railway/cli`
- [ ] Project connected to GitHub repository

### Deployment Steps

#### Step 1: Install Railway CLI
```bash
npm i -g @railway/cli

# Login
railway login
```

#### Step 2: Initialize Project
```bash
# In project directory
railway init

# Link to existing project (if already created)
railway link
```

#### Step 3: Configure Environment Variables
```bash
# Set environment variables
railway variables set JWT_SECRET=your-secret-key-here
railway variables set RP_ID=your-app.up.railway.app
railway variables set RP_NAME="Todo App"
railway variables set RP_ORIGIN=https://your-app.up.railway.app
```

Or via Railway Dashboard:
- [ ] Go to project → Variables
- [ ] Add `JWT_SECRET`
- [ ] Add `RP_ID`
- [ ] Add `RP_NAME`
- [ ] Add `RP_ORIGIN`

#### Step 4: Create `railway.json` (Optional)
```json
{
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm run build"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

#### Step 5: Create `Procfile` (Optional)
```
web: npm start
```

#### Step 6: Deploy
```bash
# Deploy from CLI
railway up

# Or push to GitHub (if connected)
git push origin main
```

#### Step 7: Configure Custom Domain (Optional)
- [ ] Go to Railway Dashboard → Settings
- [ ] Add custom domain
- [ ] Configure DNS (CNAME record)
- [ ] Update `RP_ID` and `RP_ORIGIN` environment variables

### Railway Configuration for Next.js

#### Update `package.json` scripts:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start -p ${PORT:-3000}",
    "lint": "eslint"
  }
}
```

#### Create `nixpacks.toml` (recommended):
```toml
[phases.setup]
nixPkgs = ["nodejs-18_x"]

[phases.install]
cmds = ["npm ci"]

[phases.build]
cmds = ["npm run build"]

[start]
cmd = "npm start"
```

### Post-Deployment Verification (Railway)
- [ ] App loads at Railway URL
- [ ] WebAuthn registration works
- [ ] WebAuthn login works
- [ ] All API routes accessible
- [ ] Database persists across requests
- [ ] Database persists across deployments (Railway volumes)
- [ ] Singapore timezone works
- [ ] Environment variables loaded
- [ ] HTTPS enabled (automatic)
- [ ] No console errors
- [ ] Performance acceptable

### Railway-Specific Configuration

#### Persistent SQLite Database
Railway supports persistent volumes:

```bash
# Create volume for database
railway volume create

# Mount volume (add to railway.json)
```

Or via Dashboard:
- [ ] Go to project → Volumes
- [ ] Create new volume
- [ ] Mount path: `/app/data`
- [ ] Update database path in `lib/db.ts`:
  ```typescript
  const dbPath = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.cwd(), 'todos.db');
  ```

### Railway vs Vercel Comparison

| Feature | Vercel | Railway |
|---------|--------|---------|
| **SQLite Persistence** | ❌ Resets on deploy | ✅ With volumes |
| **Deployment Speed** | ⚡ Very fast | ⚡ Fast |
| **Auto HTTPS** | ✅ Yes | ✅ Yes |
| **Custom Domains** | ✅ Free | ✅ Free |
| **Pricing** | Free tier generous | Free tier available |
| **Best For** | Static/Serverless | Full-stack apps |

**Recommendation**: Use **Railway** for this app due to SQLite persistence requirement.

---

## Post-Deployment Checklist

### Functional Testing (Production)
- [ ] Register new user account
- [ ] Login with registered account
- [ ] Create todo with all features
- [ ] Create recurring todo
- [ ] Set reminder and receive notification
- [ ] Add subtasks
- [ ] Create and assign tags
- [ ] Use template system
- [ ] Search and filter todos
- [ ] Export todos
- [ ] Import exported file
- [ ] View calendar
- [ ] Logout and login again

### Performance Testing (Production)
- [ ] Run Lighthouse audit (score > 80)
- [ ] Test on slow 3G connection
- [ ] Test with 100+ todos
- [ ] Verify API response times
- [ ] Check for memory leaks (long session)

### Security Testing (Production)
- [ ] Verify HTTPS is enforced
- [ ] Test WebAuthn on production domain
- [ ] Verify cookies are HTTP-only and Secure
- [ ] Test protected routes without auth
- [ ] Attempt SQL injection (should fail)
- [ ] Check for XSS vulnerabilities

### Cross-Browser Testing (Production)
- [ ] Chrome (desktop)
- [ ] Firefox (desktop)
- [ ] Safari (desktop)
- [ ] Edge (desktop)
- [ ] Chrome (mobile)
- [ ] Safari (mobile)

### Documentation
- [ ] README.md updated with deployment instructions
- [ ] Environment variables documented
- [ ] Known issues documented
- [ ] Changelog maintained
- [ ] API documentation (if public)

---

## Success Criteria

### Minimum Viable Product (MVP)
- [ ] All 11 core features implemented and working
- [ ] All E2E tests passing
- [ ] Successfully deployed to Railway or Vercel
- [ ] Production app accessible via HTTPS
- [ ] WebAuthn authentication working on production
- [ ] Database persisting correctly
- [ ] No critical bugs

### Production Ready
- [ ] All items in MVP ✓
- [ ] Performance metrics met
- [ ] Accessibility score > 90
- [ ] Security checklist complete
- [ ] Cross-browser testing complete
- [ ] Error handling robust
- [ ] User documentation complete

### Excellent Implementation
- [ ] All items in Production Ready ✓
- [ ] Code coverage > 80%
- [ ] Lighthouse score > 90 (all categories)
- [ ] Sub-second API response times
- [ ] Custom domain configured
- [ ] Monitoring/analytics setup
- [ ] SEO optimized
- [ ] PWA features (optional)

---

## Evaluation Scoring

### Feature Completeness (0-110 points)
- Each core feature: 10 points (11 features × 10 = 110 points)
- Partial implementation: 5 points
- Not started: 0 points

**Total Feature Score:** _____ / 110

### Testing Coverage (0-30 points)
- E2E tests: 15 points
- Unit tests: 10 points
- Manual testing: 5 points

**Total Testing Score:** _____ / 30

### Deployment (0-30 points)
- Successful deployment: 15 points
- Environment configuration: 5 points
- Production testing: 5 points
- Documentation: 5 points

**Total Deployment Score:** _____ / 30

### Quality & Performance (0-30 points)
- Code quality: 10 points
- Performance: 10 points
- Accessibility: 5 points
- Security: 5 points

**Total Quality Score:** _____ / 30

---

## Final Score

**Total Score:** _____ / 200

### Rating Scale:
- **180-200**: 🌟 Excellent - Production ready, exceeds expectations
- **160-179**: 🎯 Very Good - Production ready, meets all requirements
- **140-159**: ✅ Good - Mostly complete, minor issues
- **120-139**: ⚠️ Adequate - Core features work, needs improvement
- **100-119**: ❌ Incomplete - Missing critical features
- **< 100**: ⛔ Not Ready - Significant work needed

---

**Evaluation Date:** _____________

**Evaluator:** _____________

**Notes:**
_____________________________________________________________________________
_____________________________________________________________________________
_____________________________________________________________________________

---

**Last Updated:** November 11, 2025
