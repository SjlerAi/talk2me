# Talk2Me OS2 — UAT Defect Log

Use one row per defect. Attach a screenshot and browser-console or terminal output where relevant.

| Defect ID | Test ID | Date | Role | Severity | Module | Summary | Steps to reproduce | Expected | Actual | Evidence | Status | Fix commit | Retest |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UAT-001 |  |  |  |  |  |  |  |  |  |  | Open |  |  |

## Status values

- Open
- Investigating
- Fixed — awaiting retest
- Passed retest
- Deferred
- Not reproducible

## Defect handling rule

1. Record the defect before changing code.
2. Fix one focused defect or tightly related group per commit.
3. Run `npm run check` and `npm run uat:smoke` after the fix.
4. Retest the original test and the most likely regression paths.
5. Do not close a defect until the user confirms the live preview works.
