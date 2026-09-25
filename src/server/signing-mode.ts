import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppContext } from "./auth";

export function requireLongerLivedSigning(enabled: boolean): void {
  if (!enabled)
    throw new HTTPException(409, {
      message:
        'This page requested short-lived signing. Reload BarterBook, then preview terms that say "Longer-lived signing" before accepting. Existing attempts must be reconciled first.',
    });
}

// Older browser builds already send this identity header. Reject their outdated
// signing choice without silently changing accepted terms. This is a UI-version
// compatibility guard, not an authentication boundary. SDK clients may still
// deliberately use the existing recent-blockhash protocol.
export function requireBrowserSigningMode(
  c: Context<AppContext>,
  enabled: boolean,
): void {
  if (c.req.header("X-BarterBook-Expected-Wallet"))
    requireLongerLivedSigning(enabled);
}
