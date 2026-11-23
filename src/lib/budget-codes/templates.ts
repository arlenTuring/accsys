import ExcelJS from 'exceljs';
import {
  DEPARTMENT_ACCOUNT_CATEGORIES,
  PROJECT_ACCOUNT_CATEGORIES,
  STANDARD_ACCOUNT_CATEGORIES,
  buildStandardBudgetCode,
} from './constants';

export type BudgetTemplateType =
  | 'flat'
  | 'department'
  | 'project'
  | 'variance';

export type TemplateDepartmentUnit = {
  code: string;
  name: string;
};

export type TemplateProjectUnit = {
  code: string;
  name: string;
  kind: 'product' | 'revenue';
};

const DEFAULT_DEPARTMENTS: TemplateDepartmentUnit[] = [
  { code: 'CO', name: '公司統籌(CO)' },
  { code: 'CEO', name: '執行長室(CEO)' },
  { code: 'AD', name: '管理部(AD)' },
  { code: 'S&M', name: '商務部(S&M)' },
  { code: 'PD', name: '產品企劃部(PD)' },
  { code: 'VD', name: '載具技術部(VD)' },
  { code: 'D&C', name: '數據與雲端技術部(D&C)' },
  { code: 'ADS', name: '自動駕駛技術部(ADS)' },
];

const DEFAULT_PROJECTS: TemplateProjectUnit[] = [
  { code: '115BD001', name: '次世代自駕平台產品專案(115BD001)', kind: 'product' },
  { code: '115BD002', name: '智慧園區接駁車營收專案(115BD002)', kind: 'revenue' },
];

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0F2D5C' },
};

const SUBHEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE2E8F0' },
};

const TOTAL_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF8FAFC' },
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = BORDER_THIN;
  });
  row.height = 24;
}

/**
 * 1. 標準批次匯入清單範本（含歷年實績與年度預算欄位）
 */
