export type ToolDefinition = {
  id: string;
  href: string;
  title: string;
  description: string;
  status: 'ready' | 'soon';
  badge: string;
};

/** 工具區目錄：AI 助手與專案助手皆已提升為左側主導覽，此處集中一般員工操作教學與實用輔助工具 */
export const TOOL_CATALOG: ToolDefinition[] = [
  {
    id: 'staff-guide',
    href: '/tools/guide',
    title: '操作教學（情境圖片流程＆Q&A）',
    description:
      '依帳號角色（一般使用者／財會人員／系統管理員）動態顯示可視範圍，提供今日情境圖片流程與一步一步圖解 Q&A。',
    status: 'ready',
    badge: '圖解教學',
  },
  {
    id: 'pdf-editor',
    href: '/tools/pdf-editor',
    title: 'PDF 編輯器',
    description: '上傳 PDF、疊加文字／圖章／螢光筆，匯出或依頁數拆分檔案。',
    status: 'ready',
    badge: '可用',
  },
  {
    id: 'coming-soon',
    href: '#',
    title: '更多工具',
    description: '之後可在此擴充表單小幫手、批次轉換、浮水印等實用功能。',
    status: 'soon',
    badge: '即將推出',
  },
];
