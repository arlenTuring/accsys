# Asset register expansion — Phase 0 / 1 evidence

Date: 2026-10-31  
Source workbook: `/Users/arlen/Downloads/財產保管清冊-1150630.xlsx`  
Primary sheet: `1150630財產保管清冊` (header row 4)

## Phase 0 — current state

| Item | Result |
|---|---|
| Existing `assets` table | Fixed columns: tag, name, quantity, custodian, location, status, remark |
| Asset transfers / disposal | Present via `asset_transfers` (+ designer assetRegister) |
| Custom field defs / inventory batches | **Missing** before this work |
| Excel import | Narrow 7-column importer only (`parse-asset-workbook.ts`) |
| Permission `finance.assets` | Declared but register gated by `role === finance\|admin` only |
| AI asset tools | None (only form asset pickers) |
| Source sheet row count | ~232 assets with 財產編號 (scanned; trailing blanks ignored) |
| Other sheets | History / transfers / meeting notes — **not** merged into current register |

### 23 source columns → ownership

See `src/lib/assets/field-catalog.ts` (`classifyFieldCounts`).

- **Core (assets columns):** 狀態、財產編號、項目種類、名稱、說明、帳載數量、單位、保管部門、保管人、保管地點、備註
- **Asset configurable (extra_values / defs):** 會計科目、取得時間、傳票編號、專案、已貼財編、已處分傳票編號、異動需求
- **Inventory batch only:** 實盤數量 + 4 盤點判斷欄

## Phase 1 — delivered artefacts

| Artefact | Path |
|---|---|
| Migration | `drizzle/0038_asset_register_fields.sql` |
| Drizzle schema | `src/lib/db/schema.ts` (assets extensions + defs/batches/import/purge) |
| Permissions | `finance.assets_fields`, `finance.assets_fields_purge`, `assets.company_view`, `company.announcements`, `company.surveys`, `company.surveys_results` |
| Field catalog | `src/lib/assets/field-catalog.ts` |
| ROC date parser | `src/lib/assets/roc-date.ts` |
| Property workbook parser | `src/lib/assets/parse-property-workbook.ts` |
| Seed defs helper | `src/lib/assets/seed-field-definitions.ts` |
| Unit tests | `field-catalog.test.ts`, `roc-date.test.ts` |

## Acceptance Phase 1

| Check | Status |
|---|---|
| 23 columns have explicit core / asset_field / inventory ownership | PASS (catalog + unit test) |
| Master vs inventory separated in model | PASS (tables + storage_scope) |
| No dynamic DDL for admin fields | PASS (extra_values / answers JSONB) |
| Existing transfer flow schema untouched | PASS (additive migration only) |
| Real workbook dry-parse | PASS — 232 rows, unmatched headers 0; sample ROC `107/12/28` → `2018-12-28`; voucher kept as text `1228003`. 89 row issues are status variants (e.g. 保管中/待報廢、遺失) and `-` tristate — import UI must require fix, not guess. |
| Custody department independent column | PASS (`custody_department_id`) |

## Phase 2 (partial) — field editor

| Artefact | Path |
|---|---|
| Field service | `src/lib/assets/fields/service.ts` (create/update/hide/restore + version conflict) |
| Server actions | `src/lib/assets/fields/actions.ts` |
| UI | `/assets/fields` (`asset-field-manager.tsx`) — create with preview, rename, hide, restore, seed Excel defs |
| Link | `/assets` → 欄位管理 |

### Phase 2 acceptance so far

| Check | Status |
|---|---|
| Create field without deploy | PASS (UI + DB defs) |
| Rename keeps stableKey | PASS |
| Version conflict on concurrent update | PASS (service returns version_conflict) |
| Hide confirmation copy | PASS (confirm dialog text per spec) |
| Permanent delete flow | PASS (preview + name confirm + idempotent job + clears extra_values/answers; system_binding blocked) |
| Type-change impact preview | PARTIAL (blocks unsafe changes; text→date counts unconvertible) |
| Mobile polish for editor | PARTIAL (responsive grid; Phase 7 full) |
| Export backup before purge | PASS — purge 前必下載預覽；purge 寫入 `asset-field-purge/<jobId>.json` |
| Backup restore recognition of purge | PASS — `recognizePurgeFromBackup` + UI「辨識永久刪除備份」 |

## Commands

```bash
npm run db:migrate
npx vitest run src/lib/assets/
npx tsx scripts/dry-parse-property-workbook.ts
# UI: /assets/fields
```

## Not done yet (later phases)

Excel import confirm UI (Phase 4), my/dept assets + AI tools, announcements, surveys, mobile polish, full 18 field acceptance cases with screenshots.
