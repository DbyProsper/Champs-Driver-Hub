import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Flag, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ComplaintThread } from "@/components/ComplaintThread";

export const Route = createFileRoute("/_authenticated/admin/complaints")({
  head: () => ({
    meta: [{ title: "Complaints — Champs Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: ComplaintsPage,
});

type Complaint = {
  id: string;
  kind: "complaint" | "driver_report";
  subject: string;
  details: string;
  status: string;
  order_id: string | null;
  driver_id: string | null;
  customer_id?: string;
  created_at: string;
  resolution?: string | null;
};

function ComplaintsPage() {
  const [items, setItems] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [thread, setThread] = useState<Complaint | null>(null);

  const load = useCallback(async () => {
    const [{ data: complaints, error: complaintError }, { data: reports, error: reportError }] =
      await Promise.all([
        (supabase as any)
          .from("customer_complaints")
          .select("id,subject,details,status,order_id,driver_id,customer_id,created_at,resolution")
          .order("created_at", { ascending: false }),
        (supabase as any)
          .from("driver_reports")
          .select("id,reason,details,status,order_id,driver_id,customer_id,created_at,resolution")
          .order("created_at", { ascending: false }),
      ]);
    if (complaintError || reportError)
      toast.error(complaintError?.message ?? reportError?.message ?? "Could not load complaints");
    const merged: Complaint[] = [
      ...(complaints ?? []).map((row: any) => ({ ...row, kind: "complaint" as const })),
      ...(reports ?? []).map((row: any) => ({
        ...row,
        kind: "driver_report" as const,
        subject: row.reason,
      })),
    ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    setItems(merged);
    setResponses((current) =>
      Object.fromEntries(
        merged.map((item) => [item.id, current[item.id] ?? item.resolution ?? ""]),
      ),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => data.user && (supabase as any).from("notifications").update({ read_status: true }).eq("user_id", data.user.id).in("type", ["complaint_update", "driver_report"]).eq("read_status", false));
    void load();
    const channel = supabase
      .channel("admin-complaints")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customer_complaints" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_reports" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  async function review(item: Complaint, status: "reviewing" | "resolved" | "dismissed") {
    const response = responses[item.id]?.trim() || null;
    if (status === "resolved" && !response)
      return toast.error("Enter a response before resolving the complaint");
    setBusyId(item.id);
    const { error } =
      item.kind === "driver_report"
        ? await (supabase.rpc as any)("review_driver_report", {
            _report_id: item.id,
            _status: status,
            _resolution: response,
            _driver_action: null,
          })
        : await (supabase.rpc as any)("review_customer_complaint", {
            _complaint_id: item.id,
            _status: status,
            _resolution: response,
          });
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(
      status === "reviewing" && response
        ? "Response sent to customer"
        : `Complaint marked ${status}`,
    );
    void load();
  }

  async function suspendDriver(item: Complaint) {
    if (!item.driver_id) return toast.error("This complaint is not linked to a driver");
    const reason = window.prompt("Reason for suspending this driver for 24 hours:", item.subject);
    if (!reason?.trim()) return;
    setBusyId(item.id);
    const { error } = await (supabase.rpc as any)("suspend_driver_24h", {
      _driver_id: item.driver_id,
      _reason: reason.trim(),
    });
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Driver suspended for 24 hours");
  }

  async function expelDriver(item: Complaint) {
    if (item.kind !== "driver_report") return;
    const resolution = responses[item.id]?.trim();
    if (!resolution) return toast.error("Enter a response explaining the decision");
    setBusyId(item.id);
    const { error } = await (supabase.rpc as any)("review_driver_report", {
      _report_id: item.id,
      _status: "resolved",
      _resolution: resolution,
      _driver_action: "expel",
    });
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Driver expelled");
    void load();
  }

  return (
    <div className="min-h-screen bg-muted/40 pb-20">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/admin" className="inline-flex items-center gap-1 text-sm font-semibold">
            <ArrowLeft className="h-4 w-4" /> Admin
          </Link>
          <div className="inline-flex items-center gap-2 font-display text-xl text-brand">
            <Flag className="h-5 w-5" /> Complaints
          </div>
          <div className="w-16" />
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-3 px-4 py-4">
        {loading && (
          <div className="grid place-items-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No complaints or driver reports.
          </div>
        )}
        {items.map((item) => (
          <article key={`${item.kind}-${item.id}`} className="rounded-2xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-brand">
                  {item.kind === "driver_report" ? "Driver report" : "Customer complaint"}
                </div>
                <h2 className="font-semibold">{item.subject}</h2>
              </div>
              <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-bold uppercase">
                {item.status}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.details}</p>
            <label className="mt-3 grid gap-1 text-xs font-semibold text-muted-foreground">
              <span>Response to customer</span>
              <textarea
                value={responses[item.id] ?? ""}
                onChange={(event) =>
                  setResponses((current) => ({ ...current, [item.id]: event.target.value }))
                }
                rows={3}
                maxLength={4000}
                placeholder="Write Champs’ response…"
                className="rounded-xl border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {item.kind === "complaint" && (
                <button onClick={() => setThread(item)} className="rounded-full border px-3 py-1.5 text-xs font-bold text-brand">
                  Open conversation
                </button>
              )}
              <button
                disabled={busyId === item.id}
                onClick={() => review(item, "reviewing")}
                className="rounded-full border px-3 py-1.5 text-xs font-semibold"
              >
                Send response
              </button>
              <button
                disabled={busyId === item.id}
                onClick={() => review(item, "resolved")}
                className="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground"
              >
                Resolve
              </button>
              <button
                disabled={busyId === item.id}
                onClick={() => review(item, "dismissed")}
                className="rounded-full border px-3 py-1.5 text-xs font-semibold"
              >
                Dismiss
              </button>
              {item.driver_id && (
                <button
                  disabled={busyId === item.id}
                  onClick={() => suspendDriver(item)}
                  className="rounded-full bg-amber-500 px-3 py-1.5 text-xs font-bold text-white"
                >
                  Suspend driver
                </button>
              )}
              {item.kind === "driver_report" && (
                <button
                  disabled={busyId === item.id}
                  onClick={() => expelDriver(item)}
                  className="rounded-full bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground"
                >
                  Expel driver
                </button>
              )}
            </div>
          </article>
        ))}
      </main>
      {thread && <ComplaintThread complaint={thread} onClose={() => setThread(null)} />}
    </div>
  );
}
