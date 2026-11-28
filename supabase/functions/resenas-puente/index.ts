// ELIO by FlexGo Group · Función «resenas-puente» (Supabase Edge Function, Deno). Verify JWT APAGADO: la autoriza la firma.
// La usa la Consola de FlexGo (Consola › Reseñas), que primero comprueba que quien pide es el Dueño y luego firma.
// El navegador nunca ve el secreto.
//   Cabeceras: x-puente-ts (ms) y x-puente-firma = hex(HMAC-SHA256(RESENAS_PUENTE_SECRETO, ts + "." + cuerpo)). Margen de ±5 min.
//   { accion: "listar", estado: "pendiente"|"aprobada"|"rechazada"|"todas" }
//       → { ok, resenas: [{ id, estrellas, texto, nombre, plan, estado, publicar, fecha, correo_vista }] } (máx. 100, más recientes primero)
//   { accion: "moderar", id, estado: "aprobada"|"rechazada", motivo? } → { ok }
//   { accion: "por_cobrar" } → formato común R-190 { ok, producto: "elio", generado, items: [...] }
// Secreto (lo pone el usuario en Edge Functions › Secrets): RESENAS_PUENTE_SECRETO. Nunca en el código.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRETO = Deno.env.get("RESENAS_PUENTE_SECRETO") ?? "";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const r = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function firmar(ts: string, cuerpo: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRETO), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const f = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(ts + "." + cuerpo));
  return [...new Uint8Array(f)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function igual(a: string, b: string) {   // comparación en tiempo constante
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// «an***@gmail.com»: solo las 2 primeras letras y el dominio
function taparCorreo(c?: string | null) {
  if (!c || !c.includes("@")) return null;
  const [u, d] = c.split("@");
  return `${u.slice(0, 2)}***@${d}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return r(405, { ok: false, motivo: "metodo" });
  if (!SECRETO) return r(503, { ok: false, motivo: "sin_configurar" });
  const ts = req.headers.get("x-puente-ts") ?? "", firma = (req.headers.get("x-puente-firma") ?? "").toLowerCase();
  const cuerpo = await req.text();
  if (cuerpo.length > 4000) return r(400, { ok: false, motivo: "invalido" });
  if (!/^\d{13}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > 5 * 60_000) return r(401, { ok: false, motivo: "tiempo" });
  if (!igual(await firmar(ts, cuerpo), firma)) return r(401, { ok: false, motivo: "firma" });
  let b: Record<string, unknown>;
  try { b = JSON.parse(cuerpo); } catch { return r(400, { ok: false, motivo: "invalido" }); }

  if (b.accion === "listar") {
    const estado = String(b.estado ?? "todas");
    if (!["pendiente", "aprobada", "rechazada", "todas"].includes(estado)) return r(400, { ok: false, motivo: "invalido" });
    let q = admin.from("resenas").select("usuario,estrellas,texto,nombre_publico,plan,estado,actualizado,moderado").order("actualizado", { ascending: false }).limit(100);
    if (estado !== "todas") q = q.eq("estado", estado);
    const { data, error } = await q;
    if (error) return r(500, { ok: false, motivo: "error" });
    const resenas = [];
    for (const x of data ?? []) {
      const { data: u } = await admin.auth.admin.getUserById(x.usuario);
      resenas.push({
        id: x.usuario, estrellas: x.estrellas, texto: x.texto, nombre: x.nombre_publico, plan: x.plan, estado: x.estado,
        publicar: true,   // Elio exige el permiso de publicar para guardar la reseña
        fecha: x.actualizado, correo_vista: taparCorreo(u?.user?.email),
      });
    }
    return r(200, { ok: true, resenas });
  }

  if (b.accion === "moderar") {
    const id = String(b.id ?? ""), estado = String(b.estado ?? "");
    if (!UUID.test(id) || !["aprobada", "rechazada"].includes(estado)) return r(400, { ok: false, motivo: "invalido" });
    const { data, error } = await admin.from("resenas").update({ estado, moderado: new Date().toISOString() }).eq("usuario", id).select("usuario");
    if (error) return r(500, { ok: false, motivo: "error" });
    if (!data?.length) return r(404, { ok: false, motivo: "no_existe" });
    return r(200, { ok: true });
  }

  // Lista común «Por cobrar» (R-190): por vencer, vencidos, pausados y recuperados. Sin celular, id ni comprobante.
  if (b.accion === "por_cobrar") {
    const { data, error } = await admin.rpc("elio_puente_por_cobrar");
    if (error) return r(500, { ok: false, motivo: "error" });
    return r(200, data);
  }

  return r(400, { ok: false, motivo: "invalido" });
});
