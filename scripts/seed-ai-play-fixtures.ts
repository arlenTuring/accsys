/**
 * Local play fixtures for AI chat: every migrated designer form gets
 *   1) one submission filed by --employee (pending with 0053 楊為任), and
 *   2) one submission filed by 0017 阮振瑋 waiting for that employee to approve.
 *
 * Usage:
 *   npx tsx scripts/seed-ai-play-fixtures.ts --employee-code 0054
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { and, asc, eq } from 'drizzle-orm';
import { addDays } from '../src/lib/seal-requests/validate';
import { taipeiToday } from '../src/lib/taipei-date';
import { MIGRATION_BATCHES } from '../src/lib/custom-forms/migrated';
import { installMigratedForm } from '../src/lib/custom-forms/migrated/install';
import * as customService from '../src/lib/custom-forms/service';
import { getDb } from '../src/lib/db';
import {
  approvalSteps,
  assets,
  budgetCodes,
  departments,
  employees,
  formDefinitions,
  formSubmissions,
  projectMembers,
  projects,
  suppliers,
} from '../src/lib/db/schema';

/** Bump when you need a fresh set (idempotent keys keep old rows otherwise). */
const SEED_NS_BASE = 'td-real-sim:v3';

const APPROVER = {
  id: '6880546b-058a-4004-bc50-46e072a924f1',
  employeeCode: '0053',
  name: '楊為任',
  googleEmail: 'nickyang@turing-drive.com',
};

const STAFF = {
  id: 'f7991f3d-47cc-4e58-9046-ac6e8d8db9de',
  employeeCode: '0017',
  name: '阮振瑋',
  googleEmail: 'wayne@turing-drive.com',
};

/** Real Turing Drive colleagues by form type for realistic cross-department simulation. */
const APPLICANT_CODE_BY_FORM: Record<string, string> = {
  'business-trip': '0017',       // 阮振瑋（自動駕駛系統部 工程經理）
  'purchase-request': '0046',    // 賴昭宇（車輛開發部 資深車輛開發工程師）
  'standalone-payment': '0075',  // 汪怡伶（管理部 行政總務專員）
  'general-seal': '0070',        // 劉君怡（營業行銷部 資深市場開發經理）
  'contract-seal': '0060',       // 張晏銘（產品部 產品經理）
  'invoice-seal': '0009',        // 許雲茹（管理部 行政財會）
  'department-expense': '0067',  // 蔡廷法（資料與雲端平台部 前端工程師）
  'minor-expense': '0056',       // 莊朝淵（車輛開發部 資深電子電機工程師）
  'project-expense': '0052',     // 莊育俊（產品部 資深產品經理）
  'revenue-expense': '0089',     // 楊庭瑋（營業行銷部 副理）
  'travel-expense': '0019',      // 呂京霖（自動駕駛系統部 主任工程師）
  'asset-transfer': '0017',      // 阮振瑋（自動駕駛系統部 工程經理）
};

const FIX_BUDGET = {
  id: '00000000-0000-0000-0000-00000000b001',
  code: '115ADSSE15',
};
const FIX_PRODUCT = {
  id: '00000000-0000-0000-0000-00000000c001',
  code: 'TD2601',
  name: '自駕巴士智慧座艙產品專案',
};
const FIX_REVENUE = {
  id: '00000000-0000-0000-0000-00000000c002',
  code: 'RV2601',
  name: '桃園機場自駕接駁營收專案',
};
const FIX_P_BUDGET = {
  id: '00000000-0000-0000-0000-00000000b002',
  code: '115TD2601PR01',
};
const FIX_R_BUDGET = {
  id: '00000000-0000-0000-0000-00000000b003',
  code: '115RV2601PR01',
};
function assetIdsFor(code: string) {
  // Stable UUIDs derived from employee code so each player gets own assets.
  const dig = (s: string, n: number) => {
    let h = n * 2654435761;
    for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
    return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
  };
  return {
    a1: { id: `00000000-0000-4000-8000-${dig(code, 1)}0001`, tag: `TD-EQ-${code}-01` },
    a2: { id: `00000000-0000-4000-8000-${dig(code, 2)}0002`, tag: `TD-EQ-${code}-02` },
    mine: [
      {
        id: `00000000-0000-4000-8000-${dig(code, 3)}0003`,
        tag: `TD-IT-${code}-01`,
        name: 'MacBook Pro 16" (M4 Max)',
        itemKind: '資訊設備',
        location: '台北辦公室 3F 自動駕駛系統部',
        unit: '台',
        remark: '研發主力開發筆電',
      },
      {
        id: `00000000-0000-4000-8000-${dig(code, 4)}0004`,
        tag: `TD-IT-${code}-02`,
        name: 'Dell UltraSharp 27" 4K 螢幕',
        itemKind: '資訊設備',
        location: '台北辦公室 3F 研發座位區',
        unit: '台',
        remark: '研發外接顯示器',
      },
      {
        id: `00000000-0000-4000-8000-${dig(code, 5)}0005`,
        tag: `TD-LAB-${code}-03`,
        name: '車載光達測試模組 (Velodyne Puck)',
        itemKind: '研發設備',
        location: '南港測試車庫 B1',
        unit: '組',
        remark: '自駕感知實車測試模組',
      },
    ],
  };
}

