/** Server-only hints injected before the model sees the user turn. */
export function intentHintsForUserMessage(message: string): string[] {
  const hints: string[] = [];
  if (
    /刪除?\s*全部\s*附件|全部\s*附件\s*(刪除?|清掉?|移除)|清掉?\s*(全部)?附件|移除\s*全部\s*附件|附件\s*全部\s*(刪|清|移除)|把\s*全部\s*附件/.test(
      message,
    )
  ) {
    hints.push(
      '【系統意圖提示】使用者要求刪除／清除本草稿全部附件。必須呼叫 remove_draft_attachments（remove_all=true、帶 draft_id 與 expected_version）。禁止回覆無法透過對話刪除或叫使用者去右側垃圾桶。',
    );
  } else if (/刪除?\s*附件|移除\s*附件|拿掉\s*附件/.test(message)) {
    hints.push(
      '【系統意圖提示】使用者要移除草稿附件。先 list_draft_attachments；再 remove_draft_attachments（file_ids 或 remove_all）。禁止說系統不支援對話刪除。',
    );
  }
  if (/同行|一起出差|有沒有人.*出差|誰.*一起/.test(message)) {
    hints.push(
      '【系統意圖提示】使用者在問同行者。必須先呼叫 search_trip_companion_candidates（draft_id）；不可因本人公出單或草稿已填「無」就斷言沒有其他人。',
    );
  }
  if (/轉給|轉移|移交|過戶|資產異動|設備異動|保管人異動/.test(message)) {
    hints.push(
      [
        '【系統意圖提示】使用者要求將資產／設備轉移給他人或辦理資產異動。',
        '請直接建立或更新「資產異動申請單」（form_key="asset-transfer"），無須再問使用者是不是要填資產異動單，直接幫他開好草稿並打開右側面板！',
        'asset-transfer 欄位規格：',
        '- transferTypes（異動說明，複選）：填 ["保管人異動"]',
        '- originalCustodianEmployeeId（原保管人）：填當前登入員工姓名',
        '- newCustodianEmployeeId（新保管人）：填目標接收員工姓名（如 @標註的員工）',
        '- useDepartmentId（使用部門）：填新保管人所屬部門名稱',
        '- useBudgetCodeId（使用專案/客戶名稱）：若有已知預算代碼可填，若未知可留空待使用者補充',
        '- items（財產明細表格，用 rows: [{ op: "add", table: "items", cells: [...] }]）：',
        '  欄位包含 assetId（財產編號或設備名稱，可先呼叫 search_assets 查出名下資產 tag 如 TD-IT-0054-01）、reason（填 "保管人異動"）、newCustodianEmployeeId（填新保管人姓名）、newLocation（新保管地點，若使用者未提供可先留空並在回覆中提醒補充）。',
      ].join('\n'),
    );
  }
  return hints;
}
