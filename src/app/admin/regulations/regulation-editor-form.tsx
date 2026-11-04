'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  createRegulationAction,
  deleteRegulationAction,
  deleteRegulationAttachmentAction,
  updateRegulationAction,
  uploadRegulationAttachmentAction,
} from '@/lib/regulations/actions';
import { REGULATION_CATEGORIES } from '@/lib/regulations/seed-data';
import type { RegulationFileRow } from '@/lib/regulations/attachments';

export type RegulationFormInitial = {
  id?: string;
  code: string;
  title: string;
  category: string;
  versionLabel: string;
  effectiveDate: string;
  ownerDepartment: string;
  approverTitle: string;
  summary: string;
  body: string;
  relatedForms: string[];
  driveFileId?: string | null;
  driveUrl?: string | null;
  driveFileName?: string | null;
  status: 'draft' | 'published' | 'archived';
  pinned: boolean;
  sortOrder: number;
};

export function RegulationEditorForm(props: {
  mode: 'create' | 'edit';
  initial: RegulationFormInitial;
  attachments?: RegulationFileRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [code, setCode] = useState(props.initial.code);
  const [title, setTitle] = useState(props.initial.title);
  const [category, setCategory] = useState(props.initial.category || 'hr_attendance');
  const [versionLabel, setVersionLabel] = useState(props.initial.versionLabel || '1.0');
  const [effectiveDate, setEffectiveDate] = useState(props.initial.effectiveDate || '');
  const [ownerDepartment, setOwnerDepartment] = useState(props.initial.ownerDepartment || '管理部');
  const [approverTitle, setApproverTitle] = useState(props.initial.approverTitle || '董事長');
  const [summary, setSummary] = useState(props.initial.summary || '');
  const [body, setBody] = useState(props.initial.body || '');
  const [relatedFormsText, setRelatedFormsText] = useState(
    (props.initial.relatedForms ?? []).join('、')
  );
  const [driveUrl, setDriveUrl] = useState(props.initial.driveUrl ?? '');
  const [driveFileName, setDriveFileName] = useState(props.initial.driveFileName ?? '');
  const [status, setStatus] = useState<'draft' | 'published' | 'archived'>(
    props.initial.status || 'published'
  );
  const [pinned, setPinned] = useState(Boolean(props.initial.pinned));
  const [sortOrder, setSortOrder] = useState(String(props.initial.sortOrder ?? 50));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const relatedForms = relatedFormsText
      .split(/[,，、\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const payload = {
      code: code.trim() || 'TD-REG-001',
      title: title.trim(),
      category,
      versionLabel: versionLabel.trim() || '1.0',
      effectiveDate: effectiveDate.trim(),
      ownerDepartment: ownerDepartment.trim() || '管理部',
      approverTitle: approverTitle.trim() || '董事長',
      summary: summary.trim(),
      body: body.trim(),
      relatedForms,
      driveUrl: driveUrl.trim() || null,
      driveFileName: driveFileName.trim() || null,
      status,
      pinned,
      sortOrder: Number(sortOrder) || 50,
    };

    startTransition(async () => {
      if (props.mode === 'create') {
        const res = await createRegulationAction(payload);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.push(`/admin/regulations/${res.regulation.id}/edit?saved=1`);
        router.refresh();
      } else if (props.initial.id) {
        const res = await updateRegulationAction(props.initial.id, payload);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setNotice('已儲存規章變更，並已同步更新 AI 知識庫索引！');
        router.refresh();
      }
    });
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !props.initial.id) return;
    setError(null);
    setNotice(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await uploadRegulationAttachmentAction(props.initial.id, fd);
      if (!res.ok) {
        setError(res.error);
      } else {
        setNotice('附件已上傳。');
        router.refresh();
      }
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function handleDeleteAttachment(attachmentId: string) {
    if (!props.initial.id) return;
    startTransition(async () => {
      const res = await deleteRegulationAttachmentAction(props.initial.id!, attachmentId);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function handleDeleteRegulation() {
    if (!props.initial.id) return;
    if (!window.confirm(`確定要刪除「${title}」嗎？此操作無法復原。`)) return;
    startTransition(async () => {
      const res = await deleteRegulationAction(props.initial.id!);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push('/admin/regulations');
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="card space-y-5 p-6">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold text-td-text">
              規章編號 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="例如 TD-HR-001"
              className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 font-mono text-sm"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-td-text">
              規章名稱 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如 員工出差管理辦法"
              className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-td-text">規章分類</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm"
            >
              {REGULATION_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}（{c.description.slice(0, 18)}…）
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-td-text">版次</label>
            <input
              type="text"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              placeholder="例如 5.0"
              className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-td-text">核定／生效日期</label>
            <input
              type="text"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              placeholder="例如 2026-06-05"
              className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-semibold text-td-text">制定／權責單位</label>
            <input
              type="text"
              value={ownerDepartment}
              onChange={(e) => setOwnerDepartment(e.target.value)}
              placeholder="例如 管理部／人資單位"
              className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-td-text">核決層級</label>
            <input
              type="text"
              value={approverTitle}
              onChange={(e) => setApproverTitle(e.target.value)}
              placeholder="例如 董事長 / 總經理"
              className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-td-text">發布狀態</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'published' | 'archived')}
              className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm"
            >
              <option value="published">已發布（員工與 AI 皆可查閱）</option>
              <option value="draft">草稿（僅管理員可見）</option>
              <option value="archived">已封存（停用歷史規章）</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-td-text">排序權重（數字越小越前）</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            id="reg-pinned"
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="h-4 w-4 rounded border-td-border text-td-blue"
          />
          <label htmlFor="reg-pinned" className="text-sm font-medium text-td-text">
            設為「核心必讀規章」（置頂顯示於公司規章首頁）
          </label>
        </div>

        <div>
          <label className="block text-xs font-semibold text-td-text">
            相關使用表單（以頓號「、」或逗號分隔）
          </label>
          <input
            type="text"
            value={relatedFormsText}
            onChange={(e) => setRelatedFormsText(e.target.value)}
            placeholder="例如：公出差旅單、出差報告暨旅費報支單、費用申請單"
            className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-td-text">
              Google Drive 原始檔案連結（選填）
            </label>
            <input
              type="url"
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/..."
              className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-td-text">
              Google Drive 原始檔案名稱（選填）
            </label>
            <input
              type="text"
              value={driveFileName}
              onChange={(e) => setDriveFileName(e.target.value)}
              placeholder="例如 20250303_員工出差管理辦法.pdf"
              className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-td-text">
            重點摘要（供列表快速預覽與 AI 摘要索引）
          </label>
          <textarea
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="簡要說明本辦法的適用對象、核銷門檻、補助上限或關鍵規定…"
            className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm leading-relaxed"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-td-text">
            規章條文全文 <span className="text-rose-500">*</span>
          </label>
          <p className="mt-0.5 text-xs text-td-muted">
            儲存發布後，AI 助手將即時索引此條文內容，同仁詢問相關規定時可直接引用條文回答。
          </p>
          <textarea
            rows={18}
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="請貼上或輸入完整公司規章條文…"
            className="mt-1.5 w-full rounded-lg border border-td-border px-3.5 py-2.5 font-sans text-sm leading-6"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-td-border pt-4">
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className="btn-primary text-sm">
              {pending
                ? '儲存並同步 AI 知識庫中…'
                : props.mode === 'create'
                  ? '建立規章並同步 AI'
                  : '儲存變更並同步 AI'}
            </button>
          </div>
          {props.mode === 'edit' && props.initial.id && (
            <button
              type="button"
              disabled={pending}
              onClick={handleDeleteRegulation}
              className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
            >
              刪除此規章
            </button>
          )}
        </div>
      </form>

      {props.mode === 'edit' && props.initial.id && (
        <section className="card space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-td-blue-dark">附加檔案（PDF／表單範本）</h2>
              <p className="text-xs text-td-muted">
                除了連結 Google Drive 雲端檔案外，您也可直接上傳 PDF、Word、Excel 附表供同仁下載。
              </p>
            </div>
            <label className="btn-secondary cursor-pointer text-xs">
              {uploading ? '上傳中…' : '+ 上傳附件檔案'}
              <input
                type="file"
                className="hidden"
                disabled={uploading}
                onChange={handleFileUpload}
              />
            </label>
          </div>

          {props.attachments && props.attachments.length > 0 ? (
            <ul className="divide-y divide-td-border rounded-lg border border-td-border">
              {props.attachments.map((f) => (
                <li key={f.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="truncate pr-3">
                    <a
                      href={`/api/regulations/${props.initial.id}/attachments/${f.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-td-blue-dark hover:underline"
                    >
                      {f.fileName}
                    </a>
                    <span className="ml-2 text-xs text-td-muted">
                      ({Math.max(1, Math.round(f.fileSizeBytes / 1024))} KB)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteAttachment(f.id)}
                    className="text-xs font-medium text-rose-600 hover:underline"
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-td-muted">目前尚無額外上傳的本地附件。</p>
          )}
        </section>
      )}
    </div>
  );
}