/** Forms that continue another form (need an approved source) — seed later if PR exists. */
const CHAIN_KEYS = new Set(['purchase-order', 'acceptance', 'procurement-payment']);

function assertLocalDatabase(url: string) {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(`Refusing to seed non-local database host: ${host}`);
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

async function ensureEmployee(
  deptId: string,
  person: { id: string; employeeCode: string; name: string; googleEmail: string }
) {
  const [existing] = await getDb()
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.employeeCode, person.employeeCode))
    .limit(1);
  if (existing) {
    person.id = existing.id;
    return;
  }
  const [inserted] = await getDb()
    .insert(employees)
    .values({
      employeeCode: person.employeeCode,
      name: person.name,
      departmentId: deptId,
      title: '工程經理',
      googleEmail: person.googleEmail,
      role: 'staff',
      accessEnabled: true,
      isGeneralManager: false,
      isChairman: false,
    })
    .returning({ id: employees.id });
  if (inserted) person.id = inserted.id;
}

async function ensureMaster(deptId: string, ownerId: string, memberIds: string[]) {
  const db = getDb();

  const [existingProd] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, FIX_PRODUCT.code)).limit(1);
  if (existingProd) {
    FIX_PRODUCT.id = existingProd.id;
    await db.update(projects).set({ name: FIX_PRODUCT.name, kind: 'product' }).where(eq(projects.id, FIX_PRODUCT.id));
  } else {
    const [ins] = await db
      .insert(projects)
      .values({ id: FIX_PRODUCT.id, code: FIX_PRODUCT.code, name: FIX_PRODUCT.name, kind: 'product' })
      .onConflictDoUpdate({ target: projects.id, set: { code: FIX_PRODUCT.code, name: FIX_PRODUCT.name, kind: 'product' } })
      .returning({ id: projects.id });
    if (ins) FIX_PRODUCT.id = ins.id;
  }

  const [existingRev] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, FIX_REVENUE.code)).limit(1);
  if (existingRev) {
    FIX_REVENUE.id = existingRev.id;
    await db.update(projects).set({ name: FIX_REVENUE.name, kind: 'revenue' }).where(eq(projects.id, FIX_REVENUE.id));
  } else {
    const [ins] = await db
      .insert(projects)
      .values({ id: FIX_REVENUE.id, code: FIX_REVENUE.code, name: FIX_REVENUE.name, kind: 'revenue' })
      .onConflictDoUpdate({ target: projects.id, set: { code: FIX_REVENUE.code, name: FIX_REVENUE.name, kind: 'revenue' } })
      .returning({ id: projects.id });
    if (ins) FIX_REVENUE.id = ins.id;
  }

  for (const pid of [FIX_PRODUCT.id, FIX_REVENUE.id]) {
    for (const mid of [ownerId, STAFF.id, ...memberIds]) {
      await db
        .insert(projectMembers)
        .values({ projectId: pid, employeeId: mid })
        .onConflictDoNothing();
    }
  }

  const [existingB] = await db.select({ id: budgetCodes.id }).from(budgetCodes).where(eq(budgetCodes.code, FIX_BUDGET.code)).limit(1);
  if (existingB) {
    FIX_BUDGET.id = existingB.id;
    await db.update(budgetCodes).set({ ownerEmployeeId: ownerId, annualBudgetAmount: '1500000' }).where(eq(budgetCodes.id, FIX_BUDGET.id));
  } else {
    await db
      .insert(budgetCodes)
      .values({
        id: FIX_BUDGET.id,
        code: FIX_BUDGET.code,
        departmentId: deptId,
        category: '雜項購置',
        fiscalYear: '115',
        annualBudgetAmount: '1500000',
        ownerEmployeeId: ownerId,
      })
      .onConflictDoUpdate({
        target: budgetCodes.id,
        set: { code: FIX_BUDGET.code, departmentId: deptId, category: '雜項購置', ownerEmployeeId: ownerId, annualBudgetAmount: '1500000' },
      });
  }

  const [existingPB] = await db.select({ id: budgetCodes.id }).from(budgetCodes).where(eq(budgetCodes.code, FIX_P_BUDGET.code)).limit(1);
  if (existingPB) {
    FIX_P_BUDGET.id = existingPB.id;
    await db.update(budgetCodes).set({ projectId: FIX_PRODUCT.id, ownerEmployeeId: ownerId, annualBudgetAmount: '500000' }).where(eq(budgetCodes.id, FIX_P_BUDGET.id));
  } else {
    await db
      .insert(budgetCodes)
      .values({
        id: FIX_P_BUDGET.id,
        code: FIX_P_BUDGET.code,
        projectId: FIX_PRODUCT.id,
        category: '材料費',
        fiscalYear: '115',
        annualBudgetAmount: '500000',
        ownerEmployeeId: ownerId,
      })
      .onConflictDoUpdate({
        target: budgetCodes.id,
        set: { code: FIX_P_BUDGET.code, projectId: FIX_PRODUCT.id, category: '材料費', ownerEmployeeId: ownerId, annualBudgetAmount: '500000' },
      });
  }

  const [existingRB] = await db.select({ id: budgetCodes.id }).from(budgetCodes).where(eq(budgetCodes.code, FIX_R_BUDGET.code)).limit(1);
  if (existingRB) {
    FIX_R_BUDGET.id = existingRB.id;
    await db.update(budgetCodes).set({ projectId: FIX_REVENUE.id, ownerEmployeeId: ownerId, annualBudgetAmount: '500000' }).where(eq(budgetCodes.id, FIX_R_BUDGET.id));
  } else {
    await db
      .insert(budgetCodes)
      .values({
        id: FIX_R_BUDGET.id,
        code: FIX_R_BUDGET.code,
        projectId: FIX_REVENUE.id,
        category: '材料費',
        fiscalYear: '115',
        annualBudgetAmount: '500000',
        ownerEmployeeId: ownerId,
      })
      .onConflictDoUpdate({
        target: budgetCodes.id,
        set: { code: FIX_R_BUDGET.code, projectId: FIX_REVENUE.id, category: '材料費', ownerEmployeeId: ownerId, annualBudgetAmount: '500000' },
      });
  }
}

