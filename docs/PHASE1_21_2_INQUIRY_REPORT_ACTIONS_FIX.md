# Talk2Me CRM v1.21.2

## Fixes
- Inquiry form now submits URL-encoded data so Express receives all fields correctly.
- Removed req.flash dependency from inquiry validation.
- API errors now return clear JSON messages.
- New walk-in report now includes Edit / Add details and Delete actions.
- Delete archives the prospect instead of physically removing audit history.
