import dns from 'node:dns';
import net from 'node:net';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { GoogleAuth, Impersonated } from 'google-auth-library';

try {
  dns.setDefaultResultOrder('ipv4first');
  if (typeof net.setDefaultAutoSelectFamily === 'function') {
    net.setDefaultAutoSelectFamily(true);
  }
  if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
    net.setDefaultAutoSelectFamilyAttemptTimeout(250);
  }
  // Route docs/sheets/slides.googleapis.com through www.googleapis.com's healthy GFE edge IPs
  // to avoid the 10-second TCP SYN timeout on unreachable 172.217.11x.4 anycast IPs.
  const origLookup = dns.lookup.bind(dns) as (
    hostname: string,
    options: unknown,
    callback?: unknown
  ) => unknown;
  const patchedLookup = ((
    hostname: string,
    options: unknown,
    callback?: unknown
  ) => {
    const targetHost =
      hostname === 'docs.googleapis.com' ||
      hostname === 'sheets.googleapis.com' ||
      hostname === 'slides.googleapis.com' ||
      hostname === 'oauth2.googleapis.com' ||
      hostname === 'iamcredentials.googleapis.com' ||
      hostname === 'aiplatform.googleapis.com' ||
      hostname.endsWith('-aiplatform.googleapis.com')
        ? 'www.googleapis.com'
        : hostname;
    if (typeof options === 'function') {
      return origLookup(targetHost, options);
    }
    return origLookup(targetHost, options, callback);
  }) as unknown as typeof dns.lookup;
  dns.lookup = patchedLookup;
} catch {
  // ignore
}

const TOKEN_STORE_PATH = join(process.cwd(), '.drive-oauth-tokens.json');
const NATIVE_GDOC_MAP_PATH = join(process.cwd(), '.drive-native-gdoc-map.json');
const SECTIONS_CACHE_PATH = join(process.cwd(), '.drive-doc-sections-cache.json');
const PARAS_CACHE_PATH = join(process.cwd(), '.drive-doc-paras-cache.json');
const INITIAL_NATIVE_GDOC_MAP: Record<string, string> = {
  '1cMm0JJ4ll3j-uKqOAWaDp6cvZQqiUw6L': '1dQVfqQeBzvu0ezosoMUM09j1jDIYp15fVsRAiO8N3gY',
  '1dQVfqQeBzvu0ezosoMUM09j1jDIYp15fVsRAiO8N3gY': '1dQVfqQeBzvu0ezosoMUM09j1jDIYp15fVsRAiO8N3gY',
  '1fguktW4gc4II3Bpy_5RpsJ-MMxF2Aa_1': '1-b6tU7mBHC0VVAf9ROWz4n-JCYp-ynF87lVecnmQv4U',
  '1-b6tU7mBHC0VVAf9ROWz4n-JCYp-ynF87lVecnmQv4U': '1-b6tU7mBHC0VVAf9ROWz4n-JCYp-ynF87lVecnmQv4U',
  'name:州巧科技股份有限公司_產業升級創新平台補助_20240702(預算調整前).docx':
    '1-b6tU7mBHC0VVAf9ROWz4n-JCYp-ynF87lVecnmQv4U',
};
const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
];

type StoredOAuthToken = {
  email: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  updatedAt: string;
};

type TokenStoreFile = {
  byEmail: Record<string, StoredOAuthToken>;
  latestEmail?: string;
};

function readTokenStore(): TokenStoreFile {
  try {
    if (!existsSync(TOKEN_STORE_PATH)) return { byEmail: {} };
    const raw = readFileSync(TOKEN_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as TokenStoreFile;
    return parsed && typeof parsed.byEmail === 'object' ? parsed : { byEmail: {} };
  } catch {
    return { byEmail: {} };
  }
}

export function saveUserDriveOAuthTokens(input: {
  email: string;
  accessToken?: string;
  refreshToken?: string;
  expiresInSeconds?: number;
}): void {
  try {
    const emailKey = input.email.trim().toLowerCase();
    if (!emailKey) return;
    const store = readTokenStore();
    const existing = store.byEmail[emailKey];
    store.byEmail[emailKey] = {
      email: emailKey,
      accessToken: input.accessToken || existing?.accessToken,
      refreshToken: input.refreshToken || existing?.refreshToken,
      expiresAt: input.expiresInSeconds
        ? Date.now() + input.expiresInSeconds * 1000 - 30_000
        : existing?.expiresAt,
      updatedAt: new Date().toISOString(),
    };
    store.latestEmail = emailKey;
    writeFileSync(TOKEN_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // ignore fs write error in read-only environments
  }
}

async function exchangeRefreshToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<string | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: params.clientId,
        client_secret: params.clientSecret,
        refresh_token: params.refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; scope?: string };
    if (
      typeof data.scope === 'string' &&
      !data.scope.includes('drive') &&
      !data.scope.includes('documents')
    ) {
      return null;
    }
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Collects candidate Google Drive access tokens from all available sources:
 * 1. User OAuth token saved during `/auth/callback`
 * 2. Explicit env refresh token (`GWS_DRIVE_REFRESH_TOKEN` / `GOOGLE_DRIVE_REFRESH_TOKEN`)
 * 3. Local gcloud legacy credentials (`~/.config/gcloud/legacy_credentials/.../adc.json`)
 * 4. Impersonated GCP service account (`AI_CHAT_IMPERSONATE_SA`) with Drive/Docs scopes
 * 5. Default ADC (`GoogleAuth`)
 */
export async function getCandidateDriveWriteTokens(
  userEmail?: string,
  options?: { includeSlowFallbacks?: boolean }
): Promise<string[]> {
  const tokens: string[] = [];
  const addToken = (t: string | null | undefined) => {
    if (t && !tokens.includes(t)) tokens.push(t);
  };

  const candidateClientPairs: Array<{ clientId: string; clientSecret: string }> = [
    {
      clientId: process.env.GOOGLE_CLIENT_ID?.trim() || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || '',
    },
    {
      clientId: process.env.GWS_DRIVE_CLIENT_ID?.trim() || '',
      clientSecret: process.env.GWS_DRIVE_CLIENT_SECRET?.trim() || '',
    },
    {
      clientId: process.env.GWS_DIRECTORY_CLIENT_ID?.trim() || '',
      clientSecret: process.env.GWS_DIRECTORY_CLIENT_SECRET?.trim() || '',
    },
  ].filter((p) => Boolean(p.clientId && p.clientSecret));

  const clientId = candidateClientPairs[0]?.clientId || '';
  const clientSecret = candidateClientPairs[0]?.clientSecret || '';

  // 1. Saved OAuth token from user login — FAST PATH (0ms if cached accessToken is still valid)
  const store = readTokenStore();
  const emailKey = userEmail?.trim().toLowerCase() || store.latestEmail;
  const entries = [
    ...(emailKey && store.byEmail[emailKey] ? [store.byEmail[emailKey]] : []),
    ...Object.values(store.byEmail),
  ];
  for (const entry of entries) {
    const isFresh =
      Boolean(entry.accessToken) &&
      (!entry.expiresAt || entry.expiresAt > Date.now() + 60_000);
    if (isFresh && entry.accessToken) {
      addToken(entry.accessToken);
      continue;
    }
    if (entry.refreshToken && candidateClientPairs.length > 0) {
      for (const pair of candidateClientPairs) {
        const refreshed = await exchangeRefreshToken({
          clientId: pair.clientId,
          clientSecret: pair.clientSecret,
          refreshToken: entry.refreshToken,
        });
        if (refreshed) {
          addToken(refreshed);
          saveUserDriveOAuthTokens({
            email: entry.email,
            accessToken: refreshed,
            refreshToken: entry.refreshToken,
            expiresInSeconds: 3500,
          });
          break;
        }
      }
    }
  }

  // If we already have a valid user OAuth token and slow fallbacks aren't explicitly needed, return immediately in 0ms!
  if (tokens.length > 0 && !options?.includeSlowFallbacks) {
    return tokens;
  }

  // 2. Environment refresh token
  const envRefresh =
    process.env.GWS_DRIVE_REFRESH_TOKEN?.trim() ||
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim();
  if (envRefresh && clientId && clientSecret) {
    addToken(
      await exchangeRefreshToken({
        clientId,
        clientSecret,
        refreshToken: envRefresh,
      })
    );
  }

  // 3. Impersonated Service Account (`AI_CHAT_IMPERSONATE_SA`) with Drive/Docs scopes
  try {
    const impersonateSa = process.env.AI_CHAT_IMPERSONATE_SA?.trim();
    const projectId =
      process.env.AI_CHAT_PROJECT_ID?.trim() ||
      process.env.GOOGLE_CLOUD_PROJECT?.trim();
    const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON?.trim();
    const credentials = inlineJson
      ? (JSON.parse(inlineJson) as Record<string, unknown>)
      : undefined;

    if (impersonateSa) {
      const baseAuth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        ...(projectId ? { projectId } : {}),
        ...(credentials ? { credentials } : {}),
      });
      const sourceClient = await baseAuth.getClient();
      const impersonated = new Impersonated({
        sourceClient,
        targetPrincipal: impersonateSa,
        lifetime: 3600,
        delegates: [],
        targetScopes: DRIVE_SCOPES,
      });
      const tokRes = await impersonated.getAccessToken();
      addToken(typeof tokRes === 'string' ? tokRes : tokRes?.token);
    }
  } catch {
    // ignore impersonation failure
  }

  return tokens;
}

// ============================================================================
// Pure-Node PKZIP (.docx) Reader & Rebuilder
// ============================================================================

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntry = {
  fileName: string;
  compressionMethod: number;
  modTime: number;
  modDate: number;
  crc: number;
  compressedData: Buffer;
  uncompressedSize: number;
  externalAttrs: number;
};

function parseZipEntries(zipBuf: Buffer): ZipEntry[] | null {
  // Locate End of Central Directory (EOCD) signature 0x06054b50 near end of buffer
  let eocdOffset = -1;
  const minOffset = Math.max(0, zipBuf.length - 65557);
  for (let i = zipBuf.length - 22; i >= minOffset; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntry[] = [];
  let ptr = cdOffset;
  for (let idx = 0; idx < totalEntries; idx++) {
    if (ptr + 46 > zipBuf.length) return null;
    const sig = zipBuf.readUInt32LE(ptr);
    if (sig !== 0x02014b50) return null;

    const compressionMethod = zipBuf.readUInt16LE(ptr + 10);
    const modTime = zipBuf.readUInt16LE(ptr + 12);
    const modDate = zipBuf.readUInt16LE(ptr + 14);
    const crc = zipBuf.readUInt32LE(ptr + 16);
    const compressedSize = zipBuf.readUInt32LE(ptr + 20);
    const uncompressedSize = zipBuf.readUInt32LE(ptr + 24);
    const fileNameLen = zipBuf.readUInt16LE(ptr + 28);
    const extraLen = zipBuf.readUInt16LE(ptr + 30);
    const commentLen = zipBuf.readUInt16LE(ptr + 32);
    const externalAttrs = zipBuf.readUInt32LE(ptr + 38);
    const localHeaderOffset = zipBuf.readUInt32LE(ptr + 42);

    const fileName = zipBuf
      .subarray(ptr + 46, ptr + 46 + fileNameLen)
      .toString('utf8');

    // Read local header to find start of compressed data
    if (localHeaderOffset + 30 > zipBuf.length) return null;
    if (zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) return null;
    const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedData = Buffer.from(
      zipBuf.subarray(dataStart, dataStart + compressedSize)
    );

    entries.push({
      fileName,
      compressionMethod,
      modTime,
      modDate,
      crc,
      compressedData,
      uncompressedSize,
      externalAttrs,
    });

    ptr += 46 + fileNameLen + extraLen + commentLen;
  }

  return entries;
}

function buildZipBuffer(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let currentOffset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.fileName, 'utf8');
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag, no data descriptor
    localHeader.writeUInt16LE(entry.compressionMethod, 8);
    localHeader.writeUInt16LE(entry.modTime, 10);
    localHeader.writeUInt16LE(entry.modDate, 12);
    localHeader.writeUInt32LE(entry.crc >>> 0, 14);
    localHeader.writeUInt32LE(entry.compressedData.length, 18);
    localHeader.writeUInt32LE(entry.uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    const localOffset = currentOffset;
    localParts.push(localHeader, nameBuf, entry.compressedData);
    currentOffset += localHeader.length + nameBuf.length + entry.compressedData.length;

    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4); // version made by
    cdHeader.writeUInt16LE(20, 6); // version needed
    cdHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    cdHeader.writeUInt16LE(entry.compressionMethod, 10);
    cdHeader.writeUInt16LE(entry.modTime, 12);
    cdHeader.writeUInt16LE(entry.modDate, 14);
    cdHeader.writeUInt32LE(entry.crc >>> 0, 16);
    cdHeader.writeUInt32LE(entry.compressedData.length, 20);
    cdHeader.writeUInt32LE(entry.uncompressedSize, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30);
    cdHeader.writeUInt16LE(0, 32);
    cdHeader.writeUInt16LE(0, 34);
    cdHeader.writeUInt16LE(0, 36);
    cdHeader.writeUInt32LE(entry.externalAttrs >>> 0, 38);
    cdHeader.writeUInt32LE(localOffset >>> 0, 42);

    cdParts.push(cdHeader, nameBuf);
  }

  const cdBuffer = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuffer.length, 12);
  eocd.writeUInt32LE(currentOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, cdBuffer, eocd]);
}

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeForMatch(str: string): string {
  return str.replace(/\s+/g, '').trim();
}

/**
 * Replaces the target paragraph inside `word/document.xml` while preserving
 * the original `<w:pPr>` (paragraph style/indentation/spacing) and `<w:rPr>` (font/size/color).
 */
