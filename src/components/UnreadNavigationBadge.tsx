import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function UnreadNavigationBadge({ types }: { types: string[] }) {
  const [count, setCount] = useState(0);
  const typeKey = types.join("|");
  const stableTypes = useMemo(() => typeKey.split("|"), [typeKey]);
  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setCount(0);
    const { count: unread } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", auth.user.id)
      .eq("read_status", false)
      .in("type", stableTypes);
    setCount(unread ?? 0);
  }, [stableTypes]);
  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`nav-unread-${typeKey}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, typeKey]);
  if (count === 0) return null;
  return (
    <span
      className="ml-auto grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
