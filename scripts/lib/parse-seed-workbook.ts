import * as XLSX from 'xlsx';

export type ParsedEmployee = {
  employeeCode: string;
  name: string;
  departmentName: string;
  departmentCode: string;
  managerName: string;
  title: string;
};

export type ParsedBudgetCode = {
  code: string;
  departmentCode: string;
  category: string;
  fiscalYear: string;
  annualBudgetAmount: number | null;
};

export type ParsedSupplier = {
  name: string;
  phone: string | null;
  email: string | null;
  contactName: string | null;
};

export type ParsedSeedWorkbook = {
  employees: ParsedEmployee[];
  budgetCodes: ParsedBudgetCode[];
  suppliers: ParsedSupplier[];
};

function cell(row: unknown[], index: number): string {
  return String(row[index] ?? '').trim();
}

export function parseSeedWorkbook(filePath: string): ParsedSeedWorkbook {
  const workbook = XLSX.readFile(filePath);

  const linkSheet = workbook.Sheets['link'];
  const linkRows: unknown[][] = XLSX.utils.sheet_to_json(linkSheet, {
    header: 1,
    raw: true,
  });

  const employees: ParsedEmployee[] = [];
  const budgetCodes: ParsedBudgetCode[] = [];

  for (const row of linkRows.slice(1)) {
    const employeeCode = cell(row, 1); // column B
    if (employeeCode !== '') {
      employees.push({
        employeeCode,
        name: cell(row, 2), // C
        departmentName: cell(row, 3), // D
        departmentCode: cell(row, 4), // E
        managerName: cell(row, 5), // F
        title: cell(row, 6), // G
      });
    }

    const budgetCode = cell(row, 22); // column W
    if (budgetCode !== '') {
      const fiscalYearMatch = budgetCode.match(/^\d{3}/);
      const rawAmount = row[24]; // column Y
      budgetCodes.push({
        code: budgetCode,
        departmentCode: cell(row, 18), // S
        category: cell(row, 21), // V
        fiscalYear: fiscalYearMatch ? fiscalYearMatch[0] : '',
        annualBudgetAmount: typeof rawAmount === 'number' ? rawAmount : null,
      });
    }
  }

  const supplierSheet = workbook.Sheets['供應商資料'];
  const supplierRows: unknown[][] = XLSX.utils.sheet_to_json(supplierSheet, {
    header: 1,
    raw: true,
  });

  const suppliers: ParsedSupplier[] = supplierRows
    .slice(1)
    .filter((row) => cell(row, 0) !== '')
    .map((row) => ({
      name: cell(row, 0),
      phone: cell(row, 1) || null,
      email: cell(row, 2) || null,
      contactName: cell(row, 3) || null,
    }));

  return { employees, budgetCodes, suppliers };
}
