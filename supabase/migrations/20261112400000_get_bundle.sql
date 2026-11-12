-- One round trip for everything a feed/progress screen needs (the project is far from Riyadh,
-- so 9 parallel requests meant waiting for the slowest of 9). SECURITY INVOKER: RLS applies
-- exactly as for the individual selects (owner sees all; a watcher sees what they may see).
create or replace function public.get_bundle(p_owner bigint)
returns jsonb
language sql stable security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object('date', w.recorded_at, 'weight', w.weight) order by w.recorded_at)
                         from weight_entries w where w.user_id = p_owner), '[]'::jsonb),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('day', c.day, 'minimum_done', c.minimum_done, 'lifted', c.lifted, 'workout_label', c.workout_label) order by c.day)
                        from daily_checks c where c.user_id = p_owner), '[]'::jsonb),
    'meals', coalesce((select jsonb_agg(to_jsonb(m) order by m.posted_at desc)
                       from (select * from meal_posts where user_id = p_owner order by posted_at desc limit 300) m), '[]'::jsonb),
    'flex', coalesce((select jsonb_agg(to_jsonb(f) order by f.taken_on desc) from flex_photos f where f.user_id = p_owner), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc)
                        from (select * from feed_events where owner_user_id = p_owner order by created_at desc limit 50) e), '[]'::jsonb),
    'reactions', coalesce((select jsonb_agg(jsonb_build_object('owner_user_id', r.owner_user_id, 'item_kind', r.item_kind, 'item_ref', r.item_ref,
                             'author_auth_user_id', r.author_auth_user_id, 'emoji', r.emoji, 'created_at', r.created_at))
                           from feed_reactions r where r.owner_user_id = p_owner), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'owner_user_id', c.owner_user_id, 'item_kind', c.item_kind, 'item_ref', c.item_ref,
                            'author_auth_user_id', c.author_auth_user_id, 'author_name', c.author_name, 'body', c.body, 'created_at', c.created_at) order by c.created_at)
                          from feed_comments c where c.owner_user_id = p_owner), '[]'::jsonb),
    'views', coalesce((select jsonb_agg(to_jsonb(v)) from feed_views v where v.owner_user_id = p_owner), '[]'::jsonb),
    'watchers', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at) from watchers w where w.owner_user_id = p_owner), '[]'::jsonb)
  )
$$;
revoke all on function public.get_bundle(bigint) from public;
grant execute on function public.get_bundle(bigint) to authenticated;
