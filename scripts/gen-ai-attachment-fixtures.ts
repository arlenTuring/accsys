/**
 * Generates the synthetic attachment test set for the AI assistant acceptance
 * runs. Every file is made up (no real invoice or photo) and marked 測試.
 * Raster formats are produced by macOS `sips` from a rendered PDF page, so the
 * HEIC is a real HEIF container, not a renamed JPEG.
 *
 *   npx tsx scripts/gen-ai-attachment-fixtures.ts <out-dir> <company-tax-id>
 *
 * Output (all labelled 測試):
 *   invoice-match.{png,jpg,heic}   buyer tax id = company
 *   invoice-mismatch.jpg           buyer tax id ≠ company
 *   invoice-missing.jpg            no buyer tax id (二聯式)
 *   invoice-blurry.jpg             tax id printed tiny / low resolution
 *   not-invoice.jpg                meeting-room whiteboard note
 *   cjk-small-transparent.png      small CJK text on transparent background
 *   multipage.pdf                  3-page PDF
 *   large-6mb.png                  > 3 MB (old limit), noisy
 *   large-30mb.pdf                 large file for background processing
 *   corrupt.jpg                    truncated JPEG
 *   spoofed-pdf.jpg                PDF bytes with .jpg name
 *   eicar.txt / eicar-as.pdf       EICAR anti-virus test string (harmless by definition)
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';

const [outDir, companyTaxId] = process.argv.slice(2);
if (!outDir || !/^\d{8}$/.test(companyTaxId ?? '')) {
  throw new Error('usage: gen-ai-attachment-fixtures.ts <out-dir> <company-tax-id>');
}
mkdirSync(outDir, { recursive: true });
const out = (name: string) => path.join(outDir, name);

// Same full CJK font the approved-PDF renderer uses (fontsource splits CJK into many partial subsets).
const FONT = path.join(process.cwd(), 'assets/fonts/NotoSansCJKtc-Regular.otf');

async function doc() {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const cjk = await pdf.embedFont(readFileSync(FONT), { subset: false }) // CFF subsetting garbles glyphs;
  return { pdf, cjk, latin: cjk };
}

/** Draw a line, switching font per run so CJK and ASCII both render. */
function line(page: ReturnType<PDFDocument['addPage']>, fonts: { cjk: PDFFont; latin: PDFFont }, text: string, x: number, y: number, size: number) {
  let cursor = x;
  for (const run of text.match(/[\x20-\x7e]+|[^\x20-\x7e]+/g) ?? []) {
    const font = /^[\x20-\x7e]+$/.test(run) ? fonts.latin : fonts.cjk;
    page.drawText(run, { x: cursor, y, size, font, color: rgb(0.1, 0.1, 0.1) });
    cursor += font.widthOfTextAtSize(run, size);
  }
}

async function invoicePdf(buyerTaxId: string | null, opts: { tiny?: boolean } = {}) {
  const { pdf, cjk, latin } = await doc();
  const page = pdf.addPage([420, 300]);
  page.drawRectangle({ x: 0, y: 0, width: 420, height: 300, color: rgb(1, 1, 1) });
  const f = { cjk, latin };
  line(page, f, '電子發票證明聯（測試樣本，非真實發票）', 20, 265, 16);
  line(page, f, '2026-10-28   發票號碼 TE-12345678', 20, 238, 11);
  line(page, f, '賣方 測試餐飲有限公司  統編 00000000', 20, 216, 11);
  if (buyerTaxId) line(page, f, `買方統編 ${buyerTaxId}`, 20, 194, opts.tiny ? 4 : 11);
  line(page, f, '停車費 1 x 120   NT$120', 20, 160, 11);
  line(page, f, '總計 NT$120', 20, 130, 14);
  return pdf.save();
}

async function textPdf(lines: string[], size = 14, opts: { transparent?: boolean; pages?: number } = {}) {
  const { pdf, cjk, latin } = await doc();
  for (let p = 0; p < (opts.pages ?? 1); p++) {
    const page = pdf.addPage([420, 300]);
    if (!opts.transparent) page.drawRectangle({ x: 0, y: 0, width: 420, height: 300, color: rgb(1, 1, 1) });
    lines.forEach((t, i) => line(page, { cjk, latin }, opts.pages ? `${t}（第 ${p + 1} 頁）` : t, 20, 260 - i * (size + 8), size));
  }
  return pdf.save();
}

