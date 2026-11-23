'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  GUIDE_QA_ITEMS,
  GUIDE_SCENARIOS,
  ROLE_TIER_META,
  type GuideRoleTier,
} from './guide-data';

type VisualRoleGuideProps = {
  /** 依目前登入帳號角色計算出允許檢視的階層清單 */
  allowedTiers: GuideRoleTier[];
  /** 預設選中的角色階層 */
  initialTier: GuideRoleTier;
  /** 目前登入者顯示用的角色名稱 */
  currentRoleLabel: string;
};

type LightboxState = {
  src: string;
  alt: string;
  title: string;
  hint: string;
  href: string;
  linkLabel: string;
} | null;

export function VisualRoleGuide({
  allowedTiers,
  initialTier,
  currentRoleLabel,
}: VisualRoleGuideProps) {
  const safeInitialTier = allowedTiers.includes(initialTier)
    ? initialTier
    : allowedTiers[0] ?? 'staff';

  const [activeTier, setActiveTier] = useState<GuideRoleTier>(safeInitialTier);
  const [activeTab, setActiveTab] = useState<'scenarios' | 'qa'>('scenarios');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [openQaIds, setOpenQaIds] = useState<Record<string, boolean>>({});
  const [lightbox, setLightbox] = useState<LightboxState>(null);

  const tierScenarios = useMemo(
    () =>
      GUIDE_SCENARIOS.filter(
        (s) => s.tier === activeTier && allowedTiers.includes(s.tier)
      ),
    [activeTier, allowedTiers]
  );

  const tierQaItems = useMemo(
    () =>
      GUIDE_QA_ITEMS.filter(
        (q) => q.tier === activeTier && allowedTiers.includes(q.tier)
      ),
    [activeTier, allowedTiers]
  );

  const currentScenario = useMemo(() => {
    const found = tierScenarios.find((s) => s.id === selectedScenarioId);
    return found ?? tierScenarios[0];
  }, [tierScenarios, selectedScenarioId]);

  const tierMeta = ROLE_TIER_META[activeTier];

  const handleTierChange = (tier: GuideRoleTier) => {
    if (!allowedTiers.includes(tier)) return;
    setActiveTier(tier);
    const firstScenario = GUIDE_SCENARIOS.find((s) => s.tier === tier);
    if (firstScenario) setSelectedScenarioId(firstScenario.id);
  };

  const toggleQa = (id: string) => {
    setOpenQaIds((prev) => ({
      ...prev,
      [id]: !(prev[id] ?? true),
    }));
  };

  return (
    <div className="space-y-6">
      {/* 頂部：帳號角色權限範圍與三階層切換器 */}
      <section className="rounded-2xl border border-td-line bg-white p-5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-td-blue/10 px-3 py-1 text-xs font-bold text-td-blue">
                🔐 您的帳號角色：{currentRoleLabel}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                可檢視階層：{allowedTiers.map((t) => ROLE_TIER_META[t].label).join(' ／ ')}
              </span>
            </div>
            <h1 className="text-xl font-bold text-td-blue-dark sm:text-2xl">
              📸 情境式圖片流程教學 ＆ 常見問題 Q&amp;A
            </h1>
          </div>

          {/* 切換「情境圖片教學」與「一步一步 Q&A」 */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('scenarios')}
              className={`rounded-lg px-4 py-2 text-xs font-bold transition sm:text-sm ${
                activeTab === 'scenarios'
                  ? 'bg-white text-td-blue-dark shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📸 今日情境圖片流程（{tierScenarios.length}）
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('qa')}
              className={`rounded-lg px-4 py-2 text-xs font-bold transition sm:text-sm ${
                activeTab === 'qa'
                  ? 'bg-white text-td-blue-dark shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              💬 常見問題 Q&amp;A（{tierQaItems.length}）
            </button>
          </div>
        </div>

        {/* 角色階層切換列（僅渲染該帳號有權限看到的階層！） */}
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {allowedTiers.map((tier) => {
            const meta = ROLE_TIER_META[tier];
            const isSelected = activeTier === tier;
            const scenarioCount = GUIDE_SCENARIOS.filter((s) => s.tier === tier).length;
            const qaCount = GUIDE_QA_ITEMS.filter((q) => q.tier === tier).length;
            return (
              <button
                key={tier}
                type="button"
                onClick={() => handleTierChange(tier)}
                className={`flex flex-col items-start justify-between rounded-xl border p-3.5 text-left transition ${
                  isSelected
                    ? meta.activeTabClass
                    : 'border-slate-200 bg-slate-50/70 text-slate-800 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-base font-bold">{meta.label}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200/80 text-slate-700'
                    }`}
                  >
                    {meta.badge}
                  </span>
                </div>
                <p
                  className={`mt-1.5 text-xs ${
                    isSelected ? 'text-white/90' : 'text-slate-500'
                  }`}
                >
                  {scenarioCount} 個日常情境圖解 · {qaCount} 題步驟 Q&amp;A
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* ==================== 模式一：今日情境圖片流程教學 ==================== */}
      {activeTab === 'scenarios' && currentScenario && (
        <section className="space-y-5">
          {/* Step A: 選擇「我今天遇到什麼情境？」 */}
          <div className="rounded-2xl border border-td-line bg-white p-5 shadow-2xs">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
                  STEP 1｜選擇今日情境
                </span>
                <h2 className="text-base font-bold text-slate-900">
                  您今天需要處理什麼事情？（點選情境立即切換下方圖片流程）
                </h2>
              </div>
              <span className="text-xs text-slate-500">{tierMeta.visibilityRule}</span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
              {tierScenarios.map((scenario) => {
                const active = scenario.id === currentScenario.id;
                return (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => setSelectedScenarioId(scenario.id)}
                    className={`group flex flex-col justify-between rounded-xl border p-3.5 text-left transition ${
                      active
                        ? 'border-td-blue bg-blue-50/70 ring-2 ring-td-blue/25'
                        : 'border-slate-200 bg-white hover:border-td-blue/50 hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${
                            active
                              ? 'bg-td-blue text-white'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {scenario.scenarioTag}
                        </span>
                        {active && (
                          <span className="text-xs font-bold text-td-blue">● 目前顯示</span>
                        )}
                      </div>
                      <p className="text-sm font-bold leading-snug text-slate-900">
                        「{scenario.scenarioTitle}」
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-slate-200/70 pt-2 text-xs">
                      <span className="font-semibold text-slate-600">
                        🔧 需要功能：{scenario.featureName}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step B: 圖片流程主體（3 張大圖橫向流程卡片 + 一步一步前往按鈕） */}
          <div className="rounded-2xl border-2 border-td-blue/30 bg-white p-5 shadow-xs space-y-5">
            {/* 情境標題與對應功能直達列 */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-900 px-5 py-4 text-white">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-amber-400 px-2.5 py-0.5 text-xs font-extrabold text-slate-950">
                    {currentScenario.scenarioTag}
                  </span>
                  <span className="text-xs font-medium text-sky-300">
                    對應功能：{currentScenario.featureName}
                  </span>
                </div>
                <h3 className="text-base font-bold sm:text-lg">
                  情境：「{currentScenario.scenarioTitle}」
                </h3>
              </div>
              <Link
                href={currentScenario.featureHref}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-extrabold text-slate-950 shadow-sm transition hover:bg-amber-300 sm:text-sm"
              >
                🚀 直接前往「{currentScenario.featureName}」 →
              </Link>
            </div>

            {/* 視覺流程進度條 (Step 1 ➔ Step 2 ➔ Step 3) */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {currentScenario.steps.map((step, index) => (
                <div
                  key={step.stepNumber}
                  className="relative flex flex-col justify-between rounded-2xl border border-slate-200 bg-slate-50/60 overflow-hidden shadow-2xs transition hover:border-td-blue/60 hover:shadow-md"
                >
                  {/* Step 頂部標頭 */}
                  <div>
                    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-td-blue text-xs font-extrabold text-white">
                          {step.stepNumber}
                        </span>
                        <span className="text-sm font-bold text-slate-900">
                          {step.title}
                        </span>
                      </div>
                      {index < currentScenario.steps.length - 1 && (
                        <span className="hidden text-xs font-bold text-td-blue lg:inline">
                          下一步 ➔
                        </span>
                      )}
                    </div>

                    {/* 畫面截圖／流程圖主體（點擊可全螢幕放大） */}
                    <button
                      type="button"
                      onClick={() =>
                        setLightbox({
                          src: step.imageSrc,
                          alt: step.imageAlt,
                          title: `Step ${step.stepNumber}｜${step.title}`,
                          hint: step.hint,
                          href: step.href,
                          linkLabel: step.linkLabel,
                        })
                      }
                      className="group relative block w-full overflow-hidden bg-slate-900/5 text-left"
                      title="點擊放大檢視圖片"
                    >
                      <div className="aspect-16/10 w-full overflow-hidden bg-slate-100">
                        <img
                          src={step.imageSrc}
                          alt={step.imageAlt}
                          className="h-full w-full object-cover object-top transition duration-200 group-hover:scale-[1.02]"
                        />
                      </div>
                      {/* 畫面點擊位置提示標籤 */}
                      <div className="border-y border-amber-200 bg-amber-50/95 px-3 py-1.5 text-[11px] font-bold text-amber-900 flex items-center justify-between gap-2">
                        <span className="truncate">{step.targetLabel}</span>
                        <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 shadow-2xs">
                          🔍 放大
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* 底部：一句簡短提示 ＋ 直接前往連結 */}
                  <div className="flex flex-col justify-between gap-3 p-4 bg-white">
                    <p className="text-xs font-medium leading-relaxed text-slate-700 sm:text-sm">
                      {step.hint}
                    </p>
                    <Link
                      href={step.href}
                      className="inline-flex w-full items-center justify-center rounded-xl border border-td-blue/30 bg-blue-50/70 px-3 py-2 text-xs font-bold text-td-blue transition hover:bg-td-blue hover:text-white"
                    >
                      {step.linkLabel}
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            {/* 底部快速切換至 Q&A 引導 */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="text-xs font-semibold text-slate-600">
                💡 操作時遇到問題嗎？我們為「{tierMeta.label}」整理了 {tierQaItems.length} 題一步一步圖解 Q&amp;A
              </span>
              <button
                type="button"
                onClick={() => setActiveTab('qa')}
                className="rounded-lg bg-td-blue px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-td-blue-dark"
              >
                💬 查看 {tierMeta.label} 常見問題 Q&amp;A →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ==================== 模式二：一步一步圖解 Q&A ==================== */}
      {activeTab === 'qa' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-td-line bg-white p-5 shadow-2xs">
            <div>
              <span className="inline-block rounded-md bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-900">
                {tierMeta.label} 專屬 Q&amp;A
              </span>
              <h2 className="mt-1 text-lg font-bold text-slate-900">
                💬 常見問題快速排解（一步一步提示 ＋ 畫面照片 ＋ 直接前往連結）
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('scenarios')}
              className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              ← 返回情境圖片流程
            </button>
          </div>

          <div className="space-y-4">
            {tierQaItems.map((qa) => {
              const isOpen = openQaIds[qa.id] ?? true;
              return (
                <div
                  key={qa.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs"
                >
                  {/* Q&A 問題標題列 */}
                  <button
                    type="button"
                    onClick={() => toggleQa(qa.id)}
                    className="flex w-full items-center justify-between gap-3 bg-slate-50/80 px-5 py-4 text-left transition hover:bg-slate-100/80"
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="rounded-md bg-td-blue px-2.5 py-0.5 text-xs font-bold text-white">
                        {qa.tag}
                      </span>
                      <span className="text-sm font-bold text-slate-900 sm:text-base">
                        {qa.question}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-bold text-slate-500">
                      {isOpen ? '收合 ▲' : '展開圖解步驟 ▼'}
                    </span>
                  </button>

                  {/* Q&A 一步一步照片卡片區（無長篇文字！） */}
                  {isOpen && (
                    <div className="grid grid-cols-1 gap-4 border-t border-slate-200 p-5 md:grid-cols-2">
                      {qa.steps.map((qStep) => (
                        <div
                          key={qStep.stepNumber}
                          className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50"
                        >
                          <div>
                            {/* 照片／畫面截圖 */}
                            <button
                              type="button"
                              onClick={() =>
                                setLightbox({
                                  src: qStep.imageSrc,
                                  alt: qStep.imageAlt,
                                  title: `${qa.question} — Step ${qStep.stepNumber}`,
                                  hint: qStep.prompt,
                                  href: qStep.href,
                                  linkLabel: qStep.linkLabel,
                                })
                              }
                              className="group relative block w-full overflow-hidden bg-slate-100 text-left"
                            >
                              <div className="aspect-16/9 w-full overflow-hidden">
                                <img
                                  src={qStep.imageSrc}
                                  alt={qStep.imageAlt}
                                  className="h-full w-full object-cover object-top transition duration-200 group-hover:scale-[1.02]"
                                />
                              </div>
                              <span className="absolute right-2.5 bottom-2.5 rounded-md bg-slate-900/80 px-2 py-1 text-[11px] font-bold text-white">
                                🔍 點擊放大照片
                              </span>
                            </button>

                            {/* 簡短步驟提示 */}
                            <div className="flex items-start gap-2.5 p-3.5">
                              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-extrabold text-white">
                                {qStep.stepNumber}
                              </span>
                              <p className="text-xs font-semibold leading-relaxed text-slate-800 sm:text-sm">
                                {qStep.prompt}
                              </p>
                            </div>
                          </div>

                          {/* 直接前往按鈕 */}
                          <div className="border-t border-slate-200/80 bg-white px-3.5 py-2.5">
                            <Link
                              href={qStep.href}
                              className="inline-flex w-full items-center justify-center rounded-lg bg-td-blue px-3 py-2 text-xs font-bold text-white transition hover:bg-td-blue-dark"
                            >
                              {qStep.linkLabel}
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 點擊圖片全螢幕放大檢視 Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs"
          onClick={() => setLightbox(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-700 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-3.5 text-white">
              <h4 className="text-sm font-bold sm:text-base">{lightbox.title}</h4>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="rounded-lg bg-white/15 px-3 py-1 text-xs font-bold text-white hover:bg-white/25"
              >
                ✕ 關閉預覽
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto bg-slate-100 p-4">
              <img
                src={lightbox.src}
                alt={lightbox.alt}
                className="mx-auto max-h-[65vh] w-full max-w-4xl object-contain rounded-lg border border-slate-300 bg-white shadow-sm"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3.5">
              <p className="text-xs font-semibold text-slate-700 sm:text-sm">
                💡 {lightbox.hint}
              </p>
              <Link
                href={lightbox.href}
                className="rounded-xl bg-td-blue px-4 py-2 text-xs font-bold text-white hover:bg-td-blue-dark"
              >
                {lightbox.linkLabel}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
