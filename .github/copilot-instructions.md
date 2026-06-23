# Copilot Instructions for MonkeyGTD

## Test-first delivery policy

- Any feature or bug fix that changes production behavior must include unit or integration tests in the same change.
- For bug fixes, add a regression test that fails before the fix and passes after.
- For features, add at least one happy-path test and one edge-case test.
- Do not consider a task complete until tests pass locally or in CI.
- If a test cannot be added, explain why in the PR and propose the smallest follow-up test seam.

## Scope guidance

- Use unit tests for pure logic and isolated modules.
- Use integration tests for behavior across modules or UI-controller interactions.
- Keep tests under `tests/unit` and `tests/integration`.

## Completion checklist for Copilot responses

- Mention what tests were added or changed.
- Mention the command used to run tests.
- Mention test results.
