# Security

Photo Layout is a static website: there is no server code, database, account
system or analytics. Photos are processed entirely in the visitor's browser
and are never uploaded.

## What protects it

- **No network use for photos.** The app code makes no network requests;
  layout, colour adjustment and PDF/JPG export all run locally.
- **HTTPS only.** GitHub Pages serves the site with `Strict-Transport-Security`.
- **Content Security Policy** (a `<meta>` tag in [index.html](index.html)):
  only the site's own scripts, styles and images may load. Inline scripts,
  `eval`, plugins, frames and other sites are blocked, and any plain-HTTP
  request is upgraded. `blob:` images are allowed for the photos the user picks.
- **No referrer** is sent to other sites (`<meta name="referrer" content="no-referrer">`).
- **Safe DOM updates.** Text is only ever inserted with `textContent`; the code
  never uses `innerHTML`, `eval`, `new Function` or `document.write`.
- **No third-party code.** No libraries, CDNs, fonts or trackers are loaded.
- **Validated input.** Settings read from browser storage are checked key by key
  (unknown or invalid values fall back to defaults); picked files must be images
  under 80 MB.
- **Offline cache** stores only successful responses from this site.

[tests/security.test.mjs](tests/security.test.mjs) checks the policy, the absence
of inline scripts and handlers, and the banned code patterns on every `npm test`.

## Limits

- GitHub Pages cannot send custom HTTP headers, so protections that only work as
  headers (`frame-ancestors` against embedding the site in a frame,
  `X-Content-Type-Options`) are not set. The site has no logins or payments, so
  the risk is low. Hosting on Cloudflare Pages or Netlify would allow them.
- The biggest real risk is the GitHub account that publishes the site: keep
  two-factor authentication turned on.

## Reporting a problem

Please open an issue on the GitHub repository (without exploit details), or
contact the maintainer privately first.
