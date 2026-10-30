'use client';

import { useState, type FormEvent } from 'react';
import { saveCompanyProfileAction } from '@/lib/company/actions';

export function CompanyForm({
  initial,
}: {
  initial: {
    legalName: string;
    taxId: string;
    address: string;
    nameAliases: string;
    active: boolean;
    version: number;
  } | null;
}) {
  const [legalName, setLegalName] = useState(initial?.legalName ?? '');
  const [taxId, setTaxId] = useState(initial?.taxId ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [nameAliases, setNameAliases] = useState(initial?.nameAliases ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    const result = await saveCompanyProfileAction({
      legalName,
      taxId,
      address,
      nameAliases: nameAliases
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      active,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(`已儲存（版本 ${result.profile.version}）`);
  };

  return (
    <form onSubmit={onSubmit} className="card max-w-xl space-y-4">
      {initial && (
        <p className="text-xs text-td-muted">目前版本：{initial.version}（歷史單據保留送件當時比對結果）</p>
      )}
      <label className="block space-y-1 text-sm">
        <span>公司正式名稱</span>
        <input className="w-full rounded border px-3 py-2" value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
      </label>
      <label className="block space-y-1 text-sm">
        <span>統一編號（8 碼）</span>
        <input
          className="w-full rounded border px-3 py-2"
          value={taxId}
          onChange={(e) => setTaxId(e.target.value)}
          inputMode="numeric"
          pattern="\d{8}"
          required
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>公司地址</span>
        <input className="w-full rounded border px-3 py-2" value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>可接受抬頭別名（每行一個）</span>
        <textarea className="w-full rounded border px-3 py-2" rows={3} value={nameAliases} onChange={(e) => setNameAliases(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        啟用
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {message && <p className="text-sm text-green-700">{message}</p>}
      <button type="submit" className="btn-primary" disabled={saving}>
        {saving ? '儲存中…' : '儲存公司資訊'}
      </button>
    </form>
  );
}
