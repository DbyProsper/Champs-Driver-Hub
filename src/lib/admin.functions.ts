import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function resolveAccessRole(context: { supabase: { rpc: (...args: any[]) => any }; claims?: Record<string, unknown>; userId?: string | null }) {
  const currentUserId = (context.userId as string | undefined | null) ?? (context.claims?.sub as string | undefined | null);
  const currentEmail = ((context.claims?.email as string | undefined | null) ?? "").toLowerCase();
  const appMetadata = (context.claims?.app_metadata ?? {}) as Record<string, unknown>;
  const rawClaimRole = context.claims?.role ?? appMetadata.role;
  const claimRole = typeof rawClaimRole === "string"
    ? rawClaimRole.toLowerCase()
    : null;
  const adminEmails = ((import.meta.env.VITE_ADMIN_EMAILS as string | undefined) ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  let rpcRole: string | null = null;
  let normalizedRoleRows: string[] = [];

  try {
    const { data: roleData } = await context.supabase.rpc("get_my_access_role");
    rpcRole = typeof roleData === "string" ? roleData.toLowerCase() : null;
  } catch {
    rpcRole = null;
  }

  try {
    const { data: roleRows } = currentUserId
      ? await supabaseAdmin.from("user_roles").select("role").eq("user_id", currentUserId)
      : { data: [] };
    normalizedRoleRows = ((roleRows ?? []) as Array<{ role?: string }>).map((row) => row.role?.toLowerCase()).filter(Boolean) as string[];
  } catch {
    normalizedRoleRows = [];
  }

  if (rpcRole === "admin" || normalizedRoleRows.includes("admin") || claimRole === "admin" || adminEmails.includes(currentEmail)) {
    return "admin" as const;
  }
  if (rpcRole === "staff" || normalizedRoleRows.includes("staff") || claimRole === "staff") {
    return "staff" as const;
  }
  if (rpcRole === "driver" || normalizedRoleRows.includes("driver") || claimRole === "driver") {
    return "driver" as const;
  }
  return null;
}

async function logServerAdminAction(context: { userId?: string | null }, action: { action_type: string; action_description: string; target_type: string; target_id?: string | null; metadata?: Record<string, unknown> }) {
  const adminId = context.userId;
  if (!adminId) return;
  await supabaseAdmin.from("audit_logs").insert({
    admin_id: adminId,
    ...action,
    target_id: action.target_id ?? null,
    metadata: action.metadata ?? {},
    ip_address: null,
    user_agent: null,
  } as never);
}

async function getVisibleDriversForAdmin() {
  let driverRows: Array<{ id: string; user_id: string | null; name: string; phone: string; status: string; profile_image_url: string | null; rating: number; rating_count: number; approval_status: string; branch_id: string | null; bank_name: string | null; bank_account_number: string | null; bank_account_holder: string | null; suspended_until: string | null; suspension_reason: string | null; created_at: string; updated_at: string }> = [];
  let applicationRows: Array<{ id: string; user_id: string; name: string; phone: string; branch_id: string | null; id_number: string | null; student_number: string | null; profile_photo_url: string | null; selfie_url: string | null; bank_name: string | null; bank_account_number: string | null; bank_account_holder: string | null; status: string; created_at: string; admin_notes: string | null }> = [];

  const [{ data: drivers, error: driversError }, { data: applications, error: applicationsError }] = await Promise.all([
    // include banking fields so admin UI can show full driver info
    supabaseAdmin
      .from("drivers")
      .select("id,user_id,name,phone,status,profile_image_url,rating,rating_count,branch_id,bank_name,bank_account_number,bank_account_holder,approval_status,suspended_until,suspension_reason,created_at,updated_at")
      .order("created_at", { ascending: false }),
    supabaseAdmin.from("driver_applications").select("id,user_id,name,phone,branch_id,id_number,student_number,profile_photo_url,selfie_url,bank_name,bank_account_number,bank_account_holder,status,created_at,admin_notes").order("created_at", { ascending: false }),
  ]);

  if (driversError) {
    throw driversError;
  }
  if (applicationsError) {
    throw applicationsError;
  }

  driverRows = (drivers ?? []) as typeof driverRows;
  applicationRows = (applications ?? []) as typeof applicationRows;

  if (driverRows.length === 0) {
    return { drivers: driverRows, applications: applicationRows };
  }

  const userIds = driverRows.map((row) => row.user_id).filter(Boolean) as string[];
  let roleRows: Array<{ user_id: string; role: string }> = [];
  if (userIds.length > 0) {
    try {
      const { data } = await supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", userIds);
      roleRows = (data ?? []) as Array<{ user_id: string; role: string }>;
    } catch {
      roleRows = [];
    }
  }

  const roleMap = new Map<string, string[]>();
  for (const row of roleRows) {
    const list = roleMap.get(row.user_id) ?? [];
    list.push(row.role);
    roleMap.set(row.user_id, list);
  }

  const enrichedDrivers = driverRows.map((driver) => ({
    ...driver,
    approval_status: driver.approval_status === "suspended" && driver.suspended_until && new Date(driver.suspended_until).getTime() > Date.now()
      ? "suspended"
      : roleMap.get(driver.user_id ?? "")?.includes("driver") ? "approved" : driver.approval_status,
    roles: roleMap.get(driver.user_id ?? "") ?? [],
  }));

  return { drivers: enrichedDrivers, applications: applicationRows };
}

export const listDriversForAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({}).parse(input))
  .handler(async ({ context }) => {
    const accessRole = await resolveAccessRole(context);
    const isStaff = accessRole === "admin" || accessRole === "staff";
    if (!isStaff) throw new Response("Only staff can view driver directory", { status: 403 });

    const { drivers, applications } = await getVisibleDriversForAdmin();

    return {
      ok: true,
      drivers,
      applications,
    };
  });

export const getDriverProfileForCurrentUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({}).parse(input))
  .handler(async ({ context }) => {
    const uid = (context.userId as string | undefined | null) ?? (context.claims?.sub as string | undefined | null);
    if (!uid) return { ok: false, driver: null };

    const [{ data: driver }, { data: roleData }] = await Promise.all([
      supabaseAdmin
        .from("drivers")
        .select("id,name,phone,status,profile_image_url,rating,rating_count,branch_id,bank_name,bank_account_number,bank_account_holder,user_id,approval_status,suspended_until,suspension_reason")
        .eq("user_id", uid)
        .maybeSingle(),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", uid),
    ]);

    const roleNames = (roleData ?? []).map((row: { role?: string }) => row.role).filter(Boolean) as string[];
    if (driver?.approval_status === "suspended" && driver.suspended_until && new Date(driver.suspended_until).getTime() <= Date.now()) {
      await supabaseAdmin.from("drivers").update({ approval_status: "approved", suspended_at: null, suspended_until: null, suspension_reason: null } as never).eq("id", driver.id);
      driver.approval_status = "approved";
      driver.suspended_until = null;
      driver.suspension_reason = null;
    }
    const resolvedDriver = driver
      ? {
          ...driver,
          approval_status: driver.approval_status === "suspended" ? "suspended" : roleNames.includes("driver") ? "approved" : driver.status,
          roles: roleNames,
        }
      : null;

    return { ok: true, driver: resolvedDriver };
  });

export const grantRoleByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({
    email: z.string().email().transform((value) => value.trim().toLowerCase()),
    role: z.enum(["admin", "staff", "user", "driver"]),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const accessRole = await resolveAccessRole(context);
    if (accessRole !== "admin") {
      throw new Response("Only admins can grant access", { status: 403 });
    }

    const { data: grantData, error: grantError } = await context.supabase.rpc("grant_access_role", {
      _email: data.email,
      _role: data.role,
    });

    if (grantError) {
      throw grantError;
    }

    const result = (Array.isArray(grantData) ? grantData[0] : grantData) as
      | { out_user_id?: string; out_email?: string; out_role?: string }
      | null;
    await logServerAdminAction(context, {
      action_type: data.role === "admin" ? "admin_role_granted" : "user_role_updated",
      action_description: `Granted ${data.role} access to ${data.email}`,
      target_type: "user",
      target_id: result?.out_user_id ?? null,
      metadata: { email: data.email, role: data.role },
    });
    return {
      ok: true,
      user_id: result?.out_user_id ?? null,
      userId: result?.out_user_id ?? null,
      email: result?.out_email ?? data.email,
      role: result?.out_role ?? data.role,
    };
  });

