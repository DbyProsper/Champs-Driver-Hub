import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, ChevronDown, ChevronRight, ShieldAlert, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getAccessRole } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/admin/audit-trail")({
  head: () => ({ meta: [{ title: "Audit Trail — Champs Admin" }, { name: "robots", content: "noindex" }] }),
  component: AuditTrailPage,
});

type AuditLog = {
  id: string;
  admin_id: string;
  action_type: string;
  action_description: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

const PAGE_SIZE = 25;
const criticalActions = new Set(["admin_role_granted", "admin_role_revoked", "driver_suspended", "order_cancelled"]);

function AuditTrailPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [adminNames, setAdminNames] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState("all");
  const [admin, setAdmin] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  async function load() {
    setLoading(true);
    let query = supabase.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (action !== "all") query = query.eq("action_type", action);
    if (admin !== "all") query = query.eq("admin_id", admin);
    if (from) query = query.gte("created_at", `${from}T00:00:00`);
    if (to) query = query.lt("created_at", `${to}T23:59:59.999`);
    if (search.trim()) query = query.or(`action_description.ilike.%${search.trim()}%,target_id.ilike.%${search.trim()}%`);
    const { data, error, count } = await query;
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as AuditLog[];
    setLogs(rows);
    setTotal(count ?? 0);
    const ids = Array.from(new Set(rows.map((row) => row.admin_id)));
    if (ids.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      setAdminNames(Object.fromEntries((profiles ?? []).map((profile: any) => [profile.id, profile.full_name || profile.id])));
    }
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const role = data.user ? await getAccessRole(data.user.id) : null;
      setAuthorized(role === "admin");
      if (role === "admin") await load();
      else setLoading(false);
    })();
  }, [page, action, admin, from, to]);
  useEffect(() => {
    if (authorized !== true) return;
    const channel = supabase.channel("admin-audit-logs").on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_logs" }, () => load()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [authorized, page, action, admin, from, to]);

  const actionTypes = useMemo(() => Array.from(new Set(logs.map((log) => log.action_type))).sort(), [logs]);
  const adminOptions = useMemo(() => Array.from(new Set(logs.map((log) => log.admin_id))), [logs]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const suspiciousIds = useMemo(() => {
    const flagged = new Set<string>();
    const byAction = new Map<string, AuditLog[]>();
    for (const log of logs) byAction.set(log.action_type, [...(byAction.get(log.action_type) ?? []), log]);
    for (const actionType of ["driver_approved", "order_cancelled"]) {
      const entries = byAction.get(actionType) ?? [];
      for (let index = 0; index < entries.length; index += 1) {
        const current = new Date(entries[index].created_at).getTime();
        const nearby = entries.filter((entry) => Math.abs(current - new Date(entry.created_at).getTime()) <= 10 * 60 * 1000);
        if ((actionType === "driver_approved" && nearby.length >= 3) || (actionType === "order_cancelled" && nearby.length >= 5)) {
          flagged.add(entries[index].id);
        }
      }
    }
    return flagged;
  }, [logs]);

  function exportCsv() {
    const header = ["Timestamp", "Admin", "Action", "Target", "Description", "Metadata", "IP", "User agent"];
    const rows = logs.map((log) => [new Date(log.created_at).toISOString(), adminNames[log.admin_id] ?? log.admin_id, log.action_type, `${log.target_type}:${log.target_id ?? ""}`, log.action_description, JSON.stringify(log.metadata), log.ip_address ?? "", log.user_agent ?? ""]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `champs-audit-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-muted/40 pb-20">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/admin" className="inline-flex items-center gap-1 text-sm font-semibold"><ArrowLeft className="h-4 w-4" /> Admin</Link>
          <h1 className="font-display text-xl text-brand">Audit Trail</h1>
          <div className="flex gap-2"><button onClick={load} title="Refresh" className="grid h-8 w-8 place-items-center rounded-full border"><RefreshCw className="h-4 w-4" /></button><button onClick={exportCsv} title="Export CSV" className="grid h-8 w-8 place-items-center rounded-full border"><Download className="h-4 w-4" /></button></div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        {authorized === false && <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">Admin access is required to view audit logs.</section>}
        {authorized === true && <>
        <section className="grid gap-2 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} onKeyDown={(event) => event.key === "Enter" && load()} placeholder="Search user, driver, order" className="rounded-xl border bg-background px-3 py-2 text-sm" />
          <select value={action} onChange={(event) => { setAction(event.target.value); setPage(0); }} className="rounded-xl border bg-background px-3 py-2 text-sm"><option value="all">All actions</option>{actionTypes.map((value) => <option key={value}>{value}</option>)}</select>
          <select value={admin} onChange={(event) => { setAdmin(event.target.value); setPage(0); }} className="rounded-xl border bg-background px-3 py-2 text-sm"><option value="all">All admins</option>{adminOptions.map((value) => <option key={value} value={value}>{adminNames[value] ?? value}</option>)}</select>
          <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(0); }} className="rounded-xl border bg-background px-3 py-2 text-sm" />
          <input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(0); }} className="rounded-xl border bg-background px-3 py-2 text-sm" />
        </section>
        <section className="overflow-hidden rounded-2xl border bg-card">
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="w-8 p-3" /><th className="p-3">Timestamp</th><th className="p-3">Admin</th><th className="p-3">Action</th><th className="p-3">Target</th><th className="p-3">Description</th></tr></thead><tbody className="divide-y">
            {loading && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Loading audit logs...</td></tr>}
            {!loading && logs.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No audit records found.</td></tr>}
            {!loading && logs.map((log) => { const isCritical = criticalActions.has(log.action_type); const isSuspicious = suspiciousIds.has(log.id); const open = expanded === log.id; return <tr key={log.id} className={isCritical || isSuspicious ? "bg-red-50/70 dark:bg-red-950/20" : ""}><td className="p-3 align-top"><button onClick={() => setExpanded(open ? null : log.id)}>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td><td className="whitespace-nowrap p-3 align-top text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</td><td className="p-3 align-top font-semibold">{adminNames[log.admin_id] ?? log.admin_id}</td><td className="p-3 align-top"><span className={isCritical || isSuspicious ? "inline-flex items-center gap-1 font-bold text-red-700" : "font-semibold"}>{(isCritical || isSuspicious) && <ShieldAlert className="h-3.5 w-3.5" />}{log.action_type}</span>{isSuspicious && <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">Suspicious</span>}</td><td className="p-3 align-top text-xs">{log.target_type}{log.target_id ? ` · ${log.target_id}` : ""}</td><td className="p-3 align-top">{log.action_description}{open && <div className="mt-3 rounded-xl bg-muted p-3 text-xs"><pre className="max-w-xl overflow-auto whitespace-pre-wrap">{JSON.stringify(log.metadata, null, 2)}</pre><div className="mt-2 text-muted-foreground">IP: {log.ip_address ?? "Unavailable"}<br />Device: {log.user_agent ?? "Unavailable"}</div></div>}</td></tr>; })}
          </tbody></table></div>
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground"><span>{total} records</span><div className="flex items-center gap-2"><button disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="rounded-full border px-3 py-1.5 disabled:opacity-40">Previous</button><span>Page {page + 1} of {totalPages}</span><button disabled={page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-full border px-3 py-1.5 disabled:opacity-40">Next</button></div></div>
        </section>
        </>}
      </main>
    </div>
  );
}