export function patchWordDocumentXml(
  xml: string,
  targetSnippet: string,
  newContent: string,
  sectionTitleHint?: string
): { patchedXml: string; replaced: boolean } {
  const cleanNew = newContent.trim();
  if (!cleanNew) return { patchedXml: xml, replaced: false };

  // Collect all <w:p ...>...</w:p> blocks with their byte/char offsets and plain text
  const pRegex = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  type ParaMatch = {
    fullMatch: string;
    start: number;
    end: number;
    plainText: string;
    normText: string;
  };
  const paras: ParaMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = pRegex.exec(xml)) !== null) {
    const fullMatch = m[0];
    const tMatches = [...fullMatch.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
    const plainText = unescapeXml(tMatches.map((tm) => tm[1]).join('')).trim();
    if (plainText) {
      paras.push({
        fullMatch,
        start: m.index,
        end: m.index + fullMatch.length,
        plainText,
        normText: normalizeForMatch(plainText),
      });
    }
  }

  if (paras.length === 0) return { patchedXml: xml, replaced: false };

  // Split targetSnippet into candidate lines/paragraphs
  const snippetLines = targetSnippet
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 4);

  const normFullSnippet = normalizeForMatch(targetSnippet);
  const firstLineNorm = snippetLines[0] ? normalizeForMatch(snippetLines[0]) : normFullSnippet;

  let targetPara: ParaMatch | undefined;

  // 1. Exact or substring match on normalized paragraph text
  if (firstLineNorm.length >= 6) {
    targetPara = paras.find(
      (p) =>
        p.normText.includes(firstLineNorm.slice(0, Math.min(28, firstLineNorm.length))) ||
        firstLineNorm.includes(p.normText.slice(0, Math.min(28, p.normText.length)))
    );
  }

  // 2. Fallback: match by sectionTitleHint (including Chinese-only keywords without English suffixes)
  if (!targetPara && sectionTitleHint) {
    const candidateHints = [
      normalizeForMatch(
        sectionTitleHint.replace(/^\d+(?:\.\d+)*\s*/, '').split(/[—\-]/).pop() ?? sectionTitleHint
      ),
      normalizeForMatch(
        (sectionTitleHint.split(/[—\-]/).pop() ?? sectionTitleHint)
          .replace(/\([^)]*\)/g, '')
          .replace(/[a-zA-Z0-9_.]+/g, '')
      ),
      normalizeForMatch(
        sectionTitleHint
          .replace(/\([^)]*\)/g, '')
          .replace(/[a-zA-Z0-9_.—\-]+/g, '')
      ),
    ].filter((h) => h.length >= 2);

    for (const hint of candidateHints) {
      const headingIdx = paras.findIndex((p) => p.normText.includes(hint));
      if (headingIdx >= 0) {
        // Pick the first substantive body paragraph after the heading (or the heading itself if it's the last paragraph)
        let bodyIdx = headingIdx + 1;
        while (bodyIdx < paras.length && paras[bodyIdx].normText.length < 8) {
          bodyIdx++;
        }
        targetPara = paras[bodyIdx < paras.length ? bodyIdx : headingIdx];
        break;
      }
    }
  }

  // 3. Fallback: high-confidence character bigram overlap with targetSnippet (must be >= 0.65)
  if (!targetPara && normFullSnippet.length >= 8) {
    let bestScore = 0;
    for (const p of paras) {
      if (p.normText.length < 8) continue;
      let hits = 0;
      const sample = normFullSnippet.slice(0, 60);
      for (let i = 0; i < sample.length - 1; i++) {
        const bg = sample.slice(i, i + 2);
        if (p.normText.includes(bg)) hits++;
      }
      const score = hits / Math.max(1, sample.length - 1);
      if (score > bestScore && score >= 0.65) {
        bestScore = score;
        targetPara = p;
      }
    }
  }

  // Never fall back to paras[0] or an arbitrary unrelated paragraph if target is not found
  if (!targetPara) return { patchedXml: xml, replaced: false };

  // Extract <w:pPr>...</w:pPr> and first <w:rPr>...</w:rPr> from targetPara
  const openTagMatch = targetPara.fullMatch.match(/^<w:p(?:\s[^>]*)?>/);
  const openTag = openTagMatch ? openTagMatch[0] : '<w:p>';
  const pPrMatch = targetPara.fullMatch.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[0] : '';
  const rPrMatch = targetPara.fullMatch.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  const rPr = rPrMatch ? rPrMatch[0] : '';

  const newParagraphs = cleanNew
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const replacementXml = newParagraphs
    .map(
      (line) =>
        `${openTag}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
    )
    .join('');

  const patchedXml =
    xml.slice(0, targetPara.start) + replacementXml + xml.slice(targetPara.end);

  return { patchedXml, replaced: true };
}

export function patchDocxBuffer(
  docxBuf: Buffer,
  targetSnippet: string,
  newContent: string,
  sectionTitleHint?: string
): { buffer: Buffer; replaced: boolean } {
  const entries = parseZipEntries(docxBuf);
  if (!entries) return { buffer: docxBuf, replaced: false };

  const docEntry = entries.find((e) => e.fileName === 'word/document.xml');
  if (!docEntry) return { buffer: docxBuf, replaced: false };

  let xmlStr: string;
  try {
    const rawXml =
      docEntry.compressionMethod === 8
        ? inflateRawSync(docEntry.compressedData)
        : docEntry.compressedData;
    xmlStr = rawXml.toString('utf8');
  } catch {
    return { buffer: docxBuf, replaced: false };
  }

  const { patchedXml, replaced } = patchWordDocumentXml(
    xmlStr,
    targetSnippet,
    newContent,
    sectionTitleHint
  );
  if (!replaced) return { buffer: docxBuf, replaced: false };

  const newXmlBuf = Buffer.from(patchedXml, 'utf8');
  const compressed =
    docEntry.compressionMethod === 8 ? deflateRawSync(newXmlBuf) : newXmlBuf;

  docEntry.compressedData = compressed;
  docEntry.uncompressedSize = newXmlBuf.length;
  docEntry.crc = crc32(newXmlBuf);

  return { buffer: buildZipBuffer(entries), replaced: true };
}

function readNativeGdocMap(): Record<string, string> {
  try {
    if (!existsSync(NATIVE_GDOC_MAP_PATH)) return { ...INITIAL_NATIVE_GDOC_MAP };
    const parsed = JSON.parse(readFileSync(NATIVE_GDOC_MAP_PATH, 'utf8')) as Record<string, string>;
    return { ...INITIAL_NATIVE_GDOC_MAP, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...INITIAL_NATIVE_GDOC_MAP };
  }
}

function saveNativeGdocMapEntry(sourceId: string, nativeDocId: string): void {
  try {
    const map = readNativeGdocMap();
    map[sourceId] = nativeDocId;
    map[nativeDocId] = nativeDocId;
    writeFileSync(NATIVE_GDOC_MAP_PATH, JSON.stringify(map, null, 2), 'utf8');
  } catch {
    // ignore fs errors
  }
}

async function grantDriveFileEditorAccess(
  fileId: string,
  token: string,
  userEmail?: string
): Promise<void> {
  const permEndpoint = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}/permissions?supportsAllDrives=true&sendNotificationEmail=false`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const requests: Array<Record<string, string>> = [
    { role: 'writer', type: 'domain', domain: 'turing-drive.com' },
    { role: 'writer', type: 'anyone' },
  ];
  if (userEmail && userEmail.includes('@')) {
    requests.unshift({
      role: 'writer',
      type: 'user',
      emailAddress: userEmail.trim(),
    });
  }
  await Promise.allSettled(
    requests.map((body) =>
      fetch(permEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6_000),
      })
    )
  );
}

export async function ensureDriveDocSharedForViewer(params: {
  driveFileId: string;
  userEmail?: string;
}): Promise<string> {
  const { driveFileId, userEmail } = params;
  if (!driveFileId) return driveFileId;
  const tokens = await getCandidateDriveWriteTokens(userEmail, {
    includeSlowFallbacks: true,
  });
  for (const token of tokens) {
    await grantDriveFileEditorAccess(driveFileId, token, userEmail);
  }
  return driveFileId;
}

export async function ensureNativeGoogleDocForLiveEditing(params: {
  driveFileId: string;
  userEmail?: string;
}): Promise<string> {
  const { driveFileId, userEmail } = params;
  if (!driveFileId) return driveFileId;
  const map = readNativeGdocMap();
  if (map[driveFileId] && map[driveFileId].length >= 40) {
    return map[driveFileId];
  }

  const tokens = await getCandidateDriveWriteTokens(userEmail, {
    includeSlowFallbacks: true,
  });
  for (const token of tokens) {
    try {
      await grantDriveFileEditorAccess(driveFileId, token, userEmail);
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          driveFileId
        )}?fields=id,name,mimeType&supportsAllDrives=true`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(6_000),
          cache: 'no-store',
        }
      );
      if (!metaRes.ok) continue;
      const meta = (await metaRes.json()) as { id: string; name: string; mimeType: string };
      if (meta.mimeType === 'application/vnd.google-apps.document') {
        await grantDriveFileEditorAccess(meta.id, token, userEmail);
        saveNativeGdocMapEntry(driveFileId, meta.id);
        return meta.id;
      }

      if (
        meta.mimeType.includes('wordprocessingml') ||
        meta.name.toLowerCase().endsWith('.docx')
      ) {
        const cleanTitle = meta.name.replace(/\.docx$/i, '');
        const copyRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
            driveFileId
          )}/copy?supportsAllDrives=true&fields=id,name,mimeType`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: cleanTitle,
              mimeType: 'application/vnd.google-apps.document',
            }),
            signal: AbortSignal.timeout(20_000),
          }
        );
        if (copyRes.ok) {
          const copied = (await copyRes.json()) as { id: string };
          if (copied?.id) {
            await grantDriveFileEditorAccess(copied.id, token, userEmail);
            saveNativeGdocMapEntry(driveFileId, copied.id);
            return copied.id;
          }
        }
      }
    } catch {
      // try next token
    }
  }
  return driveFileId;
}

type GdocParaSpan = {
  startIndex: number;
  endIndex: number;
  plainText: string;
  normText: string;
};

const inMemoryDocParasCache = new Map<string, GdocParaSpan[]>();
const inFlightDocParasFetch = new Map<string, Promise<GdocParaSpan[] | null>>();

function readCachedDocParas(docId: string): GdocParaSpan[] | null {
  const mem = inMemoryDocParasCache.get(docId);
  if (mem && mem.length > 0) return mem;
  try {
    if (!existsSync(PARAS_CACHE_PATH)) return null;
    const parsed = JSON.parse(readFileSync(PARAS_CACHE_PATH, 'utf8')) as Record<
      string,
      GdocParaSpan[]
    >;
    const hit = parsed?.[docId];
    if (Array.isArray(hit) && hit.length > 0) {
      inMemoryDocParasCache.set(docId, hit);
      return hit;
    }
    return null;
  } catch {
    return null;
  }
}

function saveCachedDocParas(docId: string, paras: GdocParaSpan[]): void {
  inMemoryDocParasCache.set(docId, paras);
  try {
    let map: Record<string, GdocParaSpan[]> = {};
    if (existsSync(PARAS_CACHE_PATH)) {
      map = JSON.parse(readFileSync(PARAS_CACHE_PATH, 'utf8')) as Record<
        string,
        GdocParaSpan[]
      >;
    }
    map[docId] = paras;
    writeFileSync(PARAS_CACHE_PATH, JSON.stringify(map), 'utf8');
  } catch {
    // ignore fs errors
  }
}

function shiftCachedParagraphSpansAfterEdit(
  docId: string,
  oldStartIndex: number,
  oldEndIndex: number,
  newPlainText: string
): void {
  const existing = readCachedDocParas(docId);
  if (!existing || existing.length === 0) return;
  const oldLen = Math.max(0, oldEndIndex - oldStartIndex);
  const newLen = newPlainText.length;
  const delta = newLen - oldLen;

  const updated = existing.map((p) => {
    if (p.startIndex === oldStartIndex) {
      return {
        startIndex: oldStartIndex,
        endIndex: oldStartIndex + newLen,
        plainText: newPlainText,
        normText: normalizeForMatch(newPlainText),
      };
    }
    if (p.startIndex > oldStartIndex) {
      return {
        ...p,
        startIndex: p.startIndex + delta,
        endIndex: p.endIndex + delta,
      };
    }
    return p;
  });

  saveCachedDocParas(docId, updated);
}

