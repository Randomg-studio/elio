// ELIO by FlexGo Group · app web (chat, cuentas, planes y pago por Yape)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12.0.2/+esm';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/+esm';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const CFG = window.ELIO_CONFIG || {};
const DEMO = !CFG.SUPABASE_URL && location.hostname === 'localhost' && location.search.includes('demo');
const VOLVER = location.hostname === 'localhost' ? location.origin + '/' : CFG.SITIO;
const PRECIOS = { impulso: 56.99, ultra: 159.99 };   // con IGV incluido
const NOMBRE_PLAN = { libre: 'Libre', impulso: 'Impulso', ultra: 'Ultra' };
const MOTORES = { chispa: ['⚡ Chispa', 1], pulso: ['💡 Pulso', 2], orbita: ['🪐 Órbita', 10], cumbre: ['🏔️ Cumbre', 25] };
const MOTORES_PLAN = { invitado: ['chispa'], libre: ['chispa'], impulso: ['chispa', 'pulso', 'orbita'], ultra: ['chispa', 'pulso', 'orbita', 'cumbre'] };
// Motores que puede usar ahora (Libre: Órbita mientras le quede probadita)
const permitidosAhora = () => {
  if (E.invitado) return MOTORES_PLAN.invitado;
  const base = E.cred?.motores || MOTORES_PLAN[E.estado?.plan] || ['chispa'];
  return (E.cred?.probadita_restante > 0) ? [...new Set([...base, 'orbita'])] : base;
};

marked.setOptions({ breaks: true, gfm: true });
// Enlaces de las respuestas: siempre se pueden pulsar, se abren en otra pestaña y solo aceptan http, https o mailto
DOMPurify.addHook('afterSanitizeAttributes', (n) => {
  if (n.tagName !== 'A') return;
  const h = (n.getAttribute('href') || '').trim();
  if (!/^(https?:\/\/|mailto:)/i.test(h)) { n.removeAttribute('href'); return; }
  n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer nofollow');
});
const md = (t) => DOMPurify.sanitize(marked.parse(t || ''), { ADD_ATTR: ['target'] });
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('ver'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('ver'), 3200); }

const almacen = (() => {
  const donde = () => { try { return localStorage.getItem('elio_recordar') === '0' ? sessionStorage : localStorage; } catch (e) { return null; } };
  return {
    getItem: (k) => { try { return donde()?.getItem(k) ?? null; } catch (e) { return null; } },
    setItem: (k, v) => { try { donde()?.setItem(k, v); } catch (e) {} },
    removeItem: (k) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} },
  };
})();
const sb = CFG.SUPABASE_URL ? createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth: { storage: almacen } }) : null;
const E = { invitado: false, historialInv: [], restantes: 4, sesion: null, estado: null, chats: [], conv: null, motor: 'chispa', cred: null, adjunto: null, enviando: false };

// ---------- Acceso ----------
let modo = 'entrar';
function modoAcceso(m) {
  modo = m;
  $('#acceso').classList.toggle('registro', m === 'registro');
  $('#acceso').classList.toggle('olvido', m === 'olvido');
  $('#acceso-titulo').textContent = { entrar: 'Bienvenido a Elio', registro: 'Crea tu cuenta gratis', olvido: 'Recupera tu contraseña' }[m];
  $('#acceso-sub').textContent = { entrar: 'Inicia sesión para continuar', registro: '10 créditos cada 5 horas, 3 mensajes con Órbita a la semana y tu historial', olvido: 'Te enviaremos un enlace a tu correo' }[m];
  $('#acceso-btn span').textContent = { entrar: 'Iniciar sesión', registro: 'Crear mi cuenta', olvido: 'Enviarme el enlace' }[m];
  $('#cambiar-modo').innerHTML = m === 'entrar'
    ? '<span>¿Aún no tienes una cuenta?</span> <button class="enlace" type="button" data-ir-modo="registro">Crear cuenta</button>'
    : '<span>¿Ya tienes una cuenta?</span> <button class="enlace" type="button" data-ir-modo="entrar">Iniciar sesión</button>';
  $('.separador').classList.toggle('oculto', m === 'olvido'); $('#s-google').classList.toggle('oculto', m === 'olvido');
  $('#acceso-aviso').textContent = ''; $('#acceso-aviso').classList.remove('ok');
  $('#f-acceso [name=clave]').autocomplete = m === 'registro' ? 'new-password' : 'current-password';
}
$('#cambiar-modo').addEventListener('click', (e) => { const b = e.target.closest('[data-ir-modo]'); if (b) modoAcceso(b.dataset.irModo); });
$('#olvide').addEventListener('click', () => modoAcceso('olvido'));
$('#s-google').addEventListener('click', () => toast('Iniciar con Google llega muy pronto. Por ahora usa tu correo.'));

$('#f-acceso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, aviso = $('#acceso-aviso'), btn = $('#acceso-btn');
  const correo = f.correo.value.trim(), clave = f.clave.value, nombre = f.nombre.value.trim();
  aviso.classList.remove('ok');
  if (!sb) { aviso.textContent = 'Elio se está conectando. Vuelve en un rato.'; return; }
  if (!/^\S+@\S+\.\S+$/.test(correo)) { aviso.textContent = 'Escribe un correo válido.'; return; }
  if (modo !== 'olvido' && clave.length < 8) { aviso.textContent = 'La contraseña debe tener al menos 8 caracteres.'; return; }
  if (modo === 'registro' && nombre.length < 2) { aviso.textContent = 'Escribe tu nombre.'; return; }
  if (modo === 'registro' && !f.terminos.checked) { aviso.textContent = 'Para crear tu cuenta, acepta los Términos y la Política de privacidad.'; return; }
  btn.disabled = true;
  try {
    if (modo === 'entrar') {
      try { localStorage.setItem('elio_recordar', f.recordar.checked ? '1' : '0'); } catch (e) {}
      const { error } = await sb.auth.signInWithPassword({ email: correo, password: clave });
      if (error) throw new Error(/confirm/i.test(error.message) ? 'Primero confirma tu correo: revisa tu bandeja (y la carpeta de spam).' : 'Correo o contraseña incorrectos.');
    } else if (modo === 'registro') {
      const { data, error } = await sb.auth.signUp({ email: correo, password: clave, options: { data: { nombre, acepto: true, aprende: f.aprende.checked, ofertas: f.ofertas.checked }, emailRedirectTo: VOLVER } });
      if (error) throw new Error(/registered|exists/i.test(error.message) ? 'Ese correo ya tiene cuenta. Inicia sesión.' : 'No se pudo crear la cuenta: ' + error.message);
      if (!data.session) { modoAcceso('entrar'); aviso.classList.add('ok'); aviso.textContent = '¡Cuenta creada! Confirma tu correo (revisa también spam) y luego inicia sesión.'; }
    } else {
      const { error } = await sb.auth.resetPasswordForEmail(correo, { redirectTo: VOLVER });
      if (error) throw new Error('No se pudo enviar el enlace. Inténtalo en un minuto.');
      aviso.classList.add('ok'); aviso.textContent = 'Si ese correo tiene cuenta, te llegó un enlace para crear una nueva contraseña.';
    }
  } catch (err) { aviso.textContent = err.message; }
  finally { btn.disabled = false; }
});

$('#f-nueva').addEventListener('submit', async (e) => {
  e.preventDefault();
  const clave = e.target.clave.value;
  if (clave.length < 8) { $('#nueva-aviso').textContent = 'Mínimo 8 caracteres.'; return; }
  const { error } = await sb.auth.updateUser({ password: clave });
  if (error) { $('#nueva-aviso').textContent = 'No se pudo guardar. Pide un enlace nuevo.'; return; }
  $('#nueva-clave').classList.add('oculto'); toast('Contraseña actualizada ✔');
});


// ---------- Contraseñas: ver/ocultar y medidor de fuerza ----------
document.querySelectorAll('.ojo').forEach((b) => b.addEventListener('click', () => {
  const inp = b.previousElementSibling, ver = inp.type === 'password';
  inp.type = ver ? 'text' : 'password'; b.innerHTML = `<svg><use href="#i-${ver ? 'ojo' : 'ojo-no'}"/></svg>`;
  b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
}));
function fuerzaClave(c) {
  let p = 0;
  if (c.length >= 8) p++; if (c.length >= 12) p++;
  if (/[a-z]/.test(c) && /[A-Z]/.test(c)) p++;
  if (/\d/.test(c)) p++;
  if (/[^A-Za-z0-9]/.test(c)) p++;
  if (c.length < 8) p = Math.min(p, 1);
  return Math.min(4, p);
}
const NIVELES = [['Muy débil', '#d63a52'], ['Débil', '#f0803c'], ['Media', '#e8b923'], ['Fuerte', '#5cc46a'], ['Muy fuerte', '#14915b']];
document.querySelectorAll('.fuerza').forEach((f) => {
  const inp = f.previousElementSibling.querySelector('input[type=password],input[name=clave]');
  const pintar = () => {
    const v = inp.value, n = fuerzaClave(v), [t, col] = NIVELES[n];
    f.querySelector('i').style.width = v ? ((n + 1) / 5) * 100 + '%' : '0';
    f.querySelector('i').style.background = col;
    f.querySelector('small').textContent = v ? `Seguridad: ${t}${n < 3 ? ' · usa 12+ caracteres, mayúsculas, números y símbolos' : ''}` : '';
    f.querySelector('small').style.color = col;
  };
  inp.addEventListener('input', pintar);
});

// ---------- Arranque ----------
async function iniciar() {
  if (DEMO) { E.estado = { nombre: 'Demo', plan: 'impulso', plan_vence: '2026-12-25', es_admin: true, hoy: { rapido: 12, razonamiento: 0, experto: 0 }, mes: { rapido: 40, razonamiento: 25, experto: 0 } }; return entrarApp(); }
  if (!sb) { $('#acceso').classList.remove('oculto'); modoAcceso('entrar'); return; }
  try { const g = localStorage.getItem('elio_restantes_' + new Date().toDateString()); if (g !== null) E.restantes = Number(g); } catch (e) {}
  sb.auth.onAuthStateChange((ev, sesion) => {
    if (ev === 'PASSWORD_RECOVERY') $('#nueva-clave').classList.remove('oculto');
    if (ev === 'SIGNED_OUT') { E.sesion = null; modoInvitado(); }
    if (ev === 'SIGNED_IN' && sesion && !E.sesion) { E.sesion = sesion; entrarApp(); }
    if (ev === 'TOKEN_REFRESHED' && sesion) E.sesion = sesion;
  });
  const { data } = await sb.auth.getSession();
  if (data.session) { E.sesion = data.session; entrarApp(); }
  else modoInvitado();
}
function modoInvitado() {
  E.invitado = true; E.historialInv = []; document.body.classList.add('es-invitado');
  E.estado = { plan: 'invitado', nombre: '', hoy: { rapido: 0, razonamiento: 0, experto: 0 }, mes: { rapido: 0, razonamiento: 0, experto: 0 } };
  $('#acceso').classList.add('oculto'); $('#app').classList.remove('oculto');
  $('#saludo').textContent = 'Tu asistente de inteligencia artificial para crear, analizar y potenciar tus ideas.';
  $$('.niveles button').forEach((b) => b.classList.toggle('bloq', b.dataset.motor !== 'chispa'));
  E.chats = []; pintarChats(); nuevoChat(); pintarRestantes();
}
function pintarRestantes() {
  const corto = matchMedia('(max-width:860px)').matches;
  $('#texto').placeholder = E.restantes > 0 ? (corto ? `Pregúntale a Elio (${E.restantes} sin cuenta)` : `¿En qué puedo ayudarte hoy? (te quedan ${E.restantes} preguntas sin cuenta)`) : 'Crea tu cuenta gratis para seguir';
}
function pedirCuenta(msg) {
  $('#acceso').classList.remove('oculto'); modoAcceso('registro');
  if (msg) { $('#acceso-aviso').classList.add('ok'); $('#acceso-aviso').textContent = msg; }
}
$('#b-entrar').addEventListener('click', () => { $('#acceso').classList.remove('oculto'); modoAcceso('entrar'); });
$('#b-registro').addEventListener('click', () => pedirCuenta());
$('#lat-registro').addEventListener('click', () => pedirCuenta());
$('#cerrar-acceso').addEventListener('click', () => $('#acceso').classList.add('oculto'));

