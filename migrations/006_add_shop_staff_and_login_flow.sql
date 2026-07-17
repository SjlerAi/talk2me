-- Talk2Me Phase 1 staff users for shop testing
-- Import this after the app is already deployed and the Phase 1 database is live.

ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS username VARCHAR(80) NULL AFTER full_name;

UPDATE staff_users
SET username = 'owner'
WHERE email = 'owner@talk2me.local' AND (username IS NULL OR username = '');

INSERT INTO staff_users (full_name, username, email, role, password_hash, is_active)
VALUES
('Johnny', 'johnny', 'johnny@talk2me.local', 'staff', '$2a$10$92Yn4mvKe7/JjE0Vc61iaOZOmBbo/r0saz2DStgx9E4qW5tFBRICC', 1),
('Brabant', 'brabant', 'brabant@talk2me.local', 'staff', '$2a$10$49bjYrQiecWCNiJe.mR/C.tZZHNWH0uyjyUIBRbqm3Zg79tmgGY7a', 1),
('van Zyl', 'van zyl', 'vanzyl@talk2me.local', 'staff', '$2a$10$ldJU42LbWHCDGLIUh451o.wA6YpjD1rlC80EoczQEwPfW5p0YKKqe', 1),
('Sias', 'sias', 'sias@talk2me.local', 'staff', '$2a$10$7iC7m/I8VP049dd4iPyAUeihZExxe4HfyXr01KpJTRGRM2KDilfQO', 1),
('Annazel', 'annazel', 'annazel@talk2me.local', 'staff', '$2a$10$6ebQJEpOhB2acVVEWoVe6uhC1s10NFNZKiM/FROF8XUtFl4XcqNB6', 1)
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  username = VALUES(username),
  role = VALUES(role),
  password_hash = VALUES(password_hash),
  is_active = 1;
