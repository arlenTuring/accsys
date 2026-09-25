export type ToolDefinition = {
  id: string;
  href: string;
  title: string;
  description: string;
  status: 'ready' | 'soon';
  badge: string;
};

/** 工具區目錄：之後新增小工具只要加一筆即可 */
export const TOOL_CATALOG: ToolDefinition[] = [
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
