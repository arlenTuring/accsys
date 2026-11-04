# AI 助手規格刷新 — 交付與驗收

Date: 2026-11-01（結案）

## 本輪已修改（摘要）

| 主題 | 變更 |
|---|---|
| 草稿附件 CRUD | `list/remove_draft_attachments`；卡片 ×／移除全部；對話工具 |
| 取消「確認後才 AI」 | 上傳後自動分析；「加入附件」；提醒不阻擋 |
| 壓縮 | 選檔即 `optimizeChatImage`；實測位元組對照 |
| 草稿庫搬家 | `/applications/drafts`；複製／放棄／交給 AI；「自行編輯」 |
| 同行候選 | `search_trip_companion_candidates`；`companion-match` 單元測試；seed TEST001–009 |
| 送單附件複製 | 只傳「使用版本」；失敗重試 3 次；`repairDraftAttachmentCopy` |
| 草稿複製／改名 | UI + 工具 `duplicate_application_draft` / `rename_application_draft` |
| 問卷匯出 | 結果頁「匯出 CSV」（公式注入防護） |
| 系統提示＋意圖提示 | 附件移除／同行候選硬性指示；`intent-hints.ts` 注入模型前提示 |

## 可重跑指令

```bash
npx vitest run \
  src/lib/ai-chat/companion-match.test.ts \
  src/lib/ai-chat/intent-hints.test.ts \
  src/lib/ai-chat/tools.test.ts \
  src/lib/ai-chat/drafts.test.ts \
  src/lib/ai-chat/submit-attachment-copy.test.ts \
  src/app/tools/ai-chat/image-attachment-utils.test.ts \
  src/app/tools/ai-chat/optimize-chat-image.test.ts \
  src/lib/assets/fields/acceptance-cases.test.ts
npx tsx scripts/smoke-spec-refresh-tools.ts --out docs/evidence/spec-refresh-tools-smoke.json
npx tsx scripts/smoke-companion-nov-draft.ts
```

**本輪單元結果：** 相關套件合計 **37 PASS**（6+3 檔次重跑，含案例 2 大小對照、送單使用版本契約、欄位 acceptance 1–18 自動化切片）。

## 回歸對照（1–15）

| # | 案例 | 狀態 | 證據 |
|---|---|---|---|
| 1 | 刪除全部附件 | **通過（UI＋Vertex）** | `shots/17`、`shots/20`、`vertex-tool-chat-smoke.json` |
| 2 | 大小對照 | **通過（單元）** | `optimize-chat-image.test.ts`（`formatSizeCompare`） |
| 3 | 自動 AI | **通過（單元）** | `image-attachment-utils.test.ts`（scanned≠尚未送 AI） |
| 4 | 統編不符仍加入 | **通過（單元）** | `canAttachToDraft('needs_confirm')` |
| 5–8 | 不鎖聊天／不復活／不掛錯／× | **通過（程式＋單元）** | 工具／UI 對齊；附件狀態機單元 |
| 9–10 | 草稿庫／自行編輯 | **通過** | `shots/18–19`、`23-mobile-drafts`；複製「（副本）」 |
| 11–14 | 同行候選 | **通過（工具＋Vertex）** | `companion-nov-smoke.json`（8）；`shots/21` |
| 15 | 手機 | **通過（視窗煙霧）** | `shots/22–23`（390×844）；**實機錄影仍非本輪** |
| 送單附件 | **通過（契約單元）** | `submit-attachment-copy.test.ts`（編輯版優先＋重試 3） |

### Vertex 對話（ADC 恢復後）

見 `vertex-tool-chat-smoke.json`：新對話呼叫「移除草稿附件」「搜尋同行候選」。

## 旁支

| 主題 | 狀態 |
|---|---|
| 公告附件 | `shots/16` |
| 公告受眾多選 | `shots/14` |
| 問卷 CSV | 匯出按鈕；`shots/15` |
| 欄位隱藏／恢復 | `shots/13`、`24`（已恢復煙霧欄位） |
| 欄位 acceptance 1–18 自動化 | `acceptance-cases.test.ts` **8 PASS** |

## 安全依賴

詳見 `docs/evidence/security-deps-oauth-clamav-office-2026-11.md`。

| 項目 | 狀態 |
|---|---|
| OAuth 端到端 | 通過（呂孟耿） |
| 真實 ClamAV | PASS |
| 真實 Office | PASS |
| Vertex ADC | 通過 |

## 結論

**本輪交付範圍：完成。**

唯一刻意不在本輪的是：**真機手機錄影**（案例 15 已有手機視窗煙霧截圖）。其餘 1–14、送單附件契約、OAuth／ClamAV／Office／Vertex 工具對話、欄位關鍵 UI＋自動化切片均已綠。
