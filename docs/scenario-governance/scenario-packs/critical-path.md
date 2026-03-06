# Critical Path Scenario Packs (PRD-00 Baseline)

This file contains the **full owned scenario specs** for the initial PRD-00 critical path set.

Overlay tags that apply to all critical scenarios:

- `AUDIT_REQUIRED` -> milestone `#17` Audit & Observability
- `SEC_REQUIRED` -> milestone `#23` Security hardening & compliance
- `RELEASE_REQUIRED` -> milestone `#24` Release readiness

## Milestone #3: Club Management & Onboarding

### 6.1 Owned scenarios

- `GOV-01` Create club + assign CTA

### 6.2 Supported scenarios

- `INV-01`: provides club existence, lifecycle state, membership context
- `SEARCH-01`: provides published/paused lifecycle gating for discovery

<a id="gov-01-create-club--assign-cta"></a>
### GOV-01 + Create club + assign CTA

#### Outcome

- A club exists and has a technical admin membership assigned, enabling onboarding configuration.

#### Preconditions

- Actor is authenticated and authorized to create/manage clubs.
- Platform foundation tenancy and membership models are available.

#### Main flow (happy path)

1. Create club record.
2. Assign/create technical admin membership for club.
3. Open onboarding/checklist state.
4. Club is available in cabinet context switching.

#### Variants (top 3-5)

- Owner creates club and self-assigns as `TECH_ADMIN`.
- Existing user is invited then enabled as CTA.
- Club remains draft until onboarding steps complete.

#### Failure modes (top 5-10)

- Duplicate slug/name conflict.
- Unauthorized actor attempts create.
- Member invite references unknown user/email.
- Club membership role invalid for action.
- Partial create without membership (must be prevented/repairable).

#### Policies & rules

- Club starts as `DRAFT`.
- Club-scoped actions require active membership.
- Publish is blocked until onboarding checklist prerequisites pass.

#### State machine (statuses + transitions + allowed actions per status)

- `DRAFT` -> `PUBLISHED` (after onboarding readiness + publish action)
- `PUBLISHED` -> `PAUSED` (ops/platform action)
- `PAUSED` -> `PUBLISHED` (resume)

#### API surface

- `POST /api/clubs`
- `POST /api/clubs/{clubId}/members/invite`
- `POST /api/context` (club/role switch)
- Errors: `403 INSUFFICIENT_PERMISSION`, `409 conflict`, validation errors
- Idempotency: not required for club create in current API baseline

#### Data model touchpoints

- `Club`
- `ClubMembership`
- `AuditLog`
- onboarding-related checklist fields on `Club`

#### Security checks

- RBAC for club creation/member management
- tenancy isolation for membership actions (`clubId` scoped)
- no cross-club member role mutation without scope

#### Audit events

- `club.created`
- membership invite/role/enable events

#### Observability

- request logs for club create/member invite
- audit queryability by `clubId`
- onboarding funnel metrics (future)

#### Test plan (manual + automation)

- Manual: create club -> assign CTA -> switch context -> verify onboarding view
- Automation: admin/club management integration coverage (partial today)
- Negative: unauthorized create/member action returns `403`

#### Evidence requirement

- API test run output + audit entries
- Screenshot/video of context switch into newly created club (future)

## Milestone #4: Seat Map Engine

### 6.1 Owned scenarios

- `INV-01` Create/publish seat map

### 6.2 Supported scenarios

- `INV-03`: provides seat inventory structure and seat metadata
- `INV-04`: provides seat/segment topology used by pricing validation
- `SCH-01`: provides published map for slot/availability consumers

<a id="inv-01-createpublish-seat-map"></a>
### INV-01 + Create/publish seat map

#### Outcome

- Draft seat map is published as a version and downstream seat index is available.

#### Preconditions

- Club exists and actor has map edit/publish permissions.
- Club context selected.

#### Main flow (happy path)

1. Load or create draft map.
2. Edit floors/rooms/seats/walls.
3. Validate publish preview/diff.
4. Publish map version.
5. Seat index entries become available to availability/booking/pricing.

#### Variants (top 3-5)

- First map publish for club.
- Incremental publish from existing draft revision.
- Publish after seat disable changes.

#### Failure modes (top 5-10)

- Invalid map JSON/schema.
- Publish with duplicate seat IDs.
- No seats/floors present.
- Unauthorized publish.
- Draft revision mismatch (concurrent edits).

