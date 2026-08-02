# Privacy request governance runbook

Status: source-only governance controls for the controlled preview branch.

## Scope

This runbook covers the privacy request, consent, export authorization, export metadata, revocation and retention-decision routes in `privacy-routes.js`, together with their authenticated mounting through `security-routes.js`.

## Sixty governed controls

1. Authenticated privacy route boundary.
2. Privacy read permission.
3. Privacy manage permission.
4. Privacy decide permission.
5. Privacy export permission.
6. Privacy retention permission.
7. Positive safe-integer identifiers.
8. Bounded text and control-character rejection.
9. Cryptographically random request references.
10. Bounded fallback error responses.
11. Customer-scoped consent reads.
12. Bounded consent result sets.
13. Locked active-customer selection.
14. Missing-customer rejection.
15. Consent-status allowlist.
16. Database-generated grant timestamps.
17. Database-generated withdrawal timestamps.
18. Consent audit evidence.
19. Privacy-request status allowlist.
20. Bounded privacy-request lists.
21. Privacy-request type allowlist.
22. Locked active-customer identity for new requests.
23. Thirty-day request due date.
24. Request-creation audit evidence.
25. Locked request decision rows.
26. Self-approval prohibition.
27. Terminal-state protection.
28. Required rejection reason.
29. Compare-and-set request updates.
30. One-row transition enforcement.
31. Request-decision audit evidence.
32. Explicit JSON or CSV-bundle export format.
33. Access/export request-type gate.
34. Approved/completed request gate.
35. Duplicate active-export prohibition.
36. Active-export expiry validation.
37. Seven-day artifact expiry.
38. Release-authorization access evidence.
39. Export-queue audit evidence.
40. Serializable export queue transaction.
41. Export metadata permission.
42. Originating privacy-request join.
43. Private storage-reference non-disclosure.
44. Metadata access logging.
45. Revocation permission.
46. Required revocation reason.
47. Locked export row.
48. Repeated-revocation rejection.
49. Active worker-claim clearing.
50. Compare-and-set revocation update.
51. Revocation access-log evidence.
52. Revocation central audit evidence.
53. Retention-status allowlist.
54. Locked pending retention review.
55. Required retention-decision reason.
56. One-row retention transition.
57. Retention central audit evidence.
58. Authenticated security-router mounting.
59. Runtime schema creation prohibition.
60. Canonical worker schema and governance registration.

## Commands

- `npm run check:privacy-request-governance`
- `npm run check:privacy-request-governance-registration`

Both commands are also included in the normal `npm run check` chain. The registration checker prevents silent removal of the two commands, their syntax checks, their normal validation execution and the protected control markers.

## Operational safety

This batch does not start the privacy export worker, execute a privacy request, queue or publish an export, run a migration, mutate the preview database, deploy or restart preview, or touch production. Production mutation and customer-merge execution remain prohibited.
