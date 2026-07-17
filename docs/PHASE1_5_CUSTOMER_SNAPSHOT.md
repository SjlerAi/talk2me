# Talk2Me Phase 1.5 - Customer Snapshot

This patch adds the Customer Snapshot to the New Query screen.

## What it shows

- Number of linked lines/contracts found
- Next upgrade date
- Package and handset
- Monthly amount
- Last shop contact
- Last query category and note
- Staff member who handled the previous query

## Install

1. Upload/extract this ZIP over `public_html/talk2me`.
2. Import `migrations/008_customer_snapshot_indexes.sql` in phpMyAdmin.
3. Restart the Node.js app.
4. Login as staff and search a customer on New Query.

## How line count works

The system links lines by matching account number first, then ID number, email, or cell number where available.
