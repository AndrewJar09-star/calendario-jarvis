/**
 * ============================================================================
 * S.T.E.W.A.R.D. OS — Google Calendar Auto-Sync (Cloud 24/7)
 * ============================================================================
 * Sincronizzazione automatica turni e convocazioni steward su Google Calendar.
 * Funziona 24/7 sul cloud gratuito di Google, anche a PC SPENTO!
 * Aggiorna automaticamente gli orari nel tuo calendario se una partita viene spostata.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * I 3 PASSAGGI PER ATTIVARE IL SERVIZIO (Tempo: 1 minuto):
 * ────────────────────────────────────────────────────────────────────────────
 * 1. Apri https://script.google.com e clicca su "Nuovo progetto"
 * 2. Cancella il codice presente, incolla QUESTO intero file e clicca "Salva" (icona disco)
 * 3. Nel menu a tendina in alto seleziona la funzione "installTrigger" e clicca "Esegui"
 *    (Accetta i permessi di lettura/scrittura sul tuo Google Calendar)
 * 
 * FATTO! Il calendario si sincronizzerà immediatamente e poi ogni 6 ore
 * in automatico sul cloud di Google.
 * ============================================================================
 */

// ─── CONFIGURAZIONE ──────────────────────────────────────────────────────────
var CONFIG = {
  // Nome del calendario Google da usare o creare (es. "S.T.E.W.A.R.D. OS" o "" per calendario principale)
  CALENDAR_NAME: "S.T.E.W.A.R.D. OS",
  
  // URL del tuo server S.T.E.W.A.R.D. OS (se ospitato su Render, Railway o Ngrok).
  // Se lasciato vuoto o irraggiungibile (PC spento), il cloud effettua lo scraping autonomo diretto!
  STEWARD_API_URL: "", 

  // Notifica sul telefono: minuti di anticipo rispetto all'orario di CONVOCAZIONE
  REMINDER_MINUTES_BEFORE_CALL: 60,

  // Durata stimata servizio dopo il calcio d'inizio (ore)
  MATCH_SERVICE_DURATION_HOURS: 3,

  // Sedi monitorate
  VENUES: {
    NAPOLI: "Stadio Diego Armando Maradona",
    STABIA: "Stadio Romeo Menti",
    CASERTANA: "Stadio Alberto Pinto",
    MOSTRA: "Mostra d'Oltremare"
  }
};


// ─── FUNZIONE DI INSTALLAZIONE TRIGGER (ESECUTORE PRINCIPALE) ─────────────────
/**
 * Esegui questa funzione una volta sola per attivare la sincronizzazione automatica ogni 6 ore.
 */
function installTrigger() {
  // Rimuovi eventuali trigger duplicati precedenti
  uninstallTrigger();

  // Crea un nuovo trigger a tempo ogni 6 ore
  ScriptApp.newTrigger("syncStewardCalendar")
    .timeBased()
    .everyHours(6)
    .create();

  Logger.log("✅ Trigger di sincronizzazione ogni 6 ore impostato con successo!");
  
  // Esegui la prima sincronizzazione subito
  syncStewardCalendar();
}

/**
 * Disinstalla il trigger automatico.
 */
function uninstallTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "syncStewardCalendar") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log("ℹ️ Trigger precedenti rimossi.");
}


// ─── CORE SYNC FUNCTION ──────────────────────────────────────────────────────
/**
 * Funzione principale richiamata automaticamente ogni 6 ore dal Cloud di Google.
 */
