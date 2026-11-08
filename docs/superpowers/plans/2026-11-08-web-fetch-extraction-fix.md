# Web Fetch Extraction Fix — Plan

Date: 2026-11-08
Worktree: `../STARN-webfetch`, branch `fix/web-fetch` (parallel to the chart work on master)

## Problem

`web_fetch` returned 5,843 characters of navigation menu for
`https://evdrives.com/product/motenergy-me1115-me1917-brushless-dc-permanent-magnet-motor/`
while the page carries `$875.00`, `3 in stock`, SKU `MOT-ME1115`, and the full
description including `12 KW Continuous, 30 KW Peak (at 96 volts)` and
`92% efficient`.

Measured on the live page (169,709 bytes):

| Content | Byte offset | Why lost |
|---|---|---|
| `"price":875.00` in JSON-LD | 2,538 | `<script>` blocks are stripped |
| Inline `<style>` | 6,838 → 57,667 | consumed most of the 50 KB budget |
| `Additional information` | 57,549 | past the cut |
| Description / spec list | 106,485 | past the cut |

Three defects:

1. **Cap applied to raw HTML before cleaning** — `bodyText.slice(0, 50 * 1024)`.
   The description sits at byte 106,485, so it is truncated before cleaning.
2. **Structured data stripped** — the price/SKU/stock exist only in
   `<script type="application/ld+json">`, which `cleanHtmlText` deletes.
3. **CSS not removed before measuring** — the first 51 KB is ~90 % inline CSS,
   so the surviving text is the menu.

## Fix

Single file `src/tools/handlers/web-fetch.ts`:

1. **Harvest structured data first.** Before stripping, collect
   `application/ld+json` blocks and `<meta property="product:*">` /
   `og:description`. Emit a `[structured data]` block with `name`, `sku`,
   `brand`, `price`, `priceCurrency`, `availability`, `description` (trimmed).
   Tolerate unparseable JSON; never throw.
2. **Remove CSS/JS content before tags.** Drop `<style>…</style>`,
   `<noscript>…</noscript>`, `<svg>…</svg>` bodies, then strip remaining tags.
3. **Cap after cleaning.** Read up to 2 MB of raw body; cap the *cleaned* text
   at 20,000 chars with the existing truncation notice.
4. **Never fail the fetch on extraction problems** — fall back to today's
   behaviour if structured extraction throws.

## Tests

`tests/web-fetch-extraction.test.ts` (new):

- HTML with an early JSON-LD price and a description at ~100 KB → both appear.
- Page whose first 60 KB is inline CSS → the visible text still surfaces.
- JSON-LD that is invalid JSON → no throw, text still returned.
- Plain article with no structured data → unchanged output, no empty block.
- 2 MB guard: body larger than the read cap still returns text.

Live acceptance: fetch the evdrives URL and assert the result contains
`875`, `In stock`, `MOT-ME1115`, and `12 KW Continuous`.

## Constraints

- No new dependency (regex/meta parsing only).
- SSRF guards, timeouts and the private-IP check stay exactly as they are.
- Content from the page is untrusted data; never interpreted as instructions.
- `C:/Users/makel/OneDrive/Desktop/starn test/docs/REQUIREMENTS.md` and
  `docs/BOM.md` untouched (hashes `f5c2b521…`, `b3d80ce0…`).
