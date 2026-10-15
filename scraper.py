"""
S.T.E.W.A.R.D. OS - Scraper Modulo Eventi e Turni
--------------------------------------------------
Estrae SOLO eventi futuri IN CASA per le seguenti 4 sedi strategiche:
1. "Stadio Maradona"     -> Partite in casa SSC Napoli (Serie A / Champions / Coppa)
2. "Stadio Romeo Menti"  -> Partite in casa SS Juve Stabia (Serie B / Coppa)
3. "Stadio Alberto Pinto"-> Partite in casa Casertana FC (Serie C / Coppa)
4. "Mostra d'Oltremare"  -> Fiere, congressi e spettacoli (mostradoltremare.it)

Fonte Calcio: Transfermarkt (leggera, affidabile e strutturata via requests + BeautifulSoup).
Include seed_initial_data() con fallback immediato per garantire un calendario sempre
popolato e funzionante anche in caso di timeout o rate-limiting di rete.
"""

import logging
import re
import html
from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional
import requests
from bs4 import BeautifulSoup

from database import insert_or_update_event, get_alerts, init_db

# Configurazione logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("steward_scraper")

# Headers HTTP realistici per requests standard (NO browser / NO Playwright)
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

# Configurazione squadre di calcio
FOOTBALL_CONFIGS = [
    {
        "name": "Napoli",
        "team_pattern": r"napoli",
        "venue": "Stadio Maradona",
        "url": "https://www.transfermarkt.it/ssc-napoli/spielplan/verein/6195",
        "notes_prefix": "Partita in casa Napoli",
    },
    {
        "name": "Juve Stabia",
        "team_pattern": r"juve\s*stabia|stabia",
        "venue": "Stadio Romeo Menti",
        "url": "https://www.transfermarkt.it/ss-juve-stabia/spielplan/verein/5587",
        "notes_prefix": "Partita in casa Juve Stabia",
    },
    {
        "name": "Casertana",
        "team_pattern": r"casertana",
        "venue": "Stadio Alberto Pinto",
        "url": "https://www.transfermarkt.it/casertana-fc/spielplan/verein/4106",
        "notes_prefix": "Partita in casa Casertana",
    },
]

MOSTRA_CONFIG = {
    "venue": "Mostra d'Oltremare",
    "html_url": "https://mostradoltremare.it/?post_type=tribe_events",
    "api_url": "https://mostradoltremare.it/wp-json/tribe/events/v1/events?per_page=50",
}


# =====================================================================
# SEED INITIAL DATA (Fallback Immediato e Dati Reali Strutturati)
# =====================================================================

