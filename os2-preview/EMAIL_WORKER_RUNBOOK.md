# Talk2Me OS2 Preview Email Worker Runbook

## Purpose

This runbook governs queued email delivery for the isolated preview application at `talk2me.kloka.co.za`.

Production at `talk2me.uent.co.za` remains untouched. The worker must never use the production database, unrestricted production recipient lists, or production deployment authority.

## Fixed identity

```text
application:       talk2me-os2-preview
database:          kloka_talk2me
branch:            agent/talk2me-os2-integrated-rebuild
Node.js:           20.x
default attempts:  7
stale claim age:   15 minutes
```

## Required environment

```text
DB_HOST=localhost
DB_PORT=3306
DB_USER=kloka_talk
DB_PASSWORD=...
DB_NAME=kloka_talk2me
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild

EMAIL_WORKER_ENABLED=true
EMAIL_DB_CONNECTION_LIMIT=4
EMAIL_MAX_ATTEMPTS=7
EMAIL_WORKER_INTERVAL_MS=30000
EMAIL_WORKER_BATCH_SIZE=10
EMAIL_WORKER_RUN_ONCE=false
EMAIL_PREVIEW_RECIPIENT_ALLOWLIST=tester@example.com,@test.example.com

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=preview@example.com
SMTP_PASSWORD=...
SMTP_FROM=Talk2Me Preview <preview@example.com>
SMTP_REPLY_TO=support@example.com
SMTP_MESSAGE_ID_DOMAIN=example.com
SMTP_MAX_CONNECTIONS=2
SMTP_MAX_MESSAGES=100

ALLOW_PRODUCTION_MUTATION=false
ENABLE_CUSTOMER_MERGE_EXECUTION=false
```

The preview recipient allowlist is mandatory. Entries are comma-separated exact email addresses or domains beginning with `@`. A queued recipient that does not match is permanently failed before SMTP delivery.

Only these SMTP combinations are accepted:

```text
port 465 + SMTP_SECURE=true
port 587 + SMTP_SECURE=false + required STARTTLS
```

`SMTP_ALLOW_INVALID_CERT=true` is prohibited.

## Sixty governed controls

1. The exact preview database identity is required.
2. The exact controlled branch identity is required.
3. The default maximum delivery-attempt count is seven.
4. The stale-claim threshold is fifteen minutes.
5. Complete SMTP configuration includes a preview recipient allowlist.
6. Explicit email-worker enablement is required.
7. Production mutation is prohibited.
8. Customer-merge execution is prohibited.
9. Invalid SMTP certificate overrides are prohibited.
10. SMTP ports are limited to 465 and 587.
11. SMTP port and implicit-TLS mode must agree.
12. SMTP host values are validated and bounded.
13. SMTP user is required and bounded.
14. SMTP password is required and never logged.
15. The From mailbox is parsed and validated.
16. Reply-To is independently parsed and validated.
17. The deterministic Message-ID domain is validated.
18. A non-empty preview recipient allowlist is mandatory.
19. Exact email-address allowlist entries are supported.
20. Domain allowlist entries are supported.
21. Recipient emails are normalized deterministically.
22. Database port is restricted to 1–65,535.
23. Database pool size is restricted to 2–10 connections.
24. SMTP pool size is restricted to 1–5 connections.
25. Messages per SMTP pooled connection are restricted to 10–1,000.
26. Delivery attempts are restricted to 1–10.
27. Worker polling interval is restricted to 10 seconds–1 hour.
28. Delivery batch size is restricted to 1–50 rows.
29. Run-once mode uses strict Boolean parsing.
30. SMTP certificates must pass validation.
31. TLS 1.2 is the minimum permitted transport version.
32. STARTTLS is mandatory on port 587.
33. SMTP file access is disabled.
34. SMTP URL access is disabled.
35. SMTP protocol logging and debug output are disabled.
36. DNS, connection, greeting, and socket timeouts are bounded.
37. Every database connection sets UTC.
38. Every database connection verifies `DATABASE()` and connection identity.
39. Queue claiming uses `SERIALIZABLE` isolation.
40. Pending rows with null or due `next_attempt_at` values are claimable.
41. Each candidate row is locked before claim.
42. Every claim transition requires exactly one affected row.
43. Stale processing claims become failed instead of being silently replayed.
44. Notifications linked to stale uncertain claims become failed.
45. Subjects reject header injection and enforce character and byte bounds.
46. Plain-text and HTML bodies have separate byte limits.
47. Every claimed recipient is rechecked against the preview allowlist.
48. Related entity type and ID are validated before delivery.
49. Every queue row receives a deterministic preview Message-ID.
50. The SMTP envelope fixes one sender and one recipient.
51. Named recipients use Nodemailer's `address` field.
52. Generated messages contain no CC, BCC, or attachments.
53. Raw SMTP prose is reduced to a bounded error code.
54. Only defined connection failures and SMTP 4xx responses are retryable.
55. Retry backoff follows 2, 5, 15, 30, 60, 180, and 360 minutes.
56. Sent-state persistence requires exact worker ownership.
57. Failed-state persistence requires exact worker ownership.
58. Queue and linked-notification state changes are transactional.
59. Recursive scheduling prevents overlapping worker cycles.
60. Graceful shutdown waits for the current delivery cycle.

