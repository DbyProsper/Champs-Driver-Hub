-- Trigger functions execute through their triggers only; they are not RPCs.
revoke all on function public.audit_critical_change() from public, anon, authenticated;
revoke all on function public.notify_new_complaint() from public, anon, authenticated;
revoke all on function public.notify_complaint_update() from public, anon, authenticated;
revoke all on function public.champs_driver_system_message() from public, anon, authenticated;
revoke all on function public.champs_driver_account_message() from public, anon, authenticated;

-- Keep one copy of the audit actor index.
drop index if exists public.idx_audit_logs_dda3f2d23239927dfc9988a6c1b1a78d;
