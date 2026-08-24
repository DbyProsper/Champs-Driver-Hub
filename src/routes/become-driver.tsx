import React, { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { requestDriverApplication } from "@/lib/admin.functions";
import { toast } from "sonner";
import { SA_BANKS } from "@/lib/sa-banks";

export const Route = createFileRoute("/become-driver")({
  head: () => ({ meta: [{ title: "Become a driver — Champs" }, { name: "robots", content: "noindex" }] }),
  component: BecomeDriver,
});

function BecomeDriver() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    id_number: "",
    student_number: "",
    branch_id: "",
    bank_name: "",
    bank_account_number: "",
    bank_account_holder: "",
    profile_file: null as File | null,
    selfie_file: null as File | null,
  });
  const [busy, setBusy] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        nav({ to: "/auth" });
        return;
      }
      setCheckingAuth(false);
    })();
  }, [nav]);

  async function uploadFile(file: File | null, keyPrefix: string) {
    if (!file) return null;
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) throw new Error("Please sign in again before uploading documents");
    const id = `${Date.now()}_${file.name}`;
    const path = `${authData.user.id}/${keyPrefix}/${id}`;
    const { error } = await supabase.storage.from("driver-uploads").upload(path, file);
    if (error) throw error;
    const { data: urlData } = await supabase.storage.from("driver-uploads").getPublicUrl(path);
    return urlData.publicUrl;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return toast.error("Name and phone required");
    if (!form.student_number.trim() && !/^\d{13}$/.test(form.id_number.trim())) return toast.error("Valid SA ID (13 digits) or driver's licence number required");
    if (!form.profile_file) return toast.error("A profile photo is required");
    if (!form.bank_name.trim() || !form.bank_account_number.trim() || !form.bank_account_holder.trim()) return toast.error("Complete all banking details");
    setBusy(true);
    try {
      const profileUrl = await uploadFile(form.profile_file, "profile_photos");
      const selfieUrl = await uploadFile(form.selfie_file, "selfies");
      await requestDriverApplication({
        data: {
          name: form.name,
          phone: form.phone,
          idNumber: form.id_number || undefined,
          studentNumber: form.student_number || undefined,
          profilePhotoUrl: profileUrl || undefined,
          selfieUrl: selfieUrl || undefined,
          branchId: form.branch_id || undefined,
          bankName: form.bank_name || undefined,
          bankAccountNumber: form.bank_account_number || undefined,
          bankAccountHolder: form.bank_account_holder || undefined,
        },
      });
      toast.success("Application submitted");
      nav({ to: "/account" });
    } catch (err: any) {
      toast.error(err.message || "Could not submit application");
    } finally {
      setBusy(false);
    }
  }

  if (checkingAuth) {
    return <div className="min-h-screen grid place-items-center">Checking authentication…</div>;
  }

  return (
    <div className="min-h-screen bg-muted/40 pb-20">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Link to="/account" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-brand">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <Link to="/" className="inline-flex items-center gap-2">
            <img src="/images/champs/champs-logo.png" alt="Champs Chicken" className="h-8 w-auto" />
            <span className="font-display text-lg text-brand">Driver application</span>
          </Link>
          <div className="w-8" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h1 className="font-display text-2xl text-brand mb-2">Become a driver</h1>
          <p className="text-sm text-muted-foreground">Upload your documents and banking details so Champs can review your application.</p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand" />
          <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand" />
          <input placeholder="ID number (13 digits)" value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand" />
          <input placeholder="Driver's licence number (use instead of ID)" value={form.student_number} onChange={(e) => setForm({ ...form, student_number: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand" />

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block rounded-3xl border border-dashed border-border bg-background p-4 text-sm">
              <div className="mb-2 font-semibold">Profile photo</div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-input bg-card px-3 py-3">
                <span className="truncate text-sm text-muted-foreground">{form.profile_file ? form.profile_file.name : "Choose a profile image"}</span>
                <span className="rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-brand-foreground">Upload</span>
              </div>
              <input className="sr-only" type="file" accept="image/*" onChange={(e) => setForm({ ...form, profile_file: e.target.files?.[0] ?? null })} />
            </label>

            <label className="block rounded-3xl border border-dashed border-border bg-background p-4 text-sm">
              <div className="mb-2 font-semibold">Selfie with ID or licence</div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-input bg-card px-3 py-3">
                <span className="truncate text-sm text-muted-foreground">{form.selfie_file ? form.selfie_file.name : "Choose a selfie image"}</span>
                <span className="rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-brand-foreground">Upload</span>
              </div>
              <input className="sr-only" type="file" accept="image/*" onChange={(e) => setForm({ ...form, selfie_file: e.target.files?.[0] ?? null })} />
            </label>
          </div>

          <select value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand">
            <option value="">Select your South African bank</option>
            {SA_BANKS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
          </select>
          <input placeholder="Account number" value={form.bank_account_number} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand" />
          <input placeholder="Account holder" value={form.bank_account_holder} onChange={(e) => setForm({ ...form, bank_account_holder: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand" />

          <button disabled={busy} className="w-full rounded-full bg-brand px-4 py-3 text-sm font-bold text-brand-foreground disabled:opacity-60">
            {busy ? "Submitting…" : "Submit application"}
          </button>
        </form>
      </main>
    </div>
  );
}