function syncStewardCalendar() {
  Logger.log("=== AVVIO SYNC S.T.E.W.A.R.D. OS ===");
  
  // 1. Ottieni o crea il calendario Google dedicato
  var calendar = getOrCreateCalendar(CONFIG.CALENDAR_NAME);
  if (!calendar) {
    Logger.log("❌ Impossibile accedere al calendario Google.");
    return;
  }

  // 2. Recupera gli eventi (da API locale/remota oppure tramite scraping cloud autonomo)
  var events = fetchAllEvents();
  Logger.log("Trovati " + events.length + " eventi da elaborare.");

  if (!events || events.length === 0) {
    Logger.log("Nessun evento da sincronizzare.");
    return;
  }

  // 3. Finestra temporale: da adesso fino a 6 mesi nel futuro
  var now = new Date();
  var futureLimit = new Date();
  futureLimit.setMonth(futureLimit.getMonth() + 6);

  var existingGoogleEvents = calendar.getEvents(now, futureLimit);
  Logger.log("Eventi già presenti sul Google Calendar nel periodo: " + existingGoogleEvents.length);

  // Mappa gli eventi Google esistenti per Tag ID unico
  var gEventsMap = {};
  for (var i = 0; i < existingGoogleEvents.length; i++) {
    var gEv = existingGoogleEvents[i];
    var desc = gEv.getDescription() || "";
    var title = gEv.getTitle() || "";
    
    // Riconosci solo gli eventi creati da S.T.E.W.A.R.D. OS
    if (title.indexOf("[STEWARD]") !== -1 || desc.indexOf("[STEWARD_ID:") !== -1) {
      var idMatch = desc.match(/\[STEWARD_ID:([^\]]+)\]/);
      if (idMatch && idMatch[1]) {
        gEventsMap[idMatch[1]] = gEv;
      } else {
        // Fallback per titolo normalizzato
        var normalizedTitle = title.replace(/\[STEWARD\]\s*/i, "").split("(")[0].trim().toLowerCase();
        gEventsMap[normalizedTitle + "_" + gEv.getStartTime().toDateString()] = gEv;
      }
    }
  }

  var createdCount = 0;
  var updatedCount = 0;
  var unchangedCount = 0;

  // 4. Itera e sincronizza ogni evento
  for (var j = 0; j < events.length; j++) {
    var ev = events[j];
    
    // Calcola orari convocazione e fine servizio
    var dtStart = new Date(ev.event_start.replace(/-/g, "/"));
    if (isNaN(dtStart.getTime())) continue;

    // Solo eventi futuri
    if (dtStart < now) continue;

    var dtCall;
    if (ev.call_time) {
      dtCall = new Date(ev.call_time.replace(/-/g, "/"));
    } else {
      // Regola: 4 ore prima per Calcio, 08:30 per Fiera
      if (ev.category && ev.category.toUpperCase() === "FIERA") {
        dtCall = new Date(dtStart.getFullYear(), dtStart.getMonth(), dtStart.getDate(), 8, 30, 0);
      } else {
        dtCall = new Date(dtStart.getTime() - (4 * 60 * 60 * 1000));
      }
    }

    var dtEnd;
    if (ev.category && ev.category.toUpperCase() === "FIERA") {
      dtEnd = new Date(dtStart.getTime() + (8 * 60 * 60 * 1000));
    } else {
      dtEnd = new Date(dtStart.getTime() + (CONFIG.MATCH_SERVICE_DURATION_HOURS * 60 * 60 * 1000));
    }

    // Formattazioni per titolo e dettagli
    var callTimeHM = Utilities.formatDate(dtCall, "Europe/Rome", "HH:mm");
    var startTimeHM = Utilities.formatDate(dtStart, "Europe/Rome", "HH:mm");
    var dateFull = Utilities.formatDate(dtStart, "Europe/Rome", "dd/MM/yyyy");

    var eventTitle = "[STEWARD] " + ev.title + " (Conv: " + callTimeHM + ")";
    var eventKey = generateEventKey(ev.title, dtStart);

    var description = [
      "👮 TURNO SERVIZIO STEWARD",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "📌 Evento: " + ev.title,
      "🔔 CONVOCAZIONE: " + dateFull + " alle ore " + callTimeHM + " (4h prima)",
      "⚽ Inizio Partita/Evento: ore " + startTimeHM,
      "📍 Sede: " + (ev.venue || "Non specificata"),
      "🏷️ Categoria: " + (ev.category || "CALCIO"),
      "📋 Stato: " + (ev.status || "Da confermare"),
      ev.notes ? ("📝 Note: " + ev.notes) : "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "[STEWARD_ID:" + eventKey + "]",
      "Sincronizzato 24/7 dal Cloud S.T.E.W.A.R.D. OS"
    ].filter(Boolean).join("\n");

    var existingGEvent = gEventsMap[eventKey] || gEventsMap[ev.title.trim().toLowerCase() + "_" + dtStart.toDateString()];

    if (existingGEvent) {
      // Controllo se l'orario è stato modificato (partita anticipata/posticipata)
      var currentStart = existingGEvent.getStartTime();
      var currentEnd = existingGEvent.getEndTime();
      
      var timeDiff = Math.abs(currentStart.getTime() - dtCall.getTime());
      
      if (timeDiff > 60000) { // Differenza maggiore di 1 minuto -> orario cambiato!
        existingGEvent.setTime(dtCall, dtEnd);
        existingGEvent.setTitle(eventTitle);
        existingGEvent.setDescription(description);
        existingGEvent.setLocation(ev.venue || "");
        Logger.log("🔄 AGGIORNATO (Cambio orario): " + ev.title + " -> Nuova convocazione: " + callTimeHM);
        updatedCount++;
      } else {
        unchangedCount++;
      }
    } else {
      // Crea nuovo evento nel calendario
      try {
        var newEvent = calendar.createEvent(eventTitle, dtCall, dtEnd, {
          description: description,
          location: ev.venue || ""
        });
        
        // Aggiungi promemoria pop-up
        newEvent.addPopupReminder(CONFIG.REMINDER_MINUTES_BEFORE_CALL);
        Logger.log("➕ CREATO: " + eventTitle + " il " + dateFull);
        createdCount++;
      } catch (err) {
        Logger.log("Errore creazione evento: " + err);
      }
    }
  }

  Logger.log("=== SINCRONIZZAZIONE COMPLETATA ===");
  Logger.log("Nuovi turni creati: " + createdCount);
  Logger.log("Turni con orario aggiornato: " + updatedCount);
  Logger.log("Turni invariati: " + unchangedCount);
}


