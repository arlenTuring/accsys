import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

/**
 * 第 39 條：確保台灣智慧駕駛（Turing Drive）各簽核關卡對應之真實員工帳號與部門主管皆已就緒。
 * 支援一鍵切換任意關卡角色（申請人 阮振瑋 → 部門主管 楊為任 → 預算負責人 張晏銘 → 新保管人 賴昭宇 → 新主管 陳冠文 → 總務 汪怡伶 → 財會 許雲茹 → 執行長 沈大維 → 董事長 陳維隆 → 管理員 吳旭東）跑完整流程。
 */
export async function ensureStageTestAccounts(): Promise<void> {
  const db = getDb();

  await db.execute(sql`
    -- 1. 確保台灣智慧駕駛真實部門存在
    insert into departments (code, name, active)
    values
      ('CO',  '董事長室', true),
      ('GO',  '總經理室', true),
      ('AD',  '管理部', true),
      ('ADS', '自動駕駛系統部', true),
      ('D&C', '資料與雲端平台部', true),
      ('VD',  '車輛開發部', true),
      ('PD',  '產品部', true),
      ('S&M', '營業行銷部', true)
    on conflict (code) do update set
      name = excluded.name,
      active = true;
  `);

  await db.execute(sql`
    -- 2. 確保台灣智慧駕駛 10 大關卡真實員工帳號存在且啟用（以 employee_code 為主鍵更新，不產生假帳號）
    insert into employees (
      employee_code, name, department_id, title, google_email, role, is_general_manager, is_chairman, access_enabled
    ) values
      (
        '0001',
        '陳維隆',
        (select id from departments where code = 'CO' limit 1),
        '董事長',
        'wlc@turing-drive.com',
        'staff',
        false,
        true,
        true
      ),
      (
        '0002',
        '沈大維',
        (select id from departments where code = 'GO' limit 1),
        '執行長',
        'david_shen@turing-drive.com',
        'admin',
        true,
        false,
        true
      ),
      (
        '0009',
        '許雲茹',
        (select id from departments where code = 'AD' limit 1),
        '行政財會',
        'lucia@turing-drive.com',
        'finance',
        false,
        false,
        true
      ),
      (
        '0017',
        '阮振瑋',
        (select id from departments where code = 'ADS' limit 1),
        '工程經理',
        'wayne@turing-drive.com',
        'staff',
        false,
        false,
        true
      ),
      (
        '0032',
        '陳冠文',
        (select id from departments where code = 'VD' limit 1),
        '副總經理',
        'henry@turing-drive.com',
        'staff',
        false,
        false,
        true
      ),
      (
        '0046',
        '賴昭宇',
        (select id from departments where code = 'VD' limit 1),
        '資深車輛開發工程師',
        'jeter@turing-drive.com',
        'staff',
        false,
        false,
        true
      ),
      (
        '0053',
        '楊為任',
        (select id from departments where code = 'ADS' limit 1),
        '軟體研發副總',
        'nickyang@turing-drive.com',
        'staff',
        false,
        false,
        true
      ),
      (
        '0060',
        '張晏銘',
        (select id from departments where code = 'PD' limit 1),
        '產品經理',
        'vic.c@turing-drive.com',
        'staff',
        false,
        false,
        true
      ),
      (
        '0065',
        '吳旭東',
        (select id from departments where code = 'AD' limit 1),
        '協理',
        'ivan_wu@turing-drive.com',
        'admin',
        false,
        false,
        true
      ),
      (
        '0075',
        '汪怡伶',
        (select id from departments where code = 'AD' limit 1),
        '行政總務專員',
        'ellen@turing-drive.com',
        'finance',
        false,
        false,
        true
      )
    on conflict (employee_code) do update set
      name = excluded.name,
      department_id = excluded.department_id,
      title = excluded.title,
      google_email = coalesce(employees.google_email, excluded.google_email),
      role = excluded.role,
      is_general_manager = excluded.is_general_manager,
      is_chairman = excluded.is_chairman,
      access_enabled = true,
      disabled_at = null;
  `);

  await db.execute(sql`
    -- 3. 綁定台灣智慧駕駛各真實部門之部門主管
    update departments set manager_employee_id = (select id from employees where employee_code = '0001' limit 1) where code in ('CO', 'S&M');
    update departments set manager_employee_id = (select id from employees where employee_code = '0002' limit 1) where code in ('GO', 'PD');
    update departments set manager_employee_id = (select id from employees where employee_code = '0065' limit 1) where code = 'AD';
    update departments set manager_employee_id = (select id from employees where employee_code = '0053' limit 1) where code in ('ADS', 'D&C');
    update departments set manager_employee_id = (select id from employees where employee_code = '0032' limit 1) where code = 'VD';
  `);

  await db.execute(sql`
    -- 4. 確保職務類別（job_roles / employee_job_roles）綁定執行長沈大維與董事長陳維隆為主要簽核人
    insert into job_roles (code, name, description, is_system, active)
    values
      ('general_manager', '總經理', '公司總經理／執行長簽核關卡', true, true),
      ('chairman', '董事長', '公司董事長簽核關卡', true, true)
    on conflict (code) do update set active = true;

    update employee_job_roles
    set is_primary = false
    where job_role_id in (select id from job_roles where code in ('general_manager', 'chairman'))
      and department_id is null;

    insert into employee_job_roles (employee_id, job_role_id, department_id, is_primary)
    select e.id, j.id, null, true
    from employees e
    join job_roles j on j.code = 'general_manager'
    where e.employee_code = '0002'
    on conflict (job_role_id, department_id, employee_id) do update set is_primary = true;

    insert into employee_job_roles (employee_id, job_role_id, department_id, is_primary)
    select e.id, j.id, null, true
    from employees e
    join job_roles j on j.code = 'chairman'
    where e.employee_code = '0001'
    on conflict (job_role_id, department_id, employee_id) do update set is_primary = true;
  `);

  await db.execute(sql`
    -- 4b. 確保表單入口分類存在
    insert into form_categories (key, title, description, sort_order, active)
    values
      ('procurement', '採購與預算', '請購、採購、驗收、付款與預算編列變更', 1, true),
      ('expense', '費用報支', '日常費用申請與差旅報支', 2, true),
      ('travel', '公出與差旅', '公出差旅申請與出差報告報支', 3, true),
      ('asset', '資產管理', '財產保管異動、借出、報廢', 4, true),
      ('seal', '用印申請', '合約、非合約文件與發票用印申請', 5, true)
    on conflict (key) do update set active = true;
  `);
}
