# TK2M domain pre-launch security gate — 24 Oct 2026
**Operational state:** DOCUMENTED, not installed on the live tk2m.co.za vhost. Do not mistake this for a completed security lockdown.

## Live checks (24 Oct 2026, 07:00–08:30 SAST)
- A: tk2m.co.za -> 164.160.91.40; www aliases to apex.
- Authoritative NS: ns3.za-dns.com and ns5.za-dns.com.
- MX currently targets mail.tk2m.co.za. SPF exists and DMARC is published with p=none. Preserve MX, SPF, DKIM, mailbox and Reply-To settings during web-domain changes.
- HTTP `/` returned 200 with a LiteSpeed `Index of /` listing (cgi-bin, php.ini). `/php.ini` itself returned 403 when checked. HTTPS certificate was self-signed/untrusted for apex and www.
- Connected SSH/cPanel identity: `uent` on cp47-jhb.za-dns.com. `uapi DomainInfo list_domains` does **not** include tk2m.co.za. No tk2m.co.za document root exists within `/home/uent`. This connected identity cannot safely update the actual domain vhost/root. **Do not add a duplicate tk2m.co.za domain or alter DNS/mail**; inspect the owning cPanel account or ask hosting administrator to attach/migrate vhost correctly. cPanel permits only one account to own a domain.
- No evidence that the CRM has yet been mounted at tk2m.co.za. Existing UAT at https://uent.co.za/talk2me is healthy and remains untouched.

## Immediate remediation (requires access to account that actually owns tk2m.co.za)
1. In the owning cPanel **Domains**, confirm the tk2m.co.za document root and its cPanel account username. If the hostname is only hitting a default vhost, commission the correct vhost once, preserving email routing and mail domain ownership.
2. In that domain root, apply the sibling `deploy/tk2m-domain-lockdown/.htaccess` as `.htaccess`; this denies all web paths except the two certificate DCV namespaces and disables directory listings. Or use cPanel's **Indexes > No Indexing**, but note **No Indexing alone does not deny direct file URLs**. Do not store passwords in .htaccess or GitHub.
3. Independently configure **Directory Privacy** with a strong generated password for any private staging preview, but only *after* trusted HTTPS works. Directory Privacy is an additional gate; it must not replace CRM staff authentication.
4. In cPanel SSL/TLS Certificates, include apex and www in AutoSSL and run AutoSSL. Resolve failed DCV/CAA records, then verify trusted certificates for both variants. Never train users to bypass the browser certificate warning. Force HTTPS after valid TLS; HSTS only after subdomain/certificate/redirect review.
5. Re-test: HTTP `/` must be 403 (or a controlled HTTPS redirect to a 403 page), `/cgi-bin/` 403, `/php.ini` 403, apex/www HTTPS trust valid; no directory listing and no unauthenticated CRM records. Test only these safe endpoints, do not brute-force login.
6. Leave old CRM URL and Zippy untouched until the owner's distinct production cutover approval.

## Review findings in currently deployed/integration Talk2Me code
- `src/routes/index.js` contains a hardcoded test-password fallback for accounts without stored password hashes. This must be retired after a read-only audit and safe account recovery for any active affected staff. Do **not** paste the embedded passwords in chat or issues.
- The login handler does not expose an apparent account/IP throttle in the inspected source. Add server-side rate limiting (ideally persisted per account and IP), logging, recovery, and adaptive delay, without an easy denial-of-service via account lockouts.
- No application-wide CSRF protection or comprehensive security header middleware appeared in the inspected entry-point. Plan tested CSRF tokens/origin verification for all state-changing operations, `frame-ancestors 'none'`, HSTS after certificate verification, `nosniff`, Referrer-Policy, and a carefully tested Content Security Policy.
- Sessions already use HttpOnly and SameSite=lax; UAT runtime has SESSION_SECURE=true. Keep host-only cookies, regenerate on sign-in, use server-side idle/absolute expiry, and avoid cookie reuse across old/new domains.
- The public repository's tracked `.htaccess` contains historic plaintext runtime secrets. **Treat those as exposed**: securely rotate DB, SMTP, and session secrets and sanitize repository history in a controlled procedure that does not interrupt production or GitHub deployment. Never create or share new secrets in chat.
- MFA (prefer passkeys/TOTP with recovery) must be required for owner/manager/admin, and ideally all staff; register/de-register devices with strong reauthentication. No claim of MFA implementation is made.
- Private uploads, backups, task documents, database connection, staff roles, audit trails, scheduled tasks, outbound email, and signed Zippy CRM bridge need a fail-closed check at root-domain cutover.
- Distinguish domain's web-root quarantine from full application security. Only lift quarantine after HTTPS, user accounts, RBAC, MFA, rate limits, CSRF, credentials rotation, regression tests and cutover signoff.

## Cutover blockers
- Actual tk2m.co.za cPanel/vhost owner isn't accessible through connected `uent` device.
- The public directory listing has not yet been disabled from that owning account.
- Valid HTTPS certificate for apex and www has not yet been installed/verified.
- CRM security remediation/recovery needs a separate tested deployment and owner signoff.
- CRM and Zippy must continue serving via their existing URLs until go/no-go.
