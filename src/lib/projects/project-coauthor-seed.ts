export type CoAuthorDocType = 'word' | 'excel' | 'ppt';

export type DocImageItem = {
  id: string;
  caption: string;
  prompt: string;
  dataUrl: string;
  createdAt: string;
};

export type WordSubSection = {
  id: string;
  code: string;
  title: string;
  content: string;
  headingId?: string;
  level?: 2 | 3;
};

export type WordSection = {
  id: string;
  code: string;
  title: string;
  content: string;
  headingId?: string;
  subSections?: WordSubSection[];
  notes?: string;
  images: DocImageItem[];
};

export type ExcelSheet = {
  id: string;
  name: string;
  columns: string[];
  rows: string[][];
};

export type PptSlide = {
  id: string;
  slideNumber: number;
  title: string;
  subtitle: string;
  bullets: string[];
  speakerNotes: string;
  layout: 'title_content' | 'two_column' | 'visual_split';
  images: DocImageItem[];
};

export type WordDocumentFormat = {
  fontFamily: 'Noto Sans TC' | 'Noto Serif TC' | 'Times New Roman' | 'Calibri';
  fontSizePt: number;
  lineSpacing: number;
  paragraphIndentEm: number;
  showTableOfContents: boolean;
  showPageNumbers: boolean;
  showHeaderFooter: boolean;
  headerText: string;
  footerText: string;
  pageNumberStyle: 'page_x_of_y' | 'numeric' | 'roman';
};

export const DEFAULT_WORD_FORMAT: WordDocumentFormat = {
  fontFamily: 'Noto Serif TC',
  fontSizePt: 12,
  lineSpacing: 1.75,
  paragraphIndentEm: 2,
  showTableOfContents: true,
  showPageNumbers: true,
  showHeaderFooter: true,
  headerText: '台灣智慧駕駛股份有限公司 · 工程施工規範與技術設計報告',
  footerText: 'Turing Drive Inc. Confidential · 專案正式交付文件',
  pageNumberStyle: 'page_x_of_y',
};

export type CoAuthorDocument = {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  title: string;
  docType: CoAuthorDocType;
  driveItemId?: string;
  driveUrl?: string;
  updatedAt: string;
  wordFormat?: WordDocumentFormat;
  wordSections?: WordSection[];
  excelSheets?: ExcelSheet[];
  pptSlides?: PptSlide[];
};

/**
 * Generates an SVG-based architectural / field-test / system illustration data URL
 * tailored to the user's prompt so generated visuals work reliably both online and offline,
 * and can also be upgraded by Vertex Imagen when available.
 */
