import { supabase } from "@/integrations/supabase/client";

export type AuditAction = {
  action_type: string;
  action_description: string;
  target_type: string;
  target_id?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logAdminAction(action: AuditAction): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const adminId = data.user?.id;
    if (!adminId) return;

    await supabase.from("audit_logs").insert({
      admin_id: adminId,
      action_type: action.action_type,
      action_description: action.action_description,
      target_type: action.target_type,
      target_id: action.target_id ?? null,
      metadata: action.metadata ?? {},
      ip_address: null,
      user_agent: typeof navigator === "undefined" ? null : navigator.userAgent,
    } as never);
  } catch {
    // Auditing must never block the administrative action it observes.
  }
}
