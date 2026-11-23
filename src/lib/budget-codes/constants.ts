/**
 * 標準會計科目與預算項目定義（依公司「部門預算表」、「營收.產品專案預算表」與「預算差異分析表」規範）
 *
 * 預算編號編碼規則（第 2 條）：
 *   `{民國年度}{部門代碼或專案代碼}{科目代碼}`
 *   例如：
 *   - 部門預算：`116ADSE01`（116 年度 + 管理部 AD + 薪資支出 SE01）
 *   - 專案預算：`116115BD001SE03` 或 `115BD001SE03`（專案代碼 + 科目代碼）
 */

export type StandardAccountCategory = {
  /** 預算項目代碼（例如 SE01 ~ SE23、SE99、PR01） */
  itemCode: string;
  /** 會計科目編號（8 碼，例如 69000101；專案營收則為 40000101） */
  accountNumber: string;
  /** 會計科目名稱（即預算類別名稱） */
  categoryName: string;
  /** 適用範圍：department（部門）、project（專案）、both（通用） */
  applicableTo: 'department' | 'project' | 'both';
  /** 科目說明／編列備註 */
  description: string;
};

export const STANDARD_ACCOUNT_CATEGORIES: readonly StandardAccountCategory[] = [
  {
    itemCode: 'PR01',
    accountNumber: '40000101',
    categoryName: '專案營收',
    applicableTo: 'project',
    description: '營收專案預計認列之合約／產品專案收入',
  },
  {
    itemCode: 'SE01',
    accountNumber: '69000101',
    categoryName: '薪資支出(應稅)',
    applicableTo: 'both',
    description: '本薪、主管加給、伙食津貼、加班費、獎金等人事薪資',
  },
  {
    itemCode: 'SE02',
    accountNumber: '69000301',
    categoryName: '租金支出',
    applicableTo: 'both',
    description: '辦公室租金、車位租金、場地及設備租賃費用',
  },
  {
    itemCode: 'SE03',
    accountNumber: '69000501',
    categoryName: '旅費',
    applicableTo: 'both',
    description: '國內外差旅交通、住宿、出差膳食補助等',
  },
  {
    itemCode: 'SE04',
    accountNumber: '69000601',
    categoryName: '運費',
    applicableTo: 'both',
    description: '設備載運、快遞物流、海空運及報關運費',
  },
  {
    itemCode: 'SE05',
    accountNumber: '69000701',
    categoryName: '郵電費',
    applicableTo: 'both',
    description: '郵資、電話費、網路通訊及車聯網 SIM 卡月租費',
  },
  {
    itemCode: 'SE06',
    accountNumber: '69000801',
    categoryName: '修繕費',
    applicableTo: 'both',
    description: '辦公室、車輛、感測設備及儀器維修保養費',
  },
  {
    itemCode: 'SE07',
    accountNumber: '69000901',
    categoryName: '廣告費',
    applicableTo: 'both',
    description: '展覽、行銷廣宣、媒體投放、發表會及印刷品',
  },
  {
    itemCode: 'SE08',
    accountNumber: '69001101',
    categoryName: '勞健保',
    applicableTo: 'both',
    description: '公司負擔之勞保、健保及二代健保補充保費',
  },
  {
    itemCode: 'SE09',
    accountNumber: '69001102',
    categoryName: '保險費',
    applicableTo: 'both',
    description: '團保、雇主責任險、產險、測試車輛保險及產品責任險',
  },
  {
    itemCode: 'SE10',
    accountNumber: '69001201',
    categoryName: '交際費',
    applicableTo: 'both',
    description: '客戶餐敘、拜訪伴手禮、婚喪喜慶花籃禮金',
  },
  {
    itemCode: 'SE11',
    accountNumber: '69001601',
    categoryName: '各項折舊',
    applicableTo: 'both',
    description: '公務車、電腦設備、研發測試設備及裝潢折舊',
  },
  {
    itemCode: 'SE12',
    accountNumber: '69001701',
    categoryName: '各項耗竭及攤提',
    applicableTo: 'both',
    description: '電腦軟體授權、專利權及無形資產攤提',
  },
  {
    itemCode: 'SE13',
    accountNumber: '69001901',
    categoryName: '職工福利',
    applicableTo: 'both',
    description: '部門聚餐、尾牙、三節禮品、健檢、下午茶及醫務室藥品',
  },
  {
    itemCode: 'SE14',
    accountNumber: '69002001',
    categoryName: '訓練費',
    applicableTo: 'both',
    description: '內外部教育訓練課程、研討會報名費及專業證照培訓',
  },
  {
    itemCode: 'SE15',
    accountNumber: '69002101',
    categoryName: '勞務費',
    applicableTo: 'both',
    description: '會計師／律師顧問費、外包開發、技術服務及認證檢測費',
  },
  {
    itemCode: 'SE16',
    accountNumber: '69000502',
    categoryName: '交通費',
    applicableTo: 'both',
    description: '市區公出車資、油資補助、過路費及停車費',
  },
  {
    itemCode: 'SE17',
    accountNumber: '69002201',
    categoryName: '雜項購置',
    applicableTo: 'both',
    description: '未達資本化門檻（8萬元以下）之零星設備、治具、耗材與零件購置',
  },
  {
    itemCode: 'SE18',
    accountNumber: '69000201',
    categoryName: '退休金',
    applicableTo: 'both',
    description: '勞退 6% 公司提撥退休金',
  },
  {
    itemCode: 'SE19',
    accountNumber: '69000401',
    categoryName: '文具用品',
    applicableTo: 'both',
    description: '辦公文具、紙張、碳粉匣及名片印製',
  },
  {
    itemCode: 'SE20',
    accountNumber: '69001001',
    categoryName: '水電瓦斯費',
    applicableTo: 'both',
    description: '辦公室及測試場域之水費、電費',
  },
  {
    itemCode: 'SE21',
    accountNumber: '69001301',
    categoryName: '捐贈',
    applicableTo: 'both',
    description: '公益捐贈及學術贊助',
  },
  {
    itemCode: 'SE22',
    accountNumber: '69002401',
    categoryName: '手續費',
    applicableTo: 'both',
    description: '銀行匯費、信用狀手續費、外幣結匯及代收付手續費',
  },
  {
    itemCode: 'SE23',
    accountNumber: '69002301',
    categoryName: '資訊服務費',
    applicableTo: 'both',
    description: '雲端算力（AWS/GCP）、SaaS 訂閱（GitHub/Slack/Notion/ERP）及網域憑證',
  },
  {
    itemCode: 'SE99',
    accountNumber: '69002501',
    categoryName: '雜費',
    applicableTo: 'both',
    description: '清潔費、書報雜誌、規費、印花稅及其他不屬上列之零星費用',
  },
] as const;

