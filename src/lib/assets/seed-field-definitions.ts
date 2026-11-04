import { PROPERTY_REGISTER_COLUMNS } from '@/lib/assets/field-catalog';
import { getDb } from '@/lib/db';
import { assetFieldDefinitions } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Idempotently seed field definitions for Excel-mapped configurable + inventory columns.
 * Core columns stay on assets.*; they are listed in the catalog but not inserted here
 * unless they also have an asset_field binding.
 */
export async function seedAssetFieldDefinitionsFromCatalog(): Promise<{ inserted: number; skipped: number }> {
  const db = getDb();
  let inserted = 0;
  let skipped = 0;
  for (const col of PROPERTY_REGISTER_COLUMNS) {
    if (col.binding.kind === 'core') {
      skipped += 1;
      continue;
    }
    const stableKey = col.binding.stableKey;
    const [existing] = await db
      .select({ id: assetFieldDefinitions.id })
      .from(assetFieldDefinitions)
      .where(and(eq(assetFieldDefinitions.stableKey, stableKey), isNull(assetFieldDefinitions.deletedAt)))
      .limit(1);
    if (existing) {
      skipped += 1;
      continue;
    }
    await db.insert(assetFieldDefinitions).values({
      stableKey,
      label: col.label.slice(0, 80),
      help: col.help ?? '',
      fieldType: col.binding.fieldType,
      section: col.binding.kind === 'inventory_field' ? 'inventory' : col.binding.section,
      sortOrder: col.excelCol,
      required: false,
      showInList: col.binding.kind === 'asset_field' && ['accounting_subject', 'acquired_on'].includes(stableKey),
      searchable: col.binding.kind === 'asset_field',
      filterable: col.binding.kind === 'asset_field',
      exportable: true,
      status: 'active',
      options: [],
      storageScope: col.binding.kind === 'inventory_field' ? 'inventory' : 'asset',
      version: 1,
    });
    inserted += 1;
  }
  return { inserted, skipped };
}
