-- Talk2Me UI UAT only: repair legacy inquiry views after phpMyAdmin clone import.
-- The production export used a hard-coded DEFINER that a separate UAT DB user cannot impersonate.
-- These CREATE VIEW statements deliberately omit DEFINER so the executing UAT DB user owns them.

DROP TABLE IF EXISTS v_today_inquiries;
DROP TABLE IF EXISTS v_yesterday_inquiries;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_inquiry_daily_summary AS
SELECT
  CAST(i.created_at AS DATE) AS inquiry_date,
  COALESCE(s.full_name,'Unassigned') AS staff_member,
  c.category_name AS category_name,
  COUNT(*) AS total_inquiries,
  SUM(i.status = 'resolved') AS resolved_count,
  SUM(i.status = 'open') AS open_count,
  SUM(i.status = 'follow_up') AS follow_up_count
FROM inquiries i
LEFT JOIN staff_users s ON s.id = i.staff_id
LEFT JOIN inquiry_categories c ON c.id = i.category_id
GROUP BY CAST(i.created_at AS DATE), s.full_name, c.category_name;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_today_inquiries AS
SELECT
  i.id,
  i.created_at,
  COALESCE(s.full_name,'Unassigned') AS staff_member,
  COALESCE(w.workstation_name,'No workstation') AS workstation,
  i.client_name,
  i.cell_number,
  i.email,
  c.category_name,
  i.category_other,
  i.result_found,
  i.action_taken,
  i.status,
  i.follow_up_at
FROM inquiries i
LEFT JOIN staff_users s ON s.id = i.staff_id
LEFT JOIN workstations w ON w.id = i.workstation_id
LEFT JOIN inquiry_categories c ON c.id = i.category_id
WHERE CAST(i.created_at AS DATE) = CURDATE();

CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_yesterday_inquiries AS
SELECT
  i.id,
  i.created_at,
  COALESCE(s.full_name,'Unassigned') AS staff_member,
  COALESCE(w.workstation_name,'No workstation') AS workstation,
  i.client_name,
  i.cell_number,
  i.email,
  c.category_name,
  i.category_other,
  i.result_found,
  i.action_taken,
  i.status,
  i.follow_up_at
FROM inquiries i
LEFT JOIN staff_users s ON s.id = i.staff_id
LEFT JOIN workstations w ON w.id = i.workstation_id
LEFT JOIN inquiry_categories c ON c.id = i.category_id
WHERE CAST(i.created_at AS DATE) = CURDATE() - INTERVAL 1 DAY;
