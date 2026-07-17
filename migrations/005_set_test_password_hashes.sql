-- Optional but recommended after app test install.
-- Sets bcrypt password hashes for the default users.
-- owner@talk2me.local / Talk2Me@2026
-- staff1@talk2me.local / Staff@2026
-- staff2@talk2me.local / Staff@2026

UPDATE staff_users
SET password_hash = '$2a$10$x71BKf7qcHDt9/k0eZ5G.euUY4BUCDXChRrHnEt19jVRVz33VZxoa'
WHERE email = 'owner@talk2me.local';

UPDATE staff_users
SET password_hash = '$2a$10$ZLH8pM4VawC1fn6M8T0xEuCEuI.z8aVL9t9QESRMsdUoMLJ0AfdCq'
WHERE email IN ('staff1@talk2me.local','staff2@talk2me.local');
