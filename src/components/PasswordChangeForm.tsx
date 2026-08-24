import { useState } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function PasswordChangeForm({ title = "Change password" }: { title?: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword.length < 8) return toast.error("The new password must be at least 8 characters");
    if (newPassword !== confirmPassword) return toast.error("The new passwords do not match");
    if (currentPassword === newPassword) return toast.error("Choose a password different from your current password");
    setBusy(true);
    try {
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError || !data.user?.email) throw new Error("Please sign in again before changing your password");
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: data.user.email, password: currentPassword });
      if (verifyError) throw new Error("Your current password is incorrect");
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed successfully");
    } catch (error: any) {
      toast.error(error.message ?? "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2 text-brand"><LockKeyhole className="h-4 w-4" /><h2 className="font-display text-xl">{title}</h2></div>
      <p className="mt-1 text-xs text-muted-foreground">Confirm your current password before choosing a new one.</p>
      <form onSubmit={submit} className="mt-3 grid gap-2">
        <PasswordInput label="Current password" value={currentPassword} onChange={setCurrentPassword} visible={visible} />
        <PasswordInput label="New password" value={newPassword} onChange={setNewPassword} visible={visible} minLength={8} />
        <PasswordInput label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} visible={visible} minLength={8} />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={() => setVisible((value) => !value)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {visible ? "Hide passwords" : "Show passwords"}
          </button>
          <button disabled={busy || !currentPassword || !newPassword || !confirmPassword} className="rounded-full bg-brand px-4 py-2 text-xs font-bold text-brand-foreground disabled:opacity-50">{busy ? "Changing…" : "Change password"}</button>
        </div>
      </form>
    </section>
  );
}

function PasswordInput({ label, value, onChange, visible, minLength }: { label: string; value: string; onChange: (value: string) => void; visible: boolean; minLength?: number }) {
  return <label className="grid gap-1 text-xs font-semibold text-muted-foreground"><span>{label}</span><input type={visible ? "text" : "password"} autoComplete={label === "Current password" ? "current-password" : "new-password"} required minLength={minLength} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-xl border bg-background px-3 py-2.5 text-sm text-foreground" /></label>;
}
