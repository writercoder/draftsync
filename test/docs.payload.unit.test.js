/**
 * Unit tests for Google Docs API payload construction
 *
 * Tests the pure request-builder and document-parsing helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  buildManuscriptRequests,
  buildHeaderTextRequests,
  getBodyEndIndex,
  extractText
} from '../src/docs.js';

describe('Google Docs Payload Unit Tests', () => {
  describe('buildManuscriptRequests', () => {
    it('should build margins, spacing, and font requests with defaults', () => {
      const requests = buildManuscriptRequests({ bodyEndIndex: 100 });

      expect(requests).toEqual([
        {
          updateDocumentStyle: {
            documentStyle: {
              marginTop: { magnitude: 72, unit: 'PT' },
              marginBottom: { magnitude: 72, unit: 'PT' },
              marginLeft: { magnitude: 72, unit: 'PT' },
              marginRight: { magnitude: 72, unit: 'PT' }
            },
            fields: 'marginTop,marginBottom,marginLeft,marginRight'
          }
        },
        {
          updateParagraphStyle: {
            range: { startIndex: 1, endIndex: 99 },
            paragraphStyle: { lineSpacing: 200 },
            fields: 'lineSpacing'
          }
        },
        {
          updateTextStyle: {
            range: { startIndex: 1, endIndex: 99 },
            textStyle: {
              weightedFontFamily: { fontFamily: 'Times New Roman' },
              fontSize: { magnitude: 12, unit: 'PT' }
            },
            fields: 'weightedFontFamily,fontSize'
          }
        }
      ]);
    });

    it('should convert margins from inches to points', () => {
      for (const [marginsInch, expectedPoints] of [
        [0.5, 36],
        [1, 72],
        [1.5, 108],
        [2, 144]
      ]) {
        const requests = buildManuscriptRequests({ bodyEndIndex: 10, marginsInch });
        const margin = requests.find(r => r.updateDocumentStyle);
        expect(margin.updateDocumentStyle.documentStyle.marginTop.magnitude).toBe(expectedPoints);
      }
    });

    it('should exclude the final newline from body ranges', () => {
      const requests = buildManuscriptRequests({ bodyEndIndex: 50 });
      const spacing = requests.find(r => r.updateParagraphStyle);
      expect(spacing.updateParagraphStyle.range).toEqual({ startIndex: 1, endIndex: 49 });
    });

    it('should skip spacing when lineSpacing is disabled', () => {
      const requests = buildManuscriptRequests({ bodyEndIndex: 100, lineSpacing: 0 });
      expect(requests.find(r => r.updateParagraphStyle)).toBeUndefined();
    });

    it('should convert lineSpacing multiplier to a percentage', () => {
      const requests = buildManuscriptRequests({ bodyEndIndex: 100, lineSpacing: 1.5 });
      const spacing = requests.find(r => r.updateParagraphStyle);
      expect(spacing.updateParagraphStyle.paragraphStyle.lineSpacing).toBe(150);
    });

    it('should only emit the margins request for an empty document', () => {
      const requests = buildManuscriptRequests({ bodyEndIndex: 2 });
      expect(requests).toHaveLength(1);
      expect(requests[0].updateDocumentStyle).toBeDefined();
    });
  });

  describe('buildHeaderTextRequests', () => {
    it('should insert text into an empty header', () => {
      const requests = buildHeaderTextRequests('h1', 'Garbutt / My Novel');
      expect(requests).toEqual([
        {
          insertText: {
            location: { segmentId: 'h1', index: 0 },
            text: 'Garbutt / My Novel'
          }
        }
      ]);
    });

    it('should clear existing content before inserting', () => {
      const requests = buildHeaderTextRequests('h1', 'New Header', 15);
      expect(requests[0]).toEqual({
        deleteContentRange: {
          range: { segmentId: 'h1', startIndex: 0, endIndex: 14 }
        }
      });
      expect(requests[1].insertText.text).toBe('New Header');
    });
  });

  describe('getBodyEndIndex', () => {
    it('should return the end index of the last body element', () => {
      const document = {
        body: { content: [{ endIndex: 1 }, { endIndex: 42 }] }
      };
      expect(getBodyEndIndex(document)).toBe(42);
    });

    it('should return 1 for a document with no body content', () => {
      expect(getBodyEndIndex({})).toBe(1);
    });
  });

  describe('extractText', () => {
    it('should concatenate text runs across paragraphs', () => {
      const document = {
        body: {
          content: [
            { sectionBreak: {} },
            {
              paragraph: {
                elements: [
                  { textRun: { content: 'Four score ' } },
                  { textRun: { content: 'and seven\n' } }
                ]
              }
            },
            {
              paragraph: {
                elements: [{ textRun: { content: 'years ago.\n' } }]
              }
            }
          ]
        }
      };
      expect(extractText(document)).toBe('Four score and seven\nyears ago.\n');
    });

    it('should return an empty string for an empty document', () => {
      expect(extractText({})).toBe('');
    });
  });
});
