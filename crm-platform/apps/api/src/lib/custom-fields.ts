import type { Queryable } from '../db/db.js';
import { validation } from './errors.js';

export type CustomEntityType = 'contact' | 'company' | 'lead' | 'deal';

interface FieldDef {
  key: string;
  label: string;
  field_type: 'text' | 'number' | 'date' | 'select' | 'checkbox';
  options: string[];
  required: boolean;
}

/**
 * Validates a record's `custom` object against the org's field definitions.
 * Unknown keys are rejected; types and select options are enforced;
 * required fields are enforced only on create (partial=false).
 */
export async function validateCustom(
  q: Queryable,
  orgId: string,
  entityType: CustomEntityType,
  custom: Record<string, unknown> | undefined,
  opts: { partial: boolean }
): Promise<Record<string, unknown>> {
  const input = custom ?? {};
  const defs: FieldDef[] = (
    await q.query(
      `SELECT key, label, field_type, options, required
       FROM custom_field_defs WHERE org_id = $1 AND entity_type = $2`,
      [orgId, entityType]
    )
  ).rows;

  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const key of Object.keys(input)) {
    if (!byKey.has(key)) throw validation(`Unknown custom field "${key}" for ${entityType}`);
  }

  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const value = input[def.key];
    if (value === undefined) {
      if (def.required && !opts.partial) {
        throw validation(`Custom field "${def.label}" is required`);
      }
      continue;
    }
    if (value === null || value === '') {
      if (def.required) throw validation(`Custom field "${def.label}" is required`);
      out[def.key] = null;
      continue;
    }
    switch (def.field_type) {
      case 'text':
        if (typeof value !== 'string') throw validation(`"${def.label}" must be text`);
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value))
          throw validation(`"${def.label}" must be a number`);
        break;
      case 'date':
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
          throw validation(`"${def.label}" must be a date`);
        break;
      case 'select':
        if (typeof value !== 'string' || !def.options.includes(value))
          throw validation(`"${def.label}" must be one of: ${def.options.join(', ')}`);
        break;
      case 'checkbox':
        if (typeof value !== 'boolean') throw validation(`"${def.label}" must be true/false`);
        break;
    }
    out[def.key] = value;
  }
  return out;
}

/** Merge validated custom values over existing ones (for PATCH). */
export function mergeCustom(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  return { ...existing, ...incoming };
}