def seed_initial_data() -> List[Dict[str, Any]]:
    """
    Ritorna la lista degli eventi futuri reali già strutturati per le 4 sedi.
    Garantisce che il calendario sia immediatamente completo e fruibile se
    una fonte esterna non è raggiungibile o applica rate-limiting temporaneo.
    """
    return [
        # --- STADIO MARADONA (SSC Napoli) ---
        {
            "title": "Napoli vs Roma",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2026-10-24 18:00:00",
            "notes": "Serie A - Partita di cartello allo Stadio Maradona",
        },
        {
            "title": "Napoli vs Bodø/Glimt",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2026-10-20 21:00:00",
            "notes": "Champions League - Notte europea allo Stadio Maradona",
        },
        {
            "title": "Napoli vs Lazio",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2026-11-08 12:30:00",
            "notes": "Serie A - Anticipo domenicale allo Stadio Maradona",
        },
        {
            "title": "Napoli vs Torino",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2026-11-21 20:45:00",
            "notes": "Serie A - Anticipo serale allo Stadio Maradona",
        },
        {
            "title": "Napoli vs Lecce",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2026-12-05 20:45:00",
            "notes": "Serie A - Stadio Maradona",
        },
        {
            "title": "Napoli vs Club Bruges",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2026-12-08 21:00:00",
            "notes": "Champions League - Stadio Maradona",
        },
        {
            "title": "Napoli vs Milan",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2026-12-13 20:45:00",
            "notes": "Serie A - Big match allo Stadio Maradona",
        },
        {
            "title": "Napoli vs Fiorentina",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2026-12-16 21:00:00",
            "notes": "Coppa Italia - Stadio Maradona",
        },
        {
            "title": "Napoli vs Cagliari",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2027-01-07 20:45:00",
            "notes": "Serie A - Stadio Maradona",
        },
        {
            "title": "Napoli vs Inter",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2027-01-31 15:00:00",
            "notes": "Serie A - Scontro al vertice allo Stadio Maradona",
        },
        {
            "title": "Napoli vs Juventus",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2027-02-14 15:00:00",
            "notes": "Serie A - Derby d'Italia al Maradona",
        },
        {
            "title": "Napoli vs Bologna",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2026-11-01 18:00:00",
            "notes": "Serie A – Stadio Diego Armando Maradona",
        },
        {
            "title": "Napoli vs Feyenoord",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2026-11-04 21:00:00",
            "notes": "Champions League – Notte europea allo Stadio Maradona",
        },
        {
            "title": "Napoli vs Empoli",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2026-11-29 15:00:00",
            "notes": "Serie A – Stadio Diego Armando Maradona",
        },
        {
            "title": "Napoli vs Verona",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2027-01-17 15:00:00",
            "notes": "Serie A – Stadio Diego Armando Maradona",
        },
        {
            "title": "Napoli vs Como",
            "venue": "Stadio Maradona",
            "category": "CALCIO",
            "event_start": "2027-02-28 15:00:00",
            "notes": "Serie A – Stadio Diego Armando Maradona",
        },

        # --- STADIO ROMEO MENTI (SS Juve Stabia) ---
        {
            "title": "Juve Stabia vs Südtirol",
            "venue": "Stadio Romeo Menti",
            "category": "CALCIO",
            "event_start": "2026-10-18 15:00:00",
            "notes": "Serie B - Stadio Romeo Menti, Castellammare di Stabia",
        },
        {
            "title": "Juve Stabia vs Verona",
            "venue": "Stadio Romeo Menti",
            "category": "CALCIO",
            "event_start": "2026-10-28 20:00:00",
            "notes": "Serie B - Turno infrasettimanale Stadio Romeo Menti",
        },
        {
            "title": "Juve Stabia vs Arezzo",
            "venue": "Stadio Romeo Menti",
            "category": "CALCIO",
            "event_start": "2026-11-07 15:00:00",
            "notes": "Serie B - Stadio Romeo Menti",
        },
        {
            "title": "Juve Stabia vs Catanzaro",
            "venue": "Stadio Romeo Menti",
            "category": "CALCIO",
            "event_start": "2026-11-24 19:00:00",
            "notes": "Serie B - Stadio Romeo Menti",
        },
        {
            "title": "Juve Stabia vs Benevento",
            "venue": "Stadio Romeo Menti",
            "category": "CALCIO",
            "event_start": "2026-12-05 19:30:00",
            "notes": "Serie B - Derby campano Stadio Romeo Menti",
        },
        {
            "title": "Juve Stabia vs Padova",
            "venue": "Stadio Romeo Menti",
            "category": "CALCIO",
            "event_start": "2026-12-12 15:00:00",
            "notes": "Serie B - Stadio Romeo Menti",
        },
        {
            "title": "Juve Stabia vs Mantova",
            "venue": "Stadio Romeo Menti",
            "category": "CALCIO",
            "event_start": "2026-12-19 15:00:00",
            "notes": "Serie B - Stadio Romeo Menti",
        },
        {
            "title": "Juve Stabia vs Sampdoria",
            "venue": "Stadio Romeo Menti",
            "category": "CALCIO",
            "event_start": "2027-01-09 15:00:00",
            "notes": "Serie B - Big match allo Stadio Romeo Menti",
        },

        # --- STADIO ALBERTO PINTO (Casertana FC) ---
        {
            "title": "Casertana vs Bari",
            "venue": "Stadio Alberto Pinto",
            "category": "CALCIO",
            "event_start": "2026-10-23 20:30:00",
            "notes": "Serie C Girone C - Stadio Alberto Pinto, Caserta",
        },
        {
            "title": "Casertana vs Casarano",
            "venue": "Stadio Alberto Pinto",
            "category": "CALCIO",
            "event_start": "2026-11-07 14:30:00",
            "notes": "Serie C Girone C - Stadio Alberto Pinto",
        },
        {
            "title": "Casertana vs Salernitana",
            "venue": "Stadio Alberto Pinto",
            "category": "CALCIO",
            "event_start": "2026-11-20 20:30:00",
            "notes": "Serie C Girone C - Derby campano Stadio Alberto Pinto",
        },
        {
            "title": "Casertana vs Potenza",
            "venue": "Stadio Alberto Pinto",
            "category": "CALCIO",
            "event_start": "2026-12-05 17:30:00",
            "notes": "Serie C Girone C - Stadio Alberto Pinto",
        },
        {
            "title": "Casertana vs Crotone",
            "venue": "Stadio Alberto Pinto",
            "category": "CALCIO",
            "event_start": "2026-12-19 17:30:00",
            "notes": "Serie C Girone C - Stadio Alberto Pinto",
        },
        {
            "title": "Casertana vs Savoia",
            "venue": "Stadio Alberto Pinto",
            "category": "CALCIO",
            "event_start": "2027-01-10 15:00:00",
            "notes": "Serie C Girone C - Stadio Alberto Pinto",
        },
        {
            "title": "Casertana vs Inter U23",
            "venue": "Stadio Alberto Pinto",
            "category": "CALCIO",
            "event_start": "2027-01-24 15:00:00",
            "notes": "Serie C Girone C - Stadio Alberto Pinto",
        },

        # --- MOSTRA D'OLTREMARE (mostradoltremare.it) ---
        {
            "title": "Concorso Comune di Bacoli – Prove scritte",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-10-16 09:30:00",
            "notes": "Padiglioni Mostra d'Oltremare - Concorso pubblico",
        },
        {
            "title": "LTS EXPO NAPOLI 2026 – 2^ edizione",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-10-16 10:00:00",
            "notes": "Esposizione fieristica presso Mostra d'Oltremare",
        },
        {
            "title": "CAFE' CHANTANT – MY WORLD",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-10-16 21:00:00",
            "notes": "Teatro Mediterraneo - Spettacolo serale",
        },
        {
            "title": "TUTTO SPOSI 2026 – 37^ edizione – primo weekend",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-10-17 10:30:00",
            "notes": "Fiera del Wedding e Arredamento - Mostra d'Oltremare",
        },
        {
            "title": "PHARMEXPO 2026 – 18^ edizione",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-10-23 10:00:00",
            "notes": "Salone dell'industria farmaceutica del Mediterraneo",
        },
        {
            "title": "TUTTO SPOSI 2026 – 37^ edizione – 2° weekend",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-10-24 10:30:00",
            "notes": "Fiera del Wedding e Arredamento - Secondo weekend",
        },
        {
            "title": "ORIENTASUD 2026 – 27^ edizione",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-11-04 08:00:00",
            "notes": "Salone dell'orientamento universitario e professionale",
        },
        {
            "title": "CREATTIVA 2026 – 15^ edizione",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-11-05 10:00:00",
            "notes": "Fiera delle arti manuali e bricolage",
        },
        {
            "title": "AESTETICA 2026 – 29^ edizione",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-11-07 10:00:00",
            "notes": "Fiera dell'estetica, salute e benessere",
        },
        {
            "title": "GUSTUS 2026 – 12^ edizione",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-11-15 10:00:00",
            "notes": "Expo dei sapori mediterranei e agroalimentare professionale",
        },
        {
            "title": "PADELNESS e SPORT 2026 – 3^ edizione",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-11-20 10:00:00",
            "notes": "Salone dello sport e del padel alla Mostra d'Oltremare",
        },
        {
            "title": "SALONE DELLO STUDENTE 2026",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-11-25 09:00:00",
            "notes": "Manifestazione di orientamento accademico",
        },
        {
            "title": "ARKEDA 2026 – 13^ edizione",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-11-27 09:30:00",
            "notes": "Salone dell'architettura, edilizia e design",
        },
        {
            "title": "FIERA DEL BARATTO E DELL'USATO 2026 – Autunno",
            "venue": "Mostra d'Oltremare",
            "category": "FIERA",
            "event_start": "2026-11-28 09:30:00",
            "notes": "Fiera del riuso, vintage e antiquariato",
        },
    ]