## Queue contract

The worker reads `os2_email_queue` rows created by governed application workflows. A claim is eligible only when:

```text
status = pending
next_attempt_at is null or due
attempts < configured maximum
```

Claiming:

- locks one row with `FOR UPDATE`;
- records the cryptographically random worker ID;
- increments attempts;
- sets `processing_started_at`;
- clears the previous controlled failure code;
- requires the row still to be pending and unchanged.

A row that fails validation after claim is permanently failed without contacting SMTP.

## Recipient containment

The worker is designed for preview delivery containment. Configure the narrowest possible allowlist, preferably exact test addresses.

Examples:

```text
single address:
EMAIL_PREVIEW_RECIPIENT_ALLOWLIST=stephan.test@example.com

multiple exact addresses:
EMAIL_PREVIEW_RECIPIENT_ALLOWLIST=first@example.com,second@example.com

test domain:
EMAIL_PREVIEW_RECIPIENT_ALLOWLIST=@test.example.com
```

Do not use a broad customer domain until controlled preview evidence proves the complete queue and delivery flow.

## SMTP security

The SMTP transport enforces:

- certificate validation;
- TLS 1.2 minimum;
- STARTTLS for port 587;
- implicit TLS for port 465;
- file and URL access disabled;
- protocol logger and debug output disabled;
- ten-second DNS, connection, and greeting timeouts;
- forty-five-second socket timeout;
- bounded pooled connections and messages.

SMTP credentials, message bodies, subjects, recipients, and provider responses must not be written to operational logs.

## Message construction

Each message uses:

```text
Message-ID: <talk2me-preview-queue-{queue_id}@{configured_domain}>
X-Talk2Me-Environment: preview
X-Talk2Me-Queue-ID: {queue_id}
```

The deterministic Message-ID improves investigation and downstream duplicate detection. It does not guarantee exactly-once SMTP delivery.

The envelope sender is the validated `SMTP_FROM` address. The envelope contains exactly one recipient. Queue content cannot add CC, BCC, attachments, local files, remote URLs, or alternative envelope addresses.

## Delivery result handling

### Successful SMTP acceptance

The worker stores:

```text
status = sent
sent_at
provider_message_id
worker_id = null
processing_started_at = null
failure_reason = null
```

The update requires the same queue ID, `processing` state, and exact worker ID. A linked notification is moved to `sent` in the same transaction.

### Explicit retryable failure

Only defined connection failures and SMTP 4xx responses are retried. The row returns to `pending` using bounded backoff.

### Terminal failure

Invalid recipients, allowlist violations, malformed queue content, authentication problems, SMTP 5xx responses, exhausted attempts, and uncertain stale processing states become `failed`.

