# ACCSYS 備份與還原

## 現況與目標

| 項目 | 目前已提供 | 目標（需公司確認） |
|---|---|---|
| 資料庫 | 每日 logical dump（`pg_dump -Fc`，單一一致快照） | 基礎備份 + WAL 歸檔（PITR），RPO ≤ 15 分鐘 |
| 附件 | 每日完整 tar，與 dump 同一備份組 | 與 DB 相同 RPO |
| 檢查 | SHA256SUMS；還原演練腳本核對 DB 與附件 | 每季異機還原 |
| 異機保存 | 需由主機管理員設定（下方範例） | 至少一份不與主機共用故障點或刪除權限 |

**目前 RPO 約 24 小時**（最近一次每日備份）。WAL／PITR 尚未實作：計畫採 pgBackRest，需在目標主機與儲存設備上驗證後再啟用，不自製備份框架。RTO 目標 4 小時需以實際演練時間確認。

## 備份組內容

`deploy/backup/backup.sh`（由 `backup` 一次性服務執行，`accsys_backup` 唯讀帳號）在 `ACCSYS_BACKUP_DIR` 建立：

```
20261013T023000Z/
  accsys.dump        pg_dump custom format（含結構、資料、權限）
  attachments.tar    附件目錄完整副本
  SHA256SUMS
```

- 先 dump 再打包附件：dump 中每筆附件紀錄指向的檔案都在 dump 開始前寫入。
- 寫到 `.partial-*` 暫存目錄，全部成功才改名；失敗不會留下半套備份，exit code 非 0。
- 本機保留 `BACKUP_KEEP_DAYS`（預設 14，至少 1）天；被強制中止而遺留的 `.partial-*` 目錄超過 24 小時會在下次備份時清除。
- 不含：機密檔、TLS 私鑰、`accsys.env`。這些由管理員另外保管（加密），還原時需要。

手動執行：`systemctl start accsys-backup.service` 或 `$DC run --rm backup`。

## 異機保存

本機 `backup` 目錄與 DB 在同一台主機，**不算**備份完成。每次備份後複製到公司 NAS／備份主機，例如 `/etc/accsys/offhost-copy.sh`（在 `accsys-backup.service` 取消 `ExecStartPost` 註解）：

```bash
#!/bin/sh
set -eu
latest=$(ls -d /srv/accsys/backup/20*Z | tail -1)
# 專用 SSH key，對端限制為只能寫入此目錄（例如 rrsync），本機無法刪除對端舊備份
rsync -a --chmod=go= -e "ssh -i /etc/accsys/offhost_ed25519" "$latest" backup@nas.internal:accsys/
```

- 對端保留天數與不可變（immutable／snapshot）設定由 NAS 管理員負責。
- 若異機儲存未加密，先以 `age`／`gpg` 加密再傳送；解密金鑰不放在 ACCSYS 主機。

## 還原演練（每季，必做）

在**另一台**主機或至少不影響正式容器的環境：

```bash
deploy/backup/restore-drill.sh /path/to/20261013T023000Z
```

腳本在無網路的拋棄式 PostgreSQL 容器中：

1. 驗證 `SHA256SUMS`。
2. 建立角色 → `pg_restore --exit-on-error` → 重新套用 `db/roles.sql`。
3. 確認 `accsys_app` 可讀業務表、不可刪除 `audit_events`（append-only trigger 仍在）。
4. 解開附件，逐筆核對可下載附件（`clean`／`unscanned`）的檔案存在且 sha256 相符。
5. 輸出 migrations、員工、附件、audit 筆數與最新 audit 時間，結束後刪除容器。

任何一步失敗 exit code 非 0。演練結果（日期、備份組、耗時、輸出）記入公司維運紀錄。

完整災難復原演練（每年至少一次，或換主機前）：在乾淨 VM 依 deployment.md 安裝 → 還原 DB 與附件 → 放回機密與憑證 → 以測試帳號登入並完成一筆測試簽核。這才算驗證 RTO。

## 正式還原（災難時）

1. 宣告維護、停止寫入：`$DC stop app`（proxy 會回 502）。
2. 保留現場：先對現有 pgdata／attachments 做一份副本（若磁碟仍可讀），不要直接覆蓋。
3. 選定備份組並先跑 `restore-drill.sh` 確認可用。
4. 建新的空資料目錄（例如 `/srv/accsys-restore/pgdata`，70:70 0700）與附件目錄，在 `accsys.env` 指向新路徑，`$DC up -d db`。
5. 還原：
   ```bash
   $DC exec -T db psql -X -U postgres -d accsys -v ON_ERROR_STOP=1 -c "create role accsys_owner nologin; create role accsys_migrator login; create role accsys_app login; create role accsys_backup login;"
   $DC exec -T db pg_restore --exit-on-error -U postgres -d accsys < 20261013T023000Z/accsys.dump
   $DC exec -T db psql -X -U postgres -d accsys -v ON_ERROR_STOP=1 -f /accsys/roles.sql
   $DC exec db psql -X -U postgres -d accsys          # \password 三個角色（與機密檔一致）
   tar -xf 20261013T023000Z/attachments.tar -C /srv/accsys-restore/attachments && chown -R 10001:10001 /srv/accsys-restore/attachments
   ```
6. `$DC run --rm migrate`（若備份來自較舊版本）→ `$DC up -d` → 驗收。
7. 通知使用者：備份時間點之後的單據需要重新送出；所有使用者需重新登入（`app_sessions` 會是備份當時的狀態，必要時執行 incident-response.md 的「全部登出」）。

## 已知限制

- 每日 dump 無法滿足 15 分鐘 RPO；PITR 啟用前，最多損失約一天的資料。
- 附件每次完整打包，容量隨附件總量線性成長；量大時改用 rsync 硬連結快照或 NAS 快照。
- dump 之後、打包之前被刪除的附件，在該備份組會缺檔；演練腳本會列出 `MISSING`，可從前一組備份取回。
- 備份不含機密與憑證；遺失機密檔時需重新產生並更新 DB 角色密碼與 Google OAuth client secret。
