-- TK2M Account Intelligence - proposed, NOT approved for production migration.
-- Additive only; no writes to customer_accounts, clients, assignments or payments.
CREATE TABLE IF NOT EXISTS account_intelligence_documents (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 account_number VARCHAR(40) NOT NULL,
 account_id BIGINT UNSIGNED NULL,
 original_filename VARCHAR(200) NOT NULL,
 stored_filename CHAR(36) NOT NULL,
 document_sha256 CHAR(64) NOT NULL,
 document_kind ENUM('statement','invoice') NOT NULL DEFAULT 'statement',
 source_customer_name VARCHAR(140) NULL,
 invoice_number VARCHAR(45) NULL,
 total_cents BIGINT NULL,
 source_date DATE NULL,
 extraction_warnings TEXT NULL,
 uploaded_by BIGINT UNSIGNED NOT NULL,
 uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_ai_account_hash (account_number,document_sha256),
 KEY idx_ai_account_uploaded (account_number,uploaded_at),
 KEY idx_ai_account_id (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_intelligence_entries (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 document_id BIGINT UNSIGNED NOT NULL,
 billing_month CHAR(7) NOT NULL,
 transaction_date VARCHAR(10) NOT NULL,
 transaction_type VARCHAR(8) NOT NULL,
 category ENUM('invoice','credit','payment','journal') NOT NULL,
 item_number VARCHAR(80) NOT NULL,
 source_reference VARCHAR(80) NOT NULL DEFAULT '',
 match_key VARCHAR(110) NOT NULL,
 amount_cents BIGINT NOT NULL,
 source_line INT UNSIGNED NOT NULL,
 UNIQUE KEY uq_ai_doc_line (document_id,source_line),
 KEY idx_ai_doc_period (document_id,billing_month),
 KEY idx_ai_match_key (match_key),
 CONSTRAINT fk_ai_entry_document FOREIGN KEY (document_id)
   REFERENCES account_intelligence_documents(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_intelligence_reviews (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 account_number VARCHAR(40) NOT NULL,
 prior_month CHAR(7) NOT NULL,
 current_month CHAR(7) NOT NULL,
 match_key VARCHAR(110) NOT NULL,
 status ENUM('pending','verified','investigate') NOT NULL DEFAULT 'pending',
 reason TEXT NULL,
 reviewer_id BIGINT UNSIGNED NOT NULL,
 reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_ai_review (account_number,prior_month,current_month,match_key),
 KEY idx_ai_review_account (account_number,current_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stores only management-confirmed, exact-number CRM account identities.
-- This never changes an existing customer/line or its current staff assignment.
CREATE TABLE IF NOT EXISTS account_intelligence_account_links (
 account_number VARCHAR(40) NOT NULL PRIMARY KEY,
 crm_account_id BIGINT UNSIGNED NOT NULL,
 confirmed_by BIGINT UNSIGNED NOT NULL,
 confirmed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_ai_link_crm (crm_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Management drafts are not outbox messages; no automatic external sending.
CREATE TABLE IF NOT EXISTS account_intelligence_email_drafts (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 account_number VARCHAR(40) NOT NULL,
 billing_month CHAR(7) NOT NULL,
 recipient_email VARCHAR(254) NULL,
 subject VARCHAR(180) NOT NULL,
 body TEXT NOT NULL,
 edited_by BIGINT UNSIGNED NOT NULL,
 edited_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_ai_email_account_month (account_number,billing_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