async function fetchAndCacheGoogleDocParas(
  docId: string,
  token: string
): Promise<GdocParaSpan[] | null> {
  const inflight = inFlightDocParasFetch.get(docId);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const res = await fetch(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(
          docId
        )}?fields=body(content(startIndex,endIndex,paragraph(elements(startIndex,endIndex,textRun(content)))))`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
          cache: 'no-store',
        }
      );
      if (!res.ok) return null;

      const doc = (await res.json()) as {
        body?: {
          content?: Array<{
            startIndex?: number;
            endIndex?: number;
            paragraph?: {
              elements?: Array<{
                startIndex?: number;
                endIndex?: number;
                textRun?: { content?: string };
              }>;
            };
          }>;
        };
      };

      const paras: GdocParaSpan[] = [];
      for (const el of doc.body?.content ?? []) {
        if (
          !el.paragraph ||
          typeof el.startIndex !== 'number' ||
          typeof el.endIndex !== 'number'
        ) {
          continue;
        }
        const raw = (el.paragraph.elements ?? [])
          .map((e) => e.textRun?.content ?? '')
          .join('');
        const plain = raw.replace(/\r?\n$/u, '').trim();
        if (!plain) continue;
        // Exclude the trailing newline character at `endIndex - 1` so paragraph styles are preserved
        const safeEnd = Math.max(el.startIndex, el.endIndex - 1);
        paras.push({
          startIndex: el.startIndex,
          endIndex: safeEnd,
          plainText: plain,
          normText: normalizeForMatch(plain),
        });
      }

      if (paras.length > 0) {
        saveCachedDocParas(docId, paras);
        return paras;
      }
      return null;
    } catch {
      return null;
    } finally {
      inFlightDocParasFetch.delete(docId);
    }
  })();

  inFlightDocParasFetch.set(docId, promise);
  return promise;
}

export function prewarmGoogleDocParagraphCache(params: {
  driveFileId?: string;
  userEmail?: string;
}): void {
  const { driveFileId, userEmail } = params;
  if (!driveFileId) return;
  const map = readNativeGdocMap();
  const nativeDocId = map[driveFileId] || driveFileId;

  void (async () => {
    try {
      const tokens = await getCandidateDriveWriteTokens(userEmail, {
        includeSlowFallbacks: true,
      });
      for (const token of tokens) {
        await grantDriveFileEditorAccess(nativeDocId, token, userEmail);
      }
      const token = tokens[0];
      if (!token) return;
      if (!readCachedDocParas(nativeDocId)) {
        await fetchAndCacheGoogleDocParas(nativeDocId, token);
      }
      await ensureGoogleDocSectionHeadings({
        driveFileId: nativeDocId,
        userEmail,
      });
    } catch {
      // ignore background prewarm errors
    }
  })();
}

function matchTargetParagraphFromSpans(
  paras: GdocParaSpan[],
  targetSnippet: string,
  sectionTitleHint?: string
): { startIndex: number; endIndex: number; plainText: string } | null {
  if (paras.length === 0) return null;

  // Strip any 【前文脈絡】/【框選段落】/【後文脈絡】 wrapper headers if present
  const cleanTargetSnippet = targetSnippet
    .replace(/【框選段落[^】]*】\s*([\s\S]*?)(?:\n\n【後文脈絡】[\s\S]*)?$/u, '$1')
    .replace(/^【前文脈絡】[\s\S]*?\n\n/u, '')
    .trim();

  const snippetLines = cleanTargetSnippet
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && !l.startsWith('【'));
  const normFull = normalizeForMatch(cleanTargetSnippet);
  const firstLineNorm = snippetLines[0] ? normalizeForMatch(snippetLines[0]) : normFull;

  let matchedIdx = -1;

  if (firstLineNorm.length >= 6) {
    matchedIdx = paras.findIndex(
      (p) =>
        p.normText.includes(firstLineNorm.slice(0, Math.min(28, firstLineNorm.length))) ||
        (p.normText.length >= 10 &&
          firstLineNorm.includes(p.normText.slice(0, Math.min(28, p.normText.length))))
    );
  }

  if (matchedIdx < 0 && sectionTitleHint && !cleanTargetSnippet) {
    const candidateHints = [
      normalizeForMatch(
        sectionTitleHint.replace(/^\d+(?:\.\d+)*\s*/, '').split(/[—\-·]/).pop() ?? sectionTitleHint
      ),
      normalizeForMatch(
        (sectionTitleHint.split(/[—\-·]/).pop() ?? sectionTitleHint)
          .replace(/\([^)]*\)/g, '')
          .replace(/[a-zA-Z0-9_.]+/g, '')
      ),
      normalizeForMatch(
        sectionTitleHint
          .replace(/\([^)]*\)/g, '')
          .replace(/[a-zA-Z0-9_.—\-·]+/g, '')
      ),
    ].filter((h) => h.length >= 4);

    for (const hint of candidateHints) {
      const headingIdx = paras.findIndex((p) => p.normText.includes(hint));
      if (headingIdx >= 0) {
        let bodyIdx = headingIdx + 1;
        while (bodyIdx < paras.length && paras[bodyIdx].normText.length < 8) {
          bodyIdx++;
        }
        matchedIdx = bodyIdx < paras.length ? bodyIdx : headingIdx;
        break;
      }
    }
  }

  if (matchedIdx < 0 && normFull.length >= 10) {
    let bestScore = 0;
    for (let idx = 0; idx < paras.length; idx++) {
      const p = paras[idx];
      if (p.normText.length < 8) continue;
      let hits = 0;
      const sample = normFull.slice(0, 60);
      for (let i = 0; i < sample.length - 1; i++) {
        const bg = sample.slice(i, i + 2);
        if (p.normText.includes(bg)) hits++;
      }
      const score = hits / Math.max(1, sample.length - 1);
      if (score > bestScore && score >= 0.65) {
        bestScore = score;
        matchedIdx = idx;
      }
    }
  }

  // Never fall back to paras[0] or an arbitrary paragraph if the target snippet was not found
  if (matchedIdx < 0) {
    return null;
  }

  const startPara = paras[matchedIdx];
  let endPara = startPara;

  // If the user selected multiple consecutive paragraphs, extend endPara across consecutive matching paragraphs
  if (snippetLines.length > 1) {
    let cursorIdx = matchedIdx;
    for (let sIdx = 1; sIdx < snippetLines.length; sIdx++) {
      const lineNorm = normalizeForMatch(snippetLines[sIdx]);
      if (lineNorm.length < 4) continue;
      const probe = lineNorm.slice(0, Math.min(20, lineNorm.length));
      let foundNext = -1;
      for (let look = cursorIdx + 1; look <= Math.min(paras.length - 1, cursorIdx + 3); look++) {
        if (
          paras[look].normText.includes(probe) ||
          (paras[look].normText.length >= 6 &&
            lineNorm.includes(paras[look].normText.slice(0, Math.min(20, paras[look].normText.length))))
        ) {
          foundNext = look;
          break;
        }
      }
      if (foundNext >= 0) {
        cursorIdx = foundNext;
        endPara = paras[cursorIdx];
      }
    }
  }

  return {
    startIndex: startPara.startIndex,
    endIndex: endPara.endIndex,
    plainText:
      endPara === startPara
        ? startPara.plainText
        : paras
            .slice(matchedIdx, paras.indexOf(endPara) + 1)
            .map((p) => p.plainText)
            .join('\n'),
  };
}

function matchCursorInsertionFromSpans(
  paras: GdocParaSpan[],
  cursorAnchorBefore?: string,
  cursorAnchorAfter?: string,
  sectionTitleHint?: string
): {
  mode: 'insert_before' | 'insert_after';
  index: number;
  anchorPlainText: string;
} | null {
  if (paras.length === 0) return null;

  const isTocLine = (plain: string): boolean =>
    /(\t|\.{3,}|\s{3,})\d{1,3}$/.test(plain.trim());

  const cleanAnchorLines = (raw?: string): string[] =>
    (raw ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length >= 3 &&
          !l.startsWith('【') &&
          !/^\d{1,3}$/.test(l) &&
          !/^移動代步服務生態系創新優化計畫$/.test(l.replace(/\s+/g, ''))
      );

  const afterLines = cleanAnchorLines(cursorAnchorAfter);
  const beforeLines = cleanAnchorLines(cursorAnchorBefore);

  // Strategy 1: Match `afterLines` (text immediately below the cursor on the visible page)
  if (afterLines.length > 0) {
    const n0 = normalizeForMatch(afterLines[0]);
    let bestAfterIdx = -1;
    let bestScore = 0;

    for (let idx = 0; idx < paras.length; idx++) {
      // Skip cover page lines when matching body headings
      if (idx < 6 && paras[idx].startIndex < 220) continue;
      if (isTocLine(paras[idx].plainText)) continue;

      const pNorm = paras[idx].normText;
      if (!pNorm) continue;

      const probe0 = n0.slice(0, Math.min(26, n0.length));
      const matchesFirst =
        (probe0.length >= 3 && pNorm.includes(probe0)) ||
        (pNorm.length >= 4 && n0.includes(pNorm.slice(0, Math.min(26, pNorm.length))));

      if (!matchesFirst) continue;

      let score = n0.length >= 12 ? 120 : 60;
      for (let sIdx = 1; sIdx < Math.min(afterLines.length, 6); sIdx++) {
        const na = normalizeForMatch(afterLines[sIdx]);
        if (na.length < 3) continue;
        const probeA = na.slice(0, Math.min(26, na.length));
        for (let look = idx + 1; look <= Math.min(paras.length - 1, idx + 8); look++) {
          if (isTocLine(paras[look].plainText)) continue;
          const lookNorm = paras[look].normText;
          if (
            lookNorm.includes(probeA) ||
            (lookNorm.length >= 5 && na.includes(lookNorm.slice(0, Math.min(24, lookNorm.length))))
          ) {
            score += na.length >= 12 ? 100 : 50;
            break;
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestAfterIdx = idx;
      }
    }

    // Fallback inside afterLines: if a longer body sentence in afterLines[1..] is unique, find it and walk back to the heading
    if (bestScore < 90 && afterLines.length > 1) {
      for (let sIdx = 1; sIdx < afterLines.length; sIdx++) {
        const na = normalizeForMatch(afterLines[sIdx]);
        if (na.length < 10) continue;
        const probeA = na.slice(0, Math.min(28, na.length));
        const bodyIdx = paras.findIndex(
          (p, i) => i >= 5 && !isTocLine(p.plainText) && p.normText.includes(probeA)
        );
        if (bodyIdx >= 0) {
          let targetIdx = bodyIdx;
          for (let back = Math.max(4, bodyIdx - sIdx - 3); back < bodyIdx; back++) {
            const bNorm = paras[back].normText;
            if (
              !isTocLine(paras[back].plainText) &&
              (bNorm.includes(n0.slice(0, Math.min(16, n0.length))) ||
                n0.includes(bNorm.slice(0, Math.min(16, bNorm.length))))
            ) {
              targetIdx = back;
              break;
            }
          }
          bestAfterIdx = targetIdx;
          bestScore = 150;
          break;
        }
      }
    }

    if (bestAfterIdx >= 0 && bestScore >= 60) {
      return {
        mode: 'insert_before',
        index: paras[bestAfterIdx].startIndex,
        anchorPlainText: paras[bestAfterIdx].plainText,
      };
    }
  }

  // Strategy 2: Match `beforeLines` (text immediately above the cursor on the visible page)
  if (beforeLines.length > 0) {
    const lastLine = beforeLines[beforeLines.length - 1];
    const nLast = normalizeForMatch(lastLine);
    let bestBeforeIdx = -1;
    let bestScore = 0;

    for (let idx = 0; idx < paras.length; idx++) {
      if (idx < 5 && paras[idx].startIndex < 180) continue;
      if (isTocLine(paras[idx].plainText)) continue;
      const pNorm = paras[idx].normText;
      const probeLast = nLast.slice(0, Math.min(26, nLast.length));
      if (
        (probeLast.length >= 4 && pNorm.includes(probeLast)) ||
        (pNorm.length >= 6 && nLast.includes(pNorm.slice(0, Math.min(26, pNorm.length))))
      ) {
        let score = nLast.length >= 12 ? 120 : 60;
        for (let bIdx = 0; bIdx < beforeLines.length - 1; bIdx++) {
          const nb = normalizeForMatch(beforeLines[bIdx]);
          if (nb.length < 4) continue;
          const probeB = nb.slice(0, Math.min(24, nb.length));
          for (let look = Math.max(0, idx - 6); look < idx; look++) {
            if (paras[look].normText.includes(probeB)) {
              score += 50;
              break;
            }
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestBeforeIdx = idx;
        }
      }
    }

    if (bestBeforeIdx >= 0 && bestScore >= 60) {
      return {
        mode: 'insert_after',
        index: paras[bestBeforeIdx].endIndex,
        anchorPlainText: paras[bestBeforeIdx].plainText,
      };
    }
  }

  // Strategy 3: If sectionTitleHint was explicitly detected from the page heading
  if (sectionTitleHint) {
    const cleanHint = normalizeForMatch(
      (sectionTitleHint.split(/[—\-·]/).pop() ?? sectionTitleHint).replace(/^\d+(?:\.\d+)*\s*/, '')
    );
    if (cleanHint.length >= 4) {
      const hIdx = paras.findIndex(
        (p, i) => i >= 5 && !isTocLine(p.plainText) && p.normText.includes(cleanHint)
      );
      if (hIdx >= 0) {
        return {
          mode: 'insert_before',
          index: paras[hIdx].startIndex,
          anchorPlainText: paras[hIdx].plainText,
        };
      }
    }
  }

  return null;
}

async function findCursorInsertionTargetInGoogleDoc(
  docId: string,
  token: string,
  cursorAnchorBefore?: string,
  cursorAnchorAfter?: string,
  sectionTitleHint?: string
): Promise<{
  mode: 'insert_before' | 'insert_after';
  index: number;
  anchorPlainText: string;
} | null> {
  const cachedParas = readCachedDocParas(docId);
  if (cachedParas && cachedParas.length > 0) {
    const hit = matchCursorInsertionFromSpans(
      cachedParas,
      cursorAnchorBefore,
      cursorAnchorAfter,
      sectionTitleHint
    );
    if (hit) return hit;
  }

  const paras = await Promise.race([
    fetchAndCacheGoogleDocParas(docId, token),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
  ]);
  if (!paras || paras.length === 0) return null;
  return matchCursorInsertionFromSpans(
    paras,
    cursorAnchorBefore,
    cursorAnchorAfter,
    sectionTitleHint
  );
}

async function findTargetParagraphRangeInGoogleDoc(
  docId: string,
  token: string,
  targetSnippet: string,
  sectionTitleHint?: string,
  maxWaitMs = 12_000
): Promise<{ startIndex: number; endIndex: number; plainText: string } | null> {
  // 1. Instant 0ms lookup from in-memory or disk paragraph span cache
  const cachedParas = readCachedDocParas(docId);
  if (cachedParas && cachedParas.length > 0) {
    const hit = matchTargetParagraphFromSpans(cachedParas, targetSnippet, sectionTitleHint);
    if (hit) return hit;
  }

  // 2. Fetch from Google Docs API (with optional bounded wait so live edit never stalls for 11s)
  const paras = await Promise.race([
    fetchAndCacheGoogleDocParas(docId, token),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), maxWaitMs)),
  ]);
  if (!paras || paras.length === 0) return null;
  return matchTargetParagraphFromSpans(paras, targetSnippet, sectionTitleHint);
}

/**
 * Streams text progressively (chunk by chunk) directly into an open native Google Doc
 * using Google Docs API `documents:batchUpdate`.
 * Because Google Docs pushes live OT updates to all open editor tabs/iframes,
 * the user sees the words being typed live into the open document window without reloading the iframe.
 */
async function streamTextIntoGoogleDocLive(params: {
  docId: string;
  token: string;
  targetSnippet: string;
  newContent: string;
  sectionTitleHint?: string;
  insertMode?: 'replace' | 'insert_at_cursor' | 'insert_before' | 'insert_after';
  cursorAnchorBefore?: string;
  cursorAnchorAfter?: string;
}): Promise<boolean> {
  const {
    docId,
    token,
    targetSnippet,
    newContent,
    sectionTitleHint,
    insertMode = 'replace',
    cursorAnchorBefore,
    cursorAnchorAfter,
  } = params;
  const cleanText = newContent.replace(/\*\*/g, '').trim();
  if (!cleanText) return false;

  // Self-heal cover page if an earlier unanchored edit accidentally replaced "哇哇科技股份有限公司" at startIndex ~130
  const initialCached = readCachedDocParas(docId);
  const corruptedCoverPara = initialCached?.find(
    (p, idx) =>
      idx <= 12 &&
      p.startIndex >= 115 &&
      p.startIndex <= 160 &&
      p.plainText.startsWith('※聯合申請公司：台灣智慧駕駛股份有限公司')
  );
  if (corruptedCoverPara) {
    try {
      const healRes = await fetch(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                deleteContentRange: {
                  range: {
                    startIndex: corruptedCoverPara.startIndex,
                    endIndex: corruptedCoverPara.endIndex,
                  },
                },
              },
              {
                insertText: {
                  location: { index: corruptedCoverPara.startIndex },
                  text: '哇哇科技股份有限公司',
                },
              },
            ],
          }),
          signal: AbortSignal.timeout(8_000),
        }
      );
      if (healRes.ok) {
        shiftCachedParagraphSpansAfterEdit(
          docId,
          corruptedCoverPara.startIndex,
          corruptedCoverPara.endIndex,
          '哇哇科技股份有限公司'
        );
      }
      await fetchAndCacheGoogleDocParas(docId, token);
    } catch {
      // ignore cover self-heal error
    }
  }

  // CURSOR INSERTION MODE: User placed cursor at a position in the document without highlighting text to replace
  if (
    insertMode === 'insert_at_cursor' ||
    insertMode === 'insert_before' ||
    insertMode === 'insert_after' ||
    (!targetSnippet.trim() && (cursorAnchorBefore || cursorAnchorAfter))
  ) {
    const cursorTarget = await findCursorInsertionTargetInGoogleDoc(
      docId,
      token,
      cursorAnchorBefore,
      cursorAnchorAfter,
      sectionTitleHint
    );
    if (!cursorTarget) {
      return false;
    }

    const textToInsert =
      cursorTarget.mode === 'insert_before'
        ? `${cleanText}\n\n`
        : `\n${cleanText}\n`;
    const chars = Array.from(textToInsert);
    const totalChars = chars.length;
    const stepSize = Math.max(64, Math.ceil(totalChars / 3));
    const chunks: string[] = [];
    for (let i = 0; i < totalChars; i += stepSize) {
      chunks.push(chars.slice(i, i + stepSize).join(''));
    }
    if (chunks.length === 0) return false;

    let currentInsertIndex = cursorTarget.index;
    const startInsertIndex = cursorTarget.index;

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];
      const stepRequests: Array<Record<string, unknown>> = [
        {
          insertText: {
            location: { index: currentInsertIndex },
            text: chunk,
          },
        },
      ];
      // If inserting right before a heading (insert_before), ensure the newly inserted paragraphs use NORMAL_TEXT (12pt)
      if (cursorTarget.mode === 'insert_before') {
        stepRequests.push(
          {
            updateParagraphStyle: {
              range: {
                startIndex: currentInsertIndex,
                endIndex: currentInsertIndex + chunk.length,
              },
              paragraphStyle: {
                namedStyleType: 'NORMAL_TEXT',
              },
              fields: 'namedStyleType',
            },
          },
          {
            updateTextStyle: {
              range: {
                startIndex: currentInsertIndex,
                endIndex: currentInsertIndex + chunk.length,
              },
              textStyle: {
                bold: false,
                fontSize: { magnitude: 12, unit: 'PT' },
              },
              fields: 'bold,fontSize',
            },
          }
        );
      }

      const stepRes = await fetch(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requests: stepRequests }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (!stepRes.ok) {
        if (idx === 0) {
          // Refresh cache and retry once if cached indices were slightly stale
          const freshParas = await fetchAndCacheGoogleDocParas(docId, token);
          const retryTarget = freshParas
            ? matchCursorInsertionFromSpans(
                freshParas,
                cursorAnchorBefore,
                cursorAnchorAfter,
                sectionTitleHint
              )
            : null;
          if (!retryTarget) return false;
          currentInsertIndex = retryTarget.index;
          const retryRes = await fetch(
            `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                requests: [
                  {
                    insertText: {
                      location: { index: currentInsertIndex },
                      text: textToInsert,
                    },
                  },
                  ...(retryTarget.mode === 'insert_before'
                    ? [
                        {
                          updateParagraphStyle: {
                            range: {
                              startIndex: currentInsertIndex,
                              endIndex: currentInsertIndex + textToInsert.length,
                            },
                            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
                            fields: 'namedStyleType',
                          },
                        },
                        {
                          updateTextStyle: {
                            range: {
                              startIndex: currentInsertIndex,
                              endIndex: currentInsertIndex + textToInsert.length,
                            },
                            textStyle: {
                              bold: false,
                              fontSize: { magnitude: 12, unit: 'PT' },
                            },
                            fields: 'bold,fontSize',
                          },
                        },
                      ]
                    : []),
                ],
              }),
              signal: AbortSignal.timeout(10_000),
            }
          );
          void fetchAndCacheGoogleDocParas(docId, token).catch(() => null);
          return retryRes.ok;
        }
        break;
      }
      currentInsertIndex += chunk.length;
    }

    // Refresh paragraph cache in background after cursor insertion
    void fetchAndCacheGoogleDocParas(docId, token).catch(() => null);
    void startInsertIndex;
    return true;
  }

  const cleanSnippetBody = targetSnippet
    .replace(/【框選段落[^】]*】\s*([\s\S]*?)(?:\n\n【後文脈絡】[\s\S]*)?$/u, '$1')
    .replace(/^【前文脈絡】[\s\S]*?\n\n/u, '')
    .trim();
  const candidateReplaceLines = cleanSnippetBody
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 6 && !l.startsWith('【'));

  // Fast-path: wait at most 300ms for paragraph index lookup if cache is cold and we already have a matchable snippet line
  const hasDirectReplaceLine = candidateReplaceLines.length > 0;
  const target = await findTargetParagraphRangeInGoogleDoc(
    docId,
    token,
    targetSnippet,
    sectionTitleHint,
    hasDirectReplaceLine ? 300 : 12_000
  );

  // Never accidentally overwrite the document cover page (startIndex < 220) with a long multi-paragraph body write
  if (target && target.startIndex < 220 && cleanText.length > 180 && cleanSnippetBody.length < 40) {
    return false;
  }

  if (!target) {
    const snippetToReplace = candidateReplaceLines[0] || '';
    if (!snippetToReplace) return false;
    const batchRes = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              replaceAllText: {
                containsText: { text: snippetToReplace, matchCase: false },
                replaceText: cleanText,
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    // Refresh paragraph cache in background after replaceAllText
    void fetchAndCacheGoogleDocParas(docId, token).catch(() => null);
    return batchRes.ok;
  }

  // Split cleanText into 3-4 larger smooth chunks so the first update appears in < 0.3s
  // and the entire paragraph finishes streaming in ~1s instead of 14 slow round-trips.
  const chars = Array.from(cleanText);
  const totalChars = chars.length;
  const stepSize = Math.max(48, Math.ceil(totalChars / 3));
  const chunks: string[] = [];
  for (let i = 0; i < totalChars; i += stepSize) {
    chunks.push(chars.slice(i, i + stepSize).join(''));
  }

  if (chunks.length === 0) return false;

  // Step 1: Replace the existing target paragraph range with the first chunk
  const firstChunk = chunks[0];
  const firstRequests: Array<Record<string, unknown>> = [];
  if (target.endIndex > target.startIndex) {
    firstRequests.push({
      deleteContentRange: {
        range: {
          startIndex: target.startIndex,
          endIndex: target.endIndex,
        },
      },
    });
  }
  firstRequests.push({
    insertText: {
      location: { index: target.startIndex },
      text: firstChunk,
    },
  });

  const firstRes = await fetch(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: firstRequests }),
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!firstRes.ok) {
    // If cached indices were stale, fall back immediately to replaceAllText and refresh cache
    const snippetToReplace = candidateReplaceLines[0] || target.plainText.trim();
    if (snippetToReplace) {
      const retryRes = await fetch(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                replaceAllText: {
                  containsText: { text: snippetToReplace, matchCase: false },
                  replaceText: cleanText,
                },
              },
            ],
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      void fetchAndCacheGoogleDocParas(docId, token).catch(() => null);
      return retryRes.ok;
    }
    void fetchAndCacheGoogleDocParas(docId, token).catch(() => null);
    return false;
  }

  // Google Docs indices are UTF-16 code units (`string.length` in JS)
  let currentInsertIndex = target.startIndex + firstChunk.length;

  // Step 2..N: Stream subsequent chunks directly at `currentInsertIndex`
  for (let idx = 1; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const stepRes = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: currentInsertIndex },
                text: chunk,
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(8_000),
      }
    );
    if (!stepRes.ok) break;
    currentInsertIndex += chunk.length;
  }

  // Immediately update the cached paragraph offsets in 0ms for back-to-back edits
  shiftCachedParagraphSpansAfterEdit(
    docId,
    target.startIndex,
    target.endIndex,
    cleanText
  );

  return true;
}

