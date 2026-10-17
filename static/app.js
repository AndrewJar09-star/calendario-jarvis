/* ================================================================
   S.T.E.W.A.R.D. OS — app.js
   J.A.R.V.I.S. Mobile Interface
   Versione: Neo-Swiss Restyling + Bug Fix Napoli + TTS Italiano
   ================================================================ */

'use strict';

// ─── State ──────────────────────────────────────────────────────
const isMobileInitial = typeof window !== 'undefined' && window.innerWidth <= 768;
const STATE = {
  events: [],
  currentView: isMobileInitial ? 'month' : 'week', // Su smartphone apre direttamente la panoramica Mese completa
  activeTab: 'calendar',
  selectedDate: new Date('2026-10-14T09:30:00'), // Default matches screenshot: 14 Ottobre 2026
  miniCalMonth: new Date('2026-10-01'), // Mini calendar view month
  activeCategories: new Set(['NAPOLI', 'STABIA', 'CASERTANA', 'MOSTRA', 'CUSTOM']),
  selectedEvent: null,
  earningsTargetEvent: null,
  isListening: false,
  isSpeaking: false,
  calendar: null,
  lastSync: null,
  searchQuery: '',
  searchCategory: 'ALL',
};

// ─── Helpers: Visibilità Calendario & Formattazione Guadagno ────
function isEventHiddenFromCalendar(ev) {
  if (!ev) return false;
  const st = (ev.status || '').toLowerCase().trim();
  return st.includes('riposo') || st.includes('ignora');
}

function formatEarnings(val) {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  if (isNaN(num)) return null;
  return num % 1 === 0 ? `€${num.toFixed(0)}` : `€${num.toFixed(2)}`;
}

// ─── Category Config ────────────────────────────────────────────
const CATEGORY_CONFIG = {
  CALCIO: {
    napoli:     { color: '#00a8ff', label: 'SSC NAPOLI',    stadium: 'Stadio Diego Armando Maradona' },
    stabia:     { color: '#f5b700', label: 'JUVE STABIA',   stadium: 'Stadio Romeo Menti' },
    casertana:  { color: '#ff0055', label: 'CASERTANA FC',  stadium: 'Stadio Alberto Pinto' },
    default:    { color: '#00E5FF', label: 'CALCIO',         stadium: '' },
  },
  FIERA: { color: '#10B981', label: 'MOSTRA D\'OLTREMARE' },
};

function getCategoryStyle(event) {
  const title = (event.title || '').toLowerCase();
  const venue = (event.venue || '').toLowerCase();
  const cat   = (event.category || '').toUpperCase();

  if (cat === 'CALCIO' || cat === 'FOOTBALL') {
    if (title.includes('napoli') || venue.includes('maradona'))   return { color: '#00a8ff', badgeClass: 'napoli',    label: 'NAPOLI' };
    if (title.includes('stabia') || venue.includes('menti'))      return { color: '#f5b700', badgeClass: 'stabia',    label: 'J.STABIA' };
    if (title.includes('casertana') || venue.includes('pinto'))   return { color: '#ff0055', badgeClass: 'casertana', label: 'CASERTANA' };
    return { color: '#00E5FF', badgeClass: 'default', label: 'CALCIO' };
  }
  if (cat === 'FIERA' || venue.includes('mostra')) {
    return { color: '#10B981', badgeClass: 'mostra', label: 'MOSTRA' };
  }
  return { color: '#00E5FF', badgeClass: 'default', label: cat || 'EVENTO' };
}

