import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bell, Flag, Save, X } from "lucide-react";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { PasswordChangeForm } from "@/components/PasswordChangeForm";
import { supabase } from "@/integrations/supabase/client";
import { getAccessRole } from "@/lib/roles";
import { requestNotificationPermission } from "@/lib/notifications";
import { toast } from "sonner";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profile settings — Champs Chicken" }, { name: "robots", content: "noindex" }] }),
  component: ProfileSettings,
});

type Complaint = { id: string; subject: string; details: string; status: string; category: string; created_at: string; resolution: string | null };
type OrderOption = { id: string; order_number: string; driver_id: string | null };
type Preferences = { in_app_enabled: boolean; browser_enabled: boolean; order_updates: boolean; message_alerts: boolean };
const defaultPreferences: Preferences = { in_app_enabled: true, browser_enabled: true, order_updates: true, message_alerts: true };

function ProfileSettings() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState({ full_name: "", phone: "" });
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [form, setForm] = useState({ order_id: "", category: "service", subject: "", details: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { navigate({ to: "/auth" }); return; }
    const role = await getAccessRole(auth.user.id);
    if (role === "driver") { navigate({ to: "/driver" }); return; }
    if (role === "admin" || role === "staff") { navigate({ to: "/admin/security" }); return; }
    setUserId(auth.user.id);
    const [{ data: profileRow }, { data: preferenceRow }, { data: orderRows }, { data: complaintRows }] = await Promise.all([
      supabase.from("profiles").select("full_name,phone").eq("id", auth.user.id).maybeSingle(),
      (supabase as any).from("user_notification_preferences").select("in_app_enabled,browser_enabled,order_updates,message_alerts").eq("user_id", auth.user.id).maybeSingle(),
      (supabase as any).from("orders").select("id,order_number,driver_id").eq("customer_id", auth.user.id).order("created_at", { ascending: false }),
      (supabase as any).from("customer_complaints").select("id,subject,details,status,category,created_at,resolution").eq("customer_id", auth.user.id).order("created_at", { ascending: false }),
    ]);
    setProfile({ full_name: profileRow?.full_name ?? "", phone: profileRow?.phone ?? "" });
    setPreferences(preferenceRow ?? defaultPreferences);
    setOrders((orderRows ?? []) as OrderOption[]);
    setComplaints((complaintRows ?? []) as Complaint[]);
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault(); if (!userId) return;
    const { error } = await supabase.from("profiles").update({ full_name: profile.full_name.trim() || null, phone: profile.phone.trim() || null } as never).eq("id", userId);
    if (error) toast.error(error.message); else toast.success("Profile updated");
  }

  async function savePreferences(next: Preferences) {
    if (!userId) return;
    if (next.browser_enabled && !preferences.browser_enabled) {
      const permission = await requestNotificationPermission();
      if (permission !== "granted") { toast.error("Browser notifications were not allowed in this browser"); next = { ...next, browser_enabled: false }; }
    }
    setPreferences(next);
    const { error } = await (supabase as any).from("user_notification_preferences").upsert({ user_id: userId, ...next });
    if (error) toast.error(error.message); else toast.success("Notification preferences saved");
  }

  async function submitComplaint(event: React.FormEvent) {
    event.preventDefault(); if (!userId) return;
    if (form.subject.trim().length < 3 || form.details.trim().length < 5) return toast.error("Add a subject and enough detail");
    setBusy(true);
    const order = orders.find((entry) => entry.id === form.order_id);
    const { error } = await (supabase as any).from("customer_complaints").insert({ customer_id: userId, order_id: order?.id ?? null, driver_id: order?.driver_id ?? null, category: form.category, subject: form.subject.trim(), details: form.details.trim() });
    setBusy(false);
    if (error) return toast.error(error.message);
    setForm({ order_id: "", category: "service", subject: "", details: "" }); toast.success("Complaint sent"); void load();
  }

  return <div className="min-h-screen pb-24"><Header subtitle="Profile settings" /><main className="mx-auto max-w-lg space-y-5 px-4 py-4">
    <Link to="/account" className="inline-flex items-center gap-1 text-sm font-semibold"><ArrowLeft className="h-4 w-4" /> Account</Link>
    <section className="rounded-2xl border bg-card p-4"><h1 className="font-display text-2xl text-brand">Personal details</h1><form onSubmit={saveProfile} className="mt-3 space-y-2"><input value={profile.full_name} onChange={(event) => setProfile({ ...profile, full_name: event.target.value })} placeholder="Full name" className="w-full rounded-xl border px-3 py-2 text-sm" /><input value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} placeholder="Phone" className="w-full rounded-xl border px-3 py-2 text-sm" /><button className="inline-flex items-center gap-1 rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground"><Save className="h-4 w-4" /> Save details</button></form></section>
    <section className="rounded-2xl border bg-card p-4"><div className="flex items-center gap-2"><Bell className="h-4 w-4 text-brand" /><h2 className="font-display text-2xl">Notifications</h2></div><div className="mt-3 space-y-3">{([['in_app_enabled','In-app notifications'],['browser_enabled','Browser notifications'],['order_updates','Order updates'],['message_alerts','Message alerts']] as const).map(([key,label]) => <label key={key} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm"><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={(event) => void savePreferences({ ...preferences, [key]: event.target.checked })} /></label>)}</div></section>
    <section id="complaints" className="rounded-2xl border bg-card p-4"><div className="flex items-center gap-2"><Flag className="h-4 w-4 text-brand" /><h2 className="font-display text-2xl">Complaints</h2></div><form onSubmit={submitComplaint} className="mt-3 space-y-2"><select value={form.order_id} onChange={(event) => setForm({ ...form, order_id: event.target.value })} className="w-full rounded-xl border px-3 py-2 text-sm"><option value="">General complaint</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.order_number}</option>)}</select><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="w-full rounded-xl border px-3 py-2 text-sm"><option value="service">Service</option><option value="order">Order</option><option value="driver">Driver</option><option value="payment">Payment</option><option value="other">Other</option></select><input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} maxLength={120} placeholder="Subject" className="w-full rounded-xl border px-3 py-2 text-sm" /><textarea value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} rows={4} maxLength={4000} placeholder="Tell us what happened" className="w-full rounded-xl border px-3 py-2 text-sm" /><button disabled={busy} className="w-full rounded-full bg-brand px-4 py-2.5 text-sm font-bold text-brand-foreground">{busy ? "Sending…" : "Submit complaint"}</button></form>{complaints.length > 0 && <div className="mt-4 space-y-2">{complaints.map((complaint) => <button key={complaint.id} onClick={() => setSelected(complaint)} className="block w-full rounded-xl border p-3 text-left text-sm"><div className="flex justify-between gap-2"><span className="font-semibold">{complaint.subject}</span><span className="text-[10px] font-bold uppercase text-brand">{complaint.status}</span></div><div className="mt-1 text-xs text-muted-foreground">View complaint and Champs response</div></button>)}</div>}</section>
    <PasswordChangeForm />
  </main>{selected && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4" onClick={() => setSelected(null)}><div className="w-full max-w-lg rounded-3xl bg-background p-5" onClick={(event) => event.stopPropagation()}><div className="flex justify-between gap-3"><div><div className="text-xs font-bold uppercase text-brand">{selected.category} · {selected.status}</div><h2 className="font-display text-2xl">{selected.subject}</h2></div><button onClick={() => setSelected(null)} className="grid h-9 w-9 place-items-center rounded-full border"><X className="h-4 w-4" /></button></div><div className="mt-4 rounded-xl bg-muted p-3 text-sm whitespace-pre-wrap">{selected.details}</div><div className="mt-4 text-xs font-bold uppercase text-muted-foreground">Champs response</div><div className="mt-1 rounded-xl border p-3 text-sm">{selected.resolution || "Champs has not responded yet."}</div></div></div>}<BottomNav /></div>;
}
