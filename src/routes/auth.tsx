import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Mail, Lock, User as UserIcon, Phone, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { getAccessRole } from "@/lib/roles";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Champs Chicken" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Auth,
});

function Auth() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "recovery">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("recovery");
    });
    (async () => {
      if (window.location.hash.includes("type=recovery") || new URLSearchParams(window.location.search).get("type") === "recovery") {
        setMode("recovery");
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        const role = await getAccessRole(data.user.id);
        const isStaff = role === "admin" || role === "staff";
        nav({ to: isStaff ? "/admin" : role === "driver" ? "/driver" : "/account" });
        return;
      }
    })();
    return () => listener.subscription.unsubscribe();
  }, [nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/account`,
            data: { full_name: fullName, phone },
          },
        });
        if (error) throw error;
        toast.success("Account created — welcome to Champs!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        const role = await getAccessRole(u.user.id);
        const isStaff = role === "admin" || role === "staff";
        nav({ to: isStaff ? "/admin" : role === "driver" ? "/driver" : "/account" });
      }
    } catch (err: any) {
      toast.error(err.message ?? "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/account` } });
    if (error) toast.error(error.message);
  }

  async function sendReset(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return toast.error("Enter your email address");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth?type=recovery` });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password reset link sent. Check your email.");
  }

  async function saveRecoveredPassword(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) return toast.error("Use at least 8 characters");
    if (password !== confirmPassword) return toast.error("The passwords do not match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated. You can continue to your account.");
    const { data } = await supabase.auth.getUser();
    const role = data.user ? await getAccessRole(data.user.id) : null;
    nav({ to: role === "admin" || role === "staff" ? "/admin" : role === "driver" ? "/driver" : "/account" });
  }

  return (
    <div className="min-h-screen">
      <Header subtitle="Account" />
      <div className="mx-auto max-w-sm px-4 py-8">
        <h1 className="font-display text-4xl text-brand">{mode === "signin" ? "Welcome back" : mode === "signup" ? "Join Champs" : mode === "forgot" ? "Reset password" : "Choose a new password"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "signin" ? "Sign in to see your orders & For You picks." : mode === "signup" ? "Save your details, track orders and get weekly specials." : mode === "forgot" ? "We’ll email you a secure password reset link." : "Enter and confirm your new password."}
        </p>

        {mode === "forgot" ? <form onSubmit={sendReset} className="mt-6 space-y-3">
          <Field icon={Mail}><input type="email" required placeholder="Email" className="w-full bg-transparent focus:outline-none" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <button disabled={busy} className="w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground disabled:opacity-60">{busy ? "Sending…" : "Send reset link"}</button>
          <button type="button" onClick={() => setMode("signin")} className="inline-flex w-full items-center justify-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Back to sign in</button>
        </form> : mode === "recovery" ? <form onSubmit={saveRecoveredPassword} className="mt-6 space-y-3">
          <Field icon={Lock}><input type={showPassword ? "text" : "password"} required minLength={8} autoComplete="new-password" placeholder="New password (min 8 chars)" className="w-full bg-transparent focus:outline-none" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></Field>
          <Field icon={Lock}><input type={showPassword ? "text" : "password"} required minLength={8} autoComplete="new-password" placeholder="Confirm new password" className="w-full bg-transparent focus:outline-none" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></Field>
          <button disabled={busy} className="w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground disabled:opacity-60">{busy ? "Saving…" : "Save new password"}</button>
        </form> : <form onSubmit={submit} className="mt-6 space-y-3">
          {mode === "signup" && (
            <>
              <Field icon={UserIcon}>
                <input
                  type="text"
                  required
                  placeholder="Full name"
                  className="w-full bg-transparent focus:outline-none"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </Field>
              <Field icon={Phone}>
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="Phone number (optional)"
                  className="w-full bg-transparent focus:outline-none"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
            </>
          )}
          <Field icon={Mail}>
            <input
              type="email"
              required
              placeholder="Email"
              className="w-full bg-transparent focus:outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field icon={Lock}>
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              placeholder="Password (min 6 chars)"
              className="w-full bg-transparent focus:outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}</button>
          </Field>
          <button disabled={busy} className="w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-foreground hover:bg-brand-dark disabled:opacity-60">
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>}

        {(mode === "signin" || mode === "signup") && <><div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
        <button type="button" onClick={signInWithGoogle} className="w-full rounded-full border bg-card py-3 text-sm font-bold hover:bg-accent">Continue with Google</button>
        {mode === "signup" && <p className="mt-3 text-center text-[11px] text-muted-foreground">We’ll email you a verification link before your account is activated.</p>}
        {mode === "signin" && <button type="button" onClick={() => setMode("forgot")} className="mt-3 w-full text-center text-sm font-semibold text-brand underline">Forgot password?</button>}

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-4 w-full text-center text-sm text-muted-foreground"
        >
          {mode === "signin" ? (
            <>New to Champs? <span className="text-brand font-bold underline">Create account</span></>
          ) : (
            <>Already have an account? <span className="text-brand font-bold underline">Sign in</span></>
          )}
        </button>
        </>}

        <div className="mt-8 text-center text-[11px] text-muted-foreground">
          <Link to="/" className="underline">Continue as guest</Link>
          <div className="mt-1">Staff members: sign in above and an admin will assign your role.</div>
        </div>
      </div>
    </div>
  );
}

function Field({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-input bg-card px-4 py-3 text-sm focus-within:ring-2 focus-within:ring-brand">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      {children}
    </div>
  );
}