// ─── Formatters ─────────────────────────────────────────────────
function formatDateTime(dtStr) {
  if (!dtStr) return '—';
  try {
    const d = new Date(dtStr.replace(' ', 'T'));
    return d.toLocaleString('it-IT', {
      weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dtStr; }
}

function formatTime(dtStr) {
  if (!dtStr) return '—';
  try {
    const d = new Date(dtStr.replace(' ', 'T'));
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  } catch { return dtStr; }
}

function formatDate(dtStr) {
  if (!dtStr) return '—';
  try {
    const d = new Date(dtStr.replace(' ', 'T'));
    return d.toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return dtStr; }
}

function isFuture(dtStr) {
  if (!dtStr) return false;
  return new Date(dtStr.replace(' ', 'T')) > new Date();
}

// ─── API ────────────────────────────────────────────────────────
async function apiGet(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function apiPost(path, body = {}) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function apiDelete(path) {
  const resp = await fetch(path, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}


// ─── Toast ──────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { info: 'ℹ️', success: '✅', error: '❌' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// ─── Clock ──────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── HUD Date Helpers ──────────────────────────────────────────
function formatYMD(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toSqlDateTime(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  const hours = String(dt.getHours()).padStart(2, '0');
  const mins = String(dt.getMinutes()).padStart(2, '0');
  const secs = String(dt.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
}

function isSameDay(d1, d2) {
  if (!d1 || !d2) return false;
  const a = (d1 instanceof Date) ? d1 : new Date(d1);
  const b = (d2 instanceof Date) ? d2 : new Date(d2);
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function getMonday(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(dt.setDate(diff));
}

// ─── Classification & Styling ──────────────────────────────────
function classifyEventCategory(ev) {
  const cat   = (ev.category || '').toUpperCase();
  const title = (ev.title || '').toLowerCase();
  const venue = (ev.venue || '').toLowerCase();

  // 1. MOSTRA D'OLTREMARE (Fiere, Concorsi, Saloni, Spettacoli)
  // PRIORITÀ ASSOLUTA: impedisce che fiere/eventi come "LTS EXPO NAPOLI" siano scambiati
  // per partite di calcio solo perché menzionano la città "Napoli" nel loro titolo!
  const isMostraVenue = venue.includes('mostra') || venue.includes('oltremare') ||
                        venue.includes('padiglioni') || venue.includes('teatro mediterraneo');
  const isFieraCat = cat === 'FIERA' || cat === 'MOSTRA';
  const isFieraKeyword = title.includes('fiera') || title.includes('expo') || title.includes('salone') ||
                         title.includes('concorso') || title.includes('convegno') || title.includes('congresso') ||
                         title.includes('comicon') || title.includes('tutto sposi') || title.includes('pharmexpo') ||
                         title.includes('aestetica') || title.includes('orientasud') || title.includes('creattiva') ||
                         title.includes('esame') || title.includes('chantant');

  if (isMostraVenue || isFieraCat || (isFieraKeyword && !venue.includes('maradona') && !venue.includes('menti') && !venue.includes('pinto'))) {
    return 'MOSTRA';
  }

  // 2. SSC NAPOLI (Partite di Calcio allo Stadio Diego Armando Maradona)
  const isMaradonaVenue = venue.includes('maradona') || venue.includes('san paolo');
  const isNapoliMatch = title.includes('napoli') && (
    title.includes('vs') || title.includes('contro') || title.includes(' - ') ||
    cat === 'CALCIO' || isMaradonaVenue
  );
  if (isMaradonaVenue || isNapoliMatch || cat === 'NAPOLI') {
    return 'NAPOLI';
  }

  // 3. JUVE STABIA (Stadio Romeo Menti)
  if (venue.includes('menti') || title.includes('stabia') || cat === 'STABIA') {
    return 'STABIA';
  }

  // 4. CASERTANA FC (Stadio Alberto Pinto)
  if (venue.includes('pinto') || title.includes('casertana') || cat === 'CASERTANA') {
    return 'CASERTANA';
  }

  // Fallback squadre per categoria generica CALCIO
  if (cat === 'CALCIO' || cat === 'FOOTBALL') {
    if (title.includes('stabia')) return 'STABIA';
    if (title.includes('casertana')) return 'CASERTANA';
    return 'NAPOLI';
  }

  // 5. Eventi Aggiunti / Manuali / Altro
  return 'CUSTOM';
}

function getHudEventStyle(ev) {
  const group = classifyEventCategory(ev);
  if (group === 'NAPOLI') {
    return { class: 'napoli', color: '#00a8ff', label: 'SSC NAPOLI', glyph: '⚽' };
  }
  if (group === 'STABIA') {
    return { class: 'stabia', color: '#f5b700', label: 'JUVE STABIA', glyph: '🐝' };
  }
  if (group === 'CASERTANA') {
    return { class: 'casertana', color: '#ff0055', label: 'CASERTANA FC', glyph: '🦅' };
  }
  if (group === 'MOSTRA') {
    return { class: 'mostra', color: '#10b981', label: 'MOSTRA D\'OLTREMARE', glyph: '🏛️' };
  }
  return { class: 'custom', color: '#c084fc', label: 'EVENTO AGGIUNTO', glyph: '📝' };
}

// ─── Local-First Smartphone Storage Engine ──────────────────────────
const LOCAL_STORAGE_EVENTS_KEY = 'steward_events_local_v2';

function getDefaultSeedEvents() {
  return [
    // SSC Napoli (Stadio Maradona)
    { id: 101, title: "Napoli vs Roma", venue: "Stadio Maradona", category: "CALCIO", event_start: "2026-10-24 18:00:00", call_time: "2026-10-24 14:00:00", notes: "Serie A - Partita di cartello allo Stadio Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 102, title: "Napoli vs Bodø/Glimt", venue: "Stadio Maradona", category: "CALCIO", event_start: "2026-10-20 21:00:00", call_time: "2026-10-20 17:00:00", notes: "Champions League - Notte europea allo Stadio Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 103, title: "Napoli vs Lazio", venue: "Stadio Maradona", category: "CALCIO", event_start: "2026-11-08 12:30:00", call_time: "2026-11-08 08:30:00", notes: "Serie A - Anticipo domenicale allo Stadio Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 104, title: "Napoli vs Torino", venue: "Stadio Maradona", category: "CALCIO", event_start: "2026-11-21 20:45:00", call_time: "2026-11-21 16:45:00", notes: "Serie A - Anticipo serale allo Stadio Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 105, title: "Napoli vs Lecce", venue: "Stadio Maradona", category: "CALCIO", event_start: "2026-12-05 20:45:00", call_time: "2026-12-05 16:45:00", notes: "Serie A - Stadio Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 106, title: "Napoli vs Club Bruges", venue: "Stadio Maradona", category: "CALCIO", event_start: "2026-12-08 21:00:00", call_time: "2026-12-08 17:00:00", notes: "Champions League - Stadio Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 107, title: "Napoli vs Milan", venue: "Stadio Maradona", category: "CALCIO", event_start: "2026-12-13 20:45:00", call_time: "2026-12-13 16:45:00", notes: "Serie A - Big match allo Stadio Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 108, title: "Napoli vs Fiorentina", venue: "Stadio Maradona", category: "CALCIO", event_start: "2026-12-16 21:00:00", call_time: "2026-12-16 17:00:00", notes: "Coppa Italia - Stadio Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 109, title: "Napoli vs Cagliari", venue: "Stadio Maradona", category: "CALCIO", event_start: "2027-01-07 20:45:00", call_time: "2027-01-07 16:45:00", notes: "Serie A - Stadio Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 110, title: "Napoli vs Inter", venue: "Stadio Maradona", category: "CALCIO", event_start: "2027-01-31 15:00:00", call_time: "2027-01-31 11:00:00", notes: "Serie A - Scontro al vertice allo Stadio Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 111, title: "Napoli vs Juventus", venue: "Stadio Maradona", category: "CALCIO", event_start: "2027-02-14 15:00:00", call_time: "2027-02-14 11:00:00", notes: "Serie A - Derby d'Italia al Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 112, title: "Napoli vs Bologna", venue: "Stadio Maradona", category: "CALCIO", event_start: "2026-11-01 18:00:00", call_time: "2026-11-01 14:00:00", notes: "Serie A – Stadio Diego Armando Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 113, title: "Napoli vs Feyenoord", venue: "Stadio Maradona", category: "CALCIO", event_start: "2026-11-04 21:00:00", call_time: "2026-11-04 17:00:00", notes: "Champions League – Notte europea", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 114, title: "Napoli vs Empoli", venue: "Stadio Maradona", category: "CALCIO", event_start: "2026-11-29 15:00:00", call_time: "2026-11-29 11:00:00", notes: "Serie A – Stadio Diego Armando Maradona", status: "Da confermare", earnings: 0.0, conflict: false },
    // SS Juve Stabia (Stadio Romeo Menti)
    { id: 201, title: "Juve Stabia vs Südtirol", venue: "Stadio Romeo Menti", category: "CALCIO", event_start: "2026-10-18 15:00:00", call_time: "2026-10-18 11:00:00", notes: "Serie B - Stadio Romeo Menti", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 202, title: "Juve Stabia vs Verona", venue: "Stadio Romeo Menti", category: "CALCIO", event_start: "2026-10-28 20:00:00", call_time: "2026-10-28 16:00:00", notes: "Serie B - Turno infrasettimanale Stadio Romeo Menti", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 203, title: "Juve Stabia vs Arezzo", venue: "Stadio Romeo Menti", category: "CALCIO", event_start: "2026-11-07 15:00:00", call_time: "2026-11-07 11:00:00", notes: "Serie B - Stadio Romeo Menti", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 204, title: "Juve Stabia vs Catanzaro", venue: "Stadio Romeo Menti", category: "CALCIO", event_start: "2026-11-24 19:00:00", call_time: "2026-11-24 15:00:00", notes: "Serie B - Stadio Romeo Menti", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 205, title: "Juve Stabia vs Benevento", venue: "Stadio Romeo Menti", category: "CALCIO", event_start: "2026-12-05 19:30:00", call_time: "2026-12-05 15:30:00", notes: "Serie B - Derby campano Stadio Romeo Menti", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 206, title: "Juve Stabia vs Padova", venue: "Stadio Romeo Menti", category: "CALCIO", event_start: "2026-12-12 15:00:00", call_time: "2026-12-12 11:00:00", notes: "Serie B - Stadio Romeo Menti", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 207, title: "Juve Stabia vs Sampdoria", venue: "Stadio Romeo Menti", category: "CALCIO", event_start: "2027-01-09 15:00:00", call_time: "2027-01-09 11:00:00", notes: "Serie B - Big match allo Stadio Romeo Menti", status: "Da confermare", earnings: 0.0, conflict: false },
    // Casertana FC (Stadio Alberto Pinto)
    { id: 301, title: "Casertana vs Bari", venue: "Stadio Alberto Pinto", category: "CALCIO", event_start: "2026-10-23 20:30:00", call_time: "2026-10-23 16:30:00", notes: "Serie C Girone C - Stadio Alberto Pinto, Caserta", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 302, title: "Casertana vs Casarano", venue: "Stadio Alberto Pinto", category: "CALCIO", event_start: "2026-11-07 14:30:00", call_time: "2026-11-07 10:30:00", notes: "Serie C Girone C - Stadio Alberto Pinto", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 303, title: "Casertana vs Salernitana", venue: "Stadio Alberto Pinto", category: "CALCIO", event_start: "2026-11-20 20:30:00", call_time: "2026-11-20 16:30:00", notes: "Serie C Girone C - Derby campano", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 304, title: "Casertana vs Potenza", venue: "Stadio Alberto Pinto", category: "CALCIO", event_start: "2026-12-05 17:30:00", call_time: "2026-12-05 13:30:00", notes: "Serie C Girone C - Stadio Alberto Pinto", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 305, title: "Casertana vs Crotone", venue: "Stadio Alberto Pinto", category: "CALCIO", event_start: "2026-12-19 17:30:00", call_time: "2026-12-19 13:30:00", notes: "Serie C Girone C - Stadio Alberto Pinto", status: "Da confermare", earnings: 0.0, conflict: false },
    // Mostra d'Oltremare (mostradoltremare.it)
    { id: 401, title: "Concorso Comune di Bacoli – Prove scritte", venue: "Mostra d'Oltremare", category: "FIERA", event_start: "2026-10-16 09:30:00", call_time: "2026-10-16 08:30:00", notes: "Padiglioni Mostra d'Oltremare - Concorso pubblico", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 402, title: "LTS EXPO NAPOLI 2026 – 2^ edizione", venue: "Mostra d'Oltremare", category: "FIERA", event_start: "2026-10-16 10:00:00", call_time: "2026-10-16 08:30:00", notes: "Esposizione fieristica presso Mostra d'Oltremare", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 403, title: "CAFE' CHANTANT – MY WORLD", venue: "Mostra d'Oltremare", category: "FIERA", event_start: "2026-10-16 21:00:00", call_time: "2026-10-16 08:30:00", notes: "Teatro Mediterraneo - Spettacolo serale", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 404, title: "TUTTO SPOSI 2026 – 37^ edizione – primo weekend", venue: "Mostra d'Oltremare", category: "FIERA", event_start: "2026-10-17 10:30:00", call_time: "2026-10-17 08:30:00", notes: "Fiera del Wedding e Arredamento", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 405, title: "PHARMEXPO 2026 – 18^ edizione", venue: "Mostra d'Oltremare", category: "FIERA", event_start: "2026-10-23 10:00:00", call_time: "2026-10-23 08:30:00", notes: "Salone dell'industria farmaceutica del Mediterraneo", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 406, title: "TUTTO SPOSI 2026 – 37^ edizione – 2° weekend", venue: "Mostra d'Oltremare", category: "FIERA", event_start: "2026-10-24 10:30:00", call_time: "2026-10-24 08:30:00", notes: "Fiera del Wedding e Arredamento - Secondo weekend", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 407, title: "ORIENTASUD 2026 – 27^ edizione", venue: "Mostra d'Oltremare", category: "FIERA", event_start: "2026-11-04 08:00:00", call_time: "2026-11-04 08:00:00", notes: "Salone dell'orientamento universitario e professionale", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 408, title: "CREATTIVA 2026 – 15^ edizione", venue: "Mostra d'Oltremare", category: "FIERA", event_start: "2026-11-05 10:00:00", call_time: "2026-11-05 08:30:00", notes: "Fiera delle arti manuali e bricolage", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 409, title: "AESTETICA 2026 – 29^ edizione", venue: "Mostra d'Oltremare", category: "FIERA", event_start: "2026-11-07 10:00:00", call_time: "2026-11-07 08:30:00", notes: "Fiera dell'estetica, salute e benessere", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 410, title: "GUSTUS 2026 – 12^ edizione", venue: "Mostra d'Oltremare", category: "FIERA", event_start: "2026-11-15 10:00:00", call_time: "2026-11-15 08:30:00", notes: "Expo dei sapori mediterranei e agroalimentare", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 411, title: "PADELNESS e SPORT 2026", venue: "Mostra d'Oltremare", category: "FIERA", event_start: "2026-11-20 10:00:00", call_time: "2026-11-20 08:30:00", notes: "Salone dello sport e del padel", status: "Da confermare", earnings: 0.0, conflict: false },
    { id: 412, title: "ARKEDA 2026 – 13^ edizione", venue: "Mostra d'Oltremare", category: "FIERA", event_start: "2026-11-27 10:00:00", call_time: "2026-11-27 08:30:00", notes: "Salone dell'architettura e del design", status: "Da confermare", earnings: 0.0, conflict: false }
  ];
}

function getLocalEvents() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_EVENTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (e) {
    console.warn('Errore lettura LocalStorage:', e);
    return null;
  }
}

function saveLocalEvents(events) {
  try {
    localStorage.setItem(LOCAL_STORAGE_EVENTS_KEY, JSON.stringify(events));
  } catch (e) {
    console.error('Errore scrittura LocalStorage:', e);
  }
}

function recomputeLocalConflicts(events) {
  if (!events || !events.length) return;
  const byDate = {};
  events.forEach(e => {
    if (!e.event_start) return;
    const d = e.event_start.slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(e);
  });

  Object.keys(byDate).forEach(d => {
    const isConflict = byDate[d].length > 1;
    byDate[d].forEach(ev => {
      ev.conflict = isConflict;
    });
  });
}

function computeLocalAlertsData(events) {
  const byDate = {};
  events.forEach(e => {
    if (!e.event_start) return;
    const d = e.event_start.slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(e);
  });

  const conflicts = [];
  Object.keys(byDate).forEach(d => {
    if (byDate[d].length > 1) {
      conflicts.push({
        date: d,
        count: byDate[d].length,
        events: byDate[d]
      });
    }
  });

  const changes = events.filter(e => e.updated_flag === 1 || e.updated_flag === true);

  return {
    conflicts_count: conflicts.length,
    time_changes_count: changes.length,
    conflicts: conflicts,
    time_changes: changes
  };
}

// Sincronizzazione intelligente col backend: scarica partite nuove e aggiorna date/orari cambiati senza toccare le scelte dell'utente
async function syncSoftWithBackend() {
  try {
    const res = await apiGet('/api/events');
    if (!res || !res.events || !res.events.length) return;

    let hasChanges = false;
    res.events.forEach(remoteEv => {
      // Cerca l'evento per ID oppure per corrispondenza di titolo e sede (es. "Napoli vs Roma" allo Stadio Maradona)
      const exists = STATE.events.find(e => 
        e.id === remoteEv.id || 
        (e.title && remoteEv.title && e.title.trim().toLowerCase() === remoteEv.title.trim().toLowerCase() && e.venue === remoteEv.venue)
      );

      if (exists) {
        // Se Lega Calcio o Mostra d'Oltremare ha spostato data o orario (anticipo/posticipo)
        if (remoteEv.event_start && exists.event_start !== remoteEv.event_start) {
          console.log(`[SYNC] Cambio data/orario per "${exists.title}": da ${exists.event_start} a ${remoteEv.event_start}`);
          exists.event_start = remoteEv.event_start;
          exists.call_time = remoteEv.call_time || remoteEv.event_start;
          exists.updated_flag = true;
          hasChanges = true;
        }
      } else {
        // Nuovo evento aggiunto in calendario
        STATE.events.push(remoteEv);
        hasChanges = true;
      }
    });

    if (hasChanges) {
      recomputeLocalConflicts(STATE.events);
      saveLocalEvents(STATE.events);
      renderHudCalendar();
      renderNextShift();
      renderShiftsList();
      renderLocalAlerts();
    }
  } catch (e) {
    // Normale quando il server è spento o l'utente è offline
  }
}

// ─── Load Events (Local-First Engine) ───────────────────────────
async function loadEvents() {
  try {
    // 1. Legge prima dal database locale dello smartphone (LocalStorage)
    let local = getLocalEvents();

    if (local && local.length > 0) {
      STATE.events = local;
      console.log(`[STORAGE] Caricati ${local.length} eventi dal database locale dello smartphone`);
    } else {
      // Prima apertura sul telefono: prova il server, altrimenti carica il seed integrato
      let initialEvents = [];
      try {
        const remote = await apiGet('/api/events');
        if (remote && remote.events && remote.events.length > 0) {
          initialEvents = remote.events;
        }
      } catch (err) {
        console.warn('Backend non raggiungibile alla prima apertura, uso catalogo locale integrato');
      }

      if (!initialEvents || initialEvents.length === 0) {
        initialEvents = getDefaultSeedEvents();
      }

      STATE.events = initialEvents;
      saveLocalEvents(STATE.events);
      console.log(`[STORAGE] Database locale inizializzato con ${initialEvents.length} eventi`);
    }

    recomputeLocalConflicts(STATE.events);
    renderHudCalendar();
    renderNextShift();
    renderShiftsList();
    renderLocalAlerts();

    // Sincronizzazione discreta in background con nuove partite (senza toccare gli stati/guadagni dell'utente)
    syncSoftWithBackend();
  } catch (err) {
    console.error('Errore caricamento eventi:', err);
    if (!STATE.events || STATE.events.length === 0) {
      STATE.events = getDefaultSeedEvents();
      recomputeLocalConflicts(STATE.events);
      renderHudCalendar();
      renderNextShift();
      renderShiftsList();
      renderLocalAlerts();
    }
  }
}

// ─── Next Shift Card ────────────────────────────────────────────
function renderNextShift() {
  const future = STATE.events
    .filter(e => !isEventHiddenFromCalendar(e) && isFuture(e.event_start))
    .sort((a, b) => new Date(a.event_start.replace(' ', 'T')) - new Date(b.event_start.replace(' ', 'T')));

  const sideTitle = document.getElementById('sidebar-next-shift-title');
  const sideTime = document.getElementById('sidebar-next-shift-time');

  if (!future.length) {
    if (sideTitle) sideTitle.textContent = 'Nessun turno futuro';
    if (sideTime) sideTime.textContent = '—';
    return;
  }

  const next = future[0];
  if (sideTitle) sideTitle.textContent = next.title;
  if (sideTime) sideTime.textContent = formatDateTime(next.event_start);
}

// ─── HUD Calendar Master Render ─────────────────────────────────
function renderHudCalendar() {
  const monthNames = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
  ];

  // Aggiorna titolo Top Header (es. STEWARD // OTTOBRE 2026)
  const headerMonthLabel = document.getElementById('hud-month-label');
  if (headerMonthLabel) {
    const curM = monthNames[STATE.selectedDate.getMonth()].toUpperCase();
    const curY = STATE.selectedDate.getFullYear();
    headerMonthLabel.textContent = `${curM} ${curY}`;
  }

  // Renderizza Mini Calendario Sidebar
  renderMiniCalendar();

  // Switch contenitori di vista
  const weekView = document.getElementById('hud-week-view');
  const dayView = document.getElementById('hud-day-view');
  const monthView = document.getElementById('hud-month-view');

  if (weekView) weekView.style.display = STATE.currentView === 'week' ? 'flex' : 'none';
  if (dayView) dayView.style.display = STATE.currentView === 'day' ? 'flex' : 'none';
  if (monthView) monthView.style.display = STATE.currentView === 'month' ? 'flex' : 'none';

  // Aggiorna bottoni pill vista
  document.querySelectorAll('.hud-view-pill').forEach(btn => {
    const isAct = btn.dataset.view === STATE.currentView;
    btn.classList.toggle('active', isAct);
    btn.setAttribute('aria-checked', isAct ? 'true' : 'false');
  });

  if (STATE.currentView === 'week') {
    renderHudWeekView();
  } else if (STATE.currentView === 'day') {
    renderHudDayView();
  } else if (STATE.currentView === 'month') {
    renderHudMonthView();
  }
}

// ─── Mini Calendar Component ────────────────────────────────────
function renderMiniCalendar() {
  const titleEl = document.getElementById('mini-cal-title');
  const gridEl = document.getElementById('mini-cal-grid');
  if (!gridEl) return;

  const monthNames = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
  ];

  const viewYear = STATE.miniCalMonth.getFullYear();
  const viewMonth = STATE.miniCalMonth.getMonth();
  if (titleEl) {
    titleEl.textContent = `${monthNames[viewMonth]} ${viewYear}`;
  }

  const firstDay = new Date(viewYear, viewMonth, 1);
  const lastDay = new Date(viewYear, viewMonth + 1, 0);
  const daysInMonth = lastDay.getDate();

  // Lunedì = 0: Lu=0, Lt=1, Mi=2, Gio=3, V=4, Sa=5, Do=6
  let startingDay = firstDay.getDay() - 1;
  if (startingDay < 0) startingDay = 6;

  const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();

  let html = '';

  // Giorni mese precedente
  for (let i = startingDay - 1; i >= 0; i--) {
    const dNum = prevMonthLastDay - i;
    const prevDate = new Date(viewYear, viewMonth - 1, dNum);
    html += `<div class="mini-day-cell other-month" data-date="${formatYMD(prevDate)}">${dNum}</div>`;
  }

  // Giorni mese corrente
  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(viewYear, viewMonth, d);
    const dateStr = formatYMD(curDate);
    const isSelected = isSameDay(curDate, STATE.selectedDate);

    // Verifica eventi presenti per questo giorno (esclude Riposo/Ignora dal calendario)
    const hasEvents = STATE.events.some(e => !isEventHiddenFromCalendar(e) && e.event_start.startsWith(dateStr));
    const isTech = (d === 31); // 31 con corner tech come nello screenshot

    let classes = 'mini-day-cell';
    if (isSelected) classes += ' active-day';
    if (hasEvents) classes += ' has-event';
    if (isTech) classes += ' tech-corner';

    html += `<div class="${classes}" data-date="${dateStr}">${d}</div>`;
  }

  // Giorni mese successivo a completamento griglia
  const totalRendered = startingDay + daysInMonth;
  const remainingCells = (totalRendered <= 35 ? 35 : 42) - totalRendered;
  for (let n = 1; n <= remainingCells; n++) {
    const nextDate = new Date(viewYear, viewMonth + 1, n);
    html += `<div class="mini-day-cell other-month" data-date="${formatYMD(nextDate)}">${n}</div>`;
  }

  gridEl.innerHTML = html;

  // Click su giorno mini calendario
  gridEl.querySelectorAll('.mini-day-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const targetDateStr = cell.dataset.date;
      if (targetDateStr) {
        STATE.selectedDate = new Date(targetDateStr + 'T09:30:00');
        renderHudCalendar();
      }
    });
  });
}