async function ensureAssets(
  pair: ReturnType<typeof assetIdsFor>,
  actorEmployeeId: string,
  actorDepartmentId: string
) {
  const db = getDb();
  for (const a of [pair.a1, pair.a2]) {
    await db
      .insert(assets)
      .values({
        id: a.id,
        tag: a.tag,
        name: '高精準度 3D 光達感測器',
        custodianEmployeeId: STAFF.id,
        location: '南港測試車庫 B1',
      })
      .onConflictDoNothing();
  }
  for (const m of pair.mine) {
    await db
      .insert(assets)
      .values({
        id: m.id,
        tag: m.tag,
        name: m.name,
        itemKind: m.itemKind,
        location: m.location,
        unit: m.unit,
        remark: m.remark,
        custodianEmployeeId: actorEmployeeId,
        custodyDepartmentId: actorDepartmentId,
        status: 'in_custody',
      })
      .onConflictDoUpdate({
        target: assets.id,
        set: {
          name: m.name,
          itemKind: m.itemKind,
          location: m.location,
          unit: m.unit,
          remark: m.remark,
          custodianEmployeeId: actorEmployeeId,
          custodyDepartmentId: actorDepartmentId,
          status: 'in_custody',
        },
      });
  }
}

function sealDate() {
  return addDays(taipeiToday(), 5);
}

