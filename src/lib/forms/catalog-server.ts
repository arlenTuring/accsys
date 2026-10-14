import { cache } from 'react';
import { retiredLegacyForms } from '@/lib/custom-forms/legacy';
import { getFilableDefinitions } from '@/lib/custom-forms/queries';
import { FORM_CATEGORIES, mergeCatalog, type FormCategory } from './catalog';

/** The catalog for the current employee: built-in forms plus the designer forms they may file. */
export const getFormCatalog = cache(async (): Promise<FormCategory[]> => {
  const [designerForms, retired] = await Promise.all([getFilableDefinitions(), retiredLegacyForms()]);
  return mergeCatalog(designerForms, FORM_CATEGORIES, retired);
});
