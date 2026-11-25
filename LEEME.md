# Elio by FlexGo Group · app (versión 1, 25-nov-2026)

Chat de IA con cuentas, planes **Libre · Impulso · Ultra**, cupos, pago por Yape y panel de administración.

## Partes
| Carpeta o archivo | Qué es |
|---|---|
| `web/` | La app que ve la gente (se publica en elio.flexgogroup.com con GitHub Pages) |
| `web/config.js` | Los 2 datos públicos de Supabase (URL y publishable key) |
| `supabase/1-esquema.sql` | Tablas, seguridad por fila, cupos y funciones de administración. Se ejecuta una vez |
| `supabase/functions/elio-chat/index.ts` | El «cerebro»: revisa el plan y los cupos, llama a Claude y transmite la respuesta |

## Modelos y cupos (aprobados el 25-nov)
| Modo | Modelo | Libre | Impulso (S/ 29.90) | Ultra (S/ 79.90) |
|---|---|---|---|---|
| ⚡ Rápido | Claude Haiku 5.5 (esfuerzo bajo) | 20 al día | 100 al día | 150 al día |
| 🧠 Razonamiento | Claude Haiku 5.5 (esfuerzo alto) | — | 300 al mes | 800 al mes |
| ★ Experto | Claude Sonnet 5.5 | — | — | 200 al mes |
| Archivos (imágenes y PDF) | | — | Sí | Sí |

Topes de seguridad: el plan Libre gasta como máximo US$ 1 al día entre todos los usuarios (TOPE_LIBRE_USD); el total, US$ 15 al día (TOPE_TOTAL_USD).
Costo estimado por mensaje (con margen ×2): Rápido ~US$ 0,0014 · Razonamiento ~US$ 0,004 · Experto ~US$ 0,028.

## Puesta en marcha (orden)
1. **El dueño** crea el proyecto «elio» en Supabase y pasa la Project URL y la publishable key → van en `web/config.js`.
2. **El dueño** pega `supabase/1-esquema.sql` en el SQL Editor y pulsa Run. Deben salir 6 filas en «true».
3. **El dueño** crea una clave de Anthropic solo para Elio (console.anthropic.com, con límite de gasto mensual) y la guarda en Supabase › Edge Functions › Secrets con el nombre `ANTHROPIC_API_KEY`.
4. Se despliega la función `elio-chat` (Edge Functions › Deploy a new function › Via Editor, o con la CLI de Supabase).
5. Authentication › URL Configuration: Site URL `https://elio.flexgogroup.com/` y en Redirect URLs `https://elio.flexgogroup.com/**`.
6. El dueño crea su cuenta en Elio. Después se le marca como administrador:
   `update public.perfiles set es_admin = true where id = (select id from auth.users where email = 'SU_CORREO');`
7. Se publica `web/` en GitHub Pages y se apunta `elio.flexgogroup.com` (registro CNAME en el cPanel).

## Probar sin base de datos
Ejecuta `python3 -m http.server 8790` dentro de `web/` y abre http://localhost:8790/?demo (modo demostración, solo en localhost).
