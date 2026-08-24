import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { PasswordChangeForm } from "@/components/PasswordChangeForm";

export const Route = createFileRoute("/_authenticated/admin/security")({
  head: () => ({ meta: [{ title: "Security — Champs Admin" }, { name: "robots", content: "noindex" }] }),
  component: SecurityPage,
});

function SecurityPage() {
  return <div className="min-h-screen bg-muted/40 pb-20"><header className="sticky top-0 z-30 border-b bg-background"><div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3"><Link to="/admin" className="inline-flex items-center gap-1 text-sm font-semibold"><ArrowLeft className="h-4 w-4" /> Admin</Link><div className="inline-flex items-center gap-2 font-display text-xl text-brand"><LockKeyhole className="h-5 w-5" /> Security</div><div className="w-16" /></div></header><main className="mx-auto max-w-2xl px-4 py-5"><PasswordChangeForm title="Admin password" /></main></div>;
}