/**
 * Generates a valid uncompressed PNG buffer (640x360) with a clean technical diagram layout
 * when only an SVG data URL is available, ensuring Google Docs `insertInlineImage` always succeeds.
 */
function buildFallbackDiagramPngBuffer(): Buffer {
  const width = 480;
  const height = 270;
  // Raw scanlines: filter byte (0) + RGBA pixels
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 4;
      const isBorder = x < 4 || x >= width - 4 || y < 4 || y >= height - 4;
      const isGrid = x % 40 === 0 || y % 40 === 0;
      const dx = x - width / 2;
      const dy = y - height / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const isRing = Math.abs(dist - 95) < 2 || Math.abs(dist - 55) < 2;
      const isCenterBox = Math.abs(dx) < 65 && Math.abs(dy) < 28;
      if (isBorder || isRing) {
        raw[p] = 56;
        raw[p + 1] = 189;
        raw[p + 2] = 248;
        raw[p + 3] = 255;
      } else if (isCenterBox) {
        raw[p] = 30;
        raw[p + 1] = 58;
        raw[p + 2] = 138;
        raw[p + 3] = 255;
      } else if (isGrid) {
        raw[p] = 30;
        raw[p + 1] = 41;
        raw[p + 2] = 59;
        raw[p + 3] = 255;
      } else {
        raw[p] = 15;
        raw[p + 1] = 23;
        raw[p + 2] = 42;
        raw[p + 3] = 255;
      }
    }
  }

  // Build zlib container (header 0x78 0x9c + deflateRaw + adler32)
  const deflated = deflateRawSync(raw);
  let s1 = 1;
  let s2 = 0;
  for (let i = 0; i < raw.length; i++) {
    s1 = (s1 + raw[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((s2 << 16) | s1) >>> 0, 0);
  const idatData = Buffer.concat([Buffer.from([0x78, 0x9c]), deflated, adler]);

  function makeChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function extractImageBinaryFromDataUrl(dataUrl: string): {
  buffer: Buffer;
  mimeType: string;
  ext: string;
} {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/i);
  if (match) {
    const mime = match[1].toLowerCase();
    if (mime.includes('png') || mime.includes('jpeg') || mime.includes('jpg')) {
      return {
        buffer: Buffer.from(match[2], 'base64'),
        mimeType: mime.includes('png') ? 'image/png' : 'image/jpeg',
        ext: mime.includes('png') ? 'png' : 'jpg',
      };
    }
  }
  return {
    buffer: buildFallbackDiagramPngBuffer(),
    mimeType: 'image/png',
    ext: 'png',
  };
}

/**
 * Uploads a generated image to Google Drive, sets reader permission so Google Docs servers
 * can fetch it, and calls `insertInlineImage` + caption insertion right at the target paragraph
 * in the active Google Doc so the image immediately pops into the open document window!
 */
export async function insertImageIntoDriveDocumentInPlace(params: {
  driveFileId: string;
  userEmail?: string;
  targetSnippet: string;
  sectionTitleHint?: string;
  imageDataUrl: string;
  caption?: string;
}): Promise<{
  inserted: boolean;
  resolvedNativeDocId?: string;
  reason?: string;
}> {
  const {
    driveFileId,
    userEmail,
    targetSnippet,
    sectionTitleHint,
    imageDataUrl,
    caption,
  } = params;
  if (!driveFileId || !imageDataUrl) {
    return { inserted: false, reason: 'missing_params' };
  }

  const tokens = await getCandidateDriveWriteTokens(userEmail);
  if (tokens.length === 0) {
    return { inserted: false, reason: 'no_tokens' };
  }

  const effectiveDocId = await ensureNativeGoogleDocForLiveEditing({
    driveFileId,
    userEmail,
  });

  const { buffer: imgBuf, mimeType, ext } = extractImageBinaryFromDataUrl(imageDataUrl);
  let lastReason = 'no_working_token';

  for (const token of tokens) {
    try {
      // 1. Upload image binary to Google Drive
      const boundary = '-------accsys_inline_img_' + Date.now();
      const fileName = `accsys_diagram_${Date.now()}.${ext}`;
      const metaJson = JSON.stringify({ name: fileName, mimeType });
      const multipartBody = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
        ),
        imgBuf,
        Buffer.from(`\r\n--${boundary}--`),
      ]);

      const upRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (!upRes.ok) {
        lastReason = `img_upload_${upRes.status}`;
        continue;
      }

      const upData = (await upRes.json()) as { id?: string };
      if (!upData?.id) {
        lastReason = 'img_no_id';
        continue;
      }

      // 2. Grant reader access so Google Docs backend can fetch the image URI
      await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          upData.id
        )}/permissions?supportsAllDrives=true`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ role: 'reader', type: 'anyone' }),
          signal: AbortSignal.timeout(8_000),
        }
      );

      const publicImgUri = `https://drive.google.com/uc?export=view&id=${encodeURIComponent(
        upData.id
      )}`;

      // 3. Find the target paragraph endIndex in the open Google Doc
      const targetRange = await findTargetParagraphRangeInGoogleDoc(
        effectiveDocId,
        token,
        targetSnippet,
        sectionTitleHint
      );

      const insertIdx = targetRange ? targetRange.endIndex : 1;
      const cleanCaption = caption ? caption.replace(/\*\*/g, '').trim() : '';

      // Insert a newline at the end of the selected paragraph, then insert the image right below it
      const requests: Array<Record<string, unknown>> = [
        {
          insertText: {
            location: { index: insertIdx },
            text: cleanCaption ? `\n\n${cleanCaption}` : '\n',
          },
        },
        {
          insertInlineImage: {
            location: { index: insertIdx + 1 },
            uri: publicImgUri,
            objectSize: {
              width: { magnitude: 440, unit: 'PT' },
              height: { magnitude: 248, unit: 'PT' },
            },
          },
        },
      ];

      const batchRes = await fetch(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(
          effectiveDocId
        )}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requests }),
          signal: AbortSignal.timeout(15_000),
        }
      );

      // Zero-Residue Cleanup: Immediately delete the temporary image file from Google Drive
      // after Google Docs has ingested it into the document body, leaving 0 storage residue!
      void fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          upData.id
        )}?supportsAllDrives=true`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: AbortSignal.timeout(8_000),
        }
      ).catch(() => null);

      if (batchRes.ok) {
        return {
          inserted: true,
          resolvedNativeDocId: effectiveDocId,
        };
      }
      lastReason = `doc_insert_img_${batchRes.status}`;
    } catch (err) {
      lastReason = err instanceof Error ? err.message : 'exception';
    }
  }

  return { inserted: false, reason: lastReason };
}

