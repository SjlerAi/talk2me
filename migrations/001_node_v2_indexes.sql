-- Optional performance indexes for Node.js v2.0.0.
-- Run only after a fresh database backup. Safe to skip for the first test.
ALTER TABLE work_sessions ADD INDEX idx_ws_user_open (user_id, session_status, clock_out_time);
ALTER TABLE work_sessions ADD INDEX idx_ws_date_user (session_date, user_id);
ALTER TABLE work_session_events ADD INDEX idx_wse_session_type (work_session_id, event_type);
