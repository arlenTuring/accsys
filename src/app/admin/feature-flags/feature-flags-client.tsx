'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmDialog } from '@/app/components/dialog';
import {
  applySystemLicenseKey,
  resetSystemFeatureFlagsToDefault,
  toggleSystemFeatureFlag,
} from '@/lib/feature-flags/actions';
import {
  FEATURE_FLAG_DEFINITIONS,
  type FeatureFlagCategory,
  type FeatureFlagKey,
  type FeatureFlagMap,
} from '@/lib/feature-flags/definitions';
import type { VerifiedLicenseInfo } from '@/lib/feature-flags/license';
import type { FeatureFlagAuditItem } from '@/lib/feature-flags/service';

export function FeatureFlagsClient({
  initialLicense,
  initialFlags,
  initialHistory,
}: {
  initialLicense: VerifiedLicenseInfo;
  initialFlags: FeatureFlagMap;
  initialHistory: FeatureFlagAuditItem[];
}) {
  const router = useRouter();
  const [license, setLicense] = useState<VerifiedLicenseInfo>(initialLicense);
  const [flags, setFlags] = useState<FeatureFlagMap>(initialFlags);

  // License key input state
  const [licenseInput, setLicenseInput] = useState('');
  const [applyingLicense, setApplyingLicense] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Search & filter state
  const [searchKw, setSearchKw] = useState('');
  const [filterCategory, setFilterCategory] = useState<
    'ALL' | FeatureFlagCategory
  >('ALL');
  const [filterStatus, setFilterStatus] = useState<
    'ALL' | 'ENABLED' | 'DISABLED' | 'UNLICENSED'
  >('ALL');
  const [pendingKey, setPendingKey] = useState<
    FeatureFlagKey | 'RESET' | null
  >(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const licensedSet = useMemo(
    () => new Set<FeatureFlagKey>(license.licensedModules),
    [license.licensedModules]
  );

  const categories = useMemo(() => {
    const set = new Set<FeatureFlagCategory>();
    for (const d of FEATURE_FLAG_DEFINITIONS) {
      set.add(d.category);
    }
    return Array.from(set);
  }, []);

  const stats = useMemo(() => {
    const total = FEATURE_FLAG_DEFINITIONS.length;
    const licensedCount = FEATURE_FLAG_DEFINITIONS.filter((d) =>
      licensedSet.has(d.key)
    ).length;
    const unlicensedCount = total - licensedCount;
    const enabledCount = FEATURE_FLAG_DEFINITIONS.filter(
      (d) => flags[d.key]
    ).length;
    const disabledCount = total - enabledCount;
    return {
      total,
      licensedCount,
      unlicensedCount,
      enabledCount,
      disabledCount,
    };
  }, [flags, licensedSet]);

  const filteredDefs = useMemo(() => {
    const kw = searchKw.trim().toLowerCase();
    return FEATURE_FLAG_DEFINITIONS.filter((def) => {
      if (filterCategory !== 'ALL' && def.category !== filterCategory) {
        return false;
      }
      const isEnabled = Boolean(flags[def.key]);
      const isLicensed = licensedSet.has(def.key);
      if (filterStatus === 'ENABLED' && !isEnabled) return false;
      if (filterStatus === 'DISABLED' && isEnabled) return false;
      if (filterStatus === 'UNLICENSED' && isLicensed) return false;

      if (kw) {
        const hay = `${def.key} ${def.title} ${def.category} ${def.description} ${def.affectedRoutes.join(' ')}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [flags, licensedSet, searchKw, filterCategory, filterStatus]);

  const groupedDefs = useMemo(() => {
    const groups = new Map<
      FeatureFlagCategory,
      typeof FEATURE_FLAG_DEFINITIONS
    >();
    for (const def of filteredDefs) {
      const list = groups.get(def.category) ?? [];
      list.push(def);
      groups.set(def.category, list);
    }
    return Array.from(groups.entries());
  }, [filteredDefs]);

  const handleApplyLicenseKey = async () => {
    setErrorMsg(null);
    setBannerMsg(null);
    const targetKey = licenseInput.trim();
    if (!targetKey) {
      setErrorMsg('請先貼上由授權中心簽發的系統授權碼（ACCSYS-LIC-...）');
      return;
    }

    setApplyingLicense(true);
    const res = await applySystemLicenseKey({ licenseKey: targetKey });
    setApplyingLicense(false);

    if (res.ok) {
      setLicense(res.license);
      setFlags(res.flags);
      setLicenseInput('');
      setBannerMsg(
        `已成功驗證並套用授權碼「${res.license.planName}」！本次授權有效期間為 ${res.license.startsAt} 起至 ${res.license.expiresAt === 'PERMANENT' ? '永久有效' : `${res.license.expiresAt} 止`}，共授權開啟 ${res.license.licensedModules.length} 項功能模組。`
      );
      router.refresh();
    } else {
      setErrorMsg(res.error);
    }
  };

  const handleToggle = async (key: FeatureFlagKey, nextEnabled: boolean) => {
    setErrorMsg(null);
    setBannerMsg(null);
    const def = FEATURE_FLAG_DEFINITIONS.find((d) => d.key === key);
    if (!def) return;

    if (nextEnabled && !licensedSet.has(key)) {
      setErrorMsg(
        `「${def.title}」未包含在目前生效的授權碼（${license.planName}）中，嚴格禁止越權開啟！請先輸入包含此功能的授權碼。`
      );
      return;
    }

    setPendingKey(key);
    const res = await toggleSystemFeatureFlag({ key, enabled: nextEnabled });
    setPendingKey(null);

    if (res.ok) {
      setFlags(res.flags);
      setLicense(res.license);
      setBannerMsg(
        `已將「${def.title}」設為【${nextEnabled ? '開啟' : '關閉'}】（左側導覽列與網址路由守衛已即時同步）`
      );
      router.refresh();
    } else {
      setErrorMsg(res.error);
    }
  };

  const handleResetDefaults = async () => {
    setErrorMsg(null);
    setBannerMsg(null);
    const ok = await confirmDialog({
      title: '是否恢復為系統預設標準授權碼？',
      message: [
        '系統預設標準授權碼設定如下：',
        '• 專案助手（/tools/project-assistant）：【未授權・預設強制關閉】',
        '• 其餘 10 項系統模組與功能：【已授權・預設開啟】',
        '',
        '恢復後，任何使用者直接輸入 /tools/project-assistant 網址也將被嚴格攔截。確定要執行嗎？',
      ].join('\n'),
      confirmLabel: '確認恢復預設標準授權',
      cancelLabel: '取消',
    });
    if (!ok) return;

    setPendingKey('RESET');
    const res = await resetSystemFeatureFlagsToDefault();
    setPendingKey(null);

    if (res.ok) {
      setLicense(res.license);
      setFlags(res.flags);
      setBannerMsg(
        '已恢復系統預設標準授權碼（專案助手設為未授權關閉，其餘 10 項功能開啟）'
      );
      router.refresh();
    } else {
      setErrorMsg(res.error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-title">系統管理</p>
          <h1 className="page-title">功能授權</h1>
          <p className="page-subtitle">
            輸入系統授權碼以決定系統開放的功能模組與授權可用期限。
            <span className="font-semibold text-amber-800">
              未獲授權或已關閉之功能除隱藏導覽列外，亦全面強制攔截直接網址與 API 存取
            </span>
            。
          </p>
        </div>
        <button
          type="button"
          onClick={handleResetDefaults}
          disabled={pendingKey !== null || applyingLicense}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-50"
        >
          {pendingKey === 'RESET'
            ? '恢復預設中…'
            : '↺ 恢復預設標準授權（專案助手關閉）'}
        </button>
      </section>

      {errorMsg && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>⚠️ {errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs font-semibold underline"
          >
            關閉
          </button>
        </div>
      )}

      {bannerMsg && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>✅ {bannerMsg}</span>
          <button
            type="button"
            onClick={() => setBannerMsg(null)}
            className="text-xs font-semibold underline"
          >
            關閉
          </button>
        </div>
      )}

      {/* Active License Certificate + License Input Box */}
      <section className="grid gap-4 lg:grid-cols-12">
        {/* Left 7 cols: Simplified Current Active License Card */}
        <div className="lg:col-span-7 flex flex-col justify-between rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-td-blue-dark p-5 text-white shadow-md space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="rounded-full bg-emerald-400/20 px-2.5 py-0.5 text-xs font-bold text-emerald-300 ring-1 ring-emerald-400/40">
                ✓ 授權生效中
              </span>
              <span className="text-sm font-bold text-white">
                已授權開通 {stats.licensedCount} / {stats.total} 項模組
              </span>
            </div>
            {license.remainingDays !== null ? (
              <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-xs font-bold text-amber-200 ring-1 ring-amber-400/40">
                剩餘 {license.remainingDays} 天
              </span>
            ) : (
              <span className="rounded-full bg-sky-400/20 px-2.5 py-0.5 text-xs font-bold text-sky-200 ring-1 ring-sky-400/40">
                ∞ 永久授權
              </span>
            )}
          </div>

          {/* 授權有效期間：從什麼時候開始 ～ 可以使用到什麼時候 */}
          <div className="grid gap-3 sm:grid-cols-2 rounded-xl bg-white/10 p-3.5 ring-1 ring-white/15">
            <div>
              <div className="text-xs text-slate-300">生效開始日</div>
              <div className="mt-1 font-mono text-base font-bold text-white">
                {license.startsAt} 起
              </div>
            </div>
            <div>
              <div className="text-xs text-amber-200">可使用至（到期日）</div>
              <div className="mt-1 font-mono text-base font-extrabold text-amber-300">
                {license.expiresAt === 'PERMANENT'
                  ? '永久有效 (PERMANENT)'
                  : `${license.expiresAt} 止`}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-black/30 px-3.5 py-3 ring-1 ring-white/10">
            <div className="mb-1.5 flex items-center justify-between text-xs text-slate-300">
              <span>目前授權碼（120-bit 混淆加密與防偽簽章）</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(license.licenseKey);
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 1800);
                }}
                className="rounded bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-white/25"
              >
                {copiedKey ? '✓ 已複製' : '複製授權碼'}
              </button>
            </div>
            <div className="break-all font-mono text-sm font-semibold tracking-wide text-emerald-300 select-all">
              {license.licenseKey}
            </div>
          </div>
        </div>

        {/* Right 5 cols: Apply License Key Form */}
        <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
          <div className="space-y-2">
            <h3 className="text-base font-bold text-td-blue-dark">
              📥 更換系統授權碼
            </h3>
            <p className="text-xs leading-relaxed text-slate-600">
              貼上由本地授權網頁（
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
                ACCSYS_LICENSE
              </code>
              ）產生的加密授權碼，即可更新開放模組與可用期限。
            </p>
            <input
              type="text"
              value={licenseInput}
              onChange={(e) => {
                setLicenseInput(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder="例如：ACCSYS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              aria-label="系統授權碼輸入框"
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 font-mono text-xs text-slate-900 focus:border-td-blue focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            {licenseInput.trim() && (
              <button
                type="button"
                onClick={() => setLicenseInput('')}
                className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                清除
              </button>
            )}
            <button
              type="button"
              disabled={applyingLicense || !licenseInput.trim()}
              onClick={() => void handleApplyLicenseKey()}
              className="rounded-xl bg-td-blue px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-td-blue-dark disabled:opacity-50"
            >
              {applyingLicense ? '驗證中…' : '🔑 套用授權碼'}
            </button>
          </div>
        </div>
      </section>

      {/* Search & Filters */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2.5 text-sm">
          <input
            type="search"
            value={searchKw}
            onChange={(e) => setSearchKw(e.target.value)}
            placeholder="🔍 搜尋功能名稱、說明或受保護網址…"
            className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          />
          <select
            value={filterCategory}
            onChange={(e) =>
              setFilterCategory(e.target.value as 'ALL' | FeatureFlagCategory)
            }
            aria-label="篩選功能分類"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="ALL">全部分類（共 {categories.length} 類）</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(
                e.target.value as
                  | 'ALL'
                  | 'ENABLED'
                  | 'DISABLED'
                  | 'UNLICENSED'
              )
            }
            aria-label="篩選授權與開關狀態"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="ALL">全部功能（{stats.total}）</option>
            <option value="ENABLED">開啟中（{stats.enabledCount}）</option>
            <option value="DISABLED">
              已關閉／含未授權（{stats.disabledCount}）
            </option>
            <option value="UNLICENSED">
              🔒 未獲授權碼開通（{stats.unlicensedCount}）
            </option>
          </select>
        </div>
        <span className="text-xs text-slate-500">
          顯示 {filteredDefs.length} / {FEATURE_FLAG_DEFINITIONS.length} 項功能
        </span>
      </section>

      {/* Feature Flags Grouped List */}
      <div className="space-y-5">
        {groupedDefs.map(([category, items]) => (
          <section
            key={category}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-5 py-3">
              <h2 className="text-sm font-bold text-td-blue-dark">{category}</h2>
              <span className="text-xs text-slate-500">
                共 {items.length} 項功能
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {items.map((def) => {
                const isLicensed = licensedSet.has(def.key);
                const isEnabled = isLicensed && Boolean(flags[def.key]);
                const isBusy = pendingKey === def.key;

                return (
                  <div
                    key={def.key}
                    className={`flex flex-wrap items-center justify-between gap-4 px-5 py-4 transition ${
                      !isLicensed
                        ? 'bg-rose-50/35'
                        : !isEnabled
                          ? 'bg-amber-50/25'
                          : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="min-w-[260px] flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {def.title}
                        </span>
                        {isLicensed ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                            🔑 授權碼已開通（可用至{' '}
                            {license.expiresAt === 'PERMANENT'
                              ? '永久'
                              : license.expiresAt}
                            ）
                          </span>
                        ) : (
                          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-800 ring-1 ring-rose-300">
                            🔒 授權碼未開通・強制鎖定關閉
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            def.defaultEnabled
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {def.defaultEnabled ? '系統預設開啟' : '系統預設關閉'}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-600">
                        {def.description}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-[11px] font-semibold text-slate-500">
                          🛡️ 網址直連攔截保護路由：
                        </span>
                        {def.affectedRoutes.map((route) => (
                          <code
                            key={route}
                            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700"
                          >
                            {route}
                          </code>
                        ))}
                      </div>
                    </div>

                    {/* Right Side Switch Control */}
                    <div className="flex items-center gap-3">
                      {!isLicensed ? (
                        <span className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-800">
                          🔒 未獲授權碼授權（需輸入新授權碼開通）
                        </span>
                      ) : (
                        <>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                              isEnabled
                                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {isEnabled ? '● 已開啟' : '○ 已手動關閉'}
                          </span>

                          <button
                            type="button"
                            role="switch"
                            aria-checked={isEnabled}
                            aria-label={`切換 ${def.title}`}
                            disabled={isBusy}
                            onClick={() =>
                              void handleToggle(def.key, !isEnabled)
                            }
                            className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                              isEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                            }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                isEnabled ? 'translate-x-6' : 'translate-x-0.5'
                              }`}
                            />
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleToggle(def.key, !isEnabled)
                            }
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                              isEnabled
                                ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                            }`}
                          >
                            {isBusy
                              ? '處理中…'
                              : isEnabled
                                ? '暫時關閉'
                                : '重新開啟'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Audit History Section */}
      {initialHistory.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-3">
          <h2 className="text-sm font-bold text-td-blue-dark">
            最近授權碼套用與功能開關變更紀錄
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="border-b text-left">
                  <th className="px-3 py-2 font-semibold">變更時間</th>
                  <th className="px-3 py-2 font-semibold">操作人員</th>
                  <th className="px-3 py-2 font-semibold">變更內容</th>
                  <th className="px-3 py-2 font-semibold">狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {initialHistory.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
                      {new Date(item.occurredAt).toLocaleString('zh-TW')}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                      {item.actorName}
                    </td>
                    <td className="px-3 py-2 text-slate-800">
                      {item.changedTitle}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {item.actionType === 'LICENSE_APPLIED' ? (
                        <span className="rounded bg-blue-50 px-2 py-0.5 font-semibold text-td-blue">
                          🔑 套用授權碼
                        </span>
                      ) : item.enabled === null ? (
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                          恢復預設標準授權
                        </span>
                      ) : item.enabled ? (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                          已開啟
                        </span>
                      ) : (
                        <span className="rounded bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                          已關閉
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