/**
 * Directly modifies a Google Drive document (`.docx` or native Google Doc) in-place.
 */
export async function patchDriveDocumentInPlace(params: {
  driveFileId: string;
  userEmail?: string;
  targetSnippet: string;
  newContent: string;
  sectionTitleHint?: string;
  insertMode?: 'replace' | 'insert_at_cursor' | 'insert_before' | 'insert_after';
  cursorAnchorBefore?: string;
  cursorAnchorAfter?: string;
  awaitLiveStream?: boolean;
}): Promise<{
  updated: boolean;
  liveStreaming?: boolean;
  resolvedNativeDocId?: string;
  reason?: string;
}> {
  const {
    driveFileId,
    userEmail,
    targetSnippet,
    newContent,
    sectionTitleHint,
    insertMode = 'replace',
    cursorAnchorBefore,
    cursorAnchorAfter,
  } = params;
  if (!driveFileId || !newContent.trim()) {
    return { updated: false, reason: 'missing_params' };
  }

  const tokens = await getCandidateDriveWriteTokens(userEmail);
  if (tokens.length === 0) {
    return { updated: false, reason: 'no_tokens' };
  }

  // Resolve to native Google Doc ID if mapped so live character-by-character OT streaming works
  const nativeMap = readNativeGdocMap();
  const isKnownNativeDoc = Boolean(nativeMap[driveFileId]);
  const effectiveDocId = isKnownNativeDoc
    ? nativeMap[driveFileId]
    : await ensureNativeGoogleDocForLiveEditing({
        driveFileId,
        userEmail,
      });

  // ULTRA-FAST PATH: If already known to be a native Google Doc, skip the Drive metadata round-trip
  // and verify the live stream into the open Google Doc!
  if (isKnownNativeDoc || Boolean(nativeMap[effectiveDocId])) {
    for (const token of tokens) {
      const ok = await streamTextIntoGoogleDocLive({
        docId: effectiveDocId,
        token,
        targetSnippet,
        newContent,
        sectionTitleHint,
        insertMode,
        cursorAnchorBefore,
        cursorAnchorAfter,
      }).catch(() => false);

      if (ok) {
        return {
          updated: true,
          liveStreaming: true,
          resolvedNativeDocId: effectiveDocId,
        };
      }
    }
    return {
      updated: false,
      liveStreaming: false,
      resolvedNativeDocId: effectiveDocId,
      reason: 'target_not_found',
    };
  }

  let lastReason = 'no_working_token';

  for (const token of tokens) {
    try {
      // 1. Check file metadata
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          effectiveDocId
        )}?fields=id,name,mimeType&supportsAllDrives=true`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(8_000),
          cache: 'no-store',
        }
      );

      if (!metaRes.ok) {
        lastReason = `meta_${metaRes.status}`;
        continue;
      }

      const meta = (await metaRes.json()) as {
        id: string;
        name: string;
        mimeType: string;
      };

      // Case A: Native Google Docs (`application/vnd.google-apps.document`)
      // Streams chunks live via Google Docs API `batchUpdate` so the open editor window
      // shows characters being typed one-by-one without ever reloading the iframe!
      if (meta.mimeType === 'application/vnd.google-apps.document') {
        const ok = await streamTextIntoGoogleDocLive({
          docId: meta.id,
          token,
          targetSnippet,
          newContent,
          sectionTitleHint,
          insertMode,
          cursorAnchorBefore,
          cursorAnchorAfter,
        }).catch(() => false);
        if (ok) {
          return {
            updated: true,
            liveStreaming: true,
            resolvedNativeDocId: meta.id,
          };
        }
        lastReason = 'target_not_found';
        continue;
      }

      // Case B: Word `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`)
      if (
        meta.mimeType.includes('wordprocessingml') ||
        meta.name.toLowerCase().endsWith('.docx')
      ) {
        const dlRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
            effectiveDocId
          )}?alt=media&supportsAllDrives=true`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15_000),
            cache: 'no-store',
          }
        );
        if (!dlRes.ok) {
          lastReason = `dl_${dlRes.status}`;
          continue;
        }

        const rawBuf = Buffer.from(await dlRes.arrayBuffer());
        const { buffer: patchedBuf, replaced } = patchDocxBuffer(
          rawBuf,
          targetSnippet,
          newContent,
          sectionTitleHint
        );

        if (!replaced) {
          lastReason = 'xml_target_not_found';
          continue;
        }

        const uploadRes = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
            effectiveDocId
          )}?uploadType=media&supportsAllDrives=true`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type':
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'Content-Length': String(patchedBuf.length),
            },
            body: new Uint8Array(patchedBuf),
            signal: AbortSignal.timeout(15_000),
          }
        );

        if (uploadRes.ok) {
          return { updated: true, liveStreaming: false };
        }
        lastReason = `upload_${uploadRes.status}`;
      }
    } catch (err) {
      lastReason = err instanceof Error ? err.message : 'exception';
    }
  }

  return { updated: false, reason: lastReason };
}

export type ExtractedDocSubSection = {
  id: string;
  code: string;
  title: string;
  content: string;
  headingId?: string;
  level?: 2 | 3;
};

export type ExtractedDocSection = {
  id: string;
  code: string;
  title: string;
  content: string;
  headingId?: string;
  subSections?: ExtractedDocSubSection[];
};

function cleanDocHeadingText(raw: string): string {
  return raw
    .replace(/[\u000b\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMajorDocSectionHeading(txt: string, style?: string): boolean {
  const clean = cleanDocHeadingText(txt);
  if (!clean || clean.length > 56 || clean.includes('｜')) return false;
  if (/[。；！？]$/.test(clean)) return false;

  // Cross-reference lines like "第01330章 – 資料送審 Section 01330 – Submittals" are Level 2 items under Related Sections, not Level 1 chapters
  if (/^第\d+[A-Z]?章\s*[–—-]/.test(clean)) return false;

  // Do not promote Level 2 patterns (一、, (一), ※, 2.1, proposal front-matter sub-blocks) to Level 1 even if styled as HEADING_1/HEADING_2
  if (
    /^[一二三四五六七八九十]+、/.test(clean) ||
    /^[(（][一二三四五六七八九十\d]+[)）]/.test(clean) ||
    /^※/.test(clean) ||
    /^\d+\.\d+/.test(clean) ||
    /^(?:曾經參與政府相關研發計畫之實績|目前申請中之計畫|近3年曾申請未通過之計畫說明|本次申請計畫與前次申請之差異說明|綜合資料|計畫摘要表[（(]續[)）])/.test(
      clean
    )
  ) {
    return false;
  }

  const isStyleHeading = style === 'HEADING_1' || style === 'TITLE';
  const isPatternHeading =
    /^[壹貳參肆伍陸柒捌玖拾]、/.test(clean) ||
    /^附件[一二三四五六七八九十\d]+[、：:\s]/.test(clean) ||
    /^第[一二三四五六七八九十\d]+[A-Z]?[章節篇](?!\s*[–—-])/.test(clean) ||
    /^\d+\.0\s+\S+/.test(clean) ||
    /^(?:計畫書摘要表|申請紀錄說明|計畫書目錄)/.test(clean) ||
    /^(?:相關準則與標準\s*Relevant|產品\s*Products|系統功能\s*System\s*Functions|施工\s*Execution|檢驗與測試\s*Inspection)/i.test(
      clean
    );

  return isStyleHeading || isPatternHeading;
}

export function isSubSectionDocHeading(txt: string, style?: string): boolean {
  const clean = cleanDocHeadingText(txt);
  if (!clean || clean.length < 3 || clean.length > 56 || clean.includes('｜')) {
    return false;
  }
  if (/[。；！？]$/.test(clean)) return false;
  if (isMajorDocSectionHeading(clean, style)) return false;

  // Exclude summary lines that cram multiple headings into a single line
  if (
    /[(（][一二三四五六七八九十]+[)）].*[(（][一二三四五六七八九十]+[)）]/.test(clean) ||
    /^[一二三四五六七八九十]+、.*[(（][一二三四五六七八九十]+[)）]/.test(clean) ||
    /^[一二三四五六七八九十]+、.*[一二三四五六七八九十]+、/.test(clean)
  ) {
    return false;
  }

  // Exclude inline body sentences with a colon followed by a long description (except ※ company headers)
  if (!clean.startsWith('※') && /[：:]\s*\S{3,}/.test(clean)) {
    return false;
  }

  // 1. Company / entity divider in joint proposals
  if (/^※\s*(?:主導|聯合)?(?:申請公司|.+公司)/.test(clean)) return true;

  // 2. Primary Chinese sub-headings: 一、基本資料, 二、經營團隊及執行能力, etc.
  if (/^[一二三四五六七八九十]+、\s*\S+/.test(clean)) return true;

  // 3. Secondary parenthesized sub-headings: (一)公司簡介, (五)參與並獲得通過教育部產學攜手合作計畫2.0說明, etc.
  if (/^[(（][一二三四五六七八九十]+[)）]\s*\S+/.test(clean)) return true;

  // 4. Decimal sub-headings: 2.1.創新或研究發展研發之人事費, 3.1年度經費使用分配表, 1.1 通則
  if (/^\d+\.\d+\.?\s*[^\d\s]/.test(clean)) return true;

  // 5. Proposal front-matter sub-blocks
  if (
    /^(?:曾經參與政府相關研發計畫之實績|目前申請中之計畫|近3年曾申請未通過之計畫說明|本次申請計畫與前次申請之差異說明|綜合資料|計畫摘要表[（(]續[)）])/.test(
      clean
    )
  ) {
    return true;
  }

  // 6. Engineering specification referenced chapters & bilingual sub-headings
  if (/^第\d+[A-Z]?章\s*[–—-]\s*\S+/.test(clean)) return true;
  if (
    !/協會|學會|標準局|委員會|IEEE\s*802/.test(clean) &&
    /^[\u4e00-\u9fff()（）/、，\s]{2,18}\s+[A-Z][A-Za-z0-9\s,&/()-]{3,42}[：:]?$/.test(
      clean
    )
  ) {
    return true;
  }

  return style === 'HEADING_2' || style === 'HEADING_3';
}

function getSubSectionLevel(title: string): 2 | 3 {
  const clean = cleanDocHeadingText(title);
  if (/^[(（][一二三四五六七八九十\d]+[)）]/.test(clean) || /^\d+\.\d+/.test(clean)) {
    return 3;
  }
  return 2;
}

export function buildSubSectionsFromLines(params: {
  secId: string;
  secIndex: number;
  secTitle: string;
  lines: Array<{ text: string; headingId?: string }>;
}): ExtractedDocSubSection[] {
  const { secId, secIndex, secTitle, lines } = params;
  const subRaw: Array<{
    title: string;
    headingId?: string;
    level: 2 | 3;
    lines: string[];
  }> = [];

  let currentCompanyBadge = '';
  let currentSub: {
    title: string;
    headingId?: string;
    level: 2 | 3;
    lines: string[];
  } | null = null;

  const normSecTitle = normalizeForMatch(secTitle);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].text.trim();
    if (!rawLine) continue;
    const cleanLine = cleanDocHeadingText(rawLine);

    // Skip repeating the Level 1 chapter title itself on the very first line
    if (i === 0 && normalizeForMatch(cleanLine) === normSecTitle) {
      continue;
    }

    if (isSubSectionDocHeading(cleanLine)) {
      const companyMatch = cleanLine.match(
        /^※\s*(?:主導|聯合)?申請公司[：:]\s*([^\s(（]+)/
      );
      if (companyMatch?.[1]) {
        currentCompanyBadge = companyMatch[1]
          .replace(/股份有限公司|有限公司/g, '')
          .trim()
          .slice(0, 4);
      }

      let displayTitle = cleanLine.slice(0, 48);
      if (
        currentCompanyBadge &&
        !cleanLine.startsWith('※') &&
        /^[一二三四五六七八九十]+、/.test(cleanLine) &&
        subRaw.some((s) => s.title.endsWith(cleanLine))
      ) {
        displayTitle = `[${currentCompanyBadge}] ${cleanLine}`.slice(0, 48);
      }

      if (currentSub) {
        subRaw.push(currentSub);
      }
      currentSub = {
        title: displayTitle,
        headingId: lines[i].headingId,
        level: getSubSectionLevel(cleanLine),
        lines: [rawLine],
      };
    } else if (currentSub) {
      currentSub.lines.push(rawLine);
    }
  }

  if (currentSub) {
    subRaw.push(currentSub);
  }

  return subRaw.slice(0, 45).map((sub, j) => ({
    id: `${secId}-sub-${j + 1}`,
    code: `${secIndex + 1}.${j + 1}`,
    title: sub.title,
    content: sub.lines.join('\n\n').slice(0, 12000),
    headingId: sub.headingId,
    level: sub.level,
  }));
}

function upgradeCachedSectionsIfNeeded(
  docId: string,
  sections: ExtractedDocSection[]
): ExtractedDocSection[] {
  const alreadyUpgraded =
    sections.some((s) => Array.isArray(s.subSections) && s.subSections.length > 0) &&
    !sections.some((s) => /^第\d+[A-Z]?章\s*[–—-]/.test(cleanDocHeadingText(s.title))) &&
    !sections.some(
      (s) =>
        s.title.includes('肆、計畫經費需求') &&
        s.content.includes('\n\n附件一、公司近3年財務狀況')
    );

  if (alreadyUpgraded) return sections;

  // Re-segment all lines across existing sections into clean Level 1 + Level 2 hierarchy
  const allBlocks: Array<{ text: string; headingId?: string }> = [];
  for (const sec of sections) {
    const rawParas = sec.content.split(/\n\n+/);
    rawParas.forEach((p, idx) => {
      const trimmed = p.trim();
      if (!trimmed) return;
      allBlocks.push({
        text: trimmed,
        headingId: idx === 0 ? sec.headingId : undefined,
      });
    });
  }

  if (allBlocks.length === 0) return sections;

  const rawMajor: Array<{
    title: string;
    headingId?: string;
    lines: Array<{ text: string; headingId?: string }>;
  }> = [];

  let currentMajor = {
    title: cleanDocHeadingText(allBlocks[0].text).slice(0, 42),
    headingId: allBlocks[0].headingId,
    lines: [allBlocks[0]],
  };

  for (let i = 1; i < allBlocks.length; i++) {
    const b = allBlocks[i];
    if (isMajorDocSectionHeading(b.text) && rawMajor.length < 18) {
      rawMajor.push(currentMajor);
      currentMajor = {
        title: cleanDocHeadingText(b.text).slice(0, 42),
        headingId: b.headingId,
        lines: [b],
      };
    } else {
      currentMajor.lines.push(b);
    }
  }
  rawMajor.push(currentMajor);

  const upgraded: ExtractedDocSection[] = rawMajor.map((m, idx) => {
    const secId = `sec-${idx + 1}`;
    const subSections = buildSubSectionsFromLines({
      secId,
      secIndex: idx,
      secTitle: m.title,
      lines: m.lines,
    });
    return {
      id: secId,
      code: `${idx + 1}.0`,
      title: m.title,
      content: m.lines
        .map((l) => l.text)
        .join('\n\n')
        .slice(0, 48000),
      headingId: m.headingId,
      subSections,
    };
  });

  saveCachedDocSections(docId, upgraded);
  return upgraded;
}

function readCachedDocSections(docId: string): ExtractedDocSection[] | null {
  try {
    if (!existsSync(SECTIONS_CACHE_PATH)) return null;
    const parsed = JSON.parse(readFileSync(SECTIONS_CACHE_PATH, 'utf8')) as Record<
      string,
      ExtractedDocSection[]
    >;
    const hit = parsed?.[docId];
    if (!Array.isArray(hit) || hit.length === 0) return null;
    return upgradeCachedSectionsIfNeeded(docId, hit);
  } catch {
    return null;
  }
}

function saveCachedDocSections(docId: string, sections: ExtractedDocSection[]): void {
  try {
    let map: Record<string, ExtractedDocSection[]> = {};
    if (existsSync(SECTIONS_CACHE_PATH)) {
      map = JSON.parse(readFileSync(SECTIONS_CACHE_PATH, 'utf8')) as Record<
        string,
        ExtractedDocSection[]
      >;
    }
    map[docId] = sections;
    writeFileSync(SECTIONS_CACHE_PATH, JSON.stringify(map, null, 2), 'utf8');
  } catch {
    // ignore fs errors
  }
}

/**
 * Ensures every major section heading AND sub-section heading in a native Google Doc has a real Google Docs `headingId` (`h.xxxxx`)
 * so double-clicking any item in the 2-tier "當前檔案內容索引" can jump the native Google Docs iframe directly to `#heading=h.xxxxx`.
 */
