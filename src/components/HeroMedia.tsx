import { useEffect, useRef } from "react";
import type { MediaAsset } from "@/lib/site-content";

export function isVideoMedia(asset: Pick<MediaAsset, "media_type" | "src"> | null | undefined) {
  return asset?.media_type === "video" || /\.(mp4|webm)(?:$|[?#])/i.test(asset?.src ?? "");
}

type HeroMediaProps = {
  asset: Pick<MediaAsset, "src" | "alt" | "media_type">;
  active: boolean;
  opacity: number;
  objectPosition: string;
  motionDurationMs: number;
  className?: string;
};

export function HeroMedia({ asset, active, opacity, objectPosition, motionDurationMs, className = "" }: HeroMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) {
      video.currentTime = 0;
      void video.play().catch(() => undefined);
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [active]);

  const sharedStyle = {
    objectPosition,
    opacity: active ? opacity : 0,
    animationDuration: active ? `${motionDurationMs}ms` : undefined,
  };
  const motionClass = active ? "hero-media-zoom-out" : "";

  if (isVideoMedia(asset)) {
    return (
      <video
        ref={videoRef}
        src={asset.src}
        aria-label={asset.alt}
        muted
        playsInline
        autoPlay={active}
        controls={false}
        preload={active ? "auto" : "metadata"}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 motion-reduce:transition-none ${motionClass} ${className}`}
        style={sharedStyle}
      />
    );
  }

  return (
    <img
      src={asset.src}
      alt={asset.alt}
      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 motion-reduce:transition-none ${motionClass} ${className}`}
      style={sharedStyle}
    />
  );
}

export function MediaThumbnail({ asset, className = "" }: { asset: Pick<MediaAsset, "src" | "alt" | "media_type">; className?: string }) {
  if (isVideoMedia(asset)) {
    return <video src={asset.src} aria-label={asset.alt} muted playsInline controls={false} preload="metadata" className={className} />;
  }
  return <img src={asset.src} alt={asset.alt} className={className} />;
}
