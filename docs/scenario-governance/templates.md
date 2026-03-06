# PRD-00 Templates

## Scenario Register Columns (authoritative)

`Scenario ID | Scenario name | Outcome | Owner milestone | Dependencies | MVP scope | Status (0/50/100) | PRD links | Test IDs | Evidence link | Gap note | Backlog link`

## Traceability Matrix A Template

`Scenario ID | Owner milestone | Dependency milestones | Owner PRD contains Scenario Pack? (Y/N) | Notes`

## Traceability Matrix B Template

`Scenario ID | AC linked? | Tests linked? | Evidence linked? | Coverage verdict`

Coverage verdict rule:

- If any of AC / Tests / Evidence is missing -> `Partial`
- If flow is not working -> `Missing`
- Only mark `Covered` when scenario status is `100`

## Scenario Pack Template (per owned scenario)

- Scenario ID + Name
- Outcome
- Preconditions
- Main flow (happy path steps)
- Variants (top 3-5)
- Failure modes (top 5-10)
- Policies & rules
- State machine (statuses + transitions + allowed actions)
- API surface (requests/responses + error codes + idempotency)
- Data model touchpoints
- Security checks (RBAC / tenancy / abuse)
- Audit events
- Observability (logs / metrics / traces)
- Test plan (manual + automation)
- Evidence requirement

## Manual Scenario Test Script Template

- Scenario ID
- Environment
- Preconditions
- Steps
- Expected results
- Negative case
- Evidence artifact
- Notes / bugs

## Automation Test Case Template (API/UI)

- Test ID
- Scenario ID
- Setup
- Action
- Assertions
- Cleanup
- CI hook / command

## Audit Event Template (#17)

- Event name
- Actor
- Target entity
- Before/After
- Correlation ID
- Timestamp
- Severity

