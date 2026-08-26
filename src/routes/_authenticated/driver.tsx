import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bike, Phone, MapPin, Loader2, LogOut, RefreshCw, Package, Navigation as NavIcon, CheckCircle2, Landmark, CreditCard, Settings2, Eye, XCircle, Upload, MessageCircle, CircleHelp, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatZAR } from "@/lib/format";
import { toast } from "sonner";
import { DELIVERY_STATUS_LABEL, getOrderStatusForDeliveryStatus, type DeliveryStatus } from "@/lib/delivery";
import { confirmDeliveryPayment, getDriverProfileForCurrentUser } from "@/lib/admin.functions";
import { DriverPageSkeleton } from "@/components/Loader";
import { fireNotification, requestNotificationPermissionIfNeeded } from "@/lib/notifications";
import { ChatDialog } from "@/components/ChatDialog";
import { NotificationCenter } from "@/components/NotificationCenter";
import { UnreadNavigationBadge } from "@/components/UnreadNavigationBadge";
import { sendOrderEventEmail } from "@/lib/order-email";
import { SA_BANKS } from "@/lib/sa-banks";
import { PasswordChangeForm } from "@/components/PasswordChangeForm";
import { ImagePreview } from "@/components/ImagePreview";

export const Route = createFileRoute("/_authenticated/driver")({
  head: () => ({ meta: [{ title: "Driver — Champs Chicken" }, { name: "robots", content: "noindex" }] }),
  component: DriverPage,
});

type Delivery = {
  id: string;
  order_id: string;
  driver_id: string | null;
  status: string;
  distance_km: number | null;
  delivery_fee_cents: number;
  created_at: string;
  batch_id: string | null;
  queue_position: number | null;
  estimated_eta_min: number | null;
  estimated_eta_max: number | null;
  actual_delivery_time?: string | null;
  payment_status?: string;
  payment_reference?: string | null;
  proof_of_payment_url?: string | null;
};

type Order = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  subtotal_cents: number;
  delivery_fee_cents?: number;
  delivery_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_notes: string | null;
  branch_id: string;
  pickup_pin: string | null;
  workflow_status?: string;
  driver_confirmed_at?: string | null;
  payment_confirmed_at?: string | null;
};

type Branch = { id: string; name: string; city: string; latitude: number | null; longitude: number | null };
type ItemRow = { order_id: string; item_name: string; quantity: number };

