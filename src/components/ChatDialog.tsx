import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  receiver_id: string;
  message_text: string;
  message_type: "text" | "system";
  read_status: boolean;
  created_at: string;
};

type Props = {
  orderId?: string;
  driverId?: string;
  conversationId?: string;
  audience?: "customer" | "champs";
  quickReplies?: string[];
  label?: string;
  className?: string;
  initialOpen?: boolean;
  hideTrigger?: boolean;
  onClose?: () => void;
};

const EMPTY_REPLIES: string[] = [];

export function ChatDialog({ orderId, driverId, conversationId: requestedConversationId, audience = "customer", quickReplies = EMPTY_REPLIES, label = "Chat", className = "", initialOpen = false, hideTrigger = false, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (initialOpen) setOpen(true); }, [initialOpen]);

  async function initialize() {
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Sign in to use in-app chat");
      setUserId(userData.user.id);
      let id = requestedConversationId;
      if (!id) {
        const isChampsChat = audience === "champs" || (!orderId && Boolean(driverId));
        const fn = isChampsChat ? "start_driver_admin_conversation" : "start_order_conversation";
        const args = isChampsChat ? { _driver_id: driverId, _order_id: orderId ?? null } : { _order_id: orderId };
        const result = await (supabase.rpc as any)(fn, args);
        if (result.error) throw result.error;
        id = result.data as string;
      }
      setConversationId(id as string);
      const { data, error: messageError } = await (supabase as any).from("messages")
        .select("id,conversation_id,sender_id,receiver_id,message_text,message_type,read_status,created_at")
        .eq("conversation_id", id)
        .order("created_at");
      if (messageError) throw messageError;
      setMessages((data ?? []) as ChatMessage[]);
      await (supabase.rpc as any)("mark_conversation_read", { _conversation_id: id });
    } catch (error: any) {
      toast.error(error.message ?? "Could not open chat");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void initialize();
  }, [open, orderId, driverId, audience, requestedConversationId]);

  useEffect(() => {
    if (!open || !conversationId) return;
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        const incoming = payload.new as ChatMessage;
        setMessages((current) => current.some((message) => message.id === incoming.id) ? current : [...current, incoming]);
        if (incoming.receiver_id === userId) void (supabase.rpc as any)("mark_conversation_read", { _conversation_id: conversationId });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        const changed = payload.new as ChatMessage;
        setMessages((current) => current.map((message) => message.id === changed.id ? changed : message));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [open, conversationId, userId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, open]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body || !conversationId || !userId) return;
    const conversation = await (supabase as any).from("conversations").select("participants").eq("id", conversationId).single();
    const receiverId = (conversation.data?.participants as string[] | undefined)?.find((id) => id !== userId);
    if (!receiverId) return toast.error("The other participant is unavailable");
    setText("");
    const { error } = await (supabase as any).from("messages").insert({
      conversation_id: conversationId,
      sender_id: userId,
      receiver_id: receiverId,
      message_text: body,
      message_type: "text",
    });
    if (error) { setText(body); toast.error(error.message); }
  }

  return (
    <>
      {!hideTrigger && <button type="button" onClick={() => setOpen(true)} className={className || "inline-flex items-center justify-center gap-2 rounded-full border px-3 py-2 text-sm font-bold"}>
        <MessageCircle className="h-4 w-4" /> {label}
      </button>}
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={label}>
          <div className="flex h-[75vh] w-full max-w-lg flex-col rounded-t-3xl border bg-background shadow-2xl sm:rounded-3xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="font-display text-xl text-brand">{label}</div>
              <button type="button" onClick={() => { setOpen(false); onClose?.(); }} className="grid h-9 w-9 place-items-center rounded-full border" aria-label="Close chat"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2" aria-live="polite">
              {busy && <div className="text-center text-sm text-muted-foreground">Opening chat…</div>}
              {!busy && messages.length === 0 && <div className="text-center text-sm text-muted-foreground">Start the conversation.</div>}
              {messages.map((message) => message.message_type === "system" ? (
                <div key={message.id} className="mx-auto w-fit max-w-[85%] rounded-full bg-muted px-3 py-1.5 text-center text-xs text-muted-foreground">{message.message_text}</div>
              ) : (
                <div key={message.id} className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm ${message.sender_id === userId ? "ml-auto bg-brand text-brand-foreground" : "bg-muted"}`}>
                  <div>{message.message_text}</div>
                  <div className={`mt-1 text-[9px] ${message.sender_id === userId ? "text-brand-foreground/70" : "text-muted-foreground"}`}>
                    {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{message.sender_id === userId ? (message.read_status ? " · Read" : " · Sent") : ""}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <div className="border-t p-3">
              {quickReplies.length > 0 && <div className="mb-2 flex gap-2 overflow-x-auto pb-1">{quickReplies.map((reply) => <button key={reply} type="button" onClick={() => setText(reply)} className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold">{reply}</button>)}</div>}
              <form onSubmit={send} className="flex gap-2">
                <input value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} placeholder="Type a message…" className="min-w-0 flex-1 rounded-full border bg-background px-4 py-2.5 text-sm" />
                <button disabled={!text.trim() || !conversationId} className="grid h-10 w-10 place-items-center rounded-full bg-brand text-brand-foreground disabled:opacity-50" aria-label="Send message"><Send className="h-4 w-4" /></button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
