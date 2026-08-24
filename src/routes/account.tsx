import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Package, Repeat, Sparkles, ShieldCheck, ChevronRight, Bike, Settings } from "lucide-react";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { myOrdersQuery, activePromotionsQuery } from "@/lib/user-queries";
import { menuQuery } from "@/lib/menu-queries";
import { useCart } from "@/lib/cart";
import { getAccessRole } from "@/lib/roles";
import { formatZAR } from "@/lib/format";
import { toast } from "sonner";
import { requestDriverApplication } from "@/lib/admin.functions";
import { getMenuImageForItem } from "@/lib/menu-images";
import { AccountPageSkeleton } from "@/components/Loader";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [{ title: "My Account — Champs Chicken" }, { name: "robots", content: "noindex" }],
  }),
  component: Account,
});

function Account() {
  const nav = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ full_name: string | null; phone: string | null } | null>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [isDriver, setIsDriver] = useState(false);
  const [driverApplication, setDriverApplication] = useState<{ status: string; admin_notes: string | null } | null>(null);
  const [driverForm, setDriverForm] = useState({ name: "", phone: "", id_number: "", student_number: "", profile_photo_url: "", selfie_url: "", branch_id: "", bank_name: "", bank_account_number: "", bank_account_holder: "" });
  const [branches, setBranches] = useState<Array<{ id: string; name: string; city: string }>>([]);
  const [driverBusy, setDriverBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [complaints, setComplaints] = useState<Array<{ id: string; subject: string; details: string; status: string; category: string; order_id: string | null; created_at: string; resolution: string | null }>>([]);
  const [selectedComplaint, setSelectedComplaint] = useState<(typeof complaints)[number] | null>(null);
  const [complaintForm, setComplaintForm] = useState({ order_id: "", category: "service", subject: "", details: "" });
  const [complaintBusy, setComplaintBusy] = useState(false);

  async function loadAccount() {
    setChecking(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setUserId(null);
      setProfile(null);
      setIsStaff(false);
      setIsDriver(false);
      setDriverApplication(null);
      setChecking(false);
      return;
    }

    setUserId(u.user.id);
    const [{ data: p }, role, { data: branchData }] = await Promise.all([
      supabase.from("profiles").select("full_name, phone").eq("id", u.user.id).maybeSingle(),
      getAccessRole(u.user.id),
      supabase.from("branches").select("id, name, city").eq("is_active", true).order("sort_order"),
    ]);
    setProfile(p);
    setIsStaff(role === "admin" || role === "staff");
    const driverRole = role === "driver";
    let resolvedIsDriver = driverRole;
    if (!driverRole) {
      const { data: driverRow, error: driverError } = await supabase.from("drivers").select("id").eq("user_id", u.user.id).maybeSingle();
      if (driverRow && !driverError) resolvedIsDriver = true;
    }
    setIsDriver(resolvedIsDriver);
    setBranches((branchData ?? []) as Array<{ id: string; name: string; city: string }>);
    setDriverForm((f) => ({ ...f, name: p?.full_name || "", phone: p?.phone || "" }));
    const { data: app } = await supabase.from("driver_applications").select("status, admin_notes").eq("user_id", u.user.id).maybeSingle();
    setDriverApplication(app);
    const { data: complaintRows } = await (supabase as any).from("customer_complaints").select("id,subject,details,status,category,order_id,created_at,resolution").eq("customer_id", u.user.id).order("created_at", { ascending: false });
    setComplaints((complaintRows ?? []) as typeof complaints);
    setChecking(false);
  }

  useEffect(() => {
    loadAccount();
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setUserId(null);
        setProfile(null);
        setIsStaff(false);
        setIsDriver(false);
        setDriverApplication(null);
        setChecking(false);
        nav({ to: "/auth" });
        return;
      }
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        loadAccount();
      }
    });
    return () => subscription?.subscription.unsubscribe();
  }, []);

  const { data: orders = [] } = useQuery(myOrdersQuery(userId));
  const { data: menu } = useQuery(menuQuery);
  const { data: promos = [] } = useQuery(activePromotionsQuery);
  const { add } = useCart();

  // "For You" heuristic: most-ordered items by this customer, then popular fallbacks
  const forYou = useMemo(() => {
    if (!menu) return [];
    const counts = new Map<string, number>();
    orders.forEach((o) =>
      o.items.forEach((i) => {
        if (i.menu_item_id) counts.set(i.menu_item_id, (counts.get(i.menu_item_id) ?? 0) + i.quantity);
      }),
    );
    const suggestedIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
    const suggested = menu.items.filter((i) => suggestedIds.includes(i.id) && i.is_available);
    if (suggested.length >= 4) return suggested.slice(0, 6);
    // Fill with popular combos + fan favourites
    const combosCat = menu.categories.find((c) => c.slug === "combos");
    const fallback = menu.items.filter(
      (i) => i.is_available && !suggestedIds.includes(i.id) && (combosCat ? i.category_id === combosCat.id : true),
    );
    return [...suggested, ...fallback].slice(0, 6);
  }, [orders, menu]);

  async function signOut() {
    await supabase.auth.signOut();
    setUserId(null);
    setProfile(null);
    setIsStaff(false);
    setIsDriver(false);
    setDriverApplication(null);
    nav({ to: "/auth" });
  }

  async function reorder(orderId: string) {
    const o = orders.find((x) => x.id === orderId);
    if (!o) return;
    let added = 0;
    o.items.forEach((it) => {
      if (it.menu_item_id) {
        const mi = menu?.items.find((m) => m.id === it.menu_item_id);
        if (mi && mi.is_available) {
          add({ id: mi.id, name: mi.name, variant: mi.variant_label, unit_price_cents: mi.price_cents }, it.quantity);
          added++;
        }
      }
    });
    if (added === 0) toast.error("Those items aren't available right now");
    else {
      toast.success(`Added ${added} items to cart`);
      nav({ to: "/cart" });
    }
  }

  async function requestDriverAccess(e: React.FormEvent) {
    e.preventDefault();
    if (!driverForm.name.trim() || !driverForm.phone.trim()) return toast.error("Name and phone are required");
    // If student number not provided, require valid SA ID (13 digits)
    if (!driverForm.student_number.trim() && !/^\d{13}$/.test(driverForm.id_number.trim())) return toast.error("Valid SA ID number is required (13 digits) or provide a student number");
    setDriverBusy(true);
    try {
      await requestDriverApplication({ data: { name: driverForm.name, phone: driverForm.phone, idNumber: driverForm.id_number || undefined, studentNumber: driverForm.student_number || undefined, profilePhotoUrl: driverForm.profile_photo_url || undefined, selfieUrl: driverForm.selfie_url || undefined, branchId: driverForm.branch_id || undefined, bankName: driverForm.bank_name, bankAccountNumber: driverForm.bank_account_number, bankAccountHolder: driverForm.bank_account_holder } });
      toast.success("Driver request sent");
      setDriverApplication({ status: "pending", admin_notes: null });
    } catch (err: any) {
      toast.error(err.message ?? "Could not send driver request");
    } finally {
      setDriverBusy(false);
    }
  }

  async function submitComplaint(event: React.FormEvent) {
    event.preventDefault();
    if (!userId) return;
    if (complaintForm.subject.trim().length < 3 || complaintForm.details.trim().length < 5) return toast.error("Add a subject and enough detail for Champs to investigate");
    setComplaintBusy(true);
    try {
      const selectedOrder = orders.find((order) => order.id === complaintForm.order_id);
      const { error } = await (supabase as any).from("customer_complaints").insert({ customer_id: userId, order_id: selectedOrder?.id ?? null, driver_id: selectedOrder?.driver_id ?? null, category: complaintForm.category, subject: complaintForm.subject.trim(), details: complaintForm.details.trim() });
      if (error) throw error;
      setComplaintForm({ order_id: "", category: "service", subject: "", details: "" });
      toast.success("Complaint sent to Champs");
      await loadAccount();
    } catch (error: any) { toast.error(error.message ?? "Could not send complaint"); }
    finally { setComplaintBusy(false); }
  }

  if (checking) return <AccountPageSkeleton />;

  if (!userId) {
    return (
      <div className="min-h-screen pb-24">
        <Header subtitle="My Account" />
        <div className="mx-auto max-w-lg px-4 py-20 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-3 text-sm font-semibold text-muted-foreground">
            <Package className="h-4 w-4 text-brand" />
            Sign in to access your account and driver application
          </div>
          <div className="mt-6 rounded-3xl border border-border bg-background p-8">
            <h1 className="font-display text-2xl text-brand">Welcome back</h1>
            <p className="mt-3 text-sm text-muted-foreground">Sign in to view order history, apply to become a driver, and manage your profile.</p>
            <Link to="/auth" className="mt-6 inline-flex rounded-full bg-brand px-5 py-3 text-sm font-bold text-brand-foreground">Sign in</Link>
          </div>
        </div>
        <BottomNav />
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <Header subtitle="My Account" />

      <div className="mx-auto max-w-lg px-4 py-4 space-y-6">
        {/* Profile */}
        <div className="rounded-2xl bg-brand text-brand-foreground p-5">
          <div className="text-xs uppercase tracking-widest opacity-80">Welcome</div>
          <div className="font-display text-3xl mt-0.5">{profile?.full_name || "Champs fan"}</div>
          {profile?.phone && <div className="text-sm opacity-90 mt-1">{profile.phone}</div>}
          <div className="mt-4 flex gap-2">
            {!isStaff && !isDriver && <Link to="/profile" className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold hover:bg-white/30"><Settings className="h-3.5 w-3.5" /> Profile settings</Link>}
            {isStaff && (
              <Link to="/admin" className="inline-flex items-center gap-1.5 rounded-full bg-white/20 backdrop-blur px-3 py-1.5 text-xs font-bold hover:bg-white/30">
                <ShieldCheck className="h-3.5 w-3.5" /> Admin
              </Link>
            )}
            {isDriver && (
              <Link to="/driver" className="inline-flex items-center gap-1.5 rounded-full bg-white/20 backdrop-blur px-3 py-1.5 text-xs font-bold hover:bg-white/30">
                <Bike className="h-3.5 w-3.5" /> Driver
              </Link>
            )}
            <button onClick={signOut} className="inline-flex items-center gap-1.5 rounded-full bg-white/20 backdrop-blur px-3 py-1.5 text-xs font-bold hover:bg-white/30">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>

        {/* Weekly specials */}
        {promos.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-brand" />
              <h2 className="font-display text-2xl">Specials for you</h2>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {promos.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
                  <div className="min-w-0">
                    {p.badge && <div className="text-[10px] font-bold uppercase tracking-wider text-brand">{p.badge}</div>}
                    <div className="font-semibold text-sm">{p.title}</div>
                    {p.description && <div className="text-xs text-muted-foreground line-clamp-1">{p.description}</div>}
                  </div>
                  {p.price_cents != null && <div className="font-display text-xl text-brand shrink-0 pl-3">{formatZAR(p.price_cents)}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* For you */}
        {forYou.length > 0 && (
          <section>
            <h2 className="font-display text-2xl mb-2">For you</h2>
            <div className="grid grid-cols-2 gap-2">
              {forYou.map((it) => (
                <button
                  key={it.id}
                  onClick={() => {
                    add({ id: it.id, name: it.name, variant: it.variant_label, unit_price_cents: it.price_cents });
                    toast.success(`Added ${it.name}`);
                  }}
                  className="text-left rounded-xl border border-border bg-card p-3 hover:border-brand"
                >
                  <div className="font-semibold text-sm truncate">{it.name}</div>
                  {it.variant_label && <div className="text-[11px] text-muted-foreground">{it.variant_label}</div>}
                  <div className="mt-1 font-display text-lg text-brand">{formatZAR(it.price_cents)}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {!isDriver && !isStaff && (
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Bike className="h-4 w-4 text-brand" />
              <h2 className="font-display text-2xl">Become a driver</h2>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">Drivers must provide their own motorbike or car. Champs will not provide transport.</p>
            {driverApplication ? (
              <div className="rounded-xl bg-muted/50 p-3 text-sm">
                Request status: <span className="font-bold capitalize text-brand">{driverApplication.status}</span>
                {driverApplication.admin_notes && <div className="mt-1 text-xs text-muted-foreground">{driverApplication.admin_notes}</div>}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm">Ready to apply? Click below to open the driver application form.</p>
                <Link to="/become-driver" className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground">Apply to become a driver</Link>
                {!userId && (
                  <div className="mt-2 text-xs text-muted-foreground">You should <Link to="/auth" className="underline text-brand">sign in</Link> to apply and save your application.</div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Order history */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Package className="h-4 w-4 text-brand" />
            <h2 className="font-display text-2xl">Order history</h2>
          </div>
          {orders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No orders yet.{" "}
              <Link to="/menu" className="text-brand font-bold underline">Order now</Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {orders.map((o) => (
                <li key={o.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link to="/order/$number" params={{ number: o.order_number }} className="min-w-0 flex-1">
                      <div className="font-display text-lg text-brand">{o.order_number}</div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {new Date(o.created_at).toLocaleDateString()} · {o.status.replace(/_/g, " ")} · {o.fulfillment}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground truncate">
                        {o.items.map((i) => `${i.quantity}× ${i.item_name}`).join(", ")}
                      </div>
                    </Link>
                    <div className="text-right shrink-0">
                      <div className="font-display text-lg">{formatZAR(o.subtotal_cents + (o.delivery_fee_cents ?? 0))}</div>
                      <button
                        onClick={() => reorder(o.id)}
                        className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-brand-foreground hover:bg-brand-dark"
                      >
                        <Repeat className="h-3 w-3" /> Reorder
                      </button>
                    </div>
                  </div>
                  <Link to="/order/$number" params={{ number: o.order_number }} className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-semibold text-brand">
                    View <ChevronRight className="h-3 w-3" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

      </div>

      <BottomNav />
      <Footer />
    </div>
  );
}