export const adminUpsertDriverByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({
    email: z.string().email().transform((value) => value.trim().toLowerCase()),
    name: z.string().trim().min(1),
    phone: z.string().trim().min(1),
    branchId: z.string().uuid().nullable().optional(),
    bankName: z.string().trim().nullable().optional(),
    bankAccountNumber: z.string().trim().nullable().optional(),
    bankAccountHolder: z.string().trim().nullable().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const accessRole = await resolveAccessRole(context);
    if (accessRole !== "admin") {
      throw new Response("Only admins can add drivers", { status: 403 });
    }

    const { data: upsertData, error } = await context.supabase.rpc("admin_upsert_driver_by_email", {
      _email: data.email,
      _name: data.name,
      _phone: data.phone,
      _branch_id: data.branchId || undefined,
      _bank_name: data.bankName || undefined,
      _bank_account_number: data.bankAccountNumber || undefined,
      _bank_account_holder: data.bankAccountHolder || undefined,
    });
    if (error) throw error;
    const result = Array.isArray(upsertData) ? upsertData[0] : upsertData;
    await logServerAdminAction(context, {
      action_type: "driver_created_or_updated",
      action_description: `Created or updated driver ${data.name}`,
      target_type: "driver",
      target_id: (result as any)?.out_driver_id ?? null,
      metadata: { email: data.email, name: data.name, branch_id: data.branchId ?? null },
    });
    return { ok: true, ...result };
  });

export const requestDriverApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({
    name: z.string().trim().min(1),
    phone: z.string().trim().min(1),
    idNumber: z.string().trim().min(1).nullable().optional(),
    studentNumber: z.string().trim().nullable().optional(),
    profilePhotoUrl: z.string().trim().nullable().optional(),
    selfieUrl: z.string().trim().nullable().optional(),
    branchId: z.string().uuid().nullable().optional(),
    bankName: z.string().trim().nullable().optional(),
    bankAccountNumber: z.string().trim().nullable().optional(),
    bankAccountHolder: z.string().trim().nullable().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: appData, error } = await context.supabase.rpc("request_driver_application", {
      _name: data.name,
      _phone: data.phone,
      _id_number: data.idNumber || undefined,
      _student_number: data.studentNumber || undefined,
      _profile_photo_url: data.profilePhotoUrl || undefined,
      _selfie_url: data.selfieUrl || undefined,
      _branch_id: data.branchId || undefined,
      _bank_name: data.bankName || undefined,
      _bank_account_number: data.bankAccountNumber || undefined,
      _bank_account_holder: data.bankAccountHolder || undefined,
    });
    if (error) throw error;
    const result = Array.isArray(appData) ? appData[0] : appData;
    return { ok: true, ...result };
  });

export const approveDriverApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ applicationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const accessRole = await resolveAccessRole(context);
    if (accessRole !== "admin") {
      throw new Response("Only admins can approve driver requests", { status: 403 });
    }
    const { data: resultData, error } = await context.supabase.rpc("approve_driver_application", { _application_id: data.applicationId });
    if (error) throw error;
    const result = Array.isArray(resultData) ? resultData[0] : resultData;
    await logServerAdminAction(context, {
      action_type: "driver_approved",
      action_description: "Approved driver application",
      target_type: "driver_application",
      target_id: data.applicationId,
    });
    return { ok: true, ...result };
  });

export const rejectDriverApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ applicationId: z.string().uuid(), notes: z.string().trim().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const accessRole = await resolveAccessRole(context);
    if (accessRole !== "admin") {
      throw new Response("Only admins can reject driver requests", { status: 403 });
    }
    const { data: resultData, error } = await context.supabase.rpc("reject_driver_application", { _application_id: data.applicationId, _admin_notes: data.notes || undefined });
    if (error) throw error;
    const result = Array.isArray(resultData) ? resultData[0] : resultData;
    await logServerAdminAction(context, {
      action_type: "driver_rejected",
      action_description: "Rejected driver application",
      target_type: "driver_application",
      target_id: data.applicationId,
      metadata: { notes: data.notes ?? null },
    });
    return { ok: true, ...result };
  });

export const submitDeliveryPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ deliveryId: z.string().uuid(), reference: z.string().trim().min(1), proofPath: z.string().trim().nullable().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: resultData, error } = await context.supabase.rpc("submit_delivery_payment", {
      _delivery_id: data.deliveryId,
      _payment_reference: data.reference,
      _proof_path: data.proofPath || undefined,
    });
    if (error) throw error;
    const result = Array.isArray(resultData) ? resultData[0] : resultData;
    return { ok: true, ...result };
  });

export const confirmDeliveryPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ deliveryId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: resultData, error } = await context.supabase.rpc("confirm_delivery_payment", { _delivery_id: data.deliveryId });
    if (error) throw error;
    const result = Array.isArray(resultData) ? resultData[0] : resultData;
    return { ok: true, ...result };
  });
