/**
 * Google API Authentication
 *
 * Handles OAuth2 authentication for Google Drive and Docs APIs.
 */

import { google } from 'googleapis';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths for credentials and tokens
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const TOKEN_PATH = path.join(process.cwd(), '.token.json');

// Required OAuth2 scopes
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents'
];

/**
 * Load OAuth2 credentials from credentials.json
 *
 * @returns {Promise<Object>} Credentials object
 */
async function loadCredentials() {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      'credentials.json not found. ' +
        'Download it from Google Cloud Console and place it in the project root.\n' +
        'See README.md for instructions.'
    );
  }
}

/**
 * Load saved OAuth2 token from .token.json
 *
 * @returns {Promise<Object|null>} Token object or null if not found
 */
async function loadToken() {
  try {
    const content = await fs.readFile(TOKEN_PATH, 'utf8');
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
 */
async function saveToken(token) {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(token, null, 2), 'utf8');
}

/**
 * Create OAuth2 client from credentials
 *
 * @param {Object} credentials - Google OAuth2 credentials
 * @returns {google.auth.OAuth2} OAuth2 client
 */
function createOAuth2Client(credentials) {
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

/**
 * Get authorization URL for OAuth2 flow
 *
 * @param {google.auth.OAuth2} oauth2Client - OAuth2 client
 * @returns {string} Authorization URL
 */
function getAuthUrl(oauth2Client) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
}

/**
 * Authenticate with Google APIs
 *
 * TODO: Implement actual OAuth2 flow
 * - For now, this returns a stubbed auth object
 * - In production, this should:
 *   1. Load credentials.json
 *   2. Check for existing token in .token.json
 *   3. If no token, start OAuth2 flow:
 *      a. Generate auth URL
 *      b. Open browser or print URL
 *      c. Wait for authorization code
 *      d. Exchange code for token
 *      e. Save token to .token.json
 *   4. Create and return OAuth2 client with token
 *
 * @returns {Promise<google.auth.OAuth2>} Authenticated OAuth2 client
 */
export async function authenticate() {
  console.log(chalk.gray('  [STUB] Authenticating with Google APIs...'));

  // TODO: Remove this stub and implement real authentication
  try {
    const credentials = await loadCredentials();
    const oauth2Client = createOAuth2Client(credentials);

    // Try to load existing token
    const token = await loadToken();

    if (token) {
      oauth2Client.setCredentials(token);
      console.log(chalk.gray('  [STUB] Using existing token'));
      return oauth2Client;
    }

    // TODO: Implement OAuth2 flow
    console.log(chalk.yellow('  [TODO] OAuth2 flow not implemented yet'));
    console.log(chalk.gray('  You would need to:'));
    console.log(chalk.gray('    1. Visit the authorization URL'));
    console.log(chalk.gray('    2. Grant permissions'));
    console.log(chalk.gray('    3. Enter the authorization code'));

    // For now, return a stubbed client
    return oauth2Client;
  } catch (error) {
    console.log(chalk.yellow(`  [STUB] ${error.message}`));
    console.log(chalk.gray('  Continuing with stubbed auth...'));
    return { stubbed: true };
  }
}

/**
 * Revoke the current OAuth2 token
 *
 * TODO: Implement token revocation
 *
 * @returns {Promise<void>}
 */
export async function revokeToken() {
  const token = await loadToken();

  if (!token) {
    console.log(chalk.gray('No token found to revoke'));
    return;
  }

  // TODO: Implement actual token revocation
  console.log(chalk.yellow('[TODO] Token revocation not implemented yet'));

  // Delete the token file
  await fs.unlink(TOKEN_PATH);
  console.log(chalk.green('✓ Token file deleted'));
}