async function entrarApp() {
  E.invitado = false; document.body.classList.remove('es-invitado');
  $('#acceso').classList.add('oculto'); $('#app').classList.remove('oculto');
  await registrarDispositivo();
  await aceptarInvitacionPendiente();
  await revisarPlanLogrin();
  await cargarEstado();
  if (sb && E.estado && !E.estado.acepto && E.sesion?.user?.user_metadata?.acepto) await sb.rpc('elio_aceptar_terminos');
  await cargarChats();
  nuevoChat();
  $('#texto').focus();
}
// «Elio para Logrin»: una vez cada 6 h pregunta si el negocio sigue con su plan (el servidor decide si llama a Logrin)
async function revisarPlanLogrin() {
  let ultima = 0; try { ultima = Number(localStorage.getItem('elio-logrin-revisado') || 0); } catch {}
  if (Date.now() - ultima < 6 * 3600_000) return;
  try { await llamarLogrin({ accion: 'estado' }); localStorage.setItem('elio-logrin-revisado', String(Date.now())); } catch {}
}
async function cargarEstado() {
  if (sb) { const { data } = await sb.rpc('elio_mi_estado'); E.estado = data; }
  const s = E.estado; if (!s) return;
  $('#plan-nombre').textContent = NOMBRE_PLAN[s.plan] || 'Libre';
  $('#plan-vence').textContent = s.plan !== 'libre' && s.plan_vence ? ' · hasta el ' + new Date(s.plan_vence + 'T12:00').toLocaleDateString('es-PE', { day: 'numeric', month: 'short' }) : '';
  $('#lat-nombre').textContent = s.nombre || 'Tu cuenta';
  $('#iniciales').textContent = (s.nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';
  $('#ir-admin').hidden = !s.es_admin;
  if (sb && !DEMO) { const { data: cr } = await sb.rpc('elio_mis_creditos'); if (cr) E.cred = cr; }
  if (DEMO) E.cred = { plan: s.plan, motores: MOTORES_PLAN[s.plan], ventana_max: 60, ventana_usado: 18, ventana_renueva: new Date(Date.now() + 3 * 36e5).toISOString(), semana_max: 340, semana_usado: 120, semana_renueva: new Date(Date.now() + 4 * 864e5).toISOString(), encuesta: false };
  pintarCreditos();
  if (s.pago_pendiente) $('#cupos').insertAdjacentHTML('beforeend', '<div>⏳ Tu pago está en revisión.</div>');
  $('#ver-planes').textContent = s.plan === 'ultra' ? 'Ver planes' : '✦ Mejorar mi plan';
  const permitidos = permitidosAhora();
  $$('.niveles button').forEach((b) => b.classList.toggle('bloq', !permitidos.includes(b.dataset.motor)));
  const orb = $('[data-motor=orbita] small');
  if (orb) orb.textContent = E.cred?.plan === 'libre' ? `Experto · probadita: te quedan ${E.cred.probadita_restante} de 3 esta semana` : 'Experto en análisis y documentos · 10 créditos · Impulso y Ultra';
  $$('[data-activar-prueba]').forEach((b) => b.classList.toggle('oculto', !E.cred?.prueba_disponible));
  $('#ver-compartir').hidden = !(E.cred?.titular_ultra || E.cred?.compartido);
  $('#prueba-planes').classList.toggle('oculto', !E.cred?.prueba_disponible);
  $('#mejora-prueba-nota').classList.toggle('oculto', !E.cred?.prueba_disponible);
  $('.adjuntar').style.opacity = s.plan === 'libre' ? 0.5 : 1;
  const h = new Date().getHours();
  $('#saludo').textContent = `${h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'}${s.nombre ? ', ' + s.nombre.split(' ')[0] : ''}. Soy tu asistente de inteligencia artificial para crear, analizar y potenciar tus ideas.`;
}

// ---------- Conversaciones ----------
async function cargarChats() {
  if (!sb) { E.chats = DEMO ? [{ id: 'd1', titulo: 'Plan de marketing para mi bodega' }, { id: 'd2', titulo: 'Tarea de biología' }] : []; return pintarChats(); }
  const { data } = await sb.from('conversaciones').select('id,titulo,actualizado,fijado,proyecto').is('proyecto', null).order('fijado', { ascending: false }).order('actualizado', { ascending: false }).limit(60);
  E.chats = data || []; pintarChats();
}
let verTodos = false;
function pintarChats() {
  const lista = verTodos ? E.chats : E.chats.slice(0, 8);
  $('#lista-chats').innerHTML = lista.length ? lista.map((c) => `<div class="chat-item ${c.id === E.conv ? 'on' : ''}" data-id="${c.id}"><button class="abrir" title="${esc(c.titulo)}">${c.fijado ? '<b class="pin" aria-label="Fijado">📌</b>' : '<svg><use href="#i-burbuja"/></svg>'}<span>${esc(c.titulo)}</span></button><button class="icono borrar" aria-label="Opciones del chat" title="Opciones del chat"><svg><use href="#i-puntos"/></svg></button></div>`).join('')
    : '<p class="vacio-chats">Aún no tienes conversaciones.</p>';
  $('#ver-mas').classList.toggle('oculto', verTodos || E.chats.length <= 8);
}
$('#ver-mas').addEventListener('click', () => { verTodos = true; pintarChats(); });
$('#lista-chats').addEventListener('click', async (e) => {
  const it = e.target.closest('.chat-item'); if (!it) return;
  if (e.target.closest('.borrar')) return abrirMenuChat(it.dataset.id, e.target.closest('.borrar'), null);
  abrirChat(it.dataset.id);
});
function nuevoChat(proyecto = null) {
  E.proyecto = proyecto || null; E.conv = null; $('#mensajes').innerHTML = ''; $('#vacio').classList.remove('oculto'); document.body.classList.add('vacio');
  $('#titulo-chat').textContent = E.proyecto ? `📁 ${E.proyectos?.find((p) => p.id === E.proyecto)?.nombre || 'Proyecto'} · Nuevo chat` : 'Nuevo chat'; pintarChats(); cerrarLateral();
}
async function abrirChat(id, info = null) {
  E.conv = id; pintarChats(); cerrarLateral();
  const c = info || E.chats.find((x) => x.id === id);
  E.proyecto = info?.proyecto || null;
  const pn = E.proyecto ? E.proyectos?.find((p) => p.id === E.proyecto)?.nombre : null;
  $('#titulo-chat').textContent = (pn ? `📁 ${pn} · ` : '') + (c?.titulo || 'Chat');
  $('#mensajes').innerHTML = ''; $('#vacio').classList.add('oculto'); document.body.classList.remove('vacio');
  if (!sb) return;
  const { data, error } = await sb.from('mensajes').select('id,rol,contenido,adjunto').eq('conversacion', id).order('id').limit(200);
  if (!error && !(data || []).length && E.proyecto) { toast('Este proyecto se cerró. Ábrelo de nuevo con su contraseña.'); return abrirProyectos(); }
  for (const m of data || []) m.rol === 'user' ? burbujaYo(m.contenido, m.adjunto) : burbujaElio().pintar(m.contenido, true, m.id);
  abajo();
}
$('#nuevo-chat').addEventListener('click', nuevoChat);

// ---------- Mensajes ----------
function abajo() { const c = $('#conversacion'); c.scrollTop = c.scrollHeight; }
function burbujaYo(texto, adjunto) {
  const d = document.createElement('div'); d.className = 'msg yo';
  d.innerHTML = `<div class="cuerpo">${adjunto ? `<span class="adj">📎 ${esc(adjunto)}</span>` : ''}${esc(texto)}</div>`;
  $('#mensajes').append(d); return d;
}
function burbujaElio() {
  const d = document.createElement('div'); d.className = 'msg elio';
  d.innerHTML = '<img class="av" src="img/Elio_Avatar-160.webp" alt=""><div class="cuerpo"><span class="escribiendo"><i></i><i></i><i></i></span></div>';
  $('#mensajes').append(d);
  const cuerpo = d.querySelector('.cuerpo');
  return {
    pintar(t, final, mid) {
      cuerpo.innerHTML = md(t);
      cuerpo.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; });
      if (final) {
        const acc = document.createElement('div'); acc.className = 'acciones';
        acc.innerHTML = '<button data-a="copiar">📋 Copiar</button>';
        acc.querySelector('button').onclick = () => navigator.clipboard.writeText(t).then(() => toast('Copiado ✔'));
        if (mid && E.cred?.plan === 'ultra') {
          const r = document.createElement('button'); r.textContent = '🌿 Rama desde aquí'; r.title = 'Copia el chat hasta esta respuesta para probar otro camino (máximo 5 ramas por chat)';
          r.onclick = () => crearRama(mid); acc.append(r);
        }
        cuerpo.append(acc);
      }
    },
    error(msg, reintentar, cupo) {
      cuerpo.innerHTML = `<div class="error-msg">${esc(msg)}</div>`;
      if (cupo) { const b = document.createElement('button'); b.className = 'boton principal'; b.textContent = 'Ver planes'; b.onclick = abrirPlanes; cuerpo.querySelector('.error-msg').append(document.createElement('br'), b); }
      else if (reintentar) { const b = document.createElement('button'); b.className = 'boton'; b.textContent = 'Reintentar'; b.onclick = () => { d.remove(); reintentar(); }; cuerpo.querySelector('.error-msg').append(document.createElement('br'), b); }
    },
  };
}

const ES_RECORDATORIO = /^\s*(recu[eé]rdame|recordarme|recu[eé]rdales?|an[oó]tame|anota en mi d[ií]a|agrega a mi d[ií]a)\b/i;
async function enviar(texto, adjunto) {
  if (E.enviando) return;
  if (!E.invitado && E.sesion && !adjunto && ES_RECORDATORIO.test(texto || '') && !DEMO) {
    E.enviando = true; $('#vacio').classList.add('oculto'); document.body.classList.remove('vacio');
    burbujaYo(texto); const b = burbujaElio(); abajo();
    try {
      const j = await llamarBiblioteca({ accion: 'tarea', texto });
      b.pintar(`Listo ✔ Lo anoté en **Mi día**: **${j.tarea.texto}**${j.tarea.fecha ? ` para el **${fechaBonita(j.tarea.fecha)}**` : ''}${j.tarea.hora ? ` a las ${j.tarea.hora.slice(0, 5)}` : ''}${j.tarea.monto ? ` (${j.tarea.moneda === 'USD' ? 'US$' : 'S/'} ${j.tarea.monto})` : ''}.${j.consola === 'enviado' ? '\n\nTambién quedó en tu **Consola madre** ✔' : j.consola === 'pendiente' ? '\n\nLa Consola madre no respondió; lo vuelvo a enviar en tu próximo recordatorio.' : j.consola === 'sensible' ? '\n\nNo lo copié a la Consola porque parece traer datos sensibles.' : ''}\n\nPuedes verlo en el menú *Mi día*.`, true);
    } catch (err) { b.pintar(err.message, true); }
    finally { E.enviando = false; abajo(); }
    return;
  }
  if (E.invitado && E.restantes <= 0) return pedirCuenta('Ya usaste tus preguntas sin cuenta. Crea tu cuenta gratis para seguir: 10 créditos cada 5 horas, 3 mensajes con Órbita a la semana y tu historial guardado.');
  const permitidos = permitidosAhora();
  if (!permitidos.includes(E.motor)) { if (E.invitado) return pedirCuenta('Crea tu cuenta para usar los otros motores de Elio.'); toast(E.motor === 'cumbre' ? 'Cumbre está en el plan Ultra.' : `${MOTORES[E.motor][0]} está en Impulso y Ultra.`); return abrirPlanes(); }
  E.enviando = true; $('#enviar').disabled = true;
  $('#vacio').classList.add('oculto'); document.body.classList.remove('vacio');
  burbujaYo(texto, adjunto?.nombre);
  const b = burbujaElio(); abajo();
  let acumulado = '';
  try {
    if (DEMO) {
      const resp = `¡Hola! Esto es una **demostración** de Elio.\n\n- Motor: **${E.motor}**\n- Tu mensaje: _${texto.slice(0, 80)}_\n\n| Plan | Precio |\n|---|---|\n| Impulso | S/ 56.99 |\n| Ultra | S/ 159.99 |\n\n\`\`\`js\nconsole.log("Elio by FlexGo");\n\`\`\``;
      for (const w of resp.split(/(\s+)/)) { acumulado += w; b.pintar(acumulado); abajo(); await new Promise((r) => setTimeout(r, 18)); }
      b.pintar(acumulado, true);
      if (!E.conv) { E.conv = 'demo-' + Date.now(); E.chats.unshift({ id: E.conv, titulo: texto.slice(0, 60) }); pintarChats(); $('#titulo-chat').textContent = texto.slice(0, 60); }
      return;
    }
    const s = E.invitado ? null : (await sb.auth.getSession()).data;
    const r = await fetch(`${CFG.SUPABASE_URL}/functions/v1/elio-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_KEY, 'x-elio-dispositivo': idDispositivo(), ...(s?.session ? { Authorization: `Bearer ${s.session.access_token}` } : {}) },
      body: JSON.stringify(E.invitado ? { texto, invitado: true, historial: E.historialInv } : { conversacion: E.conv, texto, motor: E.motor, ...(!E.conv && E.proyecto ? { proyecto: E.proyecto } : {}), ...(adjunto?.documento ? { documento: adjunto.documento } : adjunto ? { adjunto } : {}) }),
    });
    if (!r.ok || !r.body) {
      const j = await r.json().catch(() => ({}));
      if (j.codigo === 'registro') { b.error(j.mensaje); E.restantes = 0; guardarRestantes(); pintarRestantes(); pedirCuenta(j.mensaje); return; }
      b.error(j.mensaje || 'No pude responder. Revisa tu conexión.', r.status >= 500 && r.status !== 503 ? () => enviar(texto, adjunto) : null, j.codigo === 'cupo' || j.codigo === 'tope_libre');
      if (j.mejora || j.codigo === 'tope_libre') abrirMejora(j.mensaje);
      if (j.codigo === 'dispositivo') abrirDispositivos(j.mensaje);
      if (j.codigo === 'proyecto_cerrado') abrirProyectos();
      return;
    }
    const lector = r.body.getReader(), dec = new TextDecoder(); let buf = '', fallo = null;
    while (true) {
      const { value, done } = await lector.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const linea = buf.slice(0, i).replace(/^data: /, ''); buf = buf.slice(i + 2);
        let ev; try { ev = JSON.parse(linea); } catch { continue; }
        if (ev.tipo === 'conv' && E.conv !== ev.id) {
          E.conv = ev.id;
          if (E.proyecto) { const t = (texto || adjunto?.nombre || 'Nuevo chat').slice(0, 60); $('#titulo-chat').textContent = `📁 ${E.proyectos?.find((p) => p.id === E.proyecto)?.nombre || 'Proyecto'} · ${t}`; }
          else if (!E.chats.some((c) => c.id === ev.id)) { const t = (texto || adjunto?.nombre || 'Nuevo chat').slice(0, 60); E.chats.unshift({ id: ev.id, titulo: t }); $('#titulo-chat').textContent = t; }
          pintarChats();
        }
        if (ev.tipo === 'texto') { acumulado += ev.t; b.pintar(acumulado); abajo(); }
        if (ev.tipo === 'aviso') toast(ev.t);
        if (ev.tipo === 'invitado') { E.restantes = ev.restantes; guardarRestantes(); pintarRestantes(); }
        if (ev.tipo === 'creditos' && ev.estado) { E.cred = ev.estado; pintarCreditos(); if (ev.usados > ev.minimo) toast(`Este mensaje usó ${ev.usados} créditos porque la conversación o el documento son largos. Un chat nuevo gasta menos.`); }
        if (ev.tipo === 'error') fallo = ev.mensaje;
      }
    }
    if (fallo && !acumulado) b.error(fallo, () => enviar(texto, adjunto)); else b.pintar(acumulado || '…', true);
    if (E.invitado) {
      if (acumulado) E.historialInv.push({ rol: 'user', contenido: texto }, { rol: 'assistant', contenido: acumulado });
      if (E.restantes <= 0) setTimeout(() => pedirCuenta('¿Te gustó? Crea tu cuenta gratis para seguir conversando con Elio: 10 créditos cada 5 horas, 3 mensajes con Órbita a la semana y tu historial guardado.'), 1800);
      else if (E.restantes === 1) toast('Te queda 1 pregunta sin cuenta.');
    } else { cargarEstado(); contarParaEncuesta(); }
    if (E.invitado) contarParaEncuesta();
  } catch (err) {
    b.error('Se cortó la conexión. Inténtalo de nuevo.', () => enviar(texto, adjunto));
  } finally {
    E.enviando = false; $('#enviar').disabled = false; abajo();
  }
}

const ta = $('#texto');
ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; });
ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#f-mensaje').requestSubmit(); } });
$('#f-mensaje').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = ta.value.trim(); if ((!t && !E.adjunto) || E.enviando) return;
  const adj = E.adjunto; ta.value = ''; ta.style.height = 'auto'; quitarAdjunto();
  enviar(t, adj);
});
$$('.sugerencias button').forEach((b) => b.addEventListener('click', () => enviar(b.dataset.prompt, null)));
$$('.niveles button').forEach((b) => b.addEventListener('click', () => {
  const m = b.dataset.motor;
  const permitidos = permitidosAhora();
  if (!permitidos.includes(m) && E.invitado) return pedirCuenta('Crea tu cuenta para usar los otros motores de Elio.');
  if (!permitidos.includes(m)) { toast(m === 'cumbre' ? 'Cumbre está en el plan Ultra.' : `${MOTORES[m][0]} está en Impulso y Ultra.`); return abrirPlanes(); }
  E.motor = m; $$('.niveles button').forEach((x) => x.classList.toggle('on', x === b));
  $('#modo-txt').textContent = MOTORES[m][0].split(' ').slice(1).join(' ');
  $('#niveles').classList.add('oculto'); pintarCreditos();
}));

// ---------- Ventana de mejora y prueba gratis de Impulso (una sola vez) ----------
function abrirMejora(msg) { $('#mejora-msg').textContent = msg || ''; $('#mejora').classList.remove('oculto'); }
$('#mejora-planes').addEventListener('click', () => { $('#mejora').classList.add('oculto'); abrirPlanes(); });
function idDispositivo() {
  let id = null; try { id = localStorage.getItem('elio_dispositivo'); } catch (e) {}
  if (!id) { id = crypto.randomUUID() + crypto.randomUUID(); try { localStorage.setItem('elio_dispositivo', id); } catch (e) {} }
  return id;
}
$$('[data-activar-prueba]').forEach((b) => b.addEventListener('click', async () => {
  if (!E.sesion) return pedirCuenta('Crea tu cuenta gratis para probar Impulso 3 días.');
  if (!confirm('¿Activar tu prueba gratis de Impulso por 3 días? Es una sola vez por persona y no tiene costo.')) return;
  const { data, error } = await sb.rpc('elio_activar_prueba', { dispositivo: idDispositivo() });
  if (error) return toast(error.message);
  $$('.modal').forEach((m) => m.classList.add('oculto'));
  toast(`¡Listo! Tienes Impulso gratis hasta el ${new Date(data.vence + 'T12:00').toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })} 🎉`);
  cargarEstado();
}));

// ---------- Cámara y fotos livianas (celular: cámara directa; laptop: ventana con la cámara) ----------
async function achicarFoto(blob, max = 1600) {
  const img = await createImageBitmap(blob).catch(() => null);
  if (!img) throw new Error('No se pudo leer la foto.');
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL('image/jpeg', 0.85);
  return { base64: url.split(',')[1], tipo: 'image/jpeg', url };
}
const esTactil = () => matchMedia('(pointer: coarse)').matches;
let camStream = null, camFrente = false, camResolver = null;
function cerrarCamara() { camStream?.getTracks().forEach((t) => t.stop()); camStream = null; $('#camara').classList.add('oculto'); }
async function encenderCamara() {
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: camFrente ? 'user' : 'environment', width: { ideal: 1920 } }, audio: false });
  $('#cam-video').srcObject = camStream;
}
// Devuelve un Blob con la foto, o null si se canceló
function tomarFoto() {
  return new Promise(async (ok) => {
    if (esTactil() || !navigator.mediaDevices?.getUserMedia) {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
      inp.onchange = () => ok(inp.files[0] || null); inp.click(); return;
    }
    try { await encenderCamara(); } catch (e) { toast('No se pudo abrir la cámara. Revisa el permiso del navegador o usa «Subir foto».'); return ok(null); }
    camResolver = ok; $('#camara').classList.remove('oculto');
  });
}
$('#cam-foto').addEventListener('click', () => {
  const v = $('#cam-video'); if (!v.videoWidth) return;
  const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight; cv.getContext('2d').drawImage(v, 0, 0);
  cv.toBlob((bl) => { cerrarCamara(); camResolver?.(bl); camResolver = null; }, 'image/jpeg', 0.92);
});
$('#cam-girar').addEventListener('click', async () => { camFrente = !camFrente; try { await encenderCamara(); } catch (e) { toast('No hay otra cámara.'); } });
$('#cam-cerrar').addEventListener('click', () => { cerrarCamara(); camResolver?.(null); camResolver = null; });

// ---------- Inventario de mi negocio (R-175): foto → lista → «Enviar a Logrin» (queda «Por confirmar») ----------
async function llamarLogrin(cuerpo) {
  const { data } = await sb.auth.getSession();
  const r = await fetch(`${CFG.SUPABASE_URL}/functions/v1/elio-logrin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_KEY, 'x-elio-dispositivo': idDispositivo(), Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (j.codigo === 'dispositivo') abrirDispositivos(j.mensaje);
  if (j.codigo === 'sin_enlace') verVistaInv('inv-conectar');
  if (!r.ok) throw new Error(j.mensaje || 'No se pudo completar. Inténtalo de nuevo.');
  return j;
}
const vistasInv = ['inv-conectar', 'inv-principal', 'inv-leyendo', 'inv-revisar', 'inv-listo'];
const verVistaInv = (id) => vistasInv.forEach((v) => { $('#' + v).hidden = v !== id; });
const CAMPOS_INV = [['producto', 'Producto', 80], ['marca', 'Marca', 80], ['modelo', 'Modelo', 80], ['talla', 'Talla', 20], ['color', 'Color', 40], ['cantidad', 'Cant.', 3]];
async function abrirInventario() {
  $('#menu-usuario').classList.add('oculto');
  if (!E.sesion) return pedirCuenta('Crea tu cuenta o inicia sesión para conectar Elio con tu negocio.');
  $('#inventario').classList.remove('oculto'); verVistaInv('inv-leyendo');
  try {
    const j = await llamarLogrin({ accion: 'estado' });
    if (!j.enlazado) return verVistaInv('inv-conectar');
    E.invNegocio = j.negocio; $('#inv-negocio').textContent = j.negocio; verVistaInv('inv-principal');
  } catch (e) { toast(e.message); verVistaInv('inv-conectar'); }
}
$('#ver-inventario').addEventListener('click', abrirInventario);
$('#inv-form-codigo').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { const j = await llamarLogrin({ accion: 'enlazar', codigo: $('#inv-codigo').value }); toast(`Conectado con ${j.negocio} ✔`); $('#inv-codigo').value = ''; abrirInventario(); }
  catch (err) { toast(err.message); }
});
$('#inv-quitar').addEventListener('click', async () => {
  if (!confirm('¿Quitar la conexión de Elio con tu negocio de Logrin? Podrás conectarte de nuevo con un código nuevo.')) return;
  try { await llamarLogrin({ accion: 'revocar' }); toast('Conexión quitada ✔'); verVistaInv('inv-conectar'); } catch (err) { toast(err.message); }
});
async function leerFotoInventario(blob) {
  if (!blob) return;
  if (blob.size > 25 * 1024 * 1024) return toast('La foto pesa demasiado.');
  verVistaInv('inv-leyendo');
  try {
    const f = await achicarFoto(blob);
    const j = await llamarLogrin({ accion: 'leer_foto', imagen: f.base64, tipo: f.tipo });
    E.invProp = j.propuesta; pintarInventario(j.items || []);
    $('#inv-aviso').hidden = !j.aviso; $('#inv-aviso').textContent = j.aviso || '';
    if (!(j.items || []).length) toast('No reconocí productos en la foto. Agrégalos a mano o toma otra foto con más luz.');
    verVistaInv('inv-revisar'); cargarEstado();
  } catch (err) { toast(err.message); verVistaInv('inv-principal'); }
}
$('#inv-camara').addEventListener('click', async () => leerFotoInventario(await tomarFoto()));
$('#inv-archivo').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; leerFotoInventario(f); });
$('#inv-otra').addEventListener('click', () => verVistaInv('inv-principal'));
$('#inv-nueva').addEventListener('click', () => verVistaInv('inv-principal'));
function filaInv(it = {}) {
  return `<div class="inv-fila">${CAMPOS_INV.map(([k, et, n]) => `<label><small>${et}</small><input data-k="${k}" ${k === 'cantidad' ? 'type="number" min="1" max="999" inputmode="numeric"' : `maxlength="${n}"`} value="${esc(it[k] ?? (k === 'cantidad' ? 1 : ''))}"></label>`).join('')}<button class="icono" type="button" data-quitar aria-label="Quitar producto">✕</button></div>`;
}
function pintarInventario(items) { $('#inv-tabla').innerHTML = (items.length ? items : [{}]).map(filaInv).join(''); }
$('#inv-tabla').addEventListener('click', (e) => { if (e.target.closest('[data-quitar]')) e.target.closest('.inv-fila').remove(); });
$('#inv-agregar').addEventListener('click', () => { if ($$('#inv-tabla .inv-fila').length >= 30) return toast('Máximo 30 productos por lista.'); $('#inv-tabla').insertAdjacentHTML('beforeend', filaInv()); });
$('#inv-enviar').addEventListener('click', async () => {
  const items = $$('#inv-tabla .inv-fila').map((f) => Object.fromEntries([...f.querySelectorAll('input')].map((i) => [i.dataset.k, i.dataset.k === 'cantidad' ? Number(i.value) : i.value.trim()]))).filter((x) => x.producto);
  if (!items.length) return toast('Escribe al menos un producto.');
  if (items.some((x) => !(x.cantidad >= 1 && x.cantidad <= 999))) return toast('Cada cantidad debe ser de 1 a 999.');
  if (!confirm(`¿Enviar ${items.length} producto${items.length === 1 ? '' : 's'} a Logrin? Quedarán «Por confirmar» hasta que los aceptes allá.`)) return;
  const btn = $('#inv-enviar'); btn.disabled = true;
  try { await llamarLogrin({ accion: 'proponer', propuesta: E.invProp, items }); $('#inv-listo-negocio').textContent = E.invNegocio || 'tu negocio'; verVistaInv('inv-listo'); }
  catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
});