// ─── Week View Component (Screenshot Replicant) ─────────────────
function renderHudWeekView() {
  const headersEl = document.getElementById('week-day-headers');
  const timeGutterEl = document.getElementById('hud-time-gutter');
  const gridLinesEl = document.getElementById('week-grid-lines');
  const dayColumnsEl = document.getElementById('week-day-columns');
  const timeLineEl = document.getElementById('hud-current-time-line');
  if (!headersEl || !dayColumnsEl) return;

  const monday = getMonday(STATE.selectedDate);
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekDays.push(d);
  }

  const shortDayNames = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

  // 1. Intestazioni 7 Colonne con Badge Turni Integrati
  headersEl.innerHTML = weekDays.map((d, idx) => {
    const dNum = d.getDate();
    const dName = shortDayNames[idx];
    const isSelected = isSameDay(d, STATE.selectedDate);
    const activeClass = isSelected ? ' active-day-header' : '';
    const dateStr = formatYMD(d);

    // Eventi di questa giornata per mostrare pill riassuntiva in testata (esclude Riposo)
    const dayEvs = STATE.events.filter(ev => {
      if (isEventHiddenFromCalendar(ev)) return false;
      if (!ev.event_start.startsWith(dateStr)) return false;
      return STATE.activeCategories.has(classifyEventCategory(ev));
    });

    const badgesHtml = dayEvs.map(ev => {
      const style = getHudEventStyle(ev);
      const tStr = formatTime(ev.event_start);
      let short = ev.title
        .replace(/^Napoli vs /i, 'vs ')
        .replace(/^Juve Stabia vs /i, 'vs ')
        .replace(/^Casertana vs /i, 'vs ');
      if (short.length > 17) short = short.substring(0, 15) + '…';
      return `<div class="col-shift-pill ${style.class}" title="${ev.title} (Inizio: ${tStr})">${style.glyph} ${tStr} ${short}</div>`;
    }).join('');

    return `<div class="week-day-col-header${activeClass}" data-date="${dateStr}" role="button" tabindex="0" title="Visualizza turni del ${dNum} ${dName}">
      <div class="col-header-date-line">${dNum} ${dName}</div>
      <div class="col-header-badges">${badgesHtml}</div>
    </div>`;
  }).join('');

  headersEl.querySelectorAll('.week-day-col-header').forEach(header => {
    header.addEventListener('click', () => {
      const dateStr = header.dataset.date;
      if (dateStr) {
        STATE.selectedDate = new Date(dateStr + 'T09:30:00');
        renderHudCalendar();
        setTimeout(() => scrollToEventOrDay(dateStr), 60);
      }
    });
  });

  // 2. Time Gutter (08:00 - 23:00)
  if (timeGutterEl) {
    let gutterHtml = '';
    for (let h = 8; h <= 23; h++) {
      const top = (h - 8) * 60;
      const hStr = String(h).padStart(2, '0') + ':00';
      gutterHtml += `<div class="gutter-hour-mark" style="top:${top}px;">${hStr}</div>`;
    }
    timeGutterEl.innerHTML = gutterHtml;
  }

  // 3. Linee Griglia Orizzontali
  if (gridLinesEl) {
    let linesHtml = '';
    for (let h = 8; h <= 23; h++) {
      const top = (h - 8) * 60;
      linesHtml += `<div class="grid-hour-line" style="top:${top}px;"></div>`;
    }
    gridLinesEl.innerHTML = linesHtml;
  }

  // 4. Linea Orario Corrente (con punto luminoso)
  if (timeLineEl) {
    let curHour = 9, curMin = 45; // Match screenshot per la data 14 Ottobre
    const selectedYMD = formatYMD(STATE.selectedDate);
    if (selectedYMD === formatYMD(new Date())) {
      const now = new Date();
      curHour = now.getHours();
      curMin = now.getMinutes();
    }
    if (curHour >= 8 && curHour <= 23) {
      const timeTop = ((curHour - 8) + curMin / 60) * 60;
      timeLineEl.style.top = `${timeTop}px`;
      timeLineEl.style.display = 'block';
    } else {
      timeLineEl.style.display = 'none';
    }
  }

  // 5. Colonne e Posizionamento Event Cards
  dayColumnsEl.innerHTML = weekDays.map((d) => {
    const dateStr = formatYMD(d);
    const isSelected = isSameDay(d, STATE.selectedDate);
    const colClass = isSelected ? 'week-day-column active-day-col' : 'week-day-column';

    // Filtra eventi per la data e categorie attive (esclude eventi con stato Riposo/Ignora)
    const colEvents = STATE.events.filter(ev => {
      if (isEventHiddenFromCalendar(ev)) return false;
      if (!ev.event_start.startsWith(dateStr)) return false;
      const catGroup = classifyEventCategory(ev);
      return STATE.activeCategories.has(catGroup);
    });

    // Render Event Cards
    const cardsHtml = colEvents.map(ev => {
      const style = getHudEventStyle(ev);
      const timeParts = ev.event_start.split(' ')[1] || '09:00:00';
      const [h, m] = timeParts.split(':').map(Number);
      const startMinutes = (h - 8) * 60 + m;
      const top = Math.max(0, (startMinutes / 60) * 60);

      // Stima durata evento
      let durationHours = 2.0;
      const group = classifyEventCategory(ev);
      if (group === 'NAPOLI' || group === 'STABIA' || group === 'CASERTANA') {
        durationHours = 2.5;
      } else if (group === 'MOSTRA') {
        durationHours = 3.5;
      } else {
        durationHours = 1.5;
      }

      const height = Math.max(62, durationHours * 60);

      const startTimeFormatted = formatTime(ev.event_start);
      const endDt = new Date(new Date(ev.event_start.replace(' ', 'T')).getTime() + durationHours * 3600 * 1000);
      const endTimeFormatted = formatTime(endDt.toISOString());
      
      const convText = ev.call_time ? `🚨 Conv. ${formatTime(ev.call_time)}` : '';
      const venueText = ev.venue || 'Sede';
      const subText = convText ? `${convText} • ${venueText}` : (ev.notes || venueText);
      const earningsFormatted = formatEarnings(ev.earnings);
      const earningsHtml = earningsFormatted
        ? `<div class="hud-event-card-earnings">💰 Guadagno: ${earningsFormatted}</div>`
        : '';

      return `
        <div class="hud-event-card ${style.class}" style="top: ${top}px; height: ${height}px;" data-event-id="${ev.id}" role="button" tabindex="0" title="${ev.title}">
          <div class="hud-event-card-time">${startTimeFormatted} - ${endTimeFormatted}</div>
          <div class="hud-event-card-title">${ev.title}</div>
          <div class="hud-event-card-sub">• ${subText}</div>
          ${earningsHtml}
          <div class="hud-event-card-glyph">${style.glyph || '🛡️'}</div>
        </div>
      `;
    }).join('');

    return `<div class="${colClass}" data-date="${dateStr}">${cardsHtml}</div>`;
  }).join('');

  // Click sulle card evento -> apre Bottom Sheet
  dayColumnsEl.querySelectorAll('.hud-event-card').forEach(card => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(card.dataset.eventId);
      const ev = STATE.events.find(x => x.id === id);
      if (ev) openBottomSheet(ev);
    });
  });

  // Auto-scroll automatico al turno della giornata selezionata (o al primo turno visibile)
  setTimeout(() => scrollToEventOrDay(formatYMD(STATE.selectedDate)), 120);
}

// ─── Auto-Scroll Helper per Scroller Griglia ───────────────────────
function scrollToEventOrDay(targetYMD) {
  const scroller = document.getElementById('week-grid-scroller');
  if (!scroller) return;

  const dayEvs = STATE.events.filter(ev => {
    if (isEventHiddenFromCalendar(ev)) return false;
    if (!ev.event_start.startsWith(targetYMD)) return false;
    return STATE.activeCategories.has(classifyEventCategory(ev));
  });

  if (dayEvs.length > 0) {
    const firstEv = dayEvs[0];
    const timeStr = (firstEv.call_time || firstEv.event_start).split(' ')[1] || '09:00:00';
    const [h, m] = timeStr.split(':').map(Number);
    const targetTop = Math.max(0, ((h - 8) + m / 60) * 60 - 80);
    scroller.scrollTo({ top: targetTop, behavior: 'smooth' });
  } else {
    // Se non ci sono eventi sul giorno selezionato, cerca il primo turno visibile della settimana
    const monday = getMonday(STATE.selectedDate);
    let weekEarliestTop = 9999;
    for (let i = 0; i < 7; i++) {
      const wd = new Date(monday);
      wd.setDate(monday.getDate() + i);
      const wYMD = formatYMD(wd);
      const evs = STATE.events.filter(e => !isEventHiddenFromCalendar(e) && e.event_start.startsWith(wYMD) && STATE.activeCategories.has(classifyEventCategory(e)));
      for (const e of evs) {
        const t = (e.call_time || e.event_start).split(' ')[1] || '09:00:00';
        const [eh, em] = t.split(':').map(Number);
        const et = Math.max(0, ((eh - 8) + em / 60) * 60 - 80);
        if (et < weekEarliestTop) weekEarliestTop = et;
      }
    }
    if (weekEarliestTop < 9999) {
      scroller.scrollTo({ top: weekEarliestTop, behavior: 'smooth' });
    } else {
      scroller.scrollTo({ top: 40, behavior: 'smooth' });
    }
  }
}

// ─── Day View Component ─────────────────────────────────────────
function renderHudDayView() {
  const dayHeader = document.getElementById('day-view-header');
  const dayGutter = document.getElementById('day-time-gutter');
  const dayLines = document.getElementById('day-grid-lines');
  const dayEventsWrap = document.getElementById('day-events-wrap');
  if (!dayHeader || !dayEventsWrap) return;

  const dateStr = formatDate(formatYMD(STATE.selectedDate));
  dayHeader.textContent = `VISTA GIORNALIERA // ${dateStr.toUpperCase()}`;

  let gutterHtml = '';
  let linesHtml = '';
  for (let h = 8; h <= 23; h++) {
    const top = (h - 8) * 60;
    const hStr = String(h).padStart(2, '0') + ':00';
    gutterHtml += `<div class="gutter-hour-mark" style="top:${top}px;">${hStr}</div>`;
    linesHtml += `<div class="grid-hour-line" style="top:${top}px;"></div>`;
  }
  dayGutter.innerHTML = gutterHtml;
  dayLines.innerHTML = linesHtml;

  const selectedYMD = formatYMD(STATE.selectedDate);
  const dayEvents = STATE.events.filter(ev => {
    if (isEventHiddenFromCalendar(ev)) return false;
    if (!ev.event_start.startsWith(selectedYMD)) return false;
    const catGroup = classifyEventCategory(ev);
    return STATE.activeCategories.has(catGroup);
  });

  dayEventsWrap.innerHTML = dayEvents.map(ev => {
    const style = getHudEventStyle(ev);
    const timeParts = ev.event_start.split(' ')[1] || '09:00:00';
    const [h, m] = timeParts.split(':').map(Number);
    const top = Math.max(0, ((h - 8) + m / 60) * 60);
    const height = 85;
    const startTimeFormatted = formatTime(ev.event_start);
    const convText = ev.call_time ? `🚨 Conv. ${formatTime(ev.call_time)}` : '';
    const venueText = ev.venue || 'Sede';
    const subText = convText ? `${convText} • ${venueText}` : (ev.notes || venueText);
    const earningsFormatted = formatEarnings(ev.earnings);
    const earningsHtml = earningsFormatted
      ? `<div class="hud-event-card-earnings">💰 Guadagno: ${earningsFormatted}</div>`
      : '';

    return `
      <div class="hud-event-card ${style.class}" style="top: ${top}px; height: ${height}px; left: 16px; right: 16px;" data-event-id="${ev.id}" role="button" tabindex="0">
        <div class="hud-event-card-time">${startTimeFormatted}</div>
        <div class="hud-event-card-title">${ev.title}</div>
        <div class="hud-event-card-sub">• ${subText}</div>
        ${earningsHtml}
        <div class="hud-event-card-glyph">${style.glyph || '🛡️'}</div>
      </div>
    `;
  }).join('');

  dayEventsWrap.querySelectorAll('.hud-event-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = parseInt(card.dataset.eventId);
      const ev = STATE.events.find(x => x.id === id);
      if (ev) openBottomSheet(ev);
    });
  });
}

