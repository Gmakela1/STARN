import fs from 'node:fs';

let pdfjsLib: any = null;

async function getPdfJsLib(): Promise<any> {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLib;
}

export async function extractTextFromPdf(filePath: string): Promise<string> {
  const lib = await getPdfJsLib();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await lib.getDocument({ data }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str).join(' ');
    if (text.trim()) {
      pages.push(text.trim());
    }
  }

  const result = pages.join('\n\n--- Page Break ---\n\n');
  return result || '(No extractable text found in this PDF. It may be a scanned document or image-based PDF.)';
}