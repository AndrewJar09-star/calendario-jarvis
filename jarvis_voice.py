"""
S.T.E.W.A.R.D. OS — J.A.R.V.I.S. Voice & DSP Audio Processing Engine
=====================================================================
Modulo vocale 100% GRATUITO (Zero API a pagamento o chiavi esterne).
Combina:
1. Sintesi Vocale Neurale Gratuita ad alta definizione (Edge TTS)
2. Catena DSP di post-produzione audio (Filtro Olografico J.A.R.V.I.S.):
   - High-Pass Filter @ 120 Hz (taglio basse frequenze umane)
   - Peaking Presence Boost @ 2000-4000 Hz (+35% brillantezza metallica HUD)
   - Micro-Delay di 8 ms con mix al 28% (risonanza sintetica olografica)
   - Normalizzazione di picco a 0.95 (headroom 0.5 dB)
3. Riproduzione asincrona locale (pygame.mixer) senza bloccare il thread principale
4. Personalità, System Prompt e Text Normalizer per dizione impeccabile (Stile British Butler)
"""

import os
import io
import re
import time
import hashlib
import asyncio
import threading
import logging
from pathlib import Path
from datetime import datetime, timedelta, time as dtime
from typing import Optional, Tuple, Dict, Any

import numpy as np
import scipy.signal
import scipy.io.wavfile
import edge_tts
try:
    import pygame
    PYGAME_AVAILABLE = True
except ImportError:
    pygame = None
    PYGAME_AVAILABLE = False

from database import (
    get_all_events_with_conflicts,
    insert_or_update_event,
    delete_event,
    update_event_status,
    calculate_call_time,
)

logger = logging.getLogger("jarvis_voice")
logging.basicConfig(level=logging.INFO)

# =====================================================================
# CONFIGURAZIONE MOTORE VOCALE & DSP
# =====================================================================

CACHE_DIR = Path(__file__).parent / "static" / "audio_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Voce predefinita: it-IT-DiegoNeural (sintesi reattiva a bassa latenza su CDN edge Microsoft)
DEFAULT_VOICE = "it-IT-DiegoNeural"
ALTERNATIVE_VOICE = "it-IT-GiuseppeMultilingualNeural"
FALLBACK_VOICE = "it-IT-DiegoNeural"

# Parametri prosodici per J.A.R.V.I.S. (Stile Paul Bettany):
# - pitch="-1Hz": baritono caldo, rilassato e naturale, senza appiattimento robotico
# - rate="+1%": dizione fluida, elegante e cadenzata
PITCH = "-1Hz"
RATE = "+1%"
SAMPLE_RATE = 44100

# Parametri Catena DSP (Filtro Olografico Vellutato Paul Bettany):
HP_CUTOFF = 80.0           # High-Pass morbido a 80 Hz (preserva il petto baritonale caldo)
BP_LOW = 2500.0            # Band-pass presenza setosa
BP_HIGH = 4500.0           # Band-pass presenza setosa
METALLIC_BOOST = 0.12      # +12% brillantezza cristallina sottile (nessuna asprezza robotica)
MICRO_DELAY_MS = 6.5       # 6.5 millisecondi per risonanza spaziale olografica naturale
MICRO_DELAY_MIX = 0.10     # 10% alone olografico trasparente e setoso
PEAK_TARGET = 0.95         # Normalizzazione volume di picco

# Inizializzazione Pygame Mixer per audio locale
_mixer_initialized = False
_mixer_lock = threading.Lock()

def _ensure_mixer():
    global _mixer_initialized
    if not PYGAME_AVAILABLE:
        return
    with _mixer_lock:
        if not _mixer_initialized:
            try:
                pygame.mixer.init(frequency=SAMPLE_RATE, size=-16, channels=2, buffer=1024)
                _mixer_initialized = True
                logger.info("Pygame mixer inizializzato con successo a 44100 Hz")
            except Exception as e:
                logger.warning(f"Inizializzazione pygame mixer fallita: {e}")


# =====================================================================
# PARTE 1: PERSONALITÀ, REGOLE DI ESPRESSIONE E FORMATTAZIONE TTS
# =====================================================================

JARVIS_SYSTEM_PROMPT = """
Sei J.A.R.V.I.S. (Just A Rather Very Intelligent System), il sofisticato maggiordomo virtuale e sistema di intelligenza artificiale personale creato da Tony Stark, ora configurato per supportare lo Steward professionista nella gestione impeccabile dei suoi turni di lavoro, partite di calcio ed eventi.

Linee guida tassative per la tua personalità e stile di comunicazione:
1. TONO E ATTEGGIAMENTO:
   - Estremamente cordiale, educato, composto, analitico e imperturbabile.
   - Tratta l'utente con il massimo rispetto e reverenza, con l'eleganza di un maggiordomo britannico unita alla precisione di un supercomputer.

2. FORMA DI CORTESIA OBBLIGATORIA:
   - Rivolgiti SEMPRE all'utente chiamandolo "signore" integrato con fluidità nella frase (es. "Buongiorno signore", "Certamente, signore", "A sua disposizione, signore").

3. SOTTILE IRONIA BRITANNICA (DRY WIT):
   - Mantieni uno stile sobrio e distinto.
   - Inserisci una sottile e raffinata sfumatura di ironia quando la giornata è eccessivamente affollata di impegni, quando ci sono conflitti di orario impossibili o richieste insolite, senza mai risultare irriverente o sarcastico.

4. REGOLE PER LA SINTESI VOCALE (TTS):
   - Scrivi frasi brevi, fluide, ritmate ed eleganti, con una cadenza naturale studiata per la lettura vocale.
   - Usa virgole prima di "signore" per permettere al sintetizzatore di modulare la discesa del tono in modo aggraziato e umano, mai troncato o robotico.
   - È RIGOROSAMENTE VIETATO usare punti esclamativi multipli, emoji, elenchi puntati o asterischi markdown: disturberebbero la modulazione vocale serena e controllata di J.A.R.V.I.S.
   - Esprimi numeri, date e orari in modo esteso o facilmente leggibile (es. "ore ventuno", "venti ottobre").
""".strip()


