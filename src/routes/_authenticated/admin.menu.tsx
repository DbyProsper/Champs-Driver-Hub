import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Save, Plus, Trash2, Image as ImageIcon, X, GripVertical, BadgePercent } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatZAR } from "@/lib/format";
import { toast } from "sonner";
import { getMenuImageForItem } from "@/lib/menu-images";
import { FALLBACK_MEDIA, type MediaAsset } from "@/lib/site-content";
import { logAdminAction } from "@/lib/audit";
import { mergePublicMenuMedia } from "@/lib/public-menu-media";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/admin/menu")({
  head: () => ({ meta: [{ title: "Edit Menu — Champs Admin" }, { name: "robots", content: "noindex" }] }),
  component: MenuAdmin,
});

type Item = {
  id: string;
  name: string;
  variant_label: string | null;
  description: string | null;
  price_cents: number;
  is_available: boolean;
  category_id: string;
  sort_order: number;
  image_url: string | null;
  special_price_cents: number | null;
  burger_only_price_cents: number | null;
  icon_text: string | null;
};

type Cat = { id: string; name: string; slug: string; sort_order: number };

function MenuAdmin() {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [media, setMedia] = useState<MediaAsset[]>(FALLBACK_MEDIA);
  const [dirty, setDirty] = useState<Record<string, Partial<Item>>>({});
  const [newItem, setNewItem] = useState<Record<string, { name: string; variant: string; price: string }>>({});
  const [newCat, setNewCat] = useState("");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  async function load() {
    const [i, c, m] = await Promise.all([
      supabase.from("menu_items").select("*").order("sort_order"),
      supabase.from("categories").select("*").order("sort_order"),
      supabase.from("media_assets").select("*").order("sort_order"),
    ]);
    setItems((i.data as Item[]) ?? []);
    setCats((c.data as Cat[]) ?? []);
    setMedia(mergePublicMenuMedia((m.data as MediaAsset[]) ?? []));
  }
  useEffect(() => { load(); }, []);


  function edit(id: string, patch: Partial<Item>) {
    setDirty((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  async function saveAll(): Promise<boolean> {
    const entries = Object.entries(dirty);
    if (entries.length === 0) return true;
    for (const [id, patch] of entries) {
      const { error } = await supabase.from("menu_items").update(patch).eq("id", id);
      if (error) { toast.error(`${id}: ${error.message}`); return false; }
    }
    void Promise.all(entries.map(([id, patch]) => logAdminAction({ action_type: "menu_item_updated", action_description: `Updated menu item ${id}`, target_type: "menu_item", target_id: id, metadata: { changes: patch } })));
    toast.success("Saved");
    setDirty({});
    await queryClient.invalidateQueries({ queryKey: ["menu"] });
    await load();
    return true;
  }

  async function addItem(catId: string) {
    const n = newItem[catId];
    if (!n || !n.name.trim() || !n.price) { toast.error("Name & price required"); return; }
    const maxSort = Math.max(0, ...items.filter((i) => i.category_id === catId).map((i) => i.sort_order));
    const { error } = await supabase.from("menu_items").insert({
      category_id: catId,
      name: n.name.trim(),
      variant_label: n.variant.trim() || null,
      price_cents: Math.round(Number(n.price) * 100),
      sort_order: maxSort + 10,
    } as never);
    if (error) toast.error(error.message);
    else {
      toast.success("Item added");
      void logAdminAction({ action_type: "menu_item_created", action_description: `Created menu item ${n.name.trim()}`, target_type: "menu_item", metadata: { category_id: catId, price_cents: Math.round(Number(n.price) * 100), variant: n.variant.trim() || null } });
      setNewItem({ ...newItem, [catId]: { name: "", variant: "", price: "" } });
      load();
    }
  }

  async function removeItem(id: string) {
    if (!confirm("Delete this item?")) return;
    const { error } = await supabase.from("menu_items").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); void logAdminAction({ action_type: "menu_item_deleted", action_description: "Deleted menu item", target_type: "menu_item", target_id: id }); load(); }
  }

  function moveDraggedItem(target: Item) {
    if (!draggedId || draggedId === target.id) return;
    const dragged = items.find((item) => item.id === draggedId);
    if (!dragged || dragged.category_id !== target.category_id) return;
    const siblings = items.filter((item) => item.category_id === target.category_id).sort((a, b) => a.sort_order - b.sort_order);
    const from = siblings.findIndex((item) => item.id === draggedId);
    const to = siblings.findIndex((item) => item.id === target.id);
    const reordered = [...siblings];
    reordered.splice(to, 0, reordered.splice(from, 1)[0]);
    const order = new Map(reordered.map((item, index) => [item.id, (index + 1) * 10]));
    setItems((current) => current.map((item) => order.has(item.id) ? { ...item, sort_order: order.get(item.id)! } : item));
    setDirty((current) => ({ ...current, ...Object.fromEntries(reordered.map((item, index) => [item.id, { ...current[item.id], sort_order: (index + 1) * 10 }])) }));
  }

  async function addCategory() {
    if (!newCat.trim()) return;
    const slug = newCat.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const maxSort = Math.max(0, ...cats.map((c) => c.sort_order));
    const { error } = await supabase.from("categories").insert({ name: newCat.trim(), slug, sort_order: maxSort + 10 } as never);
    if (error) toast.error(error.message);
    else { toast.success("Category added"); void logAdminAction({ action_type: "category_created", action_description: `Created category ${newCat.trim()}`, target_type: "category", metadata: { name: newCat.trim(), slug } }); setNewCat(""); load(); }
  }

  return (
    <div className="min-h-screen bg-muted/40 pb-20">
      <UnsavedChangesGuard dirty={Object.keys(dirty).length > 0} onSave={saveAll} />
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/admin" className="inline-flex items-center gap-1 text-sm font-semibold"><ArrowLeft className="h-4 w-4" /> Orders</Link>
          <div className="font-display text-xl text-brand">Edit Menu</div>
          <button onClick={saveAll} disabled={Object.keys(dirty).length === 0} className="inline-flex items-center gap-1 rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-brand-foreground disabled:opacity-40">
            <Save className="h-3.5 w-3.5" /> Save {Object.keys(dirty).length || ""}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-4 space-y-6">
        {/* Add category */}
        <div className="rounded-xl border bg-card p-3 flex items-center gap-2">
          <input className="flex-1 rounded-md border px-3 py-2 text-sm" placeholder="New category name" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <button onClick={addCategory} className="rounded-full bg-brand px-4 py-2 text-xs font-bold text-brand-foreground">Add category</button>
        </div>

        {cats.map((c) => {
          const catItems = items.filter((i) => i.category_id === c.id).sort((a, b) => a.sort_order - b.sort_order);
          const ni = newItem[c.id] ?? { name: "", variant: "", price: "" };
          return (
            <section key={c.id}>
              <h2 className="font-display text-2xl text-brand mb-2">{c.name}</h2>
              <div className="rounded-2xl border bg-card divide-y">
                {catItems.map((it) => {
                  const patch = dirty[it.id] ?? {};
                  const cur = { ...it, ...patch };
                  const auto = getMenuImageForItem(cur.name, cur.variant_label);
                  const imgSrc = cur.image_url || auto.src;
                  return (
                    <div key={it.id} data-menu-item-id={it.id} draggable onDragStart={(event) => { setDraggedId(it.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", it.id); }} onDragEnd={() => setDraggedId(null)} onDragEnter={(event) => { event.preventDefault(); moveDraggedItem(it); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); setDraggedId(null); }} className={`grid gap-3 p-3 transition-[transform,opacity,background-color] duration-150 sm:grid-cols-[auto_1fr_auto] sm:items-start ${draggedId === it.id ? "scale-[0.98] bg-brand/10 opacity-60 shadow-lg" : draggedId ? "bg-background" : ""}`}>
                      <div className="flex items-center gap-2 sm:flex-col">
                      <button
                        type="button"
                        onClick={() => setPickerFor(it.id)}
                        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-muted"
                        title="Change image"
                      >
                        <img src={imgSrc} alt="" className="h-full w-full object-cover" />
                        <span className="absolute inset-x-0 bottom-0 bg-black/55 text-[9px] font-bold uppercase text-white text-center py-0.5">
                          {cur.image_url ? "Custom" : "Auto"}
                        </span>
                      </button>
                      <button type="button" aria-label={`Drag ${cur.name} to reorder`} style={{ touchAction: "none" }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDraggedId(it.id); }} onPointerMove={(event) => { if (!draggedId) return; const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-menu-item-id]"); const target = row ? items.find((item) => item.id === row.dataset.menuItemId) : null; if (target) moveDraggedItem(target); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDraggedId(null); }} onPointerCancel={() => setDraggedId(null)} className="inline-flex cursor-grab select-none items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold uppercase text-muted-foreground active:cursor-grabbing"><GripVertical className="h-4 w-4" /> Drag</button>
                      </div>
                      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                      <input
                        className="rounded-md border px-2 py-1.5 text-sm sm:col-span-2"
                        value={cur.name}
                        onChange={(e) => edit(it.id, { name: e.target.value })}
                      />
                      <input
                        className="rounded-md border px-2 py-1.5 text-sm"
                        placeholder="variant"
                        value={cur.variant_label ?? ""}
                        onChange={(e) => edit(it.id, { variant_label: e.target.value || null })}
                      />
                      <input className="rounded-md border px-2 py-1.5 text-sm" maxLength={12} placeholder="Icon, e.g. 🍔" value={cur.icon_text ?? ""} onChange={(e) => edit(it.id, { icon_text: e.target.value || null })} />
                      <textarea className="min-h-20 rounded-md border px-2 py-1.5 text-sm sm:col-span-2" placeholder="Menu description" value={cur.description ?? ""} onChange={(e) => edit(it.id, { description: e.target.value || null })} />
                      <label className="space-y-1 text-xs"><span className="text-muted-foreground">Regular price</span>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">R</span>
                        <input
                          type="number" step="0.01" min="0"
                          className="w-24 rounded-md border px-2 py-1.5 text-sm tabular-nums"
                          value={((cur.price_cents ?? 0) / 100).toFixed(2)}
                          onChange={(e) => edit(it.id, { price_cents: Math.round(Number(e.target.value) * 100) })}
                        />
                      </div>
                      </label>
                      <label className="space-y-1 text-xs"><span className="inline-flex items-center gap-1 text-brand"><BadgePercent className="h-3 w-3" /> Special price (optional)</span><div className="flex items-center gap-1"><span>R</span><input type="number" step="0.01" min="0" className="w-full rounded-md border px-2 py-1.5 text-sm" value={cur.special_price_cents == null ? "" : (cur.special_price_cents / 100).toFixed(2)} onChange={(e) => edit(it.id, { special_price_cents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })} /></div></label>
                      <label className="space-y-1 text-xs sm:col-span-2"><span className="text-muted-foreground">Burger-only price (leave empty when not applicable)</span><div className="flex items-center gap-1"><span>R</span><input type="number" step="0.01" min="0" className="w-full rounded-md border px-2 py-1.5 text-sm" value={cur.burger_only_price_cents == null ? "" : (cur.burger_only_price_cents / 100).toFixed(2)} onChange={(e) => edit(it.id, { burger_only_price_cents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })} /></div></label>
                      <label className="inline-flex items-center gap-2 text-xs sm:col-span-2">
                        <input
                          type="checkbox"
                          checked={cur.is_available}
                          onChange={(e) => edit(it.id, { is_available: e.target.checked })}
                        />
                        Available
                      </label>
                      <span className="text-xs text-muted-foreground tabular-nums sm:col-span-2">Displayed: {formatZAR(cur.special_price_cents ?? cur.price_cents ?? 0)}</span>
                      </div>
                      <button onClick={() => removeItem(it.id)} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-brand hover:bg-brand/10" aria-label="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      {pickerFor === it.id && (
                        <ImagePicker
                          media={media}
                          currentUrl={cur.image_url}
                          autoSrc={auto.src}
                          onClose={() => setPickerFor(null)}
                          onPick={(url) => { edit(it.id, { image_url: url }); setPickerFor(null); }}
                        />
                      )}
                    </div>
                  );
                })}

                {/* Add new item to category */}
                <div className="grid gap-2 bg-muted/40 p-3 sm:grid-cols-[1fr_8rem_7rem_auto]">
                  <input
                    className="flex-1 min-w-40 rounded-md border px-2 py-1.5 text-sm"
                    placeholder="New item name"
                    value={ni.name}
                    onChange={(e) => setNewItem({ ...newItem, [c.id]: { ...ni, name: e.target.value } })}
                  />
                  <input
                    className="w-32 rounded-md border px-2 py-1.5 text-sm"
                    placeholder="variant"
                    value={ni.variant}
                    onChange={(e) => setNewItem({ ...newItem, [c.id]: { ...ni, variant: e.target.value } })}
                  />
                  <input
                    type="number" step="0.01"
                    className="w-24 rounded-md border px-2 py-1.5 text-sm"
                    placeholder="R"
                    value={ni.price}
                    onChange={(e) => setNewItem({ ...newItem, [c.id]: { ...ni, price: e.target.value } })}
                  />
                  <button onClick={() => addItem(c.id)} className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground">
                    <Plus className="h-3 w-3" /> Add
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ImagePicker({
  media,
  currentUrl,
  autoSrc,
  onClose,
  onPick,
}: {
  media: MediaAsset[];
  currentUrl: string | null;
  autoSrc: string;
  onClose: () => void;
  onPick: (url: string | null) => void;
}) {
  const [url, setUrl] = useState(currentUrl ?? "");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-xl text-brand inline-flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Choose image</div>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground">Pick from the media library, paste a URL, or reset to the automatic image.</p>

        <div className="mt-3 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          <button onClick={() => onPick(null)} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted">
            <img src={autoSrc} alt="Auto" className="h-full w-full object-cover opacity-70" />
            <span className="absolute inset-x-0 bottom-0 bg-black/60 text-[10px] font-bold text-white text-center py-0.5">Auto (default)</span>
          </button>
          {media.map((m) => (
            <button key={m.id} onClick={() => onPick(m.src)} className="group relative aspect-square overflow-hidden rounded-lg border">
              <img src={m.src} alt={m.alt} className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-black/60 text-[10px] font-bold text-white text-center py-0.5 truncate">{m.title}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            className="flex-1 rounded-md border px-3 py-2 text-sm"
            placeholder="https://... or /images/champs/file.jpg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            onClick={() => onPick(url.trim() || null)}
            className="rounded-full bg-brand px-4 py-2 text-xs font-bold text-brand-foreground"
          >
            Use URL
          </button>
        </div>
      </div>
    </div>
  );
}

