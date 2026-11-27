// ELIO · Guardia de privacidad (manual EL-SEG-001 v1.0, cap. 03-04 y 14.3). Se copia igual en elio-chat y elio-biblioteca
// (el panel de Supabase despliega un archivo por función) y su versión JS está en web/app.js (taparSecretosWeb).
// Tapa ANTES de enviar a la IA y ANTES de guardar: claves, tokens, llaves privadas, contraseñas, códigos OTP,
// tarjetas (con Luhn), CVV, CCI y cuentas, y documentos de identidad con su palabra clave. NO toca nombres ni datos comunes
// (Elio es un chat general). Devuelve el texto tapado y las categorías halladas (nunca los valores).
export type Hallazgo = "secreto" | "contrasena" | "codigo" | "tarjeta" | "cuenta" | "documento";
const luhn = (d: string) => {
  let s = 0, par = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (par) { n *= 2; if (n > 9) n -= 9; } s += n; par = !par; }
  return s % 10 === 0;
};
export function taparSecretos(texto: string): { texto: string; hallados: Hallazgo[] } {
  const h = new Set<Hallazgo>();
  let t = String(texto ?? "");
  const tapar = (re: RegExp, tipo: Hallazgo, rep: string | ((...a: string[]) => string)) => {
    t = t.replace(re, (...a: string[]) => {
      if (/\[(SECRETO_ELIMINADO|DOCUMENTO)\]["'»]?$/.test(a[0])) return a[0];   // ya estaba tapado (p. ej. por la web): no se cuenta de nuevo
      h.add(tipo); return typeof rep === "string" ? rep : rep(...a);
    });
  };
  // Llaves privadas y tokens con formato conocido
  tapar(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "secreto", "[SECRETO_ELIMINADO]");
  tapar(/\b(sk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, "secreto", "[SECRETO_ELIMINADO]");
  tapar(/\b((?:api[ _-]?key|apikey|access[ _-]?token|secret|token|clave api|clave secreta|service_role)\s*[:=]\s*["']?)([^\s"']{12,})/gi, "secreto", (_m, a) => a + "[SECRETO_ELIMINADO]");
  // Contraseñas y PIN con su palabra clave
  // «contraseña: X» o «clave = X» siempre; «mi clave es X» solo si X tiene números o símbolos (para no tapar «la clave es estudiar»)
  tapar(/\b((?:contrase[ñn]a|password|passwd|clave|pin)(?:\s+(?:de|del|mi|tu|su|actual|nueva|[a-záéíóúñ]+)){0,3}\s*[:=]\s*["'«]?)([^\s"'»,;]{4,64})/gi, "contrasena", (_m, a) => a + "[SECRETO_ELIMINADO]");
  tapar(/\b((?:contrase[ñn]a|password|passwd|clave|pin)(?:\s+(?:de|del|mi|tu|su|actual|nueva|[a-záéíóúñ]+)){0,3}\s+(?:es|era|sería)\s+["'«]?)((?=[^\s"'»,;]*[\d@#$%&*!?_.+-])[^\s"'»,;]{4,64})/gi, "contrasena", (_m, a) => a + "[SECRETO_ELIMINADO]");
  // Códigos de verificación (OTP) y CVV
  tapar(/\b((?:c[oó]digo|token|otp)(?:\s+(?:de|del))?(?:\s+(?:verificaci[oó]n|seguridad|sms|acceso|confirmaci[oó]n|yape|whatsapp))+\s*(?:[:=]|es)?\s*)(\d{4,8})\b/gi, "codigo", (_m, a) => a + "[SECRETO_ELIMINADO]");
  tapar(/\b((?:cvv|cvc|cvv2)\s*[:=]?\s*)(\d{3,4})\b/gi, "tarjeta", (_m, a) => a + "[SECRETO_ELIMINADO]");
  // Tarjetas: 13 a 19 dígitos (con espacios o guiones) que pasan Luhn
  t = t.replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => { const d = m.replace(/\D/g, ""); if (d.length >= 13 && d.length <= 19 && luhn(d)) { h.add("tarjeta"); return "[SECRETO_ELIMINADO]"; } return m; });
  // CCI (20 dígitos) y cuentas bancarias con su palabra clave
  tapar(/\b((?:cci|cuenta(?:\s+(?:de\s+)?(?:ahorros?|corriente|bancaria|interbancaria))?|n[°º.]?\s*de\s*cuenta|nro\.?\s*de\s*cuenta)\s*(?:n[°º.]?|nro\.?|número)?\s*[:=]?\s*)(\d[\d -]{8,24}\d)/gi, "cuenta", (_m, a) => a + "[SECRETO_ELIMINADO]");
  tapar(/\b\d{20}\b/g, "cuenta", "[SECRETO_ELIMINADO]");
  // Documentos de identidad con su palabra clave (DNI 8, CE 9-12, pasaporte)
  tapar(/\b((?:dni|d\.n\.i\.?|documento de identidad|carn[eé] de extranjer[ií]a|c\.?e\.?|pasaporte)\s*(?:n[°º.]?|nro\.?|número|es)?\s*[:=]?\s*)([A-Z]{0,2}\d{8,12})\b/gi, "documento", (_m, a) => a + "[DOCUMENTO]");
  return { texto: t, hallados: [...h] };
}
// Canario sintético: si aparece en una salida, alguien logró extraer instrucciones internas.
export const CANARIO = "ELIO-CANARIO-7Q2X-NO-REVELAR";
