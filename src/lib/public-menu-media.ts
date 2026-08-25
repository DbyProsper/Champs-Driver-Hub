import type { MediaAsset } from "@/lib/site-content";

const files = [
  "1 piece chicken.png", "1 piece fish .png", "2 piece chicken.png", "21 piece chicken.png", "3 piece chicken.png", "4 piece chicken.png", "5 piece chicken.png", "9 piece chicken.png", "Buns.png", "Chicken salad.png", "Chips - Large.png", "Chips - Regular.png", "Chips - Small.png", "Coke 2L.png", "Combo 1.png", "Combo 2.png", "Combo 3.png", "Combo 4.png", "Combo 5.png", "Combo 6.png", "Double Dekka Burger.png", "Double Stack Cheese Burger.png", "Fish & Chips.png", "Fish Burger.png", "Fish Salad.png", "Frostee Shake - Choc.png", "Frostee Shake - Lime.png", "Frostee Shake - Strawberry.png", "Hot chilli sauce.png", "Mississippi Burger.png", "Mountain Dew Can.png", "Mustard Sauce.png", "Pepsi 2L.png", "Pespsi Can.png", "Powerade 500ml.png", "Soft serve cone.png", "Soft serve cup.png", "Spar Letta 2L.png", "Sundae - Caramel.png", "Sundae - Choc.png", "Sundae - Strawberry.png", "Sweet Chilli Sauce.png", "Tomato Sauce.png",
];

export const PUBLIC_MENU_MEDIA: MediaAsset[] = files.map((file, index) => ({
  id: `public-menu-${index}`,
  title: file.replace(/\.[^.]+$/, ""),
  image_key: `menu-${file.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
  src: `/images/menu%20images/${encodeURIComponent(file)}`,
  alt: file.replace(/\.[^.]+$/, ""),
  usage: "menu-library",
  is_active: true,
  sort_order: 1000 + index,
  created_at: "",
  updated_at: "",
}));

export function mergePublicMenuMedia(databaseAssets: MediaAsset[]) {
  const existing = new Set(databaseAssets.map((asset) => decodeURIComponent(asset.src).toLowerCase()));
  return [...databaseAssets, ...PUBLIC_MENU_MEDIA.filter((asset) => !existing.has(decodeURIComponent(asset.src).toLowerCase()))];
}
