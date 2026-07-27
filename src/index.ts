type Region = "north" | "central" | "isan" | "south" | "bangkok";
type Env = {
  DB: D1Database; SLIPS: R2Bucket; OCR_JOBS: Queue;
  ADMIN_PASSWORD?: string; CONFIG_ENCRYPTION_KEY?: string;
};
type RegionConfigRow = { region: Region; enabled: number; line_channel_secret: ArrayBuffer | null; line_channel_token: ArrayBuffer | null; ocrspace_api_key: ArrayBuffer | null };
type RegionConfig = { region: Region; enabled: boolean; lineSecret: string; lineToken: string; ocrKey: string };
const REGIONS: Region[] = ["north", "central", "isan", "south", "bangkok"];
const enc = new TextEncoder();
const dec = new TextDecoder();

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function b64(bytes: Uint8Array) { let s = ""; bytes.forEach((b) => s += String.fromCharCode(b)); return btoa(s); }
function unb64(text: string) { const s = atob(text); return Uint8Array.from(s, (c) => c.charCodeAt(0)); }
function today() { return new Date().toISOString().slice(0, 10); }
function isRegion(value: string): value is Region { return REGIONS.includes(value as Region); }
function cookie(request: Request, key: string) { return request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${key}=`))?.slice(key.length + 1); }

async function hmac(text: string, key: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(text))));
}
async function safeEqual(a: string, b: string) { return a.length === b.length && (await hmac(a, "compare")) === (await hmac(b, "compare")); }
async function cryptoKey(env: Env) {
  if (!env.CONFIG_ENCRYPTION_KEY) throw new Error("CONFIG_ENCRYPTION_KEY is not configured");
  const raw = unb64(env.CONFIG_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error("CONFIG_ENCRYPTION_KEY must be base64 encoded 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(value: string, env: Env): Promise<ArrayBuffer | null> {
  if (!value) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(env), enc.encode(value)));
  const all = new Uint8Array(iv.length + body.length); all.set(iv); all.set(body, iv.length); return all.buffer;
}
async function open(value: ArrayBuffer | null, env: Env) {
  if (!value) return "";
  const all = new Uint8Array(value); const iv = all.slice(0, 12); const body = all.slice(12);
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await cryptoKey(env), body));
}
async function config(env: Env, region: Region): Promise<RegionConfig> {
  const row = await env.DB.prepare("SELECT * FROM region_config WHERE region = ?").bind(region).first<RegionConfigRow>();
  if (!row) throw new Error("unknown region configuration");
  return { region, enabled: Boolean(row.enabled), lineSecret: await open(row.line_channel_secret, env), lineToken: await open(row.line_channel_token, env), ocrKey: await open(row.ocrspace_api_key, env) };
}
async function audit(env: Env, event: string, detail: string, region?: Region) { await env.DB.prepare("INSERT INTO audit_logs(region,event_type,detail) VALUES(?,?,?)").bind(region ?? null, event, detail.slice(0, 1000)).run(); }
async function usage(env: Env, region: Region, success: boolean) {
  await env.DB.prepare("INSERT INTO daily_usage(usage_date,region,provider,request_count,success_count,error_count) VALUES(?,?, 'ocrspace',1,?,?) ON CONFLICT(usage_date,region,provider) DO UPDATE SET request_count=request_count+1,success_count=success_count+excluded.success_count,error_count=error_count+excluded.error_count")
    .bind(today(), region, success ? 1 : 0, success ? 0 : 1).run();
}
async function lineCall(token: string, endpoint: string, body: unknown) {
  const response = await fetch(`https://api.line.me/v2/bot/${endpoint}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`LINE ${endpoint}: ${response.status}`);
}
function quickReply() { return { items: [{ type: "action", action: { type: "message", label: "ส่งเลขงาน", text: "เลขงาน" } }] }; }
async function replyText(token: string, replyToken: string, text: string) { await lineCall(token, "message/reply", { replyToken, messages: [{ type: "text", text, quickReply: quickReply() }] }); }
async function pushPass(token: string, to: string, job: string) {
  await lineCall(token, "message/push", { to, messages: [{ type: "flex", altText: `งาน ${job}: ผ่าน`, contents: { type: "bubble", body: { type: "box", layout: "vertical", contents: [{ type: "text", text: "ตรวจสอบผ่าน", weight: "bold", size: "xl", color: "#16803c" }, { type: "text", text: `เลขงาน ${job}`, margin: "md" }, { type: "text", text: "พบ KPLUS / SETTLEMENT และยอด 1.22", size: "sm", color: "#666666", margin: "md", wrap: true }] } } }] });
}
async function validSignature(raw: string, signature: string | null, secret: string) { return Boolean(signature) && await safeEqual(await hmac(raw, secret), signature!); }