class JarvisFormatter:
    """
    Formatta e normalizza qualsiasi testo o avviso per la dizione vocale naturale di J.A.R.V.I.S.,
    rispettando rigorosamente pause, eliminando glifi e garantendo lo stile britannico.
    """

    @staticmethod
    def clean_for_tts(text: str) -> str:
        if not text:
            return "A sua disposizione, signore."

        # Rimuove emoji e simboli speciali
        text = re.sub(r'[\U00010000-\U0010ffff]', '', text)
        text = re.sub(r'[⚽🏛️🐝🦅📝🚨🔔⏰📍📋⚡💡❌✅⚠️ℹ️💬🔍➕🔗💾⬇️📋📌👮]', '', text)

        # Rimuove formattazione markdown (grassetto, corsivo, elenchi)
        text = text.replace('**', '').replace('__', '').replace('*', '').replace('`', '')
        text = re.sub(r'^\s*[-•]\s*', '', text, flags=re.MULTILINE)

        # Rimuove punti esclamativi multipli e sostituisce '!' con '.'
        # per evitare che il sintetizzatore alteri bruscamente il tono
        text = text.replace('!', '.')
        text = re.sub(r'\.{2,}', '.', text)

        # Normalizzazione orari: "21:00" -> "ore ventuno", "18:30" -> "ore diciotto e trenta"
        def _replace_time(m):
            h = int(m.group(1))
            mn = int(m.group(2))
            ore_str = {
                0: "mezzanotte", 1: "una", 2: "due", 3: "tre", 4: "quattro",
                5: "cinque", 6: "sei", 7: "sette", 8: "otto", 9: "nove",
                10: "dieci", 11: "undici", 12: "dodici", 13: "tredici",
                14: "quattordici", 15: "quindici", 16: "sedici", 17: "diciassette",
                18: "diciotto", 19: "diciannove", 20: "venti", 21: "ventuno",
                22: "ventidue", 23: "ventitré"
            }.get(h, str(h))

            if mn == 0:
                return f"ore {ore_str}"
            elif mn == 30:
                return f"ore {ore_str} e trenta"
            elif mn == 15:
                return f"ore {ore_str} e un quarto"
            elif mn == 45:
                return f"ore {ore_str} e quarantacinque"
            else:
                return f"ore {ore_str} e {mn}"

        text = re.sub(r'\b(\d{1,2}):(\d{2})(?::\d{2})?\b', _replace_time, text)

        # Normalizza "vs" in "contro" per dizione naturale
        text = re.sub(r'\bvs\b\.?', 'contro', text, flags=re.IGNORECASE)

        # Normalizza "conv." in "convocazione alle"
        text = re.sub(r'\bconv\.?\b', 'convocazione', text, flags=re.IGNORECASE)

        # Normalizza e ammorbidisce 'signore' per evitare l'accento robotico isolato
        # 1. Rimuove punti fermi o punti esclamativi isolati prima di signore (es. ". Signore." -> ", signore.")
        text = re.sub(r'[\.\!\?]\s+[Ss]ignore\b', ', signore', text)
        # 2. Rimuove maiuscola rigida all'interno o fine frase (il modello neurale lo legge con intonazione più dolce)
        text = re.sub(r',\s*Signore\b', ', signore', text)
        text = re.sub(r'\bSignore\b(?=[\s,\.\?!]|$)', 'signore', text)

        # 3. Se 'signore' non è presente nel testo, lo inserisce con una virgola dolce e cadenzata
        if "signore" not in text.lower():
            text = text.strip()
            if text.endswith('?'):
                text = text[:-1].rstrip() + ", signore?"
            elif text.endswith('.'):
                text = text[:-1].rstrip() + ", signore."
            else:
                text = text + ", signore."

        # 4. Assicura che la frase termini con punto fermo o interrogativo
        if not text.endswith('.') and not text.endswith('?'):
            text += '.'

        # 5. Ripristina maiuscola solo all'inizio assoluto del testo se apre con "Signore"
        text = re.sub(r'^signore\b', 'Signore', text, flags=re.IGNORECASE)

        # Pulisce spazi multipli e doppie virgole
        text = re.sub(r',\s*,', ',', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text


class JarvisResponses:
    """
    Collezione di risposte pre-strutturate in puro stile J.A.R.V.I.S.,
    immediate e prive di latenza per tutti gli scenari dell'applicazione.
    """

    @staticmethod
    def boot_greeting() -> str:
        return "Buongiorno signore, tutti i sistemi sono operativi. Il calendario steward è sincronizzato e a sua completa disposizione."

    @staticmethod
    def next_shift(title: str, date_str: str, time_str: str, call_time_str: str, venue: str) -> str:
        clean_title = title.replace('vs', 'contro')
        return (
            f"Il suo prossimo impegno di servizio è {clean_title}, previsto per {date_str} alle {time_str}, "
            f"presso {venue}. La convocazione è fissata per le {call_time_str}, signore."
        )

    @staticmethod
    def crowded_schedule(shift_count: int, conflicts_count: int = 0) -> str:
        if conflicts_count > 0:
            return (
                f"Ha in programma {shift_count} turni di servizio, signore. Mi permetto di farle notare che ho rilevato "
                f"alcune sovrapposizioni di data. Per quanto la sua dedizione sia straordinaria, "
                f"temo che le leggi della fisica le impediscano ancora di presenziare in due luoghi contemporaneamente."
            )
        return (
            f"Ha in programma {shift_count} turni di lavoro, signore. La sua agenda è particolarmente densa, "
            f"ma tutti i parametri rimangono sotto costante monitoraggio."
        )

    @staticmethod
    def empty_schedule() -> str:
        return "Non risultano turni operativi registrati per questo periodo, signore. Una rara occasione di quiete che le suggerisco di cogliere."

    @staticmethod
    def event_added(title: str) -> str:
        return f"Ho provveduto a registrare l'appuntamento {title} nel suo calendario personale, signore."

    @staticmethod
    def event_deleted(title: str) -> str:
        return f"L'evento {title} è stato rimosso definitivamente dal suo calendario, signore. Ho aggiornato la sua agenda."

    @staticmethod
    def sync_complete(count: int) -> str:
        return f"Sincronizzazione completata con successo, signore. Il database ora include {count} eventi verificati."

    @staticmethod
    def gcal_export(title: str) -> str:
        return f"Ho aperto il collegamento di sincronizzazione per {title}, signore. La convocazione e i promemoria sono pronti per il suo dispositivo."

    @staticmethod
    def unknown_query() -> str:
        return "Non ho compreso appieno la sua richiesta, signore. Posso fornirle informazioni sui prossimi turni, sulle partite allo stadio Maradona o aggiornare la sua agenda."

# =====================================================================
# MODULO NLP: PARSER DATE, ORARI, COMPENSI & AZIONI DIRETTE
# =====================================================================

ITALIAN_MONTHS = {
    "gennaio": 1, "gen": 1,
    "febbraio": 2, "feb": 2,
    "marzo": 3, "mar": 3,
    "aprile": 4, "apr": 4,
    "maggio": 5, "mag": 5,
    "giugno": 6, "giu": 6,
    "luglio": 7, "lug": 7,
    "agosto": 8, "ago": 8,
    "settembre": 9, "set": 9, "sett": 9,
    "ottobre": 10, "ott": 10,
    "novembre": 11, "nov": 11,
    "dicembre": 12, "dic": 12
}

WORD_NUMBERS = {
    "primo": 1, "uno": 1, "due": 2, "tre": 3, "quattro": 4, "cinque": 5, "sei": 6,
    "sette": 7, "otto": 8, "nove": 9, "dieci": 10, "undici": 11, "dodici": 12,
    "tredici": 13, "quattordici": 14, "quindici": 15, "sedici": 16, "diciassette": 17,
    "diciotto": 18, "diciannove": 19, "venti": 20, "ventuno": 21, "ventidue": 22,
    "ventitre": 23, "ventitré": 23, "ventiquattro": 24, "venticinque": 25,
    "ventisei": 26, "ventisette": 27, "ventotto": 28, "ventinove": 29, "trenta": 30, "trentuno": 31
}

def parse_italian_date(text: str, reference_date: Optional[str] = None) -> Tuple[Optional[datetime], Optional[str], Optional[str]]:
    t = text.lower()
    if reference_date:
        try:
            today = datetime.strptime(reference_date[:10], "%Y-%m-%d")
        except Exception:
            today = datetime.now()
    else:
        today = datetime.now()
    default_year = today.year

    # 1. Parole chiave relative
    if "dopodomani" in t:
        d = today + timedelta(days=2)
        return d, d.strftime("%Y-%m-%d"), "dopodomani"
    elif "domani" in t:
        d = today + timedelta(days=1)
        return d, d.strftime("%Y-%m-%d"), "domani"
    elif "oggi" in t:
        return today, today.strftime("%Y-%m-%d"), "oggi"

    # 2. Formato esplicito: "18 ottobre" / "diciotto ottobre" / "il 18 di ottobre"
    month_pattern = "|".join(ITALIAN_MONTHS.keys())
    num_pattern = r"\d{1,2}|" + "|".join(WORD_NUMBERS.keys())
    m = re.search(rf"\b(?:il\s+|del\s+)?({num_pattern})\s+(?:di\s+)?({month_pattern})(?:\s+(?:del\s+)?(\d{{4}}))?\b", t)
    if m:
        day_raw = m.group(1)
        month_raw = m.group(2)
        year_raw = m.group(3)

        day = int(day_raw) if day_raw.isdigit() else WORD_NUMBERS.get(day_raw, 1)
        month = ITALIAN_MONTHS.get(month_raw, 10)
        year = int(year_raw) if year_raw else default_year

        try:
            dt = datetime(year, month, day)
            return dt, dt.strftime("%Y-%m-%d"), f"{day} {month_raw}"
        except Exception:
            pass

    # 3. Formato numerico "18/10" o "18-10"
    m_num = re.search(r"\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b", t)
    if m_num:
        day = int(m_num.group(1))
        month = int(m_num.group(2))
        year = int(m_num.group(3)) if m_num.group(3) else default_year
        if year < 100: year += 2000
        try:
            dt = datetime(year, month, day)
            return dt, dt.strftime("%Y-%m-%d"), f"{day}/{month}"
        except Exception:
            pass

    return None, None, None

def parse_italian_time(text: str) -> Tuple[str, str]:
    t = text.lower()
    # "alle 15:30" / "ore 16.45"
    m1 = re.search(r"\b(?:alle\s+(?:ore\s+)?|ore\s+)(\d{1,2})[:.](\d{2})\b", t)
    if m1:
        h, m = int(m1.group(1)), int(m1.group(2))
        return f"{h:02d}:{m:02d}:00", f"ore {h} e {m}"
    # "alle 15 e mezza" / "ore 9 e mezza"
    m2 = re.search(r"\b(?:alle\s+(?:ore\s+)?|ore\s+)(\d{1,2})\s+e\s+(?:mezza|mezzo|trenta)\b", t)
    if m2:
        h = int(m2.group(1))
        return f"{h:02d}:30:00", f"ore {h} e trenta"
    # "alle 20 e 45"
    m3 = re.search(r"\b(?:alle\s+(?:ore\s+)?|ore\s+)(\d{1,2})\s+e\s+(\d{1,2})\b", t)
    if m3:
        h, m = int(m3.group(1)), int(m3.group(2))
        return f"{h:02d}:{m:02d}:00", f"ore {h} e {m}"
    # "alle 16" / "ore 15"
    m4 = re.search(r"\b(?:alle\s+(?:ore\s+)?|ore\s+)(\d{1,2})\b", t)
    if m4:
        h = int(m4.group(1))
        return f"{h:02d}:00:00", f"ore {h}"
    return "09:00:00", "ore nove"

def parse_italian_earnings(text: str) -> Optional[float]:
    t = text.lower()
    m1 = re.search(r"(?:paga|compenso|guadagno|tariffa)(?:\s+(?:di|a|pari\s+a))?\s*(\d+(?:[.,]\d+)?)\s*(?:euro|€)?", t)
    if m1:
        return float(m1.group(1).replace(",", "."))
    m2 = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:euro|€)\s+(?:di\s+)?(?:paga|compenso|guadagno)", t)
    if m2:
        return float(m2.group(1).replace(",", "."))
    m3 = re.search(r"\b(?:con\s+)?(\d+(?:[.,]\d+)?)\s*(?:euro|€)\b", t)
    if m3:
        return float(m3.group(1).replace(",", "."))
    return None

