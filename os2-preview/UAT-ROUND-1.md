# Talk2Me OS2 — UAT Round 1

Environment: https://talk2me.kloka.co.za  
Database: copied test database only (`kloka_talk2me`)  
Production site must remain untouched.

## Test result codes

- PASS — works as expected
- FAIL — defect recorded
- BLOCKED — cannot test because another defect prevents it
- N/A — not applicable to the tested role

## Severity

- S1 Critical — security, data loss, production impact, or application unavailable
- S2 High — core workflow cannot be completed
- S3 Medium — workflow works with a workaround or material usability issue
- S4 Low — cosmetic, wording, spacing, or minor inconvenience

## A. Deployment and health

| ID | Test | Expected | Result | Defect |
|---|---|---|---|---|
| A01 | `npm run check` | All server route files pass syntax validation |  |  |
| A02 | `/health` | HTTP 200 and database connected |  |  |
| A03 | Open site while signed out | Redirects to Login |  |  |
| A04 | Static JS and CSS | No 404 responses in browser console |  |  |
| A05 | Refresh current page | App remains usable and returns to a valid view |  |  |

## B. Authentication and sessions

Run for Owner, Manager, and Staff.

| ID | Test | Expected | Result | Defect |
|---|---|---|---|---|
| B01 | Valid login | Correct account and role load |  |  |
| B02 | Invalid password | Login rejected without revealing account details |  |  |
| B03 | Logout | Session ends and Login page opens |  |  |
| B04 | Eight-hour session | Session remains active within configured period |  |  |
| B05 | Deactivated staff | Cannot sign in; existing sessions revoked |  |  |
| B06 | Password reset | Old password fails and existing sessions are revoked |  |  |

## C. Global layout and navigation

| ID | Test | Expected | Result | Defect |
|---|---|---|---|---|
| C01 | Home | Only Home content visible |  |  |
| C02 | Customers | Customer workflow opens without overlapping views |  |  |
| C03 | My Work | Only My Work content visible |  |  |
| C04 | Opportunities | Only Opportunities content visible |  |  |
| C05 | Reports | Only Reports content visible |  |  |
| C06 | Import Centre | Owner only; clean standalone view |  |  |
| C07 | Administration | Owner/Manager only; clean standalone view |  |  |
| C08 | Mobile width | Sidebar, search, cards, tables, and dialogs remain usable |  |  |

## D. Ten-link global toolbar

| ID | Test | Expected | Result | Defect |
|---|---|---|---|---|
| D01 | Toolbar location | Visible directly under search on every page |  |  |
| D02 | Maximum links | No more than 10 active links displayed |  |  |
| D03 | Label length | Visible label never exceeds 5 characters |  |  |
| D04 | Tooltip | Full configured name appears on hover |  |  |
| D05 | First click | Configured URL opens |  |  |
| D06 | Second click | Existing named window/tab is focused; no duplicate opens |  |  |
| D07 | Closed external window | Clicking again opens it again |  |  |
| D08 | Mobile toolbar | Horizontal scrolling works |  |  |
| D09 | Configuration update | Saved Administration change appears after toolbar refresh |  |  |

## E. Customer and inquiry workflows

| ID | Test | Expected | Result | Defect |
|---|---|---|---|---|
| E01 | Search by phone | Correct customer results |  |  |
| E02 | Search by account | Correct customer results |  |  |
| E03 | Search by name | Correct customer results |  |  |
| E04 | Customer 360 | Profile, lines, assignment, and history load |  |  |
| E05 | New Inquiry | Required validation works |  |  |
| E06 | Save resolved inquiry | Inquiry saved and audited |  |  |
| E07 | Save follow-up inquiry | Follow-up date required and My Work updated |  |  |
| E08 | Modal scrolling | All fields and Save button reachable on small screens |  |  |

## F. My Work, assignment, claims, and approvals