function expensePayee(supplierId: string) {
  return {
    payeeType: 'supplier',
    payeeSupplierId: supplierId,
    expectedPaymentDate: '2026-12-15',
    paymentMethod: 'transfer',
    remittanceInfo: '玉山商業銀行 內湖分行 台灣光電科技股份有限公司 0406940012345',
  };
}

function dataFor(
  key: string,
  title: string,
  supplierId: string,
  assetPair: { a1: { id: string; tag: string }; a2: { id: string; tag: string } }
): { data: Record<string, unknown>; fileCount: number } | null {
  const isApprove = title.includes('待我簽核');
  switch (key) {
    case 'business-trip':
      return {
        fileCount: 0,
        data: isApprove
          ? {
              tripStartAt: '2026-11-20T09:00',
              tripEndAt: '2026-11-20T18:00',
              location: '新竹縣竹北市（高鐵自駕測試場域）',
              purpose: '赴新竹竹北進行自駕巴士場域光達道路實測與車聯網 V2X 聯調',
              itinerary: '上午進行實車感測器校正與封閉場域測試，下午進行開放道路數據回收',
              advanceAmount: 0,
            }
          : {
              tripStartAt: '2026-11-24T09:30',
              tripEndAt: '2026-11-24T17:30',
              location: '桃園市大園區（桃園國際機場第三航廈專案辦公室）',
              purpose: '出席桃園國際機場第三航廈自駕旅客輸送系統（PMS）期中審查會議',
              itinerary: '上午與機場工程處檢討車隊調度系統介面，下午進行航廈地下專用道場勘',
              advanceAmount: 0,
            },
      };
    case 'purchase-request':
      return {
        fileCount: 0,
        data: {
          neededWithinDays: 14,
          items: {
            rows: isApprove
              ? [
                  {
                    budgetCodeId: FIX_BUDGET.id,
                    description: '車規級抗震 CAN Bus 通訊轉接模組與工業級線材組',
                    quantity: 2,
                    unitPrice: '17500',
                    estimatedAmount: '35000',
                  },
                ]
              : [
                  {
                    budgetCodeId: FIX_BUDGET.id,
                    description: '高精準度雙天線 RTK-GNSS 衛星定位接收模組（車隊備品）',
                    quantity: 1,
                    unitPrice: '42000',
                    estimatedAmount: '42000',
                  },
                ],
          },
        },
      };
    case 'standalone-payment':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_BUDGET.id,
          items: {
            rows: [
              isApprove
                ? { description: '自駕測試場域定位基站 4G/5G 通訊門號月租費', amount: '4800' }
                : { description: '南港測試車庫高壓充電樁年度安全檢測與校驗服務費', amount: '6500' },
            ],
          },
          ...expensePayee(supplierId),
        },
      };
    case 'general-seal':
      return {
        fileCount: 1,
        data: {
          urgency: 'normal',
          expectedCompletionDate: sealDate(),
          remark: isApprove
            ? '智慧交通場域設備建置與技術服務報價單用印申請'
            : '經濟部無人載具科技創新實驗計畫展延申請公文用印',
          documentType: isApprove ? 'quotation' : 'project_document',
          documentDescription: isApprove
            ? '桃園國際機場自駕接駁車隊技術維護服務報價單 1 份'
            : '沙崙智慧綠能科學城自駕實驗沙盒計畫期中報告函文 1 式 2 份',
          seals: isApprove ? ['invoice_seal'] : ['contract_seal'],
          lendSeal: false,
        },
      };
    case 'contract-seal':
      return {
        fileCount: 1,
        data: {
          urgency: 'normal',
          expectedCompletionDate: sealDate(),
          remark: '法務已審閱條款完畢，請准予用印',
          documentType: 'nda',
          seals: ['contract_seal'],
          lendSeal: false,
          periodStart: taipeiToday(),
          periodEnd: addDays(taipeiToday(), 365),
          totalAmount: 0,
          counterparty: isApprove ? '宏碁智通股份有限公司' : '中華電信股份有限公司企業客戶分公司',
          subject: isApprove
            ? '2026 年度智慧園區無人接駁車合作備忘錄（MOU）暨保密協議'
            : '5G 車聯網 C-V2X 低延遲遠端監控中心共同開發保密協議（NDA）',
          ndaChecks: ['mutual', 'ip_retained', 'penalty_reviewed'],
        },
      };
    case 'invoice-seal':
      return {
        fileCount: 1,
        data: {
          invoiceType: 'triplicate',
          seal: 'invoice_seal',
          customerName: isApprove ? '桃園國際機場股份有限公司' : '工業技術研究院',
          customerTaxId: isApprove ? '03707901' : '02750963',
          customerAddress: isApprove ? '桃園市大園區航站南路 9 號' : '新竹縣竹東鎮中興路四段 195 號',
          customerPhone: isApprove ? '03-2735081' : '03-5916000',
          currency: 'TWD',
          lines: {
            rows: [
              isApprove
                ? { itemName: '自駕接駁巴士系統第二期場域維運服務費', quantity: 1, unitPrice: '120000', amount: '120000' }
                : { itemName: '自駕感知融合演算法高精地圖驗證技術服務費', quantity: 1, unitPrice: '180000', amount: '180000' },
            ],
          },
          totalWithTax: isApprove ? '126000' : '189000',
        },
      };
    case 'department-expense':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_BUDGET.id,
          items: {
            rows: [
              isApprove
                ? { category: '郵電費', description: '自駕感知模型訓練雲端數據傳輸與車載通訊專線服務費', currency: 'TWD', amount: '24800' }
                : { category: '勞務費', description: '車隊遠端監控中心（OCC）AWS 雲端遙測資料庫與即時影像串流維運費', currency: 'TWD', amount: '31200' },
            ],
          },
          remark: isApprove
            ? '資料與雲端平台部 Q4 車載數據專線與雲端傳輸費用報支'
            : '總經理室跨部門雲端車隊監控平台月度雲端資源報支',
          payeeType: 'applicant',
          expectedPaymentDate: '2026-12-15',
          paymentMethod: 'transfer',
          remittanceInfo: isApprove
            ? '中國信託商業銀行 敦南分行 蔡廷法 1685-402-93817'
            : '玉山商業銀行 內湖分行 阮振瑋 0482-940-55102',
        },
      };
    case 'expense-claim':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_BUDGET.id,
          items: {
            rows: [
              isApprove
                ? {
                    category: '雲端服務費',
                    description: '自駕車隊高精點雲地圖雲端儲存與 OTA 派送流量費用',
                    quantity: 1,
                    currency: 'TWD',
                    amount: '18600',
                  }
                : {
                    category: '測試驗證費',
                    description: 'ARTC 財團法人車輛研究測試中心封閉場域電磁相容與道路實測分攤費',
                    quantity: 1,
                    currency: 'TWD',
                    amount: '26000',
                  },
            ],
          },
          remark: isApprove
            ? '自駕車雲端高精地圖版本派送服務月結報支'
            : '自駕系統封閉場域道路安全驗證費用報支',
          payeeType: 'applicant',
          expectedPaymentDate: '2026-12-15',
          paymentMethod: 'transfer',
          remittanceInfo: isApprove
            ? '台北富邦商業銀行 內湖分行 莊朝淵 7120-168-00492'
            : '玉山商業銀行 內湖分行 阮振瑋 0482-940-55102',
        },
      };
    case 'minor-expense':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_BUDGET.id,
          items: {
            rows: [
              isApprove
                ? {
                    category: '材料 (單筆新臺幣10,000元以下)',
                    description: '南港車庫實車感測器支架固定螺絲組與防水接頭耗材',
                    currency: 'TWD',
                    amount: '3850',
                  }
                : {
                    category: '材料 (單筆新臺幣10,000元以下)',
                    description: '車載工控機散熱導熱矽膠片與抗干擾磁環耗材一批',
                    currency: 'TWD',
                    amount: '2460',
                  },
            ],
          },
          remark: isApprove ? '車輛開發部實車組裝實驗室零星耗材採買報支' : '測試車隊工控機例行保養耗材採買報支',
          ...expensePayee(supplierId),
        },
      };
    case 'project-expense':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_P_BUDGET.id,
          items: {
            rows: [
              isApprove
                ? {
                    category: '材料 (單筆新臺幣10,000元以下)',
                    description: 'TD2601 自駕巴士智慧座艙觸控顯示面板訊號轉接線材',
                    currency: 'TWD',
                    amount: '6400',
                  }
                : {
                    category: '材料 (單筆新臺幣10,000元以下)',
                    description: 'TD2601 智慧座艙語音播報模組與車內環景鏡頭支架組',
                    currency: 'TWD',
                    amount: '8200',
                  },
            ],
          },
          remark: isApprove ? 'TD2601 智慧座艙專案車載螢幕整合材料費' : 'TD2601 智慧座艙專案乘客資訊顯示與語音互動硬體材料費',
          ...expensePayee(supplierId),
        },
      };
    case 'revenue-expense':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_R_BUDGET.id,
          items: {
            rows: [
              isApprove
                ? { category: '材料', description: 'RV2601 桃園機場自駕接駁車隊路側 RSU 天線防水外殼組', currency: 'TWD', amount: '18500' }
                : { category: '材料', description: 'RV2601 桃園機場航站接駁路線高反射率定位標誌牌與車擋組', currency: 'TWD', amount: '22600' },
            ],
          },
          remark: isApprove ? 'RV2601 桃園機場自駕接駁專案現場施工材料費' : 'RV2601 桃園機場自駕接駁專案場域安全標誌建置費',
          ...expensePayee(supplierId),
        },
      };
    case 'travel-expense':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_BUDGET.id,
          advanceAmount: '0',
          tripStartDate: isApprove ? '2026-11-10' : '2026-11-05',
          tripEndDate: isApprove ? '2026-11-11' : '2026-11-05',
          purpose: isApprove
            ? '台南沙崙智慧綠能科學城自駕測試場域實車驗證差旅報支'
            : '台中工業區智慧園區自駕接駁路線場勘與客戶技術訪談差旅報支',
          tripOrderNo: isApprove ? '20261108BT0019' : '20261028BT0004',
          companions: isApprove ? '何宗璟（0020）' : '張晏銘（0060）',
          reportItems: {
            rows: [
              isApprove
                ? { tripDate: '2026-11-10', location: '台南沙崙綠能科學城', itinerary: '自駕巴士定位校正與封閉道路聯調測試', timeSlot: '09:00-18:00' }
                : { tripDate: '2026-11-05', location: '台中市西屯區工業區', itinerary: '園區自駕接駁站點會勘與路線安全評估會議', timeSlot: '09:30-17:30' },
            ],
          },
          costItems: {
            rows: [
              isApprove
                ? {
                    expenseDate: '2026-11-10',
                    category: '交通費',
                    fromStation: '台北南港',
                    toStation: '台南沙崙',
                    summary: '台灣高鐵標準車廂來回車票',
                    currency: 'TWD',
                    amount: '2700',
                  }
                : {
                    expenseDate: '2026-11-05',
                    category: '交通費',
                    fromStation: '台北南港',
                    toStation: '台中烏日',
                    summary: '台灣高鐵標準車廂來回車票',
                    currency: 'TWD',
                    amount: '1400',
                  },
            ],
          },
        },
      };
    case 'asset-transfer':
      return {
        fileCount: 1,
        data: {
          useDepartmentId: null as unknown as string, // filled by caller
          useBudgetCodeId: FIX_BUDGET.id,
          transferTypes: ['custodian_change'],
          remark: '因支援南港車庫實車感知聯調，移交高精準度光達測試設備保管權責',
          items: {
            rows: [
              {
                assetId: isApprove ? assetPair.a2.id : assetPair.a1.id,
                reason: 'custodian_change',
                newCustodianEmployeeId: APPROVER.id,
                newLocation: '南港測試車庫 B1',
              },
            ],
          },
          originalCustodianEmployeeId: STAFF.id,
          newCustodianEmployeeId: APPROVER.id,
          otherCustodianEmployeeId: '',
        },
      };
    default:
      return null;
  }
}

