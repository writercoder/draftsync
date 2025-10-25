/**
 * Unit tests for Google Docs API payload construction
 *
 * Tests the buildHouseStyleRequests function using snapshots.
 */

import { describe, it, expect } from 'vitest';
import { buildHouseStyleRequests } from '../src/docs.js';

describe('Google Docs Payload Unit Tests', () => {
  describe('buildHouseStyleRequests', () => {
    it('should match snapshot with double spacing and 1-inch margins', () => {
      const requests = buildHouseStyleRequests({
        marginsInch: 1,
        doubleSpacing: true,
        headerText: 'Surname / Title'
      });

      expect(requests).toMatchInlineSnapshot(`
        [
          {
            "updateDocumentStyle": {
              "documentStyle": {
                "marginBottom": {
                  "magnitude": 72,
                  "unit": "PT",
                },
                "marginLeft": {
                  "magnitude": 72,
                  "unit": "PT",
                },
                "marginRight": {
                  "magnitude": 72,
                  "unit": "PT",
                },
                "marginTop": {
                  "magnitude": 72,
                  "unit": "PT",
                },
              },
              "fields": "marginTop,marginBottom,marginLeft,marginRight",
            },
          },
          {
            "updateParagraphStyle": {
              "fields": "lineSpacing",
              "paragraphStyle": {
                "lineSpacing": 200,
              },
              "range": {
                "endIndex": -1,
                "startIndex": 1,
              },
            },
          },
          {
            "createHeader": {
              "sectionBreakLocation": {
                "index": 1,
              },
              "type": "DEFAULT",
            },
          },
        ]
      `);
    });

    it('should match snapshot with single spacing and 0.5-inch margins', () => {
      const requests = buildHouseStyleRequests({
        marginsInch: 0.5,
        doubleSpacing: false
      });

      expect(requests).toMatchInlineSnapshot(`
        [
          {
            "updateDocumentStyle": {
              "documentStyle": {
                "marginBottom": {
                  "magnitude": 36,
                  "unit": "PT",
                },
                "marginLeft": {
                  "magnitude": 36,
                  "unit": "PT",
                },
                "marginRight": {
                  "magnitude": 36,
                  "unit": "PT",
                },
                "marginTop": {
                  "magnitude": 36,
                  "unit": "PT",
                },
              },
              "fields": "marginTop,marginBottom,marginLeft,marginRight",
            },
          },
        ]
      `);
    });

    it('should include margins request', () => {
      const requests = buildHouseStyleRequests({ marginsInch: 1 });

      const marginRequest = requests.find(r => r.updateDocumentStyle);

      expect(marginRequest).toBeDefined();
      expect(marginRequest.updateDocumentStyle.documentStyle).toMatchObject({
        marginTop: { magnitude: 72, unit: 'PT' },
        marginBottom: { magnitude: 72, unit: 'PT' },
        marginLeft: { magnitude: 72, unit: 'PT' },
        marginRight: { magnitude: 72, unit: 'PT' }
      });
    });

    it('should convert margins from inches to points correctly', () => {
      const requests = buildHouseStyleRequests({ marginsInch: 2 });

      const marginRequest = requests.find(r => r.updateDocumentStyle);

      expect(marginRequest.updateDocumentStyle.documentStyle.marginTop.magnitude).toBe(144);
    });

    it('should include paragraph spacing when doubleSpacing is true', () => {
      const requests = buildHouseStyleRequests({ doubleSpacing: true });

      const spacingRequest = requests.find(r => r.updateParagraphStyle);

      expect(spacingRequest).toBeDefined();
      expect(spacingRequest.updateParagraphStyle.paragraphStyle.lineSpacing).toBe(200);
    });

    it('should not include paragraph spacing when doubleSpacing is false', () => {
      const requests = buildHouseStyleRequests({ doubleSpacing: false });

      const spacingRequest = requests.find(r => r.updateParagraphStyle);

      expect(spacingRequest).toBeUndefined();
    });

    it('should include header when headerText is provided', () => {
      const requests = buildHouseStyleRequests({ headerText: 'Author / Title' });

      const headerRequest = requests.find(r => r.createHeader);

      expect(headerRequest).toBeDefined();
      expect(headerRequest.createHeader.type).toBe('DEFAULT');
    });

    it('should not include header when headerText is null', () => {
      const requests = buildHouseStyleRequests({ headerText: null });

      const headerRequest = requests.find(r => r.createHeader);

      expect(headerRequest).toBeUndefined();
    });

    it('should use defaults when no options provided', () => {
      const requests = buildHouseStyleRequests();

      // Should have margins (default 1 inch)
      const marginRequest = requests.find(r => r.updateDocumentStyle);
      expect(marginRequest.updateDocumentStyle.documentStyle.marginTop.magnitude).toBe(72);

      // Should have double spacing (default true)
      const spacingRequest = requests.find(r => r.updateParagraphStyle);
      expect(spacingRequest).toBeDefined();

      // Should not have header (default null)
      const headerRequest = requests.find(r => r.createHeader);
      expect(headerRequest).toBeUndefined();
    });

    it('should handle custom margin sizes correctly', () => {
      const testCases = [
        { marginsInch: 0.5, expectedPoints: 36 },
        { marginsInch: 1, expectedPoints: 72 },
        { marginsInch: 1.5, expectedPoints: 108 },
        { marginsInch: 2, expectedPoints: 144 }
      ];

      testCases.forEach(({ marginsInch, expectedPoints }) => {
        const requests = buildHouseStyleRequests({ marginsInch });
        const marginRequest = requests.find(r => r.updateDocumentStyle);

        expect(marginRequest.updateDocumentStyle.documentStyle.marginTop.magnitude).toBe(
          expectedPoints
        );
      });
    });

    it('should return an array', () => {
      const requests = buildHouseStyleRequests();

      expect(Array.isArray(requests)).toBe(true);
    });

    it('should have at least one request (margins)', () => {
      const requests = buildHouseStyleRequests();

      expect(requests.length).toBeGreaterThanOrEqual(1);
    });
  });
});
