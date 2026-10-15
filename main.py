from fastapi import FastAPI, HTTPException, status as http_status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timedelta

STATIC_DIR = Path(__file__).parent / "static"

from apscheduler.schedulers.background import BackgroundScheduler

from database import (
    init_db,
    get_all_events_with_conflicts,
    update_event_status,
    get_alerts,
    insert_or_update_event,
    check_conflicts_and_updates,
    get_db_connection,
    parse_datetime,
)
from scraper import sync_all_events

# Inizializzazione scheduler di background (intervallo 6 ore)
scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inizializza il database SQLite all'avvio
    init_db()

    # Se il database è vuoto all'avvio, popola immediatamente con sync iniziale
    try:
        conn = get_db_connection()
        count = conn.execute("SELECT count(*) FROM events").fetchone()[0]
        conn.close()
        if count == 0:
            sync_all_events()
    except Exception as e:
        print(f"Warning durante sync iniziale: {e}")

    # Programma il job di sincronizzazione ogni 6 ore
    scheduler.add_job(
        sync_all_events,
        trigger="interval",
        hours=6,
        id="sync_events_job",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.start()

    yield

    scheduler.shutdown(wait=False)


app = FastAPI(
    title="S.T.E.W.A.R.D. OS - Backend API",
    description="Sistema Operativo di Gestione Turni, Eventi, Convocazioni e Conflitti per Steward",
    version="1.0.0",
    lifespan=lifespan,
)

# Configurazione CORS per future integrazioni frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# Pydantic Schemas
# ==========================================
class StatusUpdateRequest(BaseModel):
    status: str = Field(..., example="Lavoro io", description="Stato: es. 'Lavoro io' o 'Riposo'")


class EventCreateRequest(BaseModel):
    title: str = Field(..., example="Inter vs Juventus")
    venue: Optional[str] = Field(None, example="Stadio San Siro")
    category: str = Field(..., example="CALCIO", description="'CALCIO', 'FIERA', o altro")
    event_start: str = Field(..., example="2026-10-25 20:45:00", description="Data e ora inizio evento")
    call_time: Optional[str] = Field(None, example="2026-10-25 16:45:00", description="Opzionale (calcolato automaticamente)")
    status: Optional[str] = Field("Da confermare", example="Da confermare")
    notes: Optional[str] = Field(None, example="Portare pettorina e tesserino")


class EventUpdateRequest(BaseModel):
    title: Optional[str] = None
    venue: Optional[str] = None
    category: Optional[str] = None
    event_start: Optional[str] = None
    call_time: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class SyncRequest(BaseModel):
    force_seed: Optional[bool] = Field(False, description="Forza l'uso dei dati reali di seed come fallback")


# ==========================================
# REST API Endpoints
# ==========================================

# Mount static files AFTER API routes definition
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def root():
    """Serve the PWA frontend."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file, media_type="text/html")
    # Fallback JSON if static not present
    return {
        "system": "S.T.E.W.A.R.D. OS",
        "status": "online",
        "version": "1.0.0",
        "endpoints": {
            "events": "/api/events",
            "update_status": "/api/events/{id}/status",
            "alerts": "/api/alerts",
            "calendar_ics": "/api/calendar.ics",
            "google_script": "/api/google-script",
            "sync": "POST /api/sync",
            "check_batch": "POST /api/events/check-batch"
        }
    }


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    """Serve favicon.ico directly from static directory."""
    fav_file = STATIC_DIR / "favicon.ico"
    if fav_file.exists():
        return FileResponse(fav_file, media_type="image/x-icon")
    return Response(status_code=404)


def generate_ical_feed() -> str:
    """
    Genera un feed standard iCalendar (RFC 5545) contenente tutti i turni presenti nel database.
    - Titolo evento: '[STEWARD] {title} (Conv: {hh:mm})'
    - Orario inizio (DTSTART): Orario di CONVOCAZIONE (4h prima dell'evento per il calcio, 08:30 per fiera)
    - Orario fine (DTEND): Fine presunta del servizio (+3h da inizio partita, +8h per fiere)
    - Località: Stadio / Sede evento
    - Notifica VALARM: 60 minuti prima della convocazione
    - Fuso orario standard VTIMEZONE: Europe/Rome
    """
    events = get_all_events_with_conflicts()
    now_str = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    def escape_ical(text: Optional[str]) -> str:
        if not text:
            return ""
        s = str(text).replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
        return s.replace("\r\n", "\\n").replace("\r", "\\n").replace("\n", "\\n")

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//STEWARD OS//Gestione Turni Steward//IT",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:S.T.E.W.A.R.D. OS - Turni & Convocazioni",
        "X-WR-TIMEZONE:Europe/Rome",
        "X-WR-CALDESC:Feed turni e convocazioni steward con orario di convocazione 4h prima",
        "REFRESH-INTERVAL;VALUE=DURATION:PT4H",
        "X-PUBLISHED-TTL:PT4H",
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Rome",
        "X-LIC-LOCATION:Europe/Rome",
        "BEGIN:DAYLIGHT",
        "TZOFFSETFROM:+0100",
        "TZOFFSETTO:+0200",
        "TZNAME:CEST",
        "DTSTART:19700329T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
        "END:DAYLIGHT",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:+0200",
        "TZOFFSETTO:+0100",
        "TZNAME:CET",
        "DTSTART:19701025T030000",
        "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
        "END:STANDARD",
        "END:VTIMEZONE",
    ]

    for ev in events:
        try:
            dt_start = parse_datetime(ev["event_start"])
            dt_call = parse_datetime(ev["call_time"])
        except Exception:
            continue

        cat = (ev.get("category") or "").upper()
        if cat == "FIERA":
            dt_end = dt_start + timedelta(hours=8)
        else:
            dt_end = dt_start + timedelta(hours=3)

        call_hm = dt_call.strftime("%H:%M")
        start_hm = dt_start.strftime("%H:%M")
        title_str = ev.get("title", "Turno Steward")
        summary = escape_ical(f"[STEWARD] {title_str} (Conv: {call_hm})")
        location = escape_ical(ev.get("venue") or "")

        desc_parts = [
            "👮 TURNO SERVIZIO STEWARD",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            f"📌 Evento: {title_str}",
            f"🔔 CONVOCAZIONE: {ev.get('call_time')} (4 ORE PRIMA)",
            f"⚽ Inizio Partita/Evento: ore {start_hm}",
            f"📍 Sede: {ev.get('venue') or 'Non specificata'}",
            f"🏷️ Categoria: {ev.get('category') or 'CALCIO'}",
            f"📋 Stato Assegnazione: {ev.get('status') or 'Da confermare'}",
        ]
        if ev.get("notes"):
            desc_parts.append(f"📝 Note: {ev.get('notes')}")
        if ev.get("conflict"):
            desc_parts.append("⚠️ ATTENZIONE: Conflitto di data rilevato con altro evento!")
        desc_parts.extend([
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "Sincronizzato automaticamente da S.T.E.W.A.R.D. OS",
        ])
        description = escape_ical("\n".join(desc_parts))

        lines.extend([
            "BEGIN:VEVENT",
            f"UID:steward-event-{ev['id']}@steward-os",
            f"DTSTAMP:{now_str}",
            f"DTSTART;TZID=Europe/Rome:{dt_call.strftime('%Y%m%dT%H%M%S')}",
            f"DTEND;TZID=Europe/Rome:{dt_end.strftime('%Y%m%dT%H%M%S')}",
            f"SUMMARY:{summary}",
            f"LOCATION:{location}",
            f"DESCRIPTION:{description}",
            "STATUS:CONFIRMED",
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:Promemoria Convocazione Steward {title_str} (ore {call_hm})",
            "TRIGGER:-PT60M",
            "END:VALARM",
            "END:VEVENT",
        ])

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


@app.get("/api/calendar.ics")
def get_calendar_ics():
    """
    Ritorna il feed iCalendar (RFC 5545) standard con tutti i turni presenti nel database.
    Include nel titolo '[STEWARD]' e l'orario di convocazione (4h prima dell'evento).
    Ideale per sottoscrizione diretta da Google Calendar, iPhone / iOS o Android.
    """
    ics_content = generate_ical_feed()
    return Response(
        content=ics_content,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'inline; filename="steward_calendar.ics"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.get("/api/google-script")
def get_google_script():
    """Restituisce il codice sorgente pronto di google_calendar_sync.gs per l'interfaccia utente."""
    gs_file = Path(__file__).parent / "google_calendar_sync.gs"
    if gs_file.exists():
        return FileResponse(gs_file, media_type="text/plain; charset=utf-8")
    return Response(content="// File google_calendar_sync.gs non trovato", media_type="text/plain")


@app.get("/api/events")
def list_events():
    """
    Ritorna la lista di tutti gli eventi nel database,
    arricchiti con il flag 'conflict' (se cadono nello stesso giorno)
    e 'updated_flag' (se l'orario è stato modificato).
    """
    events = get_all_events_with_conflicts()
    return {
        "count": len(events),
        "events": events
    }


@app.post("/api/events")
def create_event(event: EventCreateRequest):
    """
    Crea un nuovo evento.
    - Se category='CALCIO' -> call_time = event_start - 4 ore.
    - Se category='FIERA' -> call_time = 08:30 dello stesso giorno.
    """
    try:
        saved = insert_or_update_event(event.model_dump())
        return {
            "message": "Evento creato con successo",
            "event": saved
        }
    except Exception as e:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Errore durante la creazione dell'evento: {str(e)}"
        )


