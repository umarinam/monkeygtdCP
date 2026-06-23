# MonkeyGTD Refactor Plan (SOLID + CQRS)

## Goal
Split the current large app logic into focused JavaScript modules while preserving behavior and improving maintainability, testability, and change safety.

## Phase 0 - Baseline and Safety
1. Capture baseline behavior checklist:
- Add/edit/delete tasks
- Nesting/indent/unindent
- Due/repeat/tags/notes/assign
- Search/filter
- Export/import
- Command palette and keyboard shortcuts
2. Add a lightweight manual smoke-test script in docs.
3. Freeze command/query naming conventions.
4. Keep all existing HTML IDs and data attributes stable.

Deliverables:
- Baseline checklist documented
- Naming conventions documented

## Phase 1 - File Structure and Entry Points
1. Create module folders:
- js/core
- js/domain
- js/application
- js/ui
- js/infra
2. Keep cqrs primitives in a core module.
3. Keep app shell bootstrap minimal in app entry file.
4. Update script load order in HTML to explicit modules.

Deliverables:
- New folder structure
- Boot path still works unchanged from user perspective

## Phase 2 - Core and Infra Extraction
1. Move utility/date/escape helpers to core utils module.
2. Move walker/traversal helpers to core traversal module.
3. Move storage logic to infra storage module.
4. Introduce adapters:
- Clock adapter
- Id generator adapter
- Storage adapter

Deliverables:
- App no longer depends directly on localStorage/date/id generation internals

## Phase 3 - Domain Command Modules
1. Split command handlers by domain concern:
- domain/commands-task.js
- domain/commands-list.js
- domain/commands-move-sort.js
- domain/commands-import-export-write.js
2. Ensure command handlers are state-focused and side-effect light.
3. Keep render/toast/modal orchestration out of domain handlers.
4. Register commands in one application-level registry.

Deliverables:
- All writes routed through command dispatch
- No direct task mutation in UI event handlers

## Phase 4 - Query and Projection Modules
1. Split query selectors:
- domain/queries-tasks.js
- domain/queries-due-tags.js
- domain/queries-export-stats.js
- domain/queries-command-palette.js
2. Ensure derived read logic lives in queries only.
3. Replace any remaining ad-hoc derived calculations in UI with select().

Deliverables:
- All derived reads come from query selectors

## Phase 5 - UI Controller Split
1. Break UI logic into focused controllers:
- ui/keyboard-controller.js
- ui/task-list-controller.js
- ui/modal-controller.js
- ui/command-palette-controller.js
- ui/render-controller.js
2. Keep controllers thin:
- dispatch commands
- read via select
- delegate render orchestration
3. Remove mixed responsibilities from the main app object.

Deliverables:
- Main app shell reduced to composition/wiring

## Phase 6 - Contract Cleanup (SOLID Hardening)
1. Add clear interface contracts between layers:
- CommandPort
- QueryPort
- ViewPort
2. Eliminate cross-layer leakage:
- Domain modules must not touch DOM APIs
- UI modules must not mutate state directly
3. Normalize command/query naming and payloads.

Deliverables:
- Stable interfaces with consistent payload shapes

## Phase 7 - Regression and Quality Gates
1. Run full smoke tests against baseline checklist.
2. Add focused tests for:
- Traversal invariants
- Key command handlers
- Critical query selectors
3. Verify no diagnostics errors and no behavior regressions.

Deliverables:
- Passed regression checklist
- Initial targeted tests in place

## Suggested File Split Target
1. app.html
2. styles.css
3. js/app.js (bootstrap/composition only)
4. js/core/cqrs.js
5. js/core/utils.js
6. js/core/traversal.js
7. js/infra/storage.js
8. js/infra/adapters.js
9. js/domain/commands-task.js
10. js/domain/commands-list.js
11. js/domain/commands-move-sort.js
12. js/domain/commands-import-export-write.js
13. js/domain/queries-tasks.js
14. js/domain/queries-due-tags.js
15. js/domain/queries-export-stats.js
16. js/domain/queries-command-palette.js
17. js/ui/keyboard-controller.js
18. js/ui/task-list-controller.js
19. js/ui/modal-controller.js
20. js/ui/command-palette-controller.js
21. js/ui/render-controller.js

## Execution Order Recommendation
1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7

## Definition of Done
1. app.js is reduced to bootstrap and composition.
2. All writes happen through dispatch().
3. All derived reads happen through select().
4. Domain logic has no DOM/localStorage dependencies.
5. Smoke test checklist passes end-to-end.
