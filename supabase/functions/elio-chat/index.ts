// ELIO by FlexGo Group · Función del servidor «elio-chat» (Supabase Edge Function, Deno)
// Recibe el mensaje del usuario, revisa su plan y sus cupos, llama a Claude y devuelve la respuesta
// palabra por palabra (SSE). Guarda la conversación y suma el uso y el gasto.
//
// Secretos (Supabase › Edge Functions › Secrets; los pone el dueño, nunca van en el código):
//   ANTHROPIC_API_KEY   clave de Anthropic solo para Elio (con límite de gasto en console.anthropic.com)
// Opcionales: TOPE_LIBRE_USD (1), TOPE_TOTAL_USD (15), ORIGENES (lista separada por comas)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Nivel = "rapido" | "razonamiento" | "experto";
type Plan = "libre" | "impulso" | "ultra";

// Cupos cerrados por plan (aprobados el 25-nov-2026). null = no incluido.
const CUPOS: Record<Plan, { rapidoDia: number; razonamientoMes: number | null; expertoMes: number | null; adjuntos: boolean }> = {
  libre: { rapidoDia: 20, razonamientoMes: null, expertoMes: null, adjuntos: false },
  impulso: { rapidoDia: 100, razonamientoMes: 300, expertoMes: null, adjuntos: true },
  ultra: { rapidoDia: 150, razonamientoMes: 800, expertoMes: 200, adjuntos: true },
};

// Modelo por nivel. Precios en US$ por millón de tokens (entrada / salida).
const MODELOS: Record<Nivel, { model: string; effort: "low" | "medium" | "high"; maxTokens: number; pin: number; pout: number }> = {
  rapido: { model: "claude-haiku-5-5", effort: "low", maxTokens: 4000, pin: 0.1, pout: 0.5 },
  razonamiento: { model: "claude-haiku-5-5", effort: "high", maxTokens: 12000, pin: 0.1, pout: 0.5 },
  experto: { model: "claude-sonnet-5-5", effort: "medium", maxTokens: 16000, pin: 2, pout: 10 },
};

const TOPE_LIBRE = Number(Deno.env.get("TOPE_LIBRE_USD") ?? "1");
const TOPE_TOTAL = Number(Deno.env.get("TOPE_TOTAL_USD") ?? "15");
const ORIGENES = (Deno.env.get("ORIGENES") ?? "https://elio.flexgogroup.com,https://randomg-studio.github.io,http://localhost:8790")
  .split(",").map((s) => s.trim()).filter(Boolean);
const TIPOS_ADJUNTO = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

const SISTEMA = `Eres Elio, el asistente de inteligencia artificial de FlexGo Group, una empresa peruana de tecnología.
Hablas en el idioma de la persona (por defecto, español claro y cercano, sin jerga técnica innecesaria).
Ayudas a estudiantes (tareas, explicaciones paso a paso, idiomas, matemáticas, redacción) y a empresas y profesionales (correos, propuestas, análisis, ideas de negocio, Excel, marketing, código).
Reglas:
- Ve al grano. Usa formato Markdown (títulos cortos, listas, tablas, bloques de código) solo cuando ayude.
- Si no sabes algo o no estás seguro, dilo. No inventes datos, cifras, leyes ni fuentes.
- Para salud, temas legales o dinero, da información general y recomienda consultar a un profesional.
- Con estudiantes, explica el porqué para que aprendan; no solo des la respuesta.
- No pidas ni guardes contraseñas, números de tarjeta ni datos sensibles.
- Si te preguntan quién eres: «Soy Elio, la IA de FlexGo Group».`;

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function cors(origen: string | null): Record<string, string> {
  const ok = origen && ORIGENES.includes(origen) ? origen : ORIGENES[0];
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (c: Record<string, string>, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...c, "Content-Type": "application/json" } });

