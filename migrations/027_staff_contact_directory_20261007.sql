-- Talk2Me UAT staff contact directory supplied by management on 2026-10-07.
-- Updates existing active staff records only; does not create login accounts or passwords.
-- contact_number is stored in local South African display format. External adapters
-- normalise it to E.164 (+27...) at send time.

START TRANSACTION;

UPDATE staff_users
SET full_name='Gertruida Johanna Le Roux',
    first_name='Gertruida Johanna',
    surname='Le Roux',
    email='gerda@talk-online.co.za',
    contact_number='0829222877',
    updated_at=NOW()
WHERE username IN ('gerda','gertruida')
   OR email='gerda@talk-online.co.za'
   OR full_name IN ('Gerda','Gertruida Johanna Le Roux');

UPDATE staff_users
SET full_name='Jonathan Olivier',
    first_name='Jonathan',
    surname='Olivier',
    email='jonathan@talk-online.co.za',
    contact_number='0795489561',
    updated_at=NOW()
WHERE username IN ('johnny','jonathan')
   OR email='jonathan@talk-online.co.za'
   OR full_name IN ('Johnny','Jonathan','Jonathan Olivier');

UPDATE staff_users
SET full_name='Annazel Lategan',
    first_name='Annazel',
    surname='Lategan',
    email='annazel@talk-online.co.za',
    contact_number='0764810410',
    updated_at=NOW()
WHERE username='annazel'
   OR email='annazel@talk-online.co.za'
   OR full_name IN ('Annazel','Annazel Lategan');

UPDATE staff_users
SET full_name='Brabant Allan Van Onselen',
    first_name='Brabant Allan',
    surname='Van Onselen',
    email='sales3@talk-online.co.za',
    contact_number='0675862527',
    updated_at=NOW()
WHERE username='brabant'
   OR email='sales3@talk-online.co.za'
   OR full_name IN ('Brabant','Brabant Allan Van Onselen');

UPDATE staff_users
SET full_name='Van Zyl Hetzel',
    first_name='Van Zyl',
    surname='Hetzel',
    email='sales4@talk-online.co.za',
    contact_number='0663904422',
    updated_at=NOW()
WHERE username IN ('vanzyl','van zyl')
   OR email='sales4@talk-online.co.za'
   OR full_name IN ('van Zyl','Van Zyl','Van Zyl Hetzel');

UPDATE staff_users
SET full_name='Esias Booyens',
    first_name='Esias',
    surname='Booyens',
    email='sias@talk-online.co.za',
    contact_number='0794979287',
    updated_at=NOW()
WHERE username IN ('sias','esias')
   OR email='sias@talk-online.co.za'
   OR full_name IN ('Sias','Esias','Esias Booyens');

UPDATE staff_users
SET full_name='Gerhard van der Westhuizen',
    first_name='Gerhard',
    surname='van der Westhuizen',
    email='gerhard@talk-online.co.za',
    contact_number='0728301373',
    updated_at=NOW()
WHERE username='gerhard'
   OR email='gerhard@talk-online.co.za'
   OR full_name IN ('Gerhard','Gerhard van der Westhuizen');

COMMIT;
