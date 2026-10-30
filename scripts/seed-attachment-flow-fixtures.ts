/**
 * Idempotent fixtures for attachment / invoice / company preview flow.
 * Writes ONLY under company code `test_fixture` and SEED_NS-tagged files.
 * Does not overwrite production `default` company profile.
 *
 *   ALLOW_TEST_COMPANY_SEED=1 npx tsx scripts/seed-attachment-flow-fixtures.ts
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/lib/db';
import { companyProfiles } from '../src/lib/db/schema';
import { isValidTaiwanTaxId } from '../src/lib/company/tax-id';

const SEED_NS = 'attach-flow-v1';
const OUT = join(process.cwd(), 'tmp', 'codex-attachment-review', SEED_NS);

/**
 * Uncompressed text PDF so invoice sniff (byte→latin1) can read markers without
 * FlateDecode. Also valid %PDF for upload sniff.
 */
function pdfWithText(lines: string[]): Uint8Array {
  const text = lines.join('\\n');
  // PDF string escape for parentheses
  const safe = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 12 Tf 50 800 Td (${safe}) Tj ET`;
  const objects = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n',
    `4 0 obj<< /Length ${Buffer.byteLength(stream)} >>stream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n',
  ];
  let body = '%PDF-1.4\n% TEST DOCUMENT / DO NOT CLAIM\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body));
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += xref;
  body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  // Also append plain markers outside compressed streams for robust sniff.
  body += `\n% MARKERS\n% ${lines.join(' | ')}\n`;
  return new Uint8Array(Buffer.from(body, 'utf8'));
}

function multiPageInvoicePdf(): Uint8Array {
  // One file with three marker blocks for multipage-style mixed expectations.
  return pdfWithText([
    'TEST INVOICE / DO NOT CLAIM',
    'Buyer Tax ID: 04595257',
    'Seller Tax ID: 10458574',
    'Amount: 1000',
    '--- page2 ---',
    'Buyer Tax ID: 10458574',
    'Seller Tax ID: 04595257',
    'Amount: 2000',
    '--- page3 ---',
    'RECEIPT NO_BUYER',
    'Seller Tax ID: 10458574',
  ]);
}

/** Minimal JPEG (1x1). */
function tinyJpeg(): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
      'base64'
    )
  );
}

/**
 * Minimal HEIC-like ftyp box (not a full decodable image — used for sniff tests).
 * Real HEIC sample path documented separately when codec available.
 */
function fakeHeicHeader(): Uint8Array {
  const b = new Uint8Array(32);
  b[3] = 32;
  b.set([0x66, 0x74, 0x79, 0x70], 4);
  b.set([0x68, 0x65, 0x69, 0x63], 8);
  b.set([0x00, 0x00, 0x00, 0x00], 12);
  b.set([0x6d, 0x69, 0x66, 0x31], 16);
  return b;
}

