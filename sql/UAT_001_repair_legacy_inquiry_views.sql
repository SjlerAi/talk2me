-- Talk2Me UI UAT only: repair the three legacy inquiry views after phpMyAdmin clone import.
-- Evidence from the UAT clone:
--   v_today_inquiries      = BASE TABLE placeholder
--   v_yesterday_inquiries  = BASE TABLE placeholder
--   v_inquiry_daily_summary = absent
-- Production contains exactly these three objects as views.
-- Every object reference is fully qualified so phpMyAdmin cannot run the repair in information_schema.

DROP TABLE IF EXISTS `uent_Crm`.`v_today_inquiries`;
DROP TABLE IF EXISTS `uent_Crm`.`v_yesterday_inquiries`;
DROP VIEW IF EXISTS `uent_Crm`.`v_inquiry_daily_summary`;

CREATE SQL SECURITY INVOKER VIEW `uent_Crm`.`v_inquiry_daily_summary` AS
SELECT
  CAST(i.created_at AS DATE) AS inquiry_date,
  COALESCE(s.full_name,'Unassigned') AS staff_member,
  c.category_name AS category_name,
  COUNT(*) AS total_inquiries,
  SUM(i.status = 'resolved') AS resolved_count,
  SUM(i.status = 'open') AS open_count,
  SUM(i.status = 'follow_up') AS follow_up_count
FROM `uent_Crm`.`inquiries` i
LEFT JOIN `uent_Crm`.`staff_users` s ON s.id = i.staff_id
LEFT JOIN `uent_Crm`.`inquiry_categories` c ON c.id = i.category_id
GROUP BY CAST(i.created_at AS DATE), s.full_name, c.category_name;

CREATE SQL SECURITY INVOKER VIEW `uent_Crm`.`v_today_inquiries` AS
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
FROM `uent_Crm`.`inquiries` i
LEFT JOIN `uent_Crm`.`staff_users` s ON s.id = i.staff_id
LEFT JOIN `uent_Crm`.`workstations` w ON w.id = i.workstation_id
LEFT JOIN `uent_Crm`.`inquiry_categories` c ON c.id = i.category_id
WHERE CAST(i.created_at AS DATE) = CURDATE()
ORDER BY i.created_at DESC;

CREATE SQL SECURITY INVOKER VIEW `uent_Crm`.`v_yesterday_inquiries` AS
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
FROM `uent_Crm`.`inquiries` i
LEFT JOIN `uent_Crm`.`staff_users` s ON s.id = i.staff_id
LEFT JOIN `uent_Crm`.`workstations` w ON w.id = i.workstation_id
LEFT JOIN `uent_Crm`.`inquiry_categories` c ON c.id = i.category_id
WHERE CAST(i.created_at AS DATE) = CURDATE() - INTERVAL 1 DAY
ORDER BY i.created_at DESC;

SELECT TABLE_SCHEMA, TABLE_NAME
FROM information_schema.VIEWS
WHERE TABLE_SCHEMA = 'uent_Crm'
ORDER BY TABLE_NAME;
