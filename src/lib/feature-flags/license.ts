import crypto from 'node:crypto';
import {
  ALL_FEATURE_FLAG_KEYS,
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_DEFINITIONS,
  type FeatureFlagKey,
  type FeatureFlagMap,
} from './definitions';

export type VerifiedLicenseInfo = {
  licenseKey: string;
  planName: string;
  issuedTo: string;
  licensedModules: FeatureFlagKey[];
  startsAt: string;
  expiresAt: string;
  issuedAt: string;
  remainingDays: number | null;
  isNotYetStarted: boolean;
  isExpired: boolean;
  isDefaultLicense: boolean;
};

const BASE32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars (無易混淆 0/O/1/I)
const EPOCH_MS = Date.UTC(2020, 0, 1); // 2020-01-01 UTC
const PERMANENT_DAY_VALUE = 0xffff;
const PAYLOAD_MAGIC = 0xa000;

export function getLicenseSigningSecret(): string {
  return (
    process.env.ACCSYS_LICENSE_SECRET?.trim() ||
    process.env.LICENSE_SIGNING_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    'accsys-enterprise-license-hmac-secret-2026-turing-drive'
  );
}

export function encodeModulesBitmaskNumber(modules: FeatureFlagKey[]): number {
  const set = new Set<FeatureFlagKey>(modules);
  let mask = 0;
  FEATURE_FLAG_DEFINITIONS.forEach((def, idx) => {
    if (set.has(def.key)) {
      mask |= 1 << idx;
    }
  });
  return mask & 0x0fff;
}

export function decodeModulesBitmaskNumber(mask: number): FeatureFlagKey[] {
  const result: FeatureFlagKey[] = [];
  FEATURE_FLAG_DEFINITIONS.forEach((def, idx) => {
    if ((mask & (1 << idx)) !== 0) {
      result.push(def.key);
    }
  });
  return result;
}

function isoDateToEpochDays(iso: string): number | null {
  if (iso === 'PERMANENT') return PERMANENT_DAY_VALUE;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(utcMs)) return null;
  const days = Math.round((utcMs - EPOCH_MS) / 86400000);
  if (days < 0 || days >= PERMANENT_DAY_VALUE) return null;
  return days;
}

function epochDaysToIsoDate(days: number): string | null {
  if (days === PERMANENT_DAY_VALUE) return 'PERMANENT';
  if (days < 0 || days > PERMANENT_DAY_VALUE) return null;
  const d = new Date(EPOCH_MS + days * 86400000);
  return d.toISOString().slice(0, 10);
}

