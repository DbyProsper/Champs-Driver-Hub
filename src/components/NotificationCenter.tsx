import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { getAccessRole } from "@/lib/roles";

type AppNotification = { id: string; type: string; message: string; order_id: string | null; conversation_id: string | null; read_status: boolean; created_at: string };

export function NotificationCenter() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const unread = items.filter((item) => !item.read_status).length;

  const load = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    setUserId(authData.user?.id ?? null);
    if (!authData.user) { setItems([]); return; }
    setRole(await getAccessRole(authData.user.id));
    const { data } = await (supabase as any).from("notifications").select("id,type,message,order_id,conversation_id,read_status,created_at").eq("user_id", authData.user.id).order("created_at", { ascending: false }).limit(50);
    setItems(Array.from(new Map(((data ?? []) as AppNotification[]).map((item) => [item.id, item])).values()));
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
        const item = payload.new as AppNotification;
        setItems((current) => current.some((entry) => entry.id === item.id) ? current : [item, ...current]);
        toast.info(item.message, { id: `app-notification-${item.id}` });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, load]);

  async function markAllRead() {
    if (!userId) return;
    await (supabase as any).from("notifications").update({ read_status: true }).eq("user_id", userId).eq("read_status", false);
    setItems((current) => current.map((item) => ({ ...item, read_status: true })));
  }

  async function openNotification(item: AppNotification) {
    if (!item.read_status) {
      await (supabase as any).from("notifications").update({ read_status: true }).eq("id", item.id).eq("user_id", userId);
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read_status: true } : entry));
    }
    setOpen(false);
    if (item.type === "complaint_update") {
      navigate({ to: "/profile", hash: "complaints" });
      return;
    }
    if (item.order_id) {
      const { data: order } = await supabase.from("orders").select("order_number,user_id").eq("id", item.order_id).maybeSingle();
      if (order?.user_id === userId && order.order_number) {
        navigate({ to: "/order/$number", params: { number: order.order_number } });
        return;
      }
    }
    if (role === "driver") {
      if (item.conversation_id) {
        sessionStorage.setItem("champs-open-conversation", item.conversation_id);
        window.dispatchEvent(new CustomEvent("champs-open-conversation", { detail: item.conversation_id }));
      }
      navigate({ to: "/driver" });
      return;
    }
    if ((role === "admin" || role === "staff") && item.type === "new_message") {
      if (item.conversation_id) sessionStorage.setItem("champs-admin-open-conversation", item.conversation_id);
      navigate({ to: "/admin/messages" });
      return;
    }
    if ((role === "admin" || role === "staff") && (item.type === "driver_report" || item.type === "complaint_update")) {
      navigate({ to: "/admin/complaints" });
      return;
    }
    if (!item.order_id) return;
    const { data: order } = await supabase.from("orders").select("order_number").eq("id", item.order_id).maybeSingle();
    if (order?.order_number) navigate({ to: "/order/$number", params: { number: order.order_number } });
  }

  if (!userId) return null;
  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="relative grid h-8 w-8 place-items-center rounded-full border bg-card" aria-label={`${unread} unread notifications`}>
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[9px] font-bold text-brand-foreground">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-24 z-[100] max-h-[calc(100dvh-8rem)] w-auto overflow-hidden rounded-2xl border bg-background shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-10 sm:max-h-none sm:w-[min(22rem,calc(100vw-2rem))]">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3"><span className="font-display text-lg">Notifications</span><button type="button" onClick={markAllRead} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-semibold text-brand"><CheckCheck className="h-3.5 w-3.5" /> Mark read</button></div>
          <div className="max-h-[calc(100dvh-12rem)] overscroll-contain overflow-y-auto sm:max-h-80">
            {items.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet.</div>}
            {items.map((item) => <button type="button" onClick={() => void openNotification(item)} key={item.id} className={`block w-full border-b px-4 py-3 text-left text-sm last:border-0 hover:bg-muted/60 ${item.read_status ? "" : "bg-brand/5"}`}><div className="break-words">{item.message}</div><div className="mt-1 text-[10px] text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div></button>)}
          </div>
        </div>
      )}
    </div>
  );
}
