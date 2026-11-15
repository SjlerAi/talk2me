-- UENT-only additive message read/reply evidence.
-- Existing message text and original read cursors remain unchanged.
CREATE TABLE IF NOT EXISTS staff_chat_read_receipts (
  message_id BIGINT UNSIGNED NOT NULL,
  staff_id BIGINT UNSIGNED NOT NULL,
  conversation_key VARCHAR(80) NOT NULL,
  read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id,staff_id),
  KEY idx_staff_chat_receipt_staff_date (staff_id,read_at),
  KEY idx_staff_chat_receipt_conversation (conversation_key,staff_id,read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_chat_reply_links (
  reply_message_id BIGINT UNSIGNED NOT NULL,
  incoming_message_id BIGINT UNSIGNED NOT NULL,
  replying_staff_id BIGINT UNSIGNED NOT NULL,
  linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reply_message_id),
  KEY idx_staff_chat_reply_incoming (incoming_message_id,replying_staff_id),
  KEY idx_staff_chat_reply_staff_date (replying_staff_id,linked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
