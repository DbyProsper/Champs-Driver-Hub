import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, MessageCircle, Bell, ShieldCheck, Landmark, Upload, Copy, Phone, Star, Flag, Loader2, Clock3 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Header } from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { formatZAR } from "@/lib/format";
import { notificationPermission, requestNotificationPermission } from "@/lib/notifications";
import { waLink, orderStatusMessage } from "@/lib/whatsapp";
import { PAYMENT_STATUS_LABEL, resolveOrderDisplayStatus } from "@/lib/delivery";
import { toast } from "sonner";
import { submitDeliveryPayment } from "@/lib/admin.functions";
import { ChatDialog } from "@/components/ChatDialog";
import { ImagePreview } from "@/components/ImagePreview";
import { CustomerLiveDeliveryMap } from "@/components/CustomerLiveDeliveryMap";

const orderQuery = (number: string) =>
  queryOptions({
    queryKey: ["order", number],
    queryFn: async () => {
      const { data: order, error } = await (supabase as any)
        .from("orders")
        .select("id, order_number, customer_name, customer_phone, fulfillment, delivery_notes, subtotal_cents, delivery_fee_cents, status, created_at, pickup_pin, branch_id, verified_at, user_id, driver_id, workflow_status, delivery_lat, delivery_lng")
        .eq("order_number", number)
        .maybeSingle();
      if (error) throw error;
      if (!order) return null;
      const [{ data: itemsData }, { data: branch }, { data: delivery }] = await Promise.all([
        supabase.from("order_items").select("item_name, unit_price_cents, quantity").eq("order_id", order.id),
        order.branch_id
          ? supabase.from("branches").select("name, address, city, phone").eq("id", order.branch_id).maybeSingle()
          : Promise.resolve({ data: null }),
        order.fulfillment === "delivery"
          ? (supabase.from("deliveries") as any)
              .select("id, queue_position, estimated_eta_min, estimated_eta_max, driver_id, status, delivery_fee_cents, payment_status, payment_reference, proof_of_payment_url, assign_deadline_at")
              .eq("order_id", order.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      let driver: { name: string; phone: string; profile_image_url: string | null; rating: number; rating_count: number; bank_name: string | null; bank_account_number: string | null; bank_account_holder: string | null } | null = null;
      let aheadCount = 0;
      const d: any = delivery;
      const driverId = d?.driver_id ?? order?.driver_id ?? null;
      if (driverId) {
        const { data: dr } = await (supabase.from("drivers") as any)
          .select("name, phone, profile_image_url, rating, rating_count, bank_name, bank_account_number, bank_account_holder")
          .eq("id", driverId)
          .maybeSingle();
        driver = dr;
        if (d?.queue_position) aheadCount = Math.max(0, (d.queue_position as number) - 1);
      }
      return { order, items: itemsData ?? [], branch, delivery: d, driver, aheadCount };
    },
    staleTime: 5_000,
  });

export const Route = createFileRoute("/order/$number")({
  head: ({ params }) => ({
    meta: [
      { title: `Order ${params.number} — Champs Chicken` },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(orderQuery(params.number)),
  errorComponent: ({ error }) => <div className="p-6 text-sm">Failed: {error.message}</div>,
  notFoundComponent: () => <div className="p-6 text-sm">Order not found.</div>,
  component: OrderPage,
});

const PICKUP_STATUS_LABEL: Record<string, string> = {
  pending: "Received",
  preparing: "Preparing",
  ready: "Ready for collection",
  completed: "Collected",
  cancelled: "Cancelled",
};
const DELIVERY_STATUS_LABEL: Record<string, string> = {
  pending: "Received",
  preparing: "Preparing",
  ready: "Ready",
  handed_to_driver: "Handed to driver",
  picked_up: "Picked up",
  on_the_way: "Out for delivery",
  out_for_delivery: "Out for delivery",
  completed: "Delivered",
  cancelled: "Cancelled",
};
const PICKUP_STEPS = ["pending", "preparing", "ready", "completed"] as const;
const DELIVERY_STEPS = ["pending", "preparing", "ready", "handed_to_driver", "out_for_delivery", "completed"] as const;
const DELIVERY_STATUS_SHORT_LABEL: Record<string, string> = {
  pending: "Received",
  preparing: "Prep",
  ready: "Ready",
  handed_to_driver: "Handoff",
  out_for_delivery: "Out",
  completed: "Delivered",
};


function OrderPage() {
  const { number } = Route.useParams();
  const { data, refetch } = useSuspenseQuery(orderQuery(number));
  const prevStatus = useRef<string | null>(null);
  const [permission, setPermission] = useState(notificationPermission());
  const [payRef, setPayRef] = useState("");
  const [proofUploading, setProofUploading] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [rating, setRating] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingOpen, setRatingOpen] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [timeoutOpen, setTimeoutOpen] = useState(false);
  const [timeoutView, setTimeoutView] = useState<"choices" | "drivers">("choices");
  const [timeoutBusy, setTimeoutBusy] = useState(false);
  const [alternativeDrivers, setAlternativeDrivers] = useState<any[]>([]);
  const [timeoutSnoozeUntil, setTimeoutSnoozeUntil] = useState(0);

  const isDelivery = data?.order.fulfillment === "delivery";
  const effectiveStatus = resolveOrderDisplayStatus(data?.order.status ?? "pending", data?.delivery?.status ?? null) ?? data?.order.status ?? "pending";
  const visibleStatus = isDelivery && (effectiveStatus === "picked_up" || effectiveStatus === "on_the_way" || effectiveStatus === "out_for_delivery")
    ? "out_for_delivery"
    : effectiveStatus;
  const effectiveDriverId = data?.delivery?.driver_id ?? data?.order.driver_id ?? null;
  const STATUS_LABEL = isDelivery ? DELIVERY_STATUS_LABEL : PICKUP_STATUS_LABEL;
  const STATUS_STEPS = isDelivery ? DELIVERY_STEPS : PICKUP_STEPS;

  // Realtime: order + delivery
  useEffect(() => {
    if (!data?.order.id) return;
    prevStatus.current = data.order.status;
    const ch = supabase
      .channel(`order-${data.order.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${data.order.id}` }, (payload) => {
        const newStatus = (payload.new as any).status as string;
        if (prevStatus.current && newStatus !== prevStatus.current) {
          const label = STATUS_LABEL[newStatus] ?? newStatus;
          toast.success(`Order update: ${label}`);
          prevStatus.current = newStatus;
        }
        refetch();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries", filter: `order_id=eq.${data.order.id}` }, (payload) => {
        const status = (payload.new as any)?.status as string | undefined;
        if (status) {
          const label = DELIVERY_STATUS_LABEL[status] ?? status;
          toast.success(`Order update: ${label}`);
        }
        refetch();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [data?.order.id, data?.order.order_number, refetch, STATUS_LABEL]);

  useEffect(() => {
    const deadline = data?.delivery?.assign_deadline_at ? new Date(data.delivery.assign_deadline_at).getTime() : 0;
    const stillWaiting = isDelivery
      && data?.order.workflow_status === "pending_driver_acceptance"
      && data?.delivery?.status === "pending_driver_acceptance"
      && Boolean(effectiveDriverId)
      && deadline > 0;
    if (!stillWaiting) {
      setTimeoutOpen(false);
      return;
    }
    const dueAt = Math.max(deadline, timeoutSnoozeUntil);
    const show = () => {
      setTimeoutView("choices");
      setTimeoutOpen(true);
    };
    if (dueAt <= Date.now()) {
      show();
      return;
    }
    const timer = window.setTimeout(show, dueAt - Date.now());
    return () => window.clearTimeout(timer);
  }, [data?.delivery?.assign_deadline_at, data?.delivery?.status, data?.order.workflow_status, effectiveDriverId, isDelivery, timeoutSnoozeUntil]);

  useEffect(() => {
    const delivered = isDelivery && data?.order && (data.order.workflow_status === "delivered" || visibleStatus === "completed");
    if (!delivered || !data?.order.id || ratingSubmitted) return;
    let active = true;
    void (async () => {
      const { data: existing } = await (supabase as any).from("driver_ratings").select("id").eq("order_id", data.order.id).maybeSingle();
      if (active && !existing) setRatingOpen(true);
    })();
    return () => { active = false; };
  }, [isDelivery, data?.order?.id, data?.order?.workflow_status, visibleStatus, ratingSubmitted]);

  async function enableNotifications() {
    const p = await requestNotificationPermission();
    setPermission(p);
    if (p === "granted") {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await (supabase as any).from("user_notification_preferences").upsert({
          user_id: auth.user.id,
          browser_enabled: true,
          order_updates: true,
          message_alerts: true,
        }, { onConflict: "user_id" });
      }
      toast.success("Notifications enabled");
    }
    else if (p === "denied") toast.error("Notifications blocked in browser settings");
  }

  async function loadAlternativeDrivers() {
    if (!data?.order.id) return;
    setTimeoutBusy(true);
    try {
      const { data: drivers, error } = await (supabase as any).rpc("list_reassignment_drivers", { _order_id: data.order.id });
      if (error) throw error;
      setAlternativeDrivers(drivers ?? []);
      setTimeoutView("drivers");
    } catch (error: any) {
      toast.error(error.message ?? "Could not load available drivers");
    } finally {
      setTimeoutBusy(false);
    }
  }

  async function reassignDriver(driverId: string) {
    if (!data?.order.id) return;
    setTimeoutBusy(true);
    try {
      const { error } = await (supabase as any).rpc("reassign_timed_out_order", { _order_id: data.order.id, _driver_id: driverId });
      if (error) throw error;
      toast.success("Order sent to your new driver");
      setTimeoutOpen(false);
      setAlternativeDrivers([]);
      await refetch();
    } catch (error: any) {
      toast.error(error.message ?? "That driver is no longer available");
      await loadAlternativeDrivers();
    } finally {
      setTimeoutBusy(false);
    }
  }

  function waitForDriver() {
    setTimeoutSnoozeUntil(Date.now() + 5 * 60_000);
    setTimeoutOpen(false);
    toast.info("We’ll remind you again in 5 minutes if the driver has not responded.");
  }

  async function markIPaid() {
    if (!data?.delivery?.id) return;
    if (!payRef.trim()) return toast.error("Please enter the reference you used");
    setPayBusy(true);
    try {
      await submitDeliveryPayment({ data: { deliveryId: data.delivery.id, reference: payRef.trim() } });
      toast.success("Thanks — your driver will confirm receipt shortly.");
      refetch();
    } catch (err: any) {
      toast.error(err.message ?? "Could not submit payment");
    } finally {
      setPayBusy(false);
    }
  }

  async function uploadProof(file: File) {
    if (!data?.order?.id || !data?.delivery?.id) return;
    setProofUploading(true);
    try {
      const path = `${data.order.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("payment-proofs").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      await submitDeliveryPayment({ data: { deliveryId: data.delivery.id, reference: payRef.trim() || `${data.order.order_number} ${data.order.customer_name}`, proofPath: path } });
      toast.success("Proof uploaded");
      refetch();
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setProofUploading(false);
    }
  }

  function copyText(text: string) {
    try { navigator.clipboard.writeText(text); toast.success("Copied"); } catch {}
  }

  async function submitRating() {
    if (!effectiveDriverId || !data?.order.user_id) return toast.error("A signed-in delivered order is required");
    if (rating < 3 && ratingComment.trim().length < 5) return toast.error("Please tell us what went wrong for ratings below 3 stars");
    const { data: user } = await supabase.auth.getUser();
    if (user.user?.id !== data.order.user_id) return toast.error("Sign in with the account that placed this order");
    const customerId = user.user?.id;
    if (!customerId) return;
    const { error } = await (supabase as any).from("driver_ratings").upsert({ order_id: data.order.id, driver_id: effectiveDriverId, customer_id: customerId, rating, comment: ratingComment.trim() || null }, { onConflict: "order_id" });
    if (error) return toast.error(error.message);
    setRatingSubmitted(true);
    setRatingOpen(false);
    toast.success("Thank you for rating your driver");
  }

  async function submitReport() {
    if (!effectiveDriverId || !data?.order.user_id) return;
    const { data: user } = await supabase.auth.getUser();
    if (user.user?.id !== data.order.user_id) return toast.error("Sign in with the account that placed this order");
    const customerId = user.user?.id;
    if (!customerId) return;
    const { error } = await (supabase as any).from("driver_reports").insert({ order_id: data.order.id, driver_id: effectiveDriverId, customer_id: customerId, reason: reportReason.trim(), details: reportDetails.trim() });
    if (error) return toast.error(error.message);
    setReportOpen(false); toast.success("Report sent to Champs for review");
  }

  if (!data) return <div className="p-6 text-sm">Order not found.</div>;
  const { order, items, branch, delivery, driver, aheadCount } = data;
  const currentIdx = (STATUS_STEPS as readonly string[]).indexOf(visibleStatus);
  const waText = orderStatusMessage(order.order_number, visibleStatus, order.customer_name);
  const verifyPayload = `champs:${order.order_number}:${order.pickup_pin}`;
  const d: any = delivery;
  const fullTotalCents = order.subtotal_cents + (order.delivery_fee_cents ?? d?.delivery_fee_cents ?? 0);
  const liveTrackingActive = d?.status === "on_the_way" || d?.status === "out_for_delivery";
  const ratingLabels: Record<number, string> = { 5: "Excellent and fast service", 4: "Good", 3: "Moderate", 2: "Fair reliability", 1: "Poor" };

  return (
    <div className="min-h-screen pb-10">
      <Header subtitle="Order Confirmed" />
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="rounded-2xl bg-brand p-6 text-brand-foreground text-center">
          <CheckCircle2 className="mx-auto h-12 w-12" />
          <div className="mt-3 text-xs uppercase tracking-widest opacity-80">Order number</div>
          <div className="font-display text-4xl">{order.order_number}</div>
          <div className="mt-4 inline-flex rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wider">
            {STATUS_LABEL[visibleStatus] ?? visibleStatus}
          </div>
          {isDelivery && d?.estimated_eta_min != null && d?.estimated_eta_max != null && (
            <div className="mt-3 text-sm">
              <span className="opacity-80">Estimated delivery</span>{" "}
              <span className="font-bold">{d.estimated_eta_min}–{d.estimated_eta_max} min</span>
            </div>
          )}
          {isDelivery && effectiveDriverId && aheadCount > 0 && (
            <div className="mt-1 text-xs opacity-90">Driver has {aheadCount} {aheadCount === 1 ? "delivery" : "deliveries"} before yours</div>
          )}
          {isDelivery && !effectiveDriverId && (
            <div className="mt-3 text-xs opacity-90">Finding a driver for you…</div>
          )}
        </div>

        {visibleStatus !== "cancelled" && (
          <div className="mt-4 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              {STATUS_STEPS.map((s, i) => (
                <div key={s} className="flex-1 flex items-center">
                  <div className={`h-8 w-8 rounded-full grid place-items-center text-[10px] font-bold ${i <= currentIdx ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</div>
                  {i < STATUS_STEPS.length - 1 && (<div className={`flex-1 h-1 mx-1 rounded ${i < currentIdx ? "bg-brand" : "bg-muted"}`} />)}
                </div>
              ))}
            </div>
            <div
              className="mt-2 grid gap-1 text-center text-[9px] font-semibold uppercase leading-tight text-muted-foreground sm:text-[10px] sm:tracking-wider"
              style={{ gridTemplateColumns: `repeat(${STATUS_STEPS.length}, minmax(0, 1fr))` }}
            >
              {STATUS_STEPS.map((s) => (
                <div key={s} className="min-w-0">
                  {isDelivery ? <><span className="sm:hidden">{DELIVERY_STATUS_SHORT_LABEL[s] ?? s}</span><span className="hidden sm:inline">{STATUS_LABEL[s] ?? s}</span></> : (STATUS_LABEL[s] ?? s)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delivery: driver + payment card */}
        {isDelivery && effectiveDriverId && (
          <div className="mt-4 rounded-2xl border-2 border-brand/30 bg-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {driver?.profile_image_url ? <ImagePreview src={driver.profile_image_url} alt={`${driver.name} profile picture`} className="h-12 w-12 rounded-full object-cover" /> : null}
                <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Your driver</div>
                <div className="font-display text-lg text-brand">{driver?.name ?? "Driver assigned"}</div>
                {driver && <div className="text-[11px] text-muted-foreground">★ {Number(driver.rating ?? 0).toFixed(1)} · {driver.rating_count ?? 0} reviews</div>}
                {driver?.phone ? (
                  <a href={`tel:${driver.phone}`} className="text-xs text-muted-foreground underline">{driver.phone}</a>
                ) : (
                  <div className="text-xs text-muted-foreground">Driver details will appear here as soon as they are available.</div>
                )}
                </div>
              </div>
              <span className="rounded-full bg-brand/10 px-2 py-1 text-[10px] font-bold uppercase text-brand">{d?.status ?? "assigned"}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ChatDialog orderId={order.id} label="Chat" className="inline-flex items-center justify-center gap-1 rounded-xl bg-brand px-2 py-2.5 text-xs font-bold text-brand-foreground" />
              {driver?.phone && <a href={`https://wa.me/${driver.phone.replace(/\D/g, "").replace(/^0/, "27")}?text=${encodeURIComponent(`Hi, please confirm Champs order ${order.order_number}. The full amount (food + delivery) is ${formatZAR(fullTotalCents)}.`)}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1 rounded-xl bg-[#25D366] px-2 py-2.5 text-xs font-bold text-white"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>}
              {driver?.phone && <a href={`tel:${driver.phone}`} className="inline-flex items-center justify-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-bold"><Phone className="h-3.5 w-3.5" /> Call</a>}
            </div>
            {liveTrackingActive ? (
              <CustomerLiveDeliveryMap
                orderId={order.id}
                orderNumber={order.order_number}
                driverId={effectiveDriverId}
                destinationLat={order.delivery_lat}
                destinationLng={order.delivery_lng}
              />
            ) : visibleStatus !== "completed" && visibleStatus !== "cancelled" ? (
              <div className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">Live tracking will become available once your driver starts the delivery.</div>
            ) : null}
            {(driver?.bank_name || driver?.bank_account_number) && (
              <div className="rounded-xl bg-muted/40 p-3 text-sm">
                <div className="flex items-center gap-2 font-bold text-brand"><Landmark className="h-4 w-4" /> Pay your driver directly</div>
                <div className="mt-2 space-y-1 text-xs">
                  {driver.bank_account_holder && <Row label="Account holder" value={driver.bank_account_holder} onCopy={() => copyText(driver.bank_account_holder!)} />}
                  {driver.bank_name && <Row label="Bank" value={driver.bank_name} onCopy={() => copyText(driver.bank_name!)} />}
                  {driver.bank_account_number && <Row label="Account number" value={driver.bank_account_number} onCopy={() => copyText(driver.bank_account_number!)} />}
                  <Row label="Full amount" value={formatZAR(fullTotalCents)} onCopy={() => copyText(String(fullTotalCents / 100))} />
                  <Row label="Reference" value={`${order.order_number} ${order.customer_name}`} onCopy={() => copyText(`${order.order_number} ${order.customer_name}`)} />
                </div>
                <div className="mt-3 rounded-lg bg-background border p-2 text-[11px] text-muted-foreground">Use your order number as the reference so the driver can match your payment.</div>

                {d?.payment_status === "paid" ? (
                  <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-green-600 px-3 py-1 text-[10px] font-bold text-white uppercase"><CheckCircle2 className="h-3 w-3" /> Paid</div>
                ) : d?.payment_status === "pending" ? (
                  <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs">Awaiting driver confirmation of payment.</div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <input
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                      placeholder="Payment reference (e.g. your name / order number)"
                      value={payRef}
                      onChange={(e) => setPayRef(e.target.value)}
                    />
                    <button onClick={markIPaid} disabled={payBusy} className="w-full rounded-lg bg-brand py-2.5 text-sm font-bold text-brand-foreground disabled:opacity-60">
                      {payBusy ? "Saving…" : "I have paid"}
                    </button>
                    <label className="w-full inline-flex items-center justify-center gap-2 rounded-lg border py-2 text-xs font-semibold cursor-pointer">
                      <Upload className="h-3.5 w-3.5" /> {proofUploading ? "Uploading…" : "Attach proof of payment (optional)"}
                      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
                    </label>
                  </div>
                )}
                <div className="mt-2 text-[11px] text-muted-foreground">Payment status: <span className="font-semibold text-foreground">{PAYMENT_STATUS_LABEL[d?.payment_status ?? "not_paid"]}</span></div>
              </div>
            )}
          </div>
        )}

        {timeoutOpen && (
          <div className="fixed inset-0 z-[90] grid place-items-end bg-black/55 p-0 sm:place-items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="driver-timeout-title">
            <div className="max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border bg-background p-5 shadow-2xl sm:max-w-md sm:rounded-3xl">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700"><Clock3 className="h-5 w-5" /></div>
                <div>
                  <div id="driver-timeout-title" className="font-display text-2xl text-brand">Your driver hasn’t responded</div>
                  <p className="mt-1 text-sm text-muted-foreground">It has been 10 minutes. You can choose another free driver, contact {driver?.name ?? "your driver"}, or wait a little longer.</p>
                </div>
              </div>

              {timeoutView === "choices" ? (
                <div className="mt-5 space-y-2">
                  <button type="button" disabled={timeoutBusy} onClick={loadAlternativeDrivers} className="flex w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-bold text-brand-foreground disabled:opacity-60">
                    {timeoutBusy && <Loader2 className="h-4 w-4 animate-spin" />} Choose another free driver
                  </button>
                  {driver?.phone && (
                    <div className="grid grid-cols-2 gap-2">
                      <a href={`tel:${driver.phone}`} className="inline-flex items-center justify-center gap-2 rounded-full border px-3 py-3 text-sm font-bold"><Phone className="h-4 w-4" /> Call driver</a>
                      <a href={`https://wa.me/${driver.phone.replace(/\D/g, "").replace(/^0/, "27")}?text=${encodeURIComponent(`Hi, are you able to accept Champs order ${order.order_number}?`)}`} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full border px-3 py-3 text-sm font-bold"><MessageCircle className="h-4 w-4" /> WhatsApp</a>
                    </div>
                  )}
                  <button type="button" onClick={waitForDriver} className="w-full rounded-full border px-4 py-3 text-sm font-bold">Wait 5 more minutes</button>
                </div>
              ) : (
                <div className="mt-5">
                  <button type="button" onClick={() => setTimeoutView("choices")} className="mb-3 text-sm font-semibold text-brand">← Back</button>
                  {alternativeDrivers.length === 0 ? (
                    <div className="rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground">No other free drivers are online right now. You can contact your current driver or wait and try again.</div>
                  ) : (
                    <div className="space-y-2">
                      {alternativeDrivers.map((candidate) => (
                        <button key={candidate.driver_id} type="button" disabled={timeoutBusy} onClick={() => reassignDriver(candidate.driver_id)} className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left hover:border-brand disabled:opacity-60">
                          {candidate.profile_image_url ? <img src={candidate.profile_image_url} alt="" className="h-12 w-12 rounded-full object-cover" /> : <div className="grid h-12 w-12 rounded-full bg-muted text-sm font-bold">{candidate.name?.slice(0, 1)}</div>}
                          <div className="min-w-0 flex-1"><div className="truncate font-bold">{candidate.name}</div><div className="text-xs text-muted-foreground">★ {Number(candidate.rating ?? 0).toFixed(1)} · {candidate.distance_km == null ? "Distance unavailable" : `${Number(candidate.distance_km).toFixed(1)} km away`}</div></div>
                          {timeoutBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-xs font-bold text-brand">Select</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {ratingOpen && <div className="fixed inset-0 z-[85] grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-sm rounded-3xl border bg-background p-5 shadow-2xl"><div className="font-display text-2xl text-brand">Rate your driver</div><div className="mt-3 flex gap-1">{[1,2,3,4,5].map((value) => <button type="button" key={value} onClick={() => setRating(value)} aria-label={`${value} stars`}><Star className={`h-8 w-8 ${value <= rating ? "fill-amber-400 text-amber-400" : "text-muted"}`} /></button>)}</div><div className="mt-2 text-sm font-semibold">{ratingLabels[rating]}</div><textarea value={ratingComment} onChange={(event) => setRatingComment(event.target.value)} maxLength={1000} rows={3} placeholder={rating < 3 ? "Tell us what went wrong (required)" : "Add a comment (optional)"} className="mt-3 w-full rounded-xl border bg-background px-3 py-2 text-sm" /><button type="button" onClick={submitRating} className="mt-3 w-full rounded-full bg-brand px-4 py-3 text-sm font-bold text-brand-foreground">Submit rating</button></div></div>}

        {isDelivery && effectiveDriverId && (
          <div className="mt-3">
            {!reportOpen ? <button type="button" onClick={() => setReportOpen(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Flag className="h-3.5 w-3.5" /> Report this driver</button> : (
              <div className="rounded-2xl border border-destructive/30 bg-card p-4 space-y-2"><input value={reportReason} onChange={(event) => setReportReason(event.target.value)} placeholder="Reason" className="w-full rounded-xl border px-3 py-2 text-sm" /><textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} placeholder="Tell Champs what happened" rows={3} className="w-full rounded-xl border px-3 py-2 text-sm" /><div className="flex gap-2"><button type="button" disabled={reportReason.trim().length < 3 || reportDetails.trim().length < 5} onClick={submitReport} className="rounded-full bg-destructive px-4 py-2 text-xs font-bold text-destructive-foreground disabled:opacity-50">Send report</button><button type="button" onClick={() => setReportOpen(false)} className="rounded-full border px-4 py-2 text-xs">Cancel</button></div></div>
            )}
          </div>
        )}

        {/* PIN + QR verification card */}
        <div className="mt-4 rounded-2xl border-2 border-brand/40 bg-brand/5 p-5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brand">
            <ShieldCheck className="h-4 w-4" /> Show this on {isDelivery ? "delivery" : "collection"}
          </div>
          <div className="mt-3 flex items-center gap-4">
            <div className="flex-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pickup PIN</div>
              <div className="font-display text-5xl text-brand tracking-[0.3em]">{order.pickup_pin}</div>
              <p className="mt-2 text-xs text-muted-foreground">Give this 4-digit PIN to the driver or cashier to confirm your order.</p>
            </div>
            <div className="shrink-0 rounded-xl bg-white p-2 border border-border">
              <QRCodeSVG value={verifyPayload} size={96} />
            </div>
          </div>
          {order.verified_at && (
            <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-green-600 px-3 py-1 text-[10px] font-bold text-white uppercase tracking-wider">
              <CheckCircle2 className="h-3 w-3" /> Verified
            </div>
          )}
        </div>

        {permission === "default" && (
          <button onClick={enableNotifications} className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border border-brand/40 bg-card py-3 text-sm font-semibold text-brand hover:bg-brand/5">
            <Bell className="h-4 w-4" /> Enable notifications for order updates
          </button>
        )}

        <a href={waLink(branch?.phone, waText)} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center justify-center gap-2 rounded-full bg-[#25D366] py-3 text-sm font-bold text-white hover:opacity-90">
          <MessageCircle className="h-4 w-4" /> Send confirmation on WhatsApp
        </a>

        <div className="mt-6 rounded-xl border border-border bg-card p-4 text-sm space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Customer</div>
            <div className="font-semibold">{order.customer_name}</div>
            <div className="text-muted-foreground">{order.customer_phone}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Type</div>
            <div className="font-semibold capitalize">{order.fulfillment}</div>
            {order.delivery_notes && <div className="text-muted-foreground text-xs mt-1">{order.delivery_notes}</div>}
          </div>
          {branch && (
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Branch</div>
              <div className="font-semibold">{branch.name}</div>
              <div className="text-muted-foreground text-xs">{branch.address}, {branch.city}</div>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-border bg-card p-4 text-sm space-y-1.5">
          {items.map((i, idx) => (
            <div key={idx} className="flex justify-between gap-3">
              <span className="truncate"><span className="font-bold text-brand">{i.quantity}×</span> {i.item_name}</span>
              <span className="tabular-nums shrink-0">{formatZAR(i.unit_price_cents * i.quantity)}</span>
            </div>
          ))}
          <div className="mt-3 flex justify-between border-t border-border pt-3">
            <span className="font-bold">Food total</span>
            <span className="tabular-nums">{formatZAR(order.subtotal_cents)}</span>
          </div>
          {isDelivery && <div className="flex justify-between"><span>Delivery fee</span><span>{formatZAR(order.delivery_fee_cents ?? 0)}</span></div>}
          <div className="mt-2 flex justify-between border-t border-border pt-3">
            <span className="font-bold">Full total</span>
            <span className="font-display text-xl text-brand">{formatZAR(fullTotalCents)}</span>
          </div>
        </div>

        <Link to="/menu" className="mt-6 block text-center text-sm font-bold text-brand">← Back to menu</Link>
      </div>
    </div>
  );
}

function Row({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
        {value} <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}