// ─── Month View Component ───────────────────────────────────────
function renderHudMonthView() {
  const bodyEl = document.getElementById('month-grid-body');
  if (!bodyEl) return;

  const year = STATE.selectedDate.getFullYear();
  const month = STATE.selectedDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();

  let startingDay = firstDay.getDay() - 1;
  if (startingDay < 0) startingDay = 6;

  let html = '';
  const prevMonthLast = new Date(year, month, 0).getDate();

  for (let i = startingDay - 1; i >= 0; i--) {
    const dNum = prevMonthLast - i;
    html += `<div class="month-cell" style="opacity:0.35;"><span class="month-cell-num">${dNum}</span></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(year, month, d);
    const dateStr = formatYMD(curDate);
    const isSelected = isSameDay(curDate, STATE.selectedDate);
    const activeClass = isSelected ? ' active-today' : '';

    const dayEvs = STATE.events.filter(e => {
      if (isEventHiddenFromCalendar(e)) return false;
      if (!e.event_start.startsWith(dateStr)) return false;
      return STATE.activeCategories.has(classifyEventCategory(e));
    });

    const chips = dayEvs.slice(0, 3).map(ev => {
      const style = getHudEventStyle(ev);
      return `<div class="month-chip ${style.class}" title="${ev.title}">${formatTime(ev.event_start)} ${ev.title}</div>`;
    }).join('');

    const more = dayEvs.length > 3 ? `<div style="font-size:8px;color:#00E5FF;">+${dayEvs.length - 3} altri</div>` : '';

    html += `
      <div class="month-cell${activeClass}" data-date="${dateStr}">
        <span class="month-cell-num">${d}</span>
        ${chips}
        ${more}
      </div>
    `;
  }

  bodyEl.innerHTML = html;

  bodyEl.querySelectorAll('.month-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const dStr = cell.dataset.date;
      if (!dStr) return;
      STATE.selectedDate = new Date(dStr + 'T09:30:00');
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        const dayEvs = STATE.events.filter(e => e.event_start && e.event_start.startsWith(dStr) && !isEventHiddenFromCalendar(e));
        if (dayEvs.length === 1) {
          openBottomSheet(dayEvs[0]);
        } else if (dayEvs.length > 1) {
          STATE.currentView = 'day';
          renderHudCalendar();
        } else {
          STATE.currentView = 'day';
          renderHudCalendar();
        }
      } else {
        STATE.currentView = 'week';
        renderHudCalendar();
      }
    });
  });
}

function switchCalendarView(view) {
  STATE.currentView = view;
  renderHudCalendar();
}

// ─── Shifts List ────────────────────────────────────────────────
function renderShiftsList() {
  const container = document.getElementById('shifts-list');
  const future = STATE.events
    .filter(e => isFuture(e.event_start))
    .sort((a, b) => new Date(a.event_start.replace(' ', 'T')) - new Date(b.event_start.replace(' ', 'T')));

  if (!future.length) {
    container.innerHTML = `<div class="empty-state">NESSUN TURNO FUTURO</div>`;
    return;
  }

  container.innerHTML = future.map(ev => {
    const style = getCategoryStyle(ev);
    let statusClass = 'pending', statusLabel = 'DA CONFERMARE';
    if ((ev.status || '').toLowerCase().includes('lavoro')) { statusClass = 'lavoro'; statusLabel = '✅ LAVORO IO'; }
    else if ((ev.status || '').toLowerCase().includes('riposo')) { statusClass = 'riposo'; statusLabel = '❌ RIPOSO'; }
    if (ev.conflict) { statusClass = 'conflict'; statusLabel = '⚠️ CONFLITTO'; }

    const earningsFormatted = formatEarnings(ev.earnings);
    const earningsHtml = earningsFormatted
      ? `<div class="shift-earnings-row"><span>💰</span><span>Guadagno: <strong style="color:var(--emerald,#10B981);">${earningsFormatted}</strong></span></div>`
      : '';

    return `
    <div class="shift-card${ev.conflict ? ' conflict' : ''}" data-event-id="${ev.id}" role="button" tabindex="0" aria-label="Evento: ${ev.title}">
      <div class="shift-card-top">
        <div class="shift-title">${ev.title}</div>
        <div class="status-badge ${statusClass}">${statusLabel}</div>
      </div>
      <div class="shift-meta">
        <div class="shift-meta-item"><span>⏰</span><span>${formatDateTime(ev.event_start)}</span></div>
        ${ev.venue ? `<div class="shift-meta-item"><span>📍</span><span>${ev.venue}</span></div>` : ''}
      </div>
      <div class="shift-call-time">
        <span>🔔</span>
        <span>Convocazione: <strong>${formatDateTime(ev.call_time)}</strong></span>
      </div>
      ${earningsHtml}
      <div><span class="cat-badge ${style.badgeClass}">${style.label}</span></div>
    </div>`;
  }).join('');

  // Attach touch handlers
  container.querySelectorAll('.shift-card').forEach(card => {
    card.addEventListener('click', () => {
      const ev = STATE.events.find(e => e.id === parseInt(card.dataset.eventId));
      if (ev) openBottomSheet(ev);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') card.click();
    });
  });
}

// ─── Alerts ─────────────────────────────────────────────────────
async function loadAlerts() {
  try {
    const data = await apiGet('/api/alerts');
    renderAlerts(data);
  } catch (err) {
    console.error('Errore avvisi:', err);
  }
}

function renderAlerts(data) {
  const conflictsCount = data.conflicts_count || 0;
  const changesCount = data.time_changes_count || 0;
  const total = conflictsCount + changesCount;

  document.getElementById('alert-conflicts-count').textContent = conflictsCount;
  document.getElementById('alert-changes-count').textContent = changesCount;

  const badge = document.getElementById('alerts-badge');
  if (total > 0) {
    badge.textContent = total;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }

  const container = document.getElementById('alerts-list');
  const items = [];

  (data.conflicts || []).forEach(c => {
    items.push(`
    <div class="alert-item conflict">
      <div class="alert-icon">⚠️</div>
      <div class="alert-body">
        <div class="alert-title">Conflitto il ${c.date}</div>
        <div class="alert-desc">${c.count} eventi sovrapposti: ${c.events.map(e => e.title).join(' vs ')}</div>
      </div>
    </div>`);
  });

  (data.time_changes || []).forEach(e => {
    items.push(`
    <div class="alert-item change">
      <div class="alert-icon">🕐</div>
      <div class="alert-body">
        <div class="alert-title">Cambio Orario: ${e.title}</div>
        <div class="alert-desc">Nuovo orario: ${formatDateTime(e.event_start)}</div>
      </div>
    </div>`);
  });

  container.innerHTML = items.length
    ? items.join('')
    : `<div class="empty-state">✅ NESSUN AVVISO ATTIVO<br><br>Tutti i turni sono regolari</div>`;
}

// ─── Google Calendar Link Generator ─────────────────────────────
function generateGoogleCalendarUrl(event) {
  if (!event) return '#';
  try {
    const callDt = new Date(event.call_time ? event.call_time.replace(' ', 'T') : event.event_start.replace(' ', 'T'));
    const startDt = new Date(event.event_start.replace(' ', 'T'));

    const isFiera = (event.category || '').toUpperCase() === 'FIERA';
    const endDurationHours = isFiera ? 8 : 3;
    const endDt = new Date(startDt.getTime() + endDurationHours * 60 * 60 * 1000);

    const toGCalISO = (d) => d.toISOString().replace(/-|:|\.\d\d\d/g, '');

    const dates = `${toGCalISO(callDt)}/${toGCalISO(endDt)}`;
    const callTimeHM = formatTime(event.call_time);
    const title = `[STEWARD] ${event.title} (Conv: ${callTimeHM})`;

    const details = [
      '👮 TURNO SERVIZIO STEWARD',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      `📌 Evento: ${event.title}`,
      `🔔 CONVOCAZIONE: ${formatDateTime(event.call_time)} (4 ORE PRIMA)`,
      `⚽ Inizio Partita/Evento: ${formatDateTime(event.event_start)}`,
      `📍 Sede: ${event.venue || 'Non specificata'}`,
      `🏷️ Categoria: ${event.category || 'CALCIO'}`,
      `📋 Stato: ${event.status || 'Da confermare'}`,
      event.notes ? `📝 Note: ${event.notes}` : '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      'Generato da S.T.E.W.A.R.D. OS — Sincronizzazione Intelligente'
    ].filter(Boolean).join('\n');

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: dates,
      details: details,
      location: event.venue || '',
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  } catch (err) {
    console.error('Errore generazione link Google Calendar:', err);
    return '#';
  }
}

// ─── Bottom Sheet ────────────────────────────────────────────────
function openBottomSheet(ev) {
  STATE.selectedEvent = ev;
  const style = getCategoryStyle(ev);

  document.getElementById('sheet-event-title').textContent = ev.title;
  document.getElementById('sheet-event-badge').innerHTML =
    `<span class="cat-badge ${style.badgeClass}">${style.label}</span>`;
  document.getElementById('sheet-event-time').textContent = formatDateTime(ev.event_start);
  document.getElementById('sheet-call-time').textContent = formatDateTime(ev.call_time);
  document.getElementById('sheet-venue').textContent = ev.venue || 'Non specificata';

  const notesRow = document.getElementById('sheet-notes-row');
  if (ev.notes) {
    notesRow.style.display = 'flex';
    document.getElementById('sheet-notes').textContent = ev.notes;
  } else {
    notesRow.style.display = 'none';
  }

  // Visualizzazione riga guadagno nel foglio dettagli evento
  const earningsRow = document.getElementById('sheet-earnings-row');
  const earningsFormatted = formatEarnings(ev.earnings);
  if (earningsRow) {
    if (earningsFormatted) {
      earningsRow.style.display = 'flex';
      document.getElementById('sheet-earnings').textContent = earningsFormatted;
    } else {
      earningsRow.style.display = 'none';
    }
  }

  const conflictRow = document.getElementById('sheet-conflict-row');
  conflictRow.style.display = ev.conflict ? 'flex' : 'none';

  // Configurazione pulsante eliminazione per eventi personali / aggiunti
  const isCustom = (classifyEventCategory(ev) === 'CUSTOM') || ((ev.category || '').toUpperCase() === 'CUSTOM');
  const deleteBtn = document.getElementById('btn-sheet-delete');
  if (deleteBtn) {
    deleteBtn.style.display = 'flex';
    deleteBtn.innerHTML = isCustom ? '🗑️ Elimina Evento Personale' : '🗑️ Elimina Evento';
  }

  const overlay = document.getElementById('sheet-overlay');
  const sheet = document.getElementById('bottom-sheet');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => sheet.classList.add('open'));

  if (navigator.vibrate) navigator.vibrate(30);
}

function closeBottomSheet() {
  const overlay = document.getElementById('sheet-overlay');
  const sheet = document.getElementById('bottom-sheet');
  sheet.classList.remove('open');
  setTimeout(() => {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    STATE.selectedEvent = null;
  }, 350);
}

async function confirmEvent(status) {
  if (!STATE.selectedEvent) return;
  const currentEv = STATE.selectedEvent;

  // 1. Aggiorna SUBITO nel database locale dello smartphone
  const target = STATE.events.find(e => e.id === currentEv.id);
  if (target) {
    target.status = status;
    saveLocalEvents(STATE.events);
  }

  closeBottomSheet();
  showToast(`Stato aggiornato: ${status}`, 'success');

  // Re-render immediato da memoria locale
  recomputeLocalConflicts(STATE.events);
  renderHudCalendar();
  renderNextShift();
  renderShiftsList();
  renderLocalAlerts();

  // Se l'utente ha impostato 'Lavoro io', apri la schermata per inserire quanti soldi guadagna da quella chiamata
  if (status.toLowerCase().includes('lavoro')) {
    const refreshedEv = STATE.events.find(e => e.id === currentEv.id) || currentEv;
    setTimeout(() => openEarningsModal(refreshedEv), 180);
  }

  // Notifica al server in background se online (silenzioso se offline)
  try {
    apiPost(`/api/events/${currentEv.id}/status`, { status }).catch(() => {});
  } catch (err) {}
}

// ─── Earnings Modal Component ("Piccola schermata" guadagno) ─────
function openEarningsModal(ev) {
  if (!ev) return;
  STATE.earningsTargetEvent = ev;
  const overlay = document.getElementById('earnings-modal-overlay');
  if (!overlay) return;

  const titleEl = document.getElementById('earnings-event-name');
  if (titleEl) titleEl.textContent = ev.title || 'Evento';

  const metaEl = document.getElementById('earnings-event-meta');
  if (metaEl) {
    const dateText = formatDateTime(ev.event_start);
    const convText = ev.call_time ? ` • Conv. ${formatTime(ev.call_time)}` : '';
    const venueText = ev.venue ? ` • ${ev.venue}` : '';
    metaEl.textContent = `${dateText}${convText}${venueText}`;
  }

  const input = document.getElementById('event-earnings-input');
  if (input) {
    input.value = (ev.earnings !== null && ev.earnings !== undefined && ev.earnings !== '') ? ev.earnings : '';
  }

  // Aggiorna stato attivo dei pulsanti preset
  document.querySelectorAll('#earnings-presets .preset-btn').forEach(btn => {
    const amt = parseFloat(btn.dataset.amount);
    btn.classList.toggle('active', amt === parseFloat(ev.earnings));
  });

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');

  setTimeout(() => {
    if (input) {
      input.focus();
      if (input.value) input.select();
    }
  }, 100);
}

function closeEarningsModal() {
  const overlay = document.getElementById('earnings-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  STATE.earningsTargetEvent = null;
}

async function handleEarningsSubmit(e) {
  if (e) e.preventDefault();
  const ev = STATE.earningsTargetEvent;
  if (!ev) {
    closeEarningsModal();
    return;
  }

  const input = document.getElementById('event-earnings-input');
  const rawVal = input?.value.trim();
  let amount = null;
  if (rawVal !== '' && rawVal !== null && rawVal !== undefined) {
    amount = parseFloat(rawVal);
    if (isNaN(amount) || amount < 0) {
      showToast('Inserisci un importo valido', 'error');
      return;
    }
  }

  // 1. Salva SUBITO nel database locale dello smartphone
  const target = STATE.events.find(e => e.id === ev.id);
  if (target) {
    target.earnings = amount;
    saveLocalEvents(STATE.events);
  }

  closeEarningsModal();
  if (amount !== null) {
    showToast(`💰 Guadagno salvato: €${amount.toFixed(2)}`, 'success');
  } else {
    showToast('Compenso rimosso', 'info');
  }

  renderHudCalendar();
  renderNextShift();
  renderShiftsList();

  // Sincronizza col backend in background se online
  try {
    apiPost(`/api/events/${ev.id}/earnings`, { earnings: amount }).catch(() => {});
  } catch (err) {}
}

async function deleteCurrentEvent() {
  if (!STATE.selectedEvent) return;
  const ev = STATE.selectedEvent;
  const isCustom = (classifyEventCategory(ev) === 'CUSTOM') || ((ev.category || '').toUpperCase() === 'CUSTOM');
  const confirmMsg = isCustom
    ? `Vuoi eliminare definitivamente l'evento personale "${ev.title}"?`
    : `Vuoi eliminare definitivamente "${ev.title}" dal calendario?`;

  if (!window.confirm(confirmMsg)) return;

  // 1. Elimina SUBITO dal database locale dello smartphone
  STATE.events = STATE.events.filter(e => e.id !== ev.id);
  saveLocalEvents(STATE.events);

  closeBottomSheet();
  showToast(`Evento "${ev.title}" eliminato con successo!`, 'success');

  recomputeLocalConflicts(STATE.events);
  renderHudCalendar();
  renderNextShift();
  renderShiftsList();
  renderLocalAlerts();

  try {
    apiDelete(`/api/events/${ev.id}`).catch(() => {});
  } catch (err) {}
}

// ─── Sync ───────────────────────────────────────────────────────
function addSyncLog(msg, type = 'info') {
  const log = document.getElementById('sync-log');
  const entry = document.createElement('div');
  entry.className = `sync-log-entry ${type}`;
  const time = new Date().toLocaleTimeString('it-IT');
  entry.textContent = `[${time}] ${msg}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

async function triggerSync() {
  const btn = document.getElementById('btn-sync-main');
  const icon = document.getElementById('sync-icon');
  const text = document.getElementById('sync-btn-text');

  btn.classList.add('syncing');
  icon.innerHTML = '<span class="spin">🔄</span>';
  text.textContent = 'SINCRONIZZAZIONE IN CORSO...';
  addSyncLog('Avvio sincronizzazione calendari...', 'info');

  try {
    const result = await apiPost('/api/sync', { force_seed: false });
    STATE.lastSync = new Date();
    document.getElementById('last-sync-time').textContent =
      STATE.lastSync.toLocaleString('it-IT');

    addSyncLog(`✅ Completato: ${result.events_synced || 0} eventi aggiornati`, 'success');
    if (result.conflicts_count > 0) {
      addSyncLog(`⚠️ ${result.conflicts_count} conflitti rilevati`, 'info');
    }
    showToast('Calendari aggiornati!', 'success');
    await loadEvents();
  } catch (err) {
    addSyncLog(`❌ Errore: ${err.message}`, 'error');
    showToast('Errore sincronizzazione', 'error');
  } finally {
    btn.classList.remove('syncing');
    icon.textContent = '🔄';
    text.textContent = 'AGGIORNA TUTTI I CALENDARI';
  }
}

// ─── Tab Navigation ─────────────────────────────────────────────
function switchTab(tabId) {
  STATE.activeTab = tabId;

  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });

  document.getElementById(`tab-${tabId}`).classList.add('active');
  const navBtn = document.getElementById(`nav-${tabId}`);
  navBtn.classList.add('active');
  navBtn.setAttribute('aria-selected', 'true');

  if (tabId === 'calendar' && STATE.calendar) {
    requestAnimationFrame(() => STATE.calendar.updateSize());
  }
  if (tabId === 'alerts') loadAlerts();
}

/* ================================================================
   PARTE 3 — VOCE J.A.R.V.I.S.: Selezione voce + Normalizzatore
   ================================================================ */

// Voce italiana selezionata (riempita da selectBestItalianVoice)
let _bestItalianVoice = null;

/**
 * Seleziona la migliore voce italiana disponibile nel sistema.
 * Ordine di priorità:
 *  1. Voci Neural/Online Microsoft o Google (es. "Microsoft Diego Online (Natural)")
 *  2. Qualsiasi voce it-IT con "Natural", "Online", "Premium" o "Enhanced"
 *  3. Prima voce it-IT disponibile
 */
function selectBestItalianVoice() {
  const voices = speechSynthesis.getVoices();
  const itVoices = voices.filter(v => v.lang.startsWith('it'));

  if (!itVoices.length) return null;

  // Priorità 0: Giuseppe Neural / Multilingual (timbro caldo e umano stile Paul Bettany)
  const giuseppe = itVoices.find(v => v.name.toLowerCase().includes('giuseppe'));
  if (giuseppe) { console.log('[JARVIS TTS] Voce Giuseppe/Paul Bettany:', giuseppe.name); return giuseppe; }

  // Priorità 1: Neural/Online Microsoft o Google
  const tier1 = itVoices.find(v => {
    const n = v.name.toLowerCase();
    return (n.includes('microsoft') || n.includes('google')) &&
           (n.includes('online') || n.includes('natural'));
  });
  if (tier1) { console.log('[JARVIS TTS] Voce tier1:', tier1.name); return tier1; }

  // Priorità 2: Natural / Online / Premium / Enhanced (qualsiasi provider)
  const tier2 = itVoices.find(v => {
    const n = v.name.toLowerCase();
    return n.includes('natural') || n.includes('online') ||
           n.includes('premium') || n.includes('enhanced');
  });
  if (tier2) { console.log('[JARVIS TTS] Voce tier2:', tier2.name); return tier2; }

  // Fallback: prima voce it-IT
  console.log('[JARVIS TTS] Fallback voce:', itVoices[0].name);
  return itVoices[0];
}

/**
 * cleanJarvisSpeechText — Normalizzatore testo per TTS italiano.
 * Corregge preposizioni, ordinali, "vs", orari e garantisce la corretta cadenza su "signore".
 * @param {string} text
 * @returns {string}
 */
function cleanJarvisSpeechText(text) {
  let t = text;

  // Preposizioni articolate (errori grammaticali TTS)
  t = t.replace(/\bdi il\b/gi, 'del');
  t = t.replace(/\bdi la\b/gi, 'della');
  t = t.replace(/\ba il\b/gi, 'al');
  t = t.replace(/\ba la\b/gi, 'alla');
  t = t.replace(/\bda il\b/gi, 'dal');
  t = t.replace(/\bda la\b/gi, 'dalla');
  t = t.replace(/\bsu il\b/gi, 'sul');
  t = t.replace(/\bsu la\b/gi, 'sulla');

  // "vs" → "contro" (il TTS legge "vu-esse" o "v-s")
  t = t.replace(/\bvs\b/gi, 'contro');

  // Ordinali: 1ª→prima, 2ª→seconda, 3ª→terza, ecc.
  const ordinali = { '1ª': 'prima', '2ª': 'seconda', '3ª': 'terza',
                      '4ª': 'quarta', '5ª': 'quinta', '6ª': 'sesta',
                      '1°': 'primo', '2°': 'secondo', '3°': 'terzo',
                      '4°': 'quarto', '5°': 'quinto' };
  for (const [pat, rep] of Object.entries(ordinali)) {
    t = t.split(pat).join(rep);
  }

  // Orari: "HH:MM" → lettura naturale
  // "10:00" → "alle 10" / "08:30" → "alle 8 e 30"
  t = t.replace(/\b(\d{1,2}):00\b/g, (_, h) => h.replace(/^0/, ''));
  t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => `${h.replace(/^0/, '')} e ${m}`);

  // Rimuovi trattini nei codici/sigle
  t = t.replace(/\bSSC\b/gi, 'es-es-ci');

  // Normalizza e ammorbidisce "signore" per evitare cadenze robotiche
  t = t.replace(/[\.\!\?]\s+[Ss]ignore\b/g, ', signore');
  t = t.replace(/,\s*Signore\b/g, ', signore');
  t = t.replace(/\bSignore\b(?=[\s,\.\?!]|$)/g, 'signore');
  if (!t.toLowerCase().includes('signore')) {
    t = t.trim();
    if (t.endsWith('?')) t = t.slice(0, -1).trim() + ', signore?';
    else if (t.endsWith('.')) t = t.slice(0, -1).trim() + ', signore.';
    else t = t + ', signore.';
  }
  t = t.replace(/^signore\b/i, 'Signore');

  return t;
}

// ─── Speech Recognition (J.A.R.V.I.S.) ─────────────────────────
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function initSpeech() {
  if (!SpeechRecognition) {
    console.warn('SpeechRecognition non supportato');
    document.getElementById('arc-status-text').textContent = 'VOCE NON DISPONIBILE';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'it-IT';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    STATE.isListening = true;
    const headerJarvis = document.getElementById('hud-header-jarvis');
    if (headerJarvis) {
      headerJarvis.classList.add('listening');
      headerJarvis.classList.remove('speaking');
    }
    const headerStatus = document.getElementById('header-jarvis-status');
    if (headerStatus) headerStatus.textContent = 'IN ASCOLTO...';

    const capsule = document.getElementById('hud-floating-capsule');
    if (capsule) {
      capsule.classList.add('listening');
      const cmdText = document.getElementById('capsule-command-text');
      if (cmdText) cmdText.textContent = 'IN ASCOLTO...';
    }
    const btn = document.getElementById('arc-reactor-btn');
    if (btn) btn.classList.add('listening');
    const arcText = document.getElementById('arc-status-text');
    if (arcText) arcText.textContent = 'IN ASCOLTO...';
    setJarvisText('Ti ascolto...');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.toLowerCase().trim();
    console.log('Riconosciuto:', transcript);
    processVoiceCommand(transcript);
  };

  recognition.onerror = (event) => {
    console.error('Errore vocale:', event.error);
    resetArcReactor();
    if (event.error === 'not-allowed') {
      setJarvisText('Microfono non autorizzato. Controlla i permessi.');
    } else if (event.error === 'no-speech') {
      setJarvisText('Non ho sentito nulla. Riprova.');
    }
  };

  recognition.onend = () => {
    STATE.isListening = false;
    resetArcReactor();
  };
}

function toggleListening() {
  if (!recognition) {
    showToast('Riconoscimento vocale non disponibile su questo browser', 'info');
    jarvisSpeak('Riconoscimento vocale non disponibile in questo browser.');
    return;
  }

  if (STATE.isListening) {
    try { recognition.stop(); } catch(e){}
    return;
  }

  if (STATE.isSpeaking) {
    speechSynthesis.cancel();
    STATE.isSpeaking = false;
    resetArcReactor();
  }

  try {
    recognition.start();
    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
  } catch (err) {
    console.error('Errore avvio riconoscimento:', err);
    showToast('Errore avvio microfono', 'error');
  }
}

function resetArcReactor() {
  const headerJarvis = document.getElementById('hud-header-jarvis');
  if (headerJarvis) headerJarvis.classList.remove('listening', 'speaking');
  const headerStatus = document.getElementById('header-jarvis-status');
  if (headerStatus) headerStatus.textContent = 'TOCCA PER PARLARE';

  const capsule = document.getElementById('hud-floating-capsule');
  if (capsule) {
    capsule.classList.remove('listening', 'speaking');
    const cmdText = document.getElementById('capsule-command-text');
    if (cmdText) cmdText.textContent = 'TOCCA PER PARLARE';
  }
  const btn = document.getElementById('arc-reactor-btn');
  if (btn) btn.classList.remove('listening', 'speaking');
  const arcText = document.getElementById('arc-status-text');
  if (arcText) arcText.textContent = 'TOCCA PER PARLARE';
}

let _speechBubbleTimer = null;
function setJarvisText(text) {
  const jarvisText = document.getElementById('jarvis-text');
  if (jarvisText) jarvisText.textContent = text;

  const headerBubble = document.getElementById('header-speech-bubble');
  const headerSpeechText = document.getElementById('header-speech-text');
  if (headerBubble && headerSpeechText) {
    headerSpeechText.textContent = text;
    headerBubble.style.display = 'block';
    if (_speechBubbleTimer) clearTimeout(_speechBubbleTimer);
    _speechBubbleTimer = setTimeout(() => {
      if (!STATE.isSpeaking && !STATE.isListening) {
        headerBubble.style.display = 'none';
      }
    }, 6000);
  }

  const bubble = document.getElementById('capsule-feedback-bubble');
  const speechText = document.getElementById('capsule-speech-feedback');
  if (bubble && speechText) {
    bubble.style.display = 'block';
    speechText.textContent = text;
  }
}

let _jarvisAudioPlayer = null;

function fallbackBrowserSpeak(text) {
  const cleanText = cleanJarvisSpeechText(text);
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = 'it-IT';
  utterance.pitch  = 0.92;
  utterance.rate   = 1.03;
  utterance.volume = 1;

  if (_bestItalianVoice) {
    utterance.voice = _bestItalianVoice;
  }

  utterance.onend = () => {
    STATE.isSpeaking = false;
    resetArcReactor();
  };

  utterance.onerror = () => {
    STATE.isSpeaking = false;
    resetArcReactor();
  };

  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

/**
 * playJarvisAudioData — Riproduce audio J.A.R.V.I.S. direttamente da payload data URI base64.
 * Elimina completamente il secondo roundtrip HTTP, avviando la voce all'istante.
 */
function playJarvisAudioData(audioDataUrl, text) {
  STATE.isSpeaking = true;
  const headerJarvis = document.getElementById('hud-header-jarvis');
  if (headerJarvis) {
    headerJarvis.classList.add('speaking');
    headerJarvis.classList.remove('listening');
  }
  const headerStatus = document.getElementById('header-jarvis-status');
  if (headerStatus) headerStatus.textContent = 'J.A.R.V.I.S. PARLA...';

  const capsule = document.getElementById('hud-floating-capsule');
  if (capsule) {
    capsule.classList.add('speaking');
    const cmdText = document.getElementById('capsule-command-text');
    if (cmdText) cmdText.textContent = 'J.A.R.V.I.S. PARLA...';
  }
  const btn = document.getElementById('arc-reactor-btn');
  if (btn) btn.classList.add('speaking');
  const arcText = document.getElementById('arc-status-text');
  if (arcText) arcText.textContent = 'J.A.R.V.I.S. PARLA...';
  setJarvisText(text);

  try {
    if (_jarvisAudioPlayer) {
      _jarvisAudioPlayer.pause();
      _jarvisAudioPlayer.currentTime = 0;
    }
    _jarvisAudioPlayer = new Audio(audioDataUrl);

    _jarvisAudioPlayer.onended = () => {
      STATE.isSpeaking = false;
      resetArcReactor();
    };

    _jarvisAudioPlayer.onerror = (e) => {
      console.warn('Errore riproduzione data audio, uso fallback browser:', e);
      fallbackBrowserSpeak(text);
    };

    const playPromise = _jarvisAudioPlayer.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('Autoplay bloccato con data audio, uso fallback browser:', err);
        fallbackBrowserSpeak(text);
      });
    }
  } catch (err) {
    console.warn('Errore avvio data audio, uso fallback browser:', err);
    fallbackBrowserSpeak(text);
  }
}

/**
 * jarvisSpeak — Sintesi vocale con Timbro Neurale & Filtro Olografico DSP (100% gratuito).
 * Riproduce l'audio generato dal backend Python (Edge-TTS GiuseppeMultilingualNeural + DSP Paul Bettany).
 * Se il backend non è raggiungibile, esegue il fallback trasparente al browser.
 * @param {string} text - Testo da pronunciare
 */
function jarvisSpeak(text) {
  STATE.isSpeaking = true;
  const headerJarvis = document.getElementById('hud-header-jarvis');
  if (headerJarvis) {
    headerJarvis.classList.add('speaking');
    headerJarvis.classList.remove('listening');
  }
  const headerStatus = document.getElementById('header-jarvis-status');
  if (headerStatus) headerStatus.textContent = 'J.A.R.V.I.S. PARLA...';

  const capsule = document.getElementById('hud-floating-capsule');
  if (capsule) {
    capsule.classList.add('speaking');
    const cmdText = document.getElementById('capsule-command-text');
    if (cmdText) cmdText.textContent = 'J.A.R.V.I.S. PARLA...';
  }
  const btn = document.getElementById('arc-reactor-btn');
  if (btn) btn.classList.add('speaking');
  const arcText = document.getElementById('arc-status-text');
  if (arcText) arcText.textContent = 'J.A.R.V.I.S. PARLA...';
  setJarvisText(text);

  // Prova riproduzione audio neurale con filtro DSP J.A.R.V.I.S. dal server locale
  try {
    if (_jarvisAudioPlayer) {
      _jarvisAudioPlayer.pause();
      _jarvisAudioPlayer.currentTime = 0;
    }
    const audioUrl = `/api/jarvis/speak?text=${encodeURIComponent(text)}`;
    _jarvisAudioPlayer = new Audio(audioUrl);

    _jarvisAudioPlayer.onended = () => {
      STATE.isSpeaking = false;
      resetArcReactor();
    };

    _jarvisAudioPlayer.onerror = (e) => {
      console.warn('Backend audio non disponibile, uso fallback browser:', e);
      fallbackBrowserSpeak(text);
    };

    const playPromise = _jarvisAudioPlayer.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('Autoplay bloccato, uso fallback browser:', err);
        fallbackBrowserSpeak(text);
      });
    }
  } catch (err) {
    console.warn('Errore avvio audio J.A.R.V.I.S., uso fallback browser:', err);
    fallbackBrowserSpeak(text);
  }
}

/* ================================================================
   PARTE 2 — FIX LOGICA RICERCA "Prossima partita del Napoli"
   ================================================================ */

/**
 * isFootballMatch — Determina se un evento è una PARTITA DI CALCIO
 * (non una fiera, non un evento generico con "Napoli" nel nome).
 */
function isFootballMatch(event) {
  const title  = (event.title || '').toUpperCase();
  const venue  = (event.venue || '').toLowerCase();
  const cat    = (event.category || '').toUpperCase();

  // Esclusione esplicita: Mostra d'Oltremare e fiere/generici
  if (venue.includes('mostra') || venue.includes('oltremare') || cat === 'FIERA') return false;
  const excludeKeywords = ['EXPO NAPOLI', 'COMUNE DI', 'FIERA DI', 'SALONE', 'CONGRESSO', 'CONFERENZA'];
  if (excludeKeywords.some(kw => title.includes(kw))) return false;

  // Inclusione per categoria
  if (cat === 'CALCIO' || cat === 'FOOTBALL') return true;

  // Inclusione per venue (stadio)
  if (venue.includes('stadio') || venue.includes('maradona') ||
      venue.includes('menti') || venue.includes('pinto') || venue.includes('san paolo')) {
    return true;
  }

  if (/\b\w+\s+(vs|VS|contro)\s+\w+\b/.test(event.title)) return true;
  if (/\b[A-Z][a-zA-Z]+\s+-\s+[A-Z][a-zA-Z]+\b/.test(event.title)) return true;

  return false;
}

// ─── Local J.A.R.V.I.S. NLP Engine (Per Smartphone Offline & Privacy) ───
function executeLocalJarvisCommand(cmd) {
  const lower = (cmd || '').toLowerCase().trim();

  // 1. Inserimento evento / turno / appuntamento
  if (lower.startsWith('inserisci') || lower.startsWith('aggiungi') || lower.startsWith('crea') || lower.startsWith('segna')) {
    // Estrazione paga / compenso
    let earnings = 0.0;
    const payMatch = lower.match(/(?:paga|compenso|guadagno|con)\s+(\d+(?:[.,]\d+)?)\s*(?:euro|€)?/i);
    if (payMatch) {
      earnings = parseFloat(payMatch[1].replace(',', '.'));
    }

    // Estrazione ora
    let hour = 10, minute = 0;
    const timeMatch = lower.match(/alle\s+(\d{1,2})(?::(\d{2})|\s+e\s+(\d{2})|\s+e\s+mezza|\s+e\s+trenta)?/i);
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      if (timeMatch[2]) minute = parseInt(timeMatch[2], 10);
      else if (timeMatch[3]) minute = parseInt(timeMatch[3], 10);
      else if (lower.includes('mezza') || lower.includes('trenta')) minute = 30;
    }

    // Estrazione data
    let eventDate = new Date(STATE.selectedDate);
    const months = {
      gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5,
      luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11
    };
    const dateMatch = lower.match(/(?:il\s+)?(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/i);
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const mIdx = months[dateMatch[2].toLowerCase()];
      const year = eventDate.getFullYear() || 2026;
      eventDate = new Date(year, mIdx, day, hour, minute, 0);
    } else if (lower.includes('domani')) {
      eventDate.setDate(eventDate.getDate() + 1);
      eventDate.setHours(hour, minute, 0, 0);
    } else if (lower.includes('dopodomani')) {
      eventDate.setDate(eventDate.getDate() + 2);
      eventDate.setHours(hour, minute, 0, 0);
    } else {
      eventDate.setHours(hour, minute, 0, 0);
    }

    // Estrazione titolo
    let cleanTitle = lower
      .replace(/^(?:jarvis\s+)?(?:inserisci|aggiungi|crea|segna)\s+(?:l'evento|il turno|l'appuntamento|evento|turno|appuntamento)?/i, '')
      .replace(/(?:il\s+)?\d{1,2}\s+[a-z]+/gi, '')
      .replace(/domani|dopodomani/gi, '')
      .replace(/alle\s+\d{1,2}(?::\d{2}|\s+e\s+\d{2}|\s+e\s+mezza|\s+e\s+trenta)?/gi, '')
      .replace(/(?:paga|compenso|guadagno|con)\s+\d+(?:[.,]\d+)?\s*(?:euro|€)?/gi, '')
      .replace(/^(?:di|per|a|del)\s+/i, '')
      .trim();

    if (!cleanTitle) cleanTitle = 'Impegno Personale';
    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

    const startStr = toSqlDateTime(eventDate);
    const newEv = {
      id: Date.now(),
      title: cleanTitle,
      venue: 'Personale',
      category: 'CUSTOM',
      event_start: startStr,
      call_time: startStr,
      notes: earnings > 0 ? `Compenso: €${earnings.toFixed(2)}` : 'Aggiunto via J.A.R.V.I.S.',
      status: 'Lavoro io',
      earnings: earnings,
      conflict: false
    };

    STATE.events.push(newEv);
    saveLocalEvents(STATE.events);
    recomputeLocalConflicts(STATE.events);
    STATE.selectedDate = eventDate;
    renderHudCalendar();
    renderNextShift();
    renderShiftsList();
    renderLocalAlerts();

    const payText = earnings > 0 ? ` con compenso di ${earnings.toFixed(0)} euro` : '';
    jarvisSpeak(`Ho inserito ${cleanTitle} per il ${formatDate(startStr)} alle ore ${formatTime(startStr)}${payText} nel tuo database locale.`);
    showToast(`Evento "${cleanTitle}" creato!`, 'success');
    return true;
  }

  // 2. Controllo disponibilità su data ("ho qualcosa il 18 ottobre?", "sono libero il 20?")
  if (lower.includes('ho qualcosa') || lower.includes('sono libero') || lower.includes('impegni il') || lower.includes('cosa devo fare')) {
    const months = {
      gennaio: '01', febbraio: '02', marzo: '03', aprile: '04', maggio: '05', giugno: '06',
      luglio: '07', agosto: '08', settembre: '09', ottobre: '10', novembre: '11', dicembre: '12'
    };
    const dateMatch = lower.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/i);
    let targetYMD = '';
    if (dateMatch) {
      const d = dateMatch[1].padStart(2, '0');
      const m = months[dateMatch[2].toLowerCase()];
      targetYMD = `2026-${m}-${d}`;
    } else if (lower.includes('domani')) {
      const tom = new Date();
      tom.setDate(tom.getDate() + 1);
      targetYMD = formatYMD(tom);
    }

    if (targetYMD) {
      const dayEvs = STATE.events.filter(e => e.event_start && e.event_start.startsWith(targetYMD));
      if (!dayEvs.length) {
        jarvisSpeak(`Non hai alcun impegno in programma per il ${formatDate(targetYMD + ' 10:00:00')}. Sei completamente libero.`);
        return true;
      }
      const riposoEvs = dayEvs.filter(e => (e.status || '').toLowerCase().includes('riposo'));
      const activeEvs = dayEvs.filter(e => !(e.status || '').toLowerCase().includes('riposo'));

      if (activeEvs.length > 0) {
        const ev = activeEvs[0];
        jarvisSpeak(`Il ${formatDate(targetYMD + ' 10:00:00')} hai in programma ${ev.title} alle ore ${formatTime(ev.event_start)}, con convocazione alle ore ${formatTime(ev.call_time)}.`);
      } else {
        const r = riposoEvs[0];
        jarvisSpeak(`Il ${formatDate(targetYMD + ' 10:00:00')} c'è ${r.title}, ma hai impostato Riposo. Non sei operativo e la giornata è completamente libera per te!`);
      }
      return true;
    }
  }

  // 3. Cambio stato a voce ("metti casertana su lavoro io", "metti fiera in riposo")
  if (lower.includes('lavoro io') || lower.includes('riposo') || lower.includes('ignora')) {
    const isLavoro = lower.includes('lavoro');
    const newStatus = isLavoro ? 'Lavoro io' : 'Riposo';
    let target = null;
    ['napoli', 'stabia', 'casertana', 'mostra', 'fiera', 'roma', 'verona'].forEach(k => {
      if (!target && lower.includes(k)) {
        target = STATE.events.find(e => (e.title || '').toLowerCase().includes(k) && isFuture(e.event_start));
      }
    });

    if (target) {
      target.status = newStatus;
      saveLocalEvents(STATE.events);
      recomputeLocalConflicts(STATE.events);
      renderHudCalendar();
      renderNextShift();
      renderShiftsList();
      renderLocalAlerts();
      jarvisSpeak(`Ho impostato lo stato di ${target.title} su ${newStatus}.`);
      showToast(`Stato aggiornato: ${newStatus}`, 'success');
      return true;
    }
  }

  // 4. Eliminazione
  if (lower.includes('elimina') || lower.includes('cancella') || lower.includes('rimuovi')) {
    const searchTarget = lower.replace(/elimina|cancella|rimuovi|evento|appuntamento|l'evento|il turno|turno/gi, '').trim();
    if (searchTarget.length >= 2) {
      const match = STATE.events.find(e => (e.title || '').toLowerCase().includes(searchTarget));
      if (match) {
        STATE.events = STATE.events.filter(e => e.id !== match.id);
        saveLocalEvents(STATE.events);
        recomputeLocalConflicts(STATE.events);
        renderHudCalendar();
        renderNextShift();
        renderShiftsList();
        renderLocalAlerts();
        jarvisSpeak(`Ho eliminato ${match.title} dal tuo calendario.`);
        showToast(`Evento "${match.title}" eliminato!`, 'info');
        return true;
      }
    }
  }

  return false;
}

