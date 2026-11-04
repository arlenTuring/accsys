import fs from 'node:fs';
import path from 'node:path';
import { classifyFieldCounts } from '../src/lib/assets/field-catalog';
import { parsePropertyRegisterWorkbook } from '../src/lib/assets/parse-property-workbook';

async function main() {
  const file =
    process.argv[2] ||
    path.join(process.env.HOME || '', 'Downloads', '財產保管清冊-1150630.xlsx');
  const buf = fs.readFileSync(file);
  const res = await parsePropertyRegisterWorkbook(buf);
  console.log(
    JSON.stringify(
      {
        file,
        catalog: classifyFieldCounts(),
        sheet: res.sheetName,
        columns: res.columns.map((c) => c.label),
        unmatched: res.unmatchedHeaders,
        rows: res.rows.length,
        issueCount: res.issues.length,
        sampleIssues: res.issues.slice(0, 8),
        sampleRow: res.rows[0]
          ? {
              tag: res.rows[0].tag,
              name: res.rows[0].core.name,
              qty: res.rows[0].core.quantity,
              status: res.rows[0].core.status,
              custodian: res.rows[0].core.custodianLabel,
              dept: res.rows[0].core.custodyDepartmentLabel,
              acquired: res.rows[0].assetFields.acquired_on,
              voucher: res.rows[0].assetFields.voucher_no,
              physical: res.rows[0].inventory.physicalQuantity,
            }
          : null,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
