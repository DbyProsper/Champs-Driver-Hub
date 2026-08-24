import { supabase } from "@/integrations/supabase/client";

export type AccessRole = "admin" | "staff" | "driver" | null;

function normalizeRole(value: unknown): AccessRole {
  if (typeof value !== "string") return null;
  const role = value.toLowerCase();
  if (role === "admin") return "admin";
  if (role === "staff") return "staff";
  if (role === "driver") return "driver";
  return null;
}

function getAdminEmails(): string[] {
  const envValue = (import.meta.env?.VITE_ADMIN_EMAILS as string | undefined) ?? "";
  return envValue
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveUserContext(userId?: string | null) {
  const fallbackUserId = userId ?? null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUserId = sessionData.session?.user?.id ?? null;
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const activeUserId = userData?.user?.id ?? sessionUserId ?? fallbackUserId;

    if (userData?.user || activeUserId) {
      return {
        activeUserId,
        user: userData?.user ?? null,
        userError,
      };
    }

    if (attempt < 3) {
      await wait(250);
    }
  }

  return {
    activeUserId: fallbackUserId,
    user: null,
    userError: null,
  };
}

export async function getAccessRole(userId?: string | null): Promise<AccessRole> {
  if (!userId) {
    const resolved = await resolveUserContext();
    if (!resolved.activeUserId) return null;
    userId = resolved.activeUserId;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { activeUserId, user, userError } = await resolveUserContext(userId);
    if (!activeUserId) {
      if (attempt < 3) {
        await wait(250);
        continue;
      }
      return null;
    }
    const email = user?.email?.toLowerCase() ?? "";
    const adminEmails = getAdminEmails();

    const [{ data: roles, error: rolesError }, { data: myRole, error: myRoleError }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", activeUserId),
      supabase.rpc("get_my_access_role"),
    ]);

    if (rolesError) console.warn("[roles] failed to read roles", rolesError.message);
    if (myRoleError) console.warn("[roles] failed to read access role", myRoleError.message);

    const found = (roles ?? []).map((role) => normalizeRole(role.role)).filter(Boolean) as AccessRole[];
    const databaseRole = normalizeRole(myRole);
    const metadataRole = normalizeRole(user?.app_metadata?.role);
    const metadataRoles = (user?.app_metadata?.roles ?? []) as unknown[];
    const metadataRoleFromArray = metadataRoles.map((role) => normalizeRole(role)).find(Boolean);
    const metadataFlags = [
      user?.app_metadata?.is_admin,
    ];
    const isAdminByMetadata = metadataFlags.some((value) => value === true || value === "true" || value === "admin");
    const isAdminByEmail = adminEmails.length > 0 && email.length > 0 && adminEmails.includes(email);

    if (databaseRole === "admin" || found.includes("admin") || metadataRole === "admin" || metadataRoleFromArray === "admin" || isAdminByMetadata || isAdminByEmail) return "admin";
    if (databaseRole === "staff" || found.includes("staff") || metadataRole === "staff" || metadataRoleFromArray === "staff") return "staff";

    if (activeUserId) {
      const { data: driverRow, error: driverError } = await supabase.from("drivers").select("id").eq("user_id", activeUserId).maybeSingle();
      if (driverRow && !driverError) return "driver";
    }

    if (databaseRole === "driver" || found.includes("driver") || metadataRole === "driver" || metadataRoleFromArray === "driver") return "driver";

    if (userError || attempt < 3) {
      await wait(250);
      continue;
    }

    break;
  }

  return null;
}

export async function isStaffOrAdmin(userId?: string | null): Promise<boolean> {
  const role = await getAccessRole(userId);
  return role === "admin" || role === "staff";
}
