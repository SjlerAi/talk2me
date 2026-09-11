# Talk2Me CRM Navigation Simplification Proposal — 11 Sep 2026

## Problem confirmed from current UI

The CRM exposes overlapping entry points for the same work. The persistent sidebar already contains Work and Management destinations, the Administration landing repeats many of the same functions, and the Shop Command Centre repeats search and several operational links again. This makes the system understandable to existing users who know where functions live, but difficult for a new or occasional user to navigate confidently.

## Design principle

Navigation should be organised around jobs people perform, not around historical modules or technical architecture.

A staff user should be able to answer three questions immediately:
1. Who am I working with?
2. What do I need to do for them?
3. What is waiting for me?

Management should have a second layer for team control, imports, approvals, reporting and settings.

## Proposed persistent navigation

### Staff navigation

1. **Home / My Day**
   - Today’s tasks
   - overdue work
   - new work
   - upgrade opportunities
   - recent customers

2. **Customers**
   - persistent global search remains the primary entry point
   - My Customers / My Accounts
   - unassigned customers available for claim where allowed
   - recent customers
   - create customer when not found

3. **Interactions**
   - replaces the current emphasis on a separate New Inquiry workflow
   - log call, walk-in, WhatsApp, email or other contact from inside Customer 360
   - no need to leave the customer to create a separate inquiry first

4. **Tasks & Follow-ups**
   - combines Messages & Tasks with customer callbacks/follow-ups
   - one queue for what must happen next
   - notifications remain visible but are not a separate navigation concept

5. **Upgrades / Opportunities**
   - current upgrade work and upcoming opportunities
   - opens customers in Customer 360

### Personal menu rather than main navigation

- My Attendance
- Profile
- Clock out / logout

Attendance remains available and automatic with login/logout, but should not consume a primary daily navigation position unless the business specifically wants it there.

## Management navigation

1. **Dashboard**
   - rename Shop Command Centre to Management Dashboard
   - one overview of team/work/opportunities/exceptions
   - remove duplicate global search from this screen because search is already persistent in the top bar

2. **Customers & Ownership**
   - customer administration
   - assignments / claims
   - ownership conflicts
   - fixed and mobile service context remains inside customer/service views

3. **Team**
   - staff
   - attendance register
   - leave
   - attendance corrections
   - working hours

4. **Operations**
   - approvals
   - monthly import
   - Base Details Centre
   - fixed-service administration where needed
   - legacy reconciliation only as a technical/exception tool

5. **Reports**
   - birthdays
   - upgrades
   - staff activity
   - inquiries/interactions
   - attendance
   - customer/export reports

6. **Settings**
   - system/admin configuration
   - launcher settings
   - security/access
   - audit logs
   - low-frequency technical tools

## Customer 360 should become the centre of work

Search result -> Customer 360 should be the normal flow.

Customer 360 should expose clear actions:
- Log Interaction
- Add Task / Follow-up
- Update Customer
- View/Change Ownership (permission controlled)
- View Services
- View Upgrade Opportunity
- View History

Suggested Customer 360 sections/tabs:
1. Summary
2. Services
3. Interactions
4. Tasks / Follow-ups
5. Opportunities / Upgrades
6. History / Audit

This reduces the need for staff to know whether an action historically belonged to Inquiry, Callback, Follow-up, Task, Upgrade Centre, Fixed Services or another module.

## Names to simplify

Current -> Proposed

- My Workspace -> **Home / My Day**
- Shop Command Centre -> **Management Dashboard**
- New Inquiry -> **Log Interaction** (preferably from Customer 360)
- Messages & Tasks -> **Tasks & Follow-ups**
- Client Assignment -> **Customers & Ownership** or My Customers for staff
- Attendance Register -> inside **Team**
- Administration -> **Settings / Admin** for true configuration only
- Work Centre -> absorb into Home/My Day and Management Dashboard if no unique workflow remains
- Sales Prospects -> merge into Customer lifecycle/prospect status
- Customer Callbacks / Follow-ups -> merge into Tasks & Follow-ups

## What should remain globally visible

Persistent top bar should contain only:
- Menu
- Customer search
- Tasks/notifications count
- Approvals count for management
- user/profile/clock-out control

Avoid exposing the same feature simultaneously in sidebar, top bar, command centre cards and Administration cards unless there is a strong workflow reason.

## Navigation target

Staff should need no more than 5 primary navigation choices.
Management should see no more than 6 primary management choices.
Low-frequency and technical functions should be one level deeper.

## Rollout safety

Phase 1 — information architecture and labels only; keep routes/data unchanged.
Phase 2 — make Customer 360 the action hub and add Log Interaction / Task / Follow-up actions.
Phase 3 — merge or hide duplicate low-use modules only after owner/manager acceptance.
Phase 4 — remove confirmed dead routes/assets after usage and dependency checks.

No database records should be deleted as part of navigation simplification. Hiding or consolidating navigation does not mean deleting historical data.
