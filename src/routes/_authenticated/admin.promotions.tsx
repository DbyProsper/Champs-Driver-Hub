import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2, Save, Sparkles, Image as ImageIcon, X, Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatZAR } from "@/lib/format";
import { toast } from "sonner";
import { logAdminAction } from "@/lib/audit";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { useQueryClient } from "@tanstack/react-query";
import { mergePublicMenuMedia } from "@/lib/public-menu-media";
import type { MediaAsset } from "@/lib/site-content";

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
  const queryClient = useQueryClient();
  const [promos, setPromos] = useState<Promo[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [dirty, setDirty] = useState<Record<string, Partial<Promo>>>({});
  const [newP, setNewP] = useState({ title: "", badge: "", description: "", price_cents: "", image_url: "", active_from: "", active_until: "", branch_id: "", day_of_week: "" });
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [pickerFor, setPickerFor] = useState<"new" | string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function load() {
    const [p, b, m] = await Promise.all([
      supabase.from("promotions").select("*").order("sort_order"),
      supabase.from("branches").select("id, name, city").order("sort_order"),
      supabase.from("media_assets").select("*").order("sort_order"),
    ]);
    setPromos((p.data as Promo[]) ?? []);
    setBranches((b.data as Branch[]) ?? []);
    setMedia(mergePublicMenuMedia((m.data as MediaAsset[]) ?? []));
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

  async function saveAll(): Promise<boolean> {
    const entries = Object.entries(dirty);
    if (entries.length === 0) return true;
    for (const [id, patch] of entries) {
      const current = promos.find((item) => item.id === id);
      const { error } = await supabase.from("promotions").update(patch).eq("id", id);
      if (error) { toast.error(error.message); return false; }
      if (current) await syncPromoMenuItem({ ...current, ...patch } as Promo);
    }
    void Promise.all(entries.map(([id, patch]) => logAdminAction({ action_type: "promotion_updated", action_description: `Updated promotion ${id}`, target_type: "promotion", target_id: id, metadata: { changes: patch } })));
    toast.success("Saved");
    setDirty({});
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["promotions"] }), queryClient.invalidateQueries({ queryKey: ["menu"] })]);
    await load();
    return true;
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
    setBusyAction("create");
    const { data, error } = await supabase.from("promotions").insert(payload).select("*").single();
    setBusyAction(null);
    if (error) { toast.error(error.message); return; }
    await syncPromoMenuItem(data as Promo);
    toast.success("Promo created");
    void logAdminAction({ action_type: "promotion_created", action_description: `Created promotion ${newP.title.trim()}`, target_type: "promotion", target_id: data.id, metadata: payload });
    setNewP({ title: "", badge: "", description: "", price_cents: "", image_url: "", active_from: "", active_until: "", branch_id: "", day_of_week: "" });
    load();
  }

  async function uploadPromoImage(file: File) {
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file");
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be smaller than 5 MB");
    setBusyAction("upload-image");
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const path = `promotions/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("site-assets").upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("site-assets").getPublicUrl(path);
      const title = file.name.replace(/\.[^.]+$/, "");
      const { data: asset, error: assetError } = await supabase.from("media_assets").insert({ title, image_key: `promo-${crypto.randomUUID()}`, src: data.publicUrl, alt: title, usage: "promotion", is_active: true, sort_order: media.length * 10 + 10 }).select("*").single();
      if (assetError) throw assetError;
      setMedia((current) => [asset as MediaAsset, ...current]);
      if (pickerFor === "new") setNewP((current) => ({ ...current, image_url: data.publicUrl }));
      else if (pickerFor) edit(pickerFor, { image_url: data.publicUrl });
      setPickerFor(null);
      toast.success("Promotion image uploaded and selected");
    } catch (error: any) {
      toast.error(error.message ?? "Could not upload promotion image");
    } finally {
      setBusyAction(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this promo?")) return;
    const promo = promos.find((item) => item.id === id);
    setBusyAction(`delete-${id}`);
    const { error } = await supabase.from("promotions").delete().eq("id", id);
    setBusyAction(null);
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
      <UnsavedChangesGuard dirty={Object.keys(dirty).length > 0} onSave={saveAll} />
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
            {newP.image_url && <div className="sm:col-span-2"><div className="mb-1 text-xs font-semibold text-muted-foreground">Customer homepage preview</div><div className="aspect-square w-full max-w-64 overflow-hidden rounded-2xl border bg-muted"><img src={newP.image_url} alt="Selected promotion preview" className="h-full w-full object-cover" /></div></div>}
            <button type="button" onClick={() => setPickerFor("new")} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold"><ImageIcon className="h-4 w-4" /> {newP.image_url ? "Change promo image" : "Choose promo image"}</button>
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
          <button onClick={create} disabled={busyAction === "create"} className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground disabled:opacity-60">{busyAction === "create" && <Loader2 className="h-4 w-4 animate-spin" />}Create promo</button>
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
                  {cur.image_url && <div className="mt-2"><div className="mb-1 text-xs font-semibold text-muted-foreground">Customer homepage preview</div><div className="aspect-square w-full max-w-64 overflow-hidden rounded-2xl border bg-muted"><img src={cur.image_url} alt={`${cur.title} promotion preview`} className="h-full w-full object-cover" /></div></div>}
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <button type="button" onClick={() => setPickerFor(p.id)} className="inline-flex items-center justify-center gap-2 rounded-md border px-2 py-1.5 text-sm font-semibold"><ImageIcon className="h-4 w-4" /> {cur.image_url ? "Change image" : "Choose image"}</button>
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
      {pickerFor && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4" onClick={() => setPickerFor(null)}><div className="w-full max-w-3xl rounded-2xl bg-background p-4" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 className="font-display text-2xl text-brand">Choose promo image</h2><button onClick={() => setPickerFor(null)} className="grid h-9 w-9 place-items-center rounded-full border"><X className="h-4 w-4" /></button></div><label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground">{busyAction === "upload-image" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload from device<input type="file" accept="image/*" disabled={busyAction === "upload-image"} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPromoImage(file); event.target.value = ""; }} /></label><div className="mt-3 grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">{media.map((asset) => <button key={asset.id} onClick={() => { if (pickerFor === "new") setNewP((current) => ({ ...current, image_url: asset.src })); else edit(pickerFor, { image_url: asset.src }); setPickerFor(null); }} className="overflow-hidden rounded-xl border text-left hover:border-brand"><img src={asset.src} alt={asset.alt} className="aspect-square w-full bg-muted object-contain" /><div className="truncate p-2 text-xs font-semibold">{asset.title}</div></button>)}</div></div></div>}
    </div>
  );
}
