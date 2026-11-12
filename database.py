import sqlite3
import re
import unicodedata
from datetime import datetime, timedelta, time
from typing import Optional, List, Dict, Any, Tuple
from pathlib import Path

DB_PATH = Path(__file__).parent / "steward.db"

MULTI_DATE_SHOW_KEYS = {
    "cafe chantant my world",
    "finche giudice non ci separi",
    "masaniello",
}

# Finestra (giorni) entro cui uno stesso titolo con data diversa è considerato
# lo stesso evento rinviato/anticipato, e non un evento distinto.
SMALL_RESCHEDULE_DAYS = 3        # inserimenti singoli (insert_or_update_event)
RESCHEDULE_WINDOW_DAYS = 14      # riconciliazione completa per sede (reconcile_venue_events)

# Sedi gestite automaticamente da scraper/seed
MANAGED_VENUES = ("Stadio Maradona", "Stadio Romeo Menti", "Stadio Alberto Pinto", "Mostra d'Oltremare")

BOGUS_VOICE_TITLES = {
    "generico",
    "stadio con convocazione",
    "imposta consegna pizze",
    "disegna ore",
    "cosa c e in",
    "prossimo a google calendar",
    "quanti turni ho in",
}


def clean_display_title(title: str) -> str:
    """Pulisce eventuali artefatti di codifica/scraping nei titoli degli eventi."""
    if not title:
        return ""
    t = str(title).strip()
    t = re.sub(r"È+Empoli", "Empoli", t)
    t = re.sub(r"È+ntella", "Entella", t)
    t = re.sub(r"È+E*rry", "Erry", t)
    t = t.replace("U2°3", "U23").replace("2°7", "27").replace("2°9", "29")
    t = t.replace("2°°", "2°").replace("65°°", "65°")
    t = t.replace("FINCHÈ’", "FINCHE'").replace("GIUDICÈ", "GIUDICE").replace("SÈPARI", "SEPARI")
    t = t.replace("CAFÈ’", "CAFE'").replace("È’", "E'")
    return re.sub(r"\s+", " ", t).strip()


def normalize_event_key(title: str) -> str:
    """Genera una chiave canonica normalizzata per il confronto univoco degli eventi."""
    t = clean_display_title(title)
    t = t.replace("ø", "o").replace("Ø", "o")
    t = unicodedata.normalize("NFD", t)
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
    t = t.lower()
    t = re.sub(r"[^a-z0-9]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    if t.startswith("fiera del baratto e dell usato 2026"):
        return "fiera del baratto e dell usato 2026"
    if t.startswith("padelness e sport 2026"):
        return "padelness e sport 2026"
    return t


def get_db_connection() -> sqlite3.Connection:
    """Create and return a SQLite connection configured with dict-like row access."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Initialize database schema with the events table."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                venue TEXT,
                category TEXT NOT NULL,
                event_start TEXT NOT NULL,
                call_time TEXT NOT NULL,
                status TEXT DEFAULT 'Da confermare',
                updated_flag INTEGER DEFAULT 0,
                notes TEXT,
                earnings REAL DEFAULT NULL
            )
            """
        )
        try:
            cursor.execute("ALTER TABLE events ADD COLUMN earnings REAL DEFAULT NULL")
        except sqlite3.OperationalError:
            pass
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_event_start ON events(event_start)")
        conn.commit()


def parse_datetime(dt_str: str) -> datetime:
    """Parse multiple common datetime string formats into a datetime object."""
    dt_str = dt_str.strip()
    # Try ISO formats
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(dt_str, fmt)
        except ValueError:
            continue
    # Fallback to fromisoformat
    try:
        return datetime.fromisoformat(dt_str)
    except Exception as exc:
        raise ValueError(f"Formato data non valido: '{dt_str}'. Utilizzare 'YYYY-MM-DD HH:MM:SS'") from exc


def _days_between(a: Optional[str], b: Optional[str]) -> Optional[int]:
    """Distanza assoluta in giorni tra due date-stringa (None se non parsabili)."""
    try:
        return abs((parse_datetime(a).date() - parse_datetime(b).date()).days)
    except Exception:
        return None


