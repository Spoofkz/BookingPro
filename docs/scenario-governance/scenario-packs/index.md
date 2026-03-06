# Scenario Pack Index (All Milestones)

This index tracks PRD-00 Scenario Pack coverage across milestones. In this repo, Scenario Packs are stored as companion docs until milestone PRD source docs are imported.

## Index

| Milestone | Owned scenarios (current register) | Supported scenarios (current register) | Full owned specs present? | Notes |
|---|---|---|---|---|
| `#1` Platform Foundation: Auth + RBAC + Tenancy (Club context switching) | `-` | `GOV-01`, `INV-01`, `BK-01` | `N/A` | Dependency support only in current critical-path register |
| `#2` Personal Cabinets (Client / Host / Technical Admin) | `-` | `BK-01` | `N/A` | Dependency support only in current critical-path register |
| `#3` Club Management & Onboarding | `GOV-01` | `INV-01`, `SEARCH-01` | `Yes` | Specs in `critical-path.md` |
| `#4` Seat Map Engine | `INV-01` | `INV-03`, `INV-04`, `SCH-01` | `Yes` | Specs in `critical-path.md` |
| `#5` Schedule & Slot Generation | `SCH-01` | `SCH-03`, `BK-01`, `SEARCH-01` | `Yes` | Specs in `critical-path.md` |
| `#6` Availability Service | `SCH-03` | `BK-01`, `BK-03` | `Yes` | Specs in `critical-path.md` |
| `#7` Booking Engine | `BK-01`, `BK-03` | `-` | `Yes` | Specs in `critical-path.md` |
| `#8` Pricing & Packages | `INV-03`, `INV-04` | `SCH-01`, `BK-01` | `Yes` | Specs in `critical-path.md` |
| `#9` Promotions / Promo Codes | `-` | `BK-01` (optional), `INV-04` (quote path extension) | `No` | Add promo-specific owned scenarios next |
| `#10` Online Payments Provider Integration | `-` | `BK-01` (online payment variant) | `No` | Register payment scenarios when provider integration lands |
| `#11` Offline Payments Operations | `-` | `BK-01`, `BK-03` | `N/A` | Dependency support only in current critical-path register |
| `#12` Cancellation Refunds | `-` | `BK-03` (refund variant), future scenarios | `No` | Register refund scenarios when workflow exists |
| `#13` Notifications (SMS/email/push) | `-` | `GOV-01`, `BK-01`, `BK-03`, `SEARCH-01` (optional notifications) | `No` | Register notification scenarios |
| `#14` Search & Discovery | `SEARCH-01` | `-` | `Yes` | Specs in `critical-path.md` |
| `#15` Customer Management (light CRM) | `-` | `BK-01` (customer linking), future CRM scenarios | `No` | Register CRM owned scenarios |
| `#16` Operational Reporting | `-` | `All milestone outcomes (reporting overlays)` | `No` | Register reporting scenarios |
| `#17` Audit & Observability | `-` | `AUDIT_REQUIRED` overlay on critical scenarios | `No` | Overlay artifact exists, but owned scenarios not registered |
| `#18` Real-time Updates (SSE/WebSockets) | `-` | `SCH-03`, `BK-01`, live map scenarios (future) | `No` | Register realtime scenarios |
| `#19` Reschedule Flow | `-` | `BK-01` follow-up lifecycle, future `RS-*` scenarios | `No` | Register reschedule owned scenarios |
| `#20` Group Booking / Multi-seat | `-` | `BK-01` variant (future) | `No` | Register group-booking scenarios |
| `#21` Memberships / Subscriptions | `-` | `BK-01`, quote/payment variants | `No` | Register membership owned scenarios |
| `#22` Platform Admin Console | `-` | `GOV-01`, `BK-03`, dispute/admin scenarios (future) | `No` | Register platform-admin owned scenarios |
| `#23` Security hardening & compliance | `-` | `SEC_REQUIRED` overlay on critical scenarios | `No` | Overlay artifact exists, but owned scenarios not registered |
| `#24` Release readiness (QA automation, load tests, staging, rollback) | `-` | `RELEASE_REQUIRED` overlay on critical scenarios | `No` | PRD-00 + PRD-24 artifacts now support evidence and release gates |

## Current baseline scope

Full owned scenario specs are provided for the PRD-00 initial critical path in:

- `/Users/azamatdossym/booking-app2/booking-app2/docs/scenario-governance/scenario-packs/critical-path.md`

