import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fireNotification } from "@/lib/notifications";
import { useNavigate } from "@tanstack/react-router";

type AppNotification = { id: string; type: string; message: string; order_id: string | null; read_status: boolean; created_at: string };

export function NotificationCenter() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const unread = items.filter((item) => !item.read_status).length;

  const load = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    setUserId(authData.user?.id ?? null);
    if (!authData.user) { setItems([]); return; }
    const { data } = await (supabase as any).from("notifications").select("id,type,message,order_id,read_status,created_at").eq("user_id", authData.user.id).order("created_at", { ascending: false }).limit(50);
    setItems((data ?? []) as AppNotification[]);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
        const item = payload.new as AppNotification;
        setItems((current) => [item, ...current]);
        toast.info(item.message);
        fireNotification("Champs Chicken", item.message, `notification-${item.id}`);
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
    if (!item.order_id) return;
    const { data: order } = await supabase.from("orders").select("order_number").eq("id", item.order_id).maybeSingle();
    if (order?.order_number) navigate({ to: "/order/$number", params: { number: order.order_number } });
  }

  if (!userId) return null;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="relative grid h-8 w-8 place-items-center rounded-full border bg-card" aria-label={`${unread} unread notifications`}>
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[9px] font-bold text-brand-foreground">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-[70] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border bg-background shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3"><span className="font-display text-lg">Notifications</span><button type="button" onClick={markAllRead} className="inline-flex items-center gap-1 text-xs font-semibold text-brand"><CheckCheck className="h-3.5 w-3.5" /> Mark read</button></div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet.</div>}
            {items.map((item) => <button type="button" onClick={() => void openNotification(item)} key={item.id} className={`block w-full border-b px-4 py-3 text-left text-sm last:border-0 hover:bg-muted/60 ${item.read_status ? "" : "bg-brand/5"}`}><div>{item.message}</div><div className="mt-1 text-[10px] text-muted-foreground">{new Date(item.created_at).toLocaleString()}</div></button>)}
          </div>
        </div>
      )}
    </div>
  );
}
