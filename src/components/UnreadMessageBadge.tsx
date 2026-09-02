import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

let unreadChannelSequence = 0;

export function UnreadMessageBadge({ orderId, conversationType }: { orderId?: string; conversationType: "customer_driver" | "driver_admin" }) {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setCount(0);
    let conversations = (supabase as any).from("conversations").select("id").eq("conversation_type", conversationType);
    if (orderId) conversations = conversations.eq("order_id", orderId);
    const { data: rows } = await conversations;
    const ids = (rows ?? []).map((row: { id: string }) => row.id);
    if (!ids.length) return setCount(0);
    const { count: unread } = await (supabase as any)
      .from("messages")
      .select("id", { count: "exact", head: true })
      .in("conversation_id", ids)
      .eq("receiver_id", auth.user.id)
      .eq("read_status", false)
      .not("sender_id", "is", null);
    setCount(unread ?? 0);
  }, [conversationType, orderId]);

  useEffect(() => {
    void load();
    const channelSequence = ++unreadChannelSequence;
    const channel = supabase
      .channel(`unread-chat:${conversationType}:${orderId ?? "general"}:${channelSequence}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationType, load, orderId]);

  if (!count) return null;
  return <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white" aria-label={`${count} unread messages`}>{count > 99 ? "99+" : count}</span>;
}
