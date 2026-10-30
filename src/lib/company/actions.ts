'use server';

import { revalidatePath } from 'next/cache';
import { upsertCompanyProfile, type UpsertCompanyInput } from '@/lib/company/service';

export async function saveCompanyProfileAction(input: UpsertCompanyInput) {
  const result = await upsertCompanyProfile(input);
  if (result.ok) revalidatePath('/admin/company');
  return result;
}
