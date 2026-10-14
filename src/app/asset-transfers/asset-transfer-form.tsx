'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Field, FieldRow, Info, Req, inputCls, readOnlyCls } from '@/app/components/form-fields';
import { AddRowButton, TrashButton, cellInputCls, tdCls, thCls } from '@/app/components/line-item-table';
import { PendingFilesField } from '@/app/components/pending-files-field';
import { reviseAssetTransfer, submitAssetTransfer } from '@/lib/asset-transfers/actions';
import {
  ASSET_REGISTER_LINK,
  ASSET_STATUS_LABELS,
  ASSET_TRANSFER_TYPES,
  ASSET_TRANSFER_TYPE_LABELS,
  MAX_ASSET_TRANSFER_LINES,
  MAX_LOCATION_LENGTH,
  type AssetTransferType,
} from '@/lib/asset-transfers/constants';
import type { AssetOption, EmployeeOption, UsageBudgetOption } from '@/lib/asset-transfers/queries';
import {
  checkCustodianCoverage,
  parseAssetTransferInput,
  type AssetTransferInput,
  type AssetTransferItemInput,
} from '@/lib/asset-transfers/validate';

export type AssetTransferFormMode =
  | { kind: 'create' }
  | { kind: 'update' | 'resubmit'; transferId: string; version: number; existingAttachmentCount: number };

type Party = 'originalCustodianEmployeeId' | 'newCustodianEmployeeId' | 'otherCustodianEmployeeId';

const fmtDate = (iso: string) => iso.replaceAll('-', '/');
const emptyItem = (newCustodianEmployeeId = '', reason = ''): AssetTransferItemInput => ({
  assetId: '',
  reason,
  newCustodianEmployeeId,
  newLocation: '',
});

function Instructions() {
  return (
    <section className="border-b border-dashed border-td-border px-5 py-5 text-sm leading-6 text-td-blue-dark">
      <h2 className="mb-3 font-semibold">資產異動單填表說明</h2>
      <p>一、異動類型說明：</p>
      <ol className="list-decimal pl-5">
        <li>保管人異動：人員離職、職務交接、資產領用至專案等需移轉保管人之情形。</li>
        <li>借出：借給外部單位，將於資產清冊註記「出借中」。需請外部單位出具相關證明。</li>
        <li>合併：非列帳資產(低於8萬以下資產,例如：超音波雷達、IMU…等)安裝於車輛且未來不再拆下，即可併入車輛中，不列入年度盤點範圍。</li>
        <li>出售：資產經核准後出售給客戶或第三方，將於資產清冊註記「已出售」不列入年度盤點範圍。</li>
        <li>報廢：設備損壞需報廢處理。填單後請保留資產，由管理部統一處理。</li>
        <li>其他：非上述情境之異動，請於備註欄位補充說明原因。</li>
      </ol>
      <p className="mt-3">二、填表流程與注意事項：</p>
      <ol className="list-decimal pl-5">
        <li>填表前請核對設備上的「財產編號」標籤，確保編號與品名正確無誤。</li>
        <li>時效性：請於異動發生後7個工作日內，完成填表送交管理部，以維持清冊即時性。</li>
      </ol>
      <p className="mt-3">三、資產盤點清冊：</p>
      <p>
        {ASSET_REGISTER_LINK.label}
        <br />
        <a href={ASSET_REGISTER_LINK.url} target="_blank" rel="noreferrer" className="break-all text-td-blue hover:underline">
          {ASSET_REGISTER_LINK.url}
        </a>
      </p>
      <p className="mt-3">四、備註：若財產標籤損毀、脫落，保管人應主動通知總務補發並重新張貼，嚴禁擅自塗改或撕除。</p>
    </section>
  );
}