Raw SMTP response text is never persisted. Only a bounded code such as `EAUTH`, `EDNS`, `SMTP_421`, or `SMTP_SEND_FAILED` is stored.

## Stale-processing policy

A processing claim older than fifteen minutes represents an uncertain delivery state. The SMTP server may have accepted the message even if the worker failed before recording success.

The worker therefore marks stale processing claims as:

```text
status = failed
failure_reason = STALE_PROCESSING_STATE_UNCERTAIN
```

It does not automatically replay them. This prevents blind duplicate delivery. An authorised operator must inspect the queue record, SMTP evidence, deterministic Message-ID, and linked notification before deciding on a new email.

## Runtime lifecycle

The standalone runner:

- sets umask `077`;
- loads and freezes validated configuration;
- creates a bounded database pool with keepalive disabled;
- verifies the preview database before starting SMTP work;
- schedules the next cycle only after the current cycle finishes;
- supports controlled `EMAIL_WORKER_RUN_ONCE=true` operation;
- handles `SIGTERM` and `SIGINT` once;
- waits for the active delivery cycle;
- closes SMTP transport;
- closes the database pool;
- reduces uncaught exception and rejection logs to safe codes.

Start command:

```bash
npm run start:email-worker
```

The web application and email worker must remain separate managed processes.

## Controlled activation sequence

1. Confirm the exact controlled branch and intended commit.
2. Complete dependency-lock generation and controlled adoption.
3. Require the adoption workflow and normal preview CI to pass.
4. Generate and verify the preview database backup.
5. Complete isolated restore testing.
6. Apply approved migrations through the governed migration process.
7. Verify migrations 006 and 007 and the email queue schema.
8. Run the complete `npm run check` suite.
9. Configure a narrow preview recipient allowlist.
10. Configure preview-only SMTP credentials.
11. Start with `EMAIL_WORKER_RUN_ONCE=true`.
12. Queue one email to an exact allowlisted test address.
13. Verify the queue claim, SMTP receipt, provider message ID, linked notification, and safe logs.
14. Test an address outside the allowlist and require terminal rejection before SMTP.
15. Test a controlled SMTP 4xx response and verify backoff.
16. Test a controlled SMTP 5xx response and verify terminal failure.
17. Test graceful shutdown during an idle cycle.
18. Test stale processing policy without resending the message.
19. Record all evidence in GitHub Issue #83.
20. Enable recurring preview operation only after single-run evidence passes.

## Verification evidence

Require evidence that:

- the worker refuses every database except `kloka_talk2me`;
- the worker refuses every branch except the controlled rebuild branch;
- production and merge-execution flags remain false;
- SMTP certificate validation cannot be bypassed;
- recipients outside the preview allowlist never reach SMTP;
- header injection is rejected;
- body limits are enforced;
- queue claiming is atomic;
- worker ownership protects sent and failed transitions;
- linked notification changes are transactional;
- only approved retry categories return to pending;
- stale uncertain claims are not replayed;
- deterministic Message-ID and provider message ID are retained;
- logs contain queue IDs and safe codes only;
- shutdown waits for active delivery and closes both resources.

## Incident handling

Stop the worker immediately when:

- database or branch identity differs;
- production mutation or customer-merge execution is enabled;
- SMTP certificate validation fails;
- an unallowlisted recipient receives email;
- message content appears in logs;
- queue ownership checks fail;
- repeated stale processing claims appear;
- a terminal failure returns to pending;
- a linked notification disagrees with queue state;
- graceful shutdown does not complete.

Preserve the queue row, linked notification, provider Message-ID, deterministic Message-ID, safe error code, runtime timestamps, and relevant audit evidence. Do not expose SMTP credentials or message content in the incident record.

## Execution boundary

`email-worker-check.js` contains exactly 60 named source and pure-function controls, plus supporting migration, runner, package, and runbook checks.

Normal validation syntax-checks the worker and runner and executes source governance. It does not connect to MySQL, connect to SMTP, claim queue rows, send email, alter notification status, run migrations, deploy preview, restart preview, or perform UAT.