def extract_event_title(cmd: str, date_raw: Optional[str] = None) -> str:
    """
    Estrae il titolo pulito dell'evento dal comando utente,
    rimuovendo verbi, preposizioni, orari, date e clausole accessorie
    (es. 'anche se ho messo riposo', 'dove c'è lavoro', 'con stato lavoro io').
    """
    t = cmd.lower()
    t = re.sub(r'^(?:ehi\s+)?jarvis[,:\s]*', '', t).strip()

    # Rimuove clausole contestuali su altri eventi o stati preesistenti
    t = re.sub(r'\b(?:anche\s+se\s+ci\s+sono\s+(?:già\s+)?altri\s+eventi)\b', '', t).strip()
    t = re.sub(r'\b(?:anche\s+se\s+c\'è\s+(?:già\s+)?(?:un\s+altro\s+evento|riposo|lavoro\s+io|lavoro|ignora))\b', '', t).strip()
    t = re.sub(r'\b(?:anche\s+se\s+ho\s+(?:già\s+)?(?:messo|selezionato|impostato)?\s*(?:riposo|lavoro\s+io|lavoro|ignora))\b', '', t).strip()
    t = re.sub(r'\b(?:anche\s+se\s+sono\s+(?:a|in)\s+riposo)\b', '', t).strip()
    t = re.sub(r'\b(?:anche\s+se\s+(?:è|e)\s+riposo)\b', '', t).strip()
    t = re.sub(r'\b(?:dove\s+ho\s+(?:già\s+)?(?:messo|selezionato|impostato)?\s*(?:riposo|lavoro\s+io|lavoro|ignora))\b', '', t).strip()
    t = re.sub(r'\b(?:dove\s+c\'è\s+(?:già\s+)?(?:riposo|lavoro\s+io|lavoro))\b', '', t).strip()
    t = re.sub(r'\b(?:in\s+giornata|nella\s+stessa\s+giornata|nello\s+stesso\s+giorno)\b', '', t).strip()
    t = re.sub(r'\b(?:con\s+stato\s+(?:lavoro\s+io|lavoro|riposo|ignora))\b', '', t).strip()
    t = re.sub(r'\b(?:stato\s+(?:lavoro\s+io|lavoro|riposo|ignora))\b', '', t).strip()

    t = re.sub(r'\b(?:forza\s+inserimento|forza|inserimento|inserisci|aggiungi|crea|registra|segna|fissa|imposta|metti in calendario|metti in agenda|metti|programma|pianifica)\b', '', t).strip()
    t = re.sub(r'\b(?:un|una|uno|il|lo|la|l\'|i|gli|le)\b', '', t).strip()
    t = re.sub(r'\b(?:evento|appuntamento|impegno|turno|servizio|partita)\b', '', t).strip()
    t = re.sub(r'\b(?:personale|privato)\b', '', t).strip()
    t = re.sub(r'(?:con\s+)?(?:paga|compenso|guadagno|tariffa)(?:\s+(?:di|a|pari\s+a))?\s*\d+(?:[.,]\d+)?\s*(?:euro|€)?', '', t).strip()
    t = re.sub(r'\b\d+(?:[.,]\d+)?\s*(?:euro|€)(?:\s+di\s+(?:paga|compenso|guadagno))?\b', '', t).strip()
    t = re.sub(r'\b(?:alle\s+(?:ore\s+)?|ore\s+)\d{1,2}(?:[:.]\d{2}|\s+e\s+(?:mezza|mezzo|trenta|\d{1,2}))?\b', '', t).strip()
    if date_raw:
        t = re.sub(rf'\b(?:il\s+|del\s+|per\s+il\s+|per\s+)?{re.escape(date_raw)}\b', '', t, flags=re.IGNORECASE).strip()
    t = re.sub(r'\b(?:oggi|domani|dopodomani)\b', '', t).strip()
    t = re.sub(r'^(?:per\s+il|per|il|del|della|di|a|alle|in|presso)\s+', '', t).strip()
    t = re.sub(r'\s+(?:per\s+il|per|il|del|della|di|a|alle|in|presso)$', '', t).strip()
    t = re.sub(r'[^\w\s\'-]', '', t).strip()
    if not t or t.lower() in ["qualcosa", "un qualcosa", "qualcos'altro", "generico", "evento generico", "personale", "evento personale"]:
        return "Impegno Personale"
    return t.strip().capitalize()


