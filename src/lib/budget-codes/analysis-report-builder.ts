import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type BudgetAnalysisMonthlyPoint = {
  month: number;
  label: string;
  planned: number;
  executed: number;
  cumRatePct: number;
};

export type BudgetAnalysisCategoryItem = {
  categoryName: string;
  currentYearAmount: number;
  executedAmount: number;
  executionRatePct: number;
  currentVarianceAmount: number;
};

export type BudgetAnalysisReportSectionData = {
  targetId: string;
  title: string;
  scopeLabel: string;
  unitCount: number;
  annualBudgetAmount: number;
  executedAmount: number;
  executionRatePct: number;
  currentVarianceAmount: number;
  monthlyTrend: BudgetAnalysisMonthlyPoint[];
  categoryBreakdowns: BudgetAnalysisCategoryItem[];
};

export type BuildBudgetAnalysisReportInput = {
  fiscalYear: string;
  reportTitle: string;
  executiveSummary: string;
  senderName: string;
  sections: BudgetAnalysisReportSectionData[];
};

const COMMON_FONT = 'assets/fonts/NotoSansTC-Common.otf';
const FULL_FONT = 'assets/fonts/NotoSansCJKtc-Regular.otf';
const fontCache = new Map<string, Uint8Array>();

async function loadFont(file: string): Promise<Uint8Array | null> {
  const hit = fontCache.get(file);
  if (hit) return hit;
  try {
    const bytes = new Uint8Array(await readFile(path.join(process.cwd(), file)));
    fontCache.set(file, bytes);
    return bytes;
  } catch {
    return null;
  }
}

async function pickFont(text: string): Promise<Uint8Array> {
  const common = await loadFont(COMMON_FONT);
  if (common) {
    const parsed = fontkit.create(common) as unknown as {
      hasGlyphForCodePoint(c: number): boolean;
    };
    const covered = [...text].every(
      (ch) => ch === '\n' || parsed.hasGlyphForCodePoint(ch.codePointAt(0)!)
    );
    if (covered) return common;
  }
  const full = await loadFont(FULL_FONT);
  if (full) return full;
  if (common) return common;
  throw new Error('cjk_font_missing: see assets/fonts/README.md');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 *  sanitization for PDF font rendering: remove characters outside BMP (like emojis 🌐🏢📁📊)
 * so fontkit/NotoSansTC never encounters missing emoji glyphs.
 */
function sanitizePdfText(str: string): string {
  return str
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[^\S\n\u3000]/g, ' ')
    .trim();
}