@app.put("/api/events/{event_id}")
def update_event(event_id: int, event: EventUpdateRequest):
    """
    Aggiorna un evento esistente.
    Se l'orario (event_start) cambia rispetto al valore nel DB,
    imposta automaticamente updated_flag = True.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Evento con ID {event_id} non trovato"
        )

    existing = dict(row)
    update_data = event.model_dump(exclude_unset=True)
    merged = {**existing, **update_data, "id": event_id}

    saved = insert_or_update_event(merged)
    return {
        "message": "Evento aggiornato",
        "event": saved
    }


@app.post("/api/events/{event_id}/status")
def change_event_status(event_id: int, payload: StatusUpdateRequest):
    """
    Aggiorna lo stato di disponibilità per un evento:
    es. 'Lavoro io' o 'Riposo'.
    """
    valid_status = payload.status.strip()
    if not valid_status:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Il campo 'status' non può essere vuoto"
        )

    updated = update_event_status(event_id, valid_status)
    if not updated:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Evento con ID {event_id} non trovato"
        )

    return {
        "message": f"Stato aggiornato a '{valid_status}'",
        "event": updated
    }


@app.get("/api/alerts")
def get_alerts_endpoint():
    """
    Rileva e restituisce gli avvisi attivi:
    - Cambi di orario rispetto al DB (updated_flag = True)
    - Conflitti (due o più eventi che cadono nello stesso giorno)
    """
    alerts = get_alerts()
    return alerts


@app.post("/api/events/check-batch")
def check_batch_events(events: List[Dict[str, Any]]):
    """
    Funzione di supporto per analizzare una lista di eventi (es. dallo scraper)
    e identificare conflitti di giornata e cambi orario rispetto al database.
    """
    updated, conflicts = check_conflicts_and_updates(events, persist_changes=False)
    return {
        "total_checked": len(events),
        "updated_events_count": len(updated),
        "conflicts_count": len(conflicts),
        "updated_events": updated,
        "conflicting_events": conflicts
    }


@app.post("/api/sync")
def trigger_sync(payload: Optional[SyncRequest] = None):
    """
    Endpoint di sincronizzazione manuale o programmata:
    - Esegue lo scraper per le partite in casa (Stadio Maradona, Stadio Romeo Menti, Stadio Alberto Pinto)
    - Esegue lo scraper per eventi e fiere di Mostra d'Oltremare
    - Applica il fallback seed_initial_data() se una fonte esterna è irraggiungibile o se force_seed=True
    - Aggiorna il DB preservando scelte utente e calcolando i call_time automatici (-4h per CALCIO, 08:30 per FIERA)
    - Rileva eventuali cambi d'orario e conflitti di data
    """
    try:
        force_seed = payload.force_seed if payload else False
        result = sync_all_events(force_seed=force_seed)
        return {
            "message": "Sincronizzazione completata con successo",
            **result
        }
    except Exception as e:
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Errore durante l'esecuzione della sincronizzazione: {str(e)}"
        )

