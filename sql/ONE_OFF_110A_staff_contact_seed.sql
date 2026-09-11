-- Talk2Me PR #110A - owner-supplied staff contact details
-- REVIEWED ONE-OFF SQL ONLY. Back up production before applying.
-- This fills blank staff contact numbers only; it never overwrites an existing non-blank number.
-- External report/agent aliases are maintained through Staff Management once the foundation schema exists.

UPDATE staff_users SET contact_number=COALESCE(NULLIF(TRIM(contact_number),''),'060 979 1234') WHERE LOWER(email)='jonathan@talk-online.co.za';
UPDATE staff_users SET contact_number=COALESCE(NULLIF(TRIM(contact_number),''),'064 931 5043') WHERE LOWER(email)='annazel@talk-online.co.za';
UPDATE staff_users SET contact_number=COALESCE(NULLIF(TRIM(contact_number),''),'067 586 2527') WHERE LOWER(email)='sales3@talk-online.co.za';
UPDATE staff_users SET contact_number=COALESCE(NULLIF(TRIM(contact_number),''),'066 390 4422') WHERE LOWER(email)='sales4@talk-online.co.za';
UPDATE staff_users SET contact_number=COALESCE(NULLIF(TRIM(contact_number),''),'079 497 9287') WHERE LOWER(email)='sias@talk-online.co.za';
UPDATE staff_users SET contact_number=COALESCE(NULLIF(TRIM(contact_number),''),'072 830 1373') WHERE LOWER(email)='gerhard@talk-online.co.za';

-- Read-only verification:
-- SELECT full_name,email,contact_number FROM staff_users
-- WHERE LOWER(email) IN ('jonathan@talk-online.co.za','annazel@talk-online.co.za','sales3@talk-online.co.za','sales4@talk-online.co.za','sias@talk-online.co.za','gerhard@talk-online.co.za')
-- ORDER BY full_name;