| ID | Test | Expected | Result | Defect |
|---|---|---|---|---|
| F01 | Staff My Work | Shows only assigned/personal active work |  |  |
| F02 | Manager My Work | Team scope available |  |  |
| F03 | Filters | All, overdue, today, waiting, and open work correctly |  |  |
| F04 | Update note/status | Saved, audited, and list refreshes |  |  |
| F05 | Resolve work | Removed from active queue but history retained |  |  |
| F06 | Manager assignment | Customer assignment changes correctly |  |  |
| F07 | Staff claim request | Approval request created |  |  |
| F08 | Approval outcome | Approve/reject updates ownership and audit trail |  |  |

## G. Notifications and messages

| ID | Test | Expected | Result | Defect |
|---|---|---|---|---|
| G01 | Direct message | Only selected recipient receives it |  |  |
| G02 | Whole team | Active team receives message |  |  |
| G03 | Unread order | Unread shown before seen |  |  |
| G04 | Mark read | Badge/count updates |  |  |
| G05 | Complete | Removed from active drawer; history retained |  |  |
| G06 | Drawer scrolling | All items and controls reachable |  |  |

## H. Attendance

| ID | Test | Expected | Result | Defect |
|---|---|---|---|---|
| H01 | First clock-in | Active session created |  |  |
| H02 | Duplicate clock-in | Blocked while active |  |  |
| H03 | Clock-out | Session closes; workspace stays usable |  |  |
| H04 | Second clock-in same day | New session created |  |  |
| H05 | Daily total | Sum of all sessions is correct |  |  |
| H06 | Active staff count | Counts distinct active staff |  |  |
| H07 | Manager correction | Reason required and audit written |  |  |

## I. Opportunities and reports

| ID | Test | Expected | Result | Defect |
|---|---|---|---|---|
| I01 | Upgrade ranges | Today/7/30/60-day filters work |  |  |
| I02 | Birthdays | Matching records display |  |  |
| I03 | Prospects | Matching lifecycle records display |  |  |
| I04 | Renewal/cancellation | Matching dates display |  |  |
| I05 | Mark contacted | Audit entry created |  |  |
| I06 | Opportunity follow-up | New My Work item created |  |  |
| I07 | Report tabs | Inquiries, attendance, assignments, opportunities load |  |  |
| I08 | Report periods | 7/30/90/365-day periods work |  |  |
| I09 | CSV export | Valid downloadable CSV with correct scope |  |  |
| I10 | Print | Clean report print layout |  |  |

## J. Import Centre

Owner only.

| ID | Test | Expected | Result | Defect |
|---|---|---|---|---|
| J01 | CSV preview | Headers and row count correct |  |  |
| J02 | XLSX preview | Worksheet and rows correct |  |  |
| J03 | Mapping | Required mapping enforced |  |  |
| J04 | Dry run | New/update/unchanged/error counts correct |  |  |
| J05 | Duplicate warning | Duplicate account/cell keys reported |  |  |
| J06 | Final approval | Owner confirmation required |  |  |
| J07 | Failed import | Transaction rolls back |  |  |
| J08 | Protected history | Assignments, inquiries, notes, attendance preserved |  |  |
| J09 | Audit | Import summary recorded |  |  |

## K. Administration

| ID | Test | Expected | Result | Defect |
|---|---|---|---|---|
| K01 | Add Staff | Valid staff account created |  |  |
| K02 | Edit Staff | Name, username, email, role, status save |  |  |
| K03 | Manager limits | Manager cannot create/edit Owner access |  |  |
| K04 | Owner removal | Access disabled; history retained |  |  |
| K05 | Profile photo | Valid image accepted |  |  |
| K06 | ID document | Valid image/PDF accepted and protected |  |  |
| K07 | Invalid upload | Unsupported type or oversized file rejected |  |  |
| K08 | Launcher create/edit | Name, URL, label, order, active state save |  |  |
| K09 | Launcher limits | Maximum 10 and label maximum 5 enforced server-side |  |  |
| K10 | System tab | Version, environment, DB, sessions, customers display |  |  |

## Exit criteria for Round 1

- No open S1 defects
- No open S2 defects in login, search, inquiries, My Work, attendance, reports, imports, or administration
- All role-permission tests completed
- Database reconciliation completed for key counts
- Every failed test has a defect ID, severity, evidence, owner, and retest result