// ---------- Mis proyectos (Ultra), ramas, fijar y descargar ----------
const vistasProy = ['proy-lista-vista', 'proy-sin-ultra', 'proy-crear', 'proy-abrir', 'proy-recuperar', 'proy-vista'];
const verVistaProy = (id) => vistasProy.forEach((v) => { $('#' + v).hidden = v !== id; });
const horaPE = (f) => new Date(f).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
async function cargarProyectos() {
  if (!sb || !E.sesion) { E.proyectos = []; return []; }
  const { data } = await sb.rpc('elio_mis_proyectos'); E.proyectos = data || []; return E.proyectos;
}
async function abrirProyectos() {
  $('#menu-chat').classList.add('oculto');
  if (!E.sesion) return pedirCuenta('Crea tu cuenta para usar Mis proyectos (plan Ultra).');
  $('#proyectos').classList.remove('oculto'); cerrarLateral();
  const lista = await cargarProyectos();
  if (E.cred?.plan !== 'ultra' && !lista.length) return verVistaProy('proy-sin-ultra');
  verVistaProy('proy-lista-vista');
  $('#proy-nuevo').hidden = E.cred?.plan !== 'ultra';
  $('#proy-lista').innerHTML = lista.map((p) => `<button class="b-doc proy-item" type="button" data-proy="${p.id}"><div class="b-doc-cab"><b>${p.con_clave ? (p.abierto ? '🔓' : '🔒') : '📁'} ${esc(p.nombre)}</b><small>${p.chats}/10 chats${p.abierto && p.abierto_hasta ? ' · abierto hasta las ' + horaPE(p.abierto_hasta) : ''}</small></div>${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}</button>`).join('')
    || '<p class="nota">Todavía no tienes proyectos. Crea el primero.</p>';
}
$('#ver-proyectos').addEventListener('click', abrirProyectos);
$('#proy-ver-planes').addEventListener('click', () => { $('#proyectos').classList.add('oculto'); abrirPlanes(); });
$$('[data-proy-volver]').forEach((b) => b.addEventListener('click', abrirProyectos));
$('#proy-nuevo').addEventListener('click', () => {
  E.proyEdit = null; $('#proy-crear').reset(); $('#proy-crear-t').textContent = 'Nuevo proyecto';
  $('#proy-quitar-fila').hidden = true; $('#proy-clave-nota').textContent = 'Contraseña del proyecto (opcional, mínimo 8 caracteres). Es distinta a la de tu cuenta.';
  verVistaProy('proy-crear'); $('#proy-nombre').focus();
});
$('#proy-crear').addEventListener('submit', async (e) => {
  e.preventDefault();
  const clave = $('#proy-clave').value;
  if (clave && fuerzaClave(clave) < 2) return toast('Usa una contraseña más segura (12+ caracteres, con números y símbolos).');
  const args = { nombre: $('#proy-nombre').value, descripcion: $('#proy-desc').value };
  const r = E.proyEdit
    ? await sb.rpc('elio_editar_proyecto', { p: E.proyEdit, ...args, clave: $('#proy-quitar').checked ? '' : (clave || null) })
    : await sb.rpc('elio_crear_proyecto', { ...args, clave });
  if (r.error) return toast(r.error.message);
  toast(E.proyEdit ? 'Proyecto actualizado ✔' : 'Proyecto creado ✔');
  const id = E.proyEdit || r.data; await cargarProyectos(); verProyecto(id);
});
$('#proy-lista').addEventListener('click', (e) => { const b = e.target.closest('[data-proy]'); if (b) verProyecto(b.dataset.proy); });
async function verProyecto(id) {
  const p = (E.proyectos || []).find((x) => x.id === id); if (!p) return abrirProyectos();
  E.proyVista = id;
  if (!p.abierto) {
    $('#proy-abrir').reset(); $('#proy-abrir-nombre').textContent = p.nombre;
    $('#proy-abrir-msg').textContent = p.bloqueado_hasta ? `Demasiados intentos. Vuelve a intentarlo a las ${horaPE(p.bloqueado_hasta)} o cambia la contraseña con un código a tu correo.` : 'Escribe la contraseña de este proyecto.';
    verVistaProy('proy-abrir'); $('#proy-abrir-clave').focus(); return;
  }
  const { data, error } = await sb.rpc('elio_chats_proyecto', { p: id });
  if (error) { await cargarProyectos(); return verProyecto(id); }
  verVistaProy('proy-vista');
  $('#proy-vista-nombre').textContent = p.nombre; $('#proy-vista-desc').textContent = p.descripcion || '';
  $('#proy-cerrar-llave').hidden = !p.con_clave;
  const n = (data || []).length;
  $('#proy-tope').hidden = n < 8; $('#proy-tope').textContent = n >= 10 ? 'Este proyecto llegó a 10 chats, el máximo. Borra o saca alguno para agregar otro.' : `Te quedan ${10 - n} chat${10 - n === 1 ? '' : 's'} en este proyecto (máximo 10).`;
  $('#proy-chat-nuevo').disabled = n >= 10 || E.cred?.plan !== 'ultra';
  E.proyChats = data || [];
  $('#proy-chats').innerHTML = (data || []).map((c) => `<div class="chat-item proy-chat" data-id="${c.id}"><button class="abrir" type="button">${c.fijado ? '📌' : c.rama_de ? '🌿' : '💬'} <span>${esc(c.titulo)}</span></button><button class="icono borrar" type="button" aria-label="Opciones del chat"><svg><use href="#i-puntos"/></svg></button></div>`).join('') || '<p class="nota">Este proyecto no tiene chats. Empieza uno nuevo.</p>';
}
$('#proy-chats').addEventListener('click', (e) => {
  const it = e.target.closest('.chat-item'); if (!it) return;
  const c = E.proyChats.find((x) => x.id === it.dataset.id);
  if (e.target.closest('.borrar')) return abrirMenuChat(it.dataset.id, e.target.closest('.borrar'), E.proyVista);
  $('#proyectos').classList.add('oculto'); abrirChat(it.dataset.id, { ...c, proyecto: E.proyVista });
});
$('#proy-chat-nuevo').addEventListener('click', () => { $('#proyectos').classList.add('oculto'); nuevoChat(E.proyVista); $('#texto').focus(); });
$('#proy-abrir').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { data, error } = await sb.rpc('elio_abrir_proyecto', { p: E.proyVista, clave: $('#proy-abrir-clave').value });
  if (error) return toast(error.message);
  if (!data.ok) {
    $('#proy-abrir-clave').value = '';
    $('#proy-abrir-msg').textContent = data.motivo === 'bloqueado' ? `Demasiados intentos. Vuelve a intentarlo a las ${horaPE(data.hasta)} o cambia la contraseña con un código a tu correo.` : `Contraseña incorrecta. Te quedan ${data.quedan} intento${data.quedan === 1 ? '' : 's'}.`;
    return;
  }
  toast('Proyecto abierto por 30 minutos 🔓'); await cargarProyectos(); verProyecto(E.proyVista);
});
$('#proy-olvide').addEventListener('click', async () => {
  if (!confirm('¿Enviar un código a tu correo para cambiar la contraseña de este proyecto?')) return;
  const { error } = await sb.rpc('elio_proyecto_olvide', { p: E.proyVista });
  if (error) return toast(error.message);
  $('#proy-recuperar').reset(); verVistaProy('proy-recuperar'); toast('Código enviado a tu correo ✔');
});
$('#proy-recuperar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nueva = $('#proy-nueva').value;
  if (fuerzaClave(nueva) < 2) return toast('Usa una contraseña más segura (12+ caracteres, con números y símbolos).');
  const { error } = await sb.rpc('elio_proyecto_recuperar', { p: E.proyVista, codigo: $('#proy-codigo').value, clave: nueva });
  if (error) return toast(error.message);
  toast('Contraseña cambiada. Proyecto abierto 🔓'); await cargarProyectos(); verProyecto(E.proyVista);
});
$('#proy-cerrar-llave').addEventListener('click', async () => {
  await sb.rpc('elio_cerrar_proyecto', { p: E.proyVista });
  if (E.proyecto === E.proyVista) nuevoChat();
  toast('Proyecto cerrado 🔒'); abrirProyectos();
});
$('#proy-editar').addEventListener('click', () => {
  const p = E.proyectos.find((x) => x.id === E.proyVista); E.proyEdit = p.id;
  $('#proy-crear').reset(); $('#proy-crear-t').textContent = 'Editar proyecto';
  $('#proy-nombre').value = p.nombre; $('#proy-desc').value = p.descripcion || '';
  $('#proy-quitar-fila').hidden = !p.con_clave;
  $('#proy-clave-nota').textContent = p.con_clave ? 'Deja la contraseña vacía para no cambiarla.' : 'Contraseña del proyecto (opcional, mínimo 8 caracteres). Es distinta a la de tu cuenta.';
  verVistaProy('proy-crear');
});
$('#proy-borrar').addEventListener('click', async () => {
  if (!confirm('¿Borrar este proyecto?')) return;
  const borrarChats = confirm('¿Borrar también sus chats?\n\nAceptar = se borran los chats (no se puede deshacer).\nCancelar = los chats pasan a tu lista general.');
  const { error } = await sb.rpc('elio_borrar_proyecto', { p: E.proyVista, borrar_chats: borrarChats });
  if (error) return toast(error.message);
  if (E.proyecto === E.proyVista) nuevoChat();
  toast('Proyecto borrado ✔'); cargarChats(); abrirProyectos();
});
async function crearRama(mid) {
  if (!confirm('¿Crear una rama? Se copia este chat hasta esta respuesta para que pruebes otro camino. Máximo 5 ramas por chat.')) return;
  const { data, error } = await sb.rpc('elio_ramificar', { c: E.conv, hasta: mid });
  if (error) return toast(error.message);
  toast('Rama creada 🌿'); const proy = E.proyecto;
  await cargarChats(); abrirChat(data, { titulo: 'Rama', proyecto: proy });
}
// Menú de opciones de un chat
function abrirMenuChat(id, boton, proyecto) {
  const m = $('#menu-chat'); E.menuChat = { id, proyecto };
  const c = proyecto ? E.proyChats.find((x) => x.id === id) : E.chats.find((x) => x.id === id);
  m.querySelector('[data-op=fijar]').textContent = c?.fijado ? '📌 Quitar de arriba' : '📌 Fijar arriba';
  m.querySelector('[data-op=fijar]').hidden = !!proyecto;
  m.querySelector('[data-op=mover]').hidden = E.cred?.plan !== 'ultra' || !!proyecto;
  m.querySelector('[data-op=sacar]').hidden = !proyecto;
  const r = boton.getBoundingClientRect();
  m.style.top = Math.min(r.bottom + 4, innerHeight - 220) + 'px'; m.style.left = Math.max(8, Math.min(r.left - 160, innerWidth - 220)) + 'px';
  m.classList.remove('oculto');
}
document.addEventListener('click', (e) => { if (!e.target.closest('#menu-chat') && !e.target.closest('.borrar')) $('#menu-chat').classList.add('oculto'); });
$('#menu-chat').addEventListener('click', async (e) => {
  const op = e.target.closest('[data-op]')?.dataset.op; if (!op) return;
  const { id, proyecto } = E.menuChat; $('#menu-chat').classList.add('oculto');
  const c = proyecto ? E.proyChats.find((x) => x.id === id) : E.chats.find((x) => x.id === id);
  if (op === 'fijar') {
    const { error } = await sb.rpc('elio_fijar_chat', { c: id, fijar: !c?.fijado });
    if (error) return toast(error.message);
    return cargarChats();
  }
  if (op === 'mover') {
    const lista = (await cargarProyectos()).filter((p) => p.abierto);
    if (!lista.length) return toast('Crea un proyecto (o ábrelo con su contraseña) para mover chats a él.');
    const n = prompt('¿A qué proyecto lo mueves? Escribe su número:\n' + lista.map((p, i) => `${i + 1}. ${p.nombre} (${p.chats}/10)`).join('\n'));
    const p = lista[Number(n) - 1]; if (!p) return;
    const { error } = await sb.rpc('elio_mover_chat', { c: id, p: p.id });
    if (error) return toast(error.message);
    toast(`Movido a «${p.nombre}» ✔`); if (E.conv === id) nuevoChat(); return cargarChats();
  }
  if (op === 'sacar') {
    const { error } = await sb.rpc('elio_mover_chat', { c: id, p: null });
    if (error) return toast(error.message);
    toast('El chat volvió a tu lista ✔'); await cargarChats(); return verProyecto(proyecto);
  }
  if (op === 'descargar') {
    const { data, error } = await sb.from('mensajes').select('rol,contenido,creado').eq('conversacion', id).order('id').limit(500);
    if (error || !data?.length) return toast('No se pudo descargar este chat.');
    const titulo = c?.titulo || 'Chat de Elio';
    const txt = `# ${titulo}\n\n` + data.map((m) => `**${m.rol === 'user' ? 'Tú' : 'Elio'}** · ${new Date(m.creado).toLocaleString('es-PE')}\n\n${m.contenido}`).join('\n\n---\n\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/markdown;charset=utf-8' }));
    a.download = titulo.replace(/[^\p{L}\p{N} _-]+/gu, '').slice(0, 50).trim() + '.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return;
  }
  if (op === 'borrar') {
    if (!confirm('¿Borrar este chat? No se puede deshacer.')) return;
    const { error } = await sb.from('conversaciones').delete().eq('id', id);
    if (error) return toast('No se pudo borrar.');
    if (E.conv === id) nuevoChat();
    if (proyecto) { await cargarProyectos(); verProyecto(proyecto); } else { E.chats = E.chats.filter((x) => x.id !== id); pintarChats(); }
  }
});

