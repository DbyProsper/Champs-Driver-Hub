import type { MediaAsset } from "@/lib/site-content";

const publicImages = import.meta.glob("/public/images/**/*.{png,jpg,jpeg,webp,gif,avif,svg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export const PUBLIC_MENU_MEDIA: MediaAsset[] = Object.entries(publicImages).map(([path, bundledUrl], index) => {
  const file = path.split("/").pop() ?? `Image ${index + 1}`;
  const title = file.replace(/\.[^.]+$/, "");
  return {
    id: `public-image-${index}`,
    title,
    image_key: `public-${path.toLowerCase().replace(/^\/public\/images\//, "").replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    src: bundledUrl || path.replace(/^\/public/, ""),
    alt: title,
    usage: path.toLowerCase().includes("menu") ? "menu-library" : "public-library",
    is_active: true,
    sort_order: 1000 + index,
    created_at: "",
    updated_at: "",
  };
});

export function mergePublicMenuMedia(databaseAssets: MediaAsset[]) {
  const existing = new Set(databaseAssets.map((asset) => decodeURIComponent(asset.src).toLowerCase()));
  return [...databaseAssets, ...PUBLIC_MENU_MEDIA.filter((asset) => !existing.has(decodeURIComponent(asset.src).toLowerCase()))];
}
