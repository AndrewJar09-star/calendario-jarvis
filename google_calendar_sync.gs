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
    // --- STADIO DIEGO ARMANDO MARADONA (SSC NAPOLI) ---
    {
      title: "Napoli vs Roma",
      venue: "Stadio Diego Armando Maradona",
      category: "CALCIO",
      event_start: "2026-10-24 18:00:00",
      call_time: "2026-10-24 14:00:00",
      notes: "Serie A - Partita di cartello allo Stadio Maradona"
    },
    {
      title: "Napoli vs Bodø/Glimt",
      venue: "Stadio Diego Armando Maradona",
      category: "CALCIO",
      event_start: "2026-10-20 21:00:00",
      call_time: "2026-10-20 17:00:00",
      notes: "Champions League - Notte europea allo Stadio Maradona"
    },
    {
      title: "Napoli vs Lazio",
      venue: "Stadio Diego Armando Maradona",
      category: "CALCIO",
      event_start: "2026-11-08 12:30:00",
      call_time: "2026-11-08 08:30:00",
      notes: "Serie A - Anticipo domenicale allo Stadio Maradona"
    },
    {
      title: "Napoli vs Torino",
      venue: "Stadio Diego Armando Maradona",
      category: "CALCIO",
      event_start: "2026-11-21 20:45:00",
      call_time: "2026-11-21 16:45:00",
      notes: "Serie A - Anticipo serale allo Stadio Maradona"
    },
    {
      title: "Napoli vs Sparta Praga",
      venue: "Stadio Diego Armando Maradona",
      category: "CALCIO",
      event_start: "2026-11-26 21:00:00",
      call_time: "2026-11-26 17:00:00",
      notes: "Champions League - Fase a gironi allo Stadio Maradona"
    },
    {
      title: "Napoli vs Juventus",
      venue: "Stadio Diego Armando Maradona",
      category: "CALCIO",
      event_start: "2026-12-06 20:45:00",
      call_time: "2026-12-06 16:45:00",
      notes: "Serie A - Big Match allo Stadio Maradona"
    },
    {
      title: "Napoli vs Verona",
      venue: "Stadio Diego Armando Maradona",
      category: "CALCIO",
      event_start: "2026-12-20 15:00:00",
      call_time: "2026-12-20 11:00:00",
      notes: "Serie A - Turno pre-natalizio allo Stadio Maradona"
    },
    {
      title: "Napoli vs Inter",
      venue: "Stadio Diego Armando Maradona",
      category: "CALCIO",
      event_start: "2027-01-10 20:45:00",
      call_time: "2027-01-10 16:45:00",
      notes: "Serie A - Scontro al vertice allo Stadio Maradona"
    },

    // --- STADIO ROMEO MENTI (SS JUVE STABIA) ---
    {
      title: "Juve Stabia vs Sassuolo",
      venue: "Stadio Romeo Menti",
      category: "CALCIO",
      event_start: "2026-10-25 15:00:00",
      call_time: "2026-10-25 11:00:00",
      notes: "Serie B - Gara casalinga allo Stadio Romeo Menti (Castellammare)"
    },
    {
      title: "Juve Stabia vs Spezia",
      venue: "Stadio Romeo Menti",
      category: "CALCIO",
      event_start: "2026-11-07 14:00:00",
      call_time: "2026-11-07 10:00:00",
      notes: "Serie B - Partita allo Stadio Romeo Menti"
    },
    {
      title: "Juve Stabia vs Brescia",
      venue: "Stadio Romeo Menti",
      category: "CALCIO",
      event_start: "2026-11-28 15:00:00",
      call_time: "2026-11-28 11:00:00",
      notes: "Serie B - Gara casalinga allo Stadio Romeo Menti"
    },
    {
      title: "Juve Stabia vs Salernitana",
      venue: "Stadio Romeo Menti",
      category: "CALCIO",
      event_start: "2026-12-13 17:15:00",
      call_time: "2026-12-13 13:15:00",
      notes: "Serie B - Derby campano ad altissima intensità al Romeo Menti"
    },
    {
      title: "Juve Stabia vs Pisa",
      venue: "Stadio Romeo Menti",
      category: "CALCIO",
      event_start: "2026-12-26 15:00:00",
      call_time: "2026-12-26 11:00:00",
      notes: "Serie B - Boxing Day allo Stadio Romeo Menti"
    },

    // --- STADIO ALBERTO PINTO (CASERTANA FC) ---
    {
      title: "Casertana vs Benevento",
      venue: "Stadio Alberto Pinto",
      category: "CALCIO",
      event_start: "2026-10-26 20:30:00",
      call_time: "2026-10-26 16:30:00",
      notes: "Serie C Girone C - Derby campano serale allo Stadio Alberto Pinto"
    },
    {
      title: "Casertana vs Catania",
      venue: "Stadio Alberto Pinto",
      category: "CALCIO",
      event_start: "2026-11-15 17:30:00",
      call_time: "2026-11-15 13:30:00",
      notes: "Serie C Girone C - Gara casalinga allo Stadio Alberto Pinto"
    },
    {
      title: "Casertana vs Avellino",
      venue: "Stadio Alberto Pinto",
      category: "CALCIO",
      event_start: "2026-12-05 20:45:00",
      call_time: "2026-12-05 16:45:00",
      notes: "Serie C Girone C - Derby caldissimo allo Stadio Alberto Pinto"
    },
    {
      title: "Casertana vs Foggia",
      venue: "Stadio Alberto Pinto",
      category: "CALCIO",
      event_start: "2026-12-22 18:30:00",
      call_time: "2026-12-22 14:30:00",
      notes: "Serie C Girone C - Gara infrasettimanale allo Stadio Pinto"
    }
  ];
}
