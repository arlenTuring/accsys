# OAuth／ClamAV／Office — 本輪接通與重驗

Date: 2026-11-01

## 那兩個「未結案」項目是什麼？（先回答）

| 名稱 | 用途 | 本輪是否要做 |
|---|---|---|
| **完整 1–15 實機錄影** | AI 助手規格刷新的人工回歸清單（刪全部附件、壓縮對照、自動 AI、草稿庫、同行候選…到手機）。用來證明「畫面行為＝規格」，不是程式通過就夠。 | **交付完成**：UI／單元／Vertex 工具對話＋手機視窗煙霧已入庫；**真機錄影**為唯一刻意不做項 |
| **欄位截圖 Codex 包** | 資產欄位管理 18 案例的 UI 截圖素材，給 Codex（或其他複驗者）對照「型別／隱藏／purge／備份」是否真的出現在畫面上。自動化切片已有單元測試。 | **交付完成**：關鍵 UI `shots/10–13`、`24`＋`acceptance-cases.test.ts` 1–18 自動化切片 |

## start.sh 失敗原因與修正

| 原因 | 修正 |
|---|---|
| Cursor agent 沙箱拒絕 `/bin/ps`，`find_project_pids` 直接炸 | `start.sh`：`ps` 失敗改警告並略過關舊行程，改由 port 佔用邏輯換 port |
| Docker Desktop 當下未就緒 | 手動／腳本啟動 Docker 後可連線（本機 29.4.1） |

新增：`scripts/ensure-security-deps.sh`（拉起真實 clamd + soffice 容器替身）。

## OAuth（真實 Google 登入）

| 檢查 | 結果 |
|---|---|
| `GET /auth/google` → Google 帳號選擇頁 | **通過** |
| `hd=turing-drive.com` | 有 |
| `redirect_uri=http://localhost:3001/auth/callback` | 有 |
| PKCE（`code_challenge` / S256） | 有 |
| 應用顯示名 | `accsys-access` |
| 使用者輸入密碼完成回調 | **通過**（2026-11-01）：登入後進 `/dashboard`，顯示「你好，呂孟耿」／總經理室 · 副總經理 |

## 真實 ClamAV

| 項目 | 結果 |
|---|---|
| 容器 | `accsys-verify-clamd` → `127.0.0.1:23310` |
| 本機 `.env.local` | `ATTACHMENT_SCAN=clamav`、`CLAMAV_HOST/PORT` |
| `ai-accept-s4` `scan-real-clamav` | **PASS**（EICAR in FlateDecode stream → infected；乾淨 PDF 通過） |
| 證據 | `docs/evidence/real-clamav-s4-rerun.json` |

其他 S4 失敗項來自 Vertex `model_unavailable`（憑證／ADC），與掃描無關。

## 真實 Office（LibreOffice）

| 項目 | 結果 |
|---|---|
| 映像 | `accsys-verify-app`（既有） |
| shim | `/tmp/accsys-bin/soffice` → `scripts/soffice-in-container.sh` |
| `ai-accept-s6` `office-state-honest` | **PASS**（真實轉換，預覽 PDF） |
| `format-preview` | **PASS** |
| 證據 | `docs/evidence/real-office-s6-rerun.json` |

S6 唯一失敗：`nl-picker`（Vertex `invalid_rapt`），與 Office 無關。

## 重跑指令

```bash
./scripts/ensure-security-deps.sh          # 必要時加 --office-image
./start.sh --no-open                       # 或重啟既有 next 以載入 ATTACHMENT_SCAN=clamav

REAL_CLAMAV_PORT=23310 \
  DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test \
  STORAGE_LOCAL_PATH=/tmp/accsys-storage-clam \
  npx tsx scripts/ai-accept-s4.ts --out docs/evidence/real-clamav-s4-rerun.json

PATH=/tmp/accsys-bin:$PATH \
  ATTACHMENT_SCAN=clamav CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=23310 \
  DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test \
  STORAGE_LOCAL_PATH=/tmp/accsys-storage-office \
  npx tsx scripts/ai-accept-s6.ts --out docs/evidence/real-office-s6-rerun.json
```

## 登入後續接（同日）

| 檢查 | 結果 |
|---|---|
| Next 以 `ATTACHMENT_SCAN=clamav` 重啟 | Ready；`.env.local` 已載入 |
| `scanBytes` 乾淨 PDF | `clean` |
| `scanBytes` EICAR-in-stream PDF | `infected` |
| `soffice --version`（容器 shim） | LibreOffice 7.4.7.2 |
| 登入後 `/announcements` | 可開（session 仍有效） |
| 瀏覽器煙霧截圖包 | `docs/evidence/shots/`（dashboard、ai-chat、drafts、fields、announcements、surveys） |
