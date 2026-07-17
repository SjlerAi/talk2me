-- Talk2Me Phase 1 real staff email fix
-- Import this after 006_add_shop_staff_and_login_flow.sql
-- Database: uent_talk2me_crm

START TRANSACTION;

UPDATE staff_users
SET full_name = 'Johnny', username = 'johnny', email = 'jonathan@talk-online.co.za', role = 'staff', is_active = 1
WHERE username = 'johnny' OR email IN ('johnny@talk2me.local', 'jonathan@talk-online.co.za');

UPDATE staff_users
SET full_name = 'Sias', username = 'sias', email = 'sias@talk-online.co.za', role = 'staff', is_active = 1
WHERE username = 'sias' OR email IN ('sias@talk2me.local', 'sias@talk-online.co.za');

UPDATE staff_users
SET full_name = 'Annazel', username = 'annazel', email = 'annazel@talk-online.co.za', role = 'staff', is_active = 1
WHERE username = 'annazel' OR email IN ('annazel@talk2me.local', 'annazel@talk-online.co.za');

UPDATE staff_users
SET full_name = 'Brabant', username = 'brabant', email = 'sales3@talk-online.co.za', role = 'staff', is_active = 1
WHERE username = 'brabant' OR email IN ('brabant@talk2me.local', 'sales3@talk-online.co.za');

UPDATE staff_users
SET full_name = 'van Zyl', username = 'vanzyl', email = 'sales4@talk-online.co.za', role = 'staff', is_active = 1
WHERE username IN ('van zyl', 'vanzyl') OR email IN ('vanzyl@talk2me.local', 'sales4@talk-online.co.za');

COMMIT;