const hoyLima = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" })).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  const c = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: c });
  if (req.method !== "POST") return json(c, 405, { mensaje: "Método no permitido" });

  // 1. ¿Quién es?
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(jwt);
  const user = auth?.user;
  if (!user) return json(c, 401, { mensaje: "Inicia sesión para usar Elio." });

  // 2. Datos del pedido
  let cuerpo: { conversacion?: string; texto?: string; nivel?: Nivel; adjunto?: { tipo: string; nombre: string; datos: string } };
  try { cuerpo = await req.json(); } catch { return json(c, 400, { mensaje: "Pedido inválido." }); }
  const texto = String(cuerpo.texto ?? "").trim();
  const nivel: Nivel = (["rapido", "razonamiento", "experto"] as const).includes(cuerpo.nivel as Nivel) ? cuerpo.nivel as Nivel : "rapido";
  if (!texto && !cuerpo.adjunto) return json(c, 400, { mensaje: "Escribe un mensaje." });
  if (texto.length > 12000) return json(c, 400, { mensaje: "Tu mensaje es muy largo (máximo 12.000 caracteres)." });

  // 3. Plan y cupos
  const { data: plan } = await admin.rpc("elio_plan", { u: user.id });
  const P = CUPOS[(plan as Plan) ?? "libre"] ?? CUPOS.libre;
  const hoy = hoyLima(), mes = hoy.slice(0, 8) + "01";
  const { data: usos } = await admin.from("uso").select("dia,rapido,razonamiento,experto").eq("usuario", user.id).gte("dia", mes);
  const usoHoy = usos?.find((u) => u.dia === hoy) ?? { rapido: 0, razonamiento: 0, experto: 0 };
  const usoMes = (usos ?? []).reduce((a, u) => ({ razonamiento: a.razonamiento + u.razonamiento, experto: a.experto + u.experto }), { razonamiento: 0, experto: 0 });
  const nombrePlan = { libre: "Libre", impulso: "Impulso", ultra: "Ultra" }[(plan as Plan) ?? "libre"];

  if (nivel === "rapido" && usoHoy.rapido >= P.rapidoDia)
    return json(c, 429, { mensaje: `Usaste tus ${P.rapidoDia} mensajes de hoy del plan ${nombrePlan}. Vuelven mañana${plan === "ultra" ? "." : ", o sube de plan para tener más."}`, codigo: "cupo" });
  if (nivel === "razonamiento" && (P.razonamientoMes === null || usoMes.razonamiento >= P.razonamientoMes))
    return json(c, 429, { mensaje: P.razonamientoMes === null ? "El modo Razonamiento está en los planes Impulso y Ultra." : `Usaste tus ${P.razonamientoMes} mensajes de Razonamiento de este mes.`, codigo: "cupo" });
  if (nivel === "experto" && (P.expertoMes === null || usoMes.experto >= P.expertoMes))
    return json(c, 429, { mensaje: P.expertoMes === null ? "El modo Experto está en el plan Ultra." : `Usaste tus ${P.expertoMes} mensajes Expertos de este mes.`, codigo: "cupo" });
  if (cuerpo.adjunto && !P.adjuntos)
    return json(c, 403, { mensaje: "Subir archivos e imágenes está en los planes Impulso y Ultra.", codigo: "cupo" });

  // Topes de seguridad del día
  const { data: gasto } = await admin.from("gasto_dia").select("libre_usd,total_usd").eq("dia", hoy).maybeSingle();
  if (gasto && Number(gasto.total_usd) >= TOPE_TOTAL)
    return json(c, 503, { mensaje: "Elio está con mucha demanda en este momento. Inténtalo en unas horas." });
  if (plan === "libre" && gasto && Number(gasto.libre_usd) >= TOPE_LIBRE)
    return json(c, 503, { mensaje: "Los mensajes gratis de hoy se agotaron para todos. Vuelve mañana o pásate a Impulso.", codigo: "tope_libre" });

  // 4. Adjunto (imagen o PDF)
  let bloqueAdjunto: Anthropic.ContentBlockParam | null = null;
  if (cuerpo.adjunto) {
    const { tipo, datos, nombre } = cuerpo.adjunto;
    if (!TIPOS_ADJUNTO.includes(tipo)) return json(c, 400, { mensaje: "Solo se aceptan imágenes (PNG, JPG, WEBP, GIF) y PDF." });
    if (datos.length > 14_000_000) return json(c, 400, { mensaje: "El archivo es muy pesado (máximo unos 10 MB)." });
    bloqueAdjunto = tipo === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: datos }, title: String(nombre).slice(0, 100) }
      : { type: "image", source: { type: "base64", media_type: tipo as "image/png", data: datos } };
  }

  // 5. Conversación
  let convId = cuerpo.conversacion;
  if (convId) {
    const { data: conv } = await admin.from("conversaciones").select("id").eq("id", convId).eq("usuario", user.id).maybeSingle();
    if (!conv) convId = undefined;
  }
  if (!convId) {
    const titulo = (texto || cuerpo.adjunto?.nombre || "Nuevo chat").replace(/\s+/g, " ").slice(0, 60);
    const { data: nueva, error } = await admin.from("conversaciones").insert({ usuario: user.id, titulo }).select("id").single();
    if (error) return json(c, 500, { mensaje: "No se pudo crear la conversación." });
    convId = nueva.id;
  }
  const { data: previos } = await admin.from("mensajes").select("rol,contenido").eq("conversacion", convId).order("id", { ascending: false }).limit(16);
  const historial: Anthropic.MessageParam[] = (previos ?? []).reverse().map((m) => ({ role: m.rol as "user" | "assistant", content: m.contenido.slice(0, 20000) }));
  while (historial.length && historial[0].role !== "user") historial.shift();
  const contenido: Anthropic.ContentBlockParam[] = [];
  if (bloqueAdjunto) contenido.push(bloqueAdjunto);
  contenido.push({ type: "text", text: texto || "Analiza este archivo." });
  const mensajes: Anthropic.MessageParam[] = [...historial, { role: "user", content: contenido }];

  // 6. Llamar a Claude y transmitir
  const M = MODELOS[nivel];
  const fecha = new Date().toLocaleDateString("es-PE", { timeZone: "America/Lima", dateStyle: "full" });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const enviar = (o: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      enviar({ tipo: "conv", id: convId });
      let respuesta = "";
      try {
        const s = anthropic.messages.stream({
          model: M.model,
          max_tokens: M.maxTokens,
          output_config: { effort: M.effort },
          system: [
            { type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } },
            { type: "text", text: `Hoy es ${fecha} (hora de Perú). Plan del usuario: ${nombrePlan}.` },
          ],
          messages: mensajes,
        });
        for await (const ev of s) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            respuesta += ev.delta.text; enviar({ tipo: "texto", t: ev.delta.text });
          }
        }
        const final = await s.finalMessage();
        if (final.stop_reason === "refusal") {
          const aviso = "Prefiero no ayudar con eso. ¿Te ayudo con otra cosa?";
          if (!respuesta) { respuesta = aviso; enviar({ tipo: "texto", t: aviso }); }
        }
        if (final.stop_reason === "max_tokens") enviar({ tipo: "aviso", t: "La respuesta llegó al límite de largo. Escribe «continúa» para seguir." });
        const u = final.usage;
        const entrada = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
        const costo = (entrada * M.pin + (u.output_tokens ?? 0) * M.pout) / 1_000_000;
        // Guardar y sumar
        await admin.from("mensajes").insert([
          { conversacion: convId, usuario: user.id, rol: "user", contenido: texto || "(archivo)", nivel, adjunto: cuerpo.adjunto?.nombre ?? null },
          { conversacion: convId, usuario: user.id, rol: "assistant", contenido: respuesta || "…", nivel },
        ]);
        await admin.from("conversaciones").update({ actualizado: new Date().toISOString() }).eq("id", convId);
        await admin.rpc("elio_sumar_uso", { u: user.id, nivel, costo, es_libre: plan === "libre" || !plan });
        enviar({ tipo: "fin" });
      } catch (e) {
        console.error("elio-chat", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
        const msg = e instanceof Anthropic.RateLimitError ? "Hay mucha demanda. Espera unos segundos e inténtalo de nuevo."
          : e instanceof Anthropic.AuthenticationError ? "Elio está en mantenimiento. Inténtalo en un rato."
          : "No pude responder esta vez. Inténtalo de nuevo.";
        enviar({ tipo: "error", mensaje: msg });
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { ...c, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
});
