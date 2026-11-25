// Cloudflare Pages Function: meneruskan /api/app/* ke API bot.
// Browser memanggil same-origin (/api/app/...), jadi tidak perlu CORS dan alamat server bot tidak terlihat pengguna.
//
// Environment (Cloudflare Pages > Settings > Variables and Secrets):
//   BOT_API_ORIGIN  (wajib)    alamat dasar API bot, mis. https://api.domainanda.com   (tanpa garis miring di akhir)
//   PROXY_SECRET    (disarankan, Secret) harus SAMA dengan config.json bot > sewa > webapp_proxy_secret
//
// Diagnosa: buka https://<situs-anda>/api/app/health  -> {"ok":true,...} bila bot terjangkau dari Cloudflare.

const ALLOWED = new Set([
  "me", "hist", "launch", "ubot.stop",
  "dep.create", "dep.get", "dep.status", "dep.cancel",
  "rent.buy", "txt.set", "txt.del", "bc.start", "bc.stop",
  "adm.overview", "adm.acc.list", "adm.acc.act", "adm.acc.add", "adm.groups.get", "adm.groups.upload", "adm.joinall", "adm.limit.run",
  "adm.rent.list", "adm.rent.act", "adm.user.get", "adm.user.saldo", "adm.user.ban", "adm.settings.get", "adm.settings.set", "adm.cmds",
]);
const MAX_BODY = 300 * 1024; // unggah daftar grup (adm.groups.upload) bisa ratusan KB; bot membatasi aksi lain ke 64 KB
const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const out = (status, obj) => new Response(JSON.stringify(obj), { status, headers: HEADERS });

export async function onRequest({ request, env, params }) {
  const action = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  const origin = String(env.BOT_API_ORIGIN || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(origin)) return out(500, { ok: false, error: "BOT_API_ORIGIN belum diatur di Cloudflare Pages." });

  if (action === "health" && request.method === "GET") {
    try {
      const r = await fetch(origin + "/health", { signal: AbortSignal.timeout(8000) });
      return out(r.ok ? 200 : 502, { ok: r.ok, bot: r.status });
    } catch (e) {
      return out(502, { ok: false, error: "Bot tidak bisa dihubungi dari Cloudflare: " + String((e && e.message) || e).slice(0, 120) });
    }
  }

  if (request.method !== "POST") return out(405, { ok: false, error: "Metode tidak diizinkan" });
  if (!ALLOWED.has(action)) return out(404, { ok: false, error: "Aksi tidak dikenal" });

  const initData = request.headers.get("X-Telegram-Init-Data") || "";
  if (!initData || initData.length > 4096) return out(401, { ok: false, error: "Buka halaman ini lewat bot Telegram." });

  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) return out(413, { ok: false, error: "Permintaan terlalu besar." });
  const body = await request.text();
  if (body.length > MAX_BODY) return out(413, { ok: false, error: "Permintaan terlalu besar." });

  let res;
  try {
    res = await fetch(`${origin}/api/app/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": initData,
        ...(env.PROXY_SECRET ? { "X-Proxy-Secret": String(env.PROXY_SECRET) } : {}),
      },
      body,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return out(502, { ok: false, error: "Server bot tidak bisa dihubungi. Coba lagi sebentar lagi." });
  }
  const text = await res.text();
  try {
    JSON.parse(text);
  } catch (_) {
    return out(502, { ok: false, error: "Respons tidak valid dari server bot." });
  }
  return new Response(text, { status: res.status, headers: HEADERS });
}
