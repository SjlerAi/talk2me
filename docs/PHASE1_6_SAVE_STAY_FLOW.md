# Talk2Me Phase 1.6 - Save Stay Flow

## What this patch changes

- Query save now uses AJAX instead of a normal page redirect.
- Staff stay on the New Query screen after saving.
- The loaded customer snapshot stays visible after save.
- A green saved notice appears.
- If there is no activity for 60 seconds after save, the screen clears itself and becomes ready for the next customer.
- If the staff member types, changes the category, edits notes, or chooses a follow-up action, the auto-clear timer is cancelled.
- Added a second button: Save & New Customer.

## Install

1. Upload/extract this ZIP over `public_html/talk2me`.
2. No SQL migration is required.
3. Restart the Node.js app in cPanel.

## Test

1. Login as a staff user.
2. Search/select a client.
3. Add a follow-up date and save.
4. The system should remain on the same query screen.
5. Wait 60 seconds without touching anything. The form should clear and be ready for the next customer.