export function buildProjectIllustrationDataUrl(opts: {
  title: string;
  subtitle: string;
  theme?: 'lidar_vehicle' | 'airport_t3' | 'fms_dashboard' | 'golf_cart' | 'general';
}): string {
  const safeTitle = opts.title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 42);
  const safeSub = opts.subtitle
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 68);

  const theme = opts.theme ?? 'general';

  const palette =
    theme === 'lidar_vehicle'
      ? { bg1: '#0f172a', bg2: '#1e3a8a', accent: '#38bdf8', badge: 'AUTOWARE / LiDAR 3D PERCEPTION' }
      : theme === 'airport_t3'
      ? { bg1: '#0c4a6e', bg2: '#0f172a', accent: '#2dd4bf', badge: 'TAOYUAN INT’L AIRPORT T3 PMS' }
      : theme === 'fms_dashboard'
      ? { bg1: '#111827', bg2: '#1e293b', accent: '#818cf8', badge: 'OCC FLEET CONTROL & TELEOP' }
      : theme === 'golf_cart'
      ? { bg1: '#064e3b', bg2: '#0f172a', accent: '#34d399', badge: 'SMART GOLF CART AUTONOMOUS' }
      : { bg1: '#0f172a', bg2: '#1e293b', accent: '#60a5fa', badge: 'TURING DRIVE PROJECT VISUAL' };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${palette.bg1}" />
        <stop offset="100%" stop-color="${palette.bg2}" />
      </linearGradient>
      <radialGradient id="radar" cx="50%" cy="55%" r="45%">
        <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.32" />
        <stop offset="65%" stop-color="${palette.accent}" stop-opacity="0.08" />
        <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="960" height="540" fill="url(#bg)" rx="18" />
    <!-- Perspective grid -->
    <g stroke="${palette.accent}" stroke-opacity="0.14" stroke-width="1">
      <line x1="0" y1="360" x2="960" y2="360" />
      <line x1="0" y1="410" x2="960" y2="410" />
      <line x1="0" y1="465" x2="960" y2="465" />
      <line x1="480" y1="260" x2="80" y2="540" />
      <line x1="480" y1="260" x2="280" y2="540" />
      <line x1="480" y1="260" x2="480" y2="540" />
      <line x1="480" y1="260" x2="680" y2="540" />
      <line x1="480" y1="260" x2="880" y2="540" />
    </g>
    <!-- LiDAR point cloud rings -->
    <circle cx="480" cy="310" r="210" fill="url(#radar)" stroke="${palette.accent}" stroke-opacity="0.28" stroke-dasharray="6 6" />
    <circle cx="480" cy="310" r="145" fill="none" stroke="${palette.accent}" stroke-opacity="0.4" stroke-dasharray="4 4" />
    <circle cx="480" cy="310" r="85" fill="none" stroke="${palette.accent}" stroke-opacity="0.65" />

    <!-- Autonomous Shuttle / Vehicle Wireframe -->
    <g transform="translate(350, 225)">
      <rect x="20" y="30" width="220" height="86" rx="22" fill="#0f172a" fill-opacity="0.88" stroke="${palette.accent}" stroke-width="2.5" />
      <rect x="42" y="44" width="76" height="40" rx="8" fill="${palette.accent}" fill-opacity="0.22" stroke="${palette.accent}" stroke-width="1.2" />
      <rect x="132" y="44" width="84" height="40" rx="8" fill="${palette.accent}" fill-opacity="0.22" stroke="${palette.accent}" stroke-width="1.2" />
      <!-- Roof Top LiDAR Puck -->
      <rect x="108" y="12" width="44" height="16" rx="5" fill="${palette.accent}" />
      <line x1="130" y1="12" x2="30" y2="-35" stroke="${palette.accent}" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="3 3" />
      <line x1="130" y1="12" x2="230" y2="-35" stroke="${palette.accent}" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="3 3" />
      <!-- Wheels -->
      <circle cx="68" cy="120" r="18" fill="#020617" stroke="${palette.accent}" stroke-width="3" />
      <circle cx="192" cy="120" r="18" fill="#020617" stroke="${palette.accent}" stroke-width="3" />
    </g>

    <!-- Telemetry & Architecture Callout Nodes -->
    <g font-family="system-ui, -apple-system, sans-serif">
      <rect x="52" y="135" width="215" height="72" rx="10" fill="#0f172a" fill-opacity="0.82" stroke="${palette.accent}" stroke-opacity="0.5" />
      <text x="68" y="162" fill="${palette.accent}" font-size="11" font-weight="700">SENSOR FUSION &amp; ODD</text>
      <text x="68" y="182" fill="#e2e8f0" font-size="12">3D LiDAR + RTK-GNSS + IMU</text>
      <text x="68" y="198" fill="#94a3b8" font-size="11">Position Accuracy &lt; 5 cm</text>

      <rect x="692" y="135" width="215" height="72" rx="10" fill="#0f172a" fill-opacity="0.82" stroke="${palette.accent}" stroke-opacity="0.5" />
      <text x="708" y="162" fill="${palette.accent}" font-size="11" font-weight="700">OCC &amp; V2X CONTROL</text>
      <text x="708" y="182" fill="#e2e8f0" font-size="12">5G Low-Latency Telemetry</text>
      <text x="708" y="198" fill="#94a3b8" font-size="11">Redundant Safety Braking</text>
    </g>

    <!-- Header & Title Overlay -->
    <rect x="44" y="34" width="280" height="28" rx="14" fill="${palette.accent}" fill-opacity="0.18" stroke="${palette.accent}" stroke-opacity="0.5" />
    <text x="60" y="53" fill="${palette.accent}" font-family="monospace" font-size="12" font-weight="700">${palette.badge}</text>

    <rect x="44" y="425" width="872" height="82" rx="14" fill="#020617" fill-opacity="0.78" stroke="#334155" />
    <text x="68" y="458" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="700">${safeTitle}</text>
    <text x="68" y="486" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="13">${safeSub}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const STARTER_COAUTHOR_DOCUMENTS: CoAuthorDocument[] = [
  {
    id: 'doc-t3-02584k-word',
    projectId: '2026-t3-projects',
    projectCode: 'T3-2026',
    projectName: 'T3 桃園機場第三航廈自駕運輸系統',
    title: '01_第02584K章 車輛行車管理系統_施工規範與設計報告.docx',
    docType: 'word',
    driveItemId: '1dQVfqQeBzvu0ezosoMUM09j1jDIYp15fVsRAiO8N3gY',
    driveUrl: 'https://docs.google.com/document/d/1dQVfqQeBzvu0ezosoMUM09j1jDIYp15fVsRAiO8N3gY/edit',
    updatedAt: '2026-04-16',
    wordFormat: {
      fontFamily: 'Noto Serif TC',
      fontSizePt: 12,
      lineSpacing: 1.75,
      paragraphIndentEm: 2,
      showTableOfContents: true,
      showPageNumbers: true,
      showHeaderFooter: true,
      headerText: '桃園國際機場第三航站區旅客運輸系統（T3 PMS）· 第 02584K 章施工規範',
      footerText: '台灣智慧駕駛股份有限公司 (Turing Drive Inc.) · 工程規範書',
      pageNumberStyle: 'page_x_of_y',
    },
    wordSections: [
      {
        id: 'sec-1',
        code: '1.1',
        title: '通則 General — 本章概要 Summary',
        content:
          '本章適用於「臺灣桃園國際機場第三航站區旅客運輸系統工程」之車輛行車管理系統（Vehicle Traffic Management System, VTMS），VTMS 作為本工程自駕旅客運輸車隊之核心管理平台，整合中心端控制、車端執行、資料紀錄與即時監控功能，透過標準化通訊協定與高可靠性架構，確保系統之營運安全、行車效率、服務可追溯性與調度彈性。\n\nVTMS 由以下三個主要子系統構成：\n1. 車輛巡航管理系統（中心端）\n2. 車載自動駕駛控制與監控單元（車端）\n3. 車對地雙向冗餘通訊與月台門安全連鎖介面',
        images: [],
      },
      {
        id: 'sec-2',
        code: '2.0',
        title: '自動駕駛定位與感知冗餘架構 (Perception & Localization)',
        content:
          '自駕接駁車隊於第三航廈專用高架與地下廊道運行時，採用多感測器融合定位（3D LiDAR NDT Matching + RTK-GNSS + 車輪里程計與 IMU 航位推算）。\n\n當地下廊道無衛星訊號時，系統依據預建高精點雲地圖與路側定位標記維持橫向偏差小於 ±5 cm、縱向停車精度於月台門基準線 ±10 cm 內。',
        images: [
          {
            id: 'img-init-1',
            caption: '圖 2-1：T3 自駕運輸車隊多感測器融合與行控雙向通訊架構圖',
            prompt: '桃園機場 T3 自駕接駁車感測器融合與 OCC 行控中心架構示意圖',
            dataUrl: buildProjectIllustrationDataUrl({
              title: 'T3 自駕接駁車多感測器融合與行控架構',
              subtitle: '3D LiDAR NDT + RTK-GNSS + 5G Redundant V2X Telemetry',
              theme: 'airport_t3',
            }),
            createdAt: '2026-04-16',
          },
        ],
      },
      {
        id: 'sec-3',
        code: '3.0',
        title: '班距調度、自動充電與異常接管 SOP (Dispatch & Fail-Operational SOP)',
        content:
          '1. 尖峰時段動態班距：行控中心依航班到離站旅客流量預測，自動調整發車班距（最短 90 秒一班）。\n2. 智慧充電排程：當車輛電池 SOC 低於 30% 時，FMS 自動派發回庫充電任務並由備援車輛無縫遞補。\n3. 異常遠端接管（Teleoperation）：遇路線障礙或感測器降級告警時，車輛立即執行最小風險操作（MRM）平穩減速停靠，並將多視角低延遲影像串流至行控台由授權控制員遠端確認或接管。',
        images: [],
      },
      {
        id: 'sec-4',
        code: '4.0',
        title: '資訊安全與系統驗收標準 (Cybersecurity & Acceptance Criteria)',
        content:
          '車載與行控通訊全面採用 TLS 1.3 雙向憑證驗證與訊息簽章機制，符合 ISO/SAE 21434 車聯網資安規範。系統出廠測試（FAT）與現場整合測試（SAT）需完成連續 72 小時無重大故障試運轉驗證。',
        images: [],
      },
    ],
  },
  {
    id: 'doc-t3-schedule-excel',
    projectId: '2026-t3-projects',
    projectCode: 'T3-2026',
    projectName: 'T3 桃園機場第三航廈自駕運輸系統',
    title: '時程表_20260316_雙週滾動里程碑與WBS追蹤表.xlsx',
    docType: 'excel',
    driveItemId: '1wiEayjDmsuI6s0qouLQGyw_ZZ6GNxom9',
    driveUrl: 'https://docs.google.com/spreadsheets/d/1wiEayjDmsuI6s0qouLQGyw_ZZ6GNxom9/edit',
    updatedAt: '2026-03-23',
    excelSheets: [
      {
        id: 'sheet-wbs',
        name: '1_主時程與WBS里程碑',
        columns: ['WBS 編號', '工作項目 / 交付物名稱', '負責模組', '預計開始', '預計完成', '目前進度', '狀態與備註'],
        rows: [
          ['WBS-1.1', '第 02584K 章施工規範與期末設計報告 (0B) 定稿', '系統工程 / 資通所', '2026-02-01', '2026-04-15', '100%', '已完成雙邊聯合審查'],
          ['WBS-1.2', 'FMS 行控中心營運全景圖台 UI/UX 設計與元件規範', 'MaaS / HMI 組', '2026-02-15', '2026-04-30', '85%', 'A~D 四大監控層驗證中'],
          ['WBS-2.1', '車載 Autoware 與底盤線控 (DBW) 安全連鎖介面開發', '自駕研發部 R&D', '2026-03-01', '2026-05-30', '60%', '完成實車 тормоз 雙迴路測試'],
          ['WBS-2.2', 'T3 高架與地下廊道 BIM 3D 點雲圖資轉換與定位驗證', '定位感知組', '2026-03-15', '2026-06-15', '45%', 'NWD 模型已匯入驗證'],
          ['WBS-3.1', '月台門 (PSD) 與交控號誌優先觸發連動整合測試', '場域工程組', '2026-05-01', '2026-07-31', '20%', '配合土建機電進場時程'],
          ['WBS-4.1', '現場整合測試 (SAT) 與 72 小時連續運行可靠度驗證', '全專案團隊', '2026-08-01', '2026-09-30', '0%', '預定 Q3 啟動現場聯測'],
        ],
      },
      {
        id: 'sheet-issue',
        name: '2_施工協調會列管追蹤',
        columns: ['列管編號', '議題摘要', '權責單位', '目標結案日', '辦理情形與對策'],
        rows: [
          ['1150303-1', '車輛製造品質計畫提送時程調整', '統包商 / 台智駕', '2026-04-30', '配合車輛細部設計審查，於 4 月底前正式提送核備'],
          ['1150303-2', 'T3PMS 北側道路管線、智慧桿與車站月台門施作介面', '場域工程 / 土建標', '2026-11-30', '修正細部施作時程網圖以配合相鄰標案界面'],
          ['1150303-3', '機場無線電網路計畫變更與分項施工計畫併送審', '通訊系統組', '2026-05-20', '納入 5G 專網與無線電備援頻段配置後併案提送'],
        ],
      },
    ],
  },
  {
    id: 'doc-t3-coord-ppt',
    projectId: '2026-t3-projects',
    projectCode: 'T3-2026',
    projectName: 'T3 桃園機場第三航廈自駕運輸系統',
    title: '桃園T3 PMS施工協調會20260309 V2.pptx',
    docType: 'ppt',
    driveItemId: '1fs5Kpu6kh9Lt_527Or-_CQiTh_CULw5B',
    driveUrl: 'https://docs.google.com/presentation/d/1fs5Kpu6kh9Lt_527Or-_CQiTh_CULw5B/edit',
    updatedAt: '2026-03-11',
    pptSlides: [
      {
        id: 'slide-1',
        slideNumber: 1,
        title: '桃園國際機場第三航站區旅客運輸系統 (T3 PMS)',
        subtitle: '2026 年度施工介面協調會暨車輛行車管理系統進度報告',
        bullets: [
          '報告單位：台灣智慧駕駛股份有限公司 (Turing Drive Inc.)',
          '涵蓋範圍：第 02584K 章車輛行車管理系統 (FMS)、車載自駕系統與路側介面',
          '關鍵目標：確保北側測試廊道、月台門連鎖與行控中心如期完成介面整合',
        ],
        speakerNotes: '開場說明本次施工協調會三大核心議題：規範定稿進度、歷次列管事項辦理回覆，以及 Q2-Q3 場域機電介面需求。',
        layout: 'visual_split',
        images: [
          {
            id: 'slide-img-1',
            caption: 'T3 PMS 自駕旅客運輸系統視覺架構',
            prompt: '桃園國際機場第三航廈 T3 PMS 自動駕駛接駁巴士與行控中心示意圖',
            dataUrl: buildProjectIllustrationDataUrl({
              title: '桃園機場 T3 PMS 自駕旅客運輸系統',
              subtitle: 'Autonomous Shuttle Fleet & OCC Central Dispatch System',
              theme: 'airport_t3',
            }),
            createdAt: '2026-03-11',
          },
        ],
      },
      {
        id: 'slide-2',
        slideNumber: 2,
        title: '歷次工作會議紀錄辦理情形回復說明 (1/2)',
        subtitle: '針對列管編號 1150303-1 ~ 1150303-3 之具體辦理對策',
        bullets: [
          '【1150303-1 車輛製造品質計畫】：遵照辦理，配合實車關鍵零組件規格審查，於 4 月底前正式提送。',
          '【1150303-2 北側道路管線與月台門界面】：已展開與土建及機電標之管線套繪，預計 115 年 11 月底前完成北側智慧桿與月台門管線施作。',
          '【1150303-3 機場無線電網路計畫變更】：已將車地通訊頻段與備援架構納入分項施工計畫併案送審。',
        ],
        speakerNotes: '向業主與總包商逐條說明前三項列管議題的具體完成時間點與配合事項。',
        layout: 'title_content',
        images: [],
      },
      {
        id: 'slide-3',
        slideNumber: 3,
        title: 'FMS 營運全景圖台與四層監控架構 (A~D 層)',
        subtitle: '整合即時車隊動態、旅客資訊 (PID)、資安監控與後勤維保',
        bullets: [
          'A. 營運監控層：即時顯示全車隊位置、車速、班距偏差、自動充電排程與一鍵遠端接管。',
          'B. 外部介面層：連動車站月台門 (PSD) 開閉狀態、交控號誌優先與站牌 PID 到站倒數。',
          'C. 資訊安全層：車聯網雙向憑證狀態、通訊延遲監測與異常連線即時阻斷告警。',
          'D. 後勤管理層：電池健康度 (SOH)、胎壓與感測器自檢狀態、預防性維保工單派發。',
        ],
        speakerNotes: '展示行控中心 HMI 四大機能分層，強調異常告警時的標準接管流程。',
        layout: 'visual_split',
        images: [
          {
            id: 'slide-img-3',
            caption: 'OCC 行控中心營運全景監控圖台',
            prompt: 'OCC 行控中心自駕車隊營運全景圖台與遠端監控儀表板',
            dataUrl: buildProjectIllustrationDataUrl({
              title: 'OCC 行控中心 A~D 四層全景監控圖台',
              subtitle: 'Real-Time Fleet Telemetry, PSD Sync, Cybersecurity & Maintenance',
              theme: 'fms_dashboard',
            }),
            createdAt: '2026-03-11',
          },
        ],
      },
    ],
  },
  {
    id: 'doc-tier4-lidar-word',
    projectId: '2026-tier-iv',
    projectCode: 'BD-TIER4',
    projectName: '1.[專案] TIER IV 短期專案',
    title: 'LiDAR-to-Vehicle_base_link_外參校正技術報告.docx',
    docType: 'word',
    driveItemId: '1BI5xMDwpxnI8Ochs1D6-MHKXYwHe1DJr',
    driveUrl: 'https://drive.google.com/file/d/1BI5xMDwpxnI8Ochs1D6-MHKXYwHe1DJr/view',
    updatedAt: '2026-03-09',
    wordFormat: {
      fontFamily: 'Noto Sans TC',
      fontSizePt: 11.5,
      lineSpacing: 1.65,
      paragraphIndentEm: 0,
      showTableOfContents: true,
      showPageNumbers: true,
      showHeaderFooter: true,
      headerText: 'TIER IV 短期專案 · LiDAR-to-Vehicle 外參校正技術報告',
      footerText: 'Turing Drive R&D · Autoware Sensor Calibration Spec',
      pageNumberStyle: 'page_x_of_y',
    },
    wordSections: [
      {
        id: 't4-sec-1',
        code: '1.0',
        title: '座標系定義與外參標定目標 (Coordinate Frames & Calibration Objective)',
        content:
          '本報告定義車體基準座標系（base_link，位於後軸中心地面投影點）與車頂主光達（velodyne_top）及左右盲區補盲光達（lidar_front_left / right）之 6-DoF 剛體轉換矩陣（Roll, Pitch, Yaw, X, Y, Z）。',
        images: [
          {
            id: 't4-img-1',
            caption: '圖 1-1：base_link 與多顆 3D LiDAR 座標轉換與點雲拼接示意圖',
            prompt: 'Autoware base_link 與多顆 LiDAR 感測器外參校正座標系示意圖',
            dataUrl: buildProjectIllustrationDataUrl({
              title: 'LiDAR-to-Vehicle (base_link) 6-DoF 外參標定',
              subtitle: 'Roll / Pitch / Yaw & Translation Matrix Convergence',
              theme: 'lidar_vehicle',
            }),
            createdAt: '2026-03-09',
          },
        ],
      },
      {
        id: 't4-sec-2',
        code: '2.0',
        title: '校正方法與收斂精度驗收標準 (Calibration Procedure & Acceptance)',
        content:
          '透過特徵平面標靶（棋盤格反射板與地面法向量約束）結合 ICP 點雲配準演算法進行聯合最佳化。\n\n驗收標準：\n- 角度誤差（Roll / Pitch / Yaw）：均方根誤差 (RMSE) ≤ 0.08°\n- 平移誤差（X / Y / Z）：均方根誤差 ≤ 1.5 cm\n- 30 公尺處多光達重疊區域點雲厚度偏差 ≤ 3.0 cm。',
        images: [],
      },
    ],
  },
];
