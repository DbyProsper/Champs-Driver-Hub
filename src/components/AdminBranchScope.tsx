export type AdminBranch = { id: string; name: string; city?: string | null };

export function AdminBranchScope({
  branches,
  value,
  onChange,
  bothLabel = "Both",
}: {
  branches: AdminBranch[];
  value: string;
  onChange: (value: string) => void;
  bothLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3" aria-label="Choose branch">
      <span className="mr-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Branch</span>
      <button type="button" onClick={() => onChange("both")} className={`rounded-full px-4 py-2 text-xs font-bold ${value === "both" ? "bg-brand text-brand-foreground" : "border bg-background"}`}>
        {bothLabel}
      </button>
      {branches.map((branch) => (
        <button key={branch.id} type="button" onClick={() => onChange(branch.id)} className={`rounded-full px-4 py-2 text-xs font-bold ${value === branch.id ? "bg-brand text-brand-foreground" : "border bg-background"}`}>
          {branch.city || branch.name.replace(/^Champs\s+/i, "")}
        </button>
      ))}
    </div>
  );
}