async function buildFlatBudgetTemplate(fiscalYear = '116'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('預算編號匯入範本');
  const prevRocYear = String(Math.max(100, (Number(fiscalYear) || 116) - 1));

  ws.columns = [
    { header: '預算編號', key: 'code', width: 18 },
    { header: '部門代碼', key: 'dept', width: 12 },
    { header: '專案代碼', key: 'proj', width: 14 },
    { header: '類別', key: 'category', width: 20 },
    { header: '年度', key: 'year', width: 10 },
    { header: '年度預算金額', key: 'amount', width: 18 },
    { header: '負責人工號', key: 'owner', width: 14 },
    { header: `歷年實際數(${prevRocYear}年)`, key: 'prevActual', width: 18 },
    { header: `歷年核定預算(${prevRocYear}年)`, key: 'prevBudget', width: 18 },
    { header: '會計科目編號', key: 'accountNo', width: 14 },
    { header: '說明備註', key: 'note', width: 28 },
  ];
  styleHeaderRow(ws.getRow(1));

  // 範例列：管理部 (AD) 前 5 項標準科目 + 1 筆專案範例
  for (const cat of DEPARTMENT_ACCOUNT_CATEGORIES.slice(0, 5)) {
    const r = ws.addRow({
      code: buildStandardBudgetCode({ fiscalYear, unitCode: 'AD', itemCode: cat.itemCode }),
      dept: 'AD',
      proj: '',
      category: cat.categoryName,
      year: fiscalYear,
      amount: 120000,
      owner: '0009',
      prevActual: 105000,
      prevBudget: 110000,
      accountNo: cat.accountNumber,
      note: cat.description,
    });
    r.eachCell({ includeEmpty: true }, (c) => {
      c.border = BORDER_THIN;
    });
  }

  // 附錄工作表：標準會計科目對照表
  const refSheet = wb.addWorksheet('標準會計科目對照表');
  refSheet.columns = [
    { header: '科目代碼', key: 'itemCode', width: 12 },
    { header: '會計科目編號', key: 'accountNumber', width: 16 },
    { header: '會計科目名稱（類別）', key: 'categoryName', width: 22 },
    { header: '適用範圍', key: 'scope', width: 14 },
    { header: '科目說明', key: 'description', width: 45 },
  ];
  styleHeaderRow(refSheet.getRow(1));
  for (const cat of STANDARD_ACCOUNT_CATEGORIES) {
    refSheet.addRow({
      itemCode: cat.itemCode,
      accountNumber: cat.accountNumber,
      categoryName: cat.categoryName,
      scope: cat.applicableTo === 'project' ? '專案專用' : '部門／專案通用',
      description: cat.description,
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * 2. 年度部門預算表-空白範本（完全對齊 2027年度部門預算表-空白V1.xlsx 格式）
 */
async function buildDepartmentWorkbookTemplate(
  fiscalYear = '2027',
  departments: TemplateDepartmentUnit[] = DEFAULT_DEPARTMENTS
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const rocYear = Number(fiscalYear) > 1911 ? String(Number(fiscalYear) - 1911) : fiscalYear;
  const westYear = Number(fiscalYear) > 1911 ? fiscalYear : String(Number(fiscalYear) + 1911);
  const prevWestYear = String(Number(westYear) - 1);

  const units = departments.length > 0 ? departments : DEFAULT_DEPARTMENTS;

  // Sheet 1: 預算總表(資訊統整)
  const summary = wb.addWorksheet('預算總表(資訊統整)');
  summary.addRow([`台灣智慧駕駛股份有限公司 ${westYear} 年度（${rocYear} 年）部門預算總表`]);
  summary.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF0F2D5C' } };
  summary.addRow(['部門代碼', '部門名稱', '科目代碼', '會計科目編號', '會計科目名稱', `${prevWestYear}年實際數`, `${westYear}年年度預算合計`, '負責人工號']);
  styleHeaderRow(summary.getRow(2));

  for (const dept of units) {
    const ws = wb.addWorksheet(dept.name.slice(0, 31));
    ws.addRow([`${dept.name} — ${westYear} 年度（民國 ${rocYear} 年）部門預算編列表`]);
    ws.getRow(1).font = { bold: true, size: 13, color: { argb: 'FF0F2D5C' } };
    ws.addRow([
      `部門代碼：${dept.code}`,
      `預算年度：${rocYear}`,
      '預算負責人工號：',
      '',
      '填表說明：請填寫 1~12 月預估金額（或直接填寫全年合計），系統支援直接將此工作簿匯入預算模組。',
    ]);
    ws.getRow(2).fill = SUBHEADER_FILL;

    const headers = [
      '會計科目編號',
      '會計科目名稱',
      '預算編號',
      '科目代碼',
      `${prevWestYear}年實際數(歷年參考)`,
      '1月',
      '2月',
      '3月',
      '4月',
      '5月',
      '6月',
      '7月',
      '8月',
      '9月',
      '10月',
      '11月',
      '12月',
      '全年預算合計',
      '編列說明／細項備註',
    ];
    const headerRow = ws.addRow(headers);
    styleHeaderRow(headerRow);

    ws.columns = [
      { width: 14 },
      { width: 20 },
      { width: 16 },
      { width: 10 },
      { width: 18 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 16 },
      { width: 28 },
    ];

    for (const cat of DEPARTMENT_ACCOUNT_CATEGORIES) {
      const budgetCode = buildStandardBudgetCode({
        fiscalYear: rocYear,
        unitCode: dept.code,
        itemCode: cat.itemCode,
      });
      const row = ws.addRow([
        cat.accountNumber,
        cat.categoryName,
        budgetCode,
        cat.itemCode,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        cat.description,
      ]);
      const rIdx = row.number;
      row.getCell(18).value = { formula: `SUM(F${rIdx}:Q${rIdx})`, result: 0 };
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = BORDER_THIN;
        if (colNumber >= 5 && colNumber <= 18) {
          cell.numFmt = '#,##0';
        }
      });

      summary.addRow([
        dept.code,
        dept.name,
        cat.itemCode,
        cat.accountNumber,
        cat.categoryName,
        0,
        0,
        '',
      ]);
    }

    const lastDataRow = ws.lastRow?.number ?? 3;
    const totalRow = ws.addRow([
      '合計',
      '部門費用總計',
      '',
      '',
      { formula: `SUM(E4:E${lastDataRow})`, result: 0 },
      { formula: `SUM(F4:F${lastDataRow})`, result: 0 },
      { formula: `SUM(G4:G${lastDataRow})`, result: 0 },
      { formula: `SUM(H4:H${lastDataRow})`, result: 0 },
      { formula: `SUM(I4:I${lastDataRow})`, result: 0 },
      { formula: `SUM(J4:J${lastDataRow})`, result: 0 },
      { formula: `SUM(K4:K${lastDataRow})`, result: 0 },
      { formula: `SUM(L4:L${lastDataRow})`, result: 0 },
      { formula: `SUM(M4:M${lastDataRow})`, result: 0 },
      { formula: `SUM(N4:N${lastDataRow})`, result: 0 },
      { formula: `SUM(O4:O${lastDataRow})`, result: 0 },
      { formula: `SUM(P4:P${lastDataRow})`, result: 0 },
      { formula: `SUM(Q4:Q${lastDataRow})`, result: 0 },
      { formula: `SUM(R4:R${lastDataRow})`, result: 0 },
      '',
    ]);
    totalRow.font = { bold: true };
    totalRow.fill = TOTAL_FILL;
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * 3. 年度營收.產品專案預算表-空白範本（完全對齊 2027年度營收.產品專案預算表-空白V1.xlsx 格式）
 */
async function buildProjectWorkbookTemplate(
  fiscalYear = '2027',
  projects: TemplateProjectUnit[] = DEFAULT_PROJECTS
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const rocYear = Number(fiscalYear) > 1911 ? String(Number(fiscalYear) - 1911) : fiscalYear;
  const westYear = Number(fiscalYear) > 1911 ? fiscalYear : String(Number(fiscalYear) + 1911);
  const prevWestYear = String(Number(westYear) - 1);

  const units = projects.length > 0 ? projects : DEFAULT_PROJECTS;

  const summary = wb.addWorksheet('預算總表(資訊統整)');
  summary.addRow([`台灣智慧駕駛股份有限公司 ${westYear} 年度（${rocYear} 年）營收／產品專案預算總表`]);
  summary.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF0F2D5C' } };
  summary.addRow(['專案代碼', '專案名稱', '專案類型', '科目代碼', '會計科目編號', '會計科目名稱', `${prevWestYear}年實際數`, `${westYear}年年度預算合計`, '負責人工號']);
  styleHeaderRow(summary.getRow(2));

  for (const proj of units) {
    const ws = wb.addWorksheet(`${proj.code}-${proj.name}`.slice(0, 31));
    ws.addRow([`專案預算表：${proj.code} ${proj.name}（${proj.kind === 'revenue' ? '營收專案' : '產品專案'}）`]);
    ws.getRow(1).font = { bold: true, size: 13, color: { argb: 'FF0F2D5C' } };
    ws.addRow([
      `專案代碼：${proj.code}`,
      `預算年度：${rocYear}`,
      '專案負責人工號：',
      '',
      '填表說明：PR01 為專案營收，SE01~SE99 為專案各項費用科目；填妥後可直接上傳匯入系統。',
    ]);
    ws.getRow(2).fill = SUBHEADER_FILL;

    const headers = [
      '會計科目編號',
      '會計科目名稱',
      '預算編號',
      '科目代碼',
      `${prevWestYear}年實際數(歷年參考)`,
      '1月',
      '2月',
      '3月',
      '4月',
      '5月',
      '6月',
      '7月',
      '8月',
      '9月',
      '10月',
      '11月',
      '12月',
      '全年預算合計',
      '編列說明／里程碑備註',
    ];
    styleHeaderRow(ws.addRow(headers));

    ws.columns = [
      { width: 14 },
      { width: 20 },
      { width: 18 },
      { width: 10 },
      { width: 18 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 11 },
      { width: 16 },
      { width: 28 },
    ];

    for (const cat of PROJECT_ACCOUNT_CATEGORIES) {
      const budgetCode = buildStandardBudgetCode({
        fiscalYear: rocYear,
        unitCode: proj.code,
        itemCode: cat.itemCode,
      });
      const row = ws.addRow([
        cat.accountNumber,
        cat.categoryName,
        budgetCode,
        cat.itemCode,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        cat.description,
      ]);
      const rIdx = row.number;
      row.getCell(18).value = { formula: `SUM(F${rIdx}:Q${rIdx})`, result: 0 };
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = BORDER_THIN;
        if (colNumber >= 5 && colNumber <= 18) {
          cell.numFmt = '#,##0';
        }
      });

      summary.addRow([
        proj.code,
        proj.name,
        proj.kind === 'revenue' ? '營收專案' : '產品專案',
        cat.itemCode,
        cat.accountNumber,
        cat.categoryName,
        0,
        0,
        '',
      ]);
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * 4. 年度預算差異分析表-空白範本（完全對齊 2027年度預算差異分析表-空白V1.xlsx 格式，含歷年比較）
 */
async function buildVarianceWorkbookTemplate(
  fiscalYear = '2027',
  departments: TemplateDepartmentUnit[] = DEFAULT_DEPARTMENTS
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const rocYear = Number(fiscalYear) > 1911 ? String(Number(fiscalYear) - 1911) : fiscalYear;
  const westYear = Number(fiscalYear) > 1911 ? fiscalYear : String(Number(fiscalYear) + 1911);
  const prevWestYear = String(Number(westYear) - 1);

  const units = [{ code: 'ALL', name: '全公司彙總' }, ...(departments.length > 0 ? departments : DEFAULT_DEPARTMENTS)];

  for (const unit of units) {
    const ws = wb.addWorksheet(unit.name.slice(0, 31));
    ws.addRow([`${unit.name} — ${westYear} 年度（${rocYear} 年）預算差異分析表（含 ${prevWestYear} 歷年比較）`]);
    ws.getRow(1).font = { bold: true, size: 13, color: { argb: 'FF0F2D5C' } };
    ws.addRow([
      `單位代碼：${unit.code}`,
      `比較基準：${prevWestYear} 年實際／核定 vs ${westYear} 年預算編列`,
      '',
      '',
      '差異達 ±10% 以上者請於「差異原因分析與說明」欄敘明原因。',
    ]);
    ws.getRow(2).fill = SUBHEADER_FILL;

    const headers = [
      '會計科目編號',
      '會計科目名稱',
      '預算編號',
      '科目代碼',
      `${prevWestYear}年核定預算(A)`,
      `${prevWestYear}年實際執行數(B)`,
      `${prevWestYear}年達成率(B/A)`,
      `${westYear}年編列預算數(C)`,
      `與去年實際差異金額(C-B)`,
      `與去年實際成長率((C-B)/B)`,
      '差異原因分析與說明',
    ];
    styleHeaderRow(ws.addRow(headers));

    ws.columns = [
      { width: 14 },
      { width: 20 },
      { width: 16 },
      { width: 10 },
      { width: 18 },
      { width: 18 },
      { width: 15 },
      { width: 18 },
      { width: 20 },
      { width: 18 },
      { width: 34 },
    ];

    for (const cat of DEPARTMENT_ACCOUNT_CATEGORIES) {
      const code =
        unit.code === 'ALL'
          ? `ALL-${cat.itemCode}`
          : buildStandardBudgetCode({ fiscalYear: rocYear, unitCode: unit.code, itemCode: cat.itemCode });
      const row = ws.addRow([
        cat.accountNumber,
        cat.categoryName,
        code,
        cat.itemCode,
        0,
        0,
        0,
        0,
        0,
        0,
        '',
      ]);
      const rIdx = row.number;
      row.getCell(7).value = { formula: `IF(E${rIdx}=0,0,F${rIdx}/E${rIdx})`, result: 0 };
      row.getCell(9).value = { formula: `H${rIdx}-F${rIdx}`, result: 0 };
      row.getCell(10).value = { formula: `IF(F${rIdx}=0,0,(H${rIdx}-F${rIdx})/F${rIdx})`, result: 0 };
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = BORDER_THIN;
        if ([5, 6, 8, 9].includes(colNumber)) cell.numFmt = '#,##0';
        if ([7, 10].includes(colNumber)) cell.numFmt = '0.0%';
      });
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function generateBudgetExcelTemplate(params: {
  type: BudgetTemplateType;
  fiscalYear?: string;
  departments?: TemplateDepartmentUnit[];
  projects?: TemplateProjectUnit[];
}): Promise<{ buffer: Buffer; filename: string }> {
  const fy = params.fiscalYear?.trim() || '2027';
  const rocYear = Number(fy) > 1911 ? String(Number(fy) - 1911) : fy;
  const westYear = Number(fy) > 1911 ? fy : String(Number(fy) + 1911);

  switch (params.type) {
    case 'department':
      return {
        buffer: await buildDepartmentWorkbookTemplate(westYear, params.departments),
        filename: `${westYear}年度部門預算表-空白V1.xlsx`,
      };
    case 'project':
      return {
        buffer: await buildProjectWorkbookTemplate(westYear, params.projects),
        filename: `${westYear}年度營收.產品專案預算表-空白V1.xlsx`,
      };
    case 'variance':
      return {
        buffer: await buildVarianceWorkbookTemplate(westYear, params.departments),
        filename: `${westYear}年度預算差異分析表-空白V1.xlsx`,
      };
    case 'flat':
    default:
      return {
        buffer: await buildFlatBudgetTemplate(rocYear),
        filename: `${rocYear}年度預算編號與歷年資料匯入範本.xlsx`,
      };
  }
}
