/**
 * Google Drive API Operations
 *
 * Handles file upload, download, and management in Google Drive. Every
 * function takes an authenticated OAuth2 client so tests can mock the
 * Drive client (see ARCHITECTURE.md).
 */

import { google } from 'googleapis';
import { promises as fs, createReadStream, createWriteStream } from 'fs';

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Default Drive folder name for docs draftsync creates */
export const DEFAULT_FOLDER_NAME = 'draftsync';

/**
 * Read manifest file
 *
 * @param {string} [manifestPath='.draftsync.json'] - Path to manifest file
 * @returns {Promise<object>} Manifest object (empty object if not found)
 */
export async function readManifest(manifestPath = '.draftsync.json') {
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

/**
 * Write manifest file
 *
 * @param {object} obj - Manifest object to write
 * @param {string} [manifestPath='.draftsync.json'] - Path to manifest file
 * @returns {Promise<void>}
 */
export async function writeManifest(obj, manifestPath = '.draftsync.json') {
  await fs.writeFile(manifestPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * Create a new Google Doc from a DOCX file
 *
 * Uploads the DOCX and asks Drive to convert it to Google Docs format.
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} title - Document title
 * @param {string} docxPath - Path to DOCX file to upload
 * @param {string} [folderId] - Optional Google Drive folder ID
 * @returns {Promise<string>} Google Doc ID
 */
export async function createDoc(auth, title, docxPath, folderId = null) {
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: GOOGLE_DOC_MIME,
      ...(folderId && { parents: [folderId] })
    },
    media: {
      mimeType: DOCX_MIME,
      body: createReadStream(docxPath)
    },
    fields: 'id'
  });

  return response.data.id;
}

/**
 * Update an existing Google Doc with new content
 *
 * Replaces the document body with the DOCX content, preserving the
 * document ID and sharing settings.
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} docId - Google Doc ID
 * @param {string} docxPath - Path to DOCX file to upload
 * @returns {Promise<void>}
 */
export async function updateDoc(auth, docId, docxPath) {
  const drive = google.drive({ version: 'v3', auth });

  await drive.files.update({
    fileId: docId,
    media: {
      mimeType: DOCX_MIME,
      body: createReadStream(docxPath)
    }
  });
}

/**
 * Export a Google Doc as DOCX
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} docId - Google Doc ID
 * @param {string} outputPath - Path to save DOCX file
 * @returns {Promise<void>}
 */
export async function exportDocAsDocx(auth, docId, outputPath) {
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.export(
    { fileId: docId, mimeType: DOCX_MIME },
    { responseType: 'stream' }
  );

  await new Promise((resolve, reject) => {
    const dest = createWriteStream(outputPath);
    response.data.on('error', reject).pipe(dest).on('finish', resolve).on('error', reject);
  });
}

/**
 * List Google Docs visible to draftsync
 *
 * Note: with the drive.file scope this only lists documents draftsync
 * itself created.
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} [folderId] - Optional folder ID (defaults to all)
 * @returns {Promise<Array<{id: string, name: string}>>} List of documents
 */
export async function listDocs(auth, folderId = null) {
  const drive = google.drive({ version: 'v3', auth });

  const query = folderId
    ? `'${folderId}' in parents and mimeType='${GOOGLE_DOC_MIME}' and trashed=false`
    : `mimeType='${GOOGLE_DOC_MIME}' and trashed=false`;

  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name, modifiedTime)',
    orderBy: 'modifiedTime desc'
  });

  return response.data.files || [];
}

/**
 * Get metadata for a Google Doc
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} docId - Google Doc ID
 * @returns {Promise<Object>} Document metadata
 */
export async function getDocMetadata(auth, docId) {
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.get({
    fileId: docId,
    fields: 'id, name, createdTime, modifiedTime, webViewLink'
  });

  return response.data;
}

/**
 * Find a Drive folder by name within a parent, creating it if needed
 *
 * Note: with the drive.file scope the search only sees folders draftsync
 * created, so a user's identically-named manual folder won't be found —
 * draftsync manages its own folders.
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} [name='draftsync'] - Folder name
 * @param {string} [parentId='root'] - Parent folder ID
 * @returns {Promise<{id: string, created: boolean}>} Folder ID and whether
 *   it was newly created
 */
export async function ensureFolder(auth, name = DEFAULT_FOLDER_NAME, parentId = 'root') {
  const drive = google.drive({ version: 'v3', auth });

  const escapedName = name.replace(/'/g, "\\'");
  const response = await drive.files.list({
    q: `mimeType='${FOLDER_MIME}' and name='${escapedName}' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1
  });

  const existing = response.data.files?.[0];
  if (existing) {
    return { id: existing.id, created: false };
  }

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id'
  });
  return { id: created.data.id, created: true };
}

/**
 * Resolve (and create if needed) the nested Drive folder for a project:
 * draftsync/<project-name>/
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} projectName - Project folder name
 * @returns {Promise<{id: string, created: boolean}>} Project folder ID
 */
export async function ensureProjectFolder(auth, projectName) {
  const root = await ensureFolder(auth);
  return ensureFolder(auth, projectName, root.id);
}

/**
 * Move a Google Doc to the Drive trash
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} docId - Google Doc ID
 * @returns {Promise<void>}
 */
export async function trashDoc(auth, docId) {
  const drive = google.drive({ version: 'v3', auth });

  await drive.files.update({
    fileId: docId,
    requestBody: { trashed: true }
  });
}