function encodeBase32Bytes(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function decodeBase32Bytes(str: string): Buffer | null {
  const clean = str.replace(/[^A-Z2-9]/g, '');
  if (clean.length !== 24) return null;
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function deriveKeystream(nonce: Buffer): Buffer {
  return crypto
    .createHmac('sha256', getLicenseSigningSecret())
    .update('ACCSYS-ENC-v3:')
    .update(nonce)
    .digest()
    .subarray(0, 6);
}

function computeMacTag(nonce: Buffer, ciphertext: Buffer): Buffer {
  return crypto
    .createHmac('sha256', getLicenseSigningSecret())
    .update('ACCSYS-MAC-v3:')
    .update(nonce)
    .update(ciphertext)
    .digest()
    .subarray(0, 6);
}

export function computeRemainingDays(expiresAt: string): number | null {
  if (!expiresAt || expiresAt === 'PERMANENT') return null;
  const expDate = new Date(`${expiresAt}T23:59:59.999+08:00`);
  if (Number.isNaN(expDate.getTime())) return null;
  const diffMs = expDate.getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * 簽發高強度混淆加密授權碼（120-bit 流加密 + HMAC-SHA256 驗證標籤）
 * 外觀格式：ACCSYS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
 * 完全隱藏生效日、到期日、是否永久與模組遮罩，外部無法從字串看出任何明文資訊。
 */
export function generateLicenseKey(input: {
  planName?: string;
  issuedTo?: string;
  licensedModules: FeatureFlagKey[];
  startsAt?: string;
  expiresAt?: string;
  issuedAt?: string;
  deterministicNonce?: boolean;
}): string {
  const validSet = new Set<FeatureFlagKey>(ALL_FEATURE_FLAG_KEYS);
  const cleanModules = Array.from(
    new Set(input.licensedModules.filter((k) => validSet.has(k)))
  );
  const today = new Date().toISOString().slice(0, 10);
  const startsAt = input.startsAt?.trim() || today;
  const expiresAt = input.expiresAt?.trim() || 'PERMANENT';

  const startDays = isoDateToEpochDays(startsAt) ?? isoDateToEpochDays(today)!;
  const endDays = isoDateToEpochDays(expiresAt) ?? PERMANENT_DAY_VALUE;
  const maskWithMagic = PAYLOAD_MAGIC | encodeModulesBitmaskNumber(cleanModules);

  const plain = Buffer.alloc(6);
  plain.writeUInt16BE(startDays, 0);
  plain.writeUInt16BE(endDays, 2);
  plain.writeUInt16BE(maskWithMagic, 4);

  const nonce = input.deterministicNonce
    ? crypto
        .createHmac('sha256', getLicenseSigningSecret())
        .update('ACCSYS-DEFAULT-NONCE-v3:')
        .update(plain)
        .digest()
        .subarray(0, 3)
    : crypto.randomBytes(3);

  const keystream = deriveKeystream(nonce);
  const ciphertext = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    ciphertext[i] = plain[i] ^ keystream[i];
  }

  const tag = computeMacTag(nonce, ciphertext);
  const packet = Buffer.concat([nonce, ciphertext, tag]); // 15 bytes = 120 bits = 24 Base32 chars
  const b32 = encodeBase32Bytes(packet);
  const groups = b32.match(/.{1,4}/g) || [b32];
  return `ACCSYS-${groups.join('-')}`;
}

/**
 * 解密並驗證加密授權碼（ACCSYS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX）
 */
export function verifyLicenseKey(
  rawKey: string
):
  | { ok: true; license: VerifiedLicenseInfo; flags: FeatureFlagMap }
  | { ok: false; error: string } {
  const trimmed = (rawKey || '').trim().toUpperCase();
  if (!trimmed) {
    return { ok: false, error: '請輸入授權碼' };
  }

  const m = trimmed.match(
    /^ACCSYS-([A-Z2-9]{4})-([A-Z2-9]{4})-([A-Z2-9]{4})-([A-Z2-9]{4})-([A-Z2-9]{4})-([A-Z2-9]{4})$/
  );
  if (!m) {
    return {
      ok: false,
      error:
        '授權碼格式錯誤：請輸入有效的加密授權碼（格式：ACCSYS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX）',
    };
  }

  const b32 = m.slice(1).join('');
  const packet = decodeBase32Bytes(b32);
  if (!packet || packet.length !== 15) {
    return { ok: false, error: '授權碼解碼失敗。' };
  }

  const nonce = packet.subarray(0, 3);
  const ciphertext = packet.subarray(3, 9);
  const providedTag = packet.subarray(9, 15);
  const expectedTag = computeMacTag(nonce, ciphertext);

  if (!crypto.timingSafeEqual(providedTag, expectedTag)) {
    return {
      ok: false,
      error: '授權碼防偽簽章驗證失敗！請確認授權碼是否正確或遭竄改。',
    };
  }

  const keystream = deriveKeystream(nonce);
  const plain = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    plain[i] = ciphertext[i] ^ keystream[i];
  }

  const startDays = plain.readUInt16BE(0);
  const endDays = plain.readUInt16BE(2);
  const maskWithMagic = plain.readUInt16BE(4);

  if ((maskWithMagic & 0xf000) !== PAYLOAD_MAGIC) {
    return { ok: false, error: '授權碼內部結構驗證失敗。' };
  }

  const startsAt = epochDaysToIsoDate(startDays);
  const expiresAt = epochDaysToIsoDate(endDays);
  if (!startsAt || !expiresAt) {
    return { ok: false, error: '授權碼日期區間無效。' };
  }

  const licensedModules = decodeModulesBitmaskNumber(maskWithMagic & 0x0fff);

  let isNotYetStarted = false;
  const startDate = new Date(`${startsAt}T00:00:00.000+08:00`);
  if (!Number.isNaN(startDate.getTime()) && Date.now() < startDate.getTime()) {
    isNotYetStarted = true;
  }

  if (isNotYetStarted) {
    return {
      ok: false,
      error: `此授權碼尚未到生效日期（將於 ${startsAt} 開始生效，可使用至 ${expiresAt}）。`,
    };
  }

  let isExpired = false;
  if (expiresAt !== 'PERMANENT') {
    const expDate = new Date(`${expiresAt}T23:59:59.999+08:00`);
    if (!Number.isNaN(expDate.getTime()) && expDate.getTime() < Date.now()) {
      isExpired = true;
    }
  }

  if (isExpired) {
    return {
      ok: false,
      error: `此授權碼已於 ${expiresAt} 截止失效（授權期間：${startsAt} ～ ${expiresAt}），請重新簽發授權碼。`,
    };
  }

  const licensedSet = new Set<FeatureFlagKey>(licensedModules);
  const flags: FeatureFlagMap = FEATURE_FLAG_DEFINITIONS.reduce((acc, def) => {
    acc[def.key] = licensedSet.has(def.key);
    return acc;
  }, {} as FeatureFlagMap);

  const planName =
    expiresAt === 'PERMANENT'
      ? `永久授權（開通 ${licensedModules.length}/${FEATURE_FLAG_DEFINITIONS.length} 項模組）`
      : `定期授權（開通 ${licensedModules.length}/${FEATURE_FLAG_DEFINITIONS.length} 項模組）`;

  return {
    ok: true,
    license: {
      licenseKey: trimmed,
      planName,
      issuedTo: 'ACCSYS',
      licensedModules,
      startsAt,
      expiresAt,
      issuedAt: startsAt,
      remainingDays: computeRemainingDays(expiresAt),
      isNotYetStarted: false,
      isExpired: false,
      isDefaultLicense: false,
    },
    flags,
  };
}

/**
 * 系統預設永久授權碼：除「專案助手」預設關閉外，其餘 10 項功能皆永久授權開啟
 */
export function getDefaultStandardLicense(): VerifiedLicenseInfo {
  const defaultModules = FEATURE_FLAG_DEFINITIONS.filter(
    (d) => d.defaultEnabled
  ).map((d) => d.key);

  const startsAt = '2026-11-19';
  const expiresAt = 'PERMANENT';

  const licenseKey = generateLicenseKey({
    licensedModules: defaultModules,
    startsAt,
    expiresAt,
    deterministicNonce: true,
  });

  return {
    licenseKey,
    planName: `永久授權（開通 ${defaultModules.length}/${FEATURE_FLAG_DEFINITIONS.length} 項模組）`,
    issuedTo: 'ACCSYS',
    licensedModules: defaultModules,
    startsAt,
    expiresAt,
    issuedAt: startsAt,
    remainingDays: null,
    isNotYetStarted: false,
    isExpired: false,
    isDefaultLicense: false,
  };
}

export function deriveLicensedFlags(
  license: VerifiedLicenseInfo,
  manualOverrides?: Partial<FeatureFlagMap>
): FeatureFlagMap {
  const licensedSet = new Set<FeatureFlagKey>(license.licensedModules);
  const result: FeatureFlagMap = { ...DEFAULT_FEATURE_FLAGS };

  for (const def of FEATURE_FLAG_DEFINITIONS) {
    if (!licensedSet.has(def.key)) {
      result[def.key] = false;
    } else if (
      manualOverrides &&
      typeof manualOverrides[def.key] === 'boolean'
    ) {
      result[def.key] = Boolean(manualOverrides[def.key]);
    } else {
      result[def.key] = true;
    }
  }
  return result;
}