// ─── Voice Commands ──────────────────────────────────────────────
async function processVoiceCommand(cmd) {
  setJarvisText(`"${cmd}"`);

  // Feedback visivo immediato di elaborazione
  const headerStatus = document.getElementById('header-jarvis-status');
  if (headerStatus) headerStatus.textContent = 'J.A.R.V.I.S. ELABORA...';
  const capsuleText = document.getElementById('capsule-command-text');
  if (capsuleText) capsuleText.textContent = 'J.A.R.V.I.S. ELABORA...';
  const arcText = document.getElementById('arc-status-text');
  if (arcText) arcText.textContent = 'J.A.R.V.I.S. ELABORA...';

  // 1. Tenta elaborazione intelligente via backend J.A.R.V.I.S. (con risposte britanniche e filtro DSP)
  try {
    const playLocal = localStorage.getItem('jarvis_play_local') === 'true';
    const res = await apiPost('/api/jarvis/command', { command: cmd, play_local: playLocal });
    if (res && res.response) {
      if (res.audio_data) {
        // Riproduzione ISTANTANEA da audio base64: zero attesa del secondo roundtrip!
        playJarvisAudioData(res.audio_data, res.response);
      } else {
        jarvisSpeak(res.response);
      }

      // Se J.A.R.V.I.S. ha modificato il database (creato, cancellato o cambiato stato)
      if (res.action && ['created', 'deleted', 'status_updated'].includes(res.action)) {
        if (res.event) {
          if (res.action === 'created') {
            const exists = STATE.events.find(e => e.id === res.event.id);
            if (!exists) STATE.events.push(res.event);
          } else if (res.action === 'status_updated') {
            const target = STATE.events.find(e => e.id === res.event.id);
            if (target) target.status = res.event.status;
          } else if (res.action === 'deleted') {
            STATE.events = STATE.events.filter(e => e.id !== res.event.id);
          }
          saveLocalEvents(STATE.events);
          recomputeLocalConflicts(STATE.events);
          renderHudCalendar();
          renderNextShift();
          renderShiftsList();
          renderLocalAlerts();
        } else {
          await loadEvents();
        }
        if (res.action === 'created') {
          showToast('Evento inserito in agenda da J.A.R.V.I.S.', 'success');
        } else if (res.action === 'deleted') {
          showToast('Evento cancellato da J.A.R.V.I.S.', 'info');
        } else if (res.action === 'status_updated') {
          showToast('Stato turno aggiornato da J.A.R.V.I.S.', 'success');
        }
      }

      // Posizionamento calendario sull'evento o sulla data richiesta
      if (res.event && res.event.event_start) {
        try {
          const evDate = new Date(res.event.event_start.replace(' ', 'T'));
          if (!isNaN(evDate.getTime())) {
            STATE.selectedDate = evDate;
            STATE.miniCalMonth = new Date(evDate.getFullYear(), evDate.getMonth(), 1);
            renderHudCalendar();
            setTimeout(() => scrollToEventOrDay(formatYMD(STATE.selectedDate)), 150);
          }
        } catch (e) {
          console.warn('Errore parsing data evento:', e);
        }
      }

      return;
    }
  } catch (err) {
    console.warn('Backend J.A.R.V.I.S. non raggiungibile, utilizzo logica locale dello smartphone:', err);
  }
  setJarvisText(`"${cmd}"`);

  // Esegue comandi avanzati direttamente sul database locale dello smartphone (creazione, cancellazione, stato, orari)
  if (executeLocalJarvisCommand(cmd)) return;

  // ── Prossimo turno generico ──
  if (cmd.includes('prossimo turno') || cmd.includes('quando lavoro') || cmd.includes('prossimo servizio')) {
    const future = STATE.events
      .filter(e => isFuture(e.event_start))
      .sort((a, b) => new Date(a.event_start.replace(' ','T')) - new Date(b.event_start.replace(' ','T')));

    if (!future.length) {
      jarvisSpeak('Non ci sono turni futuri programmati al momento.');
    } else {
      const n = future[0];
      jarvisSpeak(`Il prossimo turno è ${n.title} il ${formatDate(n.event_start)} alle ${formatTime(n.event_start)}. Convocazione alle ${formatTime(n.call_time)}.`);
    }
    return;
  }

  // ── Salva su Google Calendar ──
  if (
    cmd.includes('google calendar') ||
    cmd.includes('salva su google') ||
    cmd.includes('aggiungi a google') ||
    cmd.includes('metti su google') ||
    cmd.includes('aggiungi su google') ||
    cmd.includes('calendario google') ||
    cmd.includes('collega google')
  ) {
    const future = STATE.events
      .filter(e => isFuture(e.event_start))
      .sort((a, b) => new Date(a.event_start.replace(' ','T')) - new Date(b.event_start.replace(' ','T')));

    if (!future.length) {
      jarvisSpeak('Non ho trovato turni futuri programmati da salvare su Google Calendar.');
      return;
    }

    const next = future[0];
    const gcalUrl = generateGoogleCalendarUrl(next);
    window.open(gcalUrl, '_blank');
    jarvisSpeak(`Apro Google Calendar per il turno del ${next.title}. Convocazione impostata alle ore ${formatTime(next.call_time)}.`);
    showToast(`Apertura Google Calendar per ${next.title}`, 'success');
    return;
  }

  // ── Napoli: distingue partita vs evento generico ──
  if (cmd.includes('napoli')) {
    // Controlla se l'utente sta chiedendo specificamente di calcio/partita
    const isFootballQuery =
      cmd.includes('partita') || cmd.includes('partite') || cmd.includes('gioca') ||
      cmd.includes('calcio') || cmd.includes('stadio') || cmd.includes('maradona') ||
      cmd.includes('champions') || cmd.includes('serie a') || cmd.includes('coppa');

    if (isFootballQuery) {
      // Cerca solo partite di calcio, esclude fiere/eventi generici
      queryFootballMatch('napoli', 'il Napoli');
    } else {
      // Query generica: qualsiasi evento con "napoli" nel titolo o venue
      queryTeam('napoli', 'il Napoli');
    }
    return;
  }

  // ── Juve Stabia / Stabia ──
  if (cmd.includes('stabia') || cmd.includes('juve stabia')) {
    if (cmd.includes('partita') || cmd.includes('gioca') || cmd.includes('calcio')) {
      queryFootballMatch('stabia', 'la Juve Stabia');
    } else {
      queryTeam('stabia', 'la Juve Stabia');
    }
    return;
  }

  // ── Casertana ──
  if (cmd.includes('casertana')) {
    if (cmd.includes('partita') || cmd.includes('gioca') || cmd.includes('calcio')) {
      queryFootballMatch('casertana', 'la Casertana');
    } else {
      queryTeam('casertana', 'la Casertana');
    }
    return;
  }

  // ── Mostra d'Oltremare / Fiera ──
  if (cmd.includes('mostra') || cmd.includes('fiera') || cmd.includes('oltremare')) {
    const events = STATE.events.filter(e =>
      isFuture(e.event_start) &&
      (e.category?.toUpperCase() === 'FIERA' || (e.venue || '').toLowerCase().includes('mostra'))
    ).sort((a, b) => new Date(a.event_start.replace(' ','T')) - new Date(b.event_start.replace(' ','T')));

    if (!events.length) {
      jarvisSpeak('Non ho fiere o eventi alla Mostra d\'Oltremare in programma.');
    } else {
      const next = events[0];
      jarvisSpeak(`Il prossimo evento alla Mostra d\'Oltremare è ${next.title} il ${formatDate(next.event_start)}. Convocazione alle ${formatTime(next.call_time)}.`);
    }
    return;
  }

  // ── Aggiorna calendari ──
  if (cmd.includes('aggiorna') || cmd.includes('sincronizza') || cmd.includes('sync')) {
    jarvisSpeak('Avvio sincronizzazione di tutti i calendari.');
    switchTab('sync');
    setTimeout(() => triggerSync(), 1000);
    return;
  }

  // ── Conflitti ──
  if (cmd.includes('sovrapposiz') || cmd.includes('conflitt') || cmd.includes('coincidenz')) {
    const conflicts = STATE.events.filter(e => e.conflict);
    if (!conflicts.length) {
      jarvisSpeak('Nessuna sovrapposizione rilevata. Tutti i turni sono liberi.');
    } else {
      jarvisSpeak(`Ho rilevato ${conflicts.length} eventi con conflitti di data. Controlla la scheda Avvisi per i dettagli.`);
      switchTab('alerts');
    }
    return;
  }

  // ── Quanti eventi ──
  if (cmd.includes('quanti eventi') || cmd.includes('quanti turni')) {
    const future = STATE.events.filter(e => isFuture(e.event_start));
    jarvisSpeak(`Hai ${future.length} turni futuri in programma su un totale di ${STATE.events.length} eventi nel database.`);
    return;
  }

  // ── Elimina Evento / Appuntamento ──
  if (cmd.includes('elimina') || cmd.includes('cancella') || cmd.includes('rimuovi')) {
    const searchTarget = cmd
      .replace(/elimina|cancella|rimuovi|evento|appuntamento|l'evento|il turno|turno/gi, '')
      .trim().toLowerCase();

    if (searchTarget.length >= 2) {
      // Cerca prima tra gli eventi personali/aggiunti
      let match = STATE.events.find(e =>
        classifyEventCategory(e) === 'CUSTOM' &&
        e.title.toLowerCase().includes(searchTarget)
      );
      if (!match) {
        match = STATE.events.find(e => e.title.toLowerCase().includes(searchTarget));
      }

      if (match) {
        openBottomSheet(match);
        jarvisSpeak(`Ho aperto ${match.title}. Tocca 'Elimina Evento' per confermare la cancellazione.`);
        return;
      }
    }
  }

  // ── Default ──
  jarvisSpeak('Non ho capito il comando. Prova a chiedere: quando è il prossimo turno, quando gioca il Napoli, o aggiorna i calendari.');
}

/**
 * queryFootballMatch — Cerca la PROSSIMA PARTITA DI CALCIO per una squadra.
 * Usa isFootballMatch() per filtrare ed escludere eventi fieristici/generici.
 * @param {string} keyword - Parola chiave (es. "napoli")
 * @param {string} teamName - Nome squadra per la risposta vocale (es. "il Napoli")
 */
function queryFootballMatch(keyword, teamName) {
  const events = STATE.events.filter(e => {
    if (!isFuture(e.event_start)) return false;
    const titleMatch = (e.title || '').toLowerCase().includes(keyword);
    const venueMatch = (e.venue || '').toLowerCase().includes(keyword);
    return (titleMatch || venueMatch) && isFootballMatch(e);
  }).sort((a, b) => new Date(a.event_start.replace(' ','T')) - new Date(b.event_start.replace(' ','T')));

  if (!events.length) {
    jarvisSpeak(`Non ho trovato prossime partite di calcio di ${teamName} nel calendario.`);
  } else {
    const n = events[0];
    jarvisSpeak(`La prossima partita di ${teamName} è ${n.title} il ${formatDate(n.event_start)} alle ${formatTime(n.event_start)}. Convocazione alle ${formatTime(n.call_time)}.`);
  }
}

/**
 * queryTeam — Cerca qualsiasi evento futuro legato a una squadra/keyword.
 * Non filtra per tipo di evento (usato per query generiche).
 * @param {string} keyword - Parola chiave
 * @param {string} teamName - Nome per la risposta vocale
 */
function queryTeam(keyword, teamName) {
  const events = STATE.events.filter(e =>
    isFuture(e.event_start) &&
    ((e.title || '').toLowerCase().includes(keyword) || (e.venue || '').toLowerCase().includes(keyword))
  ).sort((a, b) => new Date(a.event_start.replace(' ','T')) - new Date(b.event_start.replace(' ','T')));

  if (!events.length) {
    jarvisSpeak(`Non ho trovato prossimi eventi legati a ${teamName} nel calendario.`);
  } else {
    const n = events[0];
    // Se è una partita, usa la dicitura corretta
    const isMatch = isFootballMatch(n);
    const prefix = isMatch ? `La prossima partita di ${teamName}` : `Il prossimo evento di ${teamName}`;
    jarvisSpeak(`${prefix} è ${n.title} il ${formatDate(n.event_start)} alle ${formatTime(n.event_start)}. Convocazione alle ${formatTime(n.call_time)}.`);
  }
}

// ─── PWA Service Worker Registration ────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/static/sw.js', { scope: '/' })
        .then(reg => console.log('SW registrato:', reg.scope))
        .catch(err => console.warn('SW non registrato:', err));
    });
  }
}