// ---------- Aviso de cookies (solo almacenamiento necesario; se muestra una vez) ----------
(() => {
  let visto = null; try { visto = localStorage.getItem('flexgo-aviso-cookies'); } catch (e) {}
  if (visto === 'v1') return;
  $('#aviso-cookies').hidden = false;
  $('#cookies-ok').addEventListener('click', () => { try { localStorage.setItem('flexgo-aviso-cookies', 'v1'); } catch (e) {} $('#aviso-cookies').hidden = true; });
})();

// ---------- ¿Por qué Elio? Comparativa y reseñas reales ----------
const estrellasTxt = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
async function leerResenas() {
  if (!sb) return null;
  const { data, error } = await sb.rpc('elio_resenas_publicas');
  return error ? null : data;
}
async function cargarResumenPorque() {
  const d = await leerResenas();
  $('#porque-resumen').textContent = d?.total ? `${Number(d.promedio).toFixed(1)} de 5 · ${d.total} reseña${d.total === 1 ? '' : 's'} real${d.total === 1 ? '' : 'es'}` : 'Reseñas reales';
  return d;
}
$('#abrir-porque').addEventListener('click', async () => {
  $('#porque').classList.remove('oculto');
  $('#porque-resenas').innerHTML = '<p class="nota">Cargando…</p>';
  const d = await cargarResumenPorque();
  $('#porque-prom').textContent = d?.total ? `${estrellasTxt(d.promedio)} ${Number(d.promedio).toFixed(1)} de 5 (${d.total})` : '';
  $('#porque-resenas').innerHTML = d?.total
    ? d.resenas.map((r) => `<div class="b-doc"><div class="b-doc-cab"><b>${esc(r.nombre)} · <span class="estrellas-ver">${estrellasTxt(r.estrellas)}</span></b><small>${NOMBRE_PLAN[r.plan] || ''} · ${esc(r.fecha || '')}</small></div><p>${esc(r.texto)}</p></div>`).join('')
    : '<p class="nota">Todavía no hay reseñas publicadas. Elio es nuevo: sé de los primeros en opinar.</p>';
});
async function abrirResena() {
  $('#menu-usuario').classList.add('oculto'); $('#porque').classList.add('oculto');
  if (!E.sesion) return pedirCuenta('Crea tu cuenta gratis o inicia sesión para dejar tu reseña.');
  $('#resena').classList.remove('oculto');
  const { data } = await sb.from('resenas').select('estrellas,texto,estado').maybeSingle();
  const est = { pendiente: 'Tu reseña está en revisión. Si la cambias, vuelve a revisión.', aprobada: 'Tu reseña está publicada. ¡Gracias! Si la cambias, vuelve a revisión.', rechazada: 'Tu reseña no se publicó (por ejemplo, por datos personales o insultos). Puedes escribirla de nuevo.' };
  $('#resena-estado').textContent = data ? est[data.estado] : 'Cuéntanos con sinceridad cómo te va con Elio. Revisamos cada reseña antes de mostrarla.';
  $('#resena-borrar').hidden = !data;
  if (data) { $('#resena-texto').value = data.texto; const r = $(`#resena-form input[value="${data.estrellas}"]`); if (r) r.checked = true; }
}
$('#ver-resena').addEventListener('click', abrirResena);
$('#porque-opinar').addEventListener('click', abrirResena);
$('#resena-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const est = Number($('#resena-form input[name=estrellas]:checked')?.value || 0);
  const { error } = await sb.rpc('elio_guardar_resena', { estrellas: est, texto: $('#resena-texto').value, publicar: $('#resena-publicar').checked });
  if (error) return toast(error.message);
  $('#resena').classList.add('oculto'); toast('¡Gracias! Revisaremos tu reseña y la publicaremos pronto ✔');
});
$('#resena-borrar').addEventListener('click', async () => {
  if (!confirm('¿Borrar tu reseña?')) return;
  const { error } = await sb.rpc('elio_borrar_resena');
  if (error) return toast('No se pudo borrar.');
  $('#resena').classList.add('oculto'); $('#resena-form').reset(); toast('Reseña borrada ✔'); cargarResumenPorque();
});
cargarResumenPorque();

