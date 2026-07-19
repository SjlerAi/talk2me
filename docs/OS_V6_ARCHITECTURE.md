# Talk2Me OS v6 — Application Shell

## Environment boundary

- `https://talk2me.uent.co.za/` is the development and testing application environment.
- Its Node.js application, source files, Passenger runtime, configuration and deployment files are the development assets changed for OS v6.
- The separate live Talk2Me Node.js application and live application files are outside this deployment target.
- The MySQL database is shared with the live business system. Existing records must therefore be treated as live data.

## URL decision

OS v6 replaces the development workspace directly at `https://talk2me.uent.co.za/` after login.

The authenticated landing path remains `/workspace`. There is no `/os-v6` page or application route.

## Phase 1 architecture

The OS shell is a dedicated full-page EJS view mounted before the legacy route module. Existing CRM routes remain available and open inside independent application windows.

- `src/routes/os.js` — authenticated OS shell and lightweight status API.
- `views/os-shell.ejs` — permanent top bar, launcher, workspace and dock.
- `public/js/os-v6.js` — search controller, window manager, supplier launchers and native utility applications.
- `public/css/os-v6.css` — desktop shell and window styling.

The current customer, task, queue and report screens are adapted through same-origin iframe windows using the existing `panel=1` support. New OS-native modules can progressively move to fetch/JSON components without replacing the permanent shell.

## Phase 1 functionality

- Permanent Talk2Me application shell.
- Global search using the existing combined mobile/fixed search API.
- Customer results open in movable windows instead of page navigation.
- Window open, focus, drag, resize, minimize, restore, maximize and close.
- Queue, Tasks, Messages, Notifications and Reports open as independent windows.
- Supplier windows for Vodacom, MTN, Telkom and Sage, configured per workstation.
- Native Notes and Calculator applications.
- Calendar shell ready for the next integration phase.
- Background badge refresh for queue, task and unread-message totals.
- Existing authentication, permissions and server-side business rules retained.

## Database safety

Phase 1 contains no schema migration, destructive statement or bulk data operation. The new shell reads status counts and search results only. Existing forms opened inside application windows retain their current server-side authorization, validation, audit and write controls.

Future database changes must be additive, backward-compatible, reviewed and backed up before deployment.

## Release workflow

1. Develop on `feature/os-v6-shell`.
2. Review the pull request and changed-file list.
3. Run Node.js syntax checks and available project checks.
4. Merge only after approval.
5. On the development server, update `/home/uent/repositories/talk2me` to the approved commit.
6. Run `./deploy.sh --dry-run` and review the exact file plan.
7. Run `./deploy.sh` to deploy to the development application.
8. Test login, search, customer windows, dock windows, supplier settings and logout.

## Protected paths

Existing deployment protections remain mandatory. Deployment must not overwrite `.htaccess`, `.env`, `.deployed_commit`, `node_modules/`, `tmp/`, `private_uploads/`, logs or `.well-known/`.
