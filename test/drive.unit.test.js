/**
 * Unit tests for Google Drive operations
 *
 * Mocks the googleapis Drive client to verify request shapes without
 * touching the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

vi.mock('googleapis', () => ({
  google: { drive: vi.fn() }
}));

import { google } from 'googleapis';
import {
  createDoc,
  updateDoc,
  exportDocAsDocx,
  listDocs,
  getDocMetadata,
  trashDoc,
  ensureFolder,
  ensureProjectFolder
} from '../src/drive.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const AUTH = { fake: 'auth-client' };

describe('Drive Unit Tests', () => {
  let tempDir;
  let files;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'draftsync-drive-'));
    files = {
      create: vi.fn().mockResolvedValue({ data: { id: 'doc123' } }),
      update: vi.fn().mockResolvedValue({}),
      export: vi.fn(),
      list: vi.fn().mockResolvedValue({ data: { files: [] } }),
      get: vi.fn().mockResolvedValue({ data: { id: 'doc123', name: 'Test' } })
    };
    google.drive.mockReturnValue({ files });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  async function makeDocx() {
    const docxPath = join(tempDir, 'test.docx');
    await fs.writeFile(docxPath, 'fake docx bytes', 'utf8');
    return docxPath;
  }

  // The mocked client never consumes the upload stream, so close it before
  // the temp dir is removed — otherwise its lazy open races teardown and
  // emits an unhandled ENOENT
  function closeUploadStream(call) {
    call.media.body.on('error', () => {});
    call.media.body.destroy();
  }

  describe('createDoc', () => {
    it('should upload DOCX with conversion to Google Docs format', async () => {
      const docxPath = await makeDocx();
      const id = await createDoc(AUTH, 'My Chapter', docxPath);

      expect(id).toBe('doc123');
      expect(google.drive).toHaveBeenCalledWith({ version: 'v3', auth: AUTH });
      const call = files.create.mock.calls[0][0];
      expect(call.requestBody).toEqual({
        name: 'My Chapter',
        mimeType: 'application/vnd.google-apps.document'
      });
      expect(call.media.mimeType).toBe(DOCX_MIME);
      expect(call.fields).toBe('id');
      closeUploadStream(call);
    });

    it('should place the doc in a folder when folderId is given', async () => {
      const docxPath = await makeDocx();
      await createDoc(AUTH, 'My Chapter', docxPath, 'folder-9');

      const call = files.create.mock.calls[0][0];
      expect(call.requestBody.parents).toEqual(['folder-9']);
      closeUploadStream(call);
    });
  });

  describe('updateDoc', () => {
    it('should replace the document media by file ID', async () => {
      const docxPath = await makeDocx();
      await updateDoc(AUTH, 'doc123', docxPath);

      const call = files.update.mock.calls[0][0];
      expect(call.fileId).toBe('doc123');
      expect(call.media.mimeType).toBe(DOCX_MIME);
      closeUploadStream(call);
    });
  });

  describe('exportDocAsDocx', () => {
    it('should stream the export to the output file', async () => {
      files.export.mockResolvedValue({ data: Readable.from(['exported ', 'content']) });
      const outputPath = join(tempDir, 'out.docx');

      await exportDocAsDocx(AUTH, 'doc123', outputPath);

      expect(files.export).toHaveBeenCalledWith(
        { fileId: 'doc123', mimeType: DOCX_MIME },
        { responseType: 'stream' }
      );
      expect(await fs.readFile(outputPath, 'utf8')).toBe('exported content');
    });

    it('should reject when the export stream errors', async () => {
      const broken = new Readable({
        read() {
          this.destroy(new Error('boom'));
        }
      });
      files.export.mockResolvedValue({ data: broken });

      await expect(exportDocAsDocx(AUTH, 'doc123', join(tempDir, 'out.docx'))).rejects.toThrow(
        'boom'
      );
    });
  });

  describe('listDocs', () => {
    it('should query for non-trashed Google Docs', async () => {
      await listDocs(AUTH);
      expect(files.list.mock.calls[0][0].q).toBe(
        "mimeType='application/vnd.google-apps.document' and trashed=false"
      );
    });

    it('should scope the query to a folder when given', async () => {
      await listDocs(AUTH, 'folder-9');
      expect(files.list.mock.calls[0][0].q).toContain("'folder-9' in parents");
    });

    it('should return an empty array when Drive returns no files field', async () => {
      files.list.mockResolvedValue({ data: {} });
      expect(await listDocs(AUTH)).toEqual([]);
    });
  });

  describe('getDocMetadata', () => {
    it('should request the metadata fields by file ID', async () => {
      const meta = await getDocMetadata(AUTH, 'doc123');
      expect(meta).toEqual({ id: 'doc123', name: 'Test' });
      expect(files.get).toHaveBeenCalledWith({
        fileId: 'doc123',
        fields: 'id, name, createdTime, modifiedTime, webViewLink'
      });
    });
  });

  describe('ensureFolder', () => {
    it('should return the existing folder without creating one', async () => {
      files.list.mockResolvedValue({ data: { files: [{ id: 'folder-1', name: 'draftsync' }] } });

      const result = await ensureFolder(AUTH);

      expect(result).toEqual({ id: 'folder-1', created: false });
      expect(files.list.mock.calls[0][0].q).toBe(
        "mimeType='application/vnd.google-apps.folder' and name='draftsync' and 'root' in parents and trashed=false"
      );
      expect(files.create).not.toHaveBeenCalled();
    });

    it('should create the folder when none exists', async () => {
      files.list.mockResolvedValue({ data: { files: [] } });
      files.create.mockResolvedValue({ data: { id: 'folder-new' } });

      const result = await ensureFolder(AUTH);

      expect(result).toEqual({ id: 'folder-new', created: true });
      expect(files.create).toHaveBeenCalledWith({
        requestBody: {
          name: 'draftsync',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['root']
        },
        fields: 'id'
      });
    });

    it('should scope lookup and creation to a parent folder', async () => {
      files.list.mockResolvedValue({ data: { files: [] } });
      files.create.mockResolvedValue({ data: { id: 'sub' } });

      await ensureFolder(AUTH, 'my-novel', 'root-1');

      expect(files.list.mock.calls[0][0].q).toContain("'root-1' in parents");
      expect(files.create.mock.calls[0][0].requestBody.parents).toEqual(['root-1']);
    });
  });

  describe('ensureProjectFolder', () => {
    it('should nest the project folder inside the draftsync root', async () => {
      files.list
        .mockResolvedValueOnce({ data: { files: [{ id: 'root-1', name: 'draftsync' }] } })
        .mockResolvedValueOnce({ data: { files: [] } });
      files.create.mockResolvedValue({ data: { id: 'proj-1' } });

      const result = await ensureProjectFolder(AUTH, 'my-novel');

      expect(result).toEqual({ id: 'proj-1', created: true });
      expect(files.list.mock.calls[1][0].q).toContain("name='my-novel' and 'root-1' in parents");
      expect(files.create.mock.calls[0][0].requestBody.parents).toEqual(['root-1']);
    });

    it('should escape quotes in custom folder names', async () => {
      files.list.mockResolvedValue({ data: { files: [] } });
      files.create.mockResolvedValue({ data: { id: 'f' } });

      await ensureFolder(AUTH, "Richard's Drafts");

      expect(files.list.mock.calls[0][0].q).toContain("name='Richard\\'s Drafts'");
    });
  });

  describe('trashDoc', () => {
    it('should mark the file as trashed', async () => {
      await trashDoc(AUTH, 'doc123');
      expect(files.update).toHaveBeenCalledWith({
        fileId: 'doc123',
        requestBody: { trashed: true }
      });
    });
  });
});