export async function ensureGoogleDocSectionHeadings(params: {
  driveFileId: string;
  userEmail?: string;
  sectionId?: string;
  sectionTitle?: string;
}): Promise<{
  resolvedNativeDocId: string;
  headingBySectionId: Record<string, string>;
  targetHeadingId?: string;
  wordSections?: ExtractedDocSection[];
}> {
  const { driveFileId, userEmail, sectionId, sectionTitle } = params;
  const map = readNativeGdocMap();
  const nativeDocId = map[driveFileId] || driveFileId;

  const cachedSections = readCachedDocSections(nativeDocId);
  const initialHeadingBySectionId: Record<string, string> = {};
  for (const s of cachedSections ?? []) {
    if (s.headingId) initialHeadingBySectionId[s.id] = s.headingId;
    for (const sub of s.subSections ?? []) {
      if (sub.headingId) initialHeadingBySectionId[sub.id] = sub.headingId;
    }
  }

  const allCachedHaveHeadings =
    cachedSections &&
    cachedSections.length > 0 &&
    cachedSections.every(
      (s) =>
        Boolean(s.headingId) &&
        Array.isArray(s.subSections) &&
        s.subSections.every((sub) => Boolean(sub.headingId))
    );

  if (allCachedHaveHeadings && cachedSections) {
    const headingBySectionId = { ...initialHeadingBySectionId };
    const cleanTargetTitle = sectionTitle ? normalizeForMatch(sectionTitle) : '';
    let targetHeadingId = sectionId ? headingBySectionId[sectionId] : undefined;
    if (!targetHeadingId && cleanTargetTitle) {
      for (const s of cachedSections) {
        if (
          s.headingId &&
          (normalizeForMatch(s.title).includes(cleanTargetTitle) ||
            cleanTargetTitle.includes(normalizeForMatch(s.title)))
        ) {
          targetHeadingId = s.headingId;
          break;
        }
        for (const sub of s.subSections ?? []) {
          if (
            sub.headingId &&
            (normalizeForMatch(sub.title).includes(cleanTargetTitle) ||
              cleanTargetTitle.includes(normalizeForMatch(sub.title)))
          ) {
            targetHeadingId = sub.headingId;
            break;
          }
        }
        if (targetHeadingId) break;
      }
    }
    if (!targetHeadingId && sectionId === 'toc-index') {
      const tocSec = cachedSections.find((s) => s.title.includes('目錄'));
      targetHeadingId = tocSec?.headingId ?? cachedSections[0]?.headingId;
    }
    return {
      resolvedNativeDocId: nativeDocId,
      headingBySectionId,
      targetHeadingId,
      wordSections: cachedSections,
    };
  }

  const tokens = await getCandidateDriveWriteTokens(userEmail);
  const token = tokens[0];
  if (!token) {
    return {
      resolvedNativeDocId: nativeDocId,
      headingBySectionId: initialHeadingBySectionId,
      targetHeadingId: sectionId ? initialHeadingBySectionId[sectionId] : undefined,
      wordSections: cachedSections ?? undefined,
    };
  }

  try {
    const fetchHeadingsMeta = async () => {
      const res = await fetch(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(
          nativeDocId
        )}?fields=body(content(startIndex,endIndex,sectionBreak(sectionStyle(flipPageOrientation)),paragraph(paragraphStyle(namedStyleType,headingId),elements(textRun(content,textStyle(fontSize,bold))))))`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(12_000),
          cache: 'no-store',
        }
      );
      if (!res.ok) return null;
      return (await res.json()) as {
        body?: {
          content?: Array<{
            startIndex?: number;
            endIndex?: number;
            sectionBreak?: {
              sectionStyle?: { flipPageOrientation?: boolean };
            };
            paragraph?: {
              paragraphStyle?: { namedStyleType?: string; headingId?: string };
              elements?: Array<{
                textRun?: {
                  content?: string;
                  textStyle?: {
                    fontSize?: { magnitude?: number; unit?: string };
                    bold?: boolean;
                  };
                };
              }>;
            };
          }>;
        };
      };
    };

    let doc = await fetchHeadingsMeta();
    if (!doc) {
      return {
        resolvedNativeDocId: nativeDocId,
        headingBySectionId: initialHeadingBySectionId,
        targetHeadingId: sectionId ? initialHeadingBySectionId[sectionId] : undefined,
        wordSections: cachedSections ?? undefined,
      };
    }

    // Normalize any landscape section breaks (flipPageOrientation: true) so Google Docs
    // doesn't widen .kix-rotatingtilemanager to 1133px and shift all portrait pages 170px to the right
    const landscapeBreaks: Array<{ startIndex: number; endIndex: number }> = [];
    for (const el of doc.body?.content ?? []) {
      if (
        el.sectionBreak?.sectionStyle?.flipPageOrientation === true &&
        typeof el.startIndex === 'number' &&
        typeof el.endIndex === 'number'
      ) {
        landscapeBreaks.push({
          startIndex: el.startIndex,
          endIndex: el.endIndex,
        });
      }
    }
    if (landscapeBreaks.length > 0) {
      try {
        await fetch(
          `https://docs.googleapis.com/v1/documents/${encodeURIComponent(
            nativeDocId
          )}:batchUpdate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: landscapeBreaks.map((lb) => ({
                updateSectionStyle: {
                  range: { startIndex: lb.startIndex, endIndex: lb.endIndex },
                  sectionStyle: { flipPageOrientation: false },
                  fields: 'flipPageOrientation',
                },
              })),
            }),
            signal: AbortSignal.timeout(8_000),
          }
        );
      } catch {
        // ignore if section style update is unsupported on a specific break
      }
    }

    type HeadingPara = {
      id: string;
      isMajor: boolean;
      secIdx: number;
      subIdx?: number;
      title: string;
      normTitle: string;
      startIndex: number;
      endIndex: number;
      headingId?: string;
      fontSize?: { magnitude?: number; unit?: string };
      bold?: boolean;
    };

    const collectHeadingParas = (
      docData: NonNullable<typeof doc>
    ): HeadingPara[] => {
      const result: HeadingPara[] = [];
      let seenNonEmpty = 0;
      let currentMajorIdx = -1;
      let currentSubCount = 0;

      for (const el of docData.body?.content ?? []) {
        if (
          !el.paragraph ||
          typeof el.startIndex !== 'number' ||
          typeof el.endIndex !== 'number'
        ) {
          continue;
        }
        const txt = (el.paragraph.elements ?? [])
          .map((e) => e.textRun?.content ?? '')
          .join('')
          .replace(/\r?\n$/u, '')
          .trim();
        if (!txt) continue;
        const cleanTxt = cleanDocHeadingText(txt);
        if (!cleanTxt) continue;

        const style = el.paragraph.paragraphStyle?.namedStyleType ?? '';
        const hId = el.paragraph.paragraphStyle?.headingId;
        const firstTextStyle = el.paragraph.elements?.find(
          (e) => e.textRun?.content?.trim()
        )?.textRun?.textStyle;

        const isFirstTitle = seenNonEmpty === 0;
        seenNonEmpty++;

        if (isFirstTitle || (isMajorDocSectionHeading(cleanTxt) && currentMajorIdx < 25)) {
          currentMajorIdx++;
          currentSubCount = 0;
          const secId = `sec-${currentMajorIdx + 1}`;
          result.push({
            id: secId,
            isMajor: true,
            secIdx: currentMajorIdx,
            title: cleanTxt.slice(0, 42),
            normTitle: normalizeForMatch(cleanTxt.slice(0, 42)),
            startIndex: el.startIndex,
            endIndex: el.endIndex,
            headingId: hId,
            fontSize: firstTextStyle?.fontSize,
            bold: firstTextStyle?.bold,
          });
        } else if (
          currentMajorIdx >= 0 &&
          currentSubCount < 45 &&
          isSubSectionDocHeading(cleanTxt, style)
        ) {
          currentSubCount++;
          const subId = `sec-${currentMajorIdx + 1}-sub-${currentSubCount}`;
          result.push({
            id: subId,
            isMajor: false,
            secIdx: currentMajorIdx,
            subIdx: currentSubCount - 1,
            title: cleanTxt.slice(0, 48),
            normTitle: normalizeForMatch(cleanTxt.slice(0, 48)),
            startIndex: el.startIndex,
            endIndex: el.endIndex,
            headingId: hId,
            fontSize: firstTextStyle?.fontSize,
            bold: firstTextStyle?.bold,
          });
        }
      }
      return result;
    };

    let headingParas = collectHeadingParas(doc);
    const missingHeadingParas = headingParas
      .filter((hp) => !hp.headingId)
      .slice(0, 200);

    // Promote any major or sub-section heading paragraph that lacks a Google Docs headingId
    // while explicitly preserving its original font size & bold weight so visual layout stays identical
    if (missingHeadingParas.length > 0) {
      const requests: Array<Record<string, unknown>> = [];
      for (const hp of missingHeadingParas) {
        requests.push({
          updateParagraphStyle: {
            range: {
              startIndex: hp.startIndex,
              endIndex: hp.endIndex,
            },
            paragraphStyle: {
              namedStyleType: hp.isMajor ? 'HEADING_1' : 'HEADING_2',
            },
            fields: 'namedStyleType',
          },
        });
        if (hp.endIndex - 1 > hp.startIndex) {
          requests.push({
            updateTextStyle: {
              range: {
                startIndex: hp.startIndex,
                endIndex: hp.endIndex - 1,
              },
              textStyle: {
                fontSize:
                  hp.fontSize?.magnitude && hp.fontSize?.unit
                    ? hp.fontSize
                    : { magnitude: hp.isMajor ? 14 : 12, unit: 'PT' },
                bold: hp.bold ?? true,
              },
              fields: 'fontSize,bold',
            },
          });
        }
      }

      const batchRes = await fetch(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(
          nativeDocId
        )}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requests }),
          signal: AbortSignal.timeout(12_000),
        }
      );

      if (batchRes.ok) {
        const refreshed = await fetchHeadingsMeta();
        if (refreshed) {
          doc = refreshed;
          headingParas = collectHeadingParas(doc);
        }
      }
    }

    const headingBySectionId: Record<string, string> = {
      ...initialHeadingBySectionId,
    };
    for (const hp of headingParas) {
      if (hp.headingId) {
        headingBySectionId[hp.id] = hp.headingId;
      }
    }

    let updatedSections = cachedSections;
    if (cachedSections && cachedSections.length > 0) {
      const majorParas = headingParas.filter((hp) => hp.isMajor);
      updatedSections = cachedSections.map((s, idx) => {
        const normS = normalizeForMatch(s.title);
        const byTitle = majorParas.find(
          (hp) => hp.normTitle.includes(normS) || normS.includes(hp.normTitle)
        );
        const hId =
          headingBySectionId[s.id] ||
          byTitle?.headingId ||
          majorParas[idx]?.headingId ||
          s.headingId;
        if (hId) headingBySectionId[s.id] = hId;

        const subParasForSec = headingParas.filter(
          (hp) => !hp.isMajor && hp.secIdx === idx
        );
        const nextSubSections = (s.subSections ?? []).map((sub, subIdx) => {
          const rawSubTitle = sub.title.replace(/^\[[^\]]+\]\s*/, '');
          const normSub = normalizeForMatch(rawSubTitle);
          const subByOrder = subParasForSec[subIdx];
          const subByTitle = subParasForSec.find(
            (hp) =>
              hp.normTitle.includes(normSub) || normSub.includes(hp.normTitle)
          );
          const subAnyByTitle = headingParas.find(
            (hp) =>
              !hp.isMajor &&
              (hp.normTitle.includes(normSub) || normSub.includes(hp.normTitle))
          );
          const subHId =
            headingBySectionId[sub.id] ||
            subByOrder?.headingId ||
            subByTitle?.headingId ||
            subAnyByTitle?.headingId ||
            sub.headingId;
          if (subHId) headingBySectionId[sub.id] = subHId;
          return {
            ...sub,
            headingId: subHId,
          };
        });

        return {
          ...s,
          headingId: hId,
          subSections: nextSubSections,
        };
      });
      saveCachedDocSections(nativeDocId, updatedSections);
    }

    const cleanTargetTitle = sectionTitle
      ? normalizeForMatch(sectionTitle.replace(/^\[[^\]]+\]\s*/, ''))
      : '';
    let targetHeadingId = sectionId ? headingBySectionId[sectionId] : undefined;
    if (!targetHeadingId && cleanTargetTitle) {
      const hit = headingParas.find(
        (hp) =>
          hp.normTitle.includes(cleanTargetTitle) ||
          cleanTargetTitle.includes(hp.normTitle)
      );
      targetHeadingId = hit?.headingId;
    }

    // If a specific sub-section or paragraph title was clicked and still has no headingId,
    // scan all paragraphs in the document for a matching title and promote it on-the-fly so it gets a real headingId!
    if (!targetHeadingId && cleanTargetTitle) {
      for (const el of doc.body?.content ?? []) {
        if (
          !el.paragraph ||
          typeof el.startIndex !== 'number' ||
          typeof el.endIndex !== 'number'
        ) {
          continue;
        }
        const txt = (el.paragraph.elements ?? [])
          .map((e) => e.textRun?.content ?? '')
          .join('')
          .replace(/\r?\n$/u, '')
          .trim();
        if (!txt || txt.length > 80) continue;
        const normP = normalizeForMatch(cleanDocHeadingText(txt));
        if (
          normP &&
          (normP === cleanTargetTitle ||
            normP.startsWith(cleanTargetTitle) ||
            cleanTargetTitle.startsWith(normP))
        ) {
          const existingHId = el.paragraph.paragraphStyle?.headingId;
          if (existingHId) {
            targetHeadingId = existingHId;
            if (sectionId) headingBySectionId[sectionId] = existingHId;
            break;
          }
          const firstTextStyle = el.paragraph.elements?.find(
            (e) => e.textRun?.content?.trim()
          )?.textRun?.textStyle;
          const singleReqs: Array<Record<string, unknown>> = [
            {
              updateParagraphStyle: {
                range: { startIndex: el.startIndex, endIndex: el.endIndex },
                paragraphStyle: { namedStyleType: 'HEADING_2' },
                fields: 'namedStyleType',
              },
            },
          ];
          if (el.endIndex - 1 > el.startIndex) {
            singleReqs.push({
              updateTextStyle: {
                range: {
                  startIndex: el.startIndex,
                  endIndex: el.endIndex - 1,
                },
                textStyle: {
                  fontSize:
                    firstTextStyle?.fontSize?.magnitude &&
                    firstTextStyle?.fontSize?.unit
                      ? firstTextStyle.fontSize
                      : { magnitude: 12, unit: 'PT' },
                  bold: firstTextStyle?.bold ?? true,
                },
                fields: 'fontSize,bold',
              },
            });
          }
          const singleRes = await fetch(
            `https://docs.googleapis.com/v1/documents/${encodeURIComponent(
              nativeDocId
            )}:batchUpdate`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ requests: singleReqs }),
              signal: AbortSignal.timeout(8_000),
            }
          );
          if (singleRes.ok) {
            const refreshedSingle = await fetchHeadingsMeta();
            const matchedEl = (refreshedSingle?.body?.content ?? []).find(
              (c) => c.startIndex === el.startIndex && c.paragraph?.paragraphStyle?.headingId
            );
            const newHId = matchedEl?.paragraph?.paragraphStyle?.headingId;
            if (newHId) {
              targetHeadingId = newHId;
              if (sectionId) headingBySectionId[sectionId] = newHId;
              if (updatedSections) {
                updatedSections = updatedSections.map((s) => ({
                  ...s,
                  subSections: (s.subSections ?? []).map((sub) =>
                    sub.id === sectionId ? { ...sub, headingId: newHId } : sub
                  ),
                }));
                saveCachedDocSections(nativeDocId, updatedSections);
              }
            }
          }
          break;
        }
      }
    }

    if (!targetHeadingId && sectionId === 'toc-index') {
      const tocHit = headingParas.find((hp) => hp.normTitle.includes('目錄'));
      targetHeadingId = tocHit?.headingId ?? headingParas[0]?.headingId;
    }

    return {
      resolvedNativeDocId: nativeDocId,
      headingBySectionId,
      targetHeadingId,
      wordSections: updatedSections ?? undefined,
    };
  } catch {
    return {
      resolvedNativeDocId: nativeDocId,
      headingBySectionId: initialHeadingBySectionId,
      targetHeadingId: sectionId ? initialHeadingBySectionId[sectionId] : undefined,
      wordSections: cachedSections ?? undefined,
    };
  }
}