function PersonSelect({
  value,
  onChange,
  employees,
  label,
  optional,
  className = inputCls,
}: {
  value: string;
  onChange: (id: string) => void;
  employees: EmployeeOption[];
  label: string;
  optional?: boolean;
  className?: string;
}) {
  const groups = [...new Set(employees.map((e) => e.departmentName))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={`${className} !bg-white`}>
      <option value="">{optional ? '（無）' : '請選擇'}</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {employees
            .filter((e) => e.departmentName === g)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export function AssetTransferForm({
  applicantName,
  applicationDate,
  departments,
  budgetOptions,
  employees,
  assets,
  mode,
  initial,
}: {
  applicantName: string;
  applicationDate: string;
  departments: { id: string; name: string }[];
  budgetOptions: UsageBudgetOption[];
  employees: EmployeeOption[];
  assets: AssetOption[];
  mode: AssetTransferFormMode;
  initial: Pick<AssetTransferInput, 'departmentId'> & Partial<AssetTransferInput>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<AssetTransferInput>({
    departmentId: initial.departmentId,
    useDepartmentId: initial.useDepartmentId ?? '',
    useBudgetCodeId: initial.useBudgetCodeId ?? '',
    transferTypes: initial.transferTypes ?? [],
    remark: initial.remark ?? '',
    items: initial.items ?? [emptyItem()],
    originalCustodianEmployeeId: initial.originalCustodianEmployeeId ?? '',
    newCustodianEmployeeId: initial.newCustodianEmployeeId ?? '',
    otherCustodianEmployeeId: initial.otherCustodianEmployeeId ?? '',
  });
  const [photos, setPhotos] = useState<File[]>([]);
  const [otherFiles, setOtherFiles] = useState<File[]>([]);
  // One key per form instance: a double submit or retry cannot create a second form.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const existingAttachments = mode.kind === 'create' ? 0 : mode.existingAttachmentCount;
  const assetById = new Map(assets.map((a) => [a.id, a]));
  /** The server assigns the same manager: that of the custodian's department. */
  const unitManagerName = (custodianId: string) => {
    if (custodianId === '') return '';
    const managerId = employees.find((e) => e.id === custodianId)?.managerId;
    if (!managerId) return '（所屬部門未設定主管）';
    return employees.find((e) => e.id === managerId)?.name ?? '（主管帳號已停用）';
  };
  const checked = form.transferTypes as AssetTransferType[];

  const set = (patch: Partial<AssetTransferInput>) => setForm((prev) => ({ ...prev, ...patch }));

  const setParty = (party: Party, id: string) =>
    setForm((prev) => {
      const previous = prev[party];
      const next: AssetTransferInput = { ...prev, [party]: id };
      if (party === 'newCustodianEmployeeId') {
        next.items = prev.items.map((r) =>
          r.newCustodianEmployeeId === '' || r.newCustodianEmployeeId === previous ? { ...r, newCustodianEmployeeId: id } : r
        );
      }
      return next;
    });

  const toggleType = (type: AssetTransferType) =>
    setForm((prev) => {
      const on = prev.transferTypes.includes(type);
      const types = ASSET_TRANSFER_TYPES.filter((t) => (t === type ? !on : prev.transferTypes.includes(t)));
      const items = prev.items.map((r) =>
        (types as string[]).includes(r.reason) ? r : { ...r, reason: types.length === 1 ? types[0] : '' }
      );
      return { ...prev, transferTypes: types, items };
    });

  const setItem = (i: number, patch: Partial<AssetTransferItemInput>) =>
    setForm((prev) => ({ ...prev, items: prev.items.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));

  const pickAsset = (i: number, assetId: string) => {
    const asset = assetById.get(assetId);
    setItem(i, { assetId, newLocation: asset?.location ?? '' });
    if (asset && form.originalCustodianEmployeeId === '') setParty('originalCustodianEmployeeId', asset.custodianId);
  };

  const onSubmit = async () => {
    setError(null);
    const parsed = parseAssetTransferInput(form);
    if (!parsed.ok) return setError(parsed.error);
    const coverage = checkCustodianCoverage(
      parsed.value,
      (id) => assetById.get(id)?.custodianId ?? '',
      (id) => assetById.get(id)?.tag ?? ''
    );
    if (coverage) return setError(coverage);
    if (mode.kind === 'create' && photos.length === 0) return setError('請上傳資產照片（需拍到「財產編號」及「完整資產外觀」）');

    const formData = new FormData();
    formData.set('payload', JSON.stringify(mode.kind === 'create' ? { ...form, idempotencyKey } : { ...form, expectedVersion: mode.version }));
    for (const f of photos) formData.append('photos', f);
    for (const f of otherFiles) formData.append('files', f);

    setSubmitting(true);
    const result =
      mode.kind === 'create' ? await submitAssetTransfer(formData) : await reviseAssetTransfer(mode.transferId, mode.kind, formData);
    if (!result.ok) {
      setSubmitting(false);
      setError(result.error);
      return;
    }
    const failed = result.attachmentErrors.length;
    router.push(`/asset-transfers/${result.transferId}${failed > 0 ? `?uploadFailed=${failed}` : ''}`);
  };

  const submitLabel = mode.kind === 'create' ? '確認送出' : mode.kind === 'update' ? '儲存修改並重新送簽' : '重新送出';
  const pickedIds = new Set(form.items.map((r) => r.assetId));

  return (
    <div className="card !p-0">
      <h1 className="border-b border-td-border px-5 py-4 text-xl font-bold text-td-blue-dark">資產異動申請單</h1>
      <Instructions />

      <div className="grid divide-y divide-dashed divide-td-border md:grid-cols-3 md:divide-x md:divide-y-0">
        <Field label="申請日期" required>
          <input value={fmtDate(applicationDate)} readOnly className={readOnlyCls} />
        </Field>
        <Field label="申請人" required>
          <input value={applicantName} readOnly className={readOnlyCls} />
        </Field>
        <Field label="申請人部門" required hint="如為經辦請記得調整申請人部門">
          <select value={form.departmentId} onChange={(e) => set({ departmentId: e.target.value })} className={`${inputCls} !bg-white`}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <FieldRow cols={2}>
        <Field label="使用部門" required>
          <select
            value={form.useDepartmentId}
            onChange={(e) => set({ useDepartmentId: e.target.value })}
            aria-label="使用部門"
            className={`${inputCls} !bg-white`}
          >
            <option value="">請選擇部門</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="使用專案/客戶名稱" required>
          <select
            value={form.useBudgetCodeId}
            onChange={(e) => set({ useBudgetCodeId: e.target.value })}
            aria-label="使用專案/客戶名稱"
            className={`${inputCls} !bg-white`}
          >
            <option value="">請選擇</option>
            {budgetOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
      </FieldRow>

      <FieldRow cols={2}>
        <Field label="異動說明 (可複選)" required>
          <div className="space-y-3">
            {ASSET_TRANSFER_TYPES.map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-2 text-sm text-td-blue-dark">
                <input
                  type="checkbox"
                  checked={checked.includes(t)}
                  onChange={() => toggleType(t)}
                  className="h-4 w-4 rounded border-td-border text-td-blue focus:ring-td-blue/30"
                />
                {t === 'other' ? '其他：請於備註欄補充說明' : ASSET_TRANSFER_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </Field>
        <Field label="備註">
          <textarea
            value={form.remark}
            onChange={(e) => set({ remark: e.target.value })}
            placeholder="請輸入文字"
            rows={4}
            className={`${inputCls} resize-y`}
          />
        </Field>
      </FieldRow>

      <section className="border-t border-dashed border-td-border px-5 py-6">
        <h2 className="text-sm font-semibold text-td-blue-dark">申請資料</h2>
        <p className="mb-3 mt-1 text-xs text-td-muted">請申請人確認財產編號是否正確，表單會帶入財產名稱、數量及原保管人之選項。</p>
        {assets.length === 0 && (
          <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">財產清冊目前沒有可異動的財產，請聯絡管理部建立財產資料。</p>
        )}
        <div className="overflow-x-auto pb-1">
          <table className="w-full min-w-[1100px] border-collapse">
            <thead>
              <tr>
                <th className={`${thCls} w-10`} />
                <th className={`${thCls} w-10`}>#</th>
                <th className={`${thCls} w-44`}>
                  財產編號(保管狀態)<Req />
                </th>
                <th className={thCls}>
                  財產名稱<Req />
                </th>
                <th className={`${thCls} w-16`}>
                  數量<Req />
                </th>
                <th className={`${thCls} w-28`}>
                  原保管人<Req />
                </th>
                <th className={`${thCls} w-32`}>
                  異動原因<Req />
                </th>
                <th className={`${thCls} w-36`}>
                  新保管人員<Req />
                  <Info text="異動後負責保管的人員，需為下方的新保管人或其他保管人；沒有異動保管人時請選原保管人。" />
                </th>
                <th className={`${thCls} w-44`}>
                  新保管地點<Req />
                  <Info text={`異動後的存放地點，例如：總部 3F 研發區、客戶名稱；沒有變更請沿用原地點。最多 ${MAX_LOCATION_LENGTH} 字。`} />
                </th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((r, i) => {
                const asset = assetById.get(r.assetId);
                return (
                  <tr key={i}>
                    <td className={`${tdCls} text-center`}>
                      <TrashButton
                        onClick={() => set({ items: form.items.filter((_, idx) => idx !== i) })}
                        disabled={form.items.length === 1}
                      />
                    </td>
                    <td className={`${tdCls} text-center text-sm text-td-muted`}>{i + 1}</td>
                    <td className={tdCls}>
                      <select
                        value={r.assetId}
                        onChange={(e) => pickAsset(i, e.target.value)}
                        aria-label={`第 ${i + 1} 列財產編號`}
                        className={`${cellInputCls} !bg-white`}
                      >
                        <option value="">請選擇</option>
                        {assets
                          .filter((a) => a.id === r.assetId || !pickedIds.has(a.id))
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.tag}({ASSET_STATUS_LABELS[a.status]})
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className={tdCls}>
                      <input value={asset?.name ?? ''} readOnly placeholder="選擇財產編號後帶入" className={`${cellInputCls} !bg-slate-100`} />
                    </td>
                    <td className={tdCls}>
                      <input value={asset?.quantity ?? ''} readOnly className={`${cellInputCls} !bg-slate-100 text-center`} />
                    </td>
                    <td className={tdCls}>
                      <input value={asset?.custodianName ?? ''} readOnly className={`${cellInputCls} !bg-slate-100`} />
                    </td>
                    <td className={tdCls}>
                      <select
                        value={r.reason}
                        onChange={(e) => setItem(i, { reason: e.target.value })}
                        disabled={checked.length === 0}
                        aria-label={`第 ${i + 1} 列異動原因`}
                        className={`${cellInputCls} !bg-white`}
                      >
                        <option value="">{checked.length === 0 ? '請先勾選異動說明' : '請選擇'}</option>
                        {checked.map((t) => (
                          <option key={t} value={t}>
                            {ASSET_TRANSFER_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={tdCls}>
                      <PersonSelect
                        value={r.newCustodianEmployeeId}
                        onChange={(id) => setItem(i, { newCustodianEmployeeId: id })}
                        employees={employees}
                        label={`第 ${i + 1} 列新保管人員`}
                        className={cellInputCls}
                      />
                    </td>
                    <td className={tdCls}>
                      <input
                        value={r.newLocation}
                        onChange={(e) => setItem(i, { newLocation: e.target.value })}
                        maxLength={MAX_LOCATION_LENGTH}
                        placeholder={`最多${MAX_LOCATION_LENGTH}字`}
                        aria-label={`第 ${i + 1} 列新保管地點`}
                        className={cellInputCls}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <AddRowButton
          onClick={() => set({ items: [...form.items, emptyItem(form.newCustodianEmployeeId, checked.length === 1 ? checked[0] : '')] })}
          disabled={form.items.length >= MAX_ASSET_TRANSFER_LINES}
        />
      </section>

      <FieldRow cols={3}>
        <Field label="原保管人" required hint="請務必填寫原保管人，系統將於資產異動時自動發送簽核通知。">
          <PersonSelect
            value={form.originalCustodianEmployeeId}
            onChange={(id) => setParty('originalCustodianEmployeeId', id)}
            employees={employees}
            label="原保管人"
          />
        </Field>
        <Field label="新保管人" required hint="請務必填寫新保管人，系統將於資產異動時自動發送簽核通知。若沒有異動保管人，請填入「原保管人」即可。">
          <PersonSelect
            value={form.newCustodianEmployeeId}
            onChange={(id) => setParty('newCustodianEmployeeId', id)}
            employees={employees}
            label="新保管人"
          />
        </Field>
        <Field label="其他保管人" hint="如有其他保管人，請務必填寫。系統將於資產異動時自動發送簽核通知。">
          <PersonSelect
            value={form.otherCustodianEmployeeId}
            onChange={(id) => setParty('otherCustodianEmployeeId', id)}
            employees={employees}
            label="其他保管人"
            optional
          />
        </Field>
      </FieldRow>

      <FieldRow cols={3}>
        <Field label="原保管單位主管" hint="依原保管人所屬部門自動帶入，系統將於資產異動時自動發送簽核通知。">
          <input value={unitManagerName(form.originalCustodianEmployeeId)} readOnly aria-label="原保管單位主管" className={readOnlyCls} />
        </Field>
        <Field label="新保管單位主管" hint="依新保管人所屬部門自動帶入，系統將於資產異動時自動發送簽核通知。">
          <input value={unitManagerName(form.newCustodianEmployeeId)} readOnly aria-label="新保管單位主管" className={readOnlyCls} />
        </Field>
        <Field label="其他保管單位主管" hint="依其他保管人所屬部門自動帶入。">
          <input value={unitManagerName(form.otherCustodianEmployeeId)} readOnly aria-label="其他保管單位主管" className={readOnlyCls} />
        </Field>
      </FieldRow>

      <div className="border-t border-dashed border-td-border">
        <Field label="資產照片" required={mode.kind === 'create'} hint="需拍到「財產編號」及「完整資產外觀」，建議拍1~3張照片。">
          <div aria-label="資產照片">
            <PendingFilesField files={photos} onChange={setPhotos} existingCount={existingAttachments} />
          </div>
        </Field>
      </div>

      <div className="border-t border-dashed border-td-border">
        <Field label="其他附件" hint="如借給外部單位，需請外部單位出具相關證明。">
          <div aria-label="其他附件">
            <PendingFilesField files={otherFiles} onChange={setOtherFiles} />
          </div>
        </Field>
      </div>

      <div className="flex flex-col items-center gap-3 border-t border-dashed border-td-border px-5 py-8">
        {error && <p className="w-full max-w-xl rounded bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || assets.length === 0}
          className="btn-primary min-w-[160px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '送出中…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
