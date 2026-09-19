/**
 * Google Docs API Operations
 *
 * Handles direct manipulation of Google Docs content and formatting via
 * documents.get / documents.batchUpdate. Request payloads are built by
 * pure functions so they can be unit-tested offline.
 *
 * Known API limitation: the Docs API has no request type for automatic
 * page-number fields, so manuscript footers with page numbers cannot be
 * applied programmatically — add them once in the Docs UI if needed.
 */

import { google } from 'googleapis';

/**
 * Build manuscript formatting requests for documents.batchUpdate
 *
 * Standard manuscript style: 1-inch margins, double-spaced 12pt serif body.
 * The paragraph and text ranges need the real end index of the document
 * body (from documents.get) — the API rejects placeholder ranges.
 *
 * @param {Object} options - Formatting options
 * @param {number} options.bodyEndIndex - End index of the document body
 * @param {number} [options.marginsInch=1] - Margin size in inches
 * @param {number} [options.lineSpacing=2] - Line spacing multiplier (2 = double)
 * @param {string} [options.fontFamily='Times New Roman'] - Body font family
 * @param {number} [options.fontSize=12] - Body font size in points
 * @returns {Array} Array of batchUpdate request objects
 */
export function buildManuscriptRequests(options) {
  const {
    bodyEndIndex,
    marginsInch = 1,
    lineSpacing = 2,
    fontFamily = 'Times New Roman',
    fontSize = 12
  } = options;

  const requests = [];

  // Set document margins (1 inch = 72 points)
  const marginPoints = marginsInch * 72;
  requests.push({
    updateDocumentStyle: {
      documentStyle: {
        marginTop: { magnitude: marginPoints, unit: 'PT' },
        marginBottom: { magnitude: marginPoints, unit: 'PT' },
        marginLeft: { magnitude: marginPoints, unit: 'PT' },
        marginRight: { magnitude: marginPoints, unit: 'PT' }
      },
      fields: 'marginTop,marginBottom,marginLeft,marginRight'
    }
  });

  // Body ranges exclude the final newline of the last paragraph
  const bodyRange = { startIndex: 1, endIndex: bodyEndIndex - 1 };
  if (bodyRange.endIndex > bodyRange.startIndex) {
    if (lineSpacing) {
      requests.push({
        updateParagraphStyle: {
          range: bodyRange,
          paragraphStyle: {
            lineSpacing: lineSpacing * 100 // API uses percentage
          },
          fields: 'lineSpacing'
        }
      });
    }

    if (fontFamily || fontSize) {
      const textStyle = {};
      if (fontFamily) textStyle.weightedFontFamily = { fontFamily };
      if (fontSize) textStyle.fontSize = { magnitude: fontSize, unit: 'PT' };
      requests.push({
        updateTextStyle: {
          range: bodyRange,
          textStyle,
          fields: Object.keys(textStyle).join(',')
        }
      });
    }
  }

  return requests;
}

/**
 * Build requests that replace a header segment's content with new text
 *
 * @param {string} headerId - Header segment ID
 * @param {string} text - Header text to set
 * @param {number} [existingEndIndex=1] - Current end index of the header
 *   segment (1 means empty: just the final newline)
 * @returns {Array} Array of batchUpdate request objects
 */
export function buildHeaderTextRequests(headerId, text, existingEndIndex = 1) {
  const requests = [];

  // Clear existing header content (the final newline cannot be deleted)
  if (existingEndIndex > 1) {
    requests.push({
      deleteContentRange: {
        range: { segmentId: headerId, startIndex: 0, endIndex: existingEndIndex - 1 }
      }
    });
  }

  requests.push({
    insertText: {
      location: { segmentId: headerId, index: 0 },
      text
    }
  });

  return requests;
}

/**
 * Get the end index of a document body from a documents.get response
 *
 * @param {Object} document - documents.get response data
 * @returns {number} End index of the last body element (1 for empty docs)
 */
export function getBodyEndIndex(document) {
  const content = document.body?.content || [];
  return content.length > 0 ? content[content.length - 1].endIndex : 1;
}

/**
 * Extract the plain text of a document from a documents.get response
 *
 * @param {Object} document - documents.get response data
 * @returns {string} Concatenated text content of the body
 */