def find_best_matching_event(target_text: str, events: list, date_iso: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Individua intelligentemente l'evento più probabile tramite token overlap,
    parole chiave distintive e data ISO di riferimento, ignorando parole grammaticali.
    """
    stop_words = {
        "il", "lo", "la", "i", "gli", "le", "l", "un", "uno", "una", "di", "a", "da", "in", "con",
        "su", "per", "tra", "fra", "del", "dello", "della", "dei", "degli", "delle", "al", "allo",
        "alla", "ai", "agli", "alle", "evento", "turno", "partita", "appuntamento", "chiamata",
        "servizio", "jarvis", "ehi", "signore", "perché", "come", "stato", "metti", "imposta",
        "seleziona", "segna", "conferma", "confermo", "elimina", "cancella", "rimuovi", "disdici",
        "annulla", "lavoro", "riposo", "ignora", "paga", "euro", "compenso"
    }

    target_clean = re.sub(r'[^\w\s]', ' ', (target_text or "").lower())
    target_tokens = [w for w in target_clean.split() if len(w) > 1 and w not in stop_words]

    pool = events
    if date_iso:
        day_events = [e for e in events if (e.get("event_start") or "").startswith(date_iso)]
        if day_events:
            if not target_tokens:
                return day_events[0]
            pool = day_events

    if not target_tokens:
        if date_iso and pool:
            return pool[0]
        return None

    # 1. Corrispondenza sottostringa
    joined_target = " ".join(target_tokens)
    for e in pool:
        t = (e.get("title") or "").lower()
        if joined_target in t or target_clean.strip() in t:
            return e

    # 2. Corrispondenza fuzzy / token scoring
    best_event = None
    best_score = 0

    for e in pool:
        t = (e.get("title") or "").lower()
        t_tokens = set(re.sub(r'[^\w\s]', ' ', t).split())
        score = 0
        for tok in target_tokens:
            if tok in t_tokens:
                score += 3
            elif any(tok in t_tok or t_tok in tok for t_tok in t_tokens if len(t_tok) >= 3):
                score += 1

        if score > best_score:
            best_score = score
            best_event = e

    if best_score > 0:
        return best_event

    return None


def process_jarvis_command(cmd: str, events: list, client_date: Optional[str] = None) -> Tuple[str, Optional[Dict[str, Any]], Optional[str]]:
    """
    Interpreta un comando vocale o testuale in linguaggio naturale e restituisce
    la risposta ideale in perfetto stile J.A.R.V.I.S. (con 'Signore', tono calmo,
    sottile ironia britannica e dizione formattata per la sintesi vocale).
    Ritorna una tupla: (testo_risposta, evento_correlato_opzionale, azione_eseguita_opzionale).
    """
    if not cmd:
        return JarvisResponses.boot_greeting(), None, None

    cmd_lower = cmd.lower().strip()
    cmd_clean = re.sub(r'^(?:ehi\s+|ciao\s+|ok\s+)?jarvis[,:\s]*', '', cmd_lower).strip()

    # Se l'utente ha invocato solo il nome "Jarvis" o "Ehi Jarvis" senza un comando
    if not cmd_clean:
        return "Al suo servizio, signore. Mi dica pure, sono a sua completa disposizione.", None, None

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Filtra eventi futuri ordinati cronologicamente
    future_events = [
        e for e in events
        if (e.get("event_start") or "") >= now_str
    ]
    future_events.sort(key=lambda x: x.get("event_start") or "")

    def _fmt_date(dt_str: str) -> str:
        try:
            d = datetime.strptime(dt_str[:10], "%Y-%m-%d")
            mesi = ["", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
                    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
            return f"{d.day} {mesi[d.month]}"
        except Exception:
            return dt_str[:10]

    def _fmt_time(dt_str: str) -> str:
        try:
            parts = dt_str.split(" ")[1].split(":")
            h, m = int(parts[0]), int(parts[1])
            ore_str = {
                0: "mezzanotte", 1: "una", 2: "due", 3: "tre", 4: "quattro",
                5: "cinque", 6: "sei", 7: "sette", 8: "otto", 9: "nove",
                10: "dieci", 11: "undici", 12: "dodici", 13: "tredici",
                14: "quattordici", 15: "quindici", 16: "sedici", 17: "diciassette",
                18: "diciotto", 19: "diciannove", 20: "venti", 21: "ventuno",
                22: "ventidue", 23: "ventitré"
            }.get(h, str(h))
            if m == 0:
                return f"ore {ore_str}"
            elif m == 30:
                return f"ore {ore_str} e trenta"
            return f"ore {ore_str} e {m}"
        except Exception:
            return dt_str

    # ═════════════════════════════════════════════════════════════════
    # 1. INSERIMENTO EVENTO PERSONALE / TURNO CON EVENTUALE PAGA
    # ═════════════════════════════════════════════════════════════════
    # Esclusioni da add_cmd per evitare collisioni con query o cambi di stato
    is_gcal_cmd = "google" in cmd_clean or "calendar" in cmd_clean
    is_count_cmd = any(k in cmd_clean for k in ["quanti turni", "quanti eventi", "conteggio turni", "conteggio eventi", "quanti impegni"])
    is_status_cmd = any(cmd_clean.startswith(p) for p in [
        "metti riposo", "metti lavoro", "imposta riposo", "imposta lavoro", "imposta stato",
        "seleziona riposo", "seleziona lavoro", "conferma lavoro", "confermo lavoro", "segna riposo", "segna lavoro"
    ]) or "stato riposo" in cmd_clean or "stato lavoro" in cmd_clean
    is_query_cmd = any(cmd_clean.startswith(q) for q in [
        "cosa c'è", "cosa ce", "cosa ho", "ho qualcosa", "sono libero", "è libera", "e libera",
        "quando è", "quando e", "quando gioca", "ci sono", "prossim", "ho impegni"
    ])

    is_add_cmd = not (is_gcal_cmd or is_count_cmd or is_status_cmd or is_query_cmd) and (
        any(k in cmd_clean for k in [
            "inserisci", "aggiungi", "crea", "registra", "segna", "fissa", "forza",
            "metti in calendario", "metti in agenda", "pianifica",
            "nuovo turno", "nuovo evento", "nuova fiera", "nuovo impegno", "nuova partita", "nuovo appuntamento"
        ])
        or (cmd_clean.startswith("metti ") and any(w in cmd_clean for w in ["turno", "evento", "partita", "appuntamento", "chiamata", "impegno", "servizio", "fiera", "calcetto"]))
        or bool(re.search(r'\bprogramma\s+(?:un\s+|una\s+|il\s+|la\s+|turno|evento|partita|visita|impegno)', cmd_clean))
    )
    is_delete_cmd = any(k in cmd_clean for k in ["elimina", "cancella", "rimuovi", "disdici", "annulla"])

    if is_add_cmd and not is_delete_cmd:
        date_obj, date_iso, date_raw = parse_italian_date(cmd_clean, reference_date=client_date)
        time_iso, time_verbal = parse_italian_time(cmd_clean)
        earnings = parse_italian_earnings(cmd_clean)
        title = extract_event_title(cmd_clean, date_raw)

        if not date_iso:
            ref_today = datetime.strptime(client_date[:10], "%Y-%m-%d") if client_date else datetime.now()
            date_iso = (ref_today + timedelta(days=1)).strftime("%Y-%m-%d")

        event_start = f"{date_iso} {time_iso}"

        # Riconoscimento Categoria & Venue intelligente
        cat = "CUSTOM"
        venue = ""
        title_lower = title.lower()
        if any(k in title_lower for k in ["mostra", "fiera", "expo", "salone", "convegno"]):
            cat = "FIERA"
            venue = "Mostra d'Oltremare"
        elif any(k in title_lower for k in ["partita", "calcio", "napoli", "maradona"]):
            cat = "CALCIO"
            venue = "Stadio Diego Armando Maradona"
        elif any(k in title_lower for k in ["stabia", "menti"]):
            cat = "CALCIO"
            venue = "Stadio Romeo Menti"
        elif any(k in title_lower for k in ["casertana", "pinto"]):
            cat = "CALCIO"
            venue = "Stadio Alberto Pinto"
        elif "dentista" in title_lower:
            venue = "Studio Dentistico"
        elif any(k in title_lower for k in ["visita", "dottore", "medico", "clinica"]):
            venue = "Studio Medico"

        call_time = calculate_call_time(cat, event_start)

        # Determina stato richiesto per il nuovo evento
        new_status = "Lavoro io"
        if re.search(r'\b(?:con\s+stato|stato|come)\s+(?:riposo|ignora)\b', cmd_clean):
            new_status = "Riposo"

        new_event_dict = {
            "title": title,
            "venue": venue,
            "category": cat,
            "event_start": event_start,
            "call_time": call_time,
            "status": new_status,
            "earnings": earnings,
            "notes": "Aggiunto su richiesta vocale J.A.R.V.I.S."
        }

        # Inserimento garantito anche se vi sono già eventi in giornata
        saved = insert_or_update_event(new_event_dict, force_insert=True)
        date_txt = _fmt_date(event_start)
        time_txt = _fmt_time(event_start)
        earnings_txt = f", con un compenso previsto di {int(earnings)} euro" if earnings is not None else ""
        status_txt = f" con stato '{new_status}'" if new_status == "Riposo" else ""

        existing_day_events = [e for e in events if (e.get("event_start") or "").startswith(date_iso)]
        if existing_day_events:
            other_names = [e.get('title') for e in existing_day_events[:2] if e.get('title')]
            other_txt = f" (in concomitanza con {', '.join(other_names)})" if other_names else ""
            coexist_txt = f" L'evento è stato aggiunto regolarmente nel suo calendario{other_txt}, affiancandosi agli impegni già registrati per quella data."
        else:
            coexist_txt = " La sua agenda operativa è stata aggiornata con successo."

        reply = (
            f"Certamente signore, ho registrato l'appuntamento {title} per il {date_txt} alle {time_txt}"
            f"{earnings_txt}{status_txt}.{coexist_txt}"
        )
        return reply, saved, "created"

    # ═════════════════════════════════════════════════════════════════
    # 2. ELIMINAZIONE / CANCELLAZIONE EVENTI
    # ═════════════════════════════════════════════════════════════════
    if any(k in cmd_clean for k in ["elimina", "cancella", "rimuovi", "disdici", "annulla"]):
        date_obj, date_iso, date_raw = parse_italian_date(cmd_clean, reference_date=client_date)
        clean_target = re.sub(r'\b(?:elimina|cancella|rimuovi|disdici|annulla|l\'|il|la|lo|i|gli|le|evento|appuntamento|turno|partita|del|della|di|jarvis)\b', '', cmd_clean).strip()
        if date_raw:
            clean_target = re.sub(rf'\b(?:il\s+|del\s+)?{re.escape(date_raw)}\b', '', clean_target, flags=re.IGNORECASE).strip()
        clean_target = clean_target.strip()

        match = find_best_matching_event(clean_target, events, date_iso=date_iso)
        if match:
            delete_event(match["id"])
            reply = f"Ho provveduto a cancellare definitivamente {match['title']} dal suo calendario, signore. L'evento è stato rimosso dalla sua agenda."
            return reply, match, "deleted"

        return "Non ho individuato alcun evento corrispondente alla sua richiesta di cancellazione, signore.", None, None

    # ═════════════════════════════════════════════════════════════════
    # 3. SELEZIONE STATO "LAVORO IO" O "RIPOSO"
    # ═════════════════════════════════════════════════════════════════
    if any(k in cmd_clean for k in ["lavoro io", "riposo", "ignora", "stato lavoro", "stato riposo", "imposta lavoro", "imposta riposo", "seleziona lavoro", "seleziona riposo", "metti lavoro", "metti riposo", "segna riposo", "segna lavoro", "confermo lavoro", "conferma lavoro"]):
        new_status = "Lavoro io" if "lavoro" in cmd_clean else "Riposo"
        earnings = parse_italian_earnings(cmd_clean)
        date_obj, date_iso, date_raw = parse_italian_date(cmd_clean, reference_date=client_date)
        clean_target = re.sub(r'\b(?:seleziona|imposta|metti|segna|conferma|confermo|stato|lavoro\s+io|lavoro|riposo|ignora|come|per|il|la|l\'|lo|del|della|di|paga|euro|\d+|jarvis)\b', '', cmd_clean).strip()
        if date_raw:
            clean_target = re.sub(rf'\b(?:il\s+|del\s+)?{re.escape(date_raw)}\b', '', clean_target, flags=re.IGNORECASE).strip()
        clean_target = clean_target.strip()

        if "prossimo" in clean_target or not clean_target:
            match = future_events[0] if future_events else (events[0] if events else None)
        else:
            match = find_best_matching_event(clean_target, events, date_iso=date_iso)
            if not match:
                match = future_events[0] if future_events else (events[0] if events else None)

        if match:
            updated = update_event_status(match["id"], new_status, earnings)
            if new_status == "Lavoro io":
                earn_txt = f" con un compenso di {int(earnings)} euro" if earnings is not None else ""
                reply = f"Certamente signore. Ho impostato lo stato di {match['title']} su 'Lavoro io'{earn_txt}. Il turno è confermato nel suo calendario."
            else:
                reply = f"Molto bene signore. Ho impostato lo stato di {match['title']} su 'Riposo'. L'evento è stato reso invisibile sul calendario principale, ma rimarrà conservato nella sezione turni qualora decidesse di cambiare idea."
            return reply, updated or match, "status_updated"

        return "Non ho individuato l'evento per il quale desidera modificare lo stato, signore.", None, None

    # ═════════════════════════════════════════════════════════════════
    # 4. LETTURA CALENDARIO PER DATA SPECIFICA ("Ho qualcosa il 18 ottobre?")
    # ═════════════════════════════════════════════════════════════════
    date_obj, date_iso, date_raw = parse_italian_date(cmd_clean, reference_date=client_date)
    is_date_query = date_iso is not None and (
        any(k in cmd_clean for k in ["ho qualcosa", "cosa ho", "cosa c'è", "cosa ce", "sono libero", "è libera", "e libera", "libera", "libero", "impegni", "impegno", "turni", "turno", "agenda", "calendario", "quando", "c'è qualcosa", "ce qualcosa", "lavoro"]) or len(cmd_clean.split()) <= 4
    )

    if is_date_query:
        day_events = [e for e in events if e.get("event_start", "").startswith(date_iso)]
        date_txt = _fmt_date(date_iso + " 00:00:00")

        if not day_events:
            reply = f"No signore, la giornata del {date_txt} risulta completamente libera da impegni in calendario. Nessun turno previsto, può godersi il suo meritato riposo."
            return reply, {"event_start": f"{date_iso} 09:00:00", "title": f"Giornata Libera ({date_txt})"}, "view_date"

        elif len(day_events) == 1:
            ev = day_events[0]
            title_clean = ev["title"].replace("vs", "contro")
            time_txt = _fmt_time(ev["event_start"])
            venue = ev.get("venue")
            venue_txt = f" presso {venue}" if venue else ""
            call_time = ev.get("call_time")
            call_txt = f". La convocazione è fissata per le {_fmt_time(call_time)}" if call_time else ""
            earnings = ev.get("earnings")
            earnings_txt = f", con un compenso previsto di {int(earnings)} euro" if earnings is not None else ""
            status = (ev.get("status") or "").lower()

            if "riposo" in status:
                reply = (
                    f"Il {date_txt} in calendario compare {title_clean} alle {time_txt}{venue_txt}, "
                    f"ma avendolo contrassegnato come Riposo, non effettuerà questo turno. "
                    f"La sua giornata rimane quindi a sua totale disposizione per altri impegni o attività personali, signore."
                )
            elif "lavoro" in status:
                reply = f"Sì signore, il {date_txt} ha confermato il servizio per {title_clean} alle {time_txt}{venue_txt}{call_txt}{earnings_txt}."
            else:
                reply = f"Sì signore, il {date_txt} ha in programma {title_clean} alle {time_txt}{venue_txt}{call_txt}{earnings_txt}."
            return reply, ev, "view_date"

        else:
            active_work = [e for e in day_events if "riposo" not in (e.get("status") or "").lower()]
            rest_events = [e for e in day_events if "riposo" in (e.get("status") or "").lower()]

            parts = []
            for e in day_events:
                t_clean = e["title"].replace("vs", "contro")
                t_time = _fmt_time(e["event_start"])
                st = (e.get("status") or "").lower()
                e_earn = f", compenso {int(e['earnings'])} euro" if e.get("earnings") else ""

                if "riposo" in st:
                    parts.append(f"{t_clean} alle {t_time} (impostato su Riposo/ignora)")
                elif "lavoro" in st:
                    parts.append(f"{t_clean} alle {t_time} (Lavoro io{e_earn})")
                else:
                    parts.append(f"{t_clean} alle {t_time}{e_earn}")

            details = "; ".join(parts)

            if active_work and rest_events:
                reply = (
                    f"Sì signore, per il {date_txt} risultano {len(day_events)} appuntamenti: {details}. "
                    f"Risulta operativo per i turni confermati, mentre l'evento a riposo lascia spazio ai suoi programmi personali, signore."
                )
            elif active_work:
                reply = f"Sì signore, per il {date_txt} ha in programma {len(day_events)} impegni: {details}. Una giornata decisamente intensa, signore."
            else:
                reply = (
                    f"Per il {date_txt} in calendario figurano {len(day_events)} appuntamenti: {details}. "
                    f"Avendo contrassegnato tali impegni come Riposo/ignora, non effettuerà questi servizi e la sua giornata è libera da obblighi operativi, signore."
                )

            focus_ev = active_work[0] if active_work else day_events[0]
            return reply, focus_ev, "view_date"

    # ═════════════════════════════════════════════════════════════════
    # 5. QUERY GENERALI PREDEFINITE
    # ═════════════════════════════════════════════════════════════════

    # 5.1 Prossimo Turno
    if any(k in cmd_lower for k in ["prossimo turno", "quando lavoro", "prossimo servizio", "mio turno", "primo turno"]):
        if not future_events:
            return JarvisResponses.empty_schedule(), None, None
        next_ev = future_events[0]
        date_txt = _fmt_date(next_ev["event_start"])
        time_txt = _fmt_time(next_ev["event_start"])
        call_txt = _fmt_time(next_ev["call_time"])
        venue_txt = next_ev.get("venue") or "Sede designata"
        return JarvisResponses.next_shift(next_ev["title"], date_txt, time_txt, call_txt, venue_txt), next_ev, "view_date"

    # 5.2 Partite SSC Napoli allo Stadio Maradona
    if "napoli" in cmd_lower or "maradona" in cmd_lower:
        napoli_matches = [
            e for e in future_events
            if "maradona" in (e.get("venue") or "").lower()
            and (e.get("category") or "").upper() == "CALCIO"
            and "mostra" not in (e.get("venue") or "").lower()
            and "expo" not in (e.get("title") or "").lower()
        ]
        if not napoli_matches:
            return "Non risultano partite del Napoli al Maradona programmate per il periodo a venire, signore.", None, None
        ev = napoli_matches[0]
        date_txt = _fmt_date(ev["event_start"])
        time_txt = _fmt_time(ev["event_start"])
        call_txt = _fmt_time(ev["call_time"])
        title_clean = ev["title"].replace("vs", "contro")
        return (
            f"La prossima gara del Napoli al Maradona è {title_clean}, in calendario il {date_txt} alle {time_txt}. "
            f"La convocazione per il servizio steward è fissata per le {call_txt}, signore."
        ), ev, "view_date"

    # 5.3 Juve Stabia (Stadio Romeo Menti)
    if "stabia" in cmd_lower or "menti" in cmd_lower:
        stabia_matches = [
            e for e in future_events
            if "menti" in (e.get("venue") or "").lower() or "stabia" in (e.get("title") or "").lower()
        ]
        if not stabia_matches:
            return "Nessuna gara della Juve Stabia al Romeo Menti rilevata nei prossimi giorni, signore.", None, None
        ev = stabia_matches[0]
        date_txt = _fmt_date(ev["event_start"])
        time_txt = _fmt_time(ev["event_start"])
        call_txt = _fmt_time(ev["call_time"])
        title_clean = ev["title"].replace("vs", "contro")
        return (
            f"La prossima gara della Juve Stabia al Romeo Menti è {title_clean}, il {date_txt} alle {time_txt}. "
            f"La convocazione steward è alle {call_txt}, signore."
        ), ev, "view_date"

    # 5.4 Casertana FC (Stadio Alberto Pinto)
    if "casertana" in cmd_lower or "pinto" in cmd_lower:
        casertana_matches = [
            e for e in future_events
            if "pinto" in (e.get("venue") or "").lower() or "casertana" in (e.get("title") or "").lower()
        ]
        if not casertana_matches:
            return "Nessun incontro della Casertana allo stadio Pinto rilevato in calendario, signore.", None, None
        ev = casertana_matches[0]
        date_txt = _fmt_date(ev["event_start"])
        time_txt = _fmt_time(ev["event_start"])
        call_txt = _fmt_time(ev["call_time"])
        title_clean = ev["title"].replace("vs", "contro")
        return (
            f"La prossima gara della Casertana allo stadio Pinto è {title_clean}, il {date_txt} alle {time_txt}. "
            f"La convocazione è programmata per le {call_txt}, signore."
        ), ev, "view_date"

    # 5.5 Mostra d'Oltremare / Fiere
    if "mostra" in cmd_lower or "fiera" in cmd_lower or "oltremare" in cmd_lower or "expo" in cmd_lower:
        mostra_events = [
            e for e in future_events
            if "mostra" in (e.get("venue") or "").lower() or (e.get("category") or "").upper() == "FIERA"
        ]
        if not mostra_events:
            return "Non risultano fiere o manifestazioni alla Mostra d'Oltremare nel breve periodo, signore.", None, None
        ev = mostra_events[0]
        date_txt = _fmt_date(ev["event_start"])
        time_txt = _fmt_time(ev["event_start"])
        call_txt = _fmt_time(ev["call_time"])
        return (
            f"Il prossimo appuntamento alla Mostra d'Oltremare è {ev['title']}, previsto per il {date_txt} alle {time_txt}. "
            f"La convocazione generale è fissata per le {call_txt}, signore."
        ), ev, "view_date"

    # 5.6 Guadagni e Compensi
    if any(k in cmd_lower for k in ["guadagn", "compenso", "quanto prendo", "soldi", "paga totale"]):
        work_events = [e for e in events if (e.get("earnings") is not None and float(e.get("earnings") or 0) > 0)]
        if not work_events:
            return "Al momento non risultano compensi registrati per i suoi turni in calendario, signore. Può inserire il compenso direttamente toccando un evento o confermandolo.", None, None
        tot = sum(float(e.get("earnings") or 0) for e in work_events)
        return (
            f"Signore, in base ai turni per i quali ha inserito il compenso, il suo guadagno complessivo ammonta a {int(tot)} euro "
            f"su un totale di {len(work_events)} chiamate registrate."
        ), work_events[0], "view_date"

    # 5.7 Conflitti / Sovrapposizioni
    if any(k in cmd_lower for k in ["conflitt", "sovrapposiz", "coincidenz", "doppio"]):
        conflicts = [e for e in events if e.get("conflict")]
        if not conflicts:
            return "Nessuna sovrapposizione o conflitto rilevato, signore. Tutti i turni sono perfettamente scaglionati.", None, None
        return JarvisResponses.crowded_schedule(len(future_events), len(conflicts)), None, None

    # 5.7 Quanti eventi / Conteggio turni
    if any(k in cmd_lower for k in ["quanti eventi", "quanti turni", "conteggio", "agenda"]):
        if not future_events:
            return JarvisResponses.empty_schedule(), None, None
        return JarvisResponses.crowded_schedule(len(future_events), 0), None, None

    # 5.8 Sincronizzazione / Aggiornamento
    if any(k in cmd_lower for k in ["sincronizza", "aggiorna", "sync", "scarica turni"]):
        return "Avvio la procedura di sincronizzazione dei calendari di lavoro, signore. Tutti i dati verranno allineati.", None, None

    # 5.9 Google Calendar
    if "google" in cmd_lower or "calendar" in cmd_lower or "collega" in cmd_lower:
        if future_events:
            return JarvisResponses.gcal_export(future_events[0]["title"]), future_events[0], "view_date"
        return "I canali di sincronizzazione con Google Calendar e smartphone sono pienamente operativi, signore.", None, None

    # 5.10 Saluti e stato di sistema
    if any(k in cmd_lower for k in ["buongiorno", "buonasera", "ciao", "come stai", "chi sei", "stato sistemi"]):
        return JarvisResponses.boot_greeting(), None, None

    # Default imperturbabile
    return JarvisResponses.unknown_query(), None, None



# =====================================================================
# PARTE 2: FILTRO AUDIO DSP OLOGRAFICO (High-Pass, Peaking, Micro-Delay, Norm)
# =====================================================================

def apply_jarvis_dsp(raw_samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """
    Applica la catena di post-produzione DSP per trasformare la voce neurale
    nel timbro distintivo, caldo, nitido e leggermente olografico di J.A.R.V.I.S. (Paul Bettany):

    1. High-Pass Filter @ 80 Hz: Taglia i rumori subsonici preservando la calda risonanza toracica baritonale.
    2. Peaking Band-Pass Boost @ 2500-4500 Hz (+12%): Aggiunge chiarezza setosa e nitidezza HUD senza asprezze metalliche.
    3. Micro-Delay Olografico di 6.5 ms (mix 10% wet): Crea una spazialità raffinata e trasparente, eliminando effetti robotici.
    4. Normalizzazione di picco a 0.95: Livella uniformemente il volume con 0.5 dB di headroom.
    """
    # Converte in float32 bidimensionale [-1.0, 1.0]
    if raw_samples.dtype == np.int16:
        float_data = raw_samples.astype(np.float32) / 32768.0
    elif raw_samples.dtype == np.int32:
        float_data = raw_samples.astype(np.float32) / 2147483648.0
    else:
        float_data = raw_samples.astype(np.float32)

    # 1. High-Pass Filter a 80 Hz (Butterworth 2° ordine)
    b_hp, a_hp = scipy.signal.butter(2, HP_CUTOFF, btype="highpass", fs=sample_rate)
    hp_filtered = scipy.signal.lfilter(b_hp, a_hp, float_data, axis=0)

    # 2. Peaking Band-Pass Boost tra 2000 Hz e 4000 Hz (Nitidezza e timbro sintetico)
    b_bp, a_bp = scipy.signal.butter(2, [BP_LOW, BP_HIGH], btype="bandpass", fs=sample_rate)
    presence_band = scipy.signal.lfilter(b_bp, a_bp, hp_filtered, axis=0)
    boosted_signal = hp_filtered + (METALLIC_BOOST * presence_band)

    # 3. Micro-Delay Olografico di 8 ms (mix 28% wet)
    delay_samples = max(1, int(sample_rate * (MICRO_DELAY_MS / 1000.0)))
    delayed_signal = np.zeros_like(boosted_signal)
    delayed_signal[delay_samples:] = boosted_signal[:-delay_samples]

    # Comb filtering olografico bilanciato
    holographic_mix = ((1.0 - MICRO_DELAY_MIX) * boosted_signal) + (MICRO_DELAY_MIX * delayed_signal)

    # 4. Normalizzazione di picco del volume a 0.95 (headroom 0.5 dB)
    peak = np.max(np.abs(holographic_mix))
    if peak > 0.001:
        normalized = holographic_mix * (PEAK_TARGET / peak)
    else:
        normalized = holographic_mix

    # Riconverte in int16 PCM
    pcm_out = np.clip(normalized * 32767.0, -32768.0, 32767.0).astype(np.int16)
    return pcm_out


# =====================================================================
# MOTORE DI SINTESI VOCALE GRATUITA (edge-tts + DSP Cache)
# =====================================================================

async def _synthesize_edge_tts(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """Esegue la sintesi vocale neurale tramite edge-tts senza chiavi API esterne."""
    communicate = edge_tts.Communicate(
        text=text,
        voice=voice,
        pitch=PITCH,
        rate=RATE,
    )
    mp3_buffer = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            mp3_buffer.write(chunk["data"])
    return mp3_buffer.getvalue()


# Cache in memoria RAM per risposte istantanee a latenza zero (< 1 ms)
_AUDIO_RAM_CACHE: Dict[str, bytes] = {}
_RAM_CACHE_LOCK = threading.Lock()


def synthesize_jarvis_speech(text: str, voice: str = DEFAULT_VOICE) -> Tuple[bytes, str]:
    """
    Funzione principale di generazione audio J.A.R.V.I.S.:
    1. Normalizza il testo secondo le regole di prosodia e cortesia J.A.R.V.I.S.
    2. Verifica la presenza di una copia in RAM cache (risposta in 0.05ms).
    3. Verifica la presenza di una copia su Disco SSD (risposta in 1ms).
    4. Altrimenti sintetizza con edge-tts (100% gratuito).
    5. Decodifica direttamente in memoria (zero file temporanei su disco).
    6. Applica la catena DSP di post-produzione (filtro olografico).
    7. Restituisce (wav_bytes, cleaned_text).
    """
    _ensure_mixer()

    cleaned_text = JarvisFormatter.clean_for_tts(text)

    # Chiave hash per caching su disco e RAM
    cache_key = hashlib.sha256(f"{voice}_{PITCH}_{RATE}_{cleaned_text}".encode("utf-8")).hexdigest()
    cache_file = CACHE_DIR / f"jarvis_{cache_key}.wav"

    # 1. Verifica RAM Cache (0 ms)
    with _RAM_CACHE_LOCK:
        if cache_key in _AUDIO_RAM_CACHE:
            return _AUDIO_RAM_CACHE[cache_key], cleaned_text

    # 2. Verifica Disco Cache (1 ms)
    if cache_file.exists():
        try:
            wav_bytes = cache_file.read_bytes()
            with _RAM_CACHE_LOCK:
                _AUDIO_RAM_CACHE[cache_key] = wav_bytes
            return wav_bytes, cleaned_text
        except Exception:
            pass

    # 3. Genera audio grezzo da Edge TTS
    try:
        mp3_bytes = asyncio.run(_synthesize_edge_tts(cleaned_text, voice=voice))
    except Exception as e:
        logger.warning(f"Errore edge-tts con voce {voice}: {e}, tentativo fallback con {FALLBACK_VOICE}")
        mp3_bytes = asyncio.run(_synthesize_edge_tts(cleaned_text, voice=FALLBACK_VOICE))

    # 4. Decodifica l'MP3 interamente in RAM ed applica DSP se pygame è disponibile (locale)
    if PYGAME_AVAILABLE:
        try:
            sound = pygame.mixer.Sound(io.BytesIO(mp3_bytes))
            raw_samples = pygame.sndarray.array(sound)
            if raw_samples.ndim == 2:
                raw_samples = raw_samples[:, 0]  # Mono puro

            # 5. Applica il DSP olografico Paul Bettany
            dsp_samples = apply_jarvis_dsp(raw_samples, sample_rate=SAMPLE_RATE)

            # 6. Salva in formato WAV PCM standard in memoria
            wav_buffer = io.BytesIO()
            scipy.io.wavfile.write(wav_buffer, SAMPLE_RATE, dsp_samples)
            wav_bytes = wav_buffer.getvalue()
        except Exception as exc:
            logger.warning(f"Decodifica pygame non riuscita ({exc}), uso stream audio diretto")
            wav_bytes = mp3_bytes
    else:
        # Su server cloud headless (es. Render/Linux), usa direttamente l'audio neurale generato
        wav_bytes = mp3_bytes

    # 7. Registra in RAM e su Disco per risposte future istantanee
    with _RAM_CACHE_LOCK:
        _AUDIO_RAM_CACHE[cache_key] = wav_bytes
    try:
        cache_file.write_bytes(wav_bytes)
    except Exception:
        pass

    return wav_bytes, cleaned_text


def prewarm_jarvis_cache(events: list = None):
    """
    Pre-sintetizza e memorizza in RAM e disco tutte le risposte frequenti di J.A.R.V.I.S.
    (saluto d'avvio, prossimo turno, gare Napoli/Stabia/Casertana, Mostra d'Oltremare,
    conflitti, conteggio turni).
    Viene eseguita all'avvio in background per garantire risposte istantanee a zero latenza.
    """
    logger.info("Avvio pre-caching vocale intelligente J.A.R.V.I.S. in background...")
    if events is None:
        try:
            from database import get_all_events_with_conflicts
            events = get_all_events_with_conflicts()
        except Exception:
            events = []

    queries = [
        "buongiorno",
        "prossimo turno",
        "quando gioca il napoli",
        "juve stabia",
        "casertana",
        "mostra d'oltremare",
        "quanti eventi",
        "conflitti",
        "sincronizza",
        "google calendar",
        "chi sei"
    ]

    for q in queries:
        try:
            txt, *_ = process_jarvis_command(q, events)
            synthesize_jarvis_speech(txt)
        except Exception as exc:
            logger.debug(f"Prewarm query '{q}' saltata: {exc}")

    logger.info(f"Pre-caching vocale J.A.R.V.I.S. completato: {len(_AUDIO_RAM_CACHE)} risposte pronte in RAM a 0ms.")


# =====================================================================
# RIPRODUZIONE AUDIO ASINCRONA LOCALE (Non-blocking)
# =====================================================================

_current_sound: Optional[Any] = None
_play_lock = threading.Lock()

def play_jarvis_speech(text: str, blocking: bool = False) -> str:
    """
    Sintetizza e riproduce la voce di J.A.R.V.I.S. con il filtro olografico
    direttamente sugli altoparlanti locali in modo asincrono.
    """
    global _current_sound
    wav_bytes, cleaned_text = synthesize_jarvis_speech(text)

    if not PYGAME_AVAILABLE:
        return cleaned_text

    _ensure_mixer()

    def _play_worker():
        global _current_sound
        with _play_lock:
            try:
                if pygame and pygame.mixer and pygame.mixer.get_init():
                    pygame.mixer.stop()
                    wav_io = io.BytesIO(wav_bytes)
                    sound = pygame.mixer.Sound(wav_io)
                    _current_sound = sound
                    sound.play()
                    if blocking:
                        # Attende il completamento
                        sound_len = sound.get_length()
                        time.sleep(sound_len)
            except Exception as exc:
                logger.error(f"Errore riproduzione audio locale: {exc}")

    if blocking:
        _play_worker()
    else:
        thread = threading.Thread(target=_play_worker, daemon=True)
        thread.start()

    return cleaned_text


def stop_jarvis_speech():
    """Interrompe immediatamente qualsiasi riproduzione vocale in corso."""
    if not PYGAME_AVAILABLE or not pygame:
        return
    with _play_lock:
        if pygame.mixer and pygame.mixer.get_init():
            try:
                pygame.mixer.stop()
            except Exception:
                pass