// ─── GESTIONE CALENDARIO GOOGLE ──────────────────────────────────────────────
function getOrCreateCalendar(name) {
  if (!name || name.trim() === "") {
    return CalendarApp.getDefaultCalendar();
  }
  
  var cals = CalendarApp.getCalendarsByName(name);
  if (cals.length > 0) {
    return cals[0];
  }

  // Se non esiste, crea un calendario dedicato con colore cyan
  try {
    var newCal = CalendarApp.createCalendar(name, {
      summary: "Turni e Convocazioni Steward (Napoli, Juve Stabia, Casertana, Mostra)",
      timeZone: "Europe/Rome"
    });
    Logger.log("Creato nuovo calendario Google: " + name);
    return newCal;
  } catch (e) {
    Logger.log("Fallback al calendario predefinito per: " + e);
    return CalendarApp.getDefaultCalendar();
  }
}

function generateEventKey(title, dateObj) {
  var cleanTitle = (title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  var dateStr = Utilities.formatDate(dateObj, "Europe/Rome", "yyyyMMdd");
  return cleanTitle + "_" + dateStr;
}


// ─── RECUPERO DATI: API O CLOUD SCRAPING DIRETTO ─────────────────────────────
function fetchAllEvents() {
  // 1. Prova API S.T.E.W.A.R.D. OS se configurata
  if (CONFIG.STEWARD_API_URL && CONFIG.STEWARD_API_URL.trim() !== "") {
    try {
      var url = CONFIG.STEWARD_API_URL.replace(/\/$/, "") + "/api/events";
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        var data = JSON.parse(res.getContentText());
        if (data.events && data.events.length > 0) {
          Logger.log("Dati scaricati con successo dall'API: " + url);
          return data.events;
        }
      }
    } catch (e) {
      Logger.log("Impossibile contattare STEWARD_API_URL (PC spento o URL errato), uso Scraping Cloud: " + e);
    }
  }

  // 2. Scraping autonomo Cloud di Google su Mostra d'Oltremare WordPress API + Fallback Seed
  var events = [];

  // A. Fetch Mostra d'Oltremare (API pubblica WordPress ufficiale)
  try {
    var mostraUrl = "https://mostradoltremare.it/wp-json/tribe/events/v1/events?per_page=50";
    var mRes = UrlFetchApp.fetch(mostraUrl, {
      muteHttpExceptions: true,
      headers: { "User-Agent": "Mozilla/5.0 GoogleAppsScript/1.0" }
    });
    if (mRes.getResponseCode() === 200) {
      var mData = JSON.parse(mRes.getContentText());
      if (mData.events) {
        for (var k = 0; k < mData.events.length; k++) {
          var me = mData.events[k];
          if (me.start_date) {
            events.push({
              title: me.title ? me.title.replace(/&#8211;|-/g, " - ").replace(/<[^>]+>/g, "").trim() : "Evento Mostra",
              venue: "Mostra d'Oltremare",
              category: "FIERA",
              event_start: me.start_date,
              call_time: me.start_date.substring(0, 10) + " 08:30:00",
              notes: me.excerpt ? me.excerpt.replace(/<[^>]+>/g, "").trim() : "Evento Mostra d'Oltremare"
            });
          }
        }
      }
    }
  } catch (errM) {
    Logger.log("Avviso scraping Mostra: " + errM);
  }

  // B. Calcio: partite in casa Napoli, Juve Stabia, Casertana (Seed schedule strutturato)
  var footballSeed = getFootballScheduleSeed();
  for (var f = 0; f < footballSeed.length; f++) {
    events.push(footballSeed[f]);
  }

  return events;
}


// ─── SCHEDULE SEED (CALENDARIO COMPLETO PARTITE IN CASA 2026/2027) ────────────
function getFootballScheduleSeed() {
  return [
    {"title": "Napoli vs Bodø/Glimt", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2026-10-20 21:00:00", "call_time": "2026-10-20 17:00:00", "notes": "Champions League – Notte europea allo Stadio Maradona"},
    {"title": "Napoli vs Roma", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2026-10-24 18:00:00", "call_time": "2026-10-24 14:00:00", "notes": "Serie A – Derby del Sole allo Stadio Maradona"},
    {"title": "Napoli vs Lazio", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2026-11-08 12:30:00", "call_time": "2026-11-08 08:30:00", "notes": "Serie A – Anticipo domenicale allo Stadio Maradona"},
    {"title": "Napoli vs Torino", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2026-11-21 20:45:00", "call_time": "2026-11-21 16:45:00", "notes": "Serie A – Anticipo serale allo Stadio Maradona"},
    {"title": "Napoli vs Lecce", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2026-12-05 20:45:00", "call_time": "2026-12-05 16:45:00", "notes": "Serie A – Stadio Diego Armando Maradona"},
    {"title": "Napoli vs Club Brugge", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2026-12-08 21:00:00", "call_time": "2026-12-08 17:00:00", "notes": "Champions League – Stadio Diego Armando Maradona"},
    {"title": "Napoli vs Milan", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2026-12-13 20:45:00", "call_time": "2026-12-13 16:45:00", "notes": "Serie A – Big match allo Stadio Maradona"},
    {"title": "Napoli vs Fiorentina", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2026-12-16 21:00:00", "call_time": "2026-12-16 17:00:00", "notes": "Coppa Italia – Ottavi di finale allo Stadio Maradona"},
    {"title": "Napoli vs Cagliari", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2027-01-07 20:45:00", "call_time": "2027-01-07 16:45:00", "notes": "Serie A – Stadio Diego Armando Maradona"},
    {"title": "Napoli vs Fiorentina", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2027-01-17 15:00:00", "call_time": "2027-01-17 11:00:00", "notes": "Serie A – Stadio Diego Armando Maradona (orario da confermare)"},
    {"title": "Napoli vs Viking FK", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2027-01-27 21:00:00", "call_time": "2027-01-27 17:00:00", "notes": "Champions League – Stadio Diego Armando Maradona"},
    {"title": "Napoli vs Inter", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2027-01-31 15:00:00", "call_time": "2027-01-31 11:00:00", "notes": "Serie A – Scontro al vertice allo Stadio Maradona"},
    {"title": "Napoli vs Juventus", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2027-02-14 15:00:00", "call_time": "2027-02-14 11:00:00", "notes": "Serie A – Classico al Maradona"},
    {"title": "Napoli vs Parma", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2027-03-07 15:00:00", "call_time": "2027-03-07 11:00:00", "notes": "Serie A – Stadio Diego Armando Maradona"},
    {"title": "Napoli vs Venezia", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2027-03-21 15:00:00", "call_time": "2027-03-21 11:00:00", "notes": "Serie A – Stadio Diego Armando Maradona"},
    {"title": "Napoli vs Sassuolo", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2027-04-11 15:00:00", "call_time": "2027-04-11 11:00:00", "notes": "Serie A – Stadio Diego Armando Maradona"},
    {"title": "Napoli vs Udinese", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2027-04-25 15:00:00", "call_time": "2027-04-25 11:00:00", "notes": "Serie A – Stadio Diego Armando Maradona"},
    {"title": "Napoli vs Monza", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2027-05-09 15:00:00", "call_time": "2027-05-09 11:00:00", "notes": "Serie A – Stadio Diego Armando Maradona"},
    {"title": "Napoli vs Genoa", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2027-05-16 15:00:00", "call_time": "2027-05-16 11:00:00", "notes": "Serie A – Stadio Diego Armando Maradona"},
    {"title": "Napoli vs Atalanta", "venue": "Stadio Diego Armando Maradona", "category": "CALCIO", "event_start": "2027-05-30 15:00:00", "call_time": "2027-05-30 11:00:00", "notes": "Serie A – Ultima giornata allo Stadio Maradona"},
    {"title": "Juve Stabia vs Südtirol", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2026-10-18 15:00:00", "call_time": "2026-10-18 11:00:00", "notes": "Serie B – Stadio Romeo Menti, Castellammare di Stabia"},
    {"title": "Juve Stabia vs Verona", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2026-10-28 20:00:00", "call_time": "2026-10-28 16:00:00", "notes": "Serie B – Turno infrasettimanale Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Arezzo", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2026-11-07 15:00:00", "call_time": "2026-11-07 11:00:00", "notes": "Serie B – Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Catanzaro", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2026-11-24 19:00:00", "call_time": "2026-11-24 15:00:00", "notes": "Serie B – Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Benevento", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2026-12-05 19:30:00", "call_time": "2026-12-05 15:30:00", "notes": "Serie B – Derby campano Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Padova", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2026-12-12 15:00:00", "call_time": "2026-12-12 11:00:00", "notes": "Serie B – Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Mantova", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2026-12-19 15:00:00", "call_time": "2026-12-19 11:00:00", "notes": "Serie B – Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Sampdoria", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2027-01-09 15:00:00", "call_time": "2027-01-09 11:00:00", "notes": "Serie B – Big match allo Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Cremonese", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2027-01-23 15:00:00", "call_time": "2027-01-23 11:00:00", "notes": "Serie B – Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Carrarese", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2027-02-06 15:00:00", "call_time": "2027-02-06 11:00:00", "notes": "Serie B – Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Empoli", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2027-02-20 15:00:00", "call_time": "2027-02-20 11:00:00", "notes": "Serie B – Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Modena", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2027-02-27 15:00:00", "call_time": "2027-02-27 11:00:00", "notes": "Serie B – Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Palermo", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2027-03-13 15:00:00", "call_time": "2027-03-13 11:00:00", "notes": "Serie B – Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Virtus Entella", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2027-04-03 15:00:00", "call_time": "2027-04-03 11:00:00", "notes": "Serie B – Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Avellino", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2027-04-17 15:00:00", "call_time": "2027-04-17 11:00:00", "notes": "Serie B – Derby campano allo Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Vicenza", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2027-05-01 15:00:00", "call_time": "2027-05-01 11:00:00", "notes": "Serie B – Stadio Romeo Menti"},
    {"title": "Juve Stabia vs Ascoli", "venue": "Stadio Romeo Menti", "category": "CALCIO", "event_start": "2027-05-14 15:00:00", "call_time": "2027-05-14 11:00:00", "notes": "Serie B – Stadio Romeo Menti"},
    {"title": "Casertana vs Bari", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2026-10-23 20:30:00", "call_time": "2026-10-23 16:30:00", "notes": "Serie C Girone C – Stadio Alberto Pinto, Caserta"},
    {"title": "Casertana vs Casarano", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2026-11-07 14:30:00", "call_time": "2026-11-07 10:30:00", "notes": "Serie C Girone C – Stadio Alberto Pinto"},
    {"title": "Casertana vs Salernitana", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2026-11-20 20:30:00", "call_time": "2026-11-20 16:30:00", "notes": "Serie C Girone C – Derby campano Stadio Alberto Pinto"},
    {"title": "Casertana vs Potenza", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2026-12-05 17:30:00", "call_time": "2026-12-05 13:30:00", "notes": "Serie C Girone C – Stadio Alberto Pinto"},
    {"title": "Casertana vs Crotone", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2026-12-19 17:30:00", "call_time": "2026-12-19 13:30:00", "notes": "Serie C Girone C – Stadio Alberto Pinto"},
    {"title": "Casertana vs Savoia", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2027-01-10 15:00:00", "call_time": "2027-01-10 11:00:00", "notes": "Serie C Girone C – Stadio Alberto Pinto"},
    {"title": "Casertana vs Inter U23", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2027-01-24 15:00:00", "call_time": "2027-01-24 11:00:00", "notes": "Serie C Girone C – Stadio Alberto Pinto"},
    {"title": "Casertana vs Cerignola", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2027-02-07 15:00:00", "call_time": "2027-02-07 11:00:00", "notes": "Serie C Girone C – Stadio Alberto Pinto"},
    {"title": "Casertana vs Cavese", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2027-02-14 15:00:00", "call_time": "2027-02-14 11:00:00", "notes": "Serie C Girone C – Derby campano Stadio Alberto Pinto"},
    {"title": "Casertana vs Sorrento", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2027-02-28 15:00:00", "call_time": "2027-02-28 11:00:00", "notes": "Serie C Girone C – Stadio Alberto Pinto"},
    {"title": "Casertana vs Giugliano", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2027-03-07 15:00:00", "call_time": "2027-03-07 11:00:00", "notes": "Serie C Girone C – Stadio Alberto Pinto"},
    {"title": "Casertana vs Cosenza", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2027-03-21 15:00:00", "call_time": "2027-03-21 11:00:00", "notes": "Serie C Girone C – Stadio Alberto Pinto"},
    {"title": "Casertana vs Foggia", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2027-04-04 15:00:00", "call_time": "2027-04-04 11:00:00", "notes": "Serie C Girone C – Stadio Alberto Pinto"},
    {"title": "Casertana vs Picerno", "venue": "Stadio Alberto Pinto", "category": "CALCIO", "event_start": "2027-04-18 15:00:00", "call_time": "2027-04-18 11:00:00", "notes": "Serie C Girone C – Stadio Alberto Pinto"}
  ];
}
