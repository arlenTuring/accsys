'use client';

import { useState } from 'react';
import { DEV_PERSONAS, isDevLoginEnabled } from '@/lib/auth/dev-personas';

export function StageTestingAnd104Banner({
  currentEmployeeCode,
  currentEmployeeName,
}: {
  currentEmployeeCode?: string;
  currentEmployeeName?: string;
}) {
  const [expandedStages, setExpandedStages] = useState(true);
  const devEnabled = isDevLoginEnabled();

  if (!devEnabled) {
    return null;
  }

  return (
    <section className="space-y-2.5">
      {/* 每一關的測試帳號一鍵切換面板 */}
      <div className="rounded-xl border border-amber-200/90 bg-amber-50/50 px-4 py-3 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
              🧪 全流程 10 大簽核關卡測試帳號
            </span>
            <span className="text-xs text-slate-700">
              目前身分：
              <strong className="ml-1 text-td-blue-dark">
                {currentEmployeeName ?? '使用者'}
                {currentEmployeeCode ? ` (${currentEmployeeCode})` : ''}
              </strong>
              ｜點擊任一關卡即可秒切身分，從第 1 關申請人一路簽核到董事長／財會／檢核人！
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExpandedStages((v) => !v)}
            className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            {expandedStages ? '收合關卡測試帳號 ▲' : '展開 10 關測試帳號 ▼'}
          </button>
        </div>

        {expandedStages && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {DEV_PERSONAS.map((p) => {
              const isCurrent = currentEmployeeCode === p.employeeCode;
              return (
                <a
                  key={p.id}
                  href={`/auth/dev?as=${p.id}&returnTo=/applications`}
                  className={`flex flex-col justify-between rounded-lg border p-2.5 text-xs transition ${
                    isCurrent
                      ? 'border-td-blue bg-blue-50/90 ring-2 ring-td-blue/40'
                      : 'border-slate-200 bg-white hover:border-amber-400 hover:bg-amber-50/40'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                        {p.stageBadge}
                      </span>
                      {isCurrent && (
                        <span className="rounded bg-td-blue px-1.5 py-0.5 text-[10px] font-bold text-white">
                          目前登入
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 font-bold text-td-blue-dark">
                      {p.name}{' '}
                      <span className="font-mono text-[11px] font-normal text-td-muted">
                        ({p.employeeCode})
                      </span>
                    </p>
                    <p className="text-[11px] font-medium text-slate-600">
                      {p.department} · {p.title}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[11px] text-td-muted">
                      {p.description}
                    </p>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
