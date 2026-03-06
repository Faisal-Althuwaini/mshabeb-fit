// Supabase Edge Function: يرسل طلباً لرابط تطبيقك على Render كل بضع دقائق
// حتى لا يوقف Render الخدمة بعد 10 دقائق بدون طلبات (Free tier).
// أضف Cron Trigger في Dashboard: Edge Functions → ping-render → Cron: "*/5 * * * *" (كل 5 دقائق)

import "jsr:@supabase/functionsjs/edge-runtime.d.ts";

const RENDER_APP_URL = Deno.env.get("RENDER_APP_URL");

Deno.serve(async (req: Request) => {
  if (!RENDER_APP_URL) {
    return new Response(
      JSON.stringify({ ok: false, error: "RENDER_APP_URL not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  try {
    const res = await fetch(`${RENDER_APP_URL.replace(/\/$/, "")}/health`, {
      method: "GET",
      headers: { "User-Agent": "Supabase-Cron-KeepAlive/1" },
    });
    const ok = res.ok;
    return new Response(
      JSON.stringify({ ok, status: res.status, url: RENDER_APP_URL }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
