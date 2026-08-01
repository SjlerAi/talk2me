-- Talk2Me OS2 preview only: service lifecycle completeness
ALTER TABLE os2_mobile_lines
  ADD COLUMN cancellation_reason VARCHAR(1000) NULL AFTER cancellation_date,
  ADD INDEX idx_mobile_lifecycle_status (master_customer_id,line_status,cancellation_date);

ALTER TABLE os2_fixed_services
  ADD COLUMN cancellation_date DATE NULL AFTER service_status,
  ADD COLUMN cancellation_reason VARCHAR(1000) NULL AFTER cancellation_date,
  ADD INDEX idx_fixed_lifecycle_status (service_status,cancellation_date);
