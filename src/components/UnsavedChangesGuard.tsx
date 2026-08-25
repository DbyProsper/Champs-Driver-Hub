import { useBlocker } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export function UnsavedChangesGuard({ dirty, onSave }: { dirty: boolean; onSave: () => Promise<boolean | void> }) {
  const blocker = useBlocker({ shouldBlockFn: () => dirty, withResolver: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  if (blocker.status !== "blocked") return null;
  return <div className="fixed inset-0 z-[120] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Unsaved changes">
    <div className="w-full max-w-sm rounded-2xl bg-background p-5 shadow-xl">
      <h2 className="font-display text-2xl text-brand">Save your changes?</h2>
      <p className="mt-2 text-sm text-muted-foreground">You have unsaved changes. Save them before leaving, or discard them.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={() => blocker.reset?.()} className="rounded-full border px-4 py-2 text-sm font-semibold">Keep editing</button>
        <button type="button" onClick={() => blocker.proceed?.()} className="rounded-full border px-4 py-2 text-sm font-semibold">Discard</button>
        <button type="button" disabled={saving} onClick={async () => { setSaving(true); const result = await onSave(); setSaving(false); if (result !== false) blocker.proceed?.(); }} className="rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground">{saving ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  </div>;
}
