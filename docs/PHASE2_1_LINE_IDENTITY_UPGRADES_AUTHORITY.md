# Talk2Me CRM Phase 2.1

This module safely extends the existing CRM without deleting or recreating data.

## Included

- Normalised South African cellphone number for line matching.
- True previous upgrade date recovered from `raw_import_json.previous_upgrade_date`.
- Existing calculated `upgrade_date` remains available so current dashboards and emails continue working.
- Explicit 24/36 month contract term.
- Calculated `next_upgrade_date`.
- Line status: active, inactive, cancelled, suspended or unknown.
- Authorised account-contact details and authority status.
- Account authority changes propagate to every line with the same account number.
- Valid SA ID birthdays derived from digits 1–6 (`YYMMDD`) with corrections logged.
- Exact phone matches ranked first in client search.
- Quick Add stores the normalised number and avoids format-based duplicates.

## Deployment order

1. Back up the live database.
2. Run `migrations/018_client_line_identity_and_authority.sql` once.
3. Upload the changed application files using their paths in this package.
4. Restart the Node application.
5. Test client search with `082...`, `2782...` and `+2782...` versions of the same number.
6. Open an existing client and confirm previous/next upgrade dates.
7. Confirm an ID number automatically supplies the correct birthday.

Imported records default to 24 months. Staff can select 36 months for a SIM contract. No automatic SIM classification is applied until the business rule is confirmed.