def calculate_call_time(category: str, event_start_str: str, custom_call_time: Optional[str] = None) -> str:
    """
    Business Rules:
    - Se 'CALCIO': call_time = 4 ore prima di event_start.
    - Se 'FIERA': call_time = 08:30 dello stesso giorno di event_start.
    - Altre categorie: usa custom_call_time se specificato, altrimenti default a event_start.
    """
    dt_start = parse_datetime(event_start_str)
    cat_upper = (category or "").strip().upper()

    if cat_upper == "CALCIO":
        call_dt = dt_start - timedelta(hours=4)
        return call_dt.strftime("%Y-%m-%d %H:%M:%S")
    elif cat_upper == "FIERA":
        call_dt = datetime.combine(dt_start.date(), time(8, 30, 0))
        return call_dt.strftime("%Y-%m-%d %H:%M:%S")
    else:
        if custom_call_time:
            try:
                parsed_custom = parse_datetime(custom_call_time)
                return parsed_custom.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                return custom_call_time
        return dt_start.strftime("%Y-%m-%d %H:%M:%S")


def check_conflicts_and_updates(
    incoming_events: List[Dict[str, Any]],
    persist_changes: bool = True
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Rileva:
    1. Se un evento esistente cambia orario rispetto al DB (updated_flag = True).
    2. Se due o più eventi cadono nello stesso giorno (conflict = True).
    
    Ritorna: (updated_events, conflicting_events)
    """
    conn = get_db_connection()
    updated_events: List[Dict[str, Any]] = []
    
    try:
        cursor = conn.cursor()

        # Step 1: Controllo cambi orario rispetto al DB
        for event in incoming_events:
            event_id = event.get("id")
            new_start = event.get("event_start")
            existing = None

            if event_id is not None:
                cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
                existing = cursor.fetchone()
            elif event.get("title") and event.get("venue"):
                cursor.execute(
                    "SELECT * FROM events WHERE title = ? AND venue = ? ORDER BY id DESC LIMIT 1",
                    (event["title"], event.get("venue", ""))
                )
                existing = cursor.fetchone()

            if existing:
                existing_dict = dict(existing)
                # Normalizza date per confronto
                try:
                    old_dt = parse_datetime(existing_dict["event_start"])
                    new_dt = parse_datetime(new_start) if new_start else old_dt
                    has_time_changed = (old_dt != new_dt)
                except Exception:
                    has_time_changed = (existing_dict["event_start"] != new_start)

                if has_time_changed:
                    event["updated_flag"] = True
                    event["previous_event_start"] = existing_dict["event_start"]
                    # Ricalcola call_time se l'orario di inizio è variato
                    if "category" in event or "category" in existing_dict:
                        cat = event.get("category") or existing_dict["category"]
                        event["call_time"] = calculate_call_time(cat, new_start)
                    updated_events.append(event)
                    if persist_changes and event_id:
                        cursor.execute(
                            """
                            UPDATE events 
                            SET event_start = ?, call_time = ?, updated_flag = 1
                            WHERE id = ?
                            """,
                            (event.get("event_start"), event.get("call_time"), event_id)
                        )
                else:
                    event["updated_flag"] = bool(existing_dict.get("updated_flag", 0))
            else:
                event["updated_flag"] = False

        if persist_changes:
            conn.commit()

        # Step 2: Rilevamento conflitti nello stesso giorno
        # Considera sia gli eventi nel DB che la lista in esame
        cursor.execute("SELECT * FROM events")
        all_db_events = [dict(r) for r in cursor.fetchall()]
        
        # Mappa per id per unificare
        all_events_map = {e["id"]: e for e in all_db_events}
        for e in incoming_events:
            if e.get("id"):
                all_events_map[e["id"]] = {**all_events_map.get(e["id"], {}), **e}

        # Raggruppa per data YYYY-MM-DD
        events_by_date: Dict[str, List[Dict[str, Any]]] = {}
        for ev in all_events_map.values():
            try:
                d_str = parse_datetime(ev["event_start"]).strftime("%Y-%m-%d")
            except Exception:
                continue
            events_by_date.setdefault(d_str, []).append(ev)

        conflicting_events: List[Dict[str, Any]] = []
        for date_key, ev_list in events_by_date.items():
            if len(ev_list) > 1:
                for ev in ev_list:
                    ev_copy = dict(ev)
                    ev_copy["conflict"] = True
                    ev_copy["conflict_date"] = date_key
                    ev_copy["conflicting_with_ids"] = [other["id"] for other in ev_list if other["id"] != ev["id"]]
                    conflicting_events.append(ev_copy)

        return updated_events, conflicting_events

    finally:
        conn.close()


def _is_hidden_or_rest(status_val: Optional[str]) -> bool:
    s = (status_val or "").strip().lower()
    return "riposo" in s or "ignora" in s


def get_all_events_with_conflicts() -> List[Dict[str, Any]]:
    """Recupera tutti gli eventi dal DB arricchiti con il flag conflict e updated_flag."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM events ORDER BY event_start ASC")
        rows = [dict(r) for r in cursor.fetchall()]

        # Raggruppa per data solo gli eventi attivi (non in Riposo / Ignora)
        active_by_date: Dict[str, List[Dict[str, Any]]] = {}
        for r in rows:
            if _is_hidden_or_rest(r.get("status")):
                continue
            try:
                d_str = parse_datetime(r["event_start"]).strftime("%Y-%m-%d")
            except Exception:
                d_str = "unknown"
            active_by_date.setdefault(d_str, []).append(r)

        results = []
        for r in rows:
            if _is_hidden_or_rest(r.get("status")):
                results.append({
                    **r,
                    "conflict": False,
                    "conflicting_with_ids": [],
                    "updated_flag": bool(r.get("updated_flag", 0))
                })
                continue

            try:
                d_str = parse_datetime(r["event_start"]).strftime("%Y-%m-%d")
            except Exception:
                d_str = "unknown"

            same_day_evs = active_by_date.get(d_str, [])
            lavoro_evs = [x for x in same_day_evs if "lavoro" in (x.get("status") or "").lower()]

            # Se l'utente ha già selezionato "Lavoro io" su UN SOLO turno in quella data,
            # la giornata è risolta e non va segnalata come conflitto attivo.
            if len(lavoro_evs) == 1:
                is_conflict = False
                conflicting_ids = []
            elif len(lavoro_evs) > 1:
                is_conflict = "lavoro" in (r.get("status") or "").lower()
                conflicting_ids = [x["id"] for x in lavoro_evs if x["id"] != r["id"]] if is_conflict else []
            else:
                is_conflict = len(same_day_evs) > 1
                conflicting_ids = [x["id"] for x in same_day_evs if x["id"] != r["id"]]

            results.append({
                **r,
                "conflict": is_conflict,
                "conflicting_with_ids": conflicting_ids,
                "updated_flag": bool(r.get("updated_flag", 0))
            })
        return results
    finally:
        conn.close()


