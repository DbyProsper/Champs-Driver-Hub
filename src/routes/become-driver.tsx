import React, { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { requestDriverApplication } from "@/lib/admin.functions";
import { toast } from "sonner";
import { SA_BANKS } from "@/lib/sa-banks";
import { ThemeToggle } from "@/components/ThemeToggle";

const MAX_DRIVER_IMAGE_BYTES = 2 * 1024 * 1024;
type BranchOption = { id: string; name: string; city: string };

export const Route = createFileRoute("/become-driver")({
  head: () => ({ meta: [{ title: "Become a driver — Champs" }, { name: "robots", content: "noindex" }] }),
  component: BecomeDriver,
});

function BecomeDriver() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    name: "",
    username: "",
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
  const [branches, setBranches] = useState<BranchOption[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        nav({ to: "/auth" });
        return;
      }
      const [{ data: profile }, { data: branchRows }] = await Promise.all([
        (supabase.from("profiles") as any).select("full_name,phone").eq("id", data.user.id).maybeSingle(),
        supabase.from("branches").select("id,name,city").eq("is_active", true).order("sort_order"),
      ]);
      setBranches((branchRows ?? []) as BranchOption[]);
      setForm((current) => ({
        ...current,
        name: current.name || profile?.full_name || data.user.user_metadata?.full_name || data.user.user_metadata?.name || "",
        username: current.username || profile?.full_name || data.user.user_metadata?.full_name || data.user.user_metadata?.name || "",
        phone: current.phone || profile?.phone || data.user.phone || data.user.user_metadata?.phone || "",
      }));
      setCheckingAuth(false);
    })();
  }, [nav]);

  function imageSizeError(file: File, label: string) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return `${label} “${file.name}” is ${sizeMb} MB. Please choose an image smaller than 2 MB.`;
  }

  function chooseImage(file: File | undefined, field: "profile_file" | "selfie_file", label: string) {
    if (!file) return setForm((current) => ({ ...current, [field]: null }));
    if (file.size > MAX_DRIVER_IMAGE_BYTES) {
      toast.error(imageSizeError(file, label));
      return setForm((current) => ({ ...current, [field]: null }));
    }
    setForm((current) => ({ ...current, [field]: file }));
  }

  async function uploadFile(file: File | null, keyPrefix: string, label: string) {
    if (!file) return null;
    if (file.size > MAX_DRIVER_IMAGE_BYTES) throw new Error(imageSizeError(file, label));
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) throw new Error("Please sign in again before uploading documents");
    const id = `${Date.now()}_${file.name}`;
    const path = `${authData.user.id}/${keyPrefix}/${id}`;
    const { error } = await supabase.storage.from("driver-uploads").upload(path, file);
    if (error) {
      if (/maximum allowed file size|exceeded|too large/i.test(error.message)) throw new Error(imageSizeError(file, label));
      throw error;
    }
    const { data: urlData } = await supabase.storage.from("driver-uploads").getPublicUrl(path);
    return urlData.publicUrl;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.name.trim().length < 2) return toast.error("Your full legal name is required");
    if (form.username.trim().length < 2 || form.username.trim().length > 40) return toast.error("Username must be between 2 and 40 characters");
    if (!form.phone.trim()) return toast.error("Phone number is required");
    if (!form.student_number.trim() && !/^\d{13}$/.test(form.id_number.trim())) return toast.error("Valid SA ID (13 digits) or driver's licence number required");
    if (!form.profile_file) return toast.error("A profile photo is required");
    if (form.profile_file.size > MAX_DRIVER_IMAGE_BYTES) return toast.error(imageSizeError(form.profile_file, "Profile photo"));
    if (form.selfie_file && form.selfie_file.size > MAX_DRIVER_IMAGE_BYTES) return toast.error(imageSizeError(form.selfie_file, "Selfie with ID or licence"));
    if (!form.bank_name.trim() || !form.bank_account_number.trim() || !form.bank_account_holder.trim()) return toast.error("Complete all banking details");
    setBusy(true);
    try {
      const profileUrl = await uploadFile(form.profile_file, "profile_photos", "Profile photo");
      const selfieUrl = await uploadFile(form.selfie_file, "selfies", "Selfie with ID or licence");
      await requestDriverApplication({
        data: {
          name: form.name,
          username: form.username,
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
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h1 className="font-display text-2xl text-brand mb-2">Become a driver</h1>
          <img src="/images/champs/champs-drivers.png" alt="Become a Champs driver" className="mb-4 aspect-[3/2] w-full rounded-2xl border object-cover" />
          <p className="text-sm text-muted-foreground">Upload your documents and banking details so Champs can review your application.</p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block"><span className="mb-1 block text-xs font-semibold">Full legal name <span className="text-brand">*</span></span><input required autoComplete="name" placeholder="As it appears on your ID or licence" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand" /></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold">Username shown to customers <span className="text-brand">*</span></span><input required minLength={2} maxLength={40} autoComplete="nickname" placeholder="The name customers will see" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand" /><span className="mt-1 block text-[11px] text-muted-foreground">You can change this later in Driver Settings.</span></label>
          <input required inputMode="tel" autoComplete="tel" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand" />
          <input placeholder="ID number (13 digits)" value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand" />
          <input placeholder="Driver's licence number (use instead of ID)" value={form.student_number} onChange={(e) => setForm({ ...form, student_number: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand" />

          <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} className="w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm focus:border-brand">
            <option value="">Select the branch you want to work with</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.city ? ` · ${branch.city}` : ""}</option>)}
          </select>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block rounded-3xl border border-dashed border-border bg-background p-4 text-sm">
              <div className="mb-2 font-semibold">Profile photo</div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-input bg-card px-3 py-3">
                <span className="truncate text-sm text-muted-foreground">{form.profile_file ? form.profile_file.name : "Choose a profile image"}</span>
                <span className="rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-brand-foreground">Upload</span>
              </div>
              <input className="sr-only" type="file" accept="image/*" onChange={(e) => chooseImage(e.target.files?.[0], "profile_file", "Profile photo")} />
            </label>

            <label className="block rounded-3xl border border-dashed border-border bg-background p-4 text-sm">
              <div className="mb-2 font-semibold">Selfie with ID or licence</div>
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-input bg-card px-3 py-3">
                <span className="truncate text-sm text-muted-foreground">{form.selfie_file ? form.selfie_file.name : "Choose a selfie image"}</span>
                <span className="rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-brand-foreground">Upload</span>
              </div>
              <input className="sr-only" type="file" accept="image/*" onChange={(e) => chooseImage(e.target.files?.[0], "selfie_file", "Selfie with ID or licence")} />
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
