/**
 * Unit tests for Google OAuth2 authentication helpers
 *
 * Covers the pure/offline parts of the flow: credential and token file
 * handling, auth URL construction, and authorization-code extraction.
 * The interactive loopback flow and token exchange require a browser and
 * network, and are exercised manually via "draftsync login".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SCOPES,
  loadCredentials,
  loadToken,
  saveToken,
  createOAuth2Client,
  getAuthUrl,
  extractAuthCode
} from '../src/auth.js';

const FAKE_CREDENTIALS = {
  installed: {
    client_id: 'test-client-id.apps.googleusercontent.com',
    client_secret: 'test-secret',
    redirect_uris: ['http://localhost']
  }
};

describe('Auth Unit Tests', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'draftsync-auth-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadCredentials', () => {
    it('should load a valid installed-app credentials file', async () => {
      const credentialsPath = join(tempDir, 'credentials.json');
      await fs.writeFile(credentialsPath, JSON.stringify(FAKE_CREDENTIALS), 'utf8');

      const credentials = await loadCredentials(credentialsPath);
      expect(credentials.installed.client_id).toBe('test-client-id.apps.googleusercontent.com');
    });

    it('should throw a setup hint when the file is missing', async () => {
      await expect(loadCredentials(join(tempDir, 'nope.json'))).rejects.toThrow(
        /No Google OAuth client available/
      );
    });

    it('should reject files that are not OAuth client credentials', async () => {
      const credentialsPath = join(tempDir, 'credentials.json');
      await fs.writeFile(credentialsPath, JSON.stringify({ type: 'service_account' }), 'utf8');

      await expect(loadCredentials(credentialsPath)).rejects.toThrow(/Desktop app/);
    });
  });

  describe('token cache', () => {
    it('should round-trip a token through save and load', async () => {
      const tokenPath = join(tempDir, '.token.json');
      const token = { access_token: 'abc', refresh_token: 'def', expiry_date: 123 };

      await saveToken(token, tokenPath);
      expect(await loadToken(tokenPath)).toEqual(token);
    });

    it('should return null when no token is cached', async () => {
      expect(await loadToken(join(tempDir, '.token.json'))).toBeNull();
    });
  });

  describe('getAuthUrl', () => {
    it('should request offline access, consent, both scopes, and the state token', () => {
      const client = createOAuth2Client(FAKE_CREDENTIALS, 'http://localhost:8123');
      const url = new URL(getAuthUrl(client, 'my-state-token'));

      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('state')).toBe('my-state-token');
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8123');
      const scope = url.searchParams.get('scope');
      for (const s of SCOPES) {
        expect(scope).toContain(s);
      }
    });
  });

  describe('extractAuthCode', () => {
    it('should extract the code when state matches', () => {
      const code = extractAuthCode('/?state=s1&code=4/abc123&scope=x', 's1');
      expect(code).toBe('4/abc123');
    });

    it('should throw on a state mismatch', () => {
      expect(() => extractAuthCode('/?state=evil&code=4/abc123', 's1')).toThrow(/state mismatch/);
    });

    it('should surface an error param from Google', () => {
      expect(() => extractAuthCode('/?error=access_denied&state=s1', 's1')).toThrow(
        /access_denied/
      );
    });

    it('should throw when no code is present', () => {
      expect(() => extractAuthCode('/?state=s1', 's1')).toThrow(/no code/);
    });
  });
});
