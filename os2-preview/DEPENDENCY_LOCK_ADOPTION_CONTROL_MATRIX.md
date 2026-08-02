# Talk2Me OS2 Dependency Lock Adoption Control Matrix

This matrix records the 60 governed controls implemented for dependency-lock provenance, materialization, adoption verification, CI continuity, and source protection.

| # | Control | Enforced by |
|---:|---|---|
| 1 | Exact preview application identity | provenance verifier |
| 2 | Exact preview version identity | provenance verifier |
| 3 | Exact preview database identity | provenance verifier |
| 4 | Exact controlled branch identity | provenance verifier |
| 5 | Exact repository identity | provenance verifier |
| 6 | Exact branch ref identity | provenance verifier |
| 7 | Exact generation workflow identity | provenance verifier |
| 8 | Full lowercase source commit required | provenance verifier |
| 9 | Current commit must differ from source commit | provenance verifier |
| 10 | Positive generation run ID required | provenance verifier |
| 11 | Positive run attempt required | provenance verifier |
| 12 | Node.js 20 required | provenance verifier |
| 13 | Canonical UTC generation time required | provenance verifier |
| 14 | Future timestamps rejected | provenance verifier |
| 15 | Provenance freshness bounded | provenance verifier |
| 16 | Exact 15-field provenance schema | provenance verifier |
| 17 | Secret-like evidence fields rejected | provenance verifier |
| 18 | Provenance is read-only during verification | provenance verifier |
| 19 | Package-lock digest bound to provenance | provenance verifier |
| 20 | Constant-time digest comparison | provenance verifier |
| 21 | Exact lock application identity | provenance verifier |
| 22 | Lockfile version 3 required | provenance verifier |
| 23 | Exact six direct dependencies required | provenance verifier |
| 24 | Existing adoption targets prohibited | materializer |
| 25 | Canonical safe application root required | materializer |
| 26 | Private canonical artifact root required | materializer |
| 27 | Artifact owner consistency required | materializer |
| 28 | Full artifact verification rerun | materializer |
| 29 | Artifact verifier execution bounded | materializer |
| 30 | Forced SIGKILL on verifier timeout | materializer |
| 31 | Artifact verifier shell execution disabled | materializer |
| 32 | Artifact verifier output bounded | materializer |
| 33 | Sanitized frozen verifier environment | materializer |
| 34 | Artifact lock independently reopened | materializer |
| 35 | Artifact manifest independently reopened | materializer |
| 36 | Generation evidence independently reopened | materializer |
| 37 | Manifest source identity reverified | materializer |
| 38 | Manifest run identity reverified | materializer |
| 39 | Manifest lock digest reverified | materializer |
| 40 | Source inventory digest captured | materializer |
| 41 | Generation timestamp reverified | materializer |
| 42 | Exclusive no-overwrite lock publication | materializer |
| 43 | Exclusive no-overwrite provenance publication | materializer |
| 44 | Published files use safe source permissions | materializer |
| 45 | Published digests reread and verified | materializer |
| 46 | Partial rollback is checksum-bound | materializer |
| 47 | Automatic commits prohibited | materializer and workflows |
| 48 | Git mutation prohibited in materializer | materializer governance |
| 49 | Adoption workflow repository permission read-only | adoption workflow |
| 50 | Adoption must be exactly one commit | adoption workflow |
| 51 | Adoption parent must equal source commit | adoption workflow |
| 52 | Exactly two changed files required | adoption workflow |
| 53 | Existing node_modules prohibited | adoption workflow |
| 54 | npm ci from committed lock required | adoption workflow |
| 55 | npm install substitution prohibited | adoption governance |
| 56 | Complete integrated validation required | adoption workflow |
| 57 | High-severity dependency audit required | adoption workflow |
| 58 | Pre/post source inventory continuity required | adoption workflow |
| 59 | Clean workspace required after validation | adoption workflow |
| 60 | Private checksum-backed adoption evidence required | adoption workflow |

Production mutation and customer-merge execution remain disabled throughout this control set.