async function main() {
  delete process.env.SMTP_HOST;
  process.env.DISABLE_EMAIL_DELIVERY = '1';
  process.env.STORAGE_LOCAL_PATH ||= './data/attachments';
  const dbUrl = process.env.DATABASE_URL || process.env.MIGRATION_DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL required');
  assertLocalDatabase(dbUrl);

  const employeeCode = arg('--employee-code') ?? '0054';
  const SEED_NS = `${SEED_NS_BASE}:${employeeCode}`;
  const db = getDb();
  const [actorEmp] = await db.select().from(employees).where(eq(employees.employeeCode, employeeCode)).limit(1);
  if (!actorEmp?.accessEnabled) throw new Error(`employee not found or disabled: ${employeeCode}`);
  console.log('player', actorEmp.employeeCode, actorEmp.name, actorEmp.id);
  console.log('seed_ns', SEED_NS);

  await ensureEmployee(actorEmp.departmentId, APPROVER);
  await ensureEmployee(actorEmp.departmentId, STAFF);

  // Load real Turing Drive colleagues so different forms are submitted by appropriate department staff
  const allActiveEmps = await db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      name: employees.name,
      departmentId: employees.departmentId,
    })
    .from(employees)
    .where(eq(employees.accessEnabled, true));
  const empByCode = new Map(allActiveEmps.map((e) => [e.employeeCode, e]));

  await ensureMaster(
    actorEmp.departmentId,
    actorEmp.id,
    allActiveEmps.map((e) => e.id)
  );
  const assetPair = assetIdsFor(actorEmp.employeeCode);
  await ensureAssets(assetPair, actorEmp.id, actorEmp.departmentId);

  const [supplier] = await db.select({ id: suppliers.id }).from(suppliers).orderBy(asc(suppliers.name)).limit(1);
  if (!supplier) throw new Error('no supplier in database — run seed:demo first');

  // Publish every migrated form (idempotent), excluding retired split expense forms.
  const { LEGACY_SPLIT_EXPENSE_KEYS } = await import('../src/lib/custom-forms/queries');
  for (const batch of Object.values(MIGRATION_BATCHES)) {
    for (const form of batch.forms) {
      if (LEGACY_SPLIT_EXPENSE_KEYS.has(form.key)) continue;
      await db.transaction(async (tx) => {
        const r = await installMigratedForm(tx, form, actorEmp.id, 'publish');
        console.log('form', form.key, r.outcome, r.note);
      });
    }
  }

  const allDepts = await db
    .select({ id: departments.id, managerEmployeeId: departments.managerEmployeeId })
    .from(departments);
  const originalManagers = new Map(allDepts.map((d) => [d.id, d.managerEmployeeId]));

  const published = await db
    .select({ key: formDefinitions.key, name: formDefinitions.name })
    .from(formDefinitions)
    .where(eq(formDefinitions.status, 'published'));
  const keys = published.map((p) => p.key).filter((k) => !CHAIN_KEYS.has(k));

  type Row = { key: string; role: 'mine' | 'approve'; formNumber: string; status: string; note: string };
  const rows: Row[] = [];

  const createOne = async (opts: {
    formKey: string;
    role: 'mine' | 'approve';
    applicantId: string;
    applicantDeptId: string;
    managerId: string;
    title: string;
  }) => {
    const packed = dataFor(opts.formKey, opts.title, supplier.id, assetPair);
    if (!packed) return { skipped: true as const, reason: 'no_template' };
    let data = { ...packed.data };
    if (opts.formKey === 'asset-transfer') {
      data = {
        ...data,
        useDepartmentId: actorEmp.departmentId,
        ...(opts.role === 'approve'
          ? {
              newCustodianEmployeeId: actorEmp.id,
              items: {
                rows: [
                  {
                    assetId: assetPair.a2.id,
                    reason: 'custodian_change',
                    newCustodianEmployeeId: actorEmp.id,
                    newLocation: '南港測試車庫 B1',
                  },
                ],
              },
            }
          : {}),
      };
    }

    await db
      .update(departments)
      .set({ managerEmployeeId: opts.managerId })
      .where(eq(departments.id, opts.applicantDeptId));

    const idem = `${SEED_NS}:${opts.role}:${opts.formKey}`;
    const created = await customService.createSubmission({ id: opts.applicantId }, opts.formKey, {
      data,
      fileCount: packed.fileCount,
      idempotencyKey: idem,
    });
    if (!created.ok) {
      return { skipped: true as const, reason: JSON.stringify(created) };
    }
    const [fs] = await db
      .select({ status: formSubmissions.status })
      .from(formSubmissions)
      .where(eq(formSubmissions.id, created.submissionId))
      .limit(1);
    return {
      skipped: false as const,
      formNumber: created.formNumber,
      status: fs?.status ?? 'unknown',
      replayed: Boolean(created.replayed),
      submissionId: created.submissionId,
    };
  };

  try {
    for (const key of keys) {
      const name = published.find((p) => p.key === key)?.name ?? key;

      const mine = await createOne({
        formKey: key,
        role: 'mine',
        applicantId: actorEmp.id,
        applicantDeptId: actorEmp.departmentId,
        managerId: APPROVER.id,
        title: `我送出的 ${name}`,
      });
      if (mine.skipped) {
        console.log('skip mine', key, mine.reason);
      } else {
        // Advance first gate on fresh multi-step chains so the stepper shows 已簽 / 簽核中 / 待簽.
        let progressNote = mine.replayed ? 'existing' : 'created';
        if (!mine.replayed && mine.status === 'pending_approval') {
          const steps = await db
            .select({
              id: approvalSteps.id,
              stepOrder: approvalSteps.stepOrder,
              status: approvalSteps.status,
            })
            .from(approvalSteps)
            .where(and(eq(approvalSteps.formType, 'custom'), eq(approvalSteps.formId, mine.submissionId)))
            .orderBy(asc(approvalSteps.stepOrder));
          if (steps.length >= 2 && steps[0]?.status === 'pending') {
            const first = steps[0];
            const next = steps[1]!;
            await db
              .update(approvalSteps)
              .set({
                status: 'approved',
                actedAt: new Date(),
                comment: '確認符合部門需求與預算項目，同意呈核。',
              })
              .where(eq(approvalSteps.id, first.id));
            await db
              .update(formSubmissions)
              .set({ currentStepOrder: next.stepOrder })
              .where(eq(formSubmissions.id, mine.submissionId));
            progressNote = `created; advanced_to_step_${next.stepOrder}`;
          }
        }
        rows.push({
          key,
          role: 'mine',
          formNumber: mine.formNumber,
          status: mine.status,
          note: progressNote,
        });
      }

      const preferredCode = APPLICANT_CODE_BY_FORM[key] ?? STAFF.employeeCode;
      const colleague =
        (preferredCode !== actorEmp.employeeCode ? empByCode.get(preferredCode) : null) ??
        empByCode.get(STAFF.employeeCode) ?? {
          id: STAFF.id,
          departmentId: actorEmp.departmentId,
        };

      const appr = await createOne({
        formKey: key,
        role: 'approve',
        applicantId: colleague.id,
        applicantDeptId: colleague.departmentId,
        managerId: actorEmp.id,
        title: `待我簽核 ${name}`,
      });
      if (appr.skipped) {
        console.log('skip approve', key, appr.reason);
      } else {
        // Confirm first pending is the player when possible.
        const [pending] = await db
          .select({
            approverEmployeeId: approvalSteps.approverEmployeeId,
            stepOrder: approvalSteps.stepOrder,
          })
          .from(approvalSteps)
          .where(
            and(
              eq(approvalSteps.formType, 'custom'),
              eq(approvalSteps.formId, appr.submissionId),
              eq(approvalSteps.status, 'pending')
            )
          )
          .orderBy(asc(approvalSteps.stepOrder))
          .limit(1);
        rows.push({
          key,
          role: 'approve',
          formNumber: appr.formNumber,
          status: appr.status,
          note: `${appr.replayed ? 'existing' : 'created'}; pending=${pending?.approverEmployeeId === actorEmp.id ? 'you' : pending?.approverEmployeeId ?? 'none'}`,
        });
      }
    }
  } finally {
    for (const [deptId, mgrId] of originalManagers.entries()) {
      await db
        .update(departments)
        .set({ managerEmployeeId: mgrId })
        .where(eq(departments.id, deptId));
    }
    console.log('dept_managers_restored', originalManagers.size);
  }

  console.log('\n=== AI play fixtures ===');
  for (const r of rows) {
    console.log(`${r.role.padEnd(8)} ${r.status.padEnd(16)} ${r.formNumber.padEnd(18)} ${r.key}  (${r.note})`);
  }
  console.log(`\nPlayer: ${actorEmp.employeeCode}. In AI chat try:`);
  console.log('  幫我看看有什麼還沒簽核的');
  console.log('  我送出去的單簽核到哪了');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
