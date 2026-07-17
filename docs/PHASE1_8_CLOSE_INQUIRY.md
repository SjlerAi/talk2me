# Talk2Me Phase 1.8 - Close Inquiry Patch

## Purpose
This patch cleans up the Customer Snapshot wording and adds the ability to close specific open inquiries directly from the snapshot.

## Changes
- Open/follow-up section now says **Open inquiries / follow-ups** instead of showing the category as if it is the inquiry title.
- Each open inquiry shows:
  - Inquiry text
  - Category
  - Action Taken
  - Due date
  - Staff member
- Adds **Close Inquiry** button for open/follow-up/waiting items.
- Closing an inquiry updates:
  - `status = resolved`
  - `completed_at = NOW()`
  - `completed_by = current logged-in staff user`
  - `updated_at = NOW()`
- Last Customer Interaction now displays **Inquiry** as the interaction type and shows the category separately.

## Install
1. Upload/extract this ZIP over `public_html/talk2me`.
2. No SQL migration required if Phase 1.7 was already imported.
3. Restart the Node.js app.

## Test
1. Login as staff.
2. Search a client with open inquiries.
3. Confirm the open item displays as an inquiry, not as only the category name.
4. Click **Close Inquiry**.
5. The snapshot should refresh and the item should no longer appear as open.