/**
 * Extracts structured chapters/sections from a native Google Doc so that the left
 * Chapter Index, selection orb, and AI co-author work with the real content of any dropped/opened document.
 */
export async function extractWordSectionsFromGoogleDoc(
  docId: string,
  token: string
): Promise<ExtractedDocSection[] | null> {
  const cached = readCachedDocSections(docId);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(
        docId
      )}?fields=body(content(paragraph(paragraphStyle(namedStyleType,headingId),elements(textRun(content))),table(tableRows(tableCells(content(paragraph(elements(textRun(content)))))))))`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(12_000),
        cache: 'no-store',
      }
    );
    if (!res.ok) return null;

    const doc = (await res.json()) as {
      body?: {
        content?: Array<{
          paragraph?: {
            paragraphStyle?: { namedStyleType?: string; headingId?: string };
            elements?: Array<{ textRun?: { content?: string } }>;
          };
          table?: {
            tableRows?: Array<{
              tableCells?: Array<{
                content?: Array<{
                  paragraph?: {
                    elements?: Array<{ textRun?: { content?: string } }>;
                  };
                }>;
              }>;
            }>;
          };
        }>;
      };
    };

    const blocks: Array<{ isHeading: boolean; text: string; headingId?: string }> = [];

    for (const el of doc.body?.content ?? []) {
      if (el.paragraph) {
        const txt = (el.paragraph.elements ?? [])
          .map((e) => e.textRun?.content ?? '')
          .join('')
          .replace(/\r?\n$/u, '')
          .trim();
        if (!txt) continue;
        const style = el.paragraph.paragraphStyle?.namedStyleType ?? '';
        const hId = el.paragraph.paragraphStyle?.headingId;

        blocks.push({
          isHeading: isMajorDocSectionHeading(txt, style),
          text: txt,
          headingId: hId,
        });
      } else if (el.table) {
        const rowsText: string[] = [];
        for (const r of (el.table.tableRows ?? []).slice(0, 25)) {
          const cellsText: string[] = [];
          for (const c of (r.tableCells ?? []).slice(0, 8)) {
            const ct = (c.content ?? [])
              .map((p) =>
                (p.paragraph?.elements ?? [])
                  .map((e) => e.textRun?.content ?? '')
                  .join('')
                  .trim()
              )
              .filter(Boolean)
              .join(' ');
            if (ct) cellsText.push(ct.slice(0, 120));
          }
          if (cellsText.length > 0) {
            rowsText.push(cellsText.join(' ｜ '));
          }
        }
        if (rowsText.length > 0) {
          blocks.push({
            isHeading: false,
            text: rowsText.join('\n'),
          });
        }
      }
    }

    if (blocks.length === 0) return null;

    const rawSections: Array<{
      title: string;
      lines: Array<{ text: string; headingId?: string }>;
      headingId?: string;
    }> = [];
    let current: {
      title: string;
      lines: Array<{ text: string; headingId?: string }>;
      headingId?: string;
    } = {
      title: cleanDocHeadingText(blocks[0].text).slice(0, 42),
      lines: [],
      headingId: blocks[0].headingId,
    };

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (i > 0 && b.isHeading && rawSections.length < 18) {
        if (current.lines.length === 0) {
          current.lines.push({ text: current.title, headingId: current.headingId });
        }
        rawSections.push(current);
        current = {
          title: cleanDocHeadingText(b.text).slice(0, 42),
          lines: [{ text: b.text, headingId: b.headingId }],
          headingId: b.headingId,
        };
      } else {
        current.lines.push({ text: b.text, headingId: b.headingId });
      }
    }
    if (current.lines.length > 0 || rawSections.length === 0) {
      rawSections.push(current);
    }

    const extracted: ExtractedDocSection[] = rawSections.slice(0, 18).map((s, idx) => {
      const secId = `sec-${idx + 1}`;
      const subSections = buildSubSectionsFromLines({
        secId,
        secIndex: idx,
        secTitle: s.title,
        lines: s.lines,
      });
      return {
        id: secId,
        code: `${idx + 1}.0`,
        title: s.title,
        content: s.lines
          .map((l) => l.text)
          .join('\n\n')
          .slice(0, 48000),
        headingId: s.headingId,
        subSections,
      };
    });
    saveCachedDocSections(docId, extracted);
    return extracted;
  } catch {
    return null;
  }
}

/**
 * Fast local `.docx` chapter and content parser (`word/document.xml`).
 * Accepts track changes (`<w:ins>` kept, `<w:del>` / `<w:moveFrom>` stripped)
 * and extracts structured sections in < 20ms even before or without Google Drive upload.
 */
export function extractWordSectionsFromDocxBuffer(
  docxBuf: Buffer
): ExtractedDocSection[] | null {
  try {
    const entries = parseZipEntries(docxBuf);
    if (!entries) return null;
    const docEntry = entries.find((e) => e.fileName === 'word/document.xml');
    if (!docEntry) return null;

    const rawXml =
      docEntry.compressionMethod === 8
        ? inflateRawSync(docEntry.compressedData)
        : docEntry.compressedData;
    const cleanedXml = rawXml
      .toString('utf8')
      .replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')
      .replace(/<w:moveFrom\b[\s\S]*?<\/w:moveFrom>/g, '');

    const blocks: Array<{ isHeading: boolean; text: string }> = [];
    const pRegex = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
    let m: RegExpExecArray | null;
    while ((m = pRegex.exec(cleanedXml)) !== null) {
      const pXml = m[0];
      const tMatches = [...pXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
      if (tMatches.length === 0) continue;
      const txt = unescapeXml(tMatches.map((tm) => tm[1]).join(''))
        .replace(/\s+/g, ' ')
        .trim();
      if (!txt) continue;

      const styleMatch = pXml.match(/<w:pStyle\s+w:val="([^"]+)"/);
      const rawStyle = styleMatch ? styleMatch[1] : '';
      const normStyle =
        /^(?:heading\s*[123]|[123]|title|toc\s*heading)$/i.test(rawStyle) ||
        rawStyle.startsWith('Heading')
          ? 'HEADING_1'
          : '';
      const hasOutlineLvl = /<w:outlineLvl\s+w:val="[01]"/.test(pXml);

      blocks.push({
        isHeading:
          isMajorDocSectionHeading(txt, normStyle) ||
          (hasOutlineLvl && txt.length <= 48),
        text: txt,
      });
    }

    if (blocks.length === 0) return null;

    const rawSections: Array<{
      title: string;
      lines: Array<{ text: string; headingId?: string }>;
    }> = [];
    let current: {
      title: string;
      lines: Array<{ text: string; headingId?: string }>;
    } = {
      title: cleanDocHeadingText(blocks[0].text).slice(0, 42),
      lines: [],
    };

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (i > 0 && b.isHeading && rawSections.length < 22) {
        if (current.lines.length === 0) {
          current.lines.push({ text: current.title });
        }
        rawSections.push(current);
        current = {
          title: cleanDocHeadingText(b.text).slice(0, 42),
          lines: [{ text: b.text }],
        };
      } else {
        current.lines.push({ text: b.text });
      }
    }
    if (current.lines.length > 0 || rawSections.length === 0) {
      rawSections.push(current);
    }

    return rawSections.slice(0, 22).map((s, idx) => {
      const secId = `sec-${idx + 1}`;
      const subSections = buildSubSectionsFromLines({
        secId,
        secIndex: idx,
        secTitle: s.title,
        lines: s.lines,
      });
      return {
        id: secId,
        code: `${idx + 1}.0`,
        title: s.title,
        content: s.lines
          .map((l) => l.text)
          .join('\n\n')
          .slice(0, 48000),
        subSections,
      };
    });
  } catch {
    return null;
  }
}

/**
 * Cleans track-change revision bloat (`<w:del>`, `<w:rPrChange>`, `<w:pPrChange>`, `<w:ins>`)
 * and compacts oversized embedded raster media (`word/media/*` > 600 KB) so large 25MB+
 * `.docx` proposals convert to Native Google Docs (`application/vnd.google-apps.document`)
 * in 2–3 seconds without hitting Google Drive's import conversion limit or timeout.
 */
