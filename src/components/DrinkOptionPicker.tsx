export type DrinkOption = {
  id: string;
  name: string;
  variant_label: string | null;
  branchLabel?: string | null;
};

export function DrinkOptionPicker({
  options,
  selectedIds,
  onChange,
}: {
  options: DrinkOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const selected = new Set(selectedIds);

  return (
    <fieldset className="rounded-xl border border-brand/20 bg-brand/5 p-3 sm:col-span-full">
      <legend className="px-1 text-xs font-bold text-brand">Drinks customers may choose</legend>
      {options.length === 0 ? (
        <p className="text-xs text-destructive">
          Add an available item to the Drinks category before enabling this option.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const label = option.variant_label
              ? `${option.name} — ${option.variant_label}`
              : option.name;
            return (
              <label
                key={option.id}
                className="flex items-start gap-2 rounded-lg border bg-background px-3 py-2 text-xs"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.has(option.id)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selectedIds, option.id]
                        : selectedIds.filter((id) => id !== option.id),
                    )
                  }
                />
                <span>
                  <span className="font-semibold">{label}</span>
                  {option.branchLabel && (
                    <span className="ml-1 text-muted-foreground">· {option.branchLabel}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {options.length > 0 && selectedIds.length === 0 && (
        <p className="mt-2 text-xs text-destructive">Select at least one drink.</p>
      )}
    </fieldset>
  );
}
