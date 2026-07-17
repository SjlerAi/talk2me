# Talk2Me CRM v3.2.2 — staff account actions

Customer 360 now presents one consistent action row:

1. New Inquiry
2. Add Mobile Line
3. Add Fixed Service
4. Request Claim, when the account is unassigned

Request Claim is a one-click request. No reason is required. Proposed Change was removed from the header.

Owner and manager additions are saved immediately. Staff mobile-line and fixed-service additions are stored as pending approval requests. They only become permanent after an owner or manager approves them. Duplicate mobile lines are blocked and approved additions are written to Audit History.

No additional database migration is required after the v3.2.0 migration 023.
