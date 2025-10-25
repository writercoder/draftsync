/**
 * Google Drive API Operations
 *
 * Handles file upload, download, and management in Google Drive.
 */

import { google } from 'googleapis';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';

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
  await fs.writeFile(manifestPath, JSON.stringify(obj, null, 2), 'utf8');
}

/**
 * Create a new Google Doc from a DOCX file
 *
 * TODO: Implement actual Google Drive upload
 * - Upload DOCX file to Google Drive
 * - Convert to Google Docs format
 * - Optionally place in specific folder
 * - Return the new document ID
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} title - Document title
 * @param {string} docxPath - Path to DOCX file to upload
 * @param {string} [folderId] - Optional Google Drive folder ID
 * @returns {Promise<string>} Google Doc ID
 */
export async function createDoc(auth, title, docxPath, folderId = null) {
  console.log(chalk.gray(`  [STUB] Creating Google Doc: ${title}`));

  // TODO: Implement actual Google Drive upload
  // const drive = google.drive({ version: 'v3', auth });
  //
  // const fileMetadata = {
  //   name: title,
  //   mimeType: 'application/vnd.google-apps.document',
  //   ...(folderId && { parents: [folderId] })
  // };
  //
  // const media = {
  //   mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  //   body: fs.createReadStream(docxPath)
  // };
  //
  // const response = await drive.files.create({
  //   requestBody: fileMetadata,
  //   media: media,
  //   fields: 'id'
  // });
  //
  // return response.data.id;

  // Stub: return a fake document ID
  const fakeId = 'stub_' + Math.random().toString(36).substring(7);
  console.log(chalk.gray(`  [STUB] Would upload ${docxPath} to Drive`));
  if (folderId) {
    console.log(chalk.gray(`  [STUB] Would place in folder: ${folderId}`));
  }
  return fakeId;
}

/**
 * Update an existing Google Doc with new content
 *
 * TODO: Implement actual Google Drive update
 * - Download existing doc
 * - Upload new DOCX content
 * - Preserve document ID and sharing settings
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} docId - Google Doc ID
 * @param {string} docxPath - Path to DOCX file to upload
 * @returns {Promise<void>}
 */
export async function updateDoc(auth, docId, docxPath) {
  console.log(chalk.gray(`  [STUB] Updating Google Doc: ${docId}`));

  // TODO: Implement actual Google Drive update
  // const drive = google.drive({ version: 'v3', auth });
  //
  // const media = {
  //   mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  //   body: fs.createReadStream(docxPath)
  // };
  //
  // await drive.files.update({
  //   fileId: docId,
  //   media: media
  // });

  console.log(chalk.gray(`  [STUB] Would update doc ${docId} with ${docxPath}`));
}

/**
 * Export a Google Doc as DOCX
 *
 * TODO: Implement actual Google Drive export
 * - Export Google Doc to DOCX format
 * - Save to local file
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} docId - Google Doc ID
 * @param {string} outputPath - Path to save DOCX file
 * @returns {Promise<void>}
 */
export async function exportDocAsDocx(auth, docId, outputPath) {
  console.log(chalk.gray(`  [STUB] Exporting Google Doc ${docId} as DOCX`));

  // TODO: Implement actual Google Drive export
  // const drive = google.drive({ version: 'v3', auth });
  //
  // const response = await drive.files.export({
  //   fileId: docId,
  //   mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  // }, {
  //   responseType: 'stream'
  // });
  //
  // const dest = fs.createWriteStream(outputPath);
  // response.data.pipe(dest);
  //
  // return new Promise((resolve, reject) => {
  //   dest.on('finish', resolve);
  //   dest.on('error', reject);
  // });

  console.log(chalk.gray(`  [STUB] Would export to ${outputPath}`));
}

/**
 * List all Google Docs in a folder
 *
 * TODO: Implement actual Google Drive listing
 * - Query for documents in folder
 * - Return list of doc IDs and titles
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} [folderId] - Optional folder ID (defaults to root)
 * @returns {Promise<Array<{id: string, name: string}>>} List of documents
 */
export async function listDocs(auth, folderId = null) {
  console.log(chalk.gray(`  [STUB] Listing Google Docs`));

  // TODO: Implement actual Google Drive listing
  // const drive = google.drive({ version: 'v3', auth });
  //
  // const query = folderId
  //   ? `'${folderId}' in parents and mimeType='application/vnd.google-apps.document'`
  //   : `mimeType='application/vnd.google-apps.document'`;
  //
  // const response = await drive.files.list({
  //   q: query,
  //   fields: 'files(id, name)',
  //   orderBy: 'modifiedTime desc'
  // });
  //
  // return response.data.files;

  // Stub: return empty list
  return [];
}

/**
 * Get metadata for a Google Doc
 *
 * TODO: Implement actual metadata retrieval
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} docId - Google Doc ID
 * @returns {Promise<Object>} Document metadata
 */
export async function getDocMetadata(auth, docId) {
  console.log(chalk.gray(`  [STUB] Getting metadata for ${docId}`));

  // TODO: Implement actual metadata retrieval
  // const drive = google.drive({ version: 'v3', auth });
  //
  // const response = await drive.files.get({
  //   fileId: docId,
  //   fields: 'id, name, createdTime, modifiedTime, webViewLink'
  // });
  //
  // return response.data;

  // Stub: return fake metadata
  return {
    id: docId,
    name: 'Untitled Document',
    createdTime: new Date().toISOString(),
    modifiedTime: new Date().toISOString(),
    webViewLink: `https://docs.google.com/document/d/${docId}/edit`
  };
}
