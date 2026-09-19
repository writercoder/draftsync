/**
 * Unit tests for Google Docs API operations
 *
 * Mocks the googleapis Docs client to verify request flow and shapes
 * without touching the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('googleapis', () => ({
  google: { docs: vi.fn() }
}));

import { google } from 'googleapis';
import { formatDocument, getDocumentContent, insertText, formatRange } from '../src/docs.js';

const AUTH = { fake: 'auth-client' };

function makeDocument(overrides = {}) {
  return {
    documentId: 'doc123',
    title: 'My Chapter',
    body: { content: [{ endIndex: 1 }, { endIndex: 120 }] },
    documentStyle: {},
    ...overrides
  };
}

describe('Docs Unit Tests', () => {
  let documents;

  beforeEach(() => {
    documents = {
      get: vi.fn().mockResolvedValue({ data: makeDocument() }),
      batchUpdate: vi.fn().mockResolvedValue({ data: {} })
    };
    google.docs.mockReturnValue({ documents });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('formatDocument', () => {
    it('should apply body formatting with the real body end index', async () => {
      await formatDocument(AUTH, 'doc123');

      expect(google.docs).toHaveBeenCalledWith({ version: 'v1', auth: AUTH });
      expect(documents.get).toHaveBeenCalledWith({ documentId: 'doc123' });

      const firstUpdate = documents.batchUpdate.mock.calls[0][0];
      expect(firstUpdate.documentId).toBe('doc123');
      const spacing = firstUpdate.requestBody.requests.find(r => r.updateParagraphStyle);
      expect(spacing.updateParagraphStyle.range).toEqual({ startIndex: 1, endIndex: 119 });
    });

    it('should create a default header and set its text to the doc title', async () => {
      documents.batchUpdate
        .mockResolvedValueOnce({ data: {} }) // body formatting
        .mockResolvedValueOnce({
          data: { replies: [{ createHeader: { headerId: 'header-9' } }] }
        })
        .mockResolvedValueOnce({ data: {} }); // header text

      await formatDocument(AUTH, 'doc123');

      const createCall = documents.batchUpdate.mock.calls[1][0];
      expect(createCall.requestBody.requests).toEqual([{ createHeader: { type: 'DEFAULT' } }]);

      const textCall = documents.batchUpdate.mock.calls[2][0];
      expect(textCall.requestBody.requests).toEqual([
        {
          insertText: {
            location: { segmentId: 'header-9', index: 0 },
            text: 'My Chapter'
          }
        }
      ]);
    });

    it('should replace the text of an existing header instead of creating one', async () => {
      documents.get.mockResolvedValue({
        data: makeDocument({
          documentStyle: { defaultHeaderId: 'header-1' },
          headers: { 'header-1': { content: [{ endIndex: 10 }] } }
        })
      });

      await formatDocument(AUTH, 'doc123', { headerText: 'Garbutt / Draft' });

      // Two batchUpdates: body formatting, then header text (no createHeader)
      expect(documents.batchUpdate).toHaveBeenCalledTimes(2);
      const headerCall = documents.batchUpdate.mock.calls[1][0];
      expect(headerCall.requestBody.requests[0]).toEqual({
        deleteContentRange: {
          range: { segmentId: 'header-1', startIndex: 0, endIndex: 9 }
        }
      });
      expect(headerCall.requestBody.requests[1].insertText.text).toBe('Garbutt / Draft');
    });
  });

  describe('getDocumentContent', () => {
    it('should return the documents.get response data', async () => {
      const content = await getDocumentContent(AUTH, 'doc123');
      expect(content.documentId).toBe('doc123');
      expect(documents.get).toHaveBeenCalledWith({ documentId: 'doc123' });
    });
  });

  describe('insertText', () => {
    it('should insert text at the given index', async () => {
      await insertText(AUTH, 'doc123', 'Hello', 5);

      expect(documents.batchUpdate).toHaveBeenCalledWith({
        documentId: 'doc123',
        requestBody: {
          requests: [{ insertText: { location: { index: 5 }, text: 'Hello' } }]
        }
      });
    });
  });

  describe('formatRange', () => {
    it('should apply the requested text styles with matching fields', async () => {
      await formatRange(AUTH, 'doc123', 5, 20, { bold: true, fontSize: 14 });

      const call = documents.batchUpdate.mock.calls[0][0];
      expect(call.requestBody.requests[0].updateTextStyle).toEqual({
        range: { startIndex: 5, endIndex: 20 },
        textStyle: { bold: true, fontSize: { magnitude: 14, unit: 'PT' } },
        fields: 'bold,fontSize'
      });
    });

    it('should reject empty formatting', async () => {
      await expect(formatRange(AUTH, 'doc123', 1, 5, {})).rejects.toThrow(/no formatting/);
    });
  });
});