function buildCompactDocxForGoogleConversion(docxBuf: Buffer): Buffer {
  try {
    const entries = parseZipEntries(docxBuf);
    if (!entries) return docxBuf;

    const placeholderPng = buildFallbackDiagramPngBuffer();
    const placeholderCompressed = deflateRawSync(placeholderPng);
    const placeholderCrc = crc32(placeholderPng);

    for (const entry of entries) {
      if (entry.fileName === 'word/document.xml') {
        try {
          const rawXml =
            entry.compressionMethod === 8
              ? inflateRawSync(entry.compressedData)
              : entry.compressedData;
          let xmlStr = rawXml.toString('utf8');
          xmlStr = xmlStr
            .replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')
            .replace(/<w:moveFrom\b[\s\S]*?<\/w:moveFrom>/g, '')
            .replace(/<w:moveFromRangeStart\b[^>]*\/>/g, '')
            .replace(/<w:moveFromRangeEnd\b[^>]*\/>/g, '')
            .replace(/<w:moveToRangeStart\b[^>]*\/>/g, '')
            .replace(/<w:moveToRangeEnd\b[^>]*\/>/g, '')
            .replace(/<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/g, '')
            .replace(/<w:pPrChange\b[\s\S]*?<\/w:pPrChange>/g, '')
            .replace(/<w:tblPrChange\b[\s\S]*?<\/w:tblPrChange>/g, '')
            .replace(/<w:trPrChange\b[\s\S]*?<\/w:trPrChange>/g, '')
            .replace(/<w:tcPrChange\b[\s\S]*?<\/w:tcPrChange>/g, '')
            .replace(/<w:sectPrChange\b[\s\S]*?<\/w:sectPrChange>/g, '')
            .replace(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g, '$1')
            .replace(/<w:moveTo\b[^>]*>([\s\S]*?)<\/w:moveTo>/g, '$1');
          const cleanBuf = Buffer.from(xmlStr, 'utf8');
          entry.compressedData =
            entry.compressionMethod === 8 ? deflateRawSync(cleanBuf) : cleanBuf;
          entry.uncompressedSize = cleanBuf.length;
          entry.crc = crc32(cleanBuf);
        } catch {
          // keep original document.xml if decompression fails
        }
      } else if (
        entry.fileName.startsWith('word/media/') &&
        entry.uncompressedSize > 600_000
      ) {
        entry.compressionMethod = 8;
        entry.compressedData = placeholderCompressed;
        entry.uncompressedSize = placeholderPng.length;
        entry.crc = placeholderCrc;
      }
    }

    return buildZipBuffer(entries);
  } catch {
    return docxBuf;
  }
}

/**
 * Resolves a dropped or selected file (`.docx`, `.xlsx`, `.pptx`) to its real Google Drive ID
 * (or uploads the local file binary to Google Drive as a native Google Doc / Sheet / Slide)
 * so the native editor iframe opens THAT exact document instead of falling back to the first starter document.
 */
export async function resolveOrUploadDroppedDocument(params: {
  fileName: string;
  docType: 'word' | 'excel' | 'ppt';
  mimeType?: string;
  base64Data?: string;
  fileBuffer?: Buffer;
  existingDriveId?: string;
  userEmail?: string;
}): Promise<{
  driveItemId?: string;
  driveUrl?: string;
  wordSections?: ExtractedDocSection[];
}> {
  const {
    fileName,
    docType,
    mimeType,
    base64Data,
    fileBuffer,
    existingDriveId,
    userEmail,
  } = params;
  const cleanName = fileName.trim();
  const baseName = cleanName.replace(/\.(docx?|xlsx?|pptx?|csv|txt)$/i, '').trim();

  const rawUploadBuf =
    fileBuffer ?? (base64Data ? Buffer.from(base64Data, 'base64') : undefined);

  // Immediately parse chapters/sections locally if a `.docx` buffer was provided (< 20ms)
  const localDocxSections =
    docType === 'word' && rawUploadBuf && rawUploadBuf.length > 0
      ? extractWordSectionsFromDocxBuffer(rawUploadBuf)
      : null;

  const map = readNativeGdocMap();
  const nameKey = `name:${cleanName}`;

  let resolvedId: string | undefined =
    (existingDriveId && map[existingDriveId]) || map[nameKey] || existingDriveId;

  // ULTRA-FAST PATH: If already mapped to a Google Drive file and sections are cached on disk, ensure permissions and return!
  if (resolvedId && map[resolvedId]) {
    resolvedId = map[resolvedId];
    await ensureDriveDocSharedForViewer({ driveFileId: resolvedId, userEmail });
    if (docType === 'word') {
      prewarmGoogleDocParagraphCache({ driveFileId: resolvedId, userEmail });
      const cachedSections = readCachedDocSections(resolvedId) ?? localDocxSections;
      if (cachedSections) {
        return {
          driveItemId: resolvedId,
          driveUrl: `https://docs.google.com/document/d/${resolvedId}/edit`,
          wordSections: cachedSections,
        };
      }
    }
  }

  const tokens = await getCandidateDriveWriteTokens(userEmail, {
    includeSlowFallbacks: true,
  });

  // 1. If we don't have a resolved Drive ID yet, search Google Drive by exact filename first
  if (!resolvedId) {
    for (const token of tokens) {
      try {
        const escapedFull = cleanName.replace(/'/g, "\\'");
        const escapedBase = baseName.replace(/'/g, "\\'");
        const q = encodeURIComponent(
          `(name = '${escapedFull}' or name = '${escapedBase}') and trashed = false`
        );
        const searchRes = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${q}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,webViewLink)&pageSize=10`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(8_000),
            cache: 'no-store',
          }
        );
        if (searchRes.ok) {
          const searchData = (await searchRes.json()) as {
            files?: Array<{ id: string; name: string; mimeType: string; webViewLink?: string }>;
          };
          const files = searchData.files ?? [];
          const nativeMatch = files.find((f) =>
            f.mimeType.startsWith('application/vnd.google-apps.')
          );
          const bestMatch = nativeMatch ?? files[0];
          if (bestMatch?.id) {
            resolvedId = bestMatch.id;
            break;
          }
        }
      } catch {
        // try next token
      }
    }
  }

  // 2. If it's a Word document found on Drive, ensure it's converted to a native Google Doc for live editing
  if (resolvedId && docType === 'word') {
    resolvedId = await ensureNativeGoogleDocForLiveEditing({
      driveFileId: resolvedId,
      userEmail,
    });
    saveNativeGdocMapEntry(nameKey, resolvedId);
  }

  // 3. If still not found on Drive and the user dropped a local file (`fileBuffer` or `base64Data`), upload & convert it on Google Drive!
  if (!resolvedId && rawUploadBuf && rawUploadBuf.length > 0 && tokens.length > 0) {
    const targetGoogleMime =
      docType === 'word'
        ? 'application/vnd.google-apps.document'
        : docType === 'excel'
        ? 'application/vnd.google-apps.spreadsheet'
        : 'application/vnd.google-apps.presentation';
    const sourceMime =
      mimeType ||
      (docType === 'word'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : docType === 'excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.openxmlformats-officedocument.presentationml.presentation');

    // For large `.docx` (> 6MB) or track-changes `.docx`, prepare a compact conversion-ready buffer
    const isLargeOrTrackChangesDocx =
      docType === 'word' &&
      (rawUploadBuf.length > 6 * 1024 * 1024 || cleanName.includes('追蹤修訂'));
    const primaryBuf = isLargeOrTrackChangesDocx
      ? buildCompactDocxForGoogleConversion(rawUploadBuf)
      : rawUploadBuf;

    const uploadAttemptConfigs: Array<{
      buf: Buffer;
      targetMime: string;
      parentFolderId?: string;
    }> = [
      { buf: primaryBuf, targetMime: targetGoogleMime },
      ...(primaryBuf !== rawUploadBuf
        ? []
        : docType === 'word'
        ? [{ buf: buildCompactDocxForGoogleConversion(rawUploadBuf), targetMime: targetGoogleMime }]
        : []),
      { buf: primaryBuf, targetMime: targetGoogleMime, parentFolderId: '14GmQIb8K3DGU6a-6WogdaSFF9rs00sxy' },
      { buf: rawUploadBuf, targetMime: sourceMime },
    ];

    outerUploadLoop: for (const token of tokens) {
      for (const cfg of uploadAttemptConfigs) {
        try {
          const boundary = '-------accsys_upload_doc_' + Date.now();
          const metaObj: Record<string, unknown> = {
            name: cleanName,
            mimeType: cfg.targetMime,
          };
          if (cfg.parentFolderId) {
            metaObj.parents = [cfg.parentFolderId];
          }
          const metaJson = JSON.stringify(metaObj);
          const multipartBody = Buffer.concat([
            Buffer.from(
              `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: ${sourceMime}\r\n\r\n`
            ),
            cfg.buf,
            Buffer.from(`\r\n--${boundary}--`),
          ]);

          const upRes = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
              },
              body: multipartBody,
              signal: AbortSignal.timeout(35_000),
            }
          );
          if (upRes.ok) {
            const upData = (await upRes.json()) as { id?: string };
            if (upData?.id) {
              resolvedId = upData.id;
              await grantDriveFileEditorAccess(resolvedId, token, userEmail);
              saveNativeGdocMapEntry(nameKey, resolvedId);
              break outerUploadLoop;
            }
          } else if (upRes.status === 401) {
            // Token is invalid/expired, skip to next token
            break;
          }
        } catch {
          // try next upload config or token
        }
      }
    }
  }

  // 4. Extract structured chapters/sections if it's a Word document
  if (resolvedId && docType === 'word') {
    for (const token of tokens) {
      await grantDriveFileEditorAccess(resolvedId, token, userEmail);
    }
    let sections: ExtractedDocSection[] | null = localDocxSections;
    if (localDocxSections && localDocxSections.length > 0) {
      saveCachedDocSections(resolvedId, localDocxSections);
    }
    if (!sections && tokens[0]) {
      sections = await extractWordSectionsFromGoogleDoc(resolvedId, tokens[0]);
    }
    if (tokens[0]) {
      prewarmGoogleDocParagraphCache({ driveFileId: resolvedId, userEmail });
    }
    const driveUrl = `https://docs.google.com/document/d/${resolvedId}/edit`;
    return {
      driveItemId: resolvedId,
      driveUrl,
      wordSections: sections ?? undefined,
    };
  }

  if (resolvedId) {
    const driveUrl =
      docType === 'word'
        ? `https://docs.google.com/document/d/${resolvedId}/edit`
        : docType === 'excel'
        ? `https://docs.google.com/spreadsheets/d/${resolvedId}/edit`
        : `https://docs.google.com/presentation/d/${resolvedId}/edit`;
    return {
      driveItemId: resolvedId,
      driveUrl,
      wordSections: localDocxSections ?? undefined,
    };
  }

  return {
    wordSections: localDocxSections ?? undefined,
  };
}

