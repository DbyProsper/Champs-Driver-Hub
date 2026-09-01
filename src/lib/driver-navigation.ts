export type NavigationPoint = { lat: number; lng: number };

export function straightLineDistanceMeters(a: NavigationPoint, b: NavigationPoint) {
  const earthRadiusMetres = 6_371_000;
  const latitudeDelta = ((b.lat - a.lat) * Math.PI) / 180;
  const longitudeDelta = ((b.lng - a.lng) * Math.PI) / 180;
  const startLatitude = (a.lat * Math.PI) / 180;
  const endLatitude = (b.lat * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMetres * Math.asin(Math.sqrt(haversine));
}

export function googleNavigationUrl(destination: NavigationPoint | null, address: string | null, origin?: NavigationPoint | null) {
  if (!destination && !address) return null;
  if (!destination) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address!)}`;
  const originQuery = origin ? `&origin=${origin.lat},${origin.lng}` : "";
  return `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}${originQuery}&travelmode=driving`;
}