function sips(src: string, format: 'png' | 'jpeg' | 'heic', dest: string, dpi = 200) {
  execFileSync('sips', ['-s', 'format', format, '-s', 'dpiWidth', String(dpi), '-s', 'dpiHeight', String(dpi), src, '--out', dest], {
    stdio: 'ignore',
  });
}

async function main() {
  const tmp = (n: string) => out(`.src-${n}.pdf`);
  const write = (n: string, bytes: Uint8Array) => writeFileSync(n, bytes);

  write(tmp('match'), await invoicePdf(companyTaxId));
  sips(tmp('match'), 'png', out('invoice-match.png'));
  sips(out('invoice-match.png'), 'jpeg', out('invoice-match.jpg'));
  sips(out('invoice-match.png'), 'heic', out('invoice-match.heic'));

  write(tmp('mismatch'), await invoicePdf('87654321'));
  sips(tmp('mismatch'), 'png', out('.mismatch.png'));
  sips(out('.mismatch.png'), 'jpeg', out('invoice-mismatch.jpg'));

  write(tmp('missing'), await invoicePdf(null));
  sips(tmp('missing'), 'png', out('.missing.png'));
  sips(out('.missing.png'), 'jpeg', out('invoice-missing.jpg'));

  write(tmp('blurry'), await invoicePdf(companyTaxId, { tiny: true }));
  sips(tmp('blurry'), 'png', out('.blurry.png'), 40);
  sips(out('.blurry.png'), 'jpeg', out('invoice-blurry.jpg'), 40);

  write(tmp('note'), await textPdf(['會議室白板（測試照片）', '週五 Demo 前完成：', '1. 驗收流程', '2. 報支附件']));
  sips(tmp('note'), 'png', out('.note.png'));
  sips(out('.note.png'), 'jpeg', out('not-invoice.jpg'));

  write(tmp('cjk'), await textPdf(['透明背景小字測試：統一編號 12345675', '品名：停車費（測試）'], 6, { transparent: true }));
  sips(tmp('cjk'), 'png', out('cjk-small-transparent.png'));

  write(out('multipage.pdf'), await textPdf(['多頁 PDF 測試文件'], 18, { pages: 3 }));

  // > 3 MB: PNG of random noise does not compress.
  write(out('large-6mb.png'), noisePng(1500, 1400)); // ~6.3 MB raw RGB, stored uncompressed
  {
    const { pdf, cjk, latin } = await doc();
    for (let p = 0; p < 30; p++) {
      const page = pdf.addPage([420, 300]);
      line(page, { cjk, latin }, `大型 PDF 測試第 ${p + 1} 頁`, 20, 260, 18);
      const img = await pdf.embedPng(noisePng(400, 600));
      page.drawImage(img, { x: 20, y: 20, width: 200, height: 200 });
    }
    write(out('large-30mb.pdf'), await pdf.save());
  }

  const jpg = readFileSync(out('invoice-match.jpg'));
  write(out('corrupt.jpg'), jpg.subarray(0, Math.floor(jpg.length / 3)));
  write(out('spoofed-pdf.jpg'), readFileSync(out('multipage.pdf')));

  const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  write(out('eicar.txt'), Buffer.from(eicar));
  write(out('eicar-as.pdf'), Buffer.from(eicar));

  for (const f of ['match', 'mismatch', 'missing', 'blurry', 'note', 'cjk']) {
    try {
      execFileSync('rm', ['-f', tmp(f)]);
    } catch {}
  }
  execFileSync('sh', ['-c', `rm -f "${outDir}"/.*.png`]);
  console.log(execFileSync('ls', ['-la', outDir]).toString());
}

/** Minimal PNG encoder for RGB noise (store-only deflate blocks keep it incompressible). */
function noisePng(width: number, height: number): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    randomBytes(width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