def get_alerts() -> Dict[str, Any]:
    """
    Ritorna gli avvisi attivi:
    - cambi_orario: eventi dove updated_flag = 1
    - conflitti: date odierne o future dove ci sono più eventi attivi non risolti
    """
    events = get_all_events_with_conflicts()
    today_str = datetime.now().strftime("%Y-%m-%d")
    time_changes = [e for e in events if e.get("updated_flag") and not _is_hidden_or_rest(e.get("status"))]
    
    # Raggruppa conflitti per data (solo date odierne/future o doppi turni lavorati)
    conflicts_by_date: Dict[str, List[Dict[str, Any]]] = {}
    for e in events:
        if e.get("conflict"):
            try:
                d_str = parse_datetime(e["event_start"]).strftime("%Y-%m-%d")
            except Exception:
                d_str = "unknown"
            is_lavoro = "lavoro" in (e.get("status") or "").lower()
            if d_str >= today_str or is_lavoro:
                conflicts_by_date.setdefault(d_str, []).append(e)

    conflicts_list = [
        {"date": d, "count": len(evs), "events": evs}
        for d, evs in conflicts_by_date.items()
        if len(evs) > 1
    ]

    return {
        "total_alerts": len(time_changes) + len(conflicts_list),
        "time_changes_count": len(time_changes),
        "conflicts_count": len(conflicts_list),
        "time_changes": time_changes,
        "conflicts": conflicts_list
    }