#### Policies & rules

- Publish should be versioned and immutable.
- Draft and published versions are distinct.
- Seat IDs must remain unique per published map version.

#### State machine

- Draft revisions (`draftRevision`) progress independently
- Publish creates `SeatMapVersion` snapshots (`versionNumber` increasing)

#### API surface

- `GET/PUT /api/clubs/{clubId}/map/draft`
- `POST /api/clubs/{clubId}/map/publish`
- `GET /api/clubs/{clubId}/map/versions`
- Errors: validation, permission, conflict
- Idempotency: publish is not currently idempotent-keyed; caller retries must handle duplicate publish semantics

#### Data model touchpoints

- `SeatMap`
- `SeatMapVersion`
- `SeatIndex`
- `AuditLog`

#### Security checks

- `MAP_EDIT` / `MAP_PUBLISH` permissions enforced
- club scope on map/version access

#### Audit events

- map draft updates
- map publish event with version metadata

#### Observability

- publish latency
- publish validation failures
- seat index generation count

#### Test plan

- Manual: edit map -> preview -> publish -> verify seats endpoint
- Automation: integration path coverage exists indirectly in admin/setup flows
- Negative: invalid map payload and unauthorized publish

#### Evidence requirement

- Publish response payload + subsequent `/seats` verification
- Audit entry for publish

## Milestone #8: Pricing & Packages

### 6.1 Owned scenarios

- `INV-03` Create segments + assign seats
- `INV-04` Publish pricing rules / quote snapshot

### 6.2 Supported scenarios

- `SCH-01`: pricing version availability for scheduled booking quote paths
- `BK-01`: quote generation + snapshot persistence

<a id="inv-03-create-segments--assign-seats"></a>
### INV-03 + Create segments + assign seats

#### Outcome

- Segments exist and seat/room inventory is aligned with segment-based pricing inputs.

#### Preconditions

- Published map exists.
- Tech admin permission to manage segments/pricing.

#### Main flow (happy path)

1. Create/edit segments.
2. Associate rooms/seats with segments (via map/room configuration).
3. Verify downstream quote/availability uses segment IDs.

#### Variants

- Add new segment to existing club.
- Reassign room/seat to different segment.
- Deactivate segment with migration path.

#### Failure modes

- Segment duplicate name conflict.
- Invalid segment referenced by room/pricing rule.
- Quote request missing segment where room has none.

#### Policies & rules

- Segment IDs must be valid within club scope.
- Quotes require valid segment coverage.

#### State machine

- `Segment.isActive = true/false`

#### API surface

- `GET/POST /api/clubs/{clubId}/segments`
- `PUT /api/segments/{segmentId}` (where available)
- dependent endpoints: `/api/rooms`, `/api/pricing/quote`

#### Data model touchpoints

- `Segment`
- `Room.segmentId`
- `SeatIndex.segmentId`
- `PricingRule.scopeId` for segment-scope rules

#### Security checks

- club-scoped RBAC for segment/pricing edits
- no cross-club segment mutation

#### Audit events

- segment create/update/delete (where implemented)
- pricing publish validations referencing segment coverage

#### Observability

- quote errors `SEGMENT_REQUIRED`, `SEAT_SEGMENT_NOT_COVERED`

#### Test plan

- Manual: create segment -> assign room/seat -> quote works
- Automation: contract and pricing tests (partial indirect)
- Negative: invalid/missing segment in quote path

#### Evidence requirement

- Quote response proving segment-based pricing after assignment
- Segment/room config screenshots or API payloads

<a id="inv-04-publish-pricing-rules--quote-snapshot"></a>
### INV-04 + Publish pricing rules / quote snapshot

#### Outcome

- Pricing version is published and produces deterministic quote results; booking stores quote snapshot.

#### Preconditions

- Club + segments + rooms available.
- Pricing rules configured for active version.

#### Main flow (happy path)

1. Create pricing version and rules/packages.
2. Publish pricing version (effective window).
3. Call quote API for eligible inputs.
4. Confirm booking and persist quote/price snapshot.

#### Variants

- Package-based quote.
- Promo-applied quote (if enabled).
- Membership-adjusted quote preview (if enabled).

#### Failure modes

- No active pricing version.
- Package not eligible.
- Promo rejected (invalid/ineligible/usage limit).
- Segment coverage missing.

#### Policies & rules

