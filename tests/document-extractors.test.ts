import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { formatCsvAsTable } from '../src/tools/document-extractors/csv-extractor.js';
import { extractTextFromDocx } from '../src/tools/document-extractors/docx-extractor.js';
import { fsReadHandler } from '../src/tools/handlers/fs-read.js';
import { ToolExecutionContext } from '../src/tools/types.js';

// Helper to create a valid minimal zip archive containing a single file
function createZipWithFile(filename: string, content: string): Buffer {
  const contentBuf = Buffer.from(content, 'utf-8');
  const compressed = zlib.deflateRawSync(contentBuf);
  const nameBuf = Buffer.from(filename, 'utf-8');

  // Local file header: 30 bytes + name length + extra (0) + compressed data
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // signature
  localHeader.writeUInt16LE(20, 4);         // version needed (2.0)
  localHeader.writeUInt16LE(0, 6);          // general purpose bit flag
  localHeader.writeUInt16LE(8, 8);          // compression method: 8 = deflate
  localHeader.writeUInt16LE(0, 10);         // last mod time
  localHeader.writeUInt16LE(0, 12);         // last mod date
  localHeader.writeUInt32LE(0, 14);         // crc-32 (0 for test)
  localHeader.writeUInt32LE(compressed.length, 18); // compressed size
  localHeader.writeUInt32LE(contentBuf.length, 22); // uncompressed size
  localHeader.writeUInt16LE(nameBuf.length, 26);    // filename length
  localHeader.writeUInt16LE(0, 28);                 // extra field length

  return Buffer.concat([localHeader, nameBuf, compressed]);
}

describe('Document Extractors (Zero External Dependencies)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-doc-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('formatCsvAsTable', () => {
    it('formats raw CSV into clean markdown table with alignment', () => {
      const rawCsv = `Item,Qty,Unit Price,Total\nSolar Panel 400W,4,180.00,720.00\nInverter 3kW,1,650.00,650.00`;
      const formatted = formatCsvAsTable(rawCsv);
      expect(formatted).toContain('| Item | Qty | Unit Price | Total |');
      expect(formatted).toContain('|---|---|---|---|');
      expect(formatted).toContain('| Solar Panel 400W | 4 | 180.00 | 720.00 |');
      expect(formatted).toContain('| Inverter 3kW | 1 | 650.00 | 650.00 |');
    });

    it('handles quoted fields with embedded commas', () => {
      const rawCsv = `Part Number,Description,Price\n"VIC-150-35","Victron SmartSolar, 150/35",320.00\n`;
      const formatted = formatCsvAsTable(rawCsv);
      expect(formatted).toContain('| VIC-150-35 | Victron SmartSolar, 150/35 | 320.00 |');
    });

    it('caps output and adds truncation note when row limit exceeded', () => {
      const rows = ['ID,Val'];
      for (let i = 1; i <= 60; i++) {
        rows.push(`${i},Item-${i}`);
      }
      const rawCsv = rows.join('\n');
      const formatted = formatCsvAsTable(rawCsv, { maxRows: 50 });
      expect(formatted).toContain('| 49 | Item-49 |');
      expect(formatted).not.toContain('| 50 | Item-50 |');
      expect(formatted).toContain('truncated: showing 50 of 61 rows');
    });
  });

  describe('extractTextFromDocx', () => {
    it('extracts text paragraphs and headings from word/document.xml in zip buffer', async () => {
      const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>ME1115 BLDC Motor Technical Datasheet</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Nominal Voltage: 72V DC</w:t></w:r>
      <w:r><w:br/><w:t>Peak Power: 12kW</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

      const docxBuffer = createZipWithFile('word/document.xml', sampleXml);
      const docxPath = path.join(tmpDir, 'spec.docx');
      fs.writeFileSync(docxPath, docxBuffer);

      const text = await extractTextFromDocx(docxPath);
      expect(text).toContain('ME1115 BLDC Motor Technical Datasheet');
      expect(text).toContain('Nominal Voltage: 72V DC');
      expect(text).toContain('Peak Power: 12kW');
    });

    it('returns informative message when file is corrupt or not a valid docx zip', async () => {
      const corruptPath = path.join(tmpDir, 'bad.docx');
      fs.writeFileSync(corruptPath, Buffer.from('not a zip file'));

      await expect(extractTextFromDocx(corruptPath)).rejects.toThrow();
    });
  });

  describe('fs_read integration', () => {
    it('routes .csv and .docx files to specialized extractors with header banners', async () => {
      const context: ToolExecutionContext = { projectPath: tmpDir };

      // CSV test
      const csvPath = path.join(tmpDir, 'hardware.csv');
      fs.writeFileSync(csvPath, 'Name,Status\nMotor,Shipped\nInverter,Received\n', 'utf-8');
      const resCsv = await fsReadHandler.execute({ path: 'hardware.csv' }, context);
      expect(resCsv.success).toBe(true);
      expect(resCsv.result).toContain('[Tabular CSV: hardware.csv]');
      expect(resCsv.result).toContain('| Motor | Shipped |');

      // DOCX test
      const docxXml = `<w:document><w:body><w:p><w:r><w:t>Motor Pinout: Pin 1 Hall A, Pin 2 Hall B</w:t></w:r></w:p></w:body></w:document>`;
      const docxBuf = createZipWithFile('word/document.xml', docxXml);
      const docxPath = path.join(tmpDir, 'pinouts.docx');
      fs.writeFileSync(docxPath, docxBuf);

      const resDocx = await fsReadHandler.execute({ path: 'pinouts.docx' }, context);
      expect(resDocx.success).toBe(true);
      expect(resDocx.result).toContain('[DOCX Document: pinouts.docx]');
      expect(resDocx.result).toContain('Motor Pinout: Pin 1 Hall A, Pin 2 Hall B');
    });
  });
});