export const DEPARTMENT_ACCOUNT_CATEGORIES = STANDARD_ACCOUNT_CATEGORIES.filter(
  (c) => c.applicableTo === 'department' || c.applicableTo === 'both'
);

export const PROJECT_ACCOUNT_CATEGORIES = STANDARD_ACCOUNT_CATEGORIES;

const BY_ITEM_CODE = new Map(STANDARD_ACCOUNT_CATEGORIES.map((c) => [c.itemCode.toUpperCase(), c]));
const BY_ACCOUNT_NO = new Map(STANDARD_ACCOUNT_CATEGORIES.map((c) => [c.accountNumber, c]));
const BY_CATEGORY_NAME = new Map(STANDARD_ACCOUNT_CATEGORIES.map((c) => [c.categoryName, c]));

/** 根據科目代碼（如 SE03）、會計科目編號（如 69000501）或名稱查找標準科目定義 */
export function findStandardAccountCategory(input: string): StandardAccountCategory | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  return (
    BY_ITEM_CODE.get(trimmed.toUpperCase()) ??
    BY_ACCOUNT_NO.get(trimmed) ??
    BY_CATEGORY_NAME.get(trimmed) ??
    STANDARD_ACCOUNT_CATEGORIES.find(
      (c) => trimmed.includes(c.categoryName) || c.categoryName.includes(trimmed)
    )
  );
}

/**
 * 依據「民國年度 + 部門/專案代碼 + 科目代碼」自動產生標準預算編號
 * 例如：buildStandardBudgetCode({ fiscalYear: '116', unitCode: 'AD', itemCode: 'SE03' }) => '116ADSE03'
 */
export function buildStandardBudgetCode(params: {
  fiscalYear: string;
  unitCode: string;
  itemCode: string;
}): string {
  const fy = params.fiscalYear.trim();
  const unit = params.unitCode.trim();
  const item = params.itemCode.trim().toUpperCase();
  if (!unit || !item) return '';
  // 若專案代碼本身已含年度前綴（例如 115BD001、112BD003），或使用者輸入西元年如 2027 則轉為 116
  const rocYear =
    fy.length === 4 && Number(fy) > 1911 ? String(Number(fy) - 1911) : fy;
  if (/^\d{3}[A-Z]/i.test(unit)) {
    return `${unit}${item}`;
  }
  return `${rocYear}${unit}${item}`;
}
