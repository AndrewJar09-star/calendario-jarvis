import sqlite3
from datetime import datetime, timedelta, time
from typing import Optional, List, Dict, Any, Tuple
from pathlib import Path

DB_PATH = Path(__file__).parent / "steward.db"


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


def get_all_events_with_conflicts() -> List[Dict[str, Any]]:
    """Recupera tutti gli eventi dal DB arricchiti con il flag conflict e updated_flag."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM events ORDER BY event_start ASC")
        rows = [dict(r) for r in cursor.fetchall()]

        # Raggruppa per data per calcolare conflict
        events_by_date: Dict[str, List[int]] = {}
        for r in rows:
            try:
                d_str = parse_datetime(r["event_start"]).strftime("%Y-%m-%d")
            except Exception:
                d_str = "unknown"
            events_by_date.setdefault(d_str, []).append(r["id"])

        results = []
        for r in rows:
            try:
                d_str = parse_datetime(r["event_start"]).strftime("%Y-%m-%d")
            except Exception:
                d_str = "unknown"
            same_day_ids = events_by_date.get(d_str, [])
            is_conflict = len(same_day_ids) > 1
            conflicting_ids = [eid for eid in same_day_ids if eid != r["id"]]
            
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
    - conflitti: date e coppie di eventi che cadono nello stesso giorno
    """
    events = get_all_events_with_conflicts()
    time_changes = [e for e in events if e.get("updated_flag")]
    
    # Raggruppa conflitti per data
    conflicts_by_date: Dict[str, List[Dict[str, Any]]] = {}
    for e in events:
        if e.get("conflict"):
            try:
                d_str = parse_datetime(e["event_start"]).strftime("%Y-%m-%d")
            except Exception:
                d_str = "unknown"
            conflicts_by_date.setdefault(d_str, []).append(e)

    conflicts_list = [
        {"date": d, "count": len(evs), "events": evs}
        for d, evs in conflicts_by_date.items()
    ]

    return {
        "total_alerts": len(time_changes) + len(conflicts_list),
        "time_changes_count": len(time_changes),
        "conflicts_count": len(conflicts_list),
        "time_changes": time_changes,
        "conflicts": conflicts_list
    }


def insert_or_update_event(event_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Inserisce o aggiorna un evento applicando:
    - Calcolo automatico call_time (CALCIO -> -4h, FIERA -> 08:30)
    - Rilevazione cambio orario rispetto al DB (updated_flag)
    """
    init_db()
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        event_id = event_data.get("id")
        title = event_data.get("title")
        venue = event_data.get("venue", "")
        category = event_data.get("category", "").upper()
        event_start = event_data.get("event_start")
        notes = event_data.get("notes", "")
        status = event_data.get("status", "Da confermare")
        earnings = event_data.get("earnings")

        # Calcolo call_time
        call_time = calculate_call_time(category, event_start, event_data.get("call_time"))

        updated_flag = 0
        existing = None

        if event_id:
            cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
            existing = cursor.fetchone()
        elif category == "CALCIO" and title and venue:
            cursor.execute(
                "SELECT * FROM events WHERE title = ? AND venue = ? ORDER BY id DESC LIMIT 1",
                (title, venue)
            )
            existing = cursor.fetchone()
            if existing:
                event_id = existing["id"]
        elif title and venue and event_start:
            cursor.execute(
                "SELECT * FROM events WHERE title = ? AND venue = ? ORDER BY id DESC",
                (title, venue)
            )
            rows = cursor.fetchall()
            try:
                target_dt = parse_datetime(event_start)
                for r in rows:
                    try:
                        r_dt = parse_datetime(r["event_start"])
                        if abs((r_dt.date() - target_dt.date()).days) <= 3:
                            existing = r
                            event_id = r["id"]
                            break
                    except Exception:
                        continue
            except Exception:
                if rows:
                    existing = rows[0]
                    event_id = existing["id"]

        if existing:
            # Preserva lo stato utente se diverso dal default 'Da confermare'
            existing_dict = dict(existing)
            existing_status = existing_dict.get("status")
            final_status = existing_status if (existing_status and existing_status != "Da confermare") else status
            
            # Preserva compenso/guadagno esistente se non passato esplicitamente
            existing_earnings = existing_dict.get("earnings")
            final_earnings = earnings if earnings is not None else existing_earnings

            # Verifica se l'orario di inizio è cambiato rispetto al DB
            old_start = existing_dict["event_start"]
            try:
                if parse_datetime(old_start) != parse_datetime(event_start):
                    updated_flag = 1
                else:
                    updated_flag = existing_dict.get("updated_flag", 0)
            except Exception:
                if old_start != event_start:
                    updated_flag = 1
                else:
                    updated_flag = existing_dict.get("updated_flag", 0)

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


def update_event_status(event_id: int, status: str, earnings: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """Aggiorna lo stato di un evento (es. 'Lavoro io' o 'Riposo') e opzionalmente il compenso/guadagno."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if earnings is not None:
            cursor.execute("UPDATE events SET status = ?, earnings = ? WHERE id = ?", (status, earnings, event_id))
        else:
            cursor.execute("UPDATE events SET status = ? WHERE id = ?", (status, event_id))
        conn.commit()
        if cursor.rowcount == 0:
            return None
        cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def update_event_earnings(event_id: int, earnings: Optional[float]) -> Optional[Dict[str, Any]]:
    """Aggiorna il compenso/guadagno di un evento."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE events SET earnings = ? WHERE id = ?", (earnings, event_id))
        conn.commit()
        if cursor.rowcount == 0:
            return None
        cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
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

