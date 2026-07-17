# Talk2Me Phase 1.5B - Auto Customer Snapshot

This patch improves the New Query search behaviour.

## What changed

- Exact cell/account/email/ID searches now load the customer snapshot automatically.
- If only one result is found, it also loads automatically.
- Search results now show package, handset and upgrade date before clicking.
- The result row has a clear Load button.
- Pressing Enter loads the first result.
- Client name, cell and email auto-fill after selection.

## Install

1. Upload/extract this ZIP over `public_html/talk2me`.
2. No SQL migration is needed for this patch if `008_customer_snapshot_indexes.sql` was already imported.
3. Restart the Node.js app in cPanel.
4. Test with cell number `0790219426`.

Expected result: FREEPAK CC loads automatically and the Customer Snapshot shows account, lines/contracts, upgrade date, package, handset, monthly amount and last shop contact.
