import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  // oauthProviderClient adds the signed OAuth query (when the page has one) to
  // sign-in, consent and continue requests, so an MCP client's sign-in resumes.
  plugins: [organizationClient(), oauthProviderClient()],
});

/** True on pages Patch's OAuth server sent the user to (their query is signed). */
export const inOAuthFlow = () => new URLSearchParams(window.location.search).has("sig");

/**
 * Where to go after an auth call made during an OAuth flow: the server answers
 * with `{ redirect: true, url }` (the next step, or back to the MCP client).
 */
export function oauthRedirect(data: unknown): string | undefined {
  if (data && typeof data === "object" && "url" in data && typeof data.url === "string" && "redirect" in data && data.redirect) return data.url;
}