function wrapText(text: string, maxChars: number): string[] {
  const clean = sanitizePdfText(text);
  if (!clean) return [];
  const lines: string[] = [];
  for (const para of clean.split(/\n/)) {
    const p = para.trim();
    if (!p) {
      lines.push('');
      continue;
    }
    let cur = '';
    for (const ch of p) {
      if (cur.length >= maxChars) {
        lines.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

/**
 * 產生與網頁上預算分析圖表報告一模一樣的 HTML 郵件內容
 */
export function buildBudgetAnalysisEmailHtml(
  input: BuildBudgetAnalysisReportInput
): string {
  const fy = escapeHtml(input.fiscalYear);
  const title = escapeHtml(input.reportTitle);
  const summary = input.executiveSummary?.trim() || '';

  const sectionsHtml = input.sections
    .map((sec, idx) => {
      const rate = sec.executionRatePct;
      const isOver = sec.currentVarianceAmount > 0;
      const rateColor =
        rate > 100 ? '#dc2626' : rate >= 85 ? '#d97706' : '#059669';
      const rateBg =
        rate > 100 ? '#fef2f2' : rate >= 85 ? '#fffbeb' : '#ecfdf5';
      const rateStatusText =
        rate > 100
          ? '超支警示（已逾年度預算）'
          : rate >= 85
            ? '接近上限（高水位執行）'
            : '進度正常（執行控管良好）';
      const barPct = Math.min(100, Math.max(2, Math.round(rate)));
      const diffPct =
        sec.annualBudgetAmount > 0
          ? Math.abs(
              (sec.currentVarianceAmount / sec.annualBudgetAmount) * 100
            )
          : 0;
      const halfBarPct = Math.min(48, Math.max(2, Math.round(diffPct / 2)));

      const maxMonthVal = Math.max(
        1,
        ...sec.monthlyTrend.map((m) => Math.max(m.planned, m.executed))
      );

      const monthlyColsHtml = sec.monthlyTrend
        .map((m) => {
          const planH = Math.max(4, Math.round((m.planned / maxMonthVal) * 72));
          const execH = Math.max(
            4,
            Math.round((m.executed / maxMonthVal) * 72)
          );
          const execBarColor =
            m.executed > m.planned ? '#f59e0b' : '#10b981';
          return `<td style="vertical-align:bottom;text-align:center;padding:4px 2px;width:8.33%;border-bottom:1px solid #cbd5e1;">
            <div style="font-size:10px;font-weight:700;color:#4f46e5;margin-bottom:4px;">${m.cumRatePct.toFixed(0)}%</div>
            <div style="height:76px;display:inline-block;vertical-align:bottom;">
              <table style="border-collapse:collapse;margin:0 auto;height:76px;">
                <tr>
                  <td style="vertical-align:bottom;padding:0 1px;">
                    <div title="編列: NT$ ${m.planned.toLocaleString()}" style="width:10px;height:${planH}px;background:#93c5fd;border:1px solid #60a5fa;border-radius:2px 2px 0 0;"></div>
                  </td>
                  <td style="vertical-align:bottom;padding:0 1px;">
                    <div title="執行: NT$ ${m.executed.toLocaleString()}" style="width:10px;height:${execH}px;background:${execBarColor};border-radius:2px 2px 0 0;"></div>
                  </td>
                </tr>
              </table>
            </div>
            <div style="font-size:11px;font-weight:700;color:#334155;margin-top:4px;">${escapeHtml(m.label)}</div>
            <div style="font-size:9px;color:#64748b;font-family:monospace;">編 ${(m.planned / 1000).toFixed(0)}k</div>
            <div style="font-size:9px;color:#059669;font-family:monospace;font-weight:700;">實 ${(m.executed / 1000).toFixed(0)}k</div>
          </td>`;
        })
        .join('');

      const maxCatBudget = Math.max(
        1,
        ...sec.categoryBreakdowns.map((c) =>
          Math.max(
            c.currentYearAmount,
            c.executedAmount,
            Math.abs(c.currentVarianceAmount)
          )
        )
      );

      const categoryRowsHtml = sec.categoryBreakdowns
        .map((cat) => {
          const catOver = cat.currentVarianceAmount > 0;
          const catRate = cat.executionRatePct;
          const catRateColor =
            catRate > 100
              ? '#dc2626'
              : catRate >= 85
                ? '#d97706'
                : '#059669';
          const catExecW = Math.min(
            100,
            Math.max(
              2,
              Math.round(
                (cat.executedAmount / Math.max(1, cat.currentYearAmount)) * 100
              )
            )
          );
          const catVarHalfW = Math.min(
            48,
            Math.max(
              2,
              Math.round(
                (Math.abs(cat.currentVarianceAmount) / maxCatBudget) * 48
              )
            )
          );

          return `<tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:10px 14px;width:34%;vertical-align:middle;">
              <div style="font-size:13px;font-weight:700;color:#0f172a;white-space:nowrap;">${escapeHtml(cat.categoryName)}</div>
              <div style="font-size:11px;color:#64748b;margin-top:3px;font-family:monospace;white-space:nowrap;">
                核定 A: NT$ ${cat.currentYearAmount.toLocaleString()} ｜ 已執行 B: NT$ ${cat.executedAmount.toLocaleString()}
              </div>
            </td>
            <td style="padding:10px 14px;width:34%;vertical-align:middle;">
              <div style="font-size:11px;font-weight:700;color:${catRateColor};margin-bottom:5px;white-space:nowrap;">
                執行率 (B/A)：${catRate.toFixed(1)}%
              </div>
              <div style="width:100%;height:12px;background:#e2e8f0;border-radius:6px;overflow:hidden;">
                <div style="width:${catExecW}%;height:12px;background:${catRateColor};border-radius:6px;"></div>
              </div>
            </td>
            <td style="padding:10px 14px;width:32%;vertical-align:middle;">
              <div style="font-size:11px;font-weight:700;color:${catOver ? '#dc2626' : '#059669'};margin-bottom:5px;text-align:right;font-family:monospace;white-space:nowrap;">
                差異 (B−A)：${catOver ? `+NT$ ${cat.currentVarianceAmount.toLocaleString()}（超支）` : `-NT$ ${Math.abs(cat.currentVarianceAmount).toLocaleString()}（結餘）`}
              </div>
              <table style="width:100%;border-collapse:collapse;height:12px;background:#f1f5f9;border-radius:6px;">
                <tr>
                  <td style="width:50%;border-right:2px solid #94a3b8;padding:0;vertical-align:middle;">
                    ${
                      !catOver
                        ? `<div style="margin-left:${100 - catVarHalfW * 2}%;width:${catVarHalfW * 2}%;height:10px;background:#10b981;border-radius:4px 0 0 4px;"></div>`
                        : ''
                    }
                  </td>
                  <td style="width:50%;padding:0;vertical-align:middle;">
                    ${
                      catOver
                        ? `<div style="width:${catVarHalfW * 2}%;height:10px;background:#ef4444;border-radius:0 4px 4px 0;"></div>`
                        : ''
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
        })
        .join('');

      return `<div style="margin:22px 0;border:2px solid #cbd5e1;border-radius:14px;overflow:hidden;background:#ffffff;">
        <!-- 單一報告標題列（使用 table 排版避免郵件客戶端折行跑版） -->
        <div style="background:linear-gradient(90deg,#eff6ff,#eef2ff);padding:14px 18px;border-bottom:1px solid #cbd5e1;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="vertical-align:middle;text-align:left;">
                <span style="display:inline-block;background:#1d4ed8;color:#ffffff;font-size:12px;font-weight:700;padding:4px 10px;border-radius:6px;margin-right:10px;white-space:nowrap;vertical-align:middle;">
                  報告 ${idx + 1} / ${input.sections.length}｜${fy} 年度圖表分析對象
                </span>
                <span style="font-size:16px;font-weight:800;color:#0f172a;vertical-align:middle;">${escapeHtml(sec.title)}</span>
              </td>
              <td style="vertical-align:middle;text-align:right;white-space:nowrap;padding-left:12px;">
                <span style="display:inline-block;font-size:12px;font-weight:700;color:#1e40af;background:#dbeafe;padding:4px 10px;border-radius:6px;white-space:nowrap;">
                  ${escapeHtml(sec.scopeLabel)}
                </span>
              </td>
            </tr>
          </table>
        </div>

        <div style="padding:18px;">
          <!-- 圖表一 & 圖表二：雙欄並排 -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:18px;table-layout:fixed;">
            <tr>
              <!-- 圖表一：今年度預算執行率 (B ÷ A) -->
              <td style="width:48%;vertical-align:top;padding-right:10px;">
                <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#ffffff;">
                  <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
                    <tr>
                      <td style="font-size:14px;font-weight:800;color:#1e293b;white-space:nowrap;">📊 圖表一：今年度預算執行率 (B ÷ A)</td>
                      <td style="text-align:right;white-space:nowrap;">
                        <span style="display:inline-block;font-size:11px;font-weight:700;color:${rateColor};background:${rateBg};padding:3px 10px;border-radius:999px;white-space:nowrap;">
                          ${rateStatusText}
                        </span>
                      </td>
                    </tr>
                  </table>
                  <div style="margin:8px 0;">
                    <span style="font-size:30px;font-weight:900;color:${rateColor};font-family:monospace;white-space:nowrap;">${rate.toFixed(1)}%</span>
                    <span style="font-size:12px;font-weight:600;color:#64748b;margin-left:8px;white-space:nowrap;">（今年執行率 B/A）</span>
                  </div>
                  <!-- 視覺量表進度條 -->
                  <div style="width:100%;height:16px;background:#e2e8f0;border-radius:8px;overflow:hidden;margin:12px 0;">
                    <div style="width:${barPct}%;height:16px;background:${rateColor};border-radius:8px;"></div>
                  </div>
                  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;">
                    <tr style="background:#f8fafc;">
                      <td style="padding:8px 12px;border:1px solid #e2e8f0;color:#475569;font-weight:600;white-space:nowrap;">今年度核定預算 (A)</td>
                      <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;font-weight:800;color:#0f172a;white-space:nowrap;">NT$ ${sec.annualBudgetAmount.toLocaleString()}</td>
                    </tr>
                    <tr style="background:#ecfdf5;">
                      <td style="padding:8px 12px;border:1px solid #d1fae5;color:#065f46;font-weight:600;white-space:nowrap;">今年實際已動支 (B)</td>
                      <td style="padding:8px 12px;border:1px solid #d1fae5;text-align:right;font-family:monospace;font-weight:800;color:#065f46;white-space:nowrap;">NT$ ${sec.executedAmount.toLocaleString()}</td>
                    </tr>
                    <tr style="background:${isOver ? '#fef2f2' : '#eff6ff'};">
                      <td style="padding:8px 12px;border:1px solid #e2e8f0;color:${isOver ? '#b91c1c' : '#1e40af'};font-weight:600;white-space:nowrap;">
                        ${isOver ? '超出核定預算額度' : '尚餘可用預算額度'}
                      </td>
                      <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;font-weight:800;color:${isOver ? '#dc2626' : '#1d4ed8'};white-space:nowrap;">
                        NT$ ${Math.abs(sec.currentVarianceAmount).toLocaleString()}
                      </td>
                    </tr>
                  </table>
                </div>
              </td>

              <!-- 圖表二：當前預算差異分析 (B − A) -->
              <td style="width:52%;vertical-align:top;padding-left:10px;">
                <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#ffffff;">
                  <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
                    <tr>
                      <td style="font-size:14px;font-weight:800;color:#1e293b;white-space:nowrap;">⚖️ 圖表二：當前預算差異分析 (B − A)</td>
                      <td style="text-align:right;white-space:nowrap;">
                        <span style="display:inline-block;font-size:12px;font-weight:800;font-family:monospace;color:${isOver ? '#dc2626' : '#059669'};background:${isOver ? '#fef2f2' : '#ecfdf5'};padding:3px 10px;border-radius:8px;white-space:nowrap;">
                          ${isOver ? `+NT$ ${sec.currentVarianceAmount.toLocaleString()}（預算超支）` : `-NT$ ${Math.abs(sec.currentVarianceAmount).toLocaleString()}（預算結餘）`}
                        </span>
                      </td>
                    </tr>
                  </table>

                  <!-- 正負雙向差異發散圖表 (Diverging Bar) - 改用標準三欄 table 徹底杜絕 Gmail 直排跑字 -->
                  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:12px 0;">
                    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
                      <tr>
                        <td style="width:33.3%;text-align:left;font-size:11px;color:#059669;font-weight:700;white-space:nowrap;">
                          ◀ 預算結餘區 (B &lt; A)
                        </td>
                        <td style="width:33.4%;text-align:center;font-size:11px;color:#334155;font-weight:800;white-space:nowrap;">
                          ｜ 0 基準 (100% 預算線) ｜
                        </td>
                        <td style="width:33.3%;text-align:right;font-size:11px;color:#dc2626;font-weight:700;white-space:nowrap;">
                          預算超支區 (B &gt; A) ▶
                        </td>
                      </tr>
                    </table>
                    <table style="width:100%;border-collapse:collapse;height:24px;background:#e2e8f0;border-radius:6px;overflow:hidden;">
                      <tr>
                        <td style="width:50%;border-right:2px solid #475569;padding:0;vertical-align:middle;">
                          ${
                            !isOver
                              ? `<div style="margin-left:${100 - halfBarPct * 2}%;width:${halfBarPct * 2}%;height:18px;background:#10b981;border-radius:4px 0 0 4px;"></div>`
                              : ''
                          }
                        </td>
                        <td style="width:50%;padding:0;vertical-align:middle;">
                          ${
                            isOver
                              ? `<div style="width:${halfBarPct * 2}%;height:18px;background:#ef4444;border-radius:0 4px 4px 0;"></div>`
                              : ''
                          }
                        </td>
                      </tr>
                    </table>
                  </div>

                  <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:12px;table-layout:fixed;">
                    <tr>
                      <td style="width:34%;padding:10px 8px;border:1px solid #e2e8f0;background:#f8fafc;text-align:center;">
                        <div style="font-size:11px;color:#64748b;white-space:nowrap;">核定預算基準 (A)</div>
                        <div style="font-size:13px;font-weight:800;color:#0f172a;font-family:monospace;margin-top:4px;white-space:nowrap;">NT$ ${sec.annualBudgetAmount.toLocaleString()}</div>
                      </td>
                      <td style="width:34%;padding:10px 8px;border:1px solid #e2e8f0;background:#f8fafc;text-align:center;">
                        <div style="font-size:11px;color:#64748b;white-space:nowrap;">實際累計執行 (B)</div>
                        <div style="font-size:13px;font-weight:800;color:#059669;font-family:monospace;margin-top:4px;white-space:nowrap;">NT$ ${sec.executedAmount.toLocaleString()}</div>
                      </td>
                      <td style="width:32%;padding:10px 8px;border:1px solid #e2e8f0;background:${isOver ? '#fef2f2' : '#ecfdf5'};text-align:center;">
                        <div style="font-size:11px;color:${isOver ? '#b91c1c' : '#065f46'};white-space:nowrap;">差異占預算比 (B−A)/A</div>
                        <div style="font-size:13px;font-weight:800;color:${isOver ? '#dc2626' : '#059669'};font-family:monospace;margin-top:4px;white-space:nowrap;">
                          ${isOver ? '+' : '-'}${diffPct.toFixed(1)}%
                        </div>
                      </td>
                    </tr>
                  </table>
                </div>
              </td>
            </tr>
          </table>

          <!-- 圖表三：1～12 月份預算編列 vs 實際執行與累計執行率趨勢圖 -->
          <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#ffffff;margin-bottom:18px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
              <tr>
                <td style="font-size:14px;font-weight:800;color:#1e293b;white-space:nowrap;">
                  📈 圖表三：${fy} 年度 1～12 月份預算編列 vs 實際執行與累計執行率趨勢圖
                </td>
                <td style="text-align:right;font-size:11px;color:#64748b;white-space:nowrap;">
                  <span style="display:inline-block;width:10px;height:10px;background:#93c5fd;border:1px solid #60a5fa;margin-right:4px;vertical-align:middle;"></span>月度編列預算
                  <span style="display:inline-block;width:10px;height:10px;background:#10b981;margin-left:12px;margin-right:4px;vertical-align:middle;"></span>月度實際執行
                  <span style="display:inline-block;width:10px;height:10px;background:#4f46e5;margin-left:12px;margin-right:4px;vertical-align:middle;"></span>累計預算執行率 (%)
                </td>
              </tr>
            </table>
            <table style="width:100%;border-collapse:collapse;table-layout:fixed;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
              <tr>
                ${monthlyColsHtml}
              </tr>
            </table>
          </div>

          <!-- 圖表四：各會計科目預算執行率與當前預算差異圖表 -->
          <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px;background:#ffffff;">
            <div style="margin-bottom:10px;">
              <span style="font-size:13px;font-weight:800;color:#1e293b;">
                📊 圖表四：${escapeHtml(sec.title)} — 各會計科目預算執行率與當前預算差異圖表
              </span>
            </div>
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:#f1f5f9;font-size:11px;color:#475569;">
                  <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #cbd5e1;">會計科目名稱與核定／執行金額</th>
                  <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #cbd5e1;">今年度預算執行率長條圖 (B ÷ A)</th>
                  <th style="padding:8px 12px;text-align:right;border-bottom:1px solid #cbd5e1;">當前預算差異雙向長條圖 (B − A)</th>
                </tr>
              </thead>
              <tbody>
                ${categoryRowsHtml}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
    })
    .join('');

  const summaryBlockHtml = summary
    ? `<div style="margin:14px 0;background:#f8fafc;border:1px solid #cbd5e1;border-left:5px solid #0284c7;border-radius:8px;padding:12px 16px;">
        <div style="font-size:12px;font-weight:800;color:#0369a1;margin-bottom:6px;">📝 財會總體預算分析結論</div>
        <div style="font-size:13px;line-height:1.65;color:#1e293b;white-space:pre-line;">${escapeHtml(summary)}</div>
      </div>`
    : '';

  return `<div style="margin:16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans TC',sans-serif;">
    <div style="background:#0f2942;color:#ffffff;padding:16px 20px;border-radius:12px 12px 0 0;">
      <div style="font-size:11px;color:#93c5fd;font-weight:700;margin-bottom:4px;">
        TURING DRIVE ACCSYS｜${fy} 年度預算執行率與當前預算差異分析報告（共產出 ${input.sections.length} 份圖表報告）
      </div>
      <div style="font-size:18px;font-weight:800;color:#ffffff;">
        📊 ${title}
      </div>
      <div style="font-size:12px;color:#cbd5e1;margin-top:6px;">
        財會發佈人：${escapeHtml(input.senderName)} ｜ 📎 已隨信附上完整報告 PDF 檔案（內容與下方圖表完全一致）
      </div>
    </div>
    <div style="border:1px solid #cbd5e1;border-top:none;border-radius:0 0 12px 12px;padding:16px;background:#f8fafc;">
      ${summaryBlockHtml}
      ${sectionsHtml}
    </div>
  </div>`;
}

/**
 * 產生包含所有多選產出報告圖表（執行率量表、當前預算差異發散圖、1~12月趨勢柱狀折線圖、各會計科目圖表）之 PDF 檔案
 */
export async function generateBudgetAnalysisPdf(
  input: BuildBudgetAnalysisReportInput
): Promise<Uint8Array> {
  // Collect all text that will be rendered so pickFont checks glyph coverage
  const allTextSample = [
    input.reportTitle,
    input.executiveSummary,
    input.senderName,
    input.fiscalYear,
    ...input.sections.flatMap((s) => [
      s.title,
      s.scopeLabel,
      ...s.monthlyTrend.map((m) => m.label),
      ...s.categoryBreakdowns.map((c) => c.categoryName),
    ]),
    '年度預算執行率與當前預算差異分析報告財會總體預算分析結論圖表一二三四核定預算實際動支結餘超支會計科目月度編列累計發佈人時間頁',
  ].join('\n');

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontBytes = await pickFont(sanitizePdfText(allTextSample));
  const font = await doc.embedFont(fontBytes, { subset: false });

  const pageWidth = 595.28; // A4 Portrait width
  const pageHeight = 841.89; // A4 Portrait height
  const margin = 32;
  const contentWidth = pageWidth - margin * 2;

  let page: PDFPage = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const ensureSpace = (neededHeight: number) => {
    if (y - neededHeight < margin + 20) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  const drawSafeText = (
    text: string,
    x: number,
    yPos: number,
    size: number,
    color = rgb(0.08, 0.12, 0.2),
    targetPage: PDFPage = page
  ) => {
    const clean = sanitizePdfText(text);
    if (!clean) return;
    targetPage.drawText(clean, { x, y: yPos, size, font, color });
  };

  // ==================== 1. 報告主標題頂部橫幅 ====================
  const headerH = 64;
  page.drawRectangle({
    x: margin,
    y: y - headerH,
    width: contentWidth,
    height: headerH,
    color: rgb(0.06, 0.16, 0.26),
  });
  drawSafeText(
    `TURING DRIVE ACCSYS | ${input.fiscalYear} 年度預算執行率與當前預算差異分析報告`,
    margin + 14,
    y - 20,
    9,
    rgb(0.58, 0.77, 0.99)
  );
  drawSafeText(
    input.reportTitle,
    margin + 14,
    y - 40,
    14,
    rgb(1, 1, 1)
  );
  const nowStr = new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
  });
  drawSafeText(
    `財會發佈人：${input.senderName}   |   產出報告數：共 ${input.sections.length} 份   |   產出時間：${nowStr}`,
    margin + 14,
    y - 56,
    8.5,
    rgb(0.8, 0.86, 0.93)
  );
  y -= headerH + 12;

  // ==================== 2. 財會總體預算分析結論（若有填寫則繪製完整區塊） ====================
  const cleanSummary = sanitizePdfText(input.executiveSummary || '');
  if (cleanSummary.length > 0) {
    const wrappedLines = wrapText(cleanSummary, 52);
    const boxH = 28 + wrappedLines.length * 14 + 10;
    ensureSpace(boxH + 10);

    page.drawRectangle({
      x: margin,
      y: y - boxH,
      width: contentWidth,
      height: boxH,
      color: rgb(0.97, 0.98, 0.99),
      borderColor: rgb(0.75, 0.82, 0.9),
      borderWidth: 1,
    });
    page.drawRectangle({
      x: margin,
      y: y - boxH,
      width: 4,
      height: boxH,
      color: rgb(0.01, 0.52, 0.78),
    });

    drawSafeText(
      '財會總體預算分析結論',
      margin + 12,
      y - 18,
      10.5,
      rgb(0.01, 0.4, 0.63)
    );
    let lineY = y - 34;
    for (const ln of wrappedLines) {
      drawSafeText(ln, margin + 12, lineY, 9.5, rgb(0.12, 0.16, 0.23));
      lineY -= 14;
    }
    y -= boxH + 14;
  }

  // ==================== 3. 依序繪製每一份多選產出的預算分析圖表報告 ====================
  for (let idx = 0; idx < input.sections.length; idx++) {
    const sec = input.sections[idx];
    // 若非第一份且剩餘空間不足放下標題與圖表一二三，直接換新頁確保排版整齊
    if (idx > 0 && y < 480) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    // --- (A) 該份報告對象橫幅 ---
    ensureSpace(165);
    const secHeaderH = 28;
    page.drawRectangle({
      x: margin,
      y: y - secHeaderH,
      width: contentWidth,
      height: secHeaderH,
      color: rgb(0.93, 0.96, 1),
      borderColor: rgb(0.75, 0.83, 0.95),
      borderWidth: 1,
    });
    drawSafeText(
      `[報告 ${idx + 1}/${input.sections.length}] ${input.fiscalYear} 年度圖表分析對象：${sec.title} (${sec.scopeLabel})`,
      margin + 10,
      y - 18,
      11,
      rgb(0.08, 0.24, 0.55)
    );
    y -= secHeaderH + 8;

    // --- (B) 圖表一（今年度預算執行率 B/A）與圖表二（當前預算差異 B-A）並排繪製 ---
    const cardGap = 10;
    const cardW = (contentWidth - cardGap) / 2;
    const cardH = 122;
    const isOver = sec.currentVarianceAmount > 0;
    const rate = sec.executionRatePct;
    const rateRgb =
      rate > 100
        ? rgb(0.86, 0.15, 0.15)
        : rate >= 85
          ? rgb(0.85, 0.47, 0.02)
          : rgb(0.02, 0.59, 0.41);

    // 左卡：圖表一
    page.drawRectangle({
      x: margin,
      y: y - cardH,
      width: cardW,
      height: cardH,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.85, 0.88, 0.92),
      borderWidth: 1,
    });
    drawSafeText(
      '圖表一：今年度預算執行率 (B / A)',
      margin + 10,
      y - 16,
      9.5,
      rgb(0.12, 0.16, 0.23)
    );
    drawSafeText(
      `${rate.toFixed(1)}%`,
      margin + 10,
      y - 38,
      18,
      rateRgb
    );
    drawSafeText(
      rate > 100
        ? '超支警示（已逾年度預算）'
        : rate >= 85
          ? '接近上限（高水位執行）'
          : '進度正常（執行控管良好）',
      margin + 92,
      y - 35,
      8.5,
      rateRgb
    );

    // 執行率視覺量表條
    const gaugeX = margin + 10;
    const gaugeY = y - 54;
    const gaugeW = cardW - 20;
    const gaugeH = 10;
    page.drawRectangle({
      x: gaugeX,
      y: gaugeY,
      width: gaugeW,
      height: gaugeH,
      color: rgb(0.9, 0.92, 0.95),
    });
    const fillW = Math.min(gaugeW, Math.max(2, (Math.min(100, rate) / 100) * gaugeW));
    page.drawRectangle({
      x: gaugeX,
      y: gaugeY,
      width: fillW,
      height: gaugeH,
      color: rateRgb,
    });

    drawSafeText(
      `今年度核定預算 (A)：NT$ ${sec.annualBudgetAmount.toLocaleString()}`,
      margin + 10,
      y - 74,
      8.5,
      rgb(0.2, 0.25, 0.33)
    );
    drawSafeText(
      `今年實際已動支 (B)：NT$ ${sec.executedAmount.toLocaleString()}`,
      margin + 10,
      y - 90,
      8.5,
      rgb(0.02, 0.45, 0.32)
    );
    drawSafeText(
      `${isOver ? '超出核定預算額度' : '尚餘可用預算額度'}：NT$ ${Math.abs(sec.currentVarianceAmount).toLocaleString()}`,
      margin + 10,
      y - 106,
      8.5,
      isOver ? rgb(0.86, 0.15, 0.15) : rgb(0.11, 0.31, 0.72)
    );

    // 右卡：圖表二
    const rightX = margin + cardW + cardGap;
    page.drawRectangle({
      x: rightX,
      y: y - cardH,
      width: cardW,
      height: cardH,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.85, 0.88, 0.92),
      borderWidth: 1,
    });
    drawSafeText(
      '圖表二：當前預算差異分析 (B - A)',
      rightX + 10,
      y - 16,
      9.5,
      rgb(0.12, 0.16, 0.23)
    );
    drawSafeText(
      isOver
        ? `+NT$ ${sec.currentVarianceAmount.toLocaleString()} (超支)`
        : `-NT$ ${Math.abs(sec.currentVarianceAmount).toLocaleString()} (結餘)`,
      rightX + 10,
      y - 36,
      13,
      isOver ? rgb(0.86, 0.15, 0.15) : rgb(0.02, 0.59, 0.41)
    );

    // 正負雙向發散長條圖 (Diverging Bar centered at 50%)
    const divX = rightX + 10;
    const divY = y - 62;
    const divW = cardW - 20;
    const divH = 14;
    page.drawRectangle({
      x: divX,
      y: divY,
      width: divW,
      height: divH,
      color: rgb(0.92, 0.94, 0.96),
    });
    const midX = divX + divW / 2;
    const diffRatio =
      sec.annualBudgetAmount > 0
        ? Math.min(1, Math.abs(sec.currentVarianceAmount) / sec.annualBudgetAmount)
        : 0;
    const barHalfLen = Math.max(3, diffRatio * (divW / 2));
    if (isOver) {
      page.drawRectangle({
        x: midX,
        y: divY + 2,
        width: barHalfLen,
        height: divH - 4,
        color: rgb(0.93, 0.26, 0.26),
      });
    } else {
      page.drawRectangle({
        x: midX - barHalfLen,
        y: divY + 2,
        width: barHalfLen,
        height: divH - 4,
        color: rgb(0.06, 0.72, 0.5),
      });
    }
    // 0 基準中線
    page.drawLine({
      start: { x: midX, y: divY - 2 },
      end: { x: midX, y: divY + divH + 2 },
      thickness: 1.5,
      color: rgb(0.25, 0.3, 0.38),
    });
    drawSafeText('預算結餘 (B<A)', divX, y - 76, 7.5, rgb(0.02, 0.55, 0.38));
    drawSafeText('0 基準', midX - 12, y - 76, 7.5, rgb(0.3, 0.35, 0.42));
    drawSafeText(
      '預算超支 (B>A)',
      divX + divW - 56,
      y - 76,
      7.5,
      rgb(0.86, 0.15, 0.15)
    );

    const diffPct =
      sec.annualBudgetAmount > 0
        ? ((sec.currentVarianceAmount / sec.annualBudgetAmount) * 100).toFixed(1)
        : '0.0';
    drawSafeText(
      `差異占核定預算比例 (B-A)/A：${isOver ? '+' : ''}${diffPct}%`,
      rightX + 10,
      y - 96,
      8.5,
      rgb(0.2, 0.25, 0.33)
    );
    drawSafeText(
      `涵蓋單位數：共 ${sec.unitCount} 個預算單位`,
      rightX + 10,
      y - 110,
      8,
      rgb(0.4, 0.45, 0.52)
    );

    y -= cardH + 10;

    // --- (C) 圖表三：1～12 月份預算編列 vs 實際執行與累計執行率趨勢圖 ---
    const chart3H = 148;
    ensureSpace(chart3H + 12);
    page.drawRectangle({
      x: margin,
      y: y - chart3H,
      width: contentWidth,
      height: chart3H,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.85, 0.88, 0.92),
      borderWidth: 1,
    });
    drawSafeText(
      `圖表三：${input.fiscalYear} 年度 1~12 月份預算編列 (淺藍) vs 實際執行 (綠) 與累計執行率折線 (紫)`,
      margin + 10,
      y - 16,
      9.5,
      rgb(0.12, 0.16, 0.23)
    );

    const plotLeft = margin + 36;
    const plotRight = margin + contentWidth - 28;
    const plotW = plotRight - plotLeft;
    const plotBottom = y - chart3H + 24;
    const plotTop = y - 34;
    const plotH = plotTop - plotBottom;

    // 水平參考網格線
    for (const r of [0, 0.5, 1]) {
      const gy = plotBottom + r * plotH;
      page.drawLine({
        start: { x: plotLeft, y: gy },
        end: { x: plotRight, y: gy },
        thickness: 0.5,
        color: rgb(0.88, 0.9, 0.93),
      });
      drawSafeText(
        `${Math.round(r * 100)}%`,
        plotRight + 4,
        gy - 3,
        7,
        rgb(0.31, 0.27, 0.9)
      );
    }

    const maxMonthVal = Math.max(
      1,
      ...sec.monthlyTrend.map((m) => Math.max(m.planned, m.executed))
    );
    const stepX = plotW / 12;
    const singleBarW = Math.min(11, stepX * 0.34);

    const linePts: Array<{ x: number; y: number; pct: number }> = [];

    sec.monthlyTrend.forEach((m, mIdx) => {
      const groupCenterX = plotLeft + stepX * mIdx + stepX / 2;
      const planH = Math.max(1.5, (m.planned / maxMonthVal) * plotH);
      const execH = Math.max(1.5, (m.executed / maxMonthVal) * plotH);

      // 編列柱 (淺藍)
      page.drawRectangle({
        x: groupCenterX - singleBarW - 1,
        y: plotBottom,
        width: singleBarW,
        height: planH,
        color: rgb(0.58, 0.77, 0.99),
      });
      // 執行柱 (綠或橘)
      page.drawRectangle({
        x: groupCenterX + 1,
        y: plotBottom,
        width: singleBarW,
        height: execH,
        color:
          m.executed > m.planned
            ? rgb(0.96, 0.62, 0.04)
            : rgb(0.06, 0.72, 0.5),
      });

      // 月份文字
      drawSafeText(
        m.label,
        groupCenterX - 8,
        plotBottom - 13,
        7.5,
        rgb(0.28, 0.33, 0.41)
      );

      const ptY =
        plotBottom + (Math.min(100, Math.max(0, m.cumRatePct)) / 100) * plotH;
      linePts.push({ x: groupCenterX, y: ptY, pct: m.cumRatePct });
    });

    // 繪製累計執行率折線
    for (let i = 0; i < linePts.length; i++) {
      if (i > 0) {
        page.drawLine({
          start: { x: linePts[i - 1].x, y: linePts[i - 1].y },
          end: { x: linePts[i].x, y: linePts[i].y },
          thickness: 1.5,
          color: rgb(0.31, 0.27, 0.9),
        });
      }
      drawSafeText(
        `${linePts[i].pct.toFixed(0)}%`,
        linePts[i].x - 7,
        Math.min(plotTop + 2, linePts[i].y + 4),
        6.5,
        rgb(0.26, 0.22, 0.79)
      );
    }

    y -= chart3H + 10;

    // --- (D) 圖表四：各會計科目預算執行率與當前預算差異圖表 ---
    ensureSpace(44);
    const catHeaderH = 22;
    page.drawRectangle({
      x: margin,
      y: y - catHeaderH,
      width: contentWidth,
      height: catHeaderH,
      color: rgb(0.95, 0.96, 0.98),
      borderColor: rgb(0.85, 0.88, 0.92),
      borderWidth: 1,
    });
    drawSafeText(
      `圖表四：${sec.title} — 各會計科目預算執行率 (B/A) 與當前預算差異 (B-A) 圖表`,
      margin + 10,
      y - 15,
      9,
      rgb(0.12, 0.16, 0.23)
    );
    y -= catHeaderH;

    const maxCatVal = Math.max(
      1,
      ...sec.categoryBreakdowns.map((c) =>
        Math.max(
          c.currentYearAmount,
          c.executedAmount,
          Math.abs(c.currentVarianceAmount)
        )
      )
    );

    for (const cat of sec.categoryBreakdowns) {
      const rowH = 32;
      ensureSpace(rowH + 6);
      page.drawRectangle({
        x: margin,
        y: y - rowH,
        width: contentWidth,
        height: rowH,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.9, 0.92, 0.95),
        borderWidth: 0.8,
      });

      // 欄 1：科目名稱與核定/執行金額
      drawSafeText(
        cat.categoryName,
        margin + 8,
        y - 13,
        8.5,
        rgb(0.08, 0.12, 0.2)
      );
      drawSafeText(
        `A: NT$ ${cat.currentYearAmount.toLocaleString()} | B: NT$ ${cat.executedAmount.toLocaleString()}`,
        margin + 8,
        y - 25,
        7.2,
        rgb(0.38, 0.44, 0.52)
      );

      // 欄 2：執行率長條圖
      const col2X = margin + 195;
      const col2W = 160;
      const catOver = cat.currentVarianceAmount > 0;
      const catRateColor =
        cat.executionRatePct > 100
          ? rgb(0.86, 0.15, 0.15)
          : cat.executionRatePct >= 85
            ? rgb(0.85, 0.47, 0.02)
            : rgb(0.02, 0.59, 0.41);

      drawSafeText(
        `執行率 (B/A): ${cat.executionRatePct.toFixed(1)}%`,
        col2X,
        y - 12,
        7.5,
        catRateColor
      );
      page.drawRectangle({
        x: col2X,
        y: y - 24,
        width: col2W,
        height: 7,
        color: rgb(0.91, 0.93, 0.96),
      });
      const catFillW = Math.min(
        col2W,
        Math.max(
          2,
          (cat.executedAmount / Math.max(1, cat.currentYearAmount)) * col2W
        )
      );
      page.drawRectangle({
        x: col2X,
        y: y - 24,
        width: catFillW,
        height: 7,
        color: catRateColor,
      });

      // 欄 3：當前預算差異雙向長條圖
      const col3X = margin + 370;
      const col3W = contentWidth - 378;
      drawSafeText(
        catOver
          ? `差異: +NT$ ${cat.currentVarianceAmount.toLocaleString()} (超支)`
          : `差異: -NT$ ${Math.abs(cat.currentVarianceAmount).toLocaleString()} (結餘)`,
        col3X,
        y - 12,
        7.5,
        catOver ? rgb(0.86, 0.15, 0.15) : rgb(0.02, 0.59, 0.41)
      );
      page.drawRectangle({
        x: col3X,
        y: y - 24,
        width: col3W,
        height: 7,
        color: rgb(0.91, 0.93, 0.96),
      });
      const catMidX = col3X + col3W / 2;
      const catHalfLen = Math.min(
        col3W / 2,
        Math.max(
          2,
          (Math.abs(cat.currentVarianceAmount) / maxCatVal) * (col3W / 2)
        )
      );
      if (catOver) {
        page.drawRectangle({
          x: catMidX,
          y: y - 24,
          width: catHalfLen,
          height: 7,
          color: rgb(0.93, 0.26, 0.26),
        });
      } else {
        page.drawRectangle({
          x: catMidX - catHalfLen,
          y: y - 24,
          width: catHalfLen,
          height: 7,
          color: rgb(0.06, 0.72, 0.5),
        });
      }
      page.drawLine({
        start: { x: catMidX, y: y - 25 },
        end: { x: catMidX, y: y - 16 },
        thickness: 1,
        color: rgb(0.35, 0.4, 0.48),
      });

      y -= rowH;
    }

    y -= 18;
  }

  // 為所有頁面加上頁碼頁尾
  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    drawSafeText(
      `TURING DRIVE ACCSYS 預算分析報告 — ${input.reportTitle}   |   第 ${idx + 1} / ${pages.length} 頁`,
      margin,
      16,
      8,
      rgb(0.45, 0.5, 0.58),
      p
    );
  });

  return doc.save();
}
