import { useState } from "react";
import { X } from "lucide-react";

export function ImagePreview({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-brand" aria-label={`View ${alt}`}>
      <img src={src} alt={alt} className={className ?? "h-12 w-12 rounded-full object-cover"} />
    </button>
    {open && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={alt} onClick={() => setOpen(false)}>
      <button type="button" onClick={() => setOpen(false)} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-background" aria-label="Close image"><X className="h-5 w-5" /></button>
      <img src={src} alt={alt} className="max-h-[85vh] max-w-[min(92vw,48rem)] rounded-2xl object-contain" onClick={(event) => event.stopPropagation()} />
    </div>}
  </>;
}