// ---------- Dispositivos (Libre 2 · Impulso 3 · Ultra 2 por persona) ----------
function nombreDispositivo() {
  const ua = navigator.userAgent;
  const tipo = /iPhone|Android.+Mobile/i.test(ua) ? 'Celular' : /iPad|Tablet|Android/i.test(ua) ? 'Tablet' : 'Computadora';
  const so = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|Mac OS/i.test(ua) ? (/(iPhone|iPad)/i.test(ua) ? 'iOS' : 'Mac') : /Windows/i.test(ua) ? 'Windows' : /Linux/i.test(ua) ? 'Linux' : '';
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${tipo}${so ? ' ' + so : ''} · ${nav}`;
}
async function registrarDispositivo() {
  if (!sb || DEMO || !E.sesion) return true;
  const { data, error } = await sb.rpc('elio_mi_dispositivo', { dispositivo: idDispositivo(), nombre: nombreDispositivo() });
  if (error) { toast(error.message); return false; }
  if (data?.ok) { E.dispositivoId = data.id; return true; }
  if (data?.motivo === 'cerrado') {
    toast('Cerraste la sesión de este dispositivo desde otro. Vuelve a iniciar sesión.');
    try { localStorage.removeItem('elio_dispositivo'); } catch (e) {}
    await sb.auth.signOut(); return false;
  }
  abrirDispositivos(`Llegaste al máximo de ${data?.max ?? ''} dispositivos de tu plan. Cierra la sesión de uno que ya no uses para usar Elio aquí.`, true);
  return false;
}
async function abrirDispositivos(msg, bloqueante = false) {
  $('#dispositivos').classList.remove('oculto');
  $('#disp-cerrar').hidden = bloqueante;
  $('#disp-msg').textContent = msg || 'Estos son los dispositivos con tu sesión abierta.';
  $('#disp-max').textContent = E.cred?.dispositivos_max ?? 2;
  const { data } = await sb.from('dispositivos').select('id,nombre,activo,ultimo,creado').eq('activo', true).order('ultimo', { ascending: false });
  $('#disp-lista').innerHTML = (data || []).map((d) => `<div class="b-doc"><div class="b-doc-cab"><b>${d.id === E.dispositivoId ? '📍 ' : '💻 '}${esc(d.nombre)}</b><small>${d.id === E.dispositivoId ? 'Este dispositivo' : 'Último uso: ' + new Date(d.ultimo).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}</small>${d.id === E.dispositivoId ? '' : `<button class="boton" type="button" data-cerrar-disp="${d.id}">Cerrar sesión ahí</button>`}</div></div>`).join('') || '<p class="nota">No hay dispositivos.</p>';
}
$('#ver-dispositivos').addEventListener('click', () => { $('#menu-usuario').classList.add('oculto'); abrirDispositivos(); });
$('#disp-lista').addEventListener('click', async (e) => {
  const id = e.target.dataset.cerrarDisp; if (!id) return;
  if (!confirm('¿Cerrar la sesión de Elio en ese dispositivo?')) return;
  const { error } = await sb.rpc('elio_cerrar_dispositivo', { d: Number(id) });
  if (error) return toast('No se pudo cerrar.');
  toast('Sesión cerrada en ese dispositivo ✔');
  if (!E.dispositivoId) { if (await registrarDispositivo()) { $('#dispositivos').classList.add('oculto'); cargarEstado(); return; } }
  abrirDispositivos();
});

// ---------- Compartir Ultra (2 personas) ----------
(() => { const c = new URLSearchParams(location.search).get('invitacion'); if (c) { try { sessionStorage.setItem('elio_invitacion', c); } catch (e) {} history.replaceState(null, '', location.pathname); } })();
async function aceptarInvitacionPendiente() {
  let c = null; try { c = sessionStorage.getItem('elio_invitacion'); } catch (e) {}
  if (!c || !sb || !E.sesion) return;
  try { sessionStorage.removeItem('elio_invitacion'); } catch (e) {}
  const { error } = await sb.rpc('elio_aceptar_ultra', { codigo: c });
  toast(error ? error.message : '¡Listo! Ya compartes Elio Ultra 🎉 Tienes tu propia cuenta y tu espacio privado.');
}
async function abrirCompartir() {
  $('#menu-usuario').classList.add('oculto'); $('#compartir').classList.remove('oculto');
  const { data: c } = await sb.rpc('elio_mi_compartido');
  let html;
  if (c && !c.soy_titular) html = `<p>Compartes el plan Ultra de <b>${esc(c.titular_nombre || 'otra persona')}</b>.</p><button class="boton" type="button" id="comp-salir">Dejar de compartir</button>`;
  else if (c && c.estado === 'activa') html = `<p>Compartes tu Ultra con <b>${esc(c.invitado_nombre || c.correo)}</b> (${esc(c.correo)}).</p><button class="boton" type="button" id="comp-salir">Quitar a esta persona</button>`;
  else html = `${c && c.estado === 'pendiente' ? `<p class="nota">Invitación enviada a <b>${esc(c.correo)}</b>. Esperando que la acepte.</p>` : ''}
    <form id="comp-form" class="a-fila"><input id="comp-correo" type="email" required maxlength="200" placeholder="Correo de la otra persona" aria-label="Correo"><button class="boton principal" type="submit">${c ? 'Reenviar o cambiar' : 'Invitar'}</button></form>
    ${c ? '<button class="boton" type="button" id="comp-salir">Cancelar invitación</button>' : ''}`;
  $('#comp-cuerpo').innerHTML = html;
}
$('#ver-compartir').addEventListener('click', abrirCompartir);
$('#comp-cuerpo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await sb.rpc('elio_invitar_ultra', { correo: $('#comp-correo').value });
  if (error) return toast(error.message);
  toast('Invitación enviada por correo ✔'); abrirCompartir();
});
$('#comp-cuerpo').addEventListener('click', async (e) => {
  if (e.target.id !== 'comp-salir') return;
  if (!confirm('¿Seguro? La otra persona vuelve a su propio plan.')) return;
  const { error } = await sb.rpc('elio_salir_ultra');
  if (error) return toast('No se pudo completar.');
  toast('Listo ✔'); abrirCompartir(); cargarEstado();
});

// ---------- Créditos: medidor visible ----------
const horaCorta = (t) => t ? new Date(t).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '';
const diaCorto = (t) => t ? new Date(t).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'short' }) : '';
function pintarCreditos() {
  const c = E.cred;
  if (!c || E.invitado) { $('#medidor').textContent = ''; return; }
  const quedanV = Math.max(0, c.ventana_max - c.ventana_usado), quedanS = Math.max(0, c.semana_max - c.semana_usado);
  const quedan = Math.min(quedanV, quedanS);
  const renueva = quedanS < quedanV ? `se renueva el ${diaCorto(c.semana_renueva)}` : (c.ventana_renueva ? `se renueva a las ${horaCorta(c.ventana_renueva)}` : 'ventana de 5 horas');
  $('#medidor').textContent = (c.plan === 'libre' && E.motor === 'orbita')
    ? `🪐 Órbita · probadita: te quedan ${c.probadita_restante} de 3 esta semana — `
    : `${MOTORES[E.motor][0]} · te quedan ${quedan} créditos · ${renueva} — `;
  $('#medidor').classList.toggle('poco', quedan < MOTORES[E.motor][1] * 3);
  const barra = (t, usado, max, pie) => `<div class="cupo">${t}: ${usado} de ${max}<div class="b"><i style="width:${Math.min(100, (usado / max) * 100)}%"></i></div><small>${pie}</small></div>`;
  $('#cupos').innerHTML = barra('Créditos (5 horas)', c.ventana_usado, c.ventana_max, c.ventana_renueva ? `Se renuevan a las ${horaCorta(c.ventana_renueva)}` : 'Ventana libre')
    + barra('Esta semana', c.semana_usado, c.semana_max, `Se renueva el ${diaCorto(c.semana_renueva)}`);
}

// ---------- Encuesta (una sola vez, se puede cerrar) ----------
const leerLS = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const ponerLS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
function contarParaEncuesta() {
  if (DEMO || leerLS('elio_encuesta') || E.cred?.encuesta) return;
  const n = Number(leerLS('elio_mensajes_enc') || 0) + 1; ponerLS('elio_mensajes_enc', String(n));
  if (n >= 2) setTimeout(() => $('#encuesta').classList.remove('oculto'), 1500);
}
async function cerrarEncuesta() {
  $('#encuesta').classList.add('oculto'); ponerLS('elio_encuesta', 'cerrada');
  if (sb && E.sesion) sb.rpc('elio_encuesta_cerrar');
}
$('#enc-cerrar').addEventListener('click', cerrarEncuesta);
$('#enc-no').addEventListener('click', cerrarEncuesta);
$$('.enc-op').forEach((g) => g.addEventListener('change', (e) => {
  const max = Number(g.dataset.max); const marcados = g.querySelectorAll('input:checked');
  if (max > 1 && marcados.length > max) { e.target.checked = false; toast(`Puedes marcar hasta ${max}.`); }
}));
$('#enc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const val = (gr) => [...$(`[data-grupo=${gr}]`).querySelectorAll('input:checked')].map((i) => i.value);
  const r = { usa: val('usa'), para: val('para'), falta: val('falta'), pagaria: val('pagaria')[0] || null, comentario: $('#enc-comentario').value.trim(), vincular: $('#enc-vincular').checked };
  if (!r.usa.length && !r.para.length && !r.falta.length && !r.pagaria) return toast('Marca al menos una respuesta.');
  if (sb && !DEMO) { const { error } = await sb.rpc('elio_encuesta_responder', r); if (error) return toast(error.message); }
  $('#encuesta').classList.add('oculto'); ponerLS('elio_encuesta', 'hecha'); toast('¡Gracias! Tus respuestas nos ayudan a mejorar Elio ✔');
});
$('#b-modos').addEventListener('click', (e) => { e.stopPropagation(); $('#niveles').classList.toggle('oculto'); });
$('#chip-modo').addEventListener('click', (e) => { e.stopPropagation(); $('#niveles').classList.toggle('oculto'); });
$$('[data-pronto]').forEach((b) => b.addEventListener('click', () => toast(`${b.dataset.pronto}: muy pronto en Elio.`)));
$('#campana').addEventListener('click', () => toast('No tienes notificaciones nuevas.'));
$('#apps').addEventListener('click', (e) => { e.stopPropagation(); $('#menu-apps').classList.toggle('oculto'); });
$('#tarjeta-usuario').addEventListener('click', (e) => { e.stopPropagation(); $('#menu-usuario').classList.toggle('oculto'); });
addEventListener('click', (e) => {
  if (!e.target.closest('#niveles')) $('#niveles').classList.add('oculto');
  if (!e.target.closest('#menu-apps')) $('#menu-apps').classList.add('oculto');
  if (!e.target.closest('#menu-usuario')) $('#menu-usuario').classList.add('oculto');
});
addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); nuevoChat(); $('#texto').focus(); } });
$('#m-inicio').addEventListener('click', () => { nuevoChat(); });

// Adjuntos
$('#archivo').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (E.invitado) return pedirCuenta('Crea tu cuenta para subir archivos.');
  if ((E.estado?.plan || 'libre') === 'libre') { toast('Subir archivos está en los planes Impulso y Ultra.'); return abrirPlanes(); }
  if (f.size > 10 * 1024 * 1024) return toast('El archivo pesa más de 10 MB.');
  if (f.type === 'application/pdf') {
    // Modo MarkItDown: el PDF se convierte a texto UNA vez y se guarda en tu Biblioteca; en el chat solo viajan los fragmentos que sirven.
    $('#adjunto-nombre').textContent = '📎 Leyendo ' + f.name + '…'; $('#adjunto-vista').classList.remove('oculto');
    try {
      const ruta = `${E.sesion.user.id}/${crypto.randomUUID()}.pdf`;
      const { error } = await sb.storage.from('biblioteca').upload(ruta, f, { contentType: 'application/pdf', upsert: false });
      if (error) throw new Error('No se pudo subir el PDF. Inténtalo de nuevo.');
      const j = await llamarBiblioteca({ accion: 'procesar', ruta, nombre: f.name });
      E.adjunto = { documento: j.documento.id, nombre: j.documento.nombre };
      $('#adjunto-nombre').textContent = `📎 ${f.name} · ${j.documento.paginas} pág. · listo (también queda en tu Biblioteca)`;
    } catch (err) { quitarAdjunto(); toast(err.message); }
    return;
  }
  const datos = await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = mal; r.readAsDataURL(f); });
  E.adjunto = { tipo: f.type, nombre: f.name.slice(0, 100), datos };
  $('#adjunto-nombre').textContent = '📎 ' + f.name; $('#adjunto-vista').classList.remove('oculto');
});
function quitarAdjunto() { E.adjunto = null; $('#adjunto-vista').classList.add('oculto'); }
$('#quitar-adjunto').addEventListener('click', quitarAdjunto);

function guardarRestantes() { try { localStorage.setItem('elio_restantes_' + new Date().toDateString(), String(E.restantes)); } catch (e) {} }

// ---------- Planes y pago ----------
function abrirPlanes() {
  $$('.tarjeta').forEach((t) => t.classList.toggle('actual', t.dataset.plan === (E.estado?.plan || 'libre')));
  $('#planes').classList.remove('oculto');
}
$('#ver-planes').addEventListener('click', abrirPlanes);
let planElegido = null;
$$('[data-comprar]').forEach((b) => b.addEventListener('click', () => {
  if (E.estado?.pago_pendiente) { toast('Ya tienes un pago en revisión. Te avisamos al activarlo.'); return; }
  planElegido = b.dataset.comprar;
  $('#pago-plan').textContent = NOMBRE_PLAN[planElegido]; $('#pago-monto').textContent = PRECIOS[planElegido].toFixed(2);
  $('#pago-aviso').textContent = ''; $('#planes').classList.add('oculto'); $('#pago').classList.remove('oculto');
}));
$('#f-pago').addEventListener('submit', async (e) => {
  e.preventDefault();
  const op = e.target.operacion.value.replace(/\s/g, '');
  if (!/^[0-9A-Za-z-]{4,30}$/.test(op)) { $('#pago-aviso').textContent = 'Revisa el número de operación.'; return; }
  if (sb) {
    const { error } = await sb.from('pagos').insert({ usuario: E.sesion.user.id, plan: planElegido, meses: 1, monto: PRECIOS[planElegido], operacion: op });
    if (error) { $('#pago-aviso').textContent = 'No se pudo enviar. Inténtalo de nuevo.'; return; }
  }
  e.target.reset(); $('#pago').classList.add('oculto');
  toast('¡Gracias! Revisamos tu pago y activamos tu plan muy pronto.'); cargarEstado();
});
$$('[data-cerrar]').forEach((b) => b.addEventListener('click', () => b.closest('.modal').classList.add('oculto')));
$$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m && m.id !== 'nueva-clave') m.classList.add('oculto'); }));
addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal').forEach((m) => m.id !== 'nueva-clave' && m.classList.add('oculto')); });

// ---------- Trabajos académicos: referencias reales en APA 7, Vancouver e ISO 690 (sin IA) ----------
const TOPE_REF = { libre: 10, impulso: 300, ultra: 1000 };
const it = (x) => `<i>${esc(x)}</i>`;
function autoresDe(txt) {
  return String(txt || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [ap, ...rest] = l.split(',');
    const nom = rest.join(',').trim();
    return nom ? { ap: ap.trim(), nom } : { org: ap.trim() };
  });
}
const iniciales = (nom, punto = true) => nom.split(/[\s-]+/).filter(Boolean).map((n) => n[0].toUpperCase() + (punto ? '.' : '')).join(punto ? ' ' : '');
function autoresAPA(l) {
  const f = l.map((a) => a.org ? esc(a.org) : `${esc(a.ap)}, ${iniciales(a.nom)}`);
  if (!f.length) return '';
  if (f.length === 1) return f[0];
  if (f.length <= 20) return f.slice(0, -1).join(', ') + ', &amp; ' + f[f.length - 1];
  return f.slice(0, 19).join(', ') + ', . . . ' + f[f.length - 1];
}
function autoresVan(l) {
  const f = l.map((a) => a.org ? esc(a.org) : `${esc(a.ap)} ${iniciales(a.nom, false)}`);
  return f.length > 6 ? f.slice(0, 6).join(', ') + ', et al' : f.join(', ');
}
function autoresISO(l) {
  return l.map((a) => a.org ? esc(a.org.toUpperCase()) : `${esc(a.ap.toUpperCase())}, ${esc(a.nom)}`).join('; ');
}
const enlace = (u) => { u = String(u || '').trim(); if (!u) return ''; if (/^10\.\d{4,}\//.test(u)) u = 'https://doi.org/' + u; return /^https?:\/\//i.test(u) ? esc(u) : ''; };
const fin = (x) => x && !/[.?!]$/.test(x) ? x + '.' : x;
function formatoRef(tipo, d, estilo) {
  const A = autoresDe(d.autores), anio = esc(d.anio || 's.f.'), T = esc(d.titulo || ''), F = esc(d.fuente || ''), X = esc(d.extra || '');
  const V = esc(d.vol || ''), N = esc(d.num || ''), P = esc(d.pags || ''), U = enlace(d.url);
  if (estilo === 'vancouver') {
    const au = autoresVan(A);
    if (tipo === 'articulo') return `${au ? au + '. ' : ''}${fin(T)} ${F}. ${anio}${V ? ';' + V : ''}${N ? '(' + N + ')' : ''}${P ? ':' + P : ''}.${U ? ' ' + U : ''}`;
    if (tipo === 'capitulo') return `${au ? au + '. ' : ''}${fin(T)} En: ${X}. ${F}; ${anio}.${P ? ' p. ' + P + '.' : ''}${U ? ' ' + U : ''}`;
    if (tipo === 'web') return `${au ? au + '. ' : ''}${T} [Internet]. ${F ? F + '; ' : ''}${anio}. Disponible en: ${U}`;
    if (tipo === 'tesis') return `${au ? au + '. ' : ''}${T} [${X || 'Tesis'}]. ${F}; ${anio}.${U ? ' Disponible en: ' + U : ''}`;
    return `${au ? au + '. ' : ''}${fin(T)} ${F}; ${anio}.${U ? ' ' + U : ''}`;
  }
  if (estilo === 'iso') {
    const au = autoresISO(A);
    if (tipo === 'articulo') return `${au ? au + '. ' : ''}${fin(T)} ${it(d.fuente || '')}. ${anio}${V ? ', vol. ' + V : ''}${N ? ', n.º ' + N : ''}${P ? ', pp. ' + P : ''}.${U ? ' Disponible en: ' + U : ''}`;
    if (tipo === 'capitulo') return `${au ? au + '. ' : ''}${fin(T)} En: ${it(d.extra || '')}. ${F}, ${anio}${P ? ', pp. ' + P : ''}.${U ? ' Disponible en: ' + U : ''}`;
    if (tipo === 'web') return `${au ? au + '. ' : ''}${it(d.titulo || '')} [en línea]. ${F ? F + ', ' : ''}${anio}. Disponible en: ${U}`;
    if (tipo === 'tesis') return `${au ? au + '. ' : ''}${it(d.titulo || '')}. ${X || 'Tesis'}. ${F}, ${anio}.${U ? ' Disponible en: ' + U : ''}`;
    return `${au ? au + '. ' : ''}${it(d.titulo || '')}. ${F}, ${anio}.${U ? ' Disponible en: ' + U : ''}`;
  }
  const au = autoresAPA(A);
  const quien = au ? (/\.$/.test(au) ? au : au + '.') + ' ' : '';
  if (tipo === 'articulo') return `${quien}(${anio}). ${fin(T)} ${it(d.fuente || '')}${V ? ', ' + it(d.vol) : ''}${N ? '(' + N + ')' : ''}${P ? ', ' + P : ''}.${U ? ' ' + U : ''}`;
  if (tipo === 'capitulo') return `${quien}(${anio}). ${fin(T)} En ${it(d.extra || '')}${P ? ' (pp. ' + P + ')' : ''}. ${fin(F)}${U ? ' ' + U : ''}`;
  if (tipo === 'web') return `${quien}(${anio}). ${it(d.titulo || '')}. ${F ? fin(F) + ' ' : ''}${U}`;
  if (tipo === 'tesis') return `${quien}(${anio}). ${it(d.titulo || '')} [${X || 'Tesis'}, ${F}].${U ? ' ' + U : ''}`;
  return `${quien}(${anio}). ${it(d.titulo || '')}. ${fin(F)}${U ? ' ' + U : ''}`;
}
const leerForm = () => ({ autores: $('#r-autores').value, anio: $('#r-anio').value.trim(), titulo: $('#r-titulo').value.trim(), fuente: $('#r-fuente').value.trim(), extra: $('#r-extra').value.trim(), vol: $('#r-vol').value.trim(), num: $('#r-num').value.trim(), pags: $('#r-pags').value.trim(), url: $('#r-url').value.trim() });
const estiloDe = (n) => document.querySelector(`input[name=${n}]:checked`)?.value || 'apa';
function previa() { const d = leerForm(); $('#r-previa').innerHTML = d.titulo ? formatoRef($('#r-tipo').value, d, estiloDe('r-estilo')) : 'Completa los datos para ver la referencia.'; }
['#r-form', '.r-vista'].forEach((sel) => $(sel).addEventListener('input', previa));
$('#r-form').addEventListener('change', previa); $$('input[name=r-estilo]').forEach((r) => r.addEventListener('change', previa));
$('#m-academico').addEventListener('click', () => {
  if (!E.sesion) return pedirCuenta('Crea tu cuenta gratis para guardar tus referencias y usar los formatos.');
  cerrarLateral(); $('#academico').classList.remove('oculto'); contarRefs(); pintarFormatos();
});
$$('[data-apest]').forEach((b) => b.addEventListener('click', () => {
  $$('[data-apest]').forEach((x) => x.classList.toggle('on', x === b));
  ['citar', 'lista', 'formatos'].forEach((k) => $('#ac-' + k).classList.toggle('oculto', b.dataset.apest !== k));
  if (b.dataset.apest === 'lista') cargarRefs();
  if (b.dataset.apest === 'formatos') pintarFormatos();
}));
async function contarRefs() { const { count } = await sb.from('referencias').select('id', { count: 'exact', head: true }); $('#r-cupo').textContent = `${count || 0} de ${TOPE_REF[E.estado?.plan] || 20} guardadas`; }
$('#r-buscar').addEventListener('click', async () => {
  const doi = $('#r-doi').value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (!/^10\.\d{4,}\/\S+$/.test(doi)) return toast('Escribe un DOI válido, por ejemplo 10.1016/j.ejor.2020.01.001');
  const btn = $('#r-buscar'); btn.disabled = true; btn.textContent = 'Buscando…';
  try {
    const r = await fetch('https://api.crossref.org/works/' + encodeURIComponent(doi));
    if (!r.ok) throw new Error('No encontramos ese DOI en Crossref. Revisa que esté bien escrito.');
    const m = (await r.json()).message || {};
    const tipo = { 'journal-article': 'articulo', 'book': 'libro', 'monograph': 'libro', 'book-chapter': 'capitulo', 'dissertation': 'tesis' }[m.type] || 'articulo';
    $('#r-tipo').value = tipo;
    $('#r-autores').value = (m.author || []).map((a) => a.family ? `${a.family}, ${a.given || ''}`.trim() : (a.name || '')).filter(Boolean).join('\n');
    $('#r-anio').value = String((m.issued?.['date-parts']?.[0]?.[0]) || (m.published?.['date-parts']?.[0]?.[0]) || '');
    $('#r-titulo').value = (m.title || [''])[0];
    $('#r-fuente').value = tipo === 'articulo' ? (m['container-title'] || [''])[0] : (m.publisher || '');
    $('#r-extra').value = tipo === 'capitulo' ? (m['container-title'] || [''])[0] : '';
    $('#r-vol').value = m.volume || ''; $('#r-num').value = m.issue || ''; $('#r-pags').value = (m.page || '').replace('-', '–');
    $('#r-url').value = 'https://doi.org/' + (m.DOI || doi);
    previa(); toast('Datos encontrados en Crossref ✔ Revísalos antes de guardar.');
  } catch (err) { toast(err.message || 'No se pudo buscar el DOI. Inténtalo de nuevo.'); } finally { btn.disabled = false; btn.textContent = 'Buscar datos'; }
});
$('#r-limpiar').addEventListener('click', () => { $('#r-form').reset(); $('#r-doi').value = ''; previa(); });
$('#r-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = leerForm();
  if (!d.titulo || (!d.autores.trim() && !d.fuente)) return toast('Escribe al menos el título y el autor (o la organización).');
  const { error } = await sb.from('referencias').insert({ tipo: $('#r-tipo').value, datos: d });
  if (error) return toast(/máximo/.test(error.message) ? error.message : 'No se pudo guardar.');
  toast('Referencia guardada ✔'); $('#r-form').reset(); $('#r-doi').value = ''; previa(); contarRefs();
});
let refsCache = [];
async function cargarRefs() {
  $('#l-lista').innerHTML = '<p class="nota">Cargando…</p>';
  const { data } = await sb.from('referencias').select('id,tipo,datos,creado').order('creado');
  refsCache = data || []; pintarRefs();
}
function refsOrdenadas() {
  const estilo = estiloDe('l-estilo');
  const l = refsCache.map((r) => ({ id: r.id, html: formatoRef(r.tipo, r.datos, estilo), orden: (r.datos.autores || r.datos.titulo || '').toLowerCase() }));
  return estilo === 'vancouver' ? l : l.sort((a, b) => a.orden.localeCompare(b.orden, 'es'));
}
function pintarRefs() {
  const estilo = estiloDe('l-estilo'), l = refsOrdenadas();
  $('#l-lista').innerHTML = l.length ? l.map((r, i) => `<div class="b-doc r-item"><div class="b-doc-cab"><span class="r-texto">${estilo === 'vancouver' ? (i + 1) + '. ' : ''}${r.html}</span><button class="icono b-borrar" data-borrar-ref="${r.id}" title="Borrar" aria-label="Borrar referencia">🗑</button></div></div>`).join('')
    : '<p class="nota">Aún no guardas referencias. Agrégalas en «Citar una fuente».</p>';
}
$$('input[name=l-estilo]').forEach((r) => r.addEventListener('change', pintarRefs));
$('#l-lista').addEventListener('click', async (e) => {
  const id = e.target.dataset.borrarRef; if (!id) return;
  if (!confirm('¿Borrar esta referencia?')) return;
  const { error } = await sb.from('referencias').delete().eq('id', Number(id));
  if (error) return toast('No se pudo borrar.');
  cargarRefs(); contarRefs();
});
$('#l-copiar').addEventListener('click', async () => {
  const estilo = estiloDe('l-estilo'), l = refsOrdenadas(); if (!l.length) return toast('No hay referencias para copiar.');
  const html = l.map((r, i) => `<p style="padding-left:1.27cm;text-indent:-1.27cm">${estilo === 'vancouver' ? (i + 1) + '. ' : ''}${r.html}</p>`).join('');
  const tmp = document.createElement('div'); tmp.innerHTML = html; const texto = [...tmp.querySelectorAll('p')].map((p) => p.textContent).join('\n');
  try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([texto], { type: 'text/plain' }) })]); }
  catch (err) { await navigator.clipboard.writeText(texto); }
  toast('Lista copiada ✔ Pégala en Word o Google Docs (conserva las cursivas).');
});
// Formatos verificados en guías oficiales (26-nov-2026). Solo lo que dice cada guía; nada inventado.
const FORMATOS = [
  { u: 'Formato general APA 7 (trabajo de estudiante)', f: 'Guía oficial de APA Style: «Title page setup» y «Paper format»', url: 'https://apastyle.apa.org/style-grammar-guidelines/paper-format/title-page',
    partes: ['Carátula: título, nombre del autor, institución (afiliación), curso, docente y fecha de entrega', 'Cuerpo del trabajo (introducción, desarrollo y conclusiones, según lo que pida tu docente)', 'Referencias (en orden alfabético, con sangría francesa)'] },
  { u: 'USMP · Facultad de Ingeniería y Arquitectura — Informe final de tesis (enfoque cuantitativo)', f: 'Manual para la elaboración de las tesis y los trabajos de investigación (USMP, 2022)', url: 'https://fia.usmp.edu.pe/wp-content/uploads/2026/01/MANUAL-ELABORACION-TESIS.pdf',
    partes: ['Portada', 'Dedicatoria (optativa)', 'Agradecimientos (optativo)', 'Reporte de similitud', 'Declaración de originalidad', 'Índices: de contenido, y de tablas y figuras (optativo)', 'Resumen – Abstract', 'Introducción', 'Capítulo I: Marco teórico', 'Capítulo: Hipótesis y variables (investigaciones cuantitativas)', 'Capítulo: Metodología de la investigación', 'Capítulo: Resultados', 'Capítulo: Discusión', 'Conclusiones', 'Recomendaciones (solo si proceden)', 'Fuentes de información', 'Anexos (si son necesarios)'] },
  { u: 'UPAO · Facultad de Medicina Humana — Informe de tesis', f: 'Normas para la inscripción del proyecto de investigación e informe de tesis (UPAO, 2017). Citas en estilo Vancouver', url: 'https://upao.edu.pe/pdf/NORMAS%20PARA%20LA%20INSCRIPCION%20DEL%20PROYECTO%20DE%20INVESTIGACI%C3%93N%20E%20INFORME%20DE%20TESIS.pdf',
    partes: ['Página del título', 'Resumen', 'Summary o Abstract', 'Introducción', 'Material y métodos', 'Resultados (tablas, gráficos y figuras)', 'Discusión', 'Referencias bibliográficas (Vancouver)', 'Anexos'] },
  { u: 'UCV — Presentación de productos de investigación en APA 7', f: 'Manual de presentación de productos de investigación alineados a normas APA 7ma edición (UCV, 2023)', url: 'https://hdl.handle.net/20.500.12692/144461',
    partes: ['Este manual regula el formato APA 7: disposición general, tablas y figuras, citas y referencias', 'La estructura de capítulos de tu tesis la define la guía de tu escuela: consúltala con tu asesor'] },
  { u: 'UNSM (Tarapoto)', f: 'En verificación: aún no pudimos revisar la guía oficial vigente', url: '', pronto: true, partes: [] },
];
function pintarFormatos() {
  $('#f-lista').innerHTML = FORMATOS.map((f, i) => `<div class="b-doc"><div class="b-doc-cab"><b>🏛️ ${esc(f.u)}</b>${f.pronto ? '<em class="pronto-tag">Muy pronto</em>' : `<button class="boton" type="button" data-copiar-formato="${i}">Copiar esquema</button>`}</div>
    <p class="nota">Fuente: ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.f)} ↗</a>` : esc(f.f)}</p>
    ${f.partes.length ? `<ol class="f-partes">${f.partes.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}</div>`).join('');
}
$('#f-lista').addEventListener('click', (e) => {
  const i = e.target.dataset.copiarFormato; if (i === undefined) return;
  const f = FORMATOS[Number(i)];
  navigator.clipboard.writeText(`${f.u}\nFuente: ${f.f}${f.url ? ' — ' + f.url : ''}\n\n` + f.partes.map((p, n) => `${n + 1}. ${p}`).join('\n')).then(() => toast('Esquema copiado ✔'));
});

// ---------- Mi día ----------
const fechaBonita = (f) => new Date(f + 'T12:00').toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', ...(f.slice(0, 4) !== String(new Date().getFullYear()) ? { year: 'numeric' } : {}) });
$('#m-herramientas').addEventListener('click', () => {
  if (!E.sesion) return pedirCuenta('Crea tu cuenta gratis para guardar tus tareas y recordatorios en Mi día.');
  cerrarLateral(); abrirMiDia();
});
async function abrirMiDia() {
  $('#midia').classList.remove('oculto');
  $('#md-lista').innerHTML = '<p class="nota">Cargando…</p>';
  const hasta = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const [{ data: est }, { data: tareas }, { data: venc }] = await Promise.all([
    sb.rpc('elio_mi_dia_estado'),
    sb.from('tareas').select('id,texto,fecha,hora,hecha,hecha_en').order('fecha', { ascending: true, nullsFirst: false }).order('hora', { nullsFirst: false }).limit(600),
    sb.from('vencimientos').select('que,fecha').lte('fecha', hasta).order('fecha'),
  ]);
  const hoy = est?.hoy || new Date().toISOString().slice(0, 10);
  const pago = ['impulso', 'ultra'].includes(est?.plan);
  $('#md-correo').checked = !!est?.correo; $('#md-correo').disabled = !pago;
  $('#md-correo-nota').textContent = pago ? 'Tus tareas del día y los vencimientos de tu Biblioteca. Solo llega si ese día hay algo.' : 'Disponible en los planes Impulso y Ultra.';
  const pend = (tareas || []).filter((t) => !t.hecha);
  const hechasHoy = (tareas || []).filter((t) => t.hecha && (t.hecha_en || '').slice(0, 10) >= hoy);
  $('#md-cupo').textContent = `${pend.length} de ${est?.tope ?? 20} tareas pendientes`;
  const fila = (t) => `<label class="md-tarea ${t.hecha ? 'hecha' : ''}"><input type="checkbox" data-hecha="${t.id}" ${t.hecha ? 'checked' : ''}><span>${esc(t.texto)}${t.hora ? ` <small>${t.hora.slice(0, 5)}</small>` : ''}${t.fecha && t.fecha > hoy ? ` <small>${fechaBonita(t.fecha)}</small>` : ''}</span><button type="button" class="icono" data-quitar="${t.id}" aria-label="Borrar tarea" title="Borrar">✕</button></label>`;
  const grupo = (titulo, l, clase = '') => l.length ? `<h3 class="${clase}">${titulo}</h3>${l.map(fila).join('')}` : '';
  const vs = (venc || []).filter((v) => v.fecha >= hoy);
  $('#md-lista').innerHTML =
    grupo('Atrasadas', pend.filter((t) => t.fecha && t.fecha < hoy), 'atrasada') +
    grupo('Hoy', pend.filter((t) => t.fecha === hoy)) +
    grupo('Próximas', pend.filter((t) => t.fecha && t.fecha > hoy)) +
    grupo('Sin fecha', pend.filter((t) => !t.fecha)) +
    (vs.length ? `<h3>Vencimientos de tu Biblioteca</h3>${vs.map((v) => `<div class="md-venc">📅 ${esc(v.que)} · ${fechaBonita(v.fecha)}</div>`).join('')}` : '') +
    grupo('Hechas hoy', hechasHoy) ||
    '<p class="nota">No tienes tareas. Escribe la primera arriba.</p>';
}
$('#md-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('#md-texto').value.trim(); if (texto.length < 3) return;
  const btn = e.submitter || e.target.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    const j = await llamarBiblioteca({ accion: 'tarea', texto });
    $('#md-texto').value = '';
    toast(`Anotado ✔ ${j.tarea.texto}${j.tarea.fecha ? ' · ' + fechaBonita(j.tarea.fecha) : ''}`);
    abrirMiDia();
  } catch (err) { toast(err.message); } finally { btn.disabled = false; }
});
$('#md-lista').addEventListener('change', async (e) => {
  const id = e.target.dataset.hecha; if (!id) return;
  const { error } = await sb.from('tareas').update({ hecha: e.target.checked }).eq('id', Number(id));
  if (error) { e.target.checked = !e.target.checked; return toast('No se pudo guardar.'); }
  abrirMiDia();
});
$('#md-lista').addEventListener('click', async (e) => {
  const id = e.target.closest('[data-quitar]')?.dataset.quitar; if (!id) return;
  e.preventDefault();
  const { error } = await sb.from('tareas').delete().eq('id', Number(id));
  if (error) return toast('No se pudo borrar.');
  abrirMiDia();
});
$('#md-correo').addEventListener('change', async (e) => {
  const { error } = await sb.rpc('elio_mi_dia_correo', { activar: e.target.checked });
  if (error) { e.target.checked = !e.target.checked; return toast(error.message); }
  toast(e.target.checked ? 'Listo: cada mañana a las 7:00 te llega tu resumen ✔' : 'Resumen de la mañana apagado');
});

// ---------- Biblioteca (segundo cerebro) ----------
const CUPOS_BIB = { libre: { docs: 3, mb: 25, archivo: 5, preguntas: 5 }, impulso: { docs: 100, mb: 500, archivo: 10, preguntas: 40 }, ultra: { docs: 400, mb: 2048, archivo: 20, preguntas: 100 } };
async function llamarBiblioteca(cuerpo) {
  const { data } = await sb.auth.getSession();
  const r = await fetch(`${CFG.SUPABASE_URL}/functions/v1/elio-biblioteca`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_KEY, 'x-elio-dispositivo': idDispositivo(), Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (j.codigo === 'dispositivo') abrirDispositivos(j.mensaje);
  if (!r.ok) throw new Error(j.mensaje || 'No se pudo completar. Inténtalo de nuevo.');
  return j;
}
$('#m-biblioteca').addEventListener('click', () => {
  if (!E.sesion) return pedirCuenta('Crea tu cuenta gratis para guardar tus documentos en tu Biblioteca.');
  cerrarLateral(); abrirBiblioteca();
});
async function abrirBiblioteca() {
  $('#biblioteca').classList.remove('oculto');
  $('#b-estado').textContent = ''; $('#b-lista').innerHTML = '<p class="nota">Cargando…</p>';
  const [{ data: docs }, { data: venc }] = await Promise.all([
    sb.from('documentos').select('id,nombre,paginas,resumen,estado,bytes,creado').order('creado', { ascending: false }),
    sb.from('vencimientos').select('id,documento,que,fecha,avisar,dias_antes').order('fecha'),
  ]);
  const C = CUPOS_BIB[E.estado?.plan] || CUPOS_BIB.libre;
  const mb = (docs || []).reduce((a, d) => a + d.bytes, 0) / 1048576;
  $('#b-cupos').textContent = `${(docs || []).length} de ${C.docs} documentos · ${mb.toFixed(1)} de ${C.mb >= 1024 ? C.mb / 1024 + ' GB' : C.mb + ' MB'} · ${C.preguntas} preguntas al día`;
  const hoy = new Date().toISOString().slice(0, 10);
  $('#b-lista').innerHTML = (docs || []).length ? docs.map((d) => {
    const vs = (venc || []).filter((v) => v.documento === d.id && v.fecha >= hoy);
    return `<div class="b-doc" data-id="${d.id}">
      <div class="b-doc-cab"><b>${d.estado === 'listo' ? '📄' : '⏳'} ${esc(d.nombre)}</b><small>${d.paginas} pág. · ${new Date(d.creado).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}</small><button class="icono b-borrar" data-borrar="${d.id}" title="Borrar documento" aria-label="Borrar documento">🗑</button></div>
      ${d.resumen ? `<p>${esc(d.resumen)}</p>` : ''}
      ${vs.map((v) => `<label class="b-venc"><input type="checkbox" data-venc="${v.id}" ${v.avisar ? 'checked' : ''}> <span>📅 <b>${esc(v.que)}</b>: vence el ${new Date(v.fecha + 'T12:00').toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })}. Avisarme por correo ${v.dias_antes} días antes</span></label>`).join('')}
    </div>`;
  }).join('') : '<p class="nota">Aún no tienes documentos. Sube el primero con «+ Subir documento».</p>';
}
$('#b-archivo').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const C = CUPOS_BIB[E.estado?.plan] || CUPOS_BIB.libre;
  if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return toast('Solo PDF o imágenes (PNG, JPG, WEBP).');
  if (f.size > C.archivo * 1048576) return toast(`El archivo pesa más de ${C.archivo} MB, el máximo de tu plan.`);
  $('#b-subir-btn').classList.add('ocupado');
  $('#b-estado').textContent = `Subiendo «${f.name}»…`;
  try {
    const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[f.type];
    const ruta = `${E.sesion.user.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('biblioteca').upload(ruta, f, { contentType: f.type, upsert: false });
    if (error) throw new Error('No se pudo subir el archivo. Inténtalo de nuevo.');
    $('#b-estado').textContent = `Elio está leyendo «${f.name}»… (puede tardar unos segundos)`;
    const j = await llamarBiblioteca({ accion: 'procesar', ruta, nombre: f.name });
    const vs = j.vencimientos || [];
    $('#b-estado').textContent = vs.length
      ? `Listo ✔ Encontré ${vs.length === 1 ? 'una fecha importante' : vs.length + ' fechas importantes'}. Marca «Avisarme» si quieres un correo antes de que venza.`
      : 'Listo ✔ Ya puedes preguntarle a Elio sobre este documento.';
    abrirBiblioteca();
  } catch (err) { $('#b-estado').textContent = ''; toast(err.message); }
  finally { $('#b-subir-btn').classList.remove('ocupado'); }
});
$('#b-lista').addEventListener('click', async (e) => {
  const id = e.target.dataset.borrar; if (!id) return;
  if (!confirm('¿Borrar este documento de tu Biblioteca? Se borra el archivo y todo lo que Elio leyó de él.')) return;
  try { await llamarBiblioteca({ accion: 'borrar', documento: id }); toast('Documento borrado ✔'); abrirBiblioteca(); } catch (err) { toast(err.message); }
});
$('#b-lista').addEventListener('change', async (e) => {
  const v = e.target.dataset.venc; if (!v) return;
  const { error } = await sb.rpc('elio_aviso_vencimiento', { v: Number(v), activar: e.target.checked, dias: 15 });
  if (error) { e.target.checked = !e.target.checked; return toast('No se pudo guardar el aviso.'); }
  toast(e.target.checked ? 'Te avisaremos por correo 15 días antes ✔' : 'Aviso apagado');
});
$('#b-preguntar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#b-pregunta').value.trim(); if (q.length < 3) return;
  const caja = $('#b-respuesta'); caja.classList.remove('oculto'); caja.innerHTML = '<p class="nota">Buscando en tus documentos…</p>';
  try {
    const j = await llamarBiblioteca({ accion: 'preguntar', pregunta: q });
    caja.innerHTML = md(j.respuesta) + ((j.fuentes || []).length ? `<p class="b-fuentes">Fuentes: ${j.fuentes.map((f) => f.aprendizaje ? `🧠 «${esc(f.nombre)}»` : `📄 ${esc(f.nombre)}${f.pagina ? ', pág. ' + f.pagina : ''}`).join(' · ')}</p>` : '');
  } catch (err) { caja.innerHTML = `<p class="nota">${esc(err.message)}</p>`; }
});

