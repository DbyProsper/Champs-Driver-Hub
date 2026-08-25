import { useCallback, useEffect, useState } from "react";
import { Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Message = { id: string; sender_id: string; message_text: string; created_at: string };

export function ComplaintThread({
  complaint,
  onClose,
}: {
  complaint: { id: string; subject: string; status: string };
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [userId, setUserId] = useState("");
  const load = useCallback(async () => {
    const [{ data: auth }, { data, error }] = await Promise.all([
      supabase.auth.getUser(),
      (supabase as any)
        .from("complaint_messages")
        .select("id,sender_id,message_text,created_at")
        .eq("complaint_id", complaint.id)
        .order("created_at"),
    ]);
    setUserId(auth.user?.id ?? "");
    if (error) toast.error(error.message);
    else setMessages(data ?? []);
  }, [complaint.id]);
  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`complaint-${complaint.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "complaint_messages",
          filter: `complaint_id=eq.${complaint.id}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [complaint.id, load]);
  async function send() {
    if (!text.trim() || !userId) return;
    const { error } = await (supabase as any)
      .from("complaint_messages")
      .insert({ complaint_id: complaint.id, sender_id: userId, message_text: text.trim() });
    if (error) return toast.error(error.message);
    setText("");
  }
  const closed = ["resolved", "dismissed"].includes(complaint.status);
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl bg-background p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase text-brand">{complaint.status}</div>
            <h2 className="font-display text-2xl">{complaint.subject}</h2>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 flex-1 space-y-2 overflow-y-auto rounded-2xl bg-muted/40 p-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${message.sender_id === userId ? "ml-auto bg-brand text-brand-foreground" : "bg-background border"}`}
            >
              <div className="whitespace-pre-wrap">{message.message_text}</div>
              <div className="mt-1 text-[9px] opacity-65">
                {new Date(message.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
        {closed ? (
          <div className="mt-3 rounded-xl border p-3 text-center text-xs font-semibold text-muted-foreground">
            This complaint is closed.
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="Write a reply…"
              className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"
            />
            <button
              onClick={() => void send()}
              className="grid h-11 w-11 place-items-center self-end rounded-full bg-brand text-brand-foreground"
              aria-label="Send reply"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