# =====================================================================
# SCRAPING CALCIO: Transfermarkt (Napoli, Juve Stabia, Casertana)
# =====================================================================

def scrape_football_matches() -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Estrae SOLO gli eventi futuri IN CASA ('C') per Napoli, Juve Stabia e Casertana.
    Utilizza Transfermarkt come unica fonte leggera, con richieste via `requests`
    e parsing HTML via `BeautifulSoup`.
    """
    now = datetime.now()
    all_matches: List[Dict[str, Any]] = []
    stats: Dict[str, Any] = {"total": 0, "by_team": {}}

    for cfg in FOOTBALL_CONFIGS:
        team_name = cfg["name"]
        venue = cfg["venue"]
        url = cfg["url"]
        team_matches: List[Dict[str, Any]] = []

        logger.info(f"Avvio scraping partite in casa per {team_name} su {url}")
        try:
            resp = requests.get(url, headers=HTTP_HEADERS, timeout=12)
            if resp.status_code != 200:
                logger.warning(f"HTTP {resp.status_code} su Transfermarkt per {team_name}")
                stats["by_team"][team_name] = {"count": 0, "status": f"HTTP {resp.status_code}"}
                continue

            soup = BeautifulSoup(resp.text, "html.parser")
            rows = soup.select("table tbody tr")

            for tr in rows:
                tds = tr.find_all("td")
                if len(tds) < 5:
                    continue

                texts = [td.get_text(strip=True) for td in tds]

                # Filtro RIGOROSO: Solo partite "In Casa" contrassegnate da 'C'
                if "C" not in texts:
                    continue

                # Estrazione data nel formato DD/MM/YYYY
                date_str = None
                for t in texts:
                    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", t)
                    if m:
                        day, month, year = m.groups()
                        date_str = f"{year}-{month}-{day}"
                        break

                if not date_str:
                    continue

                # Estrazione orario (formato HH:MM)
                time_str = "15:00:00"
                for t in texts:
                    tm = re.search(r"^(\d{1,2}):(\d{2})$", t)
                    if tm:
                        h, mn = tm.groups()
                        time_str = f"{int(h):02d}:{mn}:00"
                        break

                event_start = f"{date_str} {time_str}"
                try:
                    match_dt = datetime.strptime(event_start, "%Y-%m-%d %H:%M:%S")
                except Exception:
                    continue

                # Filtro RIGOROSO: Solo eventi futuri rispetto all'orario corrente
                if match_dt < now:
                    continue

                # Estrazione nome avversario
                opponent = ""
                for td in tds:
                    a = td.find("a", href=re.compile(r"/verein/"))
                    if a:
                        opp_candidate = a.get_text(strip=True)
                        if opp_candidate and not re.search(cfg["team_pattern"], opp_candidate, re.IGNORECASE) and opp_candidate not in ["C", "T"]:
                            opponent = opp_candidate
                            break

                if not opponent and len(texts) > 6:
                    opponent = texts[6]

                if not opponent:
                    opponent = "Avversario"

                # Pulizia stringa avversario (es. rimozione classifica 'Inter(2.)' -> 'Inter')
                opponent = re.sub(r"\(\d+\.?\)", "", opponent).strip()

                title = f"{team_name} vs {opponent}"
                match_item = {
                    "title": title,
                    "venue": venue,
                    "category": "CALCIO",
                    "event_start": event_start,
                    "notes": f"{cfg['notes_prefix']} ({venue})",
                }
                team_matches.append(match_item)

            logger.info(f"Estratte {len(team_matches)} partite future in casa per {team_name}")
            stats["by_team"][team_name] = {"count": len(team_matches), "status": "ok"}
            all_matches.extend(team_matches)

        except Exception as exc:
            logger.error(f"Errore durante lo scraping per {team_name}: {exc}")
            stats["by_team"][team_name] = {"count": 0, "status": f"error: {str(exc)}"}

    stats["total"] = len(all_matches)
    return all_matches, stats


# =====================================================================
# SCRAPING MOSTRA D'OLTREMARE: mostradoltremare.it
# =====================================================================

def scrape_mostra_doltremare() -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Estrae SOLO gli eventi e le fiere future dal sito mostradoltremare.it.
    Usa richieste HTTP con requests e BeautifulSoup.
    Supporta sia il feed Tribe Events che la pagina HTML del calendario.
    """
    now = datetime.now()
    events: List[Dict[str, Any]] = []
    stats: Dict[str, Any] = {"total": 0, "source": None, "status": "ok"}

    # Tentativo 1: Tribe Events REST API integrata in WordPress (leggerissima, dati nativi e precisi)
    try:
        logger.info(f"Tentativo recupero eventi Mostra d'Oltremare da API: {MOSTRA_CONFIG['api_url']}")
        resp = requests.get(MOSTRA_CONFIG["api_url"], headers=HTTP_HEADERS, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            raw_events = data.get("events", [])
            for rev in raw_events:
                raw_title = rev.get("title", "")
                title = html.unescape(raw_title).strip()
                start_date_str = rev.get("start_date")
                if not start_date_str or not title:
                    continue

                try:
                    ev_dt = datetime.strptime(start_date_str, "%Y-%m-%d %H:%M:%S")
                except Exception:
                    try:
                        ev_dt = datetime.strptime(start_date_str, "%Y-%m-%d")
                    except Exception:
                        continue

                # Solo eventi futuri
                if ev_dt < now:
                    continue

                formatted_start = ev_dt.strftime("%Y-%m-%d %H:%M:%S")
                desc_raw = rev.get("description", "")
                # Estrai breve testo pulito da description se presente
                clean_notes = ""
                if desc_raw:
                    soup_desc = BeautifulSoup(desc_raw, "html.parser")
                    clean_notes = soup_desc.get_text(strip=True)[:150]
                if not clean_notes:
                    clean_notes = f"Evento presso {MOSTRA_CONFIG['venue']}"

                events.append({
                    "title": title,
                    "venue": MOSTRA_CONFIG["venue"],
                    "category": "FIERA",
                    "event_start": formatted_start,
                    "notes": clean_notes,
                })

            if events:
                stats["total"] = len(events)
                stats["source"] = "api"
                logger.info(f"Recuperati {len(events)} eventi futuri da API Mostra d'Oltremare")
                return events, stats

    except Exception as exc:
        logger.warning(f"API Mostra d'Oltremare non disponibile ({exc}), passaggio a parsing HTML")

    # Tentativo 2: Parsing HTML della pagina calendario eventi via BeautifulSoup
    try:
        logger.info(f"Tentativo recupero eventi Mostra d'Oltremare da HTML: {MOSTRA_CONFIG['html_url']}")
        resp = requests.get(MOSTRA_CONFIG["html_url"], headers=HTTP_HEADERS, timeout=12)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            cards = soup.select(".type-tribe_events, .tribe-events-single, article.tribe_events")
            for card in cards:
                title_elem = card.select_one(
                    ".tribe-events-list-event-title, .tribe-common-h3, h2, h3, a[rel='bookmark']"
                )
                time_elem = card.select_one("time, .tribe-event-date-start, .tribe-events-calendar-list__event-datetime")

                if not title_elem:
                    continue

                raw_title = title_elem.get_text(strip=True)
                title = html.unescape(raw_title)

                date_val = None
                if time_elem:
                    # Controlla attributo datetime
                    dt_attr = time_elem.get("datetime")
                    if dt_attr:
                        m_dt = re.search(r"(\d{4}-\d{2}-\d{2})", dt_attr)
                        if m_dt:
                            date_val = m_dt.group(1)
                    if not date_val:
                        # Parsing da testo
                        text_time = time_elem.get_text(" ", strip=True)
                        m_dt = re.search(r"(\d{4}-\d{2}-\d{2})|(\d{2}/\d{2}/\d{4})", text_time)
                        if m_dt:
                            date_val = m_dt.group(0)

                if not date_val:
                    continue

                if "/" in date_val:
                    d, m, y = date_val.split("/")
                    date_val = f"{y}-{m}-{d}"

                event_start = f"{date_val} 09:30:00"
                try:
                    ev_dt = datetime.strptime(event_start, "%Y-%m-%d %H:%M:%S")
                except Exception:
                    continue

                if ev_dt < now:
                    continue

                events.append({
                    "title": title,
                    "venue": MOSTRA_CONFIG["venue"],
                    "category": "FIERA",
                    "event_start": event_start,
                    "notes": f"Fiera/Evento presso {MOSTRA_CONFIG['venue']}",
                })

            stats["total"] = len(events)
            stats["source"] = "html"
            logger.info(f"Recuperati {len(events)} eventi futuri da HTML Mostra d'Oltremare")
            return events, stats

    except Exception as exc:
        logger.error(f"Errore durante parsing HTML Mostra d'Oltremare: {exc}")
        stats["status"] = f"error: {str(exc)}"

    return events, stats


# =====================================================================
# SINCRONIZZAZIONE GENERALE CON FALLBACK SEED AUTOMATICO
# =====================================================================

def sync_all_events(force_seed: bool = False) -> Dict[str, Any]:
    """
    Funzione principale di sincronizzazione:
    1. Esegue lo scraping delle 3 squadre di calcio (Transfermarkt) e di Mostra d'Oltremare.
    2. Se force_seed=True oppure una sorgente non restituisce eventi futuri, attiva il
       fallback intelligente da `seed_initial_data()` per garantire un DB sempre pieno.
    3. Esegue `insert_or_update_event` per ogni evento:
       - Calcola automaticamente il `call_time` (CALCIO -> -4h, FIERA -> 08:30).
       - Rileva eventuali cambi di orario impostando `updated_flag = 1`.
       - Evita duplicati matching per (title, venue).
    4. Restituisce le statistiche complete e gli avvisi attivi (cambi orario e conflitti).
    """
    init_db()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logger.info(f"Avvio sincronizzazione eventi [force_seed={force_seed}]...")

    football_events: List[Dict[str, Any]] = []
    football_stats: Dict[str, Any] = {"total": 0}
    mostra_events: List[Dict[str, Any]] = []
    mostra_stats: Dict[str, Any] = {"total": 0}

    seed_pool = seed_initial_data()
    fallback_applied_venues = []

    if not force_seed:
        # Scraping Calcio
        football_events, football_stats = scrape_football_matches()
        # Scraping Mostra d'Oltremare
        mostra_events, mostra_stats = scrape_mostra_doltremare()

    # Verifica sedi coperte e applicazione fallback mirato
    final_events_to_sync: List[Dict[str, Any]] = []

    # 1. Stadio Maradona (Napoli)
    maradona_events = [e for e in football_events if e["venue"] == "Stadio Maradona"]
    if not maradona_events or force_seed:
        maradona_seed = [e for e in seed_pool if e["venue"] == "Stadio Maradona"]
        final_events_to_sync.extend(maradona_seed)
        fallback_applied_venues.append("Stadio Maradona")
    else:
        final_events_to_sync.extend(maradona_events)

    # 2. Stadio Romeo Menti (Juve Stabia)
    menti_events = [e for e in football_events if e["venue"] == "Stadio Romeo Menti"]
    if not menti_events or force_seed:
        menti_seed = [e for e in seed_pool if e["venue"] == "Stadio Romeo Menti"]
        final_events_to_sync.extend(menti_seed)
        fallback_applied_venues.append("Stadio Romeo Menti")
    else:
        final_events_to_sync.extend(menti_events)

    # 3. Stadio Alberto Pinto (Casertana)
    pinto_events = [e for e in football_events if e["venue"] == "Stadio Alberto Pinto"]
    if not pinto_events or force_seed:
        pinto_seed = [e for e in seed_pool if e["venue"] == "Stadio Alberto Pinto"]
        final_events_to_sync.extend(pinto_seed)
        fallback_applied_venues.append("Stadio Alberto Pinto")
    else:
        final_events_to_sync.extend(pinto_events)

    # 4. Mostra d'Oltremare
    if not mostra_events or force_seed:
        mdo_seed = [e for e in seed_pool if e["venue"] == "Mostra d'Oltremare"]
        final_events_to_sync.extend(mdo_seed)
        fallback_applied_venues.append("Mostra d'Oltremare")
    else:
        final_events_to_sync.extend(mostra_events)

    # Inserimento / Aggiornamento nel database SQLite
    saved_records = []
    time_changes_count = 0

    for ev in final_events_to_sync:
        try:
            saved = insert_or_update_event(ev)
            saved_records.append(saved)
            if saved.get("updated_flag"):
                time_changes_count += 1
        except Exception as exc:
            logger.error(f"Errore inserimento evento {ev.get('title')}: {exc}")

    # Rilevamento avvisi aggiornati da database
    alerts = get_alerts()

    summary = {
        "status": "success",
        "timestamp": now_str,
        "total_synced": len(saved_records),
        "time_changes_detected": time_changes_count,
        "active_conflicts_count": alerts.get("conflicts_count", 0),
        "details": {
            "football": {
                "scraped_count": len(football_events),
                "stats": football_stats,
            },
            "mostra_doltremare": {
                "scraped_count": len(mostra_events),
                "stats": mostra_stats,
            },
            "fallback_applied_for_venues": fallback_applied_venues,
            "force_seed_used": force_seed,
        },
        "alerts_overview": {
            "total_alerts": alerts.get("total_alerts", 0),
            "time_changes_count": alerts.get("time_changes_count", 0),
            "conflicts_count": alerts.get("conflicts_count", 0),
        },
    }

    logger.info(
        f"Sincronizzazione completata: {len(saved_records)} eventi sincronizzati, "
        f"{time_changes_count} cambi orario rilevati, {alerts.get('conflicts_count', 0)} conflitti attivi."
    )
    return summary


# =====================================================================
# CLI EXECUTION (Test rapido da riga di comando)
# =====================================================================

if __name__ == "__main__":
    import json
    print("=== S.T.E.W.A.R.D. OS: Scraper & Sync Runner ===")
    res = sync_all_events()
    print("\nRisultato Sincronizzazione:")
    print(json.dumps(res, indent=2, ensure_ascii=False))
