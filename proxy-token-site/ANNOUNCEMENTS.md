# Website announcements

Open `/admin`, sign in, and choose **网站公告**. This manages the public
`/updates` feed independently of the existing email sender.

- Start with a blank, product update, or maintenance template.
- Titles are bold. The Pell editor supports paragraphs, H2/H3 subheadings,
  bold, italic, underline, lists, quotes, links, undo and redo.
- English title and body are optional. Preview formatting before publication.
- Save a private draft, publish, edit a published announcement, or archive it.
  Saving a published entry updates the public page immediately.
- Search historical titles, tags and bodies; filter by status. Archived
  announcements remain editable and can be restored as drafts or republished.
- Unsaved edits trigger a discard warning. Conflicting edits return HTTP 409;
  refresh the history list and reopen the entry before editing again.

## Storage and API

`DATA_DIR/product-updates.json` is runtime data, excluded from Git. Keep the
existing persistent data mount writable and include this file in data backups.
Reads fall back to the existing `PRODUCT_UPDATES` entries only when this
file is absent. The first mutation persists the complete list, including legacy
IDs, original dates and both languages. Corrupt/unreadable stores fail closed.
Writes use mode 0600 and atomic rename. The portal runs as one Node process;
multi-process writers would require an inter-process lock or database.

`GET /api/product-updates` returns only published entries, sanitized rich HTML
and compatible plain-text fields. Drafts, archives and internal versions are
omitted. It uses `Cache-Control: no-store` so archives disappear on the next read.

All `/api/admin/product-updates` endpoints require `X-Admin-Token`:

- `GET /`: all historical entries with status, version and timestamps.
- `POST /`: create an announcement (defaults to draft).
- `PUT /:id`: replace editable content/status with the current integer `version`.

Required fields are `title`, ISO `date`, `status` and a nonempty `body_html`
when publishing. `title_en`, `body_en_html`, and `tag` are optional. Titles are
limited to 200 characters, tags to 80, and each HTML body to 30,000. Archive is
a reversible status change; no permanent delete endpoint is exposed.

DOMPurify filters clipboard HTML before insertion in the editor. The independent
server allowlist strips unsafe tags, attributes and URL schemes on write and
public read. Formatting does not allow scripts, images, embeds or inline styles.

## Build and release

Run `npm run build:public` and `npm test` from this directory. New dependencies
are pinned build dependencies: Pell 1.0.6, DOMPurify 3.4.16 and sanitize-html
2.17.7. License notices are in `public/vendor/announcement-licenses.txt`.

The existing commit-pinned site deploy copies `server.js` and `public/` only.
The build therefore emits the server sanitizer as
`public/assets/announcement-sanitize.cjs`, a self-contained CommonJS artifact
required by `server.js`; the running service needs no added npm dependencies.
It contains only library code and the allowlist, never announcement data or
credentials. Ship it alongside `site-announcements.js`, `site-announcements.css`,
the rebuilt `updates-page.js`, and the updated admin/public HTML. Preserve the
live data directory across releases and rollbacks.

Tests use isolated temporary data and never publish to the production website
or send email. Backend tests cover authentication, legacy continuity, the
draft/public/archive lifecycle, sanitization, validation, stale/concurrent edits,
corrupt storage and failed writes. Browser verification additionally covers
the real rich-text toolbar and public rendering.
