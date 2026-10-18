import fs from 'node:fs';
import zlib from 'node:zlib';

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Searches a ZIP buffer for an entry matching targetName (e.g. 'word/document.xml')
 * and decompresses its content using Node.js built-in zlib.
 */
function extractZipEntry(buffer: Buffer, targetName: string): string | null {
  let offset = 0;
  const len = buffer.length;

  while (offset < len - 30) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      // Not a local file header — could be central directory or end of archive
      break;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);

    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    if (fileNameEnd > len) break;

    const entryName = buffer.toString('utf-8', fileNameStart, fileNameEnd);
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > len) break;

    if (entryName === targetName) {
      const compressedData = buffer.subarray(dataStart, dataEnd);
      if (compressionMethod === 8) {
        // Deflate
        const decompressed = zlib.inflateRawSync(compressedData);
        return decompressed.toString('utf-8');
      } else if (compressionMethod === 0) {
        // Stored (no compression)
        return compressedData.toString('utf-8');
      } else {
        throw new Error(`Unsupported compression method in docx: ${compressionMethod}`);
      }
    }

    offset = dataEnd;
  }

  return null;
}

/**
 * Parses XML text from word/document.xml into readable plain text paragraphs.
 */
function parseDocxXml(xml: string): string {
  // Convert line breaks and paragraph breaks
  let processed = xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ');

  // Extract all text inside <w:t> tags
  const textMatches: string[] = [];
  const regex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let match: RegExpExecArray | null;

  // We can also extract structured paragraphs:
  // Split by paragraph marker \n\n
  const paragraphs = processed.split('\n\n');
  const resultParagraphs: string[] = [];

  for (const p of paragraphs) {
    let pText = '';
    while ((match = regex.exec(p)) !== null) {
      pText += match[1];
    }
    const clean = decodeXmlEntities(pText).trim();
    if (clean.length > 0) {
      resultParagraphs.push(clean);
    }
  }

  return resultParagraphs.join('\n\n');
}

/**
 * Extracts clean text from a .docx file without any external npm dependencies.
 * Uses Node.js built-in zlib to read word/document.xml.
 */
export async function extractTextFromDocx(filePathOrBuffer: string | Buffer): Promise<string> {
  const buffer = typeof filePathOrBuffer === 'string'
    ? fs.readFileSync(filePathOrBuffer)
    : filePathOrBuffer;

  if (buffer.length < 30 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Not a valid DOCX file (invalid ZIP signature).');
  }

  const documentXml = extractZipEntry(buffer, 'word/document.xml');
  if (!documentXml) {
    throw new Error('Corrupt or unrecognized DOCX format (word/document.xml missing).');
  }

  const text = parseDocxXml(documentXml);
  return text;
}
