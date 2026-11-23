import ExcelJS from 'exceljs';
import { ASSET_STATUS_LABELS, type AssetStatus } from '@/lib/asset-transfers/constants';
import { PROPERTY_REGISTER_COLUMNS } from '@/lib/assets/field-catalog';
import { PROPERTY_SHEET_NAME } from '@/lib/assets/parse-property-workbook';
import type { RegisterRow } from '@/lib/assets/queries';

function formatTimestampTw(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * 第 33、34、35 條：產生完整 23 欄（加上第 35 條雙階盤點簽認 4 欄）的《財產保管清冊》盤點用 Excel。
 * 第 4 列為標準表頭，欄位 1～23 與 `parsePropertyRegisterWorkbook` 完全相容，可直接匯回系統。
 */
export async function buildPropertyRegisterWorkbookBuffer(
  rows: RegisterRow[],
  meta?: { scopeLabel?: string; exportedBy?: string }
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TURING DRIVE ACCSYS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(PROPERTY_SHEET_NAME, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }],
  });

  // Row 1: Title
  sheet.getRow(1).values = ['台灣智慧駕駛股份有限公司 — 財產保管清冊暨盤點確認表（Excel 23 欄標準格式）'];
  sheet.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };

  // Row 2: Subtitle / export info
  const nowText = formatTimestampTw(new Date().toISOString());
  sheet.getRow(2).values = [
    `匯出時間：${nowText} ｜ 範圍：${meta?.scopeLabel ?? '全公司財產清冊'} ｜ 匯出人：${meta?.exportedBy ?? '系統'} ｜ 共 ${rows.length} 筆財產`,
  ];
  sheet.getRow(2).font = { size: 10, color: { argb: 'FF475569' } };

  // Row 3: Section banners
  const row3Values: string[] = new Array(27).fill('');
  row3Values[0] = '【一、帳務與基本財產資料（第 1～9 欄）】';
  row3Values[9] = '【二、盤點數量與保管資訊（第 10～19 欄）】';
  row3Values[19] = '【三、盤點判斷欄（第 20～23 欄）】';
  row3Values[23] = '【四、雙階盤點簽認紀錄（待確認人 → 檢核人）】';
  sheet.getRow(3).values = row3Values;
  sheet.getRow(3).font = { bold: true, size: 10, color: { argb: 'FF1E3A8A' } };

  // Row 4: Canonical 23 headers + 4 confirmation audit headers
  const headers = [
    ...PROPERTY_REGISTER_COLUMNS.map((c) => c.excelHeader),
    '待確認人確認時財產狀態',
    '待確認人及確認時間',
    '檢核人再確認狀態',
    '檢核人、確認時間與備註',
  ];
  const headerRow = sheet.getRow(4);
  headerRow.values = headers;
  headerRow.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.height = 30;
  headerRow.eachCell((cell, colNumber) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {
        argb: colNumber <= 19 ? 'FF1E3A8A' : colNumber <= 23 ? 'FF0F766E' : 'FF4338CA',
      },
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  // Data rows starting at row 5
  for (const r of rows) {
    const statusText = ASSET_STATUS_LABELS[r.status] ?? r.status;
    const confirmedStatusText = r.custodianConfirmedStatus
      ? (ASSET_STATUS_LABELS[r.custodianConfirmedStatus as AssetStatus] ?? r.custodianConfirmedStatus)
      : '';
    const custodianStamp = r.custodianConfirmedAt
      ? `${r.custodianConfirmedByName ?? r.custodianName}（${formatTimestampTw(r.custodianConfirmedAt)}）`
      : '尚未確認';
    const reviewerStageText =
      r.inventoryConfirmStage === 'reviewer_confirmed'
        ? '已複核確認'
        : r.inventoryConfirmStage === 'custodian_confirmed'
          ? '待檢核人確認'
          : '待保管人確認';
    const reviewerStamp = r.reviewerConfirmedAt
      ? `${r.reviewerConfirmedByName ?? '檢核人'}（${formatTimestampTw(r.reviewerConfirmedAt)}）${r.reviewerNote ? `｜${r.reviewerNote}` : ''}`
      : r.reviewerNote ?? '';

    const dataRow = sheet.addRow([
      r.accountingSubject || '', // 1. 會計科目
      statusText, // 2. 狀態
      r.tag, // 3. 財產編號
      r.acquiredOn || '', // 4. 取得時間
      r.voucherNo || '', // 5. 傳票編號
      r.itemKind || '', // 6. 項目種類
      r.name, // 7. 設備或生財器具名稱
      r.description || '', // 8. 說明
      r.quantity, // 9. 帳載數量
      r.physicalQuantity ?? r.quantity, // 10. 實盤數量
      r.unit || '', // 11. 單位
      r.custodyDepartmentName ?? r.custodianDepartment ?? '', // 12. 保管部門
      r.custodianName, // 13. 保管人
      r.location || '', // 14. 保管地點
      r.projectLabel || '', // 15. 專案
      r.remark || '', // 16. 備註
      r.tagAffixed || '', // 17. 已貼財編
      r.disposalVoucherNo || '', // 18. 已處分傳票編號
      r.changeRequest || '', // 19. 異動需求
      r.invMatchesBooks || '', // 20. 帳務是否與實際財產相符(V/X)
      r.invIdleDisposable || '', // 21. 是否已閒置且已無使用需要可出售或移轉(V/X)
      r.invUnusableScrap || '', // 22. 是否已不堪使用需報廢(V/X)
      r.invDispositionNote || '', // 23. 請註記如何處理(例如:捐贈、出售等)
      confirmedStatusText, // 24. 待確認人確認時財產狀態
      custodianStamp, // 25. 待確認人及確認時間
      reviewerStageText, // 26. 檢核人再確認狀態
      reviewerStamp, // 27. 檢核人、確認時間與備註
    ]);
    dataRow.alignment = { vertical: 'middle', wrapText: true };
  }

  const widths = [
    16, 12, 18, 13, 15, 14, 28, 26, 10, 10, 8, 16, 14, 18, 16, 22, 10, 16, 18, 16, 18, 16, 22, 16, 26, 16, 28,
  ];
  widths.forEach((w, idx) => {
    sheet.getColumn(idx + 1).width = w;
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
