// ELIO by FlexGo Group · app web (chat, cuentas, planes y pago por Yape)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12.0.2/+esm';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/+esm';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const CFG = window.ELIO_CONFIG || {};
const DEMO = !CFG.SUPABASE_URL && location.hostname === 'localhost' && location.search.includes('demo');
const VOLVER = location.hostname === 'localhost' ? location.origin + '/' : CFG.SITIO;
const PRECIOS = { impulso: 29.9, ultra: 79.9 };
const NOMBRE_PLAN = { libre: 'Libre', impulso: 'Impulso', ultra: 'Ultra' };
const CUPOS = {
  invitado: { rapido: 4, razonamiento: 0, experto: 0 },
  libre: { rapido: 20, razonamiento: 0, experto: 0 },
  impulso: { rapido: 100, razonamiento: 300, experto: 0 },
  ultra: { rapido: 150, razonamiento: 800, experto: 200 },
};

marked.setOptions({ breaks: true, gfm: true });
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
const E = { invitado: false, historialInv: [], restantes: 4, sesion: null, estado: null, chats: [], conv: null, nivel: 'rapido', adjunto: null, enviando: false };

// ---------- Acceso ----------
let modo = 'entrar';
function modoAcceso(m) {
  modo = m;
  $('#acceso').classList.toggle('registro', m === 'registro');
  $('#acceso').classList.toggle('olvido', m === 'olvido');
  $('#acceso-titulo').textContent = { entrar: 'Bienvenido a Elio', registro: 'Crea tu cuenta gratis', olvido: 'Recupera tu contraseña' }[m];
  $('#acceso-sub').textContent = { entrar: 'Inicia sesión para continuar', registro: '20 mensajes al día y tu historial guardado', olvido: 'Te enviaremos un enlace a tu correo' }[m];
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
  $$('.niveles button').forEach((b) => b.classList.toggle('bloq', b.dataset.nivel !== 'rapido'));
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
  await cargarEstado();
  if (sb && E.estado && !E.estado.acepto && E.sesion?.user?.user_metadata?.acepto) await sb.rpc('elio_aceptar_terminos');
  await cargarChats();
  nuevoChat();
  $('#texto').focus();
}
async function cargarEstado() {
  if (sb) { const { data } = await sb.rpc('elio_mi_estado'); E.estado = data; }
  const s = E.estado; if (!s) return;
  $('#plan-nombre').textContent = NOMBRE_PLAN[s.plan] || 'Libre';
  $('#plan-vence').textContent = s.plan !== 'libre' && s.plan_vence ? ' · hasta el ' + new Date(s.plan_vence + 'T12:00').toLocaleDateString('es-PE', { day: 'numeric', month: 'short' }) : '';
  $('#lat-nombre').textContent = s.nombre || 'Tu cuenta';
  $('#iniciales').textContent = (s.nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';
  $('#ir-admin').hidden = !s.es_admin;
  const C = CUPOS[s.plan] || CUPOS.libre;
  const fila = (t, usado, max, per) => max ? `<div class="cupo">${t}: ${usado} de ${max} ${per}<div class="b"><i style="width:${Math.min(100, (usado / max) * 100)}%"></i></div></div>` : '';
  $('#cupos').innerHTML = fila('⚡ Rápido', s.hoy.rapido, C.rapido, 'hoy') + fila('🧠 Razonamiento', s.mes.razonamiento, C.razonamiento, 'este mes') + fila('★ Experto', s.mes.experto, C.experto, 'este mes')
    + (s.pago_pendiente ? '<div>⏳ Tu pago está en revisión.</div>' : '');
  $('#ver-planes').textContent = s.plan === 'ultra' ? 'Ver planes' : '✦ Mejorar mi plan';
  $$('.niveles button').forEach((b) => b.classList.toggle('bloq', !C[b.dataset.nivel]));
  $('.adjuntar').style.opacity = s.plan === 'libre' ? 0.5 : 1;
  const h = new Date().getHours();
  $('#saludo').textContent = `${h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'}${s.nombre ? ', ' + s.nombre.split(' ')[0] : ''}. Soy tu asistente de inteligencia artificial para crear, analizar y potenciar tus ideas.`;
}

// ---------- Conversaciones ----------
async function cargarChats() {
  if (!sb) { E.chats = DEMO ? [{ id: 'd1', titulo: 'Plan de marketing para mi bodega' }, { id: 'd2', titulo: 'Tarea de biología' }] : []; return pintarChats(); }
  const { data } = await sb.from('conversaciones').select('id,titulo,actualizado').order('actualizado', { ascending: false }).limit(60);
  E.chats = data || []; pintarChats();
}
let verTodos = false;
function pintarChats() {
  const lista = verTodos ? E.chats : E.chats.slice(0, 8);
  $('#lista-chats').innerHTML = lista.length ? lista.map((c) => `<div class="chat-item ${c.id === E.conv ? 'on' : ''}" data-id="${c.id}"><button class="abrir" title="${esc(c.titulo)}"><svg><use href="#i-burbuja"/></svg><span>${esc(c.titulo)}</span></button><button class="icono borrar" aria-label="Borrar chat" title="Borrar chat"><svg><use href="#i-puntos"/></svg></button></div>`).join('')
    : '<p class="vacio-chats">Aún no tienes conversaciones.</p>';
  $('#ver-mas').classList.toggle('oculto', verTodos || E.chats.length <= 8);
}
$('#ver-mas').addEventListener('click', () => { verTodos = true; pintarChats(); });
$('#lista-chats').addEventListener('click', async (e) => {
  const it = e.target.closest('.chat-item'); if (!it) return;
  if (e.target.closest('.borrar')) {
    if (!confirm('¿Borrar este chat? No se puede deshacer.')) return;
    if (sb) await sb.from('conversaciones').delete().eq('id', it.dataset.id);
    E.chats = E.chats.filter((c) => c.id !== it.dataset.id);
    if (E.conv === it.dataset.id) nuevoChat(); else pintarChats();
    return;
  }
  abrirChat(it.dataset.id);
});
function nuevoChat() {
  E.conv = null; $('#mensajes').innerHTML = ''; $('#vacio').classList.remove('oculto'); document.body.classList.add('vacio');
  $('#titulo-chat').textContent = 'Nuevo chat'; pintarChats(); cerrarLateral();
}
async function abrirChat(id) {
  E.conv = id; pintarChats(); cerrarLateral();
  const c = E.chats.find((x) => x.id === id); $('#titulo-chat').textContent = c?.titulo || 'Chat';
  $('#mensajes').innerHTML = ''; $('#vacio').classList.add('oculto'); document.body.classList.remove('vacio');
  if (!sb) return;
  const { data } = await sb.from('mensajes').select('rol,contenido,adjunto').eq('conversacion', id).order('id').limit(200);
  for (const m of data || []) m.rol === 'user' ? burbujaYo(m.contenido, m.adjunto) : burbujaElio().pintar(m.contenido, true);
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
    pintar(t, final) {
      cuerpo.innerHTML = md(t);
      cuerpo.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
      if (final) {
        const acc = document.createElement('div'); acc.className = 'acciones';
        acc.innerHTML = '<button data-a="copiar">📋 Copiar</button>';
        acc.querySelector('button').onclick = () => navigator.clipboard.writeText(t).then(() => toast('Copiado ✔'));
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
      b.pintar(`Listo ✔ Lo anoté en **Mi día**: **${j.tarea.texto}**${j.tarea.fecha ? ` para el **${fechaBonita(j.tarea.fecha)}**` : ''}${j.tarea.hora ? ` a las ${j.tarea.hora.slice(0, 5)}` : ''}.\n\nPuedes verlo en el menú *Mi día*.`, true);
    } catch (err) { b.pintar(err.message, true); }
    finally { E.enviando = false; abajo(); }
    return;
  }
  if (E.invitado && E.restantes <= 0) return pedirCuenta('Ya usaste tus preguntas sin cuenta. Crea tu cuenta gratis para seguir: 20 mensajes al día y tu historial guardado.');
  const C = CUPOS[E.estado?.plan] || CUPOS.libre;
  if (!C[E.nivel]) { if (E.invitado) return pedirCuenta('Crea tu cuenta para usar los modos avanzados.'); toast(E.nivel === 'experto' ? 'El modo Experto está en el plan Ultra.' : 'El modo Razonamiento está en Impulso y Ultra.'); return abrirPlanes(); }
  E.enviando = true; $('#enviar').disabled = true;
  $('#vacio').classList.add('oculto'); document.body.classList.remove('vacio');
  burbujaYo(texto, adjunto?.nombre);
  const b = burbujaElio(); abajo();
  let acumulado = '';
  try {
    if (DEMO) {
      const resp = `¡Hola! Esto es una **demostración** de Elio.\n\n- Modo: **${E.nivel}**\n- Tu mensaje: _${texto.slice(0, 80)}_\n\n| Plan | Precio |\n|---|---|\n| Impulso | S/ 29.90 |\n| Ultra | S/ 79.90 |\n\n\`\`\`js\nconsole.log("Elio by FlexGo");\n\`\`\``;
      for (const w of resp.split(/(\s+)/)) { acumulado += w; b.pintar(acumulado); abajo(); await new Promise((r) => setTimeout(r, 18)); }
      b.pintar(acumulado, true);
      if (!E.conv) { E.conv = 'demo-' + Date.now(); E.chats.unshift({ id: E.conv, titulo: texto.slice(0, 60) }); pintarChats(); $('#titulo-chat').textContent = texto.slice(0, 60); }
      return;
    }
    const s = E.invitado ? null : (await sb.auth.getSession()).data;
    const r = await fetch(`${CFG.SUPABASE_URL}/functions/v1/elio-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_KEY, ...(s?.session ? { Authorization: `Bearer ${s.session.access_token}` } : {}) },
      body: JSON.stringify(E.invitado ? { texto, invitado: true, historial: E.historialInv } : { conversacion: E.conv, texto, nivel: E.nivel, adjunto }),
    });
    if (!r.ok || !r.body) {
      const j = await r.json().catch(() => ({}));
      if (j.codigo === 'registro') { b.error(j.mensaje); E.restantes = 0; guardarRestantes(); pintarRestantes(); pedirCuenta(j.mensaje); return; }
      b.error(j.mensaje || 'No pude responder. Revisa tu conexión.', r.status >= 500 && r.status !== 503 ? () => enviar(texto, adjunto) : null, j.codigo === 'cupo' || j.codigo === 'tope_libre');
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
          if (!E.chats.some((c) => c.id === ev.id)) { const t = (texto || adjunto?.nombre || 'Nuevo chat').slice(0, 60); E.chats.unshift({ id: ev.id, titulo: t }); $('#titulo-chat').textContent = t; }
          pintarChats();
        }
        if (ev.tipo === 'texto') { acumulado += ev.t; b.pintar(acumulado); abajo(); }
        if (ev.tipo === 'aviso') toast(ev.t);
        if (ev.tipo === 'invitado') { E.restantes = ev.restantes; guardarRestantes(); pintarRestantes(); }
        if (ev.tipo === 'error') fallo = ev.mensaje;
      }
    }
    if (fallo && !acumulado) b.error(fallo, () => enviar(texto, adjunto)); else b.pintar(acumulado || '…', true);
    if (E.invitado) {
      if (acumulado) E.historialInv.push({ rol: 'user', contenido: texto }, { rol: 'assistant', contenido: acumulado });
      if (E.restantes <= 0) setTimeout(() => pedirCuenta('¿Te gustó? Crea tu cuenta gratis para seguir conversando con Elio: 20 mensajes al día y tu historial guardado.'), 1800);
      else if (E.restantes === 1) toast('Te queda 1 pregunta sin cuenta.');
    } else cargarEstado();
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
  const C = CUPOS[E.estado?.plan] || CUPOS.libre;
  if (!C[b.dataset.nivel] && E.invitado) return pedirCuenta('Crea tu cuenta para usar los modos avanzados.');
  if (!C[b.dataset.nivel]) { toast(b.dataset.nivel === 'experto' ? 'El modo Experto está en el plan Ultra.' : 'El modo Razonamiento está en Impulso y Ultra.'); return abrirPlanes(); }
  E.nivel = b.dataset.nivel; $$('.niveles button').forEach((x) => x.classList.toggle('on', x === b));
  $('#modo-txt').textContent = { rapido: 'Rápido', razonamiento: 'Razonamiento', experto: 'Experto' }[E.nivel];
  $('#niveles').classList.add('oculto');
}));
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
  const btn = e.submitter; btn.disabled = true;
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
const CUPOS_BIB = { libre: { docs: 5, mb: 25, archivo: 5, preguntas: 5 }, impulso: { docs: 100, mb: 500, archivo: 10, preguntas: 40 }, ultra: { docs: 400, mb: 2048, archivo: 20, preguntas: 100 } };
async function llamarBiblioteca(cuerpo) {
  const { data } = await sb.auth.getSession();
  const r = await fetch(`${CFG.SUPABASE_URL}/functions/v1/elio-biblioteca`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_KEY, Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
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
    caja.innerHTML = md(j.respuesta) + ((j.fuentes || []).length ? `<p class="b-fuentes">Fuentes: ${j.fuentes.map((f) => `${esc(f.nombre)}${f.pagina ? ', pág. ' + f.pagina : ''}`).join(' · ')}</p>` : '');
  } catch (err) { caja.innerHTML = `<p class="nota">${esc(err.message)}</p>`; }
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
  if (!a.target) { a.target = '_blank'; a.rel = 'noopener'; }
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
  let d = DEMO ? { usuarios: 3, por_plan: { libre: 2, impulso: 1 }, gasto_hoy: { total_usd: 0.12 }, gasto_mes: 1.4, mensajes_hoy: 57, pagos: [{ id: 1, plan: 'impulso', monto: 29.9, operacion: '12345678', estado: 'pendiente', creado: new Date().toISOString(), nombre: 'Ana', email: 'ana@correo.com' }] } : null;
  if (!DEMO) { const r = await sb.rpc('elio_admin_resumen'); if (r.error) { $('#admin-resumen').textContent = 'Sin permiso.'; return; } d = r.data; }
  const pp = d.por_plan || {};
  $('#admin-resumen').innerHTML = [
    ['Usuarios', d.usuarios], ['Libre / Impulso / Ultra', `${pp.libre || 0} / ${pp.impulso || 0} / ${pp.ultra || 0}`],
    ['Mensajes hoy', d.mensajes_hoy], ['Gasto IA hoy', 'US$ ' + Number(d.gasto_hoy?.total_usd || 0).toFixed(3)], ['Gasto IA del mes', 'US$ ' + Number(d.gasto_mes || 0).toFixed(2)],
  ].map(([k, v]) => `<div><b>${esc(v)}</b><small>${k}</small></div>`).join('');
  $('#admin-pagos').innerHTML = (d.pagos || []).length ? d.pagos.map((p) => `<div class="pago-fila"><div><b>${esc(p.nombre || '')}</b> · ${esc(p.email || '')}<br>${NOMBRE_PLAN[p.plan]} · S/ ${Number(p.monto).toFixed(2)} · Operación <b>${esc(p.operacion)}</b> · ${new Date(p.creado).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })} <span class="estado ${p.estado}">${p.estado}</span></div>
    <div class="acc">${p.estado === 'pendiente' ? `<button class="boton principal" data-ok="${p.id}">Aprobar</button><button class="boton" data-no="${p.id}">Rechazar</button>` : ''}</div></div>`).join('') : '<p class="nota">Todavía no hay pagos.</p>';
  cargarIntereses();
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
