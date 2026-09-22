/**
 * Google API Authentication
 *
 * Handles OAuth2 authentication for Google Drive and Docs APIs using the
 * desktop-app loopback flow: a local HTTP server receives the authorization
 * code redirect, the code is exchanged for tokens, and tokens are cached in
 * .token.json (refreshed tokens are persisted automatically).
 */

import { google } from 'googleapis';
import { promises as fs } from 'fs';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { getDataDir } from './store.js';
import { builtinGoogleClient } from './google-client.js';

// Required OAuth2 scopes.
// drive.file (non-sensitive) only grants access to files this app created —
// enough for push/pull of docs draftsync itself creates, and avoids the
// verification requirements of the broad drive scope.
export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents'
];

// How long to wait for the user to complete the browser consent flow
const AUTH_FLOW_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Path to the OAuth client credentials file
 *
 * Canonical home is ~/.draftsync/credentials.json (works for the global
 * server and every project); a credentials.json in the current
 * directory is honored as a legacy fallback.
 *
 * @returns {string} Absolute path to credentials.json
 */
export function getCredentialsPath() {
  const central = path.join(getDataDir(), 'credentials.json');
  if (existsSync(central)) return central;
  return path.join(process.cwd(), 'credentials.json');
}

/**
 * Path to the cached token file (canonical: ~/.draftsync/token.json;
 * legacy .token.json in the current directory read as fallback)
 *
 * @returns {string} Absolute path to the token file
 */
export function getTokenPath() {
  const central = path.join(getDataDir(), 'token.json');
  if (existsSync(central)) return central;
  const legacy = path.join(process.cwd(), '.token.json');
  if (existsSync(legacy)) return legacy;
  return central;
}

/**
 * Load OAuth2 credentials from credentials.json
 *
 * @param {string} [credentialsPath] - Override path (mainly for tests)
 * @returns {Promise<Object>} Credentials object
 */
export async function loadCredentials(credentialsPath = getCredentialsPath()) {
  let content;
  try {
    content = await fs.readFile(credentialsPath, 'utf8');
  } catch {
    if (builtinGoogleClient) {
      return {
        installed: {
          client_id: builtinGoogleClient.client_id,
          client_secret: builtinGoogleClient.client_secret,
          redirect_uris: ['http://localhost']
        }
      };
    }
    throw new Error(
      'No Google OAuth client available. This build has none bundled — ' +
        `save an OAuth client (Desktop app) JSON as ${getCredentialsPath()}. ` +
        'See README.md "Developer setup".'
    );
  }

  const credentials = JSON.parse(content);
  if (!credentials.installed && !credentials.web) {
    throw new Error(
      'credentials.json is not an OAuth client file (expected an "installed" ' +
        'or "web" key). Download the JSON for a "Desktop app" OAuth client ID.'
    );
  }
  return credentials;
}

/**
 * Is any Google OAuth client available (bundled or credentials file)?
 *
 * @returns {Promise<boolean>} True when Connect can run
 */