- Deterministic evaluation for same inputs.
- Quote validity TTL (`validUntil`)
- Promo/membership feature flags may disable adjustments

#### State machine

- Pricing version `DRAFT` -> `PUBLISHED`
- Quotes are immutable snapshots for booking references

#### API surface

- `POST /api/pricing/quote`
- pricing version/rules publish endpoints
- Error codes include pricing and promo-specific codes
- Idempotency: quote endpoint supports idempotency response storage in route

#### Data model touchpoints

- `PricingVersion`, `PricingRule`, `PricingPackage`
- `PriceQuote`
- `Booking.quoteId`, `Booking.priceSnapshotJson`

#### Security checks

- pricing edit/publish RBAC
- club scope on pricing versions and quote context

#### Audit events

- pricing publish actions
- (booking audit occurs in booking owner milestone)

#### Observability

- quote latency SLOs (PRD #24)
- quote error-code distributions
- contract test coverage for response shapes

#### Test plan

- Automation: `tests/contracts.api.test.mjs`, `tests/promo.api.test.mjs`, `tests/membership.api.test.mjs`
- Manual: publish pricing and compare quote/booking snapshot
- Negative: invalid promo + package ineligible

#### Evidence requirement

- Automated test logs + quote payload samples + booking snapshot verification

## Milestone #5: Schedule & Slot Generation

### 6.1 Owned scenarios

- `SCH-01` Publish schedule / slots

### 6.2 Supported scenarios

- `SCH-03`: supplies published slots for availability overlays
- `BK-01`: supplies bookable slot schedule windows
- `SEARCH-01`: supplies discoverable sessions/slots

<a id="sch-01-publish-scheduleslots"></a>
### SCH-01 + Publish schedule/slots

#### Outcome

- Schedule template + exceptions produce a published slot horizon consumable by discovery/availability/booking.

#### Preconditions

- Club exists with published map/pricing prerequisites where required.
- Tech admin permission for schedule edit/publish.

#### Main flow (happy path)

1. Configure schedule template.
2. Add exceptions (optional).
3. Publish slots horizon.
4. Read `/slots` for future dates.

#### Variants

- Re-publish extended horizon.
- Exception blocks a subset of slots.
- Overnight/special hours windows.

#### Failure modes

- Invalid template values.
- Exception overlaps invalidly.
- Publish without prerequisites.
- Duplicate slots on rerun (must be idempotent/protected).

#### Policies & rules

- Slot generation horizon bounded by policy
- Template lead time impacts booking eligibility
- Re-runs should avoid duplicate slot creation

#### State machine

- Slot statuses include `PUBLISHED`, `BLOCKED`, `CANCELLED_LOCKED`

#### API surface

- `GET/PUT /api/clubs/{clubId}/schedule/template`
- `POST /api/clubs/{clubId}/schedule/exceptions`
- `POST /api/clubs/{clubId}/schedule/publish`
- `GET /api/clubs/{clubId}/slots?date=...`

#### Data model touchpoints

- `ScheduleTemplate`
- `ScheduleException`
- `Slot`
- `AuditLog`

#### Security checks

- schedule edit/publish permissions
- club-scoped slot visibility for staff; public exposure via discovery endpoints only

#### Audit events

- template update
- exception add/remove
- schedule publish

#### Observability

- slot generation duration
- slot generation job success/failure
- slot counts generated

#### Test plan

- Automation: contract slots shape + integration suites using schedule publish setup
- Manual: template/exception publish and inspect slots horizon
- Negative: invalid exception/time windows

#### Evidence requirement

- Publish result + slot listing output + audit entry

## Milestone #6: Availability Service

### 6.1 Owned scenarios

- `SCH-03` Set seat unavailable / hold

### 6.2 Supported scenarios

- `BK-01`: real-time seat status gating for booking initiation
- `BK-03`: availability recovery after cancellation (dependency)

<a id="sch-03-set-seat-unavailablehold"></a>
### SCH-03 + Set seat unavailable/hold

#### Outcome

- Availability overlay shows correct seat status precedence and conflicting hold attempts are denied.

#### Preconditions

- Published slots exist.
- Published map/seat index exists.
- Hold endpoint enabled and actor authorized.

#### Main flow (happy path)

1. Client/host requests hold for seat-slot.
2. Hold is created with TTL.
3. Availability endpoint shows seat status as held.
4. Subsequent conflicting hold returns conflict.

#### Variants

- Staff hold vs client hold.
- Hold expiry returns seat to available.
- Booking conversion changes seat from held to booked.

#### Failure modes

- Seat already booked.
- Seat held by another user.
- Disabled seat.
- Past/unbookable slot.
- Lead-time cutoff block.

#### Policies & rules

- Hold TTL enforced
- Seat status precedence (disabled > booked > held > available)
- Booking lead-time and slot status gating
- Hold feature kill switch (`RELEASE_DISABLE_HOLDS`)

#### State machine

- Hold `ACTIVE` -> `CONVERTED` / `CANCELED` / `EXPIRED`
- Availability reflects hold and booking transitions

#### API surface

- `POST /api/clubs/{clubId}/holds`
- `GET /api/clubs/{clubId}/availability`
- Errors include `SEAT_NOT_AVAILABLE`, `SLOT_NOT_PUBLISHED`, conflict codes
- Idempotency supported on hold create route

#### Data model touchpoints

- `Hold`
- `Booking`
- `Slot`
- `SeatIndex`
- availability cache entries

#### Security checks

- staff permission `BOOKING_CREATE` for staff path
- client ownership context + published-club check
- club tenancy isolation

#### Audit events

- hold create/cancel/confirm transitions (via related routes)

#### Observability

- availability p95 / error rate
- hold create latency/conflict rates
- cache hit/miss (where enabled)
- load tests profiles B/C

#### Test plan

- Automation: contract availability shape, feature-flag hold disable, contention load profile
- Manual: hold create + overlay refresh + expiry
- Negative: double hold conflict / disabled seat

#### Evidence requirement

- API test output + availability payloads + contention load run summary

## Milestone #7: Booking Engine

### 6.1 Owned scenarios

- `BK-01` Book seat (pay later or no payment)
- `BK-03` Cancel booking (no refund)

### 6.2 Supported scenarios

- Downstream lifecycle for reschedule, membership, promos, admin actions

<a id="bk-01-book-seat-pay-later-or-no-payment"></a>
### BK-01 + Book seat (pay later or no payment)

#### Outcome

- Booking is created/confirmed, seat is reserved, price snapshot persists, audit is recorded.

#### Preconditions

- Actor authenticated (client or staff)
- Room/slot/seat and pricing inputs valid
- Availability permits booking/hold conversion

#### Main flow (happy path)

1. (Optional) Create hold for seat-slot.
2. Request booking create or hold confirm.
3. Quote is computed and persisted.
4. Booking row created (`CONFIRMED`), snapshots stored.
5. Membership/promo consumption applied if selected.
6. Audit event recorded.

#### Variants

- Direct room-time booking (no seat/slot)
- Hold confirm booking (seat-slot path)
- Staff walk-in booking with CRM auto-create customer
- Promo/membership adjusted totals

#### Failure modes

- Seat conflict / room-time overlap
- Pricing quote validation failure
- Promo usage limit reached
- Membership entitlement invalid/expired
- Permission denied / wrong club context

#### Policies & rules

- Uniqueness/conflict checks for seat-slot and room-time windows
- Idempotency on hold confirm and quote path
- Promo/membership feature kill switches
- Payment may remain pending (offline path)

#### State machine

- Booking `CONFIRMED` -> `CHECKED_IN` -> `COMPLETED`
- Booking `CONFIRMED` -> `CANCELED`
- Booking may be rescheduled via separate flow

#### API surface

- `POST /api/bookings`
- `POST /api/clubs/{clubId}/holds/{holdId}/confirm`
- `POST /api/pricing/quote` (dependency)
- Errors: pricing/promo/membership codes, `409` conflicts
- Idempotency: hold confirm supports idempotency keys

#### Data model touchpoints

- `Booking`
- `PriceQuote`
- `Hold`
- `Payment` (pending/offline ops)
- `Customer` (auto-link/create)
- `PromoRedemption`, membership ledgers (optional extensions)

#### Security checks

- RBAC for staff create
- client ownership and published-club checks
- club tenancy isolation
- anti-conflict constraints

#### Audit events

- `booking.created`
- `booking.created_from_hold`
- related hold confirmation audit events
- promo/membership audit events when applied

#### Observability

- booking create/confirm latency and 409/5xx rates
- booking conversion funnel (hold->confirm)
- critical logs with `clubId`, error code, request id

#### Test plan

- Automation: `tests/membership.api.test.mjs`, `tests/promo.api.test.mjs`, `tests/admin.api.test.mjs`
- Manual: client and host booking happy path
- Negative: conflict, promo usage limit, membership denial

#### Evidence requirement

- Test output demonstrating confirm + persistence + negative cases
- Audit event visibility for booking/admin cancellation actions

<a id="bk-03-cancel-booking-no-refund"></a>
### BK-03 + Cancel booking (no refund)

#### Outcome

- Booking is canceled with policy-compliant state transition and audit trail; no refund module required.

#### Preconditions

- Booking exists in cancellable state
- Actor has client ownership or staff/admin override permissions

#### Main flow (happy path)

1. Open booking.
2. Cancel booking with reason/policy path.
3. Booking status becomes `CANCELED`.
4. Availability and downstream ledgers update (membership reversal if applicable).

#### Variants

- Client self-cancel before cutoff
- Host/admin cancel with override reason
- Cancel after membership consumption triggers reversal

#### Failure modes

- Invalid state transition (already canceled/completed)
- Permission denied
- Policy cutoff denial
- Idempotent retry duplicate cancel request

#### Policies & rules

- Cancellation policy by club
- No refund execution in this scenario (`#12` not required)
- Audit required for override actions

#### State machine

- `CONFIRMED`/`CHECKED_IN` (policy-dependent) -> `CANCELED`
- no transition from `COMPLETED` to `CANCELED`

#### API surface

- booking update/cancel endpoints (and admin override cancel)
- Error codes for invalid state/policy/permission
- Idempotency expected on repeated cancel retries (safe no duplicate side effects)

#### Data model touchpoints

- `Booking.status`, cancellation metadata
- `AuditLog`
- availability derived state
- membership reversal transactions (if previously consumed)

#### Security checks

- client owns booking or staff/admin permission
- club scope enforcement

#### Audit events

- booking cancel event
- admin/platform override cancellation event with reason

#### Observability

- cancellation rate metrics
- policy-denial error codes
- cancellation-related audit visibility

#### Test plan

- Automation: admin override cancellation + audit; membership cancellation reversal path
- Manual: client no-refund cancellation happy path and denial case

#### Evidence requirement

- Cancel response + booking state verification + audit entry proof

## Milestone #14: Search & Discovery

### 6.1 Owned scenarios

- `SEARCH-01` Discover club/session and start booking

### 6.2 Supported scenarios

- none in current critical-path baseline (owner scenario only)

<a id="search-01-discover-clubsession-and-start-booking"></a>
### SEARCH-01 + Discover club/session and start booking

#### Outcome

- Client can discover a club/session and reach a valid booking initiation path.

#### Preconditions

- Club is published and discoverable.
- Schedule slots are published.

#### Main flow (happy path)

1. Client opens public clubs listing.
2. Filters/searches clubs and opens club detail.
3. Views sessions/slots availability summary.
4. Proceeds to booking flow start (slot/seat selection or booking page).

#### Variants

- Featured club path
- Event/featured listing path
- Filtered discovery by city/area/date

#### Failure modes

- Club paused/unpublished hidden from discovery
- No slots available
- Slot stale/unbookable by the time booking starts
- Public endpoint errors / pagination issues

#### Policies & rules

- Paused/suspended clubs should be hidden or blocked for booking start
- Featured visibility controlled by platform/club settings

#### State machine

- Club lifecycle impacts discoverability: `PUBLISHED` visible, `PAUSED/SUSPENDED` hidden/blocked

#### API surface

- `GET /api/clubs/public`
- `GET /api/clubs/public/{clubSlugOrId}`
- `GET /api/clubs/{clubId}/slots` (or public slot views)
- errors for not found/hidden club

#### Data model touchpoints

- `Club` status/featured fields
- `ClubFeatured`
- `Slot`

#### Security checks

- Public endpoints expose only allowed fields
- No tenant leakage of internal club/admin data

#### Audit events

- Optional analytics/audit for public discovery queries (non-blocking)
- platform featured changes audited under admin milestone

#### Observability

- discovery listing/detail latency
- conversion to booking start
- hidden/paused club access attempts

#### Test plan

- Automation: admin test verifies pause hides from public discovery and blocks booking
- Manual: browse -> filter -> open club -> start booking path
- Negative: paused club inaccessible

#### Evidence requirement

- Public discovery API responses before/after pause + booking block proof

