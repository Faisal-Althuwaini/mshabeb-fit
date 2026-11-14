-- Faisal (2026-11-14): watchers may see body measurements too (read-only). D24.
drop policy if exists body_measurements_watch on public.body_measurements;
create policy body_measurements_watch on public.body_measurements for select to authenticated
  using (public.can_view(user_id));