async function webhook(request: Request, env: Env, region: Region, ctx: ExecutionContext) {
  let c: RegionConfig;
  try { c = await config(env, region); } catch { return json({ error: "control secrets not initialized" }, 503); }
  if (!c.enabled || !c.lineSecret || !c.lineToken || !c.ocrKey) return json({ error: "region is not configured" }, 503);
  const raw = await request.text();
  if (!(await validSignature(raw, request.headers.get("x-line-signature"), c.lineSecret))) { await audit(env, "signature_invalid", "LINE signature rejected", region); return new Response("Unauthorized", { status: 401 }); }
  const payload = JSON.parse(raw) as { events?: Array<any> };
  for (const event of payload.events ?? []) {
    if (event.type !== "message" || event.source?.type !== "user") continue;
    const userId = event.source.userId as string;
    if (event.message?.type === "text") {
      const job = String(event.message.text ?? "").trim();
      if (!/^\d{8}$/.test(job)) { ctx.waitUntil(replyText(c.lineToken, event.replyToken, "กรุณาส่งเลขงาน 8 หลัก แล้วส่งรูปสลิป")); continue; }
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO user_jobs(id,region,line_user_id,job_number,status) VALUES(?,?,?,?, 'awaiting_image') ON CONFLICT(region,line_user_id,job_number) DO UPDATE SET status='awaiting_image',updated_at=CURRENT_TIMESTAMP")
        .bind(id, region, userId, job).run();
      await audit(env, "job_received", job, region);
      ctx.waitUntil(replyText(c.lineToken, event.replyToken, `รับเลขงาน ${job} แล้ว กรุณาส่งรูปสลิป`));
      continue;
    }
    if (event.message?.type !== "image") continue;
    const parent = await env.DB.prepare("SELECT id,job_number FROM user_jobs WHERE region=? AND line_user_id=? AND status='awaiting_image' ORDER BY updated_at DESC LIMIT 1").bind(region, userId).first<{ id: string; job_number: string }>();
    if (!parent) { ctx.waitUntil(replyText(c.lineToken, event.replyToken, "กรุณาส่งเลขงาน 8 หลักก่อนส่งรูป")); continue; }
    const content = await fetch(`https://api-data.line.me/v2/bot/message/${event.message.id}/content`, { headers: { authorization: `Bearer ${c.lineToken}` } });
    if (!content.ok || !content.body) { await audit(env, "line_image_download_failed", String(content.status), region); continue; }
    const id = crypto.randomUUID(); const r2Key = `${region}/${today()}/${id}.jpg`;
    await env.SLIPS.put(r2Key, content.body, { httpMetadata: { contentType: content.headers.get("content-type") ?? "image/jpeg" } });
    await env.DB.prepare("INSERT INTO slip_jobs(id,region,parent_job_id,line_message_id,line_user_id,r2_key) VALUES(?,?,?,?,?,?)").bind(id, region, parent.id, event.message.id, userId, r2Key).run();
    await env.DB.prepare("UPDATE user_jobs SET status='image_queued',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(parent.id).run();
    await env.OCR_JOBS.send({ id, region });
    await audit(env, "image_queued", parent.job_number, region);
    ctx.waitUntil(replyText(c.lineToken, event.replyToken, "รับรูปแล้ว กำลังตรวจสอบ"));
  }
  return new Response("OK");
}

export function classify(text: string) {
  const upper = text.toUpperCase();
  if (!upper.includes("KPLUS") || !upper.includes("SETTLEMENT")) return "silent";
  return /(^|[^0-9])-?1\.22([^0-9]|$)/.test(text) ? "passed" : "needs_fallback";
}
async function processJob(env: Env, data: { id: string; region: Region }) {
  const row = await env.DB.prepare("SELECT s.*,u.job_number FROM slip_jobs s JOIN user_jobs u ON u.id=s.parent_job_id WHERE s.id=? AND s.region=?").bind(data.id, data.region).first<any>();
  if (!row || row.status !== "queued") return;
  const c = await config(env, data.region); if (!c.enabled || !c.ocrKey || !c.lineToken) throw new Error("region configuration unavailable");
  const object = await env.SLIPS.get(row.r2_key); if (!object || !("body" in object) || !object.body) throw new Error("image missing from R2");
  const form = new FormData();
  form.append("apikey", c.ocrKey); form.append("language", "eng"); form.append("isOverlayRequired", "false");
  form.append("file", await new Response(object.body).blob(), "slip.jpg");
  const response = await fetch("https://api.ocr.space/parse/image", { method: "POST", body: form });
  const payload = await response.json<any>().catch(() => ({}));
  const text = (payload.ParsedResults ?? []).map((v: any) => v.ParsedText ?? "").join("\n");
  const succeeded = response.ok && !payload.IsErroredOnProcessing;
  await usage(env, data.region, succeeded);
  if (!succeeded) { await env.DB.prepare("UPDATE slip_jobs SET status='ocr_error',ocr_provider='ocrspace',ocr_text=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(String(payload.ErrorMessage ?? response.status), row.id).run(); await audit(env, "ocr_error", String(payload.ErrorMessage ?? response.status), data.region); return; }
  const result = classify(text);
  await env.DB.prepare("UPDATE slip_jobs SET status=?,ocr_provider='ocrspace',ocr_text=?,result=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(result, text.slice(0, 10000), result, row.id).run();
  if (result === "passed") {
    const changed = await env.DB.prepare("UPDATE slip_jobs SET replied_at=CURRENT_TIMESTAMP WHERE id=? AND replied_at IS NULL").bind(row.id).run();
    if ((changed.meta.changes ?? 0) === 1) await pushPass(c.lineToken, row.line_user_id, row.job_number);
  }
  await audit(env, `ocr_${result}`, row.job_number, data.region);
}

function dashboardHtml() { return `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kplusall Control</title><style>body{font:16px system-ui;margin:2rem;background:#f5f7fb;color:#172033}main{max-width:980px;margin:auto}fieldset{background:white;border:1px solid #d9dfeb;border-radius:10px;margin:1rem 0;padding:1rem}input{width:100%;box-sizing:border-box;margin:.35rem 0;padding:.65rem}button{padding:.65rem 1rem;background:#1466d9;color:white;border:0;border-radius:6px;cursor:pointer}.muted{color:#657084;font-size:.9rem}</style><main><h1>Kplusall Control</h1><p class="muted">ค่า Secret ที่บันทึกแล้วจะไม่ถูกแสดงกลับมา ใส่เฉพาะค่าที่ต้องการเปลี่ยน</p><div id="app">Loading…</div></main><script>const regions=['north','central','isan','south','bangkok'];async function load(){let r=await fetch('/admin/api/config');if(!r.ok){location='/admin';return}let d=await r.json();document.querySelector('#app').innerHTML=regions.map(x=>{let a=d.find(v=>v.region===x)||{enabled:false};return '<fieldset><h2>'+x+'</h2><label><input type="checkbox" id="e-'+x+'" '+(a.enabled?'checked':'')+'> เปิดใช้งาน</label><input id="s-'+x+'" placeholder="LINE Channel Secret (ใส่เมื่อเปลี่ยน)"><input id="t-'+x+'" placeholder="LINE Channel Access Token (ใส่เมื่อเปลี่ยน)"><input id="o-'+x+'" placeholder="OCR.space API Key (ใส่เมื่อเปลี่ยน)"><button onclick="save(\''+x+'\')">บันทึก '+x+'</button><p class="muted">Secret: '+(a.hasLineSecret?'ตั้งแล้ว':'ยังไม่ตั้ง')+' · Token: '+(a.hasLineToken?'ตั้งแล้ว':'ยังไม่ตั้ง')+' · OCR: '+(a.hasOcrKey?'ตั้งแล้ว':'ยังไม่ตั้ง')+'</p></fieldset>'}).join('')}async function save(region){let b={region,enabled:document.querySelector('#e-'+region).checked,lineSecret:document.querySelector('#s-'+region).value,lineToken:document.querySelector('#t-'+region).value,ocrKey:document.querySelector('#o-'+region).value};let r=await fetch('/admin/api/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});alert(r.ok?'บันทึกแล้ว':await r.text());if(r.ok)load()}load()</script></html>`; }
function loginHtml() { return `<!doctype html><meta charset="utf-8"><title>Kplusall Login</title><form method="post" action="/admin/login" style="max-width:360px;margin:8rem auto;font:16px system-ui"><h1>Kplusall Control</h1><input name="password" type="password" placeholder="Admin password" required style="width:100%;padding:12px;box-sizing:border-box"><button style="margin-top:12px;padding:12px">Login</button></form>`; }
async function admin(request: Request, env: Env, url: URL) {
  if (!env.ADMIN_PASSWORD || !env.CONFIG_ENCRYPTION_KEY) return new Response("Admin setup required: set ADMIN_PASSWORD and CONFIG_ENCRYPTION_KEY as Worker Secrets.", { status: 503 });
  if (url.pathname === "/admin/login" && request.method === "POST") { const form = await request.formData(); if (!(await safeEqual(String(form.get("password") ?? ""), env.ADMIN_PASSWORD))) return new Response("Unauthorized", { status: 401 }); const payload = `${Date.now() + 8 * 3600_000}`; const token = `${b64(enc.encode(payload))}.${await hmac(payload, env.CONFIG_ENCRYPTION_KEY)}`; return new Response(null, { status: 303, headers: { location: "/admin", "set-cookie": `kplusall_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800` } }); }
  const token = cookie(request, "kplusall_admin"); const [body, sig] = token?.split(".") ?? []; const payload = body ? dec.decode(unb64(body)) : "";
  if (!sig || !(await safeEqual(sig, await hmac(payload, env.CONFIG_ENCRYPTION_KEY))) || Number(payload) < Date.now()) return new Response(loginHtml(), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
  if (url.pathname === "/admin/api/config" && request.method === "GET") { const rows = await env.DB.prepare("SELECT region,enabled,line_channel_secret,line_channel_token,ocrspace_api_key FROM region_config ORDER BY region").all<RegionConfigRow>(); return json(rows.results.map((r) => ({ region:r.region, enabled:Boolean(r.enabled), hasLineSecret:Boolean(r.line_channel_secret), hasLineToken:Boolean(r.line_channel_token), hasOcrKey:Boolean(r.ocrspace_api_key) }))); }
  if (url.pathname === "/admin/api/config" && request.method === "POST") { const input = await request.json<any>(); if (!isRegion(input.region)) return json({ error:"invalid region" }, 400); const old = await config(env,input.region); const secret = input.lineSecret ? await seal(String(input.lineSecret),env) : await seal(old.lineSecret,env); const tokenValue = input.lineToken ? await seal(String(input.lineToken),env) : await seal(old.lineToken,env); const key = input.ocrKey ? await seal(String(input.ocrKey),env) : await seal(old.ocrKey,env); await env.DB.prepare("UPDATE region_config SET enabled=?,line_channel_secret=?,line_channel_token=?,ocrspace_api_key=?,updated_at=CURRENT_TIMESTAMP WHERE region=?").bind(input.enabled?1:0,secret,tokenValue,key,input.region).run(); await audit(env,"config_updated","admin config updated",input.region); return json({ ok:true }); }
  return new Response(dashboardHtml(), { headers:{ "content-type":"text/html; charset=utf-8", "cache-control":"no-store" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/webhook/")) { const region = url.pathname.split("/")[2]; if (!isRegion(region) || request.method !== "POST") return new Response("Not Found", { status:404 }); return webhook(request, env, region, ctx); }
    if (url.pathname.startsWith("/admin")) return admin(request, env, url);
    if (url.pathname === "/health") return json({ ok:true, service:"kplusall" });
    return new Response("Kplusall Worker", { status:200 });
  },
  async queue(batch, env) { for (const message of batch.messages) { try { await processJob(env, message.body as { id:string; region:Region }); message.ack(); } catch (error) { await audit(env,"queue_error",error instanceof Error ? error.message : String(error)); message.retry(); } } }
} satisfies ExportedHandler<Env>;