// ─── Loading Screen ──────────────────────────────────────────────
function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.add('hidden');
  setTimeout(() => overlay.remove(), 600);
}

// ─── Init ───────────────────────────────────────────────────────
async function init() {
  // Clock
  updateClock();
  setInterval(updateClock, 1000);

  // Register SW
  registerServiceWorker();

  // ── Selezione intelligente voce italiana ──
  // Attende voiceschanged (necessario su Chrome/Android)
  if ('speechSynthesis' in window) {
    const loadVoices = () => {
      _bestItalianVoice = selectBestItalianVoice();
      if (_bestItalianVoice) {
        console.log('[JARVIS TTS] Voce selezionata:', _bestItalianVoice.name, _bestItalianVoice.lang);
      }
    };

    // Su Safari/Firefox le voci sono immediate
    loadVoices();

    // Su Chrome desktop/Android arrivano in modo asincrono
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
  }

  // Init Speech Recognition
  initSpeech();

  // Load data
  try {
    await loadEvents();
    addSyncLog('Sistema avviato. Dati caricati.', 'success');
  } catch (err) {
    addSyncLog('Errore caricamento iniziale dati', 'error');
  }

  // Hide loading
  setTimeout(hideLoading, 800);

  // J.A.R.V.I.S. welcome (con piccolo delay per attendere la voce)
  setTimeout(() => {
    jarvisSpeak('Sistema S.T.E.W.A.R.D. online. Tocca il reattore per parlare.');
  }, 1400);
}