// ---------- Biblioteca de vida (aprendizajes) ----------
const TOPE_APR = { libre: 20, impulso: 300, ultra: 1000 };
const ICONO_APR = { libro: '📚', articulo: '📰', video: '🎬', curso: '🎓', podcast: '🎧', otro: '✨' };
$$('[data-bpest]').forEach((b) => b.addEventListener('click', () => {
  $$('[data-bpest]').forEach((x) => x.classList.toggle('on', x === b));
  $('#b-docs').classList.toggle('oculto', b.dataset.bpest !== 'docs');
  $('#b-apr').classList.toggle('oculto', b.dataset.bpest !== 'apr');
  $('#b-hist').classList.toggle('oculto', b.dataset.bpest !== 'hist');
  if (b.dataset.bpest === 'apr') cargarAprendizajes();
  if (b.dataset.bpest === 'hist') cargarMemorias();
}));

// ---------- Trae tu historial (fase 1: prompt rápido + memoria aprobada) ----------
const IA = { chatgpt: ['ChatGPT', 'https://chatgpt.com/'], claude: ['Claude', 'https://claude.ai/'], gemini: ['Gemini', 'https://gemini.google.com/'], otro: ['tu otra IA', ''] };
let origenMem = 'chatgpt';
$$('[data-origen]').forEach((b) => b.addEventListener('click', () => {
  origenMem = b.dataset.origen; $$('[data-origen]').forEach((x) => x.classList.toggle('on', x === b));
  const [nombre, url] = IA[origenMem];
  $('#h-abrir').textContent = url ? `Abrir ${nombre} ↗` : '';
  if (url) $('#h-abrir').href = url;
}));
$('#h-copiar').addEventListener('click', () => navigator.clipboard.writeText($('#h-prompt').textContent).then(() => toast('Texto copiado ✔ Pégalo en tu otra IA')));
$('#gancho-historial').addEventListener('click', () => {
  if (!E.sesion) { location.href = 'trae-tu-historial.html'; return; }
  abrirBiblioteca(); $('[data-bpest=hist]').click();
});
async function cargarMemorias() {
  $('#h-lista').innerHTML = '<p class="nota">Cargando…</p>';
  const { data } = await sb.from('memorias').select('id,origen,resumen,estado,ocultos,creado').order('creado', { ascending: false });
  const l = data || [];
  $('#h-lista').innerHTML = l.length ? l.map((m) => `<div class="b-doc" data-mem="${m.id}">
      <div class="b-doc-cab"><b>Desde ${esc(IA[m.origen]?.[0] || 'otra IA')}</b><span class="h-estado ${m.estado}">${m.estado === 'aprobada' ? '✔ Elio la usa' : 'Borrador: revísala'}</span><button class="icono b-borrar" data-borrar-mem="${m.id}" title="Borrar" aria-label="Borrar memoria">🗑</button></div>
      ${m.ocultos ? `<p class="nota">Tapamos ${m.ocultos} dato(s) sensible(s) por tu seguridad.</p>` : ''}
      <textarea rows="6" maxlength="3000">${esc(m.resumen)}</textarea>
      <div class="a-fila fin"><small class="nota">Puedes corregir o quitar lo que quieras.</small><span>${m.estado === 'aprobada' ? '<button class="boton" data-mem-acc="borrador">Dejar de usar</button> <button class="boton principal" data-mem-acc="aprobar">Guardar cambios</button>' : '<button class="boton principal" data-mem-acc="aprobar">Aprobar y usar</button>'}</span></div>
    </div>`).join('') : '<p class="nota">Aún no traes ninguna memoria. Sigue los 3 pasos de arriba.</p>';
}
$('#h-crear').addEventListener('click', async (e) => {
  const texto = $('#h-texto').value.trim(); if (texto.length < 40) return toast('Pega la respuesta completa de tu otra IA.');
  const btn = e.currentTarget; btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Elio está ordenando…';
  try {
    await llamarBiblioteca({ accion: 'memoria', origen: origenMem, texto });
    $('#h-texto').value = ''; toast('Listo ✔ Revisa tu memoria y apruébala para que Elio la use.'); cargarMemorias();
  } catch (err) { toast(err.message); } finally { btn.disabled = false; btn.textContent = txt; }
});
$('#h-lista').addEventListener('click', async (e) => {
  const borrar = e.target.dataset.borrarMem;
  if (borrar) {
    if (!confirm('¿Borrar esta memoria? Elio dejará de usarla.')) return;
    const { error } = await sb.from('memorias').delete().eq('id', Number(borrar));
    if (error) return toast('No se pudo borrar.');
    toast('Memoria borrada ✔'); return cargarMemorias();
  }
  const acc = e.target.dataset.memAcc; if (!acc) return;
  const caja = e.target.closest('[data-mem]');
  const { error } = await sb.rpc('elio_memoria_aprobar', { m: Number(caja.dataset.mem), texto: caja.querySelector('textarea').value, aprobar: acc === 'aprobar' });
  if (error) return toast(error.message);
  toast(acc === 'aprobar' ? 'Aprobada ✔ Elio ya te conoce mejor.' : 'Elio dejó de usar esta memoria.'); cargarMemorias();
});
async function cargarAprendizajes() {
  $('#a-lista').innerHTML = '<p class="nota">Cargando…</p>';
  const { data } = await sb.from('aprendizajes').select('id,tipo,titulo,enlace,resumen,ideas,etiquetas,creado').order('creado', { ascending: false }).limit(300);
  const l = data || [];
  $('#a-cupo').textContent = `${l.length} de ${TOPE_APR[E.estado?.plan] || 20} guardados`;
  $('#a-lista').innerHTML = l.length ? l.map((a) => `<div class="b-doc">
      <div class="b-doc-cab"><b>${ICONO_APR[a.tipo] || '✨'} ${esc(a.titulo)}</b><small>${new Date(a.creado).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}</small><button class="icono b-borrar" data-borrar-apr="${a.id}" title="Borrar" aria-label="Borrar aprendizaje">🗑</button></div>
      ${a.resumen ? `<p>${esc(a.resumen)}</p>` : ''}
      ${(a.ideas || []).length ? `<ul class="a-ideas">${a.ideas.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      <div class="a-pie">${(a.etiquetas || []).map((e) => `<span class="p-serv">#${esc(e)}</span>`).join(' ')}${a.enlace ? ` <a href="${esc(a.enlace)}" target="_blank" rel="noopener nofollow">Abrir enlace ↗</a>` : ''}</div>
    </div>`).join('') : '<p class="nota">Aún no guardas aprendizajes. Anota el primero: un libro, un video o un curso.</p>';
}
$('#a-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter || e.target.querySelector('button[type=submit]'); btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Elio está resumiendo…';
  try {
    await llamarBiblioteca({ accion: 'aprender', tipo: $('#a-tipo').value, titulo: $('#a-titulo').value.trim(), enlace: $('#a-enlace').value.trim(), texto: $('#a-texto').value.trim() });
    $('#a-titulo').value = ''; $('#a-enlace').value = ''; $('#a-texto').value = '';
    toast('Guardado ✔ Ya puedes preguntarle a Elio sobre esto.'); cargarAprendizajes();
  } catch (err) { toast(err.message); } finally { btn.disabled = false; btn.textContent = txt; }
});
$('#a-lista').addEventListener('click', async (e) => {
  const id = e.target.dataset.borrarApr; if (!id) return;
  if (!confirm('¿Borrar este aprendizaje?')) return;
  const { error } = await sb.from('aprendizajes').delete().eq('id', Number(id));
  if (error) return toast('No se pudo borrar.');
  toast('Borrado ✔'); cargarAprendizajes();
});

// ---------- Privacidad y mis datos ----------
const NOMBRE_SERVICIO = { logrin: 'Logrin', creago: 'CreaGo', kivo: 'Kivo', paginas_web: 'Páginas web', eleva: 'Eleva' };
let misDatos = null;
$('#ver-privacidad').addEventListener('click', abrirPrivacidad);
async function abrirPrivacidad() {
  $('#menu-usuario').classList.add('oculto');
  $('#privacidad').classList.remove('oculto');
  $('#p-lista').innerHTML = '<p class="nota">Cargando…</p>';
  if (DEMO) misDatos = { aprende: true, acepta_ofertas: false, intereses: [{ fecha: new Date().toISOString(), rubro: 'bodega', tema: 'ventas', necesidad: 'vender más por whatsapp', servicio: 'kivo' }], recomendaciones: [] };
  else { const r = await sb.rpc('elio_mi_privacidad'); if (r.error) { $('#p-lista').innerHTML = '<p class="nota">No se pudo cargar. Inténtalo de nuevo.</p>'; return; } misDatos = r.data; }
  $('#p-aprende').checked = !!misDatos.aprende; $('#p-ofertas').checked = !!misDatos.acepta_ofertas;
  const l = misDatos.intereses || [];
  $('#p-lista').innerHTML = l.length ? l.map((i) => `<div class="p-item"><b>${esc([i.rubro, i.tema].filter(Boolean).join(' · ') || 'Interés')}</b>${i.necesidad ? ` — ${esc(i.necesidad)}` : ''}${i.servicio ? ` <span class="p-serv">${NOMBRE_SERVICIO[i.servicio] || ''}</span>` : ''}<small>${new Date(i.fecha).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>`).join('')
    : `<p class="nota">${misDatos.aprende ? 'Todavía no hay nada aprendido.' : 'El aprendizaje está apagado: Elio no guarda tus intereses.'}</p>`;
}
async function guardarPermisos() {
  const aprender = $('#p-aprende').checked, ofertas = $('#p-ofertas').checked;
  if (!aprender && misDatos?.aprende && (misDatos.intereses || []).length && !confirm('Al apagarlo se borra todo lo que Elio aprendió de ti. ¿Continuar?')) { $('#p-aprende').checked = true; return; }
  if (!DEMO) { const { error } = await sb.rpc('elio_privacidad_ajustar', { aprender, ofertas }); if (error) return toast('No se pudo guardar. Inténtalo de nuevo.'); }
  toast('Preferencias guardadas ✔'); abrirPrivacidad();
}
$('#p-aprende').addEventListener('change', guardarPermisos);
$('#p-ofertas').addEventListener('change', guardarPermisos);
$('#p-borrar').addEventListener('click', async () => {
  if (!confirm('¿Borrar todo lo que Elio aprendió de ti? No se puede deshacer.')) return;
  if (!DEMO) { const { error } = await sb.rpc('elio_borrar_mis_intereses'); if (error) return toast('No se pudo borrar. Inténtalo de nuevo.'); }
  toast('Listo: se borró lo aprendido ✔'); abrirPrivacidad();
});
$('#p-descargar').addEventListener('click', () => {
  if (!misDatos) return;
  const datos = { exportado: new Date().toISOString(), cuenta: { nombre: E.estado?.nombre || '', correo: E.sesion?.user?.email || '' }, ...misDatos };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }));
  a.download = 'mis-datos-elio.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

// Clic en un servicio recomendado (solo se anota si la persona dio permiso; el servidor lo comprueba)
function servicioDeEnlace(u) {
  if (/logrin\.flexgogroup\.com|flexgogroup\.com\/logrin/i.test(u)) return 'logrin';
  const m = u.match(/flexgogroup\.com\/(creago|kivo|paginas-web|eleva)/i);
  return m ? m[1].toLowerCase().replace('-', '_') : null;
}
$('#mensajes').addEventListener('click', (e) => {
  const a = e.target.closest('a[href]'); if (!a) return;
  if (!a.target) { a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; }
  const serv = servicioDeEnlace(a.href);
  if (serv && sb && E.sesion && !DEMO) sb.rpc('elio_clic_recomendacion', { serv, conv: E.conv || null });
});

// ---------- Administración ----------
$('#ir-admin').addEventListener('click', cargarAdmin);
// El panel exige la verificación en dos pasos (2FA con una app como Google Authenticator).
let factor2fa = null;
async function pedir2fa() {
  const { data: nivel } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (nivel?.currentLevel === 'aal2') return true;
  const { data: f } = await sb.auth.mfa.listFactors();
  const listo = (f?.totp || []).find((x) => x.status === 'verified');
  $('#admin-2fa').classList.remove('oculto'); $('#admin-resumen').innerHTML = ''; $('#admin-pagos').innerHTML = '';
  $('#admin-2fa-qr').hidden = true; $('#admin-2fa-clave').hidden = true; $('#admin-2fa-codigo').value = '';
  if (listo) {
    factor2fa = listo.id;
    $('#admin-2fa-txt').textContent = 'Por seguridad, escribe el código de 6 números que muestra tu app de verificación (Google Authenticator u otra).';
  } else {
    for (const x of (f?.all || []).filter((x) => x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: x.id });
    const { data: nuevo, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Elio admin' });
    if (error) { $('#admin-2fa-txt').textContent = 'No se pudo activar la verificación en dos pasos: ' + error.message; return false; }
    factor2fa = nuevo.id;
    $('#admin-2fa-txt').textContent = 'Activa la verificación en dos pasos: abre Google Authenticator (o Microsoft Authenticator) en tu celular, toca «+», escanea este código y escribe los 6 números que aparecen.';
    $('#admin-2fa-qr').src = nuevo.totp.qr_code; $('#admin-2fa-qr').hidden = false;
    $('#admin-2fa-clave').textContent = 'Si no puedes escanear, escribe esta clave en la app: ' + nuevo.totp.secret; $('#admin-2fa-clave').hidden = false;
  }
  $('#admin-2fa-codigo').focus();
  return false;
}
$('#admin-2fa-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor2fa, code: $('#admin-2fa-codigo').value.trim() });
  if (error) return toast('Código incorrecto o vencido. Escribe el que aparece ahora en tu app.');
  toast('Verificación correcta ✔'); cargarAdmin();
});

async function cargarAdmin() {
  $('#admin').classList.remove('oculto');
  if (!DEMO && !(await pedir2fa())) return;
  $('#admin-2fa').classList.add('oculto');
  let d = DEMO ? { usuarios: 3, por_plan: { libre: 2, impulso: 1 }, gasto_hoy: { total_usd: 0.12 }, gasto_mes: 1.4, mensajes_hoy: 57, pagos: [{ id: 1, plan: 'impulso', monto: 56.99, operacion: '12345678', estado: 'pendiente', creado: new Date().toISOString(), nombre: 'Ana', email: 'ana@correo.com' }] } : null;
  if (!DEMO) { const r = await sb.rpc('elio_admin_resumen'); if (r.error) { $('#admin-resumen').textContent = 'Sin permiso.'; return; } d = r.data; }
  const pp = d.por_plan || {};
  $('#admin-resumen').innerHTML = [
    ['Usuarios', d.usuarios], ['Libre / Impulso / Ultra', `${pp.libre || 0} / ${pp.impulso || 0} / ${pp.ultra || 0}`],
    ['Mensajes hoy', d.mensajes_hoy], ['Gasto IA hoy', 'US$ ' + Number(d.gasto_hoy?.total_usd || 0).toFixed(3)], ['Gasto IA del mes', 'US$ ' + Number(d.gasto_mes || 0).toFixed(2)],
  ].map(([k, v]) => `<div><b>${esc(v)}</b><small>${k}</small></div>`).join('');
  $('#admin-pagos').innerHTML = (d.pagos || []).length ? d.pagos.map((p) => `<div class="pago-fila"><div><b>${esc(p.nombre || '')}</b> · ${esc(p.email || '')}<br>${NOMBRE_PLAN[p.plan]} · S/ ${Number(p.monto).toFixed(2)} · Operación <b>${esc(p.operacion)}</b> · ${new Date(p.creado).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })} <span class="estado ${p.estado}">${p.estado}</span></div>
    <div class="acc">${p.estado === 'pendiente' ? `<button class="boton principal" data-ok="${p.id}">Aprobar</button><button class="boton" data-no="${p.id}">Rechazar</button>` : ''}</div></div>`).join('') : '<p class="nota">Todavía no hay pagos.</p>';
  cargarIntereses(); cargarConsumo(); cargarEncuestaAdmin(); cargarResenasAdmin();
}
async function cargarResenasAdmin() {
  if (DEMO) return;
  const r = await sb.rpc('elio_admin_resenas'); if (r.error) { $('#admin-resenas').innerHTML = '<p class="nota">No se pudo cargar.</p>'; return; }
  $('#admin-resenas').innerHTML = (r.data || []).map((x) => `<div class="pago-fila"><div><b>${esc(x.nombre)}</b> · ${'★'.repeat(x.estrellas)}${'☆'.repeat(5 - x.estrellas)} · ${NOMBRE_PLAN[x.plan] || esc(x.plan)} <span class="estado ${x.estado}">${x.estado}</span><br>${esc(x.texto)}</div>
    <div class="acc">${x.estado !== 'aprobada' ? `<button class="boton principal" data-res-ok="${x.id}">Aprobar</button>` : ''}${x.estado !== 'rechazada' ? `<button class="boton" data-res-no="${x.id}">Rechazar</button>` : ''}</div></div>`).join('') || '<p class="nota">Todavía no hay reseñas.</p>';
}
$('#admin-resenas').addEventListener('click', async (e) => {
  const id = e.target.dataset.resOk || e.target.dataset.resNo; if (!id) return;
  const { error } = await sb.rpc('elio_moderar_resena', { id, aprobar: !!e.target.dataset.resOk });
  if (error) return toast(error.message);
  toast('Listo ✔'); cargarResenasAdmin(); cargarResumenPorque();
});
const NOMBRE_FUNCION = { chat: 'Chat', invitado: 'Invitados', biblioteca: 'Biblioteca / Mi día', busqueda: 'Búsqueda', imagen: 'Imágenes' };
async function cargarConsumo() {
  if (DEMO) return;
  const r = await sb.rpc('elio_admin_consumo'); if (r.error) { $('#admin-consumo').innerHTML = '<p class="nota">No se pudo cargar.</p>'; return; }
  const d = r.data || {};
  $('#admin-consumo').innerHTML = `<div class="tabla-int"><div class="fila cab"><span>Función · motor</span><span>Mensajes</span><span>Créditos</span><span>Costo US$</span></div>
    ${(d.por_funcion || []).map((x) => `<div class="fila"><span>${NOMBRE_FUNCION[x.funcion] || esc(x.funcion)} · ${MOTORES[x.motor]?.[0] || esc(x.motor)}</span><span>${x.n}</span><span>${x.creditos}</span><span>${Number(x.costo).toFixed(4)}</span></div>`).join('') || '<div class="fila"><span>Sin consumo todavía</span></div>'}</div>
    <p class="nota">Por plan: ${(d.por_plan || []).map((x) => `${NOMBRE_PLAN[x.plan] || x.plan}: ${x.personas} persona(s), US$ ${Number(x.costo).toFixed(4)}`).join(' · ') || '—'}</p>`;
}
const ETQ_ENC = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', copilot: 'Copilot', meta: 'Meta AI', ninguna: 'Ninguna', otra: 'Otra', estudiar: 'Estudiar', trabajo: 'Trabajo', redactar: 'Redactar', investigar: 'Investigar', imagenes: 'Imágenes', programar: 'Programar', organizar: 'Organizar mi día', negocio: 'Mi negocio', web: 'Buscar en internet', investigacion: 'Investigación profunda', documentos: 'Leer documentos', recordatorios: 'Recordatorios', voz: 'Voz', video: 'Video', no: 'No pagaría', hasta20: 'Hasta S/ 20', '20a40': 'S/ 20–40', '40a90': 'S/ 40–90', mas90: 'Más de S/ 90' };
async function cargarEncuestaAdmin() {
  if (DEMO) return;
  const r = await sb.rpc('elio_admin_encuesta'); if (r.error) { $('#admin-encuesta').innerHTML = '<p class="nota">No se pudo cargar.</p>'; return; }
  const d = r.data || {}; const lista = (x) => (x || []).map((i) => `${ETQ_ENC[i.nombre] || esc(i.nombre)} <b>${i.n}</b>`).join(' · ') || '—';
  $('#admin-encuesta').innerHTML = `<p class="nota">Respuestas: <b>${d.total || 0}</b> ${d.total ? '<button class="boton" id="enc-csv" type="button">Descargar CSV</button>' : ''}</p>
    <p><b>Qué IA usan:</b> ${lista(d.usa)}</p><p><b>Para qué:</b> ${lista(d.para)}</p><p><b>Qué les falta:</b> ${lista(d.falta)}</p><p><b>¿Pagarían?:</b> ${lista(d.pagaria)}</p>
    ${(d.comentarios || []).length ? `<h4>Comentarios</h4>${d.comentarios.map((c) => `<div class="p-item">${esc(c.comentario)}<small>${new Date(c.creado).toLocaleDateString('es-PE')}</small></div>`).join('')}` : ''}`;
  const b = $('#enc-csv');
  if (b) b.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['fecha;usa;para;falta;pagaria;comentario\n' + (d.csv || '')], { type: 'text/csv;charset=utf-8' })); a.download = 'encuesta-elio.csv'; a.click(); };
}
async function cargarIntereses() {
  let d = DEMO ? { con_permiso: 1, temas: [{ nombre: 'ventas', n: 3 }], rubros: [{ nombre: 'bodega', n: 2 }], servicios: [{ servicio: 'kivo', interesados: 1, mostradas: 2, clics: 1 }], contactables: [] } : null;
  if (!DEMO) { const r = await sb.rpc('elio_admin_intereses'); if (r.error) { $('#admin-intereses').innerHTML = '<p class="nota">No se pudieron cargar.</p>'; return; } d = r.data; }
  const lista = (x) => (x || []).length ? x.map((t) => `${esc(t.nombre)} <b>${t.n}</b>`).join(' · ') : '—';
  $('#admin-intereses').innerHTML = `<p class="nota">Personas que dieron permiso: <b>${d.con_permiso}</b></p>
    <p><b>Temas más buscados:</b> ${lista(d.temas)}</p><p><b>Rubros:</b> ${lista(d.rubros)}</p>
    <div class="tabla-int"><div class="fila cab"><span>Servicio</span><span>Interesados</span><span>Recomendado</span><span>Clics</span></div>
    ${(d.servicios || []).map((s) => `<div class="fila"><span>${NOMBRE_SERVICIO[s.servicio]}</span><span>${s.interesados}</span><span>${s.mostradas}</span><span>${s.clics}</span></div>`).join('')}</div>
    <h4>Con intención de compra y que aceptaron ofertas</h4>
    ${(d.contactables || []).length ? d.contactables.map((c) => `<div class="pago-fila"><div><b>${esc(c.nombre || '')}</b> · ${esc(c.email)}<br>${esc((c.servicios || '').split(', ').map((x) => NOMBRE_SERVICIO[x] || x).join(', '))}</div></div>`).join('') : '<p class="nota">Todavía nadie.</p>'}`;
}
$('#admin-pagos').addEventListener('click', async (e) => {
  const id = e.target.dataset.ok || e.target.dataset.no; if (!id) return;
  const aprobar = !!e.target.dataset.ok;
  const motivo = aprobar ? null : prompt('Motivo del rechazo (lo verá solo el equipo):', 'No encontramos el pago en Yape');
  if (!aprobar && motivo === null) return;
  if (!aprobar && !confirm('¿Rechazar este pago?')) return;
  if (!DEMO) { const { error } = await sb.rpc('elio_admin_pago', { pago: Number(id), aprobar, motivo }); if (error) return toast(error.message); }
  toast(aprobar ? 'Plan activado por 30 días ✔' : 'Pago rechazado'); cargarAdmin();
});

// ---------- Menú lateral (celular) y salir ----------
const esMovil = () => matchMedia('(max-width:860px)').matches;
function cerrarLateral() { document.body.classList.remove('lat-abierto'); }
$('#abrir-lateral').addEventListener('click', () => { if (esMovil()) document.body.classList.add('lat-abierto'); else document.body.classList.remove('lat-cerrado'); });
$('#cerrar-lateral').addEventListener('click', () => { if (esMovil()) cerrarLateral(); else document.body.classList.add('lat-cerrado'); });
$('#salir').addEventListener('click', async () => { if (sb) await sb.auth.signOut(); else location.reload(); });

iniciar();
