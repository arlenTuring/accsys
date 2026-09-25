/**
 * Inserts demo org + procurement data for local UI preview.
 * Safe to re-run: removes prior demo rows by fixed IDs first.
 *
 * Usage: npm run seed:demo
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

const IDS = {
  deptDev: '00000000-0000-0000-0000-000000000001',
  deptRd: '10000000-0000-0000-0000-000000000001',
  deptFin: '10000000-0000-0000-0000-000000000002',
  empDev: '00000000-0000-0000-0000-000000000002',
  empStaff: '10000000-0000-0000-0000-000000000010',
  empMgr: '10000000-0000-0000-0000-000000000011',
  empFinance: '10000000-0000-0000-0000-000000000012',
  supplier: '10000000-0000-0000-0000-000000000020',
  budgetRd: '10000000-0000-0000-0000-000000000030',
  budgetFin: '10000000-0000-0000-0000-000000000031',
  cases: [
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000006',
    '20000000-0000-0000-0000-000000000007',
  ],
};

const CASE_NUMBERS = [
  'CP115080001',
  'CP115080002',
  'CP115080003',
  'CP115080004',
  'CP115080005',
  'CP115080006',
  'CP115080007',
];

async function main() {
  await sql.begin(async (tx) => {
    // Remove prior demo procurement graph
    await tx`
      delete from notifications
      where case_number = any(${CASE_NUMBERS})
    `;
    await tx`
      delete from approval_steps
      where form_id in (
        select id from purchase_requests where procurement_case_id = any(${IDS.cases}::uuid[])
        union select id from purchase_orders where procurement_case_id = any(${IDS.cases}::uuid[])
        union select id from acceptances where procurement_case_id = any(${IDS.cases}::uuid[])
        union select id from expense_requests where procurement_case_id = any(${IDS.cases}::uuid[])
      )
    `;
    await tx`delete from expense_request_items where expense_request_id in (
      select id from expense_requests where procurement_case_id = any(${IDS.cases}::uuid[])
    )`;
    await tx`delete from expense_requests where procurement_case_id = any(${IDS.cases}::uuid[])`;
    await tx`delete from acceptance_items where acceptance_id in (
      select id from acceptances where procurement_case_id = any(${IDS.cases}::uuid[])
    )`;
    await tx`delete from acceptances where procurement_case_id = any(${IDS.cases}::uuid[])`;
    await tx`delete from purchase_order_items where purchase_order_id in (
      select id from purchase_orders where procurement_case_id = any(${IDS.cases}::uuid[])
    )`;
    await tx`delete from purchase_orders where procurement_case_id = any(${IDS.cases}::uuid[])`;
    await tx`delete from purchase_request_items where purchase_request_id in (
      select id from purchase_requests where procurement_case_id = any(${IDS.cases}::uuid[])
    )`;
    await tx`delete from purchase_requests where procurement_case_id = any(${IDS.cases}::uuid[])`;
    await tx`delete from procurement_cases where id = any(${IDS.cases}::uuid[])`;

    await tx`
      insert into departments (id, code, name)
      values
        (${IDS.deptRd}::uuid, 'RD', '研發部'),
        (${IDS.deptFin}::uuid, 'FIN', '財務部')
      on conflict (id) do update set code = excluded.code, name = excluded.name
    `;

    await tx`
      insert into employees (
        id, employee_code, name, department_id, title, google_email, role,
        is_general_manager, is_chairman
      ) values
        (
          ${IDS.empStaff}::uuid, 'E001', '林小明', ${IDS.deptRd}::uuid,
          '軟體工程師', 'staff@turing-drive.com', 'staff', false, false
        ),
        (
          ${IDS.empMgr}::uuid, 'E002', '王主管', ${IDS.deptRd}::uuid,
          '研發部經理', 'mgr@turing-drive.com', 'staff', false, false
        ),
        (
          ${IDS.empFinance}::uuid, 'E003', '陳財會', ${IDS.deptFin}::uuid,
          '財務專員', 'finance@turing-drive.com', 'finance', false, false
        )
      on conflict (id) do update set
        employee_code = excluded.employee_code,
        name = excluded.name,
        department_id = excluded.department_id,
        title = excluded.title,
        google_email = excluded.google_email,
        role = excluded.role,
        is_general_manager = excluded.is_general_manager,
        is_chairman = excluded.is_chairman
    `;

    await tx`
      update departments set manager_employee_id = ${IDS.empMgr}::uuid where id = ${IDS.deptRd}::uuid
    `;
    await tx`
      update departments set manager_employee_id = ${IDS.empFinance}::uuid where id = ${IDS.deptFin}::uuid
    `;
    await tx`
      update employees set
        name = '本機開發者',
        title = '資訊管理',
        is_general_manager = true,
        is_chairman = true
      where id = ${IDS.empDev}::uuid
    `;

    await tx`
      insert into suppliers (id, name, short_name, tax_id, contact_name, email)
      values (
        ${IDS.supplier}::uuid,
        '大誠科技股份有限公司',
        '大誠科技',
        '12345678',
        '李業務',
        'sales@dacheng.example'
      )
      on conflict (id) do update set name = excluded.name
    `;

    await tx`
      insert into budget_codes (
        id, code, department_id, category, owner_employee_id, fiscal_year, annual_budget_amount
      ) values
        (
          ${IDS.budgetRd}::uuid, '115RD001', ${IDS.deptRd}::uuid,
          '研發耗材', ${IDS.empMgr}::uuid, '115', 2500000
        ),
        (
          ${IDS.budgetFin}::uuid, '115FIN001', ${IDS.deptFin}::uuid,
          '行政費用', ${IDS.empFinance}::uuid, '115', 800000
        )
      on conflict (id) do update set
        code = excluded.code,
        category = excluded.category,
        owner_employee_id = excluded.owner_employee_id,
        annual_budget_amount = excluded.annual_budget_amount
    `;

    // --- Case 1: PR pending at department manager ---
    const pr1 = '21000000-0000-0000-0000-000000000001';
    await tx`
      insert into procurement_cases (id, case_number, created_by_employee_id)
      values (${IDS.cases[0]}::uuid, ${CASE_NUMBERS[0]}, ${IDS.empStaff}::uuid)
    `;
    await tx`
      insert into purchase_requests (
        id, procurement_case_id, applicant_employee_id, department_id,
        budget_owner_employee_id, total_amount, status, current_step_order, request_date
      ) values (
        ${pr1}::uuid, ${IDS.cases[0]}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, 28500, 'pending_approval', 1, current_date - 2
      )
    `;
    await tx`
      insert into purchase_request_items (
        purchase_request_id, line_no, budget_code_id, item_category, description, quantity, estimated_amount
      ) values (
        ${pr1}::uuid, 1, ${IDS.budgetRd}::uuid, '資訊設備',
        'USB-C 外接螢幕 x2', 2, 28500
      )
    `;
    await tx`
      insert into approval_steps (form_type, form_id, step_order, approver_employee_id, approver_role, status)
      values
        ('purchase_request', ${pr1}::uuid, 1, ${IDS.empMgr}::uuid, 'department_manager', 'pending'),
        ('purchase_request', ${pr1}::uuid, 2, ${IDS.empMgr}::uuid, 'budget_owner', 'pending'),
        ('purchase_request', ${pr1}::uuid, 3, ${IDS.empDev}::uuid, 'general_manager', 'pending')
    `;

    // --- Case 2: PR approved, PO pending at manager ---
    const pr2 = '21000000-0000-0000-0000-000000000002';
    const po2 = '22000000-0000-0000-0000-000000000002';
    await tx`
      insert into procurement_cases (id, case_number, created_by_employee_id)
      values (${IDS.cases[1]}::uuid, ${CASE_NUMBERS[1]}, ${IDS.empStaff}::uuid)
    `;
    await tx`
      insert into purchase_requests (
        id, procurement_case_id, applicant_employee_id, department_id,
        budget_owner_employee_id, total_amount, status, current_step_order, request_date
      ) values (
        ${pr2}::uuid, ${IDS.cases[1]}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, 52000, 'approved', null, current_date - 5
      )
    `;
    await tx`
      insert into purchase_request_items (
        purchase_request_id, line_no, budget_code_id, item_category, description, quantity, estimated_amount
      ) values (
        ${pr2}::uuid, 1, ${IDS.budgetRd}::uuid, '軟體授權',
        'JetBrains 團隊授權', 1, 52000
      )
    `;
    await tx`
      insert into purchase_orders (
        id, procurement_case_id, purchase_request_id, applicant_employee_id, department_id,
        budget_owner_employee_id, supplier_id, payment_method, payment_terms,
        total_amount, status, current_step_order
      ) values (
        ${po2}::uuid, ${IDS.cases[1]}::uuid, ${pr2}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, ${IDS.supplier}::uuid, '匯款', '月結30天',
        52000, 'pending_approval', 1
      )
    `;
    await tx`
      insert into purchase_order_items (
        purchase_order_id, line_no, budget_code_id, item_category, description, quantity, unit_price, total_price
      ) values (
        ${po2}::uuid, 1, ${IDS.budgetRd}::uuid, '軟體授權',
        'JetBrains All Products Pack', 1, 52000, 52000
      )
    `;
    await tx`
      insert into approval_steps (form_type, form_id, step_order, approver_employee_id, approver_role, status)
      values
        ('purchase_order', ${po2}::uuid, 1, ${IDS.empMgr}::uuid, 'department_manager', 'pending'),
        ('purchase_order', ${po2}::uuid, 2, ${IDS.empMgr}::uuid, 'budget_owner', 'pending'),
        ('purchase_order', ${po2}::uuid, 3, ${IDS.empDev}::uuid, 'general_manager', 'pending')
    `;

    // --- Case 3: Acceptance pending at GM (admin) ---
    const pr3 = '21000000-0000-0000-0000-000000000003';
    const po3 = '22000000-0000-0000-0000-000000000003';
    const poItem3 = '22100000-0000-0000-0000-000000000003';
    const acc3 = '23000000-0000-0000-0000-000000000003';
    await tx`
      insert into procurement_cases (id, case_number, created_by_employee_id)
      values (${IDS.cases[2]}::uuid, ${CASE_NUMBERS[2]}, ${IDS.empStaff}::uuid)
    `;
    await tx`
      insert into purchase_requests (
        id, procurement_case_id, applicant_employee_id, department_id,
        budget_owner_employee_id, total_amount, status, request_date
      ) values (
        ${pr3}::uuid, ${IDS.cases[2]}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, 88000, 'approved', current_date - 12
      )
    `;
    await tx`
      insert into purchase_request_items (
        purchase_request_id, line_no, budget_code_id, item_category, description, quantity, estimated_amount
      ) values (
        ${pr3}::uuid, 1, ${IDS.budgetRd}::uuid, '測試設備',
        'LiDAR 開發套件', 1, 88000
      )
    `;
    await tx`
      insert into purchase_orders (
        id, procurement_case_id, purchase_request_id, applicant_employee_id, department_id,
        budget_owner_employee_id, supplier_id, payment_method, payment_terms,
        total_amount, status
      ) values (
        ${po3}::uuid, ${IDS.cases[2]}::uuid, ${pr3}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, ${IDS.supplier}::uuid, '匯款', '貨到付款',
        88000, 'approved'
      )
    `;
    await tx`
      insert into purchase_order_items (
        id, purchase_order_id, line_no, budget_code_id, item_category, description, quantity, unit_price, total_price
      ) values (
        ${poItem3}::uuid, ${po3}::uuid, 1, ${IDS.budgetRd}::uuid, '測試設備',
        'LiDAR 開發套件', 1, 88000, 88000
      )
    `;
    await tx`
      insert into acceptances (
        id, procurement_case_id, purchase_order_id, applicant_employee_id, department_id,
        budget_owner_employee_id, contractor_supplier_id, total_amount, status, current_step_order
      ) values (
        ${acc3}::uuid, ${IDS.cases[2]}::uuid, ${po3}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, ${IDS.supplier}::uuid, 88000, 'pending_approval', 1
      )
    `;
    await tx`
      insert into acceptance_items (
        acceptance_id, line_no, purchase_order_item_id, description, quantity, amount
      ) values (
        ${acc3}::uuid, 1, ${poItem3}::uuid, 'LiDAR 開發套件驗收', 1, 88000
      )
    `;
    await tx`
      insert into approval_steps (form_type, form_id, step_order, approver_employee_id, approver_role, status)
      values
        ('acceptance', ${acc3}::uuid, 1, ${IDS.empMgr}::uuid, 'department_manager', 'approved'),
        ('acceptance', ${acc3}::uuid, 2, ${IDS.empMgr}::uuid, 'budget_owner', 'approved'),
        ('acceptance', ${acc3}::uuid, 3, ${IDS.empDev}::uuid, 'general_manager', 'pending')
    `;

    // --- Case 4: Standalone expense pending at manager ---
    const exp4 = '24000000-0000-0000-0000-000000000004';
    await tx`
      insert into procurement_cases (id, case_number, created_by_employee_id, case_type)
      values (${IDS.cases[3]}::uuid, ${CASE_NUMBERS[3]}, ${IDS.empStaff}::uuid, 'standalone_expense')
    `;
    await tx`
      insert into expense_requests (
        id, procurement_case_id, budget_code_id, applicant_employee_id, department_id,
        budget_owner_employee_id, payee_type, payment_method, total_amount, status, current_step_order
      ) values (
        ${exp4}::uuid, ${IDS.cases[3]}::uuid, ${IDS.budgetRd}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, 'employee', '匯款', 3600, 'pending_approval', 1
      )
    `;
    await tx`
      insert into expense_request_items (expense_request_id, line_no, description, amount)
      values (${exp4}::uuid, 1, '客戶拜訪交通費', 3600)
    `;
    await tx`
      insert into approval_steps (form_type, form_id, step_order, approver_employee_id, approver_role, status)
      values
        ('expense_request', ${exp4}::uuid, 1, ${IDS.empMgr}::uuid, 'department_manager', 'pending'),
        ('expense_request', ${exp4}::uuid, 2, ${IDS.empMgr}::uuid, 'budget_owner', 'pending'),
        ('expense_request', ${exp4}::uuid, 3, ${IDS.empDev}::uuid, 'general_manager', 'pending')
    `;

    // --- Case 5: Completed pipeline ---
    const pr5 = '21000000-0000-0000-0000-000000000005';
    const po5 = '22000000-0000-0000-0000-000000000005';
    const poItem5 = '22100000-0000-0000-0000-000000000005';
    const acc5 = '23000000-0000-0000-0000-000000000005';
    const exp5 = '24000000-0000-0000-0000-000000000005';
    await tx`
      insert into procurement_cases (id, case_number, created_by_employee_id)
      values (${IDS.cases[4]}::uuid, ${CASE_NUMBERS[4]}, ${IDS.empStaff}::uuid)
    `;
    await tx`
      insert into purchase_requests (
        id, procurement_case_id, applicant_employee_id, department_id,
        budget_owner_employee_id, total_amount, status, request_date
      ) values (
        ${pr5}::uuid, ${IDS.cases[4]}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, 12000, 'approved', current_date - 30
      )
    `;
    await tx`
      insert into purchase_request_items (
        purchase_request_id, line_no, budget_code_id, item_category, description, quantity, estimated_amount
      ) values (
        ${pr5}::uuid, 1, ${IDS.budgetRd}::uuid, '办公耗材', '白板筆組', 10, 12000
      )
    `;
    await tx`
      insert into purchase_orders (
        id, procurement_case_id, purchase_request_id, applicant_employee_id, department_id,
        budget_owner_employee_id, supplier_id, payment_method, payment_terms,
        total_amount, status
      ) values (
        ${po5}::uuid, ${IDS.cases[4]}::uuid, ${pr5}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, ${IDS.supplier}::uuid, '匯款', '月結30天',
        12000, 'approved'
      )
    `;
    await tx`
      insert into purchase_order_items (
        id, purchase_order_id, line_no, budget_code_id, item_category, description, quantity, unit_price, total_price
      ) values (
        ${poItem5}::uuid, ${po5}::uuid, 1, ${IDS.budgetRd}::uuid, '办公耗材',
        '白板筆組', 10, 1200, 12000
      )
    `;
    await tx`
      insert into acceptances (
        id, procurement_case_id, purchase_order_id, applicant_employee_id, department_id,
        budget_owner_employee_id, contractor_supplier_id, total_amount, status
      ) values (
        ${acc5}::uuid, ${IDS.cases[4]}::uuid, ${po5}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, ${IDS.supplier}::uuid, 12000, 'approved'
      )
    `;
    await tx`
      insert into acceptance_items (
        acceptance_id, line_no, purchase_order_item_id, description, quantity, amount
      ) values (
        ${acc5}::uuid, 1, ${poItem5}::uuid, '白板筆組驗收', 10, 12000
      )
    `;
    await tx`
      insert into expense_requests (
        id, procurement_case_id, purchase_order_id, applicant_employee_id, department_id,
        budget_owner_employee_id, payee_type, payment_method, total_amount, status
      ) values (
        ${exp5}::uuid, ${IDS.cases[4]}::uuid, ${po5}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, 'employee', '匯款', 12000, 'approved'
      )
    `;
    await tx`
      insert into expense_request_items (
        expense_request_id, line_no, purchase_order_item_id, description, amount
      ) values (
        ${exp5}::uuid, 1, ${poItem5}::uuid, '白板筆組費用申請', 12000
      )
    `;

    // --- Case 6: Returned PR ---
    const pr6 = '21000000-0000-0000-0000-000000000006';
    await tx`
      insert into procurement_cases (id, case_number, created_by_employee_id)
      values (${IDS.cases[5]}::uuid, ${CASE_NUMBERS[5]}, ${IDS.empStaff}::uuid)
    `;
    await tx`
      insert into purchase_requests (
        id, procurement_case_id, applicant_employee_id, department_id,
        budget_owner_employee_id, total_amount, status, request_date
      ) values (
        ${pr6}::uuid, ${IDS.cases[5]}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, 98000, 'returned', current_date - 1
      )
    `;
    await tx`
      insert into purchase_request_items (
        purchase_request_id, line_no, budget_code_id, item_category, description, quantity, estimated_amount
      ) values (
        ${pr6}::uuid, 1, ${IDS.budgetRd}::uuid, '資訊設備',
        '高階 GPU 工作站', 1, 98000
      )
    `;
    await tx`
      insert into approval_steps (
        form_type, form_id, step_order, approver_employee_id, approver_role, status, comment, acted_at
      ) values (
        'purchase_request', ${pr6}::uuid, 1, ${IDS.empMgr}::uuid, 'department_manager',
        'returned', '請補充報價單與三家比價說明', now() - interval '6 hours'
      )
    `;

    // --- Case 7: High amount PO pending at GM (admin) ---
    const pr7 = '21000000-0000-0000-0000-000000000007';
    const po7 = '22000000-0000-0000-0000-000000000007';
    await tx`
      insert into procurement_cases (id, case_number, created_by_employee_id)
      values (${IDS.cases[6]}::uuid, ${CASE_NUMBERS[6]}, ${IDS.empStaff}::uuid)
    `;
    await tx`
      insert into purchase_requests (
        id, procurement_case_id, applicant_employee_id, department_id,
        budget_owner_employee_id, total_amount, status, request_date
      ) values (
        ${pr7}::uuid, ${IDS.cases[6]}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, 168000, 'approved', current_date - 3
      )
    `;
    await tx`
      insert into purchase_request_items (
        purchase_request_id, line_no, budget_code_id, item_category, description, quantity, estimated_amount
      ) values (
        ${pr7}::uuid, 1, ${IDS.budgetRd}::uuid, '測試設備',
        '自動駕駛仿真平台擴充', 1, 168000
      )
    `;
    await tx`
      insert into purchase_orders (
        id, procurement_case_id, purchase_request_id, applicant_employee_id, department_id,
        budget_owner_employee_id, supplier_id, payment_method, payment_terms,
        total_amount, status, current_step_order
      ) values (
        ${po7}::uuid, ${IDS.cases[6]}::uuid, ${pr7}::uuid, ${IDS.empStaff}::uuid, ${IDS.deptRd}::uuid,
        ${IDS.empMgr}::uuid, ${IDS.supplier}::uuid, '匯款', '預付款',
        168000, 'pending_approval', 3
      )
    `;
    await tx`
      insert into purchase_order_items (
        purchase_order_id, line_no, budget_code_id, item_category, description, quantity, unit_price, total_price
      ) values (
        ${po7}::uuid, 1, ${IDS.budgetRd}::uuid, '測試設備',
        '自動駕駛仿真平台擴充', 1, 168000, 168000
      )
    `;
    await tx`
      insert into approval_steps (form_type, form_id, step_order, approver_employee_id, approver_role, status, acted_at)
      values
        ('purchase_order', ${po7}::uuid, 1, ${IDS.empMgr}::uuid, 'department_manager', 'approved', now() - interval '1 day'),
        ('purchase_order', ${po7}::uuid, 2, ${IDS.empMgr}::uuid, 'budget_owner', 'approved', now() - interval '20 hours'),
        ('purchase_order', ${po7}::uuid, 3, ${IDS.empDev}::uuid, 'general_manager', 'pending', null),
        ('purchase_order', ${po7}::uuid, 4, ${IDS.empDev}::uuid, 'chairman', 'pending', null)
    `;

    // Notifications
    await tx`
      insert into notifications (
        recipient_employee_id, type, form_type, form_id, case_number, message, is_read
      ) values
        (
          ${IDS.empMgr}::uuid, 'approval_requested', 'purchase_request', ${pr1}::uuid,
          ${CASE_NUMBERS[0]}, '林小明 提交請購單待您簽核', false
        ),
        (
          ${IDS.empMgr}::uuid, 'approval_requested', 'purchase_order', ${po2}::uuid,
          ${CASE_NUMBERS[1]}, '林小明 提交採購單待您簽核', false
        ),
        (
          ${IDS.empMgr}::uuid, 'approval_requested', 'expense_request', ${exp4}::uuid,
          ${CASE_NUMBERS[3]}, '林小明 提交費用申請待您簽核', false
        ),
        (
          ${IDS.empDev}::uuid, 'approval_requested', 'acceptance', ${acc3}::uuid,
          ${CASE_NUMBERS[2]}, '驗收單待總經理簽核', false
        ),
        (
          ${IDS.empDev}::uuid, 'approval_requested', 'purchase_order', ${po7}::uuid,
          ${CASE_NUMBERS[6]}, '高額採購單待總經理簽核', false
        ),
        (
          ${IDS.empStaff}::uuid, 'request_returned', 'purchase_request', ${pr6}::uuid,
          ${CASE_NUMBERS[5]}, '您的請購單已被退回，請修改後重送', false
        )
    `;

    await tx`
      insert into case_number_counters (year_month, last_serial)
      values ('11508', 7)
      on conflict (year_month) do update set last_serial = greatest(case_number_counters.last_serial, 7)
    `;
  });

  console.log('Demo seed complete.');
  console.log('Try logging in as:');
  console.log('  staff@turing-drive.com   — 林小明（申請人）');
  console.log('  mgr@turing-drive.com     — 王主管（簽核人，3 件待辦）');
  console.log('  finance@turing-drive.com — 陳財會（簽核追蹤）');
  console.log('  dev@turing-drive.com     — 管理員（2 件高階待辦）');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await sql.end();
  });
