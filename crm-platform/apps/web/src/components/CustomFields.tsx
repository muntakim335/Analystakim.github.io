import { useQuery } from '@tanstack/react-query';
import { get } from '../api/client';
import type { CustomFieldDef } from '../api/types';
import { Field, Input, Select } from './ui';

export function useCustomFields(entityType: CustomFieldDef['entityType']) {
  return useQuery({
    queryKey: ['custom-fields', entityType],
    queryFn: () => get<{ data: CustomFieldDef[] }>(`/custom-fields?entity_type=${entityType}`),
    staleTime: 60_000,
  });
}

/** Renders an org's custom fields inside any create/edit form. */
export function CustomFieldInputs({
  entityType,
  value,
  onChange,
}: {
  entityType: CustomFieldDef['entityType'];
  value: Record<string, unknown>;
  onChange(next: Record<string, unknown>): void;
}) {
  const { data } = useCustomFields(entityType);
  const defs = data?.data ?? [];
  if (defs.length === 0) return null;

  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });

  return (
    <>
      {defs.map((def) => (
        <Field key={def.id} label={def.label} required={def.required}>
          {def.fieldType === 'select' ? (
            <Select
              value={(value[def.key] as string) ?? ''}
              onChange={(e) => set(def.key, e.target.value || null)}
            >
              <option value="">—</option>
              {def.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          ) : def.fieldType === 'checkbox' ? (
            <input
              type="checkbox"
              checked={Boolean(value[def.key])}
              onChange={(e) => set(def.key, e.target.checked)}
              className="h-4 w-4 accent-[var(--series-1)]"
            />
          ) : (
            <Input
              type={def.fieldType === 'number' ? 'number' : def.fieldType === 'date' ? 'date' : 'text'}
              value={(value[def.key] as string | number) ?? ''}
              onChange={(e) =>
                set(
                  def.key,
                  e.target.value === ''
                    ? null
                    : def.fieldType === 'number'
                      ? Number(e.target.value)
                      : e.target.value
                )
              }
            />
          )}
        </Field>
      ))}
    </>
  );
}