export async function hasGoogleClient() {
  if (builtinGoogleClient) return true;
  try {
    await fs.access(getCredentialsPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Load saved OAuth2 token from .token.json
 *
 * @param {string} [tokenPath] - Override path (mainly for tests)
 * @returns {Promise<Object|null>} Token object or null if not found
 */
export async function loadToken(tokenPath = getTokenPath()) {
  try {
    const content = await fs.readFile(tokenPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Save OAuth2 token to .token.json
 *
 * @param {Object} token - Token object to save
 * @param {string} [tokenPath] - Override path (mainly for tests)
 */
export async function saveToken(token, tokenPath = getTokenPath()) {
  await fs.writeFile(tokenPath, JSON.stringify(token, null, 2) + '\n', 'utf8');
}

/**
 * Create OAuth2 client from credentials
 *
 * @param {Object} credentials - Google OAuth2 credentials
 * @param {string} [redirectUri] - Override redirect URI (loopback flow)
 * @returns {google.auth.OAuth2} OAuth2 client
 */
export function createOAuth2Client(credentials, redirectUri = null) {
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
  return new google.auth.OAuth2(client_id, client_secret, redirectUri || redirect_uris?.[0]);
}

/**
 * Get authorization URL for OAuth2 flow
 *
 * @param {google.auth.OAuth2} oauth2Client - OAuth2 client
 * @param {string} [state] - Anti-forgery state token to embed
 * @returns {string} Authorization URL
 */
export function getAuthUrl(oauth2Client, state = undefined) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    // Force the consent screen so Google reissues a refresh_token even if
    // the user authorized before (otherwise re-login yields no refresh token)
    prompt: 'consent',
    scope: SCOPES,
    state
  });
}

/**
 * Extract the authorization code from the loopback redirect URL
 *
 * @param {URL|string} redirectUrl - The URL Google redirected the browser to
 * @param {string} expectedState - The state token we sent with the auth URL
 * @returns {string} Authorization code
 * @throws {Error} If the response carries an error, a state mismatch, or no code
 */
export function extractAuthCode(redirectUrl, expectedState) {
  const url =
    typeof redirectUrl === 'string' ? new URL(redirectUrl, 'http://localhost') : redirectUrl;

  const errorParam = url.searchParams.get('error');
  if (errorParam) {
    throw new Error(`Authorization failed: ${errorParam}`);
  }

  if (url.searchParams.get('state') !== expectedState) {
    throw new Error('Authorization failed: state mismatch (possible CSRF); try again');
  }

  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error('Authorization failed: no code in redirect');
  }

  return code;
}

/**
 * Best-effort: open a URL in the user's default browser
 *
 * @param {string} url - URL to open
 */
function openBrowser(url) {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(opener, [url], { stdio: 'ignore', detached: true, shell: false });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Non-fatal: the URL is printed for manual use
  }
}

/**
 * Run the interactive OAuth2 loopback flow
 *
 * Starts a local HTTP server on a random port, sends the user to Google's
 * consent page, waits for the redirect with the authorization code, and
 * exchanges it for tokens.
 *
 * @param {Object} credentials - Parsed credentials.json contents
 * @returns {Promise<{client: google.auth.OAuth2, tokens: Object}>}
 */
async function runAuthFlow(credentials) {
  const state = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    let oauth2Client;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn(value);
    };

    const server = http.createServer(async (req, res) => {
      let code;
      try {
        const url = new URL(req.url, `http://localhost:${server.address().port}`);
        // Browsers also request /favicon.ico; only handle the redirect path
        if (url.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        code = extractAuthCode(url, state);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body style="font-family: sans-serif">' +
            '<h3>draftsync: authentication complete</h3>' +
            '<p>You can close this tab and return to the terminal.</p>' +
            '</body></html>'
        );
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`draftsync: ${error.message}`);
        finish(reject, error);
        return;
      }

      try {
        const { tokens } = await oauth2Client.getToken(code);
        finish(resolve, { client: oauth2Client, tokens });
      } catch (error) {
        finish(reject, new Error(`Token exchange failed: ${error.message}`));
      }
    });

    const timer = setTimeout(() => {
      finish(reject, new Error('Timed out waiting for authorization (5 minutes). Try again.'));
    }, AUTH_FLOW_TIMEOUT_MS);

    server.on('error', error => finish(reject, error));

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      oauth2Client = createOAuth2Client(credentials, `http://localhost:${port}`);
      const authUrl = getAuthUrl(oauth2Client, state);

      console.log(chalk.blue('\nOpening your browser for Google authorization...'));
      console.log(chalk.gray('If it does not open, visit this URL:\n'));
      console.log(chalk.cyan(`  ${authUrl}\n`));
      openBrowser(authUrl);
    });
  });
}

/**
 * Persist refreshed tokens whenever the client updates them
 *
 * Google rotates access tokens (and occasionally issues new refresh tokens);
 * merging preserves the refresh_token when a refresh response omits it.
 *
 * @param {google.auth.OAuth2} client - Authenticated client
 */
function persistTokenUpdates(client) {
  client.on('tokens', async tokens => {
    try {
      const existing = (await loadToken()) || {};
      await saveToken({ ...existing, ...tokens });
    } catch {
      // Never let a cache write failure break an API call
    }
  });
}

/**
 * Authenticate with Google APIs
 *
 * Uses the cached token when present; otherwise runs the interactive
 * browser flow and caches the result.
 *
 * @param {Object} [options]
 * @param {boolean} [options.forceLogin=false] - Always run the interactive flow
 * @returns {Promise<google.auth.OAuth2>} Authenticated OAuth2 client
 */
export async function authenticate({ forceLogin = false } = {}) {
  const credentials = await loadCredentials();

  if (!forceLogin) {
    const token = await loadToken();
    if (token) {
      const client = createOAuth2Client(credentials);
      client.setCredentials(token);
      persistTokenUpdates(client);
      return client;
    }
  }

  const { client, tokens } = await runAuthFlow(credentials);
  client.setCredentials(tokens);
  await saveToken(tokens);
  persistTokenUpdates(client);
  return client;
}

/**
 * Revoke the current OAuth2 token and delete the local cache
 *
 * @returns {Promise<{hadToken: boolean, revoked: boolean}>} What happened:
 *   hadToken is false when there was nothing to revoke; revoked is true when
 *   Google confirmed revocation (the local cache is deleted either way)
 */
export async function revokeToken() {
  const token = await loadToken();
  if (!token) {
    return { hadToken: false, revoked: false };
  }

  let revoked = false;
  try {
    const credentials = await loadCredentials();
    const client = createOAuth2Client(credentials);
    client.setCredentials(token);
    await client.revokeCredentials();
    revoked = true;
  } catch {
    // Token may already be expired/revoked server-side; still delete locally
  }

  await fs.unlink(getTokenPath());
  return { hadToken: true, revoked };
}
