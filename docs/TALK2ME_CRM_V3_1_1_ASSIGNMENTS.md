# Talk2Me CRM v3.1.1 — Client assignments

This release adds visible owner/manager assignment control to Customer 360 and completes assignment handling on the Add Client and Edit Client forms.

## Access

- Owner: can assign and unassign clients.
- Manager: can assign and unassign clients.
- Staff: can see the assigned staff member but cannot change it.

## Assignment scope

- When an account number exists, the assignment applies to all mobile lines with that account number.
- Without an account number, it applies to the individual client record.
- Selecting Unassigned closes the active assignment and returns the customer to the Unassigned management view.

Each assignment change is recorded in Audit History with the old staff member, new staff member, person making the change, time, and whether the assignment was account-wide or client-specific.

No database migration is required when upgrading from v3.1.0 to v3.1.1.