async function main() {
  if (process.env.ALLOW_TEST_COMPANY_SEED !== '1') {
    console.error('Refusing: set ALLOW_TEST_COMPANY_SEED=1');
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  const db = getDb();

  const taxId = '04595257';
  if (!isValidTaiwanTaxId(taxId)) throw new Error('fixture tax id checksum failed');

  const [existing] = await db.select().from(companyProfiles).where(eq(companyProfiles.code, 'test_fixture')).limit(1);
  if (!existing) {
    await db.insert(companyProfiles).values({
      id: randomUUID(),
      code: 'test_fixture',
      legalName: 'ACCSYS 測試公司（不得報帳）',
      taxId,
      address: '測試地址',
      nameAliases: ['ACCSYS TEST CO'],
      active: true,
      version: 1,
    });
    console.log('created company_profiles test_fixture');
  } else {
    console.log('company_profiles test_fixture already present (not overwritten)');
  }

  const files: { name: string; bytes: Uint8Array; expect: string }[] = [
    {
      name: '01-invoice-match.pdf',
      bytes: pdfWithText([
        'TEST DOCUMENT / DO NOT CLAIM',
        'Buyer Tax ID: 04595257',
        'Seller Tax ID: 10458574',
        'Invoice: AB-123',
      ]),
      expect: 'buyer match',
    },
    {
      name: '02-invoice-mismatch.pdf',
      bytes: pdfWithText([
        'TEST DOCUMENT / DO NOT CLAIM',
        'Buyer Tax ID: 10458574',
        'Seller Tax ID: 04595257',
      ]),
      expect: 'buyer mismatch',
    },
    {
      name: '03-seller-only.pdf',
      bytes: pdfWithText(['TEST DOCUMENT / DO NOT CLAIM', 'SELLER_ONLY', 'Seller Tax ID: 10458574']),
      expect: 'seller only — not buyer match',
    },
    {
      name: '04-receipt-no-buyer.pdf',
      bytes: pdfWithText(['TEST DOCUMENT / DO NOT CLAIM', 'RECEIPT', 'NO_BUYER', 'Amount: 50']),
      expect: 'receipt / no buyer',
    },
    {
      name: '05-unclear-photo.jpg',
      bytes: tinyJpeg(),
      expect: 'blur/rotate photo placeholder',
    },
    {
      name: '06-heic-ftyp-sniff.heic',
      bytes: fakeHeicHeader(),
      expect: 'sniff as heic (decode may fail without real sample)',
    },
    {
      name: '07-multipage-mixed.pdf',
      bytes: multiPageInvoicePdf(),
      expect: 'page1 match, page2 mismatch, page3 receipt',
    },
    {
      name: '08-over-3mb.bin.pdf',
      bytes: (() => {
        // Valid PDF header + padding to >3MB
        const header = Buffer.from('%PDF-1.4\nTEST DOCUMENT / DO NOT CLAIM\n');
        const pad = Buffer.alloc(3 * 1024 * 1024 + 100, 0x20);
        return new Uint8Array(Buffer.concat([header, pad, Buffer.from('\n%%EOF\n')]));
      })(),
      expect: 'exceeds old 3MB limit; within 50MB policy',
    },
    {
      name: '10-encrypted-hint.pdf',
      bytes: pdfWithText(['TEST DOCUMENT / DO NOT CLAIM', 'ENCRYPTED_PDF_PLACEHOLDER']),
      expect: 'placeholder — real encryption tested separately',
    },
  ];

  // Four small extras to exceed old 3-file limit
  for (let i = 1; i <= 4; i++) {
    files.push({
      name: `09-extra-${i}.pdf`,
      bytes: pdfWithText([`TEST DOCUMENT / DO NOT CLAIM extra ${i}`, `Buyer Tax ID: 04595257`]),
      expect: 'batch >3 attachments',
    });
  }

  // Minimal OOXML fixtures (save + optional soffice→PDF derivative)
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('TEST');
  sheet.addRow(['TEST DOCUMENT / DO NOT CLAIM', 'Buyer Tax ID: 04595257']);
  const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());
  files.push({
    name: '11-test.xlsx',
    bytes: new Uint8Array(xlsxBuf),
    expect: 'xlsx upload; preview via soffice when available',
  });

  // Minimal ZIP-based DOCX / PPTX (Content_Types + one part) — enough for sniff + store.
  const { deflateRawSync } = await import('node:zlib');
  function zipStore(entries: { name: string; data: string }[]): Uint8Array {
    // Local file headers + central directory (store method = 0, uncompressed).
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const e of entries) {
      const nameBuf = Buffer.from(e.name, 'utf8');
      const dataBuf = Buffer.from(e.data, 'utf8');
      const local = Buffer.alloc(30 + nameBuf.length + dataBuf.length);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt16LE(0, 10);
      local.writeUInt16LE(0, 12);
      local.writeUInt32LE(0, 14); // crc skipped for fixture
      local.writeUInt32LE(dataBuf.length, 18);
      local.writeUInt32LE(dataBuf.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      nameBuf.copy(local, 30);
      dataBuf.copy(local, 30 + nameBuf.length);
      locals.push(local);
      const central = Buffer.alloc(46 + nameBuf.length);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt16LE(0, 12);
      central.writeUInt16LE(0, 14);
      central.writeUInt32LE(0, 16);
      central.writeUInt32LE(dataBuf.length, 20);
      central.writeUInt32LE(dataBuf.length, 24);
      central.writeUInt16LE(nameBuf.length, 28);
      central.writeUInt32LE(0, 32);
      central.writeUInt32LE(offset, 42);
      nameBuf.copy(central, 46);
      centrals.push(central);
      offset += local.length;
    }
    const centralSize = centrals.reduce((s, b) => s + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    void deflateRawSync; // keep zlib import used for future compressed entries
    return new Uint8Array(Buffer.concat([...locals, ...centrals, end]));
  }
  files.push({
    name: '12-test.docx',
    bytes: zipStore([
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      },
      {
        name: 'word/document.xml',
        data: '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>TEST DOCUMENT / DO NOT CLAIM</w:t></w:r></w:p></w:body></w:document>',
      },
    ]),
    expect: 'docx upload; preview via soffice when available',
  });
  files.push({
    name: '13-test.pptx',
    bytes: zipStore([
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
      },
      {
        name: 'ppt/slides/slide1.xml',
        data: '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>',
      },
    ]),
    expect: 'pptx upload; preview via soffice when available',
  });

  const manifest: Record<string, unknown>[] = [];
  for (const f of files) {
    const path = join(OUT, f.name);
    await writeFile(path, f.bytes);
    manifest.push({
      path,
      name: f.name,
      size: f.bytes.length,
      sha256: createHash('sha256').update(f.bytes).digest('hex'),
      expect: f.expect,
    });
  }

  const manifestPath = join(OUT, 'MANIFEST.json');
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        seedNs: SEED_NS,
        companyCode: 'test_fixture',
        companyTaxId: taxId,
        note: '測試文件／不得報帳 — isolated fixtures only',
        files: manifest,
      },
      null,
      2
    )
  );
  console.log('Wrote', files.length, 'files to', OUT);
  console.log('Manifest', manifestPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
