# Talk2Me OS2 Route Compatibility Register

This register prevents legacy preview routes from disappearing silently during the integrated rebuild.

## Preserved routes

- `GET /health`
- `GET /login`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET /api/admin/session-check`
- `GET /`

## Governed replacement

- Legacy `GET /api/customers/search`
- Integrated replacement `GET /api/os2/customers/search`
- Replacement is subject to Master Customer access scope and access-event evidence.

## Retired legacy write routes

The old direct inquiry write model must not be reintroduced because it bypasses the unified OS2 work-item, ownership, permission and audit controls.

- `GET /api/inquiry-options` is retired in favour of governed OS2 work-item metadata.
- `POST /api/inquiries` is retired in favour of governed OS2 work-item creation.

Retired routes must return an explicit retirement response when compatibility middleware is mounted. They must never silently write to the legacy `inquiries` table.

## Deployment gate

Before preview deployment:

1. Mount `legacy-route-compatibility.js` before the integrated routers.
2. Confirm the customer-search alias reaches the scoped OS2 search.
3. Confirm retired write routes return HTTP 410 and a replacement route.
4. Run route compatibility validation.
5. Include the result in preview UAT evidence.

Production remains outside this register and must not be changed by preview compatibility work.