function DriverPage() {
  const [loading, setLoading] = useState(true);
  const [driver, setDriver] = useState<{ id: string; name: string; phone?: string; status: string; profile_image_url?: string | null; approval_status?: string | null; bank_name?: string | null; bank_account_number?: string | null; bank_account_holder?: string | null } | null>(null);
  const [notDriver, setNotDriver] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [orders, setOrders] = useState<Record<string, Order>>({});
  const [items, setItems] = useState<Record<string, ItemRow[]>>({});
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const [tab, setTab] = useState<"available" | "active" | "history" | "settings">("available");
  const [settings, setSettings] = useState({ bankName: "", bankAccountNumber: "", bankAccountHolder: "", bankNote: "", phone: "" });
  const [approvalBlocked, setApprovalBlocked] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"today" | "week" | "month" | "6months" | "year" | "custom">("week");
  const [customRange, setCustomRange] = useState<{ from?: string; to?: string }>({});
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const [showHelp, setShowHelp] = useState(false);
  const [notificationConversationId, setNotificationConversationId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const seenDeliveryIds = useRef<Set<string> | null>(null);
  const previousDeliveryStatuses = useRef<Record<string, string>>({});

  async function runAction(key: string, action: () => Promise<unknown>) {
    if (actionBusy) return;
    setActionBusy(key);
    try { await action(); } finally { setActionBusy(null); }
  }

  useEffect(() => {
    const stored = sessionStorage.getItem("champs-open-conversation");
    if (stored) { sessionStorage.removeItem("champs-open-conversation"); setNotificationConversationId(stored); }
    const openConversation = (event: Event) => setNotificationConversationId((event as CustomEvent<string>).detail);
    window.addEventListener("champs-open-conversation", openConversation);
    return () => window.removeEventListener("champs-open-conversation", openConversation);
  }, []);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setNotDriver(false);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setLoading(false);
      return;
    }

    const profileData = await getDriverProfileForCurrentUser({ data: {} });
    const driverRecord = profileData?.driver as { id: string; name: string; phone?: string; status: string; profile_image_url?: string | null; branch_id?: string | null; bank_name?: string | null; bank_account_number?: string | null; bank_account_holder?: string | null; approval_status?: string | null; roles?: string[] } | null;

    if (!driverRecord) {
      setNotDriver(true);
      setLoading(false);
      return;
    }

    setDriver(driverRecord);
    const approvalStatus = driverRecord?.approval_status ?? (driverRecord?.status === "pending" ? "pending" : "approved");
    setApprovalBlocked(["pending", "rejected", "suspended"].includes(approvalStatus));
    setSettings({
      bankName: driverRecord?.bank_name ?? "",
      bankAccountNumber: driverRecord?.bank_account_number ?? "",
      bankAccountHolder: driverRecord?.bank_account_holder ?? "",
      bankNote: localStorage.getItem(`champs-driver-note:${driverRecord?.id ?? ""}`) ?? "",
      phone: driverRecord?.phone ?? "",
    });

    const { data: dels } = await supabase
      .from("deliveries")
      .select("id, order_id, driver_id, status, distance_km, delivery_fee_cents, created_at, batch_id, queue_position, estimated_eta_min, estimated_eta_max, actual_delivery_time, payment_status, payment_reference, proof_of_payment_url")
      .order("queue_position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    const list = (dels ?? []) as Delivery[];
    if (seenDeliveryIds.current) {
      for (const delivery of list) {
        if (!seenDeliveryIds.current.has(delivery.id) && delivery.status !== "delivered" && delivery.status !== "cancelled") {
          fireNotification("New Champs delivery", "A new delivery is available in the driver queue", `delivery-${delivery.id}`);
        }
        const previousStatus = previousDeliveryStatuses.current[delivery.id];
        if (previousStatus && previousStatus !== delivery.status && (delivery.driver_id === driverRecord.id || delivery.status === "pending")) {
          fireNotification("Delivery update", `Delivery status: ${delivery.status.replaceAll("_", " ")}`, `delivery-${delivery.id}-${delivery.status}`);
        }
      }
    }
    seenDeliveryIds.current = new Set(list.map((delivery) => delivery.id));
    previousDeliveryStatuses.current = Object.fromEntries(list.map((delivery) => [delivery.id, delivery.status]));
    setDeliveries(list);

    const proofMap: Record<string, string> = {};
    for (const delivery of list) {
      if (!delivery.proof_of_payment_url) continue;
      try {
        const { data: signedData, error } = await supabase.storage.from("payment-proofs").createSignedUrl(delivery.proof_of_payment_url, 60 * 60 * 24);
        if (!error && signedData?.signedUrl) proofMap[delivery.id] = signedData.signedUrl;
      } catch {}
    }
    setProofUrls(proofMap);

    const orderIds = list.map((d) => d.order_id);
    if (orderIds.length) {
      const [{ data: os }, { data: its }] = await Promise.all([
        (supabase.from("orders") as any).select("id, order_number, customer_name, customer_phone, subtotal_cents, delivery_fee_cents, delivery_address, delivery_lat, delivery_lng, delivery_notes, branch_id, workflow_status, driver_confirmed_at, payment_confirmed_at").in("id", orderIds),
        supabase.from("order_items").select("order_id, item_name, quantity").in("order_id", orderIds),
      ]);
      const orderRows = (os ?? []) as Order[];
      const resolvedOrders = await Promise.all(orderRows.map(async (o) => {
        const canSeePin = !["pending", "pickup_pending", "pending_driver_acceptance", "rejected_by_driver"].includes(o.workflow_status ?? "pending");
        let pickupPin: string | null = null;
        if (canSeePin) {
          const { data: pin } = await (supabase.rpc as any)("get_driver_order_pin", { _order_id: o.id });
          pickupPin = (pin as string | null) ?? null;
        }
        return { ...o, pickup_pin: pickupPin };
      }));
      const om: Record<string, Order> = Object.fromEntries(resolvedOrders.map((o) => [o.id, o]));
      setOrders(om);
      const im: Record<string, ItemRow[]> = {};
      for (const r of (its ?? []) as ItemRow[]) {
        (im[r.order_id] ??= []).push(r);
      }
      setItems(im);
      const branchIds = Array.from(new Set<string>((os ?? []).map((o: any) => o.branch_id).filter((id: unknown): id is string => typeof id === "string")));
      if (branchIds.length) {
        const { data: bs } = await supabase.from("branches").select("id, name, city, latitude, longitude").in("id", branchIds);
        const bm: Record<string, Branch> = {};
        for (const b of (bs ?? []) as Branch[]) bm[b.id] = b;
        setBranches(bm);
      }
    } else {
      setOrders({});
      setItems({});
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void requestNotificationPermissionIfNeeded();
    load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel("driver-deliveries")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "deliveries" }, (payload) => {
        const delivery = payload.new as Partial<Delivery>;
        if (delivery.id && delivery.status !== "delivered" && delivery.status !== "cancelled") {
          toast.success("New delivery available");
          fireNotification("New Champs delivery", "A new order is ready in your driver queue", `new-delivery-${delivery.id}`);
        }
        void load(false);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "deliveries" }, () => { void load(false); })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "deliveries" }, () => { void load(false); })
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => { void load(false); })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("Driver realtime channel unavailable", status);
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    if (!driver) return;
    const handoff = deliveries.find((d) => d.driver_id === driver.id && d.status === "handed_to_driver");
    if (handoff) {
      const order = orders[handoff.order_id];
      if (order?.pickup_pin) {
        toast.success(`Driver handoff: collect order ${order.order_number} now`);
      }
    }
  }, [driver, deliveries, orders]);

  const available = useMemo(() => deliveries.filter((d) => (d.driver_id === null || (driver && d.driver_id === driver.id && d.status === "pending_driver_acceptance")) && d.status !== "delivered" && d.status !== "cancelled"), [deliveries, driver]);
  const active = useMemo(() => (driver ? deliveries.filter((d) => d.driver_id === driver.id && d.status !== "pending_driver_acceptance" && d.status !== "delivered" && d.status !== "cancelled") : []), [deliveries, driver]);
  const history = useMemo(() => (driver ? deliveries.filter((d) => d.driver_id === driver.id) : []), [deliveries, driver]);

  async function saveSettings() {
    if (!driver) return;
    setSettingsBusy(true);
    try {
      const noteText = settings.bankNote.trim();
      const accountHolder = [settings.bankAccountHolder.trim(), noteText].filter(Boolean).join(" • ");
      const { error } = await supabase.from("drivers").update({
        phone: settings.phone.trim() || driver.phone || null,
        bank_name: settings.bankName.trim() || null,
        bank_account_number: settings.bankAccountNumber.trim() || null,
        bank_account_holder: accountHolder || null,
      } as never).eq("id", driver.id);
      if (error) throw error;
      localStorage.setItem(`champs-driver-note:${driver.id}`, noteText);
      setDriver((prev) => prev ? { ...prev, phone: settings.phone.trim() || prev.phone, bank_name: settings.bankName.trim() || undefined, bank_account_number: settings.bankAccountNumber.trim() || undefined, bank_account_holder: accountHolder || undefined } : prev);
      toast.success("Banking details updated");
    } catch (err: any) {
      toast.error(err.message ?? "Could not save driver settings");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function updateDelivery(id: string, patch: Partial<Delivery>) {
    const { error } = await supabase.from("deliveries").update(patch as never).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    load();
  }

  async function accept(d: Delivery) {
    if (!driver || approvalBlocked) return toast.error("Your driver account is not approved yet");
    const currentPositions = deliveries
      .filter((x) => x.driver_id === driver.id && x.status !== "delivered")
      .map((x) => x.queue_position ?? 0);
    const nextPos = (currentPositions.length ? Math.max(...currentPositions) : 0) + 1;
    await updateDelivery(d.id, { driver_id: driver.id, status: "accepted", queue_position: nextPos });
    const { error: orderError } = await supabase.from("orders").update({ driver_id: driver.id } as never).eq("id", d.order_id);
    if (orderError) {
      toast.error(orderError.message || "Could not attach the order to your driver record");
      return;
    }
    await (supabase.from("orders") as any).update({ workflow_status: "accepted_by_driver", driver_confirmed_at: new Date().toISOString() }).eq("id", d.order_id);
    void sendOrderEventEmail(d.order_id, "accepted");
    toast.success("Order accepted — get moving and keep it safe");
    setTab("active");
  }

  async function uploadProfilePhoto(file: File) {
    if (!driver) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file");
    if (file.size > 2 * 1024 * 1024) return toast.error("Profile photo must be under 2 MB");
    setPhotoBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new Error("Sign in again to upload your profile photo");
      const path = `${authData.user.id}/profile_photos/profile.${ext}`;
      const { error: uploadError } = await supabase.storage.from("driver-uploads").upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("driver-uploads").getPublicUrl(path);
      const imageUrl = `${data.publicUrl}?v=${Date.now()}`;
      const { error } = await supabase.from("drivers").update({ profile_image_url: imageUrl } as never).eq("id", driver.id);
      if (error) throw error;
      setDriver({ ...driver, profile_image_url: imageUrl });
      toast.success("Profile photo updated");
    } catch (error: any) {
      toast.error(error.message ?? "Could not update profile photo");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function reject(d: Delivery) {
    if (!driver) return;
    const { error } = await (supabase.from("orders") as any).update({ workflow_status: "rejected_by_driver" }).eq("id", d.order_id).eq("driver_id", driver.id);
    if (error) return toast.error(error.message);
    await (supabase.from("deliveries") as any).update({ driver_id: null, status: "pending" }).eq("id", d.id);
    toast.success("Order rejected and returned to the queue");
    void load();
  }

  async function submitToChamps(d: Delivery) {
    try {
      const { error } = await (supabase.rpc as any)("submit_order_to_champs", { _order_id: d.order_id });
      if (error) throw error;
      void sendOrderEventEmail(d.order_id, "submitted");
      toast.success("Order submitted to Champs. The kitchen will print the receipt.");
      void load();
    } catch (error: any) { toast.error(error.message ?? "Could not submit to Champs"); }
  }

  async function confirmOrderAndPayment(orderId: string) {
    const now = new Date().toISOString();
    const { error } = await (supabase.from("orders") as any).update({ driver_confirmed_at: now, payment_confirmed_at: now }).eq("id", orderId).eq("driver_id", driver?.id ?? "");
    if (error) return toast.error(error.message);
    toast.success("Order and payment confirmed");
    void load();
  }
  async function nextStatus(d: Delivery) {
    const flow: DeliveryStatus[] = ["accepted", "handed_to_driver", "picked_up", "on_the_way", "delivered"];
    const idx = flow.indexOf(d.status as DeliveryStatus);
    const next = idx === -1 ? "picked_up" : flow[Math.min(idx + 1, flow.length - 1)];
    const patch: Partial<Delivery> = { status: next };
    if (next === "delivered") (patch as any).actual_delivery_time = new Date().toISOString();
    await updateDelivery(d.id, patch);
    const orderStatus = getOrderStatusForDeliveryStatus(next);
    if (orderStatus) {
      const workflowStatus = next === "picked_up" ? "picked_up" : next === "on_the_way" ? "out_for_delivery" : next === "delivered" ? "delivered" : undefined;
      const orderPatch: { status: string; driver_id?: string | null; workflow_status?: string } = { status: orderStatus as any, ...(workflowStatus ? { workflow_status: workflowStatus } : {}) };
      if (d.driver_id) orderPatch.driver_id = d.driver_id;
      const { error: orderError } = await supabase.from("orders").update(orderPatch as never).eq("id", d.order_id);
      if (orderError) {
        toast.error(orderError.message || "Could not update the order status for the customer");
        return;
      }
    }
    if (next === "on_the_way") {
      toast.success("Stay sharp and keep the route moving");
    } else if (next === "delivered") {
      void sendOrderEventEmail(d.order_id, "delivered");
      toast.success("Delivery complete — safe and on time");
    } else if (next === "accepted") {
      toast.success("Order accepted — get moving and keep it safe");
    } else {
      toast.success("Delivery status updated");
    }
  }

  async function toggleStatus() {
    if (!driver || approvalBlocked) return toast.error("Your driver account is not approved yet");
    const nextStatus = driver.status === "active" ? "offline" : "active";
    const { error } = await supabase.from("drivers").update({ status: nextStatus } as never).eq("id", driver.id);
    if (error) return toast.error(error.message);
    setDriver({ ...driver, status: nextStatus });
    toast.success(nextStatus === "active" ? "You are now online" : "You are now offline");
  }

  async function confirmPayment(id: string) {
    try {
      await confirmDeliveryPayment({ data: { deliveryId: id } });
      toast.success("Payment confirmed");
      load();
    } catch (err: any) {
      toast.error(err.message ?? "Could not confirm payment");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (loading) {
    return <DriverPageSkeleton />;
  }

  if (notDriver) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <Bike className="h-10 w-10 mx-auto text-brand" />
          <h1 className="font-display text-2xl">Driver access only</h1>
          <p className="text-sm text-muted-foreground">Your account isn't registered as a Champs driver. Ask an admin to add you in the Drivers panel.</p>
          <Link to="/" className="inline-flex rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-brand-foreground">Back to Champs</Link>
        </div>
      </div>
    );
  }

  function rangeForFilter(filter: typeof historyFilter) {
    const now = new Date();
    if (filter === "today") return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to: now };
    if (filter === "week") { const d = new Date(now); d.setDate(now.getDate() - 7); return { from: d, to: now }; }
    if (filter === "month") { const d = new Date(now); d.setMonth(now.getMonth() - 1); return { from: d, to: now }; }
    if (filter === "6months") { const d = new Date(now); d.setMonth(now.getMonth() - 6); return { from: d, to: now }; }
    if (filter === "year") { const d = new Date(now); d.setFullYear(now.getFullYear() - 1); return { from: d, to: now }; }
    if (filter === "custom") {
      const from = customRange.from ? new Date(customRange.from) : new Date(0);
      const to = customRange.to ? new Date(customRange.to) : new Date();
      return { from, to };
    }
    return { from: new Date(0), to: new Date() };
  }

  const { from: _from, to: _to } = rangeForFilter(historyFilter);
  const historyFiltered = history.filter((d) => {
    const created = new Date(d.created_at);
    return created >= _from && created <= _to;
  });
  const deliveredFiltered = historyFiltered.filter((d) => d.status === "delivered");
  const earningsCents = deliveredFiltered.reduce((sum, d) => sum + d.delivery_fee_cents, 0);
  const collectedCents = deliveredFiltered.reduce((sum, d) => sum + ((d.payment_status === "paid") ? d.delivery_fee_cents : 0), 0);
  const list = tab === "available" ? available : tab === "active" ? active : tab === "history" ? historyFiltered : [];

  return (
    <div className="min-h-screen bg-muted/40 pb-20">
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/" className="font-display text-xl text-brand inline-flex items-center gap-2">
            <img src="/images/champs/champs-logo.png" alt="Champs Chicken" className="h-8 w-auto" />
            <span>Driver</span>
            <img src="/images/champs/driver-delivery-mark-clean.png" alt="Champs delivery driver" className="h-9 w-12 object-contain" />
          </Link>
          <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <NotificationCenter />
            {driver && <div className="relative"><ChatDialog driverId={driver.id} audience="champs" label="Champs chat" className="grid h-8 w-8 place-items-center rounded-full border text-[0px] [&_svg]:m-0" /><span className="absolute -right-2 -top-2"><UnreadNavigationBadge types={["new_message"]} /></span></div>}
            <button type="button" onClick={() => setShowHelp(true)} className="grid h-8 w-8 place-items-center rounded-full border" aria-label="How driver orders work"><CircleHelp className="h-4 w-4" /></button>
            <button disabled={!!actionBusy} onClick={() => void runAction("status", toggleStatus)} className={"inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider disabled:opacity-60 " + (driver?.status === "active" ? "bg-emerald-600 text-white" : "border bg-background text-muted-foreground")}>
              {actionBusy === "status" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{driver?.status === "active" ? "Online" : "Offline"}
            </button>
            <button onClick={() => void load()} className="grid h-8 w-8 place-items-center rounded-full border"><RefreshCw className="h-3.5 w-3.5" /></button>
            <button onClick={signOut} className="grid h-8 w-8 place-items-center rounded-full border"><LogOut className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <div className="mx-auto flex max-w-2xl gap-2 px-4 pb-3">
          <button onClick={() => setTab("available")} className={"flex-1 rounded-full px-3 py-2 text-xs font-bold uppercase " + (tab === "available" ? "bg-brand text-brand-foreground" : "border bg-background")}>
            Available ({available.length})
          </button>
          <button onClick={() => setTab("active")} className={"flex-1 rounded-full px-3 py-2 text-xs font-bold uppercase " + (tab === "active" ? "bg-brand text-brand-foreground" : "border bg-background")}>
            Active ({active.length})
          </button>
          <button onClick={() => setTab("history")} className={"flex-1 rounded-full px-3 py-2 text-xs font-bold uppercase " + (tab === "history" ? "bg-brand text-brand-foreground" : "border bg-background")}>
            History & Earnings
          </button>
          <button onClick={() => setTab("settings")} className={"flex-1 rounded-full px-3 py-2 text-xs font-bold uppercase " + (tab === "settings" ? "bg-brand text-brand-foreground" : "border bg-background")}>Settings</button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-4 space-y-3">
        {tab === "history" && (
          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Delivered earnings</div>
                <div className="font-display text-3xl text-brand">{formatZAR(earningsCents)}</div>
                <div className="text-xs text-muted-foreground">Collected: {formatZAR(collectedCents)}</div>
              </div>
              <Landmark className="h-8 w-8 text-brand" />
            </div>
          </div>
        )}

        {tab === "history" && (
          <div className="rounded-2xl border bg-card p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Filter</span>
              {(["today", "week", "month", "6months", "year"] as const).map((f) => (
                <button key={f} onClick={() => setHistoryFilter(f)} className={"rounded-full px-3 py-1 text-xs font-bold " + (historyFilter === f ? "bg-brand text-brand-foreground" : "bg-background border")}>{f}</button>
              ))}
              <button onClick={() => setHistoryFilter("custom")} className={"rounded-full px-3 py-1 text-xs font-bold " + (historyFilter === "custom" ? "bg-brand text-brand-foreground" : "bg-background border")}>Custom</button>
            </div>
            {historyFilter === "custom" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <input type="date" value={customRange.from ?? ""} onChange={(e) => setCustomRange((c) => ({ ...c, from: e.target.value }))} className="w-full rounded-md border px-2 py-2 text-sm" />
                <input type="date" value={customRange.to ?? ""} onChange={(e) => setCustomRange((c) => ({ ...c, to: e.target.value }))} className="w-full rounded-md border px-2 py-2 text-sm" />
              </div>
            )}
          </div>
        )}
        {tab === "settings" && (
          <div className="rounded-2xl border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-brand"><Settings2 className="h-4 w-4" /> Driver settings</div>
            <div className="mt-3 grid gap-2">
              <div className="flex items-center gap-3 rounded-xl border p-3">
                {driver?.profile_image_url ? <ImagePreview src={driver.profile_image_url} alt={`${driver.name} profile picture`} className="h-14 w-14 rounded-full object-cover" /> : <div className="grid h-14 w-14 place-items-center rounded-full bg-muted font-display text-xl text-brand">{driver?.name?.slice(0, 1)}</div>}
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold"><Upload className="h-3.5 w-3.5" /> {photoBusy ? "Uploading…" : "Change profile photo"}<input type="file" accept="image/*" disabled={photoBusy} className="hidden" onChange={(event) => event.target.files?.[0] && void uploadProfilePhoto(event.target.files[0])} /></label>
              </div>
              <select className="rounded-lg border bg-background px-3 py-2 text-sm" value={settings.bankName} onChange={(e) => setSettings({ ...settings, bankName: e.target.value })}>
                <option value="">Select SA bank</option>
                {SA_BANKS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
              </select>
              <input className="rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Account number" value={settings.bankAccountNumber} onChange={(e) => setSettings({ ...settings, bankAccountNumber: e.target.value })} />
              <input className="rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Account holder" value={settings.bankAccountHolder} onChange={(e) => setSettings({ ...settings, bankAccountHolder: e.target.value })} />
              <textarea className="rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Customer note (e.g. Capitec transfer to 0123456789 or Instant EFT only)" rows={2} value={settings.bankNote} onChange={(e) => setSettings({ ...settings, bankNote: e.target.value })} />
              <input className="rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Phone" value={settings.phone} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} />
              <button onClick={saveSettings} disabled={settingsBusy} className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-brand-foreground disabled:opacity-60">{settingsBusy ? "Saving…" : "Save settings"}</button>
            </div>
            <div className="mt-4"><PasswordChangeForm /></div>
          </div>
        )}
        {tab !== "settings" && list.length === 0 && (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {tab === "available"
              ? "No orders waiting for a driver right now."
              : tab === "active"
              ? "You have no active deliveries."
              : "No delivery history available for this period."}
          </div>
        )}
        {tab !== "settings" && list.map((d) => {
          const o = orders[d.order_id];
          const b = o ? branches[o.branch_id] : null;
          const its = items[d.order_id] ?? [];
          const mapsHref = o?.delivery_lat && o?.delivery_lng
            ? `https://www.google.com/maps/dir/?api=1&destination=${o.delivery_lat},${o.delivery_lng}${b?.latitude && b?.longitude ? `&origin=${b.latitude},${b.longitude}` : ""}`
            : o?.delivery_address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.delivery_address)}` : null;
          return (
            <div key={d.id} className="rounded-2xl border bg-card p-4 shadow-sm space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-display text-lg text-brand truncate flex items-center gap-2">
                    {d.queue_position != null && (
                      <span className="rounded-full bg-brand text-brand-foreground text-[10px] font-bold px-2 py-0.5">#{d.queue_position}</span>
                    )}
                    {o?.customer_name ?? "Customer"}
                  </div>
                  <div className="text-xs text-muted-foreground">#{o?.order_number} · {b?.name ?? "Branch"}</div>
                </div>
                <span className="rounded-full bg-brand/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-brand">{DELIVERY_STATUS_LABEL[d.status] ?? d.status}</span>
              </div>

              {o?.delivery_address && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
                  <div className="min-w-0">
                    <div>{o.delivery_address}</div>
                    {o.delivery_notes && <div className="text-xs text-muted-foreground">{o.delivery_notes}</div>}
                  </div>
                </div>
              )}

              {o?.delivery_address && (
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground inline-flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-semibold text-foreground">#{o.order_number}</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Package className="h-3.5 w-3.5" /> {its.reduce((s, r) => s + r.quantity, 0)} items</span>
                {d.distance_km != null && <span>· {Number(d.distance_km).toFixed(1)} km</span>}
                <span>· Fee <span className="font-bold text-foreground">{formatZAR(d.delivery_fee_cents)}</span></span>
                <span>· Full total <span className="font-bold text-foreground">{formatZAR((o?.subtotal_cents ?? 0) + d.delivery_fee_cents)}</span></span>
              </div>

              {its.length > 0 && (
                <ul className="rounded-lg bg-muted/40 px-3 py-2 text-xs space-y-0.5">
                  {its.map((r, i) => <li key={i}>{r.quantity}× {r.item_name}</li>)}
                </ul>
              )}

              <div className="grid grid-cols-2 gap-2">
                {o?.customer_phone && (
                  <a href={`tel:${o.customer_phone}`} className="rounded-xl border px-3 py-3 text-sm font-bold inline-flex items-center justify-center gap-2">
                    <Phone className="h-4 w-4" /> Call
                  </a>
                )}
                {tab === "active" && o?.customer_phone && (
                  <a href={`https://wa.me/${o.customer_phone.replace(/\D/g, "").replace(/^0/, "27")}?text=${encodeURIComponent(`Hi ${o.customer_name}, I’m your Champs driver for order ${o.order_number}. I have received your order and will keep you updated here.`)}`} target="_blank" rel="noreferrer" className="rounded-xl bg-[#25D366] px-3 py-3 text-sm font-bold text-white inline-flex items-center justify-center gap-2"><MessageCircle className="h-4 w-4" /> WhatsApp</a>
                )}
                {mapsHref && (
                  <a href={mapsHref} target="_blank" rel="noreferrer" className="rounded-xl border px-3 py-3 text-sm font-bold inline-flex items-center justify-center gap-2">
                    <NavIcon className="h-4 w-4" /> Maps
                  </a>
                )}
              </div>
              {o?.pickup_pin && (
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
                  <span>Customer PIN</span>
                  <span className="font-semibold text-foreground">{o.pickup_pin}</span>
                </div>
              )}
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
                <span>Delivery payment</span>
                <span className="font-semibold text-foreground">{d.payment_status === "paid" ? "Paid" : d.payment_status === "pending" ? "Awaiting confirmation" : "Not paid"}</span>
              </div>
              {d.proof_of_payment_url && (
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between gap-2">
                  <span>Proof of payment</span>
                  {proofUrls[d.id] ? (
                    <a href={proofUrls[d.id]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand">
                      <Eye className="h-3.5 w-3.5" /> View
                    </a>
                  ) : (
                    <span className="font-semibold text-foreground">Attached</span>
                  )}
                </div>
              )}

                {tab === "available" ? (
                <div className="grid grid-cols-2 gap-2"><button disabled={!!actionBusy} onClick={() => void runAction(`accept-${d.id}`, () => accept(d))} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-bold text-brand-foreground disabled:opacity-60">{actionBusy === `accept-${d.id}` && <Loader2 className="h-4 w-4 animate-spin" />}Accept order</button><button disabled={!!actionBusy} onClick={() => void runAction(`reject-${d.id}`, () => reject(d))} className="inline-flex items-center justify-center gap-2 rounded-xl border border-destructive/40 py-3 text-sm font-bold text-destructive disabled:opacity-60">{actionBusy === `reject-${d.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject</button></div>
              ) : tab === "active" && d.status !== "delivered" ? (
                d.status === "cancelled" ? (
                  <div className="rounded-xl bg-destructive/10 border border-destructive/30 px-3 py-3 text-sm font-semibold text-destructive">This delivery was cancelled. No further actions are available.</div>
                ) : (
                  <div className="space-y-2">
                    {o && <ChatDialog orderId={o.id} quickReplies={["I have submitted your order", "Your order is ready", "I’m on my way", "I’m outside"]} label="Chat with customer" className="inline-flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-bold" />}
                    {d.payment_status === "pending" && (
                      <button disabled={!!actionBusy} onClick={() => void runAction(`payment-${d.id}`, () => confirmPayment(d.id))} className="w-full rounded-xl border border-emerald-600 px-3 py-3 text-sm font-bold text-emerald-700 inline-flex items-center justify-center gap-2 disabled:opacity-60">
                        {actionBusy === `payment-${d.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirm payment received
                      </button>
                    )}
                    {o?.workflow_status === "accepted_by_driver" && (!o.driver_confirmed_at || !o.payment_confirmed_at) && (
                      <button disabled={!!actionBusy} onClick={() => void runAction(`confirm-${o.id}`, () => confirmOrderAndPayment(o.id))} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-600 px-3 py-3 text-sm font-bold text-emerald-700 disabled:opacity-60">{actionBusy === `confirm-${o.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirm order & payment</button>
                    )}
                    {o?.workflow_status === "accepted_by_driver" && o.driver_confirmed_at && o.payment_confirmed_at && (
                      <button disabled={!!actionBusy} onClick={() => void runAction(`submit-${d.id}`, () => submitToChamps(d))} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-3 text-sm font-bold text-background disabled:opacity-60">{actionBusy === `submit-${d.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />} Submit to Champs</button>
                    )}
                    <button
                      onClick={() => void runAction(`next-${d.id}`, () => nextStatus(d))}
                      disabled={!!actionBusy || (d.status !== "handed_to_driver" && d.status !== "picked_up" && d.status !== "on_the_way")}
                      className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-brand-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {actionBusy === `next-${d.id}` ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Updating…</span> : d.status === "handed_to_driver" ? "Mark picked up" : d.status === "picked_up" ? "Start delivery" : d.status === "on_the_way" ? "Mark delivered" : "Waiting for handoff"}
                    </button>
                  </div>
                )
              ) : null}
            </div>
          );
        })}
      </div>
      {showHelp && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="How driver orders work" onClick={() => setShowHelp(false)}><div className="w-full max-w-md rounded-3xl border bg-background p-5" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div className="font-display text-2xl text-brand">How driver orders work</div><button type="button" onClick={() => setShowHelp(false)} className="grid h-9 w-9 place-items-center rounded-full border" aria-label="Close instructions"><X className="h-4 w-4" /></button></div><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground"><li>A customer chooses you and sends the order.</li><li>Accept, contact the customer, and confirm the full payment.</li><li>Submit to Champs; the kitchen receives it and prints the receipt.</li><li>Collect when ready—submitted driver orders are prepared for collection without joining the ordering queue.</li><li>Pick up, start delivery, then mark delivered.</li></ol></div></div>}
      {notificationConversationId && <ChatDialog conversationId={notificationConversationId} audience="champs" label="Champs chat" initialOpen hideTrigger onClose={() => setNotificationConversationId(null)} />}
    </div>
  );
}