def insert_or_update_event(event_data: Dict[str, Any], force_insert: bool = False) -> Dict[str, Any]:
    """
    Inserisce o aggiorna un evento applicando:
    - Calcolo automatico call_time (CALCIO -> -4h, FIERA -> 08:30)
    - Confronto normalizzato sul titolo per evitare duplicati da punteggiatura
    - Se force_insert=True, inserisce sempre un nuovo record senza sovrascrivere eventi esistenti
    """
    init_db()
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        event_id = event_data.get("id")
        title = clean_display_title(event_data.get("title") or "")
        venue = (event_data.get("venue") or "").strip()
        category = (event_data.get("category") or "").strip().upper()
        event_start = event_data.get("event_start")
        notes = event_data.get("notes", "")
        status = event_data.get("status", "Da confermare")
        earnings = event_data.get("earnings")
        reset_updated = event_data.get("reset_updated_flag", False)

        # Calcolo call_time
        call_time = calculate_call_time(category, event_start, event_data.get("call_time"))

        updated_flag = 0
        existing = None
        norm_key = normalize_event_key(title)
        target_date_str = (event_start or "")[:10]

        if not force_insert:
            if event_id:
                cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
                cand = cursor.fetchone()
                if cand and normalize_event_key(cand["title"]) == norm_key:
                    existing = cand

            if not existing and title:
                # Abbinamento per (titolo normalizzato + DATA), mai solo per titolo:
                # la stessa sfida può ripetersi nella stagione (es. Napoli vs Fiorentina
                # in Coppa Italia e in Serie A) e non deve collidere/sovrascriversi.
                cursor.execute("SELECT * FROM events ORDER BY id ASC")
                same_key = [r for r in cursor.fetchall() if normalize_event_key(r["title"]) == norm_key]
                exact = [r for r in same_key if (r["event_start"] or "")[:10] == target_date_str]
                if exact:
                    existing = exact[0]
                elif norm_key not in MULTI_DATE_SHOW_KEYS and target_date_str:
                    # Possibile rinvio/anticipo: stesso titolo e stessa sede entro pochi giorni
                    best_delta = None
                    for r in same_key:
                        if (r["venue"] or "").strip() != venue:
                            continue
                        delta = _days_between(r["event_start"], event_start)
                        if delta is not None and delta <= SMALL_RESCHEDULE_DAYS and (best_delta is None or delta < best_delta):
                            existing, best_delta = r, delta
                if existing:
                    event_id = existing["id"]

        if existing:
            # Preserva lo stato utente se diverso dal default 'Da confermare'
            existing_dict = dict(existing)
            existing_status = existing_dict.get("status")
            final_status = existing_status if (existing_status and existing_status != "Da confermare") else status
            
            # Preserva compenso/guadagno esistente se non passato esplicitamente
            existing_earnings = existing_dict.get("earnings")
            final_earnings = earnings if earnings is not None else existing_earnings

            if reset_updated:
                updated_flag = 0
            else:
                old_start = existing_dict["event_start"]
                try:
                    old_dt = parse_datetime(old_start)
                    new_dt = parse_datetime(event_start)
                    if old_dt != new_dt and abs((new_dt.date() - old_dt.date()).days) <= 4:
                        updated_flag = 1
                    else:
                        updated_flag = 0
                except Exception:
                    updated_flag = 0

            cursor.execute(
                """
                UPDATE events
                SET title = ?, venue = ?, category = ?, event_start = ?, call_time = ?,
                    status = ?, updated_flag = ?, notes = ?, earnings = ?
                WHERE id = ?
                """,
                (title, venue, category, event_start, call_time, final_status, updated_flag, notes, final_earnings, event_id)
            )
            saved_id = event_id
        else:
            cursor.execute(
                """
                INSERT INTO events (title, venue, category, event_start, call_time, status, updated_flag, notes, earnings)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (title, venue, category, event_start, call_time, status, 0, notes, earnings)
            )
            saved_id = cursor.lastrowid

        conn.commit()
        
        cursor.execute("SELECT * FROM events WHERE id = ?", (saved_id,))
        saved_row = dict(cursor.fetchone())
        return saved_row
    finally:
        conn.close()


def _resolve_target_event_id(cursor: sqlite3.Cursor, event_id: int, title: Optional[str] = None) -> Optional[int]:
    """Risolve l'ID corretto nel DB verificando la corrispondenza del titolo se fornito."""
    cursor.execute("SELECT id, title FROM events WHERE id = ?", (event_id,))
    row = cursor.fetchone()
    if row:
        if not title or normalize_event_key(row["title"]) == normalize_event_key(title):
            return row["id"]
    if title:
        target_key = normalize_event_key(title)
        cursor.execute("SELECT id, title FROM events ORDER BY id ASC")
        for r in cursor.fetchall():
            if normalize_event_key(r["title"]) == target_key:
                return r["id"]
    return row["id"] if row else None


def update_event_status(event_id: int, status: str, earnings: Optional[float] = None, title: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Aggiorna lo stato di un evento (es. 'Lavoro io' o 'Riposo') e opzionalmente il compenso/guadagno."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        resolved_id = _resolve_target_event_id(cursor, event_id, title)
        if resolved_id is None:
            return None
        if earnings is not None:
            cursor.execute("UPDATE events SET status = ?, earnings = ? WHERE id = ?", (status, earnings, resolved_id))
        else:
            cursor.execute("UPDATE events SET status = ? WHERE id = ?", (status, resolved_id))
        conn.commit()
        cursor.execute("SELECT * FROM events WHERE id = ?", (resolved_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def update_event_earnings(event_id: int, earnings: Optional[float], title: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Aggiorna il compenso/guadagno di un evento."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        resolved_id = _resolve_target_event_id(cursor, event_id, title)
        if resolved_id is None:
            return None
        cursor.execute("UPDATE events SET earnings = ? WHERE id = ?", (earnings, resolved_id))
        conn.commit()
        cursor.execute("SELECT * FROM events WHERE id = ?", (resolved_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_event_by_id(event_id: int) -> Optional[Dict[str, Any]]:
    """Recupera un singolo evento per ID."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def delete_event(event_id: int) -> bool:
    """Elimina un evento dal database tramite il suo ID. Ritorna True se eliminato, False altrimenti."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM events WHERE id = ?", (event_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def sanitize_and_deduplicate_db(canonical_seeds: Optional[List[Dict[str, Any]]] = None) -> int:
    """
    Ripara, normalizza e deduplica il database SQLite:
    - Rimuove eventuali record spuri generati da vecchi test vocali.
    - Unisce i record duplicati preservando sempre stato ('Lavoro io'/'Riposo') e guadagni ('earnings').
    - Ripristina le date e gli orari canonici da calendario ufficiale per tutti gli eventi seed.
    Ritorna il numero di record rimossi/riparati.
    """
    init_db()
    conn = get_db_connection()
    fixed_count = 0
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM events ORDER BY id ASC")
        rows = [dict(r) for r in cursor.fetchall()]
        if not rows:
            return 0

        single_seed_map: Dict[Tuple[str, str], Dict[str, Any]] = {}
        if canonical_seeds:
            for s in canonical_seeds:
                k = normalize_event_key(s.get("title", ""))
                d = (s.get("event_start") or "")[:10]
                # Chiave SEMPRE (titolo, data): evita collisioni tra partite omonime
                single_seed_map[(k, d)] = s

        groups: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
        ids_to_delete: List[int] = []

        for r in rows:
            k = normalize_event_key(r.get("title", ""))
            if not k or k in BOGUS_VOICE_TITLES:
                ids_to_delete.append(r["id"])
                fixed_count += 1
                continue

            d = (r.get("event_start") or "")[:10]
            g_key = (k, d)
            groups.setdefault(g_key, []).append(r)

        for g_key, grp in groups.items():
            primary = grp[0]
            if len(grp) > 1:
                for dup in grp[1:]:
                    ids_to_delete.append(dup["id"])
                    fixed_count += 1

            # Merge status & earnings across duplicates
            best_status = "Da confermare"
            best_earnings = None
            for item in grp:
                er = item.get("earnings")
                if er is not None and float(er) > 0:
                    if best_earnings is None or float(er) > float(best_earnings):
                        best_earnings = float(er)
                st = (item.get("status") or "").strip()
                if "lavoro" in st.lower():
                    best_status = "Lavoro io"
                elif "riposo" in st.lower() and best_status == "Da confermare":
                    best_status = "Riposo"

            if best_earnings is not None and best_earnings > 0 and best_status == "Da confermare":
                best_status = "Lavoro io"

            k, d = g_key
            seed_ref = single_seed_map.get((k, d))

            if seed_ref:
                new_title = clean_display_title(seed_ref["title"])
                new_venue = seed_ref.get("venue") or primary.get("venue") or ""
                new_cat = (seed_ref.get("category") or primary.get("category") or "CALCIO").upper()
                new_start = seed_ref["event_start"]
                new_call = calculate_call_time(new_cat, new_start, seed_ref.get("call_time"))
                new_notes = seed_ref.get("notes") or primary.get("notes") or ""
            else:
                new_title = clean_display_title(primary.get("title") or "")
                new_venue = primary.get("venue") or ""
                new_cat = (primary.get("category") or "CUSTOM").upper()
                new_start = primary["event_start"]
                new_call = calculate_call_time(new_cat, new_start, primary.get("call_time"))
                new_notes = primary.get("notes") or ""

            if (
                primary.get("title") != new_title
                or primary.get("event_start") != new_start
                or primary.get("call_time") != new_call
                or primary.get("status") != best_status
                or primary.get("earnings") != best_earnings
                or primary.get("updated_flag") != 0
            ):
                cursor.execute(
                    """
                    UPDATE events
                    SET title = ?, venue = ?, category = ?, event_start = ?, call_time = ?,
                        status = ?, updated_flag = 0, notes = ?, earnings = ?
                    WHERE id = ?
                    """,
                    (new_title, new_venue, new_cat, new_start, new_call, best_status, new_notes, best_earnings, primary["id"]),
                )
                fixed_count += 1

        if ids_to_delete:
            placeholders = ",".join("?" for _ in ids_to_delete)
            cursor.execute(f"DELETE FROM events WHERE id IN ({placeholders})", ids_to_delete)

        conn.commit()
        return fixed_count
    finally:
        conn.close()




def _is_user_owned(row: Dict[str, Any]) -> bool:
    """True se l'utente ha già interagito con l'evento (stato, compenso o inserimento vocale/manuale)."""
    status = (row.get("status") or "").strip()
    notes = row.get("notes") or ""
    return (
        (status and status != "Da confermare")
        or row.get("earnings") is not None
        or "J.A.R.V.I.S." in notes
    )


def reconcile_venue_events(
    venue: str,
    official_events: List[Dict[str, Any]],
    since: str,
    flag_changes: bool = True,
) -> Dict[str, Any]:
    """
    Allinea il DB al calendario ufficiale di UNA sede a partire da `since` (YYYY-MM-DD...).

    1. Abbina gli eventi per (titolo normalizzato, data) esatti.
    2. Abbina i rimanenti con stesso titolo entro RESCHEDULE_WINDOW_DAYS (rinvii/anticipi).
    3. Inserisce gli eventi ufficiali non presenti nel DB.
    4. Elimina gli eventi della sede che NON esistono nel calendario ufficiale
       (es. partite inventate o di stagioni passate). Gli eventi su cui l'utente ha
       già agito (stato/compenso/inserimento vocale) NON vengono mai eliminati:
       sono restituiti in `orphans` per verifica manuale.
    """
    init_db()
    conn = get_db_connection()
    report: Dict[str, Any] = {"venue": venue, "updated": [], "inserted": [], "deleted": [], "orphans": []}
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM events WHERE venue = ? AND event_start >= ? ORDER BY event_start ASC, id ASC",
            (venue, since[:10]),
        )
        rows = [dict(r) for r in cur.fetchall()]
        for r in rows:
            r["_key"] = normalize_event_key(r["title"])

        official = []
        for ev in official_events:
            if (ev.get("event_start") or "")[:10] < since[:10]:
                continue
            e = dict(ev)
            e["title"] = clean_display_title(e.get("title") or "")
            e["_key"] = normalize_event_key(e["title"])
            official.append(e)
        official.sort(key=lambda e: e["event_start"])

        matched_rows: set = set()
        pairs: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
        unmatched: List[Dict[str, Any]] = []

        # Pass 1: (titolo, data) esatti
        for ev in official:
            hit = next(
                (r for r in rows if r["id"] not in matched_rows and r["_key"] == ev["_key"]
                 and r["event_start"][:10] == ev["event_start"][:10]),
                None,
            )
            if hit:
                matched_rows.add(hit["id"])
                pairs.append((ev, hit))
            else:
                unmatched.append(ev)

        # Pass 2: stesso titolo, data vicina (rinvio/anticipo)
        still_unmatched = []
        for ev in unmatched:
            best, best_delta = None, None
            if ev["_key"] not in MULTI_DATE_SHOW_KEYS:
                for r in rows:
                    if r["id"] in matched_rows or r["_key"] != ev["_key"]:
                        continue
                    delta = _days_between(r["event_start"], ev["event_start"])
                    if delta is not None and delta <= RESCHEDULE_WINDOW_DAYS and (best_delta is None or delta < best_delta):
                        best, best_delta = r, delta
            if best:
                matched_rows.add(best["id"])
                pairs.append((ev, best))
            else:
                still_unmatched.append(ev)

        # Pass 3 (solo CALCIO): stesso stadio e stesso giorno = stessa partita con nome
        # avversario corretto (in uno stadio si gioca al massimo una partita al giorno).
        remaining = []
        for ev in still_unmatched:
            hit = None
            if (ev.get("category") or "").upper() == "CALCIO":
                hit = next(
                    (r for r in rows if r["id"] not in matched_rows
                     and (r.get("category") or "").upper() == "CALCIO"
                     and r["event_start"][:10] == ev["event_start"][:10]),
                    None,
                )
            if hit:
                matched_rows.add(hit["id"])
                pairs.append((ev, hit))
            else:
                remaining.append(ev)
        still_unmatched = remaining

        # Aggiornamento eventi abbinati (preserva stato e compensi dell'utente)
        for ev, r in pairs:
            category = (ev.get("category") or r.get("category") or "").upper()
            new_start = ev["event_start"]
            new_call = calculate_call_time(category, new_start, ev.get("call_time"))
            changed_time = r["event_start"] != new_start
            new_flag = 1 if (flag_changes and changed_time) else (r.get("updated_flag") or 0)
            new_notes = ev.get("notes") or r.get("notes") or ""
            if (r["title"] != ev["title"] or changed_time or r["call_time"] != new_call
                    or (r.get("notes") or "") != new_notes or (r.get("updated_flag") or 0) != new_flag):
                cur.execute(
                    "UPDATE events SET title=?, category=?, event_start=?, call_time=?, notes=?, updated_flag=? WHERE id=?",
                    (ev["title"], category, new_start, new_call, new_notes, new_flag, r["id"]),
                )
                if normalize_event_key(r["title"]) != ev["_key"] or changed_time:
                    report["updated"].append(f"{r['event_start']} {r['title']} -> {new_start} {ev['title']}")

        # Inserimento eventi ufficiali mancanti
        for ev in still_unmatched:
            category = (ev.get("category") or "").upper()
            call = calculate_call_time(category, ev["event_start"], ev.get("call_time"))
            cur.execute(
                "INSERT INTO events (title, venue, category, event_start, call_time, status, updated_flag, notes, earnings) "
                "VALUES (?, ?, ?, ?, ?, 'Da confermare', 0, ?, NULL)",
                (ev["title"], venue, category, ev["event_start"], call, ev.get("notes") or ""),
            )
            report["inserted"].append(f"{ev['event_start']} {ev['title']}")

        # Rimozione eventi inesistenti nel calendario ufficiale.
        # Solo nell'intervallo effettivamente coperto dalla fonte [since, ultimo evento ufficiale]:
        # se la fonte restituisce un orizzonte parziale, gli eventi oltre non vengono toccati.
        horizon = max((e["event_start"][:10] for e in official), default=None)
        for r in rows:
            if r["id"] in matched_rows:
                continue
            if horizon is None or r["event_start"][:10] > horizon:
                continue
            label = f"[id {r['id']}] {r['event_start']} {r['title']} ({r.get('status')})"
            if _is_user_owned(r):
                report["orphans"].append(label)
            else:
                cur.execute("DELETE FROM events WHERE id = ?", (r["id"],))
                report["deleted"].append(label)

        conn.commit()
        return report
    finally:
        conn.close()
