# Prizgram Security Notes

## Content Security Policy

`apps/web/next.config.ts` sends a restrictive baseline CSP, including
`default-src 'self'`, `object-src 'none'`, and `frame-ancestors 'none'`.

The production policy currently keeps `script-src 'unsafe-inline'` because
Next.js generates scripts used during App Router hydration. Removing that
directive from a static `next.config.ts` header is not a safe nonce migration:
the generated scripts would not receive a matching per-request nonce and
hydration could fail.

This is an explicit follow-up boundary, not permission to weaken other
controls. Untrusted HTML must remain plain text and must not be rendered with
`dangerouslySetInnerHTML`.

### Nonce migration checklist

Before removing `unsafe-inline` from `script-src`, implement and verify all of
the following in a production build:

1. Generate a fresh nonce for every document request at the edge/request
   boundary.
2. Apply the same nonce to the response CSP and every Next.js-generated
   script.
3. Exercise hydration, client navigation, error recovery, and authentication
   flows with CSP violation reporting enabled.
4. Confirm that no normal request produces a CSP violation in the browser.
5. Keep `style-src 'unsafe-inline'` as a separate decision; it is not covered
   by script nonce work.

Until that checklist is verified, `unsafe-inline` remains intentional and
tracked by this follow-up rather than being removed mechanically.
