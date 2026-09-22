/**
 * Bundled Google OAuth client (installed-app)
 *
 * A packaged draftsync build ships the product's own OAuth client here,
 * so regular users never touch Google Cloud Console: Connect opens
 * Google's consent page in the browser, and that's the whole flow.
 * Per Google's installed-app guidance the client secret in this flow is
 * not treated as confidential; embedding it is standard practice for
 * distributed desktop apps (the loopback flow + user consent do the
 * actual protecting).
 *
 * In the source repository this is null: developers provide their own
 * client via ~/.draftsync/credentials.json (see README "Developer
 * setup"). Distribution builds bake the product client in — at which
 * point the consent screen must be published (and verified, since the
 * documents scope is classified sensitive).
 *
 * Shape when set: { client_id, client_secret }
 */
export const builtinGoogleClient = null;
