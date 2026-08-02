# Talk2Me One Product

This directory is the only development path for the clean integrated Talk2Me product.

## Controlling rule

The product is designed and built as one system. It is not assembled from repaired legacy screens, patched routes, temporary adapters, or parallel database models.

Each feature is complete only when all of the following exist and work together:

1. User interface
2. Backend route and service
3. Database tables and constraints
4. Permissions and audit behaviour
5. Test data
6. Automated verification
7. Browser verification
8. Import mapping for the same final fields

## Prohibited

- Editing the old mixed OS2/legacy implementation as the development method
- Creating compatibility shims between old and new field names
- Maintaining two customer models
- Importing live data before the target schema and application flow pass verification
- Marking a route or screen complete without database and browser proof

## Build order

1. Authentication and staff
2. Master Customer, accounts, mobile lines and Customer 360
3. Inquiries and follow-ups
4. Ownership and My Work
5. Opportunities
6. Fixed services
7. Reports
8. Administration
9. Controlled live-data import

## First acceptance slice

The first accepted slice is:

Search -> select customer -> Customer 360 -> account -> mobile line -> contact -> ownership

The slice is accepted only when one seeded customer can be found by name, phone and account number and the Customer 360 response is generated from the same schema used by the application.
