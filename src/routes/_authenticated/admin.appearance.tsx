import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Image, Paintbrush, Save, Upload, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FALLBACK_MEDIA, FALLBACK_SETTINGS, imageSrcFor, type MediaAsset, type SiteSettings } from "@/lib/site-content";
import { logAdminAction } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/admin/appearance")({
  head: () => ({ meta: [{ title: "Appearance — Champs Admin" }, { name: "robots", content: "noindex" }] }),
  component: AppearanceAdmin,
});

const IMAGE_KEY_OPTIONS = ["girls-lunch", "chicken-hero", "chicken-chips", "burger-card", "shakes-card", "chef", "couple", "champs-logo"];
const CATEGORY_CARDS = [
  { key: "chicken-hero", label: "Chicken", fallback: "chicken-hero" as const },
  { key: "chicken-chips", label: "Combos", fallback: "chicken-chips" as const },
  { key: "burger-card", label: "Burgers", fallback: "burger-card" as const },
  { key: "shakes-card", label: "Shakes", fallback: "shakes-card" as const },
];

function AppearanceAdmin() {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<SiteSettings>(FALLBACK_SETTINGS);
  const [media, setMedia] = useState<MediaAsset[]>(FALLBACK_MEDIA);
  const [busy, setBusy] = useState(false);
  const [newAsset, setNewAsset] = useState({ title: "", image_key: "", src: "", alt: "", usage: "general" });
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  async function load() {
    const [settingsResult, mediaResult] = await Promise.all([
      supabase.from("site_settings").select("*").eq("id", "main").maybeSingle(),
      supabase.from("media_assets").select("*").order("sort_order"),
    ]);
    if (settingsResult.data) setSettings(settingsResult.data as SiteSettings);
    if (mediaResult.data) setMedia(mediaResult.data as MediaAsset[]);
  }

  useEffect(() => { load(); }, []);

  const mediaMap = useMemo(() => new Map(media.map((item) => [item.image_key, item])), [media]);

  async function saveSettings() {
    setBusy(true);
    try {
      const { error } = await supabase.from("site_settings").upsert(settings);
      if (error) throw error;
      toast.success("Appearance saved");
      await queryClient.invalidateQueries({ queryKey: ["site-content"] });
      void logAdminAction({ action_type: "site_settings_updated", action_description: "Updated site appearance settings", target_type: "site_settings", target_id: "main", metadata: { settings } });
      await load();
    } catch (err: any) {
      toast.error(err.message ?? "Could not save appearance");
    } finally {
      setBusy(false);
    }
  }

  async function saveAsset(asset: MediaAsset) {
    const { error } = await supabase.from("media_assets").update(asset).eq("id", asset.id);
    if (error) toast.error(error.message);
    else { toast.success("Media updated"); await queryClient.invalidateQueries({ queryKey: ["site-content"] }); void logAdminAction({ action_type: "media_asset_updated", action_description: `Updated media asset ${asset.title}`, target_type: "media_asset", target_id: asset.id, metadata: { asset } }); load(); }
  }

  async function createAsset() {
    if (!newAsset.title.trim() || !newAsset.image_key.trim() || !newAsset.src.trim()) {
      toast.error("Title, key and image path are required");
      return;
    }
    const { error } = await supabase.from("media_assets").insert({
      ...newAsset,
      title: newAsset.title.trim(),
      image_key: newAsset.image_key.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      src: newAsset.src.trim(),
      alt: newAsset.alt.trim(),
      usage: newAsset.usage.trim() || "general",
      sort_order: media.length * 10 + 10,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Media added");
      void logAdminAction({ action_type: "media_asset_created", action_description: `Added media asset ${newAsset.title.trim()}`, target_type: "media_asset", metadata: { image_key: newAsset.image_key, src: newAsset.src } });
      setNewAsset({ title: "", image_key: "", src: "", alt: "", usage: "general" });
      await queryClient.invalidateQueries({ queryKey: ["site-content"] });
      load();
    }
  }

  async function uploadCategoryImage(key: string, label: string, file: File) {
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file");
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be smaller than 5 MB");
    setUploadingKey(key);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `homepage/${key}-${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("site-assets").upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("site-assets").getPublicUrl(path);
      const existing = mediaMap.get(key);
      const values = { title: `${label} homepage card`, image_key: key, src: data.publicUrl, alt: `${label} at Champs`, usage: "homepage-card", is_active: true, sort_order: existing?.sort_order ?? 40 };
      const { error } = existing ? await supabase.from("media_assets").update(values).eq("id", existing.id) : await supabase.from("media_assets").insert(values);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["site-content"] });
      await load();
      toast.success(`${label} image updated on the homepage`);
    } catch (error: any) {
      toast.error(error.message ?? "Could not upload image");
    } finally {
      setUploadingKey(null);
    }
  }

  function patchSettings(patch: Partial<SiteSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function patchAsset(id: string, patch: Partial<MediaAsset>) {
    setMedia((current) => current.map((asset) => asset.id === id ? { ...asset, ...patch } : asset));
  }

  return (
    <div className="min-h-screen bg-muted/40 pb-20">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/admin" className="inline-flex items-center gap-1 text-sm font-semibold"><ArrowLeft className="h-4 w-4" /> Orders</Link>
          <div className="font-display text-xl text-brand inline-flex items-center gap-1.5"><Paintbrush className="h-4 w-4" /> Appearance</div>
          <button onClick={saveSettings} disabled={busy} className="inline-flex items-center gap-1 rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-brand-foreground disabled:opacity-60">
            <Save className="h-3.5 w-3.5" /> {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="font-display text-2xl text-brand">Homepage hero</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Eyebrow"><input value={settings.hero_eyebrow} onChange={(e) => patchSettings({ hero_eyebrow: e.target.value })} className="input" /></Field>
              <Field label="Hero image"><select value={settings.hero_image_key} onChange={(e) => patchSettings({ hero_image_key: e.target.value })} className="input">{[...new Set([...IMAGE_KEY_OPTIONS, ...media.map((m) => m.image_key)])].map((key) => <option key={key} value={key}>{mediaMap.get(key)?.title ?? key}</option>)}</select></Field>
              <Field label="Headline line 1"><input value={settings.hero_line_one} onChange={(e) => patchSettings({ hero_line_one: e.target.value })} className="input" /></Field>
              <Field label="Headline line 2"><input value={settings.hero_line_two} onChange={(e) => patchSettings({ hero_line_two: e.target.value })} className="input" /></Field>
              <Field label="Body"><textarea value={settings.hero_body} onChange={(e) => patchSettings({ hero_body: e.target.value })} rows={3} className="input" /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Image focus X"><input type="range" min={0} max={100} value={settings.hero_focus_x} onChange={(e) => patchSettings({ hero_focus_x: Number(e.target.value) })} /></Field>
                <Field label="Image focus Y"><input type="range" min={0} max={100} value={settings.hero_focus_y} onChange={(e) => patchSettings({ hero_focus_y: Number(e.target.value) })} /></Field>
              </div>
              <Field label="Primary button"><input value={settings.primary_cta_label} onChange={(e) => patchSettings({ primary_cta_label: e.target.value })} className="input" /></Field>
              <Field label="Secondary button"><input value={settings.secondary_cta_label} onChange={(e) => patchSettings({ secondary_cta_label: e.target.value })} className="input" /></Field>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h2 className="font-display text-2xl text-brand">Homepage sections</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Toggle label="Specials strip" checked={settings.show_promotions} onChange={(value) => patchSettings({ show_promotions: value })} />
              <Toggle label="Browse menu cards" checked={settings.show_categories} onChange={(value) => patchSettings({ show_categories: value })} />
              <Toggle label="Brand photo strip" checked={settings.show_brand_strip} onChange={(value) => patchSettings({ show_brand_strip: value })} />
              <Toggle label="Branch information" checked={settings.show_branch_info} onChange={(value) => patchSettings({ show_branch_info: value })} />
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h2 className="font-display text-2xl text-brand">Browse the menu images</h2>
            <p className="mt-1 text-xs text-muted-foreground">Upload each homepage category image individually. The current live image is shown below.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {CATEGORY_CARDS.map((card) => <div key={card.key} className="rounded-2xl border p-3"><img src={imageSrcFor(card.key, media, card.fallback)} alt={`${card.label} current image`} className="aspect-[4/3] w-full rounded-xl object-cover" /><div className="mt-2 flex items-center justify-between gap-2"><div><div className="font-semibold">{card.label}</div><div className="text-[10px] text-muted-foreground">Current homepage image</div></div><label className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-brand px-3 py-2 text-xs font-bold text-brand-foreground">{uploadingKey === card.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload<input type="file" accept="image/*" disabled={uploadingKey !== null} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadCategoryImage(card.key, card.label, file); event.target.value = ""; }} /></label></div></div>)}
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h2 className="font-display text-2xl text-brand inline-flex items-center gap-2"><Image className="h-5 w-5" /> Media Library</h2>
            <p className="mt-1 text-xs text-muted-foreground">Images referenced here can be picked as the hero, homepage cards, or per-menu-item photos. Paste a path from <code>/images/champs/</code> or a full URL.</p>
            <div className="mt-3 space-y-3">
              {media.map((asset) => {
                const isHero = asset.image_key === settings.hero_image_key;
                return (
                  <div key={asset.id} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[84px_1fr_auto]">
                    <div className="relative h-20 w-20">
                      <img src={asset.src} alt={asset.alt} className="h-20 w-20 rounded-lg object-cover" />
                      {isHero && <span className="absolute -top-1 -right-1 rounded-full bg-brand px-1.5 py-0.5 text-[9px] font-bold uppercase text-brand-foreground">Hero</span>}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input className="input" value={asset.title} onChange={(e) => patchAsset(asset.id, { title: e.target.value })} placeholder="Title" />
                      <input className="input" value={asset.image_key} onChange={(e) => patchAsset(asset.id, { image_key: e.target.value })} placeholder="Key" />
                      <input className="input sm:col-span-2" value={asset.src} onChange={(e) => patchAsset(asset.id, { src: e.target.value })} placeholder="Image path or URL" />
                      <input className="input" value={asset.alt} onChange={(e) => patchAsset(asset.id, { alt: e.target.value })} placeholder="Alt text" />
                      <input className="input" value={asset.usage} onChange={(e) => patchAsset(asset.id, { usage: e.target.value })} placeholder="Usage tag" />
                    </div>
                    <button onClick={() => saveAsset(asset)} className="self-start rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground">Save</button>
                  </div>
                );
              })}
            </div>
          </section>

        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="font-display text-2xl text-brand">Preview</h2>
            <div className="mt-3 overflow-hidden rounded-2xl bg-charcoal text-white">
              <div className="relative aspect-[9/14]">
                <img src={imageSrcFor(settings.hero_image_key, media, "girls-lunch")} alt="Hero preview" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: `${settings.hero_focus_x}% ${settings.hero_focus_y}%` }} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />
                <div className="absolute bottom-0 p-5">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-white/80">{settings.hero_eyebrow}</div>
                  <div className="mt-2 font-display text-5xl leading-none"><span>{settings.hero_line_one}</span><br /><span className="text-brand">{settings.hero_line_two}</span></div>
                  <p className="mt-3 text-xs text-white/80">{settings.hero_body}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h2 className="font-display text-2xl text-brand">Add image reference</h2>
            <div className="mt-3 space-y-2">
              <input className="input" placeholder="Title" value={newAsset.title} onChange={(e) => setNewAsset({ ...newAsset, title: e.target.value })} />
              <input className="input" placeholder="Key, e.g. saturday-special" value={newAsset.image_key} onChange={(e) => setNewAsset({ ...newAsset, image_key: e.target.value })} />
              <input className="input" placeholder="/images/champs/file.jpg" value={newAsset.src} onChange={(e) => setNewAsset({ ...newAsset, src: e.target.value })} />
              <input className="input" placeholder="Alt text" value={newAsset.alt} onChange={(e) => setNewAsset({ ...newAsset, alt: e.target.value })} />
              <input className="input" placeholder="Usage" value={newAsset.usage} onChange={(e) => setNewAsset({ ...newAsset, usage: e.target.value })} />
              <button onClick={createAsset} className="w-full rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground">Add to library</button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground"><span>{label}</span>{children}</label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm font-semibold">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