// ─── Search Modal Logic ─────────────────────────────────────────
function openSearchModal() {
  const overlay = document.getElementById('search-modal-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  const input = document.getElementById('hud-search-input');
  if (input) {
    input.value = '';
    input.focus();
  }
  STATE.searchQuery = '';
  STATE.searchCategory = 'ALL';
  renderSearchResults();
}

function closeSearchModal() {
  const overlay = document.getElementById('search-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

function renderSearchResults() {
  const container = document.getElementById('hud-search-results');
  if (!container) return;

  const q = (STATE.searchQuery || '').toLowerCase().trim();
  const cat = STATE.searchCategory || 'ALL';

  const results = STATE.events.filter(ev => {
    if (cat !== 'ALL') {
      const group = classifyEventCategory(ev);
      if (group !== cat) return false;
    }
    if (!q) return true;
    const t = (ev.title || '').toLowerCase();
    const v = (ev.venue || '').toLowerCase();
    const n = (ev.notes || '').toLowerCase();
    return t.includes(q) || v.includes(q) || n.includes(q);
  });

  if (!results.length) {
    container.innerHTML = `<div class="empty-state">Nessun evento o turno trovato</div>`;
    return;
  }

  container.innerHTML = results.slice(0, 25).map(ev => {
    const style = getHudEventStyle(ev);
    return `
      <div class="search-result-item" data-event-id="${ev.id}" role="button" tabindex="0">
        <div>
          <div style="font-weight:600;color:#FFFFFF;font-size:12.5px;">${ev.title}</div>
          <div style="font-size:10.5px;color:rgba(232,244,255,0.6);margin-top:2px;">
            ${formatDateTime(ev.event_start)} • ${ev.venue || 'Sede standard'}
          </div>
        </div>
        <span style="font-size:13px;">${style.glyph || '🛡️'}</span>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = parseInt(item.dataset.eventId);
      const ev = STATE.events.find(x => x.id === id);
      if (ev) {
        STATE.selectedDate = new Date(ev.event_start.replace(' ', 'T'));
        closeSearchModal();
        renderHudCalendar();
        openBottomSheet(ev);
      }
    });
  });
}

// ─── Add Event Modal Logic ──────────────────────────────────────
function openAddEventModal() {
  const overlay = document.getElementById('add-event-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');

  const startInput = document.getElementById('new-event-start');
  if (startInput) {
    const ymd = formatYMD(STATE.selectedDate);
    startInput.value = `${ymd}T10:00`;
  }
}

function closeAddEventModal() {
  const overlay = document.getElementById('add-event-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

async function handleAddEventSubmit(e) {
  e.preventDefault();
  const title = document.getElementById('new-event-title')?.value.trim();
  const category = document.getElementById('new-event-category')?.value || 'CUSTOM';
  const venue = document.getElementById('new-event-venue')?.value.trim() || 'Steward';
  const startRaw = document.getElementById('new-event-start')?.value;
  const notes = document.getElementById('new-event-notes')?.value.trim() || 'Sub-text';

  if (!title || !startRaw) return;

  const eventStart = startRaw.replace('T', ' ') + ':00';
  let callTime = eventStart;
  try {
    const sDate = new Date(startRaw);
    if (category === 'CALCIO') {
      const cDate = new Date(sDate.getTime() - 4 * 60 * 60 * 1000);
      callTime = toSqlDateTime(cDate);
    } else if (category === 'FIERA') {
      const cDate = new Date(sDate.getFullYear(), sDate.getMonth(), sDate.getDate(), 8, 30, 0);
      callTime = toSqlDateTime(cDate);
    }
  } catch (err) {}

  const newEv = {
    id: Date.now(),
    title,
    category,
    venue,
    event_start: eventStart,
    call_time: callTime,
    notes,
    status: 'Lavoro io',
    earnings: 0.0,
    conflict: false
  };

  // 1. Salva SUBITO nel database locale dello smartphone
  STATE.events.push(newEv);
  saveLocalEvents(STATE.events);

  showToast('Evento creato con successo!', 'success');
  closeAddEventModal();

  recomputeLocalConflicts(STATE.events);
  STATE.selectedDate = new Date(startRaw);
  renderHudCalendar();
  renderNextShift();
  renderShiftsList();
  renderLocalAlerts();

  // Sincronizza col backend in background se online
  try {
    apiPost('/api/events', newEv).catch(() => {});
  } catch (err) {}
}

// ─── Event Listeners ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // J.A.R.V.I.S. Top Header Capsule & Arc Reactor Buttons
  document.getElementById('header-reactor-btn')?.addEventListener('click', toggleListening);
  document.getElementById('header-jarvis-text-wrap')?.addEventListener('click', toggleListening);
  document.getElementById('capsule-reactor-btn')?.addEventListener('click', toggleListening);
  document.getElementById('capsule-text-group')?.addEventListener('click', toggleListening);
  document.getElementById('arc-reactor-btn')?.addEventListener('click', toggleListening);

  // HUD Top Navigation: Prev / Next period
  document.getElementById('hud-nav-prev')?.addEventListener('click', () => {
    if (STATE.currentView === 'week') {
      STATE.selectedDate.setDate(STATE.selectedDate.getDate() - 7);
    } else if (STATE.currentView === 'day') {
      STATE.selectedDate.setDate(STATE.selectedDate.getDate() - 1);
    } else if (STATE.currentView === 'month') {
      STATE.selectedDate.setMonth(STATE.selectedDate.getMonth() - 1);
    }
    STATE.miniCalMonth = new Date(STATE.selectedDate.getFullYear(), STATE.selectedDate.getMonth(), 1);
    renderHudCalendar();
  });

  document.getElementById('hud-nav-next')?.addEventListener('click', () => {
    if (STATE.currentView === 'week') {
      STATE.selectedDate.setDate(STATE.selectedDate.getDate() + 7);
    } else if (STATE.currentView === 'day') {
      STATE.selectedDate.setDate(STATE.selectedDate.getDate() + 1);
    } else if (STATE.currentView === 'month') {
      STATE.selectedDate.setMonth(STATE.selectedDate.getMonth() + 1);
    }
    STATE.miniCalMonth = new Date(STATE.selectedDate.getFullYear(), STATE.selectedDate.getMonth(), 1);
    renderHudCalendar();
  });

  // HUD Top Navigation: Oggi (Reset a data odierna / 14 Ottobre demo)
  document.getElementById('hud-btn-today')?.addEventListener('click', () => {
    STATE.selectedDate = new Date('2026-10-14T09:30:00');
    STATE.miniCalMonth = new Date('2026-10-01');
    STATE.currentView = 'week';
    renderHudCalendar();
  });

  // HUD View Switcher (Giorno | Settimana | Mese)
  document.getElementById('view-pill-day')?.addEventListener('click', () => switchCalendarView('day'));
  document.getElementById('view-pill-week')?.addEventListener('click', () => switchCalendarView('week'));
  document.getElementById('view-pill-month')?.addEventListener('click', () => switchCalendarView('month'));

  // Mini Calendar Navigation
  document.getElementById('mini-prev-month')?.addEventListener('click', () => {
    STATE.miniCalMonth.setMonth(STATE.miniCalMonth.getMonth() - 1);
    renderMiniCalendar();
  });
  document.getElementById('mini-next-month')?.addEventListener('click', () => {
    STATE.miniCalMonth.setMonth(STATE.miniCalMonth.getMonth() + 1);
    renderMiniCalendar();
  });

  // Calendari Lavoro Reale Toggles (Sidebar Desktop + Barra Mobile)
  const filterNapoli = document.getElementById('filter-napoli');
  const filterStabia = document.getElementById('filter-stabia');
  const filterCasertana = document.getElementById('filter-casertana');
  const filterMostra = document.getElementById('filter-mostra');
  const filterCustom = document.getElementById('filter-custom');

  function updateCategoryFilters() {
    STATE.activeCategories.clear();
    if (filterNapoli?.checked) STATE.activeCategories.add('NAPOLI');
    if (filterStabia?.checked) STATE.activeCategories.add('STABIA');
    if (filterCasertana?.checked) STATE.activeCategories.add('CASERTANA');
    if (filterMostra?.checked) STATE.activeCategories.add('MOSTRA');
    if (filterCustom?.checked) STATE.activeCategories.add('CUSTOM');

    // Sincronizza stato pulsanti chip mobile
    document.querySelectorAll('.m-filter-btn').forEach(btn => {
      const cat = btn.dataset.category;
      btn.classList.toggle('active', STATE.activeCategories.has(cat));
    });

    renderHudCalendar();
  }

  filterNapoli?.addEventListener('change', updateCategoryFilters);
  filterStabia?.addEventListener('change', updateCategoryFilters);
  filterCasertana?.addEventListener('change', updateCategoryFilters);
  filterMostra?.addEventListener('change', updateCategoryFilters);
  filterCustom?.addEventListener('change', updateCategoryFilters);

  // Click su chip filtri mobile
  document.querySelectorAll('.m-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.category;
      if (STATE.activeCategories.has(cat)) {
        STATE.activeCategories.delete(cat);
      } else {
        STATE.activeCategories.add(cat);
      }
      // Sincronizza checkbox desktop corrispondente
      if (cat === 'NAPOLI' && filterNapoli) filterNapoli.checked = STATE.activeCategories.has(cat);
      if (cat === 'STABIA' && filterStabia) filterStabia.checked = STATE.activeCategories.has(cat);
      if (cat === 'CASERTANA' && filterCasertana) filterCasertana.checked = STATE.activeCategories.has(cat);
      if (cat === 'MOSTRA' && filterMostra) filterMostra.checked = STATE.activeCategories.has(cat);
      if (cat === 'CUSTOM' && filterCustom) filterCustom.checked = STATE.activeCategories.has(cat);

      btn.classList.toggle('active', STATE.activeCategories.has(cat));
      renderHudCalendar();
    });
  });

  // Sincronizzazione scorrimento orizzontale intestazione giorni e griglia su mobile
  const weekHeader = document.getElementById('week-header-row');
  const weekScroller = document.getElementById('week-grid-scroller');
  if (weekScroller && weekHeader) {
    weekScroller.addEventListener('scroll', () => {
      weekHeader.scrollLeft = weekScroller.scrollLeft;
    }, { passive: true });
    weekHeader.addEventListener('scroll', () => {
      weekScroller.scrollLeft = weekHeader.scrollLeft;
    }, { passive: true });
  }

  // Search Modal
  document.getElementById('hud-btn-search')?.addEventListener('click', openSearchModal);
  document.getElementById('btn-close-search')?.addEventListener('click', closeSearchModal);
  document.getElementById('search-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('search-modal-overlay')) closeSearchModal();
  });

  document.getElementById('hud-search-input')?.addEventListener('input', (e) => {
    STATE.searchQuery = e.target.value;
    renderSearchResults();
  });

  document.querySelectorAll('.search-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.search-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      STATE.searchCategory = pill.dataset.filter;
      renderSearchResults();
    });
  });

  // Settings & J.A.R.V.I.S. Tutorial Modal (⚙️)
  document.getElementById('hud-btn-settings')?.addEventListener('click', openSettingsModal);
  document.getElementById('btn-close-settings')?.addEventListener('click', closeSettingsModal);
  document.getElementById('settings-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('settings-modal-overlay')) closeSettingsModal();
  });

  // Phone Sync Modal (🔗)
  document.getElementById('btn-phone-sync')?.addEventListener('click', openPhoneSyncModal);
  document.getElementById('btn-close-phone-sync')?.addEventListener('click', closePhoneSyncModal);
  document.getElementById('phone-sync-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('phone-sync-overlay')) closePhoneSyncModal();
  });

  // Test Voce J.A.R.V.I.S. Button
  document.getElementById('btn-test-jarvis-voice')?.addEventListener('click', () => {
    processVoiceCommand('Jarvis buongiorno, esegui test vocale del sistema');
  });

  // Local PC Audio Setting Toggle
  const localAudioToggle = document.getElementById('setting-play-local');
  if (localAudioToggle) {
    localAudioToggle.checked = localStorage.getItem('jarvis_play_local') === 'true';
    localAudioToggle.addEventListener('change', (e) => {
      localStorage.setItem('jarvis_play_local', e.target.checked ? 'true' : 'false');
      showToast(e.target.checked ? 'Audio casse PC attivato' : 'Audio casse PC disattivato', 'info');
    });
  }

  // Tutorial Example Pills (Click to test & copy)
  document.querySelectorAll('.cmd-example-pill').forEach(pill => {
    pill.addEventListener('click', async () => {
      const cmd = pill.dataset.cmd;
      if (!cmd) return;
      try {
        await navigator.clipboard.writeText(cmd);
      } catch (err) {}
      showToast(`Comando avviato: "${cmd}"`, 'info');
      if (navigator.vibrate) navigator.vibrate(30);
      processVoiceCommand(cmd);
    });
  });

  // Add Event Modal
  document.getElementById('btn-quick-add-event')?.addEventListener('click', openAddEventModal);
  document.getElementById('btn-close-add-event')?.addEventListener('click', closeAddEventModal);
  document.getElementById('btn-cancel-add')?.addEventListener('click', closeAddEventModal);
  document.getElementById('add-event-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('add-event-overlay')) closeAddEventModal();
  });
  document.getElementById('add-event-form')?.addEventListener('submit', handleAddEventSubmit);

  // Legacy Calendar view toggle (pill switch fallback)
  document.getElementById('btn-month-view')?.addEventListener('click', () => switchCalendarView('month'));
  document.getElementById('btn-list-view')?.addEventListener('click', () => switchCalendarView('week'));

  // Bottom Nav
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Bottom Sheet overlay close
  document.getElementById('sheet-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('sheet-overlay')) closeBottomSheet();
  });

  // Sheet action buttons
  document.getElementById('btn-sheet-confirm')?.addEventListener('click', () => confirmEvent('Lavoro io'));
  document.getElementById('btn-sheet-ignore')?.addEventListener('click', () => confirmEvent('Riposo'));
  document.getElementById('btn-sheet-delete')?.addEventListener('click', deleteCurrentEvent);
  document.getElementById('btn-sheet-edit-earnings')?.addEventListener('click', () => {
    if (!STATE.selectedEvent) return;
    const ev = STATE.selectedEvent;
    closeBottomSheet();
    setTimeout(() => openEarningsModal(ev), 200);
  });
  document.getElementById('btn-sheet-gcal')?.addEventListener('click', () => {
    if (!STATE.selectedEvent) return;
    const gcalUrl = generateGoogleCalendarUrl(STATE.selectedEvent);
    window.open(gcalUrl, '_blank');
    showToast(`Apertura Google Calendar per ${STATE.selectedEvent.title}`, 'info');
  });

  // Earnings Modal listeners
  document.getElementById('btn-close-earnings')?.addEventListener('click', closeEarningsModal);
  document.getElementById('btn-skip-earnings')?.addEventListener('click', closeEarningsModal);
  document.getElementById('earnings-modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('earnings-modal-overlay')) closeEarningsModal();
  });
  document.getElementById('earnings-form')?.addEventListener('submit', handleEarningsSubmit);

  // Quick preset pills for earnings
  document.querySelectorAll('#earnings-presets .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const amt = btn.dataset.amount;
      const input = document.getElementById('event-earnings-input');
      if (input) {
        input.value = amt;
        input.focus();
      }
      document.querySelectorAll('#earnings-presets .preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Sync button
  document.getElementById('btn-sync-main')?.addEventListener('click', triggerSync);

  // Phone Sync Modal
  document.getElementById('btn-phone-sync')?.addEventListener('click', openPhoneSyncModal);
  document.getElementById('btn-close-phone-sync')?.addEventListener('click', closePhoneSyncModal);
  document.getElementById('phone-sync-overlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('phone-sync-overlay')) closePhoneSyncModal();
  });

  // Copy Feed URL
  document.getElementById('btn-copy-feed')?.addEventListener('click', async () => {
    const feedInput = document.getElementById('feed-url-input');
    const url = feedInput?.value || `${window.location.origin}/api/calendar.ics`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link Feed iCal copiato negli appunti!', 'success');
    } catch {
      feedInput?.select();
      document.execCommand('copy');
      showToast('Link Feed iCal copiato!', 'success');
    }
  });

  // Copy Google Apps Script Code
  document.getElementById('btn-copy-script')?.addEventListener('click', async () => {
    try {
      const resp = await fetch('/api/google-script');
      if (!resp.ok) throw new Error('Download script fallito');
      const scriptCode = await resp.text();
      await navigator.clipboard.writeText(scriptCode);
      showToast('Codice google_calendar_sync.gs copiato!', 'success');
    } catch (err) {
      showToast('Errore durante la copia dello script', 'error');
    }
  });

  // PWA Install Button
  document.getElementById('btn-pwa-install')?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        showToast('Installazione S.T.E.W.A.R.D. OS avviata!', 'success');
      }
      deferredInstallPrompt = null;
    } else {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS) {
        showToast('Su Safari iOS: tocca Condividi ⬆️ > "Aggiungi a schermata Home"', 'info');
      } else {
        showToast('Apri il menu del browser (⋮) e seleziona "Aggiungi a schermata Home"', 'info');
      }
    }
  });

  // Swipe down to close bottom sheet
  let touchStartY = 0;
  const sheet = document.getElementById('bottom-sheet');
  sheet?.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
  sheet?.addEventListener('touchmove', (e) => {
    const dy = e.touches[0].clientY - touchStartY;
    if (dy > 60) closeBottomSheet();
  }, { passive: true });

  sheet?.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });

  // Reset Database Locale Smartphone (100% isolato per dispositivo)
  document.getElementById('btn-reset-local-db')?.addEventListener('click', () => {
    if (confirm('Vuoi ripristinare il calendario allo stato iniziale? Verranno azzerate tutte le tue scelte e i compensi su questo telefono.')) {
      localStorage.removeItem(LOCAL_STORAGE_EVENTS_KEY);
      STATE.events = getDefaultSeedEvents();
      saveLocalEvents(STATE.events);
      recomputeLocalConflicts(STATE.events);
      renderHudCalendar();
      renderNextShift();
      renderShiftsList();
      renderLocalAlerts();
      showToast('Database locale ripristinato con successo!', 'success');
      closeSettingsModal();
    }
  });

  // Start app
  init();
});

// ─── Settings & J.A.R.V.I.S. Tutorial Modal Logic ───────────────
function openSettingsModal() {
  const overlay = document.getElementById('settings-modal-overlay');
  if (!overlay) return;

  const statusText = document.getElementById('local-db-status-text');
  if (statusText) {
    statusText.textContent = `Memoria smartphone: ${STATE.events.length} eventi salvati in locale`;
  }

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  if (navigator.vibrate) navigator.vibrate(25);
}

function closeSettingsModal() {
  const overlay = document.getElementById('settings-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

// ─── Phone Sync Modal Logic ─────────────────────────────────────
function openPhoneSyncModal() {
  const overlay = document.getElementById('phone-sync-overlay');
  if (!overlay) return;

  const origin = window.location.origin;
  const feedUrl = `${origin}/api/calendar.ics`;
  const feedInput = document.getElementById('feed-url-input');
  if (feedInput) feedInput.value = feedUrl;

  const directWebcal = feedUrl.replace(/^https?:/, 'webcal:');
  const directBtn = document.getElementById('btn-webcal-direct');
  if (directBtn) {
    directBtn.href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(directWebcal)}`;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const iosHint = document.getElementById('ios-install-hint');
  if (iosHint && isIOS) iosHint.style.display = 'block';

  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  if (navigator.vibrate) navigator.vibrate(25);
}

function closePhoneSyncModal() {
  const overlay = document.getElementById('phone-sync-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

// ─── PWA Install Prompt Capture ────────────────────────────────
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  console.log('PWA install prompt catturato con successo');
});

// ─── Expose globals for debugging ───────────────────────────────
window.STEWARD = {
  STATE,
  loadEvents,
  triggerSync,
  jarvisSpeak,
  openSettingsModal,
  openPhoneSyncModal,
  cleanJarvisSpeechText,   // Esposto per test rapido
  isFootballMatch,          // Esposto per debug logica partite
};
