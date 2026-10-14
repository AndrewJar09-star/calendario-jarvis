/* ================================================================
   S.T.E.W.A.R.D. OS — app.js
   J.A.R.V.I.S. Mobile Interface
   ================================================================ */

'use strict';

// ─── State ──────────────────────────────────────────────────────
const STATE = {
  events: [],
  currentView: 'dayGridMonth',
  activeTab: 'calendar',
  selectedEvent: null,
  isListening: false,
  isSpeaking: false,
  calendar: null,
  lastSync: null,
};

// ─── Category Config ────────────────────────────────────────────
const CATEGORY_CONFIG = {
  CALCIO: {
    napoli:     { color: '#00a8ff', label: 'SSC NAPOLI',    stadium: 'Stadio Diego Armando Maradona' },
    stabia:     { color: '#f5b700', label: 'JUVE STABIA',   stadium: 'Stadio Romeo Menti' },
    casertana:  { color: '#ff0055', label: 'CASERTANA FC',  stadium: 'Stadio Alberto Pinto' },
    default:    { color: '#00f3ff', label: 'CALCIO',         stadium: '' },
  },
  FIERA: { color: '#00ff88', label: 'MOSTRA D\'OLTREMARE' },
};

function getCategoryStyle(event) {
  const title = (event.title || '').toLowerCase();
  const venue = (event.venue || '').toLowerCase();
  const cat   = (event.category || '').toUpperCase();

  if (cat === 'CALCIO' || cat === 'FOOTBALL') {
    if (title.includes('napoli') || venue.includes('maradona'))   return { color: '#00a8ff', badgeClass: 'napoli',    label: 'NAPOLI' };
    if (title.includes('stabia') || venue.includes('menti'))      return { color: '#f5b700', badgeClass: 'stabia',    label: 'J.STABIA' };
    if (title.includes('casertana') || venue.includes('pinto'))   return { color: '#ff0055', badgeClass: 'casertana', label: 'CASERTANA' };
    return { color: '#00f3ff', badgeClass: 'default', label: 'CALCIO' };
  }
  if (cat === 'FIERA' || venue.includes('mostra')) {
    return { color: '#00ff88', badgeClass: 'mostra', label: 'MOSTRA' };
  }
  return { color: '#00f3ff', badgeClass: 'default', label: cat || 'EVENTO' };
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

async function apiPatch(path, body = {}) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

// ─── Load Events ────────────────────────────────────────────────
async function loadEvents() {
  try {
    const data = await apiGet('/api/events');
    STATE.events = data.events || [];
    renderCalendar();
    renderNextShift();
    renderShiftsList();
    await loadAlerts();
  } catch (err) {
    console.error('Errore caricamento eventi:', err);
    showToast('Errore caricamento eventi', 'error');
  }
}

// ─── Next Shift Card ────────────────────────────────────────────
function renderNextShift() {
  const el = document.getElementById('next-shift-content');
  const future = STATE.events
    .filter(e => isFuture(e.event_start))
    .sort((a, b) => new Date(a.event_start.replace(' ', 'T')) - new Date(b.event_start.replace(' ', 'T')));

  if (!future.length) {
    el.innerHTML = `<div class="no-events-msg">NESSUN TURNO FUTURO PROGRAMMATO</div>`;
    return;
  }

  const next = future[0];
  const style = getCategoryStyle(next);
  el.innerHTML = `
    <div class="next-event-title">${next.title}</div>
    <div class="next-event-meta">
      <div class="meta-row">
        <span class="meta-icon">⏰</span>
        <span>${formatDateTime(next.event_start)}</span>
      </div>
      <div class="meta-row call-time">
        <span class="meta-icon">🔔</span>
        <span>CONVOCAZIONE: ${formatDateTime(next.call_time)}</span>
      </div>
      ${next.venue ? `<div class="meta-row"><span class="meta-icon">📍</span><span>${next.venue}</span></div>` : ''}
      <div class="meta-row" style="margin-top:4px;">
        <span class="cat-badge ${style.badgeClass}">${style.label}</span>
        ${next.conflict ? `<span class="status-badge conflict">⚠️ CONFLITTO</span>` : ''}
      </div>
    </div>`;
}

// ─── FullCalendar ───────────────────────────────────────────────
function renderCalendar() {
  const container = document.getElementById('calendar-container');
  if (STATE.calendar) {
    STATE.calendar.destroy();
  }

  const calEvents = STATE.events.map(ev => {
    const style = getCategoryStyle(ev);
    return {
      id: String(ev.id),
      title: ev.title,
      start: ev.event_start.replace(' ', 'T'),
      backgroundColor: style.color,
      borderColor: ev.conflict ? '#ff3860' : style.color,
      textColor: '#050b14',
      extendedProps: ev,
      classNames: ev.conflict ? ['conflict-event'] : [],
    };
  });

  STATE.calendar = new FullCalendar.Calendar(container, {
    locale: 'it',
    initialView: STATE.currentView,
    headerToolbar: {
      left: 'prev',
      center: 'title',
      right: 'next',
    },
    height: 'auto',
    events: calEvents,
    eventClick: (info) => openBottomSheet(info.event.extendedProps),
    eventDisplay: 'block',
    dayMaxEvents: 2,
    moreLinkText: (n) => `+${n}`,
    listDayFormat: { weekday: 'long', day: 'numeric', month: 'long' },
    listDaySideFormat: false,
    noEventsText: 'Nessun evento in questo periodo',
    buttonText: {
      today: 'Oggi',
      month: 'Mese',
      list: 'Lista',
    },
    eventTimeFormat: {
      hour: '2-digit',
      minute: '2-digit',
      meridiem: false,
    },
  });

  STATE.calendar.render();
}

function switchCalendarView(view) {
  STATE.currentView = view;
  renderCalendar();

  document.getElementById('btn-month-view').classList.toggle('active', view === 'dayGridMonth');
  document.getElementById('btn-list-view').classList.toggle('active', view === 'listMonth');
  document.getElementById('btn-month-view').setAttribute('aria-pressed', view === 'dayGridMonth');
  document.getElementById('btn-list-view').setAttribute('aria-pressed', view === 'listMonth');
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
    // Start of shift on Google Calendar is CONVOCAZIONE (4h prima dell'evento)
    const callDt = new Date(event.call_time ? event.call_time.replace(' ', 'T') : event.event_start.replace(' ', 'T'));
    const startDt = new Date(event.event_start.replace(' ', 'T'));

    const isFiera = (event.category || '').toUpperCase() === 'FIERA';
    const endDurationHours = isFiera ? 8 : 3;
    const endDt = new Date(startDt.getTime() + endDurationHours * 60 * 60 * 1000);

    const toGCalISO = (d) => {
      return d.toISOString().replace(/-|:|\.\d\d\d/g, '');
    };

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

    const location = event.venue || '';

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: dates,
      details: details,
      location: location,
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

  const conflictRow = document.getElementById('sheet-conflict-row');
  conflictRow.style.display = ev.conflict ? 'flex' : 'none';

  const overlay = document.getElementById('sheet-overlay');
  const sheet = document.getElementById('bottom-sheet');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => sheet.classList.add('open'));

  // Haptic feedback (mobile)
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
  try {
    await apiPost(`/api/events/${STATE.selectedEvent.id}/status`, { status });
    closeBottomSheet();
    showToast(`Stato aggiornato: ${status}`, 'success');
    await loadEvents();
  } catch (err) {
    showToast('Errore aggiornamento stato', 'error');
  }
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

  // Forza resize calendario quando si torna al tab
  if (tabId === 'calendar' && STATE.calendar) {
    requestAnimationFrame(() => STATE.calendar.updateSize());
  }
  if (tabId === 'alerts') loadAlerts();
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
    const btn = document.getElementById('arc-reactor-btn');
    btn.classList.add('listening');
    document.getElementById('arc-status-text').textContent = 'IN ASCOLTO...';
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

function resetArcReactor() {
  const btn = document.getElementById('arc-reactor-btn');
  btn.classList.remove('listening', 'speaking');
  document.getElementById('arc-status-text').textContent = 'TOCCA PER PARLARE';
}

function setJarvisText(text) {
  document.getElementById('jarvis-text').textContent = text;
}

function jarvisSpeak(text) {
  const btn = document.getElementById('arc-reactor-btn');
  STATE.isSpeaking = true;
  btn.classList.add('speaking');
  document.getElementById('arc-status-text').textContent = 'J.A.R.V.I.S. PARLA...';
  setJarvisText(text);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'it-IT';
  utterance.rate = 0.95;
  utterance.pitch = 0.85;
  utterance.volume = 1;

  utterance.onend = () => {
    STATE.isSpeaking = false;
    resetArcReactor();
  };

  // Scegli voce italiana se disponibile
  const voices = speechSynthesis.getVoices();
  const itVoice = voices.find(v => v.lang.startsWith('it'));
  if (itVoice) utterance.voice = itVoice;

  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

// ─── Voice Commands ──────────────────────────────────────────────
function processVoiceCommand(cmd) {
  setJarvisText(`"${cmd}"`);

  // Prossimo turno
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

  // Salva su Google Calendar (Turno specifico o Prossimo turno)
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
    jarvisSpeak(`Apro Google Calendar per il turno di ${next.title}. Convocazione impostata alle ore ${formatTime(next.call_time)}.`);
    showToast(`Apertura Google Calendar per ${next.title}`, 'success');
    return;
  }

  // Napoli
  if (cmd.includes('napoli')) {
    queryTeam('napoli', 'il Napoli');
    return;
  }

  // Juve Stabia / Stabia
  if (cmd.includes('stabia') || cmd.includes('juve stabia')) {
    queryTeam('stabia', 'la Juve Stabia');
    return;
  }

  // Casertana
  if (cmd.includes('casertana')) {
    queryTeam('casertana', 'la Casertana');
    return;
  }

  // Mostra d'Oltremare
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

  // Aggiorna calendari
  if (cmd.includes('aggiorna') || cmd.includes('sincronizza') || cmd.includes('sync')) {
    jarvisSpeak('Avvio sincronizzazione di tutti i calendari.');
    switchTab('sync');
    setTimeout(() => triggerSync(), 1000);
    return;
  }

  // Sovrapposizioni / Conflitti
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

  // Quanti eventi
  if (cmd.includes('quanti eventi') || cmd.includes('quanti turni')) {
    const future = STATE.events.filter(e => isFuture(e.event_start));
    jarvisSpeak(`Hai ${future.length} turni futuri in programma su un totale di ${STATE.events.length} eventi nel database.`);
    return;
  }

  // Default
  jarvisSpeak('Non ho capito il comando. Prova a chiedere: quando è il prossimo turno, quando gioca il Napoli, o aggiorna i calendari.');
}

function queryTeam(keyword, teamName) {
  const events = STATE.events.filter(e =>
    isFuture(e.event_start) &&
    ((e.title || '').toLowerCase().includes(keyword) || (e.venue || '').toLowerCase().includes(keyword))
  ).sort((a, b) => new Date(a.event_start.replace(' ','T')) - new Date(b.event_start.replace(' ','T')));

  if (!events.length) {
    jarvisSpeak(`Non ho trovato prossime partite di ${teamName} nel calendario.`);
  } else {
    const n = events[0];
    jarvisSpeak(`La prossima partita di ${teamName} è ${n.title} il ${formatDate(n.event_start)} alle ${formatTime(n.event_start)}. Convocazione alle ${formatTime(n.call_time)}.`);
  }
}

function toggleListening() {
  if (!recognition) {
    showToast('Riconoscimento vocale non disponibile su questo browser', 'error');
    return;
  }

  if (STATE.isListening) {
    recognition.stop();
    return;
  }

  if (STATE.isSpeaking) {
    speechSynthesis.cancel();
    STATE.isSpeaking = false;
  }

  try {
    recognition.start();
    if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
  } catch (err) {
    console.error('Errore avvio riconoscimento:', err);
    showToast('Errore avvio microfono', 'error');
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

  // Load voices (async in some browsers)
  if ('speechSynthesis' in window) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => {};
  }

  // Init Speech
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

  // J.A.R.V.I.S. welcome
  setTimeout(() => {
    jarvisSpeak('Sistema S.T.E.W.A.R.D. online. Tocca il reattore per parlare.');
  }, 1200);
}

// ─── Event Listeners ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Arc Reactor Button
  document.getElementById('arc-reactor-btn')?.addEventListener('click', toggleListening);

  // Calendar view toggle
  document.getElementById('btn-month-view')?.addEventListener('click', () => switchCalendarView('dayGridMonth'));
  document.getElementById('btn-list-view')?.addEventListener('click', () => switchCalendarView('listMonth'));

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
  document.getElementById('btn-sheet-gcal')?.addEventListener('click', () => {
    if (!STATE.selectedEvent) return;
    const gcalUrl = generateGoogleCalendarUrl(STATE.selectedEvent);
    window.open(gcalUrl, '_blank');
    showToast(`Apertura Google Calendar per ${STATE.selectedEvent.title}`, 'info');
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

  // Prevent scroll propagation on bottom sheet
  sheet?.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });

  // Start app
  init();
});

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

  // Check iOS for Safari hint
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const iosHint = document.getElementById('ios-install-hint');
  if (iosHint && isIOS) {
    iosHint.style.display = 'block';
  }

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
window.STEWARD = { STATE, loadEvents, triggerSync, jarvisSpeak, openPhoneSyncModal };