export function extractText(document) {
  const content = document.body?.content || [];
  let text = '';
  for (const element of content) {
    for (const pe of element.paragraph?.elements || []) {
      text += pe.textRun?.content || '';
    }
  }
  return text;
}

/**
 * Apply manuscript formatting to a Google Doc
 *
 * Applies standard manuscript formatting: 1-inch margins, double-spaced
 * 12pt serif body, and a header ("Author / Title" style). Page-number
 * footers are not supported by the Docs API (see module header).
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} docId - Google Doc ID
 * @param {Object} [options] - Formatting options
 * @param {string} [options.headerText] - Header text (defaults to doc title)
 * @param {number} [options.marginsInch=1] - Margin size in inches
 * @param {number} [options.lineSpacing=2] - Line spacing multiplier
 * @param {string} [options.fontFamily='Times New Roman'] - Body font family
 * @param {number} [options.fontSize=12] - Body font size in points
 * @returns {Promise<void>}
 */
export async function formatDocument(auth, docId, options = {}) {
  const docs = google.docs({ version: 'v1', auth });

  const { data: document } = await docs.documents.get({ documentId: docId });

  // Body formatting
  const requests = buildManuscriptRequests({
    ...options,
    bodyEndIndex: getBodyEndIndex(document)
  });
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests }
  });

  // Header: reuse the existing default header or create one
  const headerText = options.headerText || document.title || 'Untitled';
  let headerId = document.documentStyle?.defaultHeaderId;
  let existingEndIndex = 1;

  if (headerId) {
    const headerContent = document.headers?.[headerId]?.content || [];
    existingEndIndex =
      headerContent.length > 0 ? headerContent[headerContent.length - 1].endIndex : 1;
  } else {
    const { data: reply } = await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: [{ createHeader: { type: 'DEFAULT' } }] }
    });
    headerId = reply.replies?.[0]?.createHeader?.headerId;
  }

  if (headerId) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: buildHeaderTextRequests(headerId, headerText, existingEndIndex) }
    });
  }
}

/**
 * Get the content of a Google Doc
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} docId - Google Doc ID
 * @returns {Promise<Object>} Full documents.get response data (use
 *   extractText() to get the plain text)
 */
export async function getDocumentContent(auth, docId) {
  const docs = google.docs({ version: 'v1', auth });
  const response = await docs.documents.get({ documentId: docId });
  return response.data;
}

/**
 * Insert text into a Google Doc
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} docId - Google Doc ID
 * @param {string} text - Text to insert
 * @param {number} [index=1] - Index to insert at (1 = start of document)
 * @returns {Promise<void>}
 */
export async function insertText(auth, docId, text, index = 1) {
  const docs = google.docs({ version: 'v1', auth });

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [{ insertText: { location: { index }, text } }]
    }
  });
}

/**
 * Apply text formatting to a range in a Google Doc
 *
 * @param {google.auth.OAuth2} auth - Authenticated OAuth2 client
 * @param {string} docId - Google Doc ID
 * @param {number} startIndex - Start of range
 * @param {number} endIndex - End of range
 * @param {Object} formatting - Formatting to apply
 * @param {boolean} [formatting.bold] - Bold on/off
 * @param {boolean} [formatting.italic] - Italic on/off
 * @param {boolean} [formatting.underline] - Underline on/off
 * @param {number} [formatting.fontSize] - Font size in points
 * @param {string} [formatting.fontFamily] - Font family name
 * @returns {Promise<void>}
 */
export async function formatRange(auth, docId, startIndex, endIndex, formatting = {}) {
  const textStyle = {};
  if (formatting.bold !== undefined) textStyle.bold = formatting.bold;
  if (formatting.italic !== undefined) textStyle.italic = formatting.italic;
  if (formatting.underline !== undefined) textStyle.underline = formatting.underline;
  if (formatting.fontSize) textStyle.fontSize = { magnitude: formatting.fontSize, unit: 'PT' };
  if (formatting.fontFamily) {
    textStyle.weightedFontFamily = { fontFamily: formatting.fontFamily };
  }

  if (Object.keys(textStyle).length === 0) {
    throw new Error('formatRange: no formatting options given');
  }

  const docs = google.docs({ version: 'v1', auth });
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          updateTextStyle: {
            range: { startIndex, endIndex },
            textStyle,
            fields: Object.keys(textStyle).join(',')
          }
        }
      ]
    }
  });
}
