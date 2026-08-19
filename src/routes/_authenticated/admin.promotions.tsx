import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2, Save, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatZAR } from "@/lib/format";
import { toast } from "sonner";
import { logAdminAction } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/admin/promotions")({
  head: () => ({ meta: [{ title: "Promotions — Champs Admin" }, { name: "robots", content: "noindex" }] }),
  component: PromoAdmin,
});

type Promo = {
  id: string;
  branch_id: string | null;
  title: string;
  description: string | null;
  badge: string | null;
  price_cents: number | null;
  image_url: string | null;
  active_from: string | null;
  active_until: string | null;
  day_of_week: number | null;
  is_active: boolean;
  sort_order: number;
};
type Branch = { id: string; name: string; city: string };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function PromoAdmin() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [dirty, setDirty] = useState<Record<string, Partial<Promo>>>({});
  const [newP, setNewP] = useState({ title: "", badge: "", description: "", price_cents: "", image_url: "", active_from: "", active_until: "", branch_id: "", day_of_week: "" });

  async function load() {
    const [p, b] = await Promise.all([
      supabase.from("promotions").select("*").order("sort_order"),
      supabase.from("branches").select("id, name, city").order("sort_order"),
    ]);
    setPromos((p.data as Promo[]) ?? []);
    setBranches((b.data as Branch[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  function edit(id: string, patch: Partial<Promo>) {
    setDirty((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  async function syncPromoMenuItem(promo: Promo) {
    try {
      const { data: cat } = await supabase.from("categories").select("id").eq("slug", "promos").maybeSingle();
      let categoryId = cat?.id;
      if (!categoryId) {
        const { data: insertedCat, error: catErr } = await supabase.from("categories").insert({ name: "Promos", slug: "promos", sort_order: -100 } as never).select("id").single();
        if (catErr) throw catErr;
        categoryId = insertedCat.id;
      }
      const { data: existing } = await supabase.from("menu_items").select("id").eq("name", promo.title).maybeSingle();
      const payload = {
        category_id: categoryId,
        name: promo.title,
        variant_label: null,
        description: promo.description ?? "Special Champs offer",
        price_cents: promo.price_cents ?? 0,
        is_available: true,
        sort_order: 0,
        image_url: promo.image_url ?? null,
      } as never;
      if (existing?.id) {
        const { error } = await supabase.from("menu_items").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("menu_items").insert(payload);
        if (error) throw error;
      }
    } catch (error: any) {
      console.error(error);
    }
  }

  async function saveAll() {
    const entries = Object.entries(dirty);
    if (entries.length === 0) return;
    for (const [id, patch] of entries) {
      const current = promos.find((item) => item.id === id);
      const { error } = await supabase.from("promotions").update(patch).eq("id", id);
      if (error) { toast.error(error.message); return; }
      if (current) await syncPromoMenuItem({ ...current, ...patch } as Promo);
    }
    void Promise.all(entries.map(([id, patch]) => logAdminAction({ action_type: "promotion_updated", action_description: `Updated promotion ${id}`, target_type: "promotion", target_id: id, metadata: { changes: patch } })));
    toast.success("Saved");
    setDirty({});
    load();
  }

  async function create() {
    if (!newP.title.trim()) { toast.error("Title required"); return; }
    const payload: any = {
      title: newP.title.trim(),
      badge: newP.badge.trim() || null,
      description: newP.description.trim() || null,
      price_cents: newP.price_cents ? Math.round(Number(newP.price_cents) * 100) : null,
      image_url: newP.image_url.trim() || null,
      active_from: newP.active_from ? new Date(newP.active_from).toISOString() : null,
      active_until: newP.active_until ? new Date(newP.active_until).toISOString() : null,
      branch_id: newP.branch_id || null,
      day_of_week: newP.day_of_week === "" ? null : Number(newP.day_of_week),
    };
    const { data, error } = await supabase.from("promotions").insert(payload).select("*").single();
    if (error) { toast.error(error.message); return; }
    await syncPromoMenuItem(data as Promo);
    toast.success("Promo created");
    void logAdminAction({ action_type: "promotion_created", action_description: `Created promotion ${newP.title.trim()}`, target_type: "promotion", target_id: data.id, metadata: payload });
    setNewP({ title: "", badge: "", description: "", price_cents: "", image_url: "", active_from: "", active_until: "", branch_id: "", day_of_week: "" });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this promo?")) return;
    const promo = promos.find((item) => item.id === id);
    const { error } = await supabase.from("promotions").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      if (promo?.title) {
        const { data: existing } = await supabase.from("menu_items").select("id").eq("name", promo.title).maybeSingle();
        if (existing?.id) await supabase.from("menu_items").delete().eq("id", existing.id);
      }
      toast.success("Deleted");
      void logAdminAction({ action_type: "promotion_deleted", action_description: `Deleted promotion ${promo?.title ?? id}`, target_type: "promotion", target_id: id });
      load();
    }
  }

  return (
    <div className="min-h-screen bg-muted/40 pb-20">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/admin" className="inline-flex items-center gap-1 text-sm font-semibold"><ArrowLeft className="h-4 w-4" /> Orders</Link>
          <div className="font-display text-xl text-brand inline-flex items-center gap-1.5">
            <Sparkles className="h-4 w-4" /> Promotions
          </div>
          <button onClick={saveAll} disabled={Object.keys(dirty).length === 0} className="inline-flex items-center gap-1 rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-brand-foreground disabled:opacity-40">
            <Save className="h-3.5 w-3.5" /> Save {Object.keys(dirty).length || ""}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-4 space-y-6">
        {/* Create */}
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="font-display text-xl mb-3 inline-flex items-center gap-1.5"><Plus className="h-4 w-4" /> New promotion</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="rounded-md border px-3 py-2 text-sm" placeholder="Title (e.g. Wednesday Special)" value={newP.title} onChange={(e) => setNewP({ ...newP, title: e.target.value })} />
            <input className="rounded-md border px-3 py-2 text-sm" placeholder="Badge (e.g. WED)" value={newP.badge} onChange={(e) => setNewP({ ...newP, badge: e.target.value })} />
            <input className="rounded-md border px-3 py-2 text-sm sm:col-span-2" placeholder="Description" value={newP.description} onChange={(e) => setNewP({ ...newP, description: e.target.value })} />
            <input className="rounded-md border px-3 py-2 text-sm" placeholder="Image URL (optional)" value={newP.image_url} onChange={(e) => setNewP({ ...newP, image_url: e.target.value })} />
            <input type="datetime-local" className="rounded-md border px-3 py-2 text-sm" value={newP.active_from} onChange={(e) => setNewP({ ...newP, active_from: e.target.value })} />
            <input type="datetime-local" className="rounded-md border px-3 py-2 text-sm" value={newP.active_until} onChange={(e) => setNewP({ ...newP, active_until: e.target.value })} />
            <input type="number" step="0.01" className="rounded-md border px-3 py-2 text-sm" placeholder="Price (R, optional)" value={newP.price_cents} onChange={(e) => setNewP({ ...newP, price_cents: e.target.value })} />
            <select className="rounded-md border px-3 py-2 text-sm" value={newP.branch_id} onChange={(e) => setNewP({ ...newP, branch_id: e.target.value })}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select className="rounded-md border px-3 py-2 text-sm" value={newP.day_of_week} onChange={(e) => setNewP({ ...newP, day_of_week: e.target.value })}>
              <option value="">Every day</option>
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <button onClick={create} className="mt-3 rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground">Create promo</button>
        </section>

        {/* Existing */}
        <section>
          <h2 className="font-display text-xl mb-2">Active & scheduled</h2>
          <div className="space-y-2">
            {promos.length === 0 && <div className="text-sm text-muted-foreground">No promotions yet.</div>}
            {promos.map((p) => {
              const patch = dirty[p.id] ?? {};
              const cur = { ...p, ...patch };
              return (
                <div key={p.id} className="rounded-xl border bg-card p-3">
                  <div className="grid gap-2 sm:grid-cols-6">
                    <input className="rounded-md border px-2 py-1.5 text-sm sm:col-span-2" value={cur.title} onChange={(e) => edit(p.id, { title: e.target.value })} />
                    <input className="rounded-md border px-2 py-1.5 text-sm" value={cur.badge ?? ""} onChange={(e) => edit(p.id, { badge: e.target.value || null })} placeholder="Badge" />
                    <input type="number" step="0.01" className="rounded-md border px-2 py-1.5 text-sm" value={cur.price_cents != null ? (cur.price_cents / 100).toFixed(2) : ""} onChange={(e) => edit(p.id, { price_cents: e.target.value ? Math.round(Number(e.target.value) * 100) : null })} placeholder="Price" />
                    <select className="rounded-md border px-2 py-1.5 text-sm" value={cur.branch_id ?? ""} onChange={(e) => edit(p.id, { branch_id: e.target.value || null })}>
                      <option value="">All branches</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.city}</option>)}
                    </select>
                    <select className="rounded-md border px-2 py-1.5 text-sm" value={cur.day_of_week ?? ""} onChange={(e) => edit(p.id, { day_of_week: e.target.value === "" ? null : Number(e.target.value) })}>
                      <option value="">Every day</option>
                      {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </div>
                  <textarea className="mt-2 w-full rounded-md border px-2 py-1.5 text-sm" rows={2} value={cur.description ?? ""} onChange={(e) => edit(p.id, { description: e.target.value || null })} placeholder="Description" />
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <input className="rounded-md border px-2 py-1.5 text-sm" value={cur.image_url ?? ""} onChange={(e) => edit(p.id, { image_url: e.target.value || null })} placeholder="Image URL" />
                    <input type="datetime-local" className="rounded-md border px-2 py-1.5 text-sm" value={cur.active_from ? cur.active_from.slice(0, 16) : ""} onChange={(e) => edit(p.id, { active_from: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                    <input type="datetime-local" className="rounded-md border px-2 py-1.5 text-sm" value={cur.active_until ? cur.active_until.slice(0, 16) : ""} onChange={(e) => edit(p.id, { active_until: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={cur.is_active} onChange={(e) => edit(p.id, { is_active: e.target.checked })} /> Active
                    </label>
                    {cur.price_cents != null && <span className="tabular-nums text-muted-foreground">{formatZAR(cur.price_cents)}</span>}
                    <button onClick={() => remove(p.id)} className="inline-flex items-center gap-1 text-brand hover:underline"><Trash2 className="h-3 w-3" /> Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
