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
from typing import Optional, Tuple, Dict, Any

import numpy as np
import scipy.signal
import scipy.io.wavfile
import edge_tts
import pygame

logger = logging.getLogger("jarvis_voice")
logging.basicConfig(level=logging.INFO)

# =====================================================================
# CONFIGURAZIONE MOTORE VOCALE & DSP
# =====================================================================

CACHE_DIR = Path(__file__).parent / "static" / "audio_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Voce principale: Diego Neural (italiano, maschile, tono profondo, autorevole ed elegante)
DEFAULT_VOICE = "it-IT-DiegoNeural"
FALLBACK_VOICE = "it-IT-GiuseppeNeural"

# Parametri prosodici per J.A.R.V.I.S.:
# - pitch="-4Hz": tono più basso, calmo e autorevole
# - rate="+5%": dizione rapida, scandita e precisa tipica dell'AI
PITCH = "-4Hz"
RATE = "+5%"
SAMPLE_RATE = 44100

# Parametri Catena DSP:
HP_CUTOFF = 120.0          # High-Pass cutoff a 120 Hz
BP_LOW = 2000.0            # Band-pass low limit
BP_HIGH = 4000.0           # Band-pass high limit
METALLIC_BOOST = 0.35      # +35% presenza metallica HUD Iron Man
MICRO_DELAY_MS = 8.0       # 8 millisecondi per risonanza olografica
MICRO_DELAY_MIX = 0.28     # 28% effetto wet
PEAK_TARGET = 0.95         # Normalizzazione volume di picco

# Inizializzazione Pygame Mixer per audio locale
_mixer_initialized = False
_mixer_lock = threading.Lock()

def _ensure_mixer():
    global _mixer_initialized
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
   - Rivolgiti SEMPRE all'utente chiamandolo "Signore" (es. "Buongiorno, Signore", "Certamente, Signore", "A sua disposizione, Signore").

3. SOTTILE IRONIA BRITANNICA (DRY WIT):
   - Mantieni uno stile sobrio e distinto.
   - Inserisci una sottile e raffinata sfumatura di ironia quando la giornata è eccessivamente affollata di impegni, quando ci sono conflitti di orario impossibili o richieste insolite, senza mai risultare irriverente o sarcastico.

4. REGOLE PER LA SINTESI VOCALE (TTS):
   - Scrivi frasi brevi, fluide, ritmate ed eleganti, con una cadenza naturale studiata per la lettura vocale.
   - Usa virgole e punti fermi per scandire i respiri e le pause della voce artificiale.
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
            return "A sua disposizione, Signore."

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

        # Assicura la formula di cortesia "Signore" se non già presente
        if "signore" not in text.lower():
            text = text.strip()
            if not text.endswith('.'):
                text += '.'
            text += " Signore."

        # Pulisce spazi multipli
        text = re.sub(r'\s+', ' ', text).strip()
        return text


class JarvisResponses:
    """
    Collezione di risposte pre-strutturate in puro stile J.A.R.V.I.S.,
    immediate e prive di latenza per tutti gli scenari dell'applicazione.
    """

    @staticmethod
    def boot_greeting() -> str:
        return "Buongiorno, Signore. Tutti i sistemi sono operativi. Il calendario steward è aggiornato e a sua completa disposizione."

    @staticmethod
    def next_shift(title: str, date_str: str, time_str: str, call_time_str: str, venue: str) -> str:
        clean_title = title.replace('vs', 'contro')
        return (
            f"Il suo prossimo impegno di servizio è {clean_title}, previsto per {date_str} alle {time_str}, "
            f"presso {venue}. La convocazione è fissata per le {call_time_str}. "
            f"I dettagli operativi sono pronti, Signore."
        )

    @staticmethod
    def crowded_schedule(shift_count: int, conflicts_count: int = 0) -> str:
        if conflicts_count > 0:
            return (
                f"Ha in programma {shift_count} turni di servizio, Signore. Mi permetto di farle notare che ho rilevato "
                f"alcune sovrapposizioni di data. Per quanto la sua dedizione sia straordinaria, "
                f"temo che le leggi della fisica le impediscano ancora di presenziare in due luoghi simultaneamente."
            )
        return (
            f"Ha in programma {shift_count} turni di lavoro, Signore. La sua agenda è particolarmente densa, "
            f"ma tutti i parametri rimangono sotto costante monitoraggio."
        )

    @staticmethod
    def empty_schedule() -> str:
        return "Non risultano turni operativi registrati per questo periodo, Signore. Una rara occasione di quiete che le suggerisco di cogliere."

    @staticmethod
    def event_added(title: str) -> str:
        return f"Ho provveduto a registrare l'appuntamento {title} nel suo calendario personale, Signore."

    @staticmethod
    def event_deleted(title: str) -> str:
        return f"L'evento {title} è stato rimosso definitivamente dal suo calendario, Signore. Ho aggiornato la sua agenda."

    @staticmethod
    def sync_complete(count: int) -> str:
        return f"Sincronizzazione completata con successo, Signore. Il database ora include {count} eventi verificati."

    @staticmethod
    def gcal_export(title: str) -> str:
        return f"Ho aperto il collegamento di sincronizzazione per {title}, Signore. La convocazione e i promemoria sono pronti per il suo dispositivo."

    @staticmethod
    def unknown_query() -> str:
        return "Non ho compreso appieno la sua richiesta, Signore. Posso fornirle informazioni sui prossimi turni, sulle partite allo stadio Maradona o aggiornare la sua agenda."


def process_jarvis_command(cmd: str, events: list) -> Tuple[str, Optional[Dict[str, Any]]]:
    """
    Interpreta un comando vocale o testuale in linguaggio naturale e restituisce
    la risposta ideale in perfetto stile J.A.R.V.I.S. (con 'Signore', tono calmo,
    sottile ironia britannica e dizione formattata per la sintesi vocale).
    Ritorna una tupla (testo_risposta, evento_correlato_opzionale).
    """
    if not cmd:
        return JarvisResponses.boot_greeting(), None

    cmd_lower = cmd.lower().strip()
    from datetime import datetime
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

    # 1. Prossimo Turno
    if any(k in cmd_lower for k in ["prossimo turno", "quando lavoro", "prossimo servizio", "mio turno", "primo turno"]):
        if not future_events:
            return JarvisResponses.empty_schedule(), None
        next_ev = future_events[0]
        date_txt = _fmt_date(next_ev["event_start"])
        time_txt = _fmt_time(next_ev["event_start"])
        call_txt = _fmt_time(next_ev["call_time"])
        venue_txt = next_ev.get("venue") or "Sede designata"
        return JarvisResponses.next_shift(next_ev["title"], date_txt, time_txt, call_txt, venue_txt), next_ev

    # 2. Partite SSC Napoli allo Stadio Maradona
    if "napoli" in cmd_lower or "maradona" in cmd_lower:
        napoli_matches = [
            e for e in future_events
            if "maradona" in (e.get("venue") or "").lower()
            and (e.get("category") or "").upper() == "CALCIO"
            and "mostra" not in (e.get("venue") or "").lower()
            and "expo" not in (e.get("title") or "").lower()
        ]
        if not napoli_matches:
            return "Non risultano partite del Napoli al Maradona programmate per il periodo a venire, Signore.", None
        ev = napoli_matches[0]
        date_txt = _fmt_date(ev["event_start"])
        time_txt = _fmt_time(ev["event_start"])
        call_txt = _fmt_time(ev["call_time"])
        title_clean = ev["title"].replace("vs", "contro")
        return (
            f"La prossima gara del Napoli al Maradona è {title_clean}, in calendario il {date_txt} alle {time_txt}. "
            f"La convocazione per il servizio steward è fissata per le {call_txt}, Signore."
        ), ev

    # 3. Juve Stabia (Stadio Romeo Menti)
    if "stabia" in cmd_lower or "menti" in cmd_lower:
        stabia_matches = [
            e for e in future_events
            if "menti" in (e.get("venue") or "").lower() or "stabia" in (e.get("title") or "").lower()
        ]
        if not stabia_matches:
            return "Nessuna gara della Juve Stabia al Romeo Menti rilevata nei prossimi giorni, Signore.", None
        ev = stabia_matches[0]
        date_txt = _fmt_date(ev["event_start"])
        time_txt = _fmt_time(ev["event_start"])
        call_txt = _fmt_time(ev["call_time"])
        title_clean = ev["title"].replace("vs", "contro")
        return (
            f"La prossima gara della Juve Stabia al Romeo Menti è {title_clean}, il {date_txt} alle {time_txt}. "
            f"Convocazione steward alle {call_txt}, Signore."
        ), ev

    # 4. Casertana FC (Stadio Alberto Pinto)
    if "casertana" in cmd_lower or "pinto" in cmd_lower:
        casertana_matches = [
            e for e in future_events
            if "pinto" in (e.get("venue") or "").lower() or "casertana" in (e.get("title") or "").lower()
        ]
        if not casertana_matches:
            return "Nessun incontro della Casertana allo stadio Pinto rilevato in calendario, Signore.", None
        ev = casertana_matches[0]
        date_txt = _fmt_date(ev["event_start"])
        time_txt = _fmt_time(ev["event_start"])
        call_txt = _fmt_time(ev["call_time"])
        title_clean = ev["title"].replace("vs", "contro")
        return (
            f"La prossima gara della Casertana allo stadio Pinto è {title_clean}, il {date_txt} alle {time_txt}. "
            f"La convocazione è programmata per le {call_txt}, Signore."
        ), ev

    # 5. Mostra d'Oltremare / Fiere
    if "mostra" in cmd_lower or "fiera" in cmd_lower or "oltremare" in cmd_lower or "expo" in cmd_lower:
        mostra_events = [
            e for e in future_events
            if "mostra" in (e.get("venue") or "").lower() or (e.get("category") or "").upper() == "FIERA"
        ]
        if not mostra_events:
            return "Non risultano fiere o manifestazioni alla Mostra d'Oltremare nel breve periodo, Signore.", None
        ev = mostra_events[0]
        date_txt = _fmt_date(ev["event_start"])
        time_txt = _fmt_time(ev["event_start"])
        call_txt = _fmt_time(ev["call_time"])
        return (
            f"Il prossimo appuntamento alla Mostra d'Oltremare è {ev['title']}, previsto per il {date_txt} alle {time_txt}. "
            f"La convocazione generale è fissata per le {call_txt}, Signore."
        ), ev

    # 6. Conflitti / Sovrapposizioni
    if any(k in cmd_lower for k in ["conflitt", "sovrapposiz", "coincidenz", "doppio"]):
        conflicts = [e for e in events if e.get("conflict")]
        if not conflicts:
            return "Nessuna sovrapposizione o conflitto rilevato, Signore. Tutti i turni sono perfettamente scaglionati.", None
        return JarvisResponses.crowded_schedule(len(future_events), len(conflicts)), None

    # 7. Quanti eventi / Conteggio turni
    if any(k in cmd_lower for k in ["quanti eventi", "quanti turni", "conteggio", "agenda"]):
        if not future_events:
            return JarvisResponses.empty_schedule(), None
        return JarvisResponses.crowded_schedule(len(future_events), 0), None

    # 8. Sincronizzazione / Aggiornamento
    if any(k in cmd_lower for k in ["sincronizza", "aggiorna", "sync", "scarica turni"]):
        return "Avvio la procedura di sincronizzazione dei calendari di lavoro, Signore. Tutti i dati verranno allineati.", None

    # 9. Google Calendar
    if "google" in cmd_lower or "calendar" in cmd_lower or "collega" in cmd_lower:
        if future_events:
            return JarvisResponses.gcal_export(future_events[0]["title"]), future_events[0]
        return "I canali di sincronizzazione con Google Calendar e smartphone sono pienamente operativi, Signore.", None

    # 10. Saluti e stato di sistema
    if any(k in cmd_lower for k in ["buongiorno", "buonasera", "ciao", "come stai", "chi sei", "stato sistemi"]):
        return JarvisResponses.boot_greeting(), None

    # 11. Eliminazione eventi
    if any(k in cmd_lower for k in ["elimina", "cancella", "rimuovi"]):
        clean_target = re.sub(r'elimina|cancella|rimuovi|evento|appuntamento|il|la|turno', '', cmd_lower).strip()
        if len(clean_target) >= 2:
            match = next((e for e in events if clean_target in (e.get("title") or "").lower()), None)
            if match:
                return f"Ho individuato {match['title']}, Signore. Può confermare l'eliminazione con un tocco dal pannello dettagli.", match
        return "Quale appuntamento desidera che rimuova dal suo calendario, Signore?", None

    # Default imperturbabile
    return JarvisResponses.unknown_query(), None



# =====================================================================
# PARTE 2: FILTRO AUDIO DSP OLOGRAFICO (High-Pass, Peaking, Micro-Delay, Norm)
# =====================================================================

def apply_jarvis_dsp(raw_samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """
    Applica la catena di post-produzione DSP per trasformare la voce neurale
    nel timbro distintivo, nitido e leggermente olografico di J.A.R.V.I.S.:

    1. High-Pass Filter @ 120 Hz: Taglia il calore eccessivo del petto umano.
    2. Peaking Band-Pass Boost @ 2000-4000 Hz (+35%): Aggiunge chiarezza metallica/HUD.
    3. Micro-Delay di 8 ms con mix wet del 28%: Introduce una sottile risonanza artificiale olografica.
    4. Normalizzazione di picco a 0.95: Livella uniformemente il volume.
    """
    # Converte in float32 bidimensionale [-1.0, 1.0]
    if raw_samples.dtype == np.int16:
        float_data = raw_samples.astype(np.float32) / 32768.0
    elif raw_samples.dtype == np.int32:
        float_data = raw_samples.astype(np.float32) / 2147483648.0
    else:
        float_data = raw_samples.astype(np.float32)

    # 1. High-Pass Filter a 120 Hz (Butterworth 2° ordine)
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


def synthesize_jarvis_speech(text: str, voice: str = DEFAULT_VOICE) -> Tuple[bytes, str]:
    """
    Funzione principale di generazione audio J.A.R.V.I.S.:
    1. Normalizza il testo secondo le regole di prosodia e cortesia J.A.R.V.I.S.
    2. Verifica la presenza di una copia in cache locale (risposta in 2ms).
    3. Altrimenti sintetizza con edge-tts (100% gratuito).
    4. Applica la catena DSP di post-produzione (filtro olografico).
    5. Restituisce (wav_bytes, cleaned_text).
    """
    _ensure_mixer()

    cleaned_text = JarvisFormatter.clean_for_tts(text)

    # Chiave hash per caching su disco
    cache_key = hashlib.sha256(f"{voice}_{PITCH}_{RATE}_{cleaned_text}".encode("utf-8")).hexdigest()
    cache_file = CACHE_DIR / f"jarvis_{cache_key}.wav"

    if cache_file.exists():
        try:
            return cache_file.read_bytes(), cleaned_text
        except Exception:
            pass

    # Genera audio grezzo da Edge TTS
    try:
        mp3_bytes = asyncio.run(_synthesize_edge_tts(cleaned_text, voice=voice))
    except Exception as e:
        logger.warning(f"Errore edge-tts con voce {voice}: {e}, tentativo fallback con {FALLBACK_VOICE}")
        mp3_bytes = asyncio.run(_synthesize_edge_tts(cleaned_text, voice=FALLBACK_VOICE))

    # Decodifica l'MP3 tramite pygame.mixer.Sound (senza ffmpeg esterno)
    temp_mp3 = CACHE_DIR / f"tmp_{cache_key}.mp3"
    try:
        temp_mp3.write_bytes(mp3_bytes)
        sound = pygame.mixer.Sound(str(temp_mp3))
        raw_samples = pygame.sndarray.array(sound)

        # Applica il DSP olografico Iron Man
        dsp_samples = apply_jarvis_dsp(raw_samples, sample_rate=SAMPLE_RATE)

        # Salva in formato WAV PCM standard
        wav_buffer = io.BytesIO()
        scipy.io.wavfile.write(wav_buffer, SAMPLE_RATE, dsp_samples)
        wav_bytes = wav_buffer.getvalue()

        # Scrive nella cache per utilizzi successivi
        try:
            cache_file.write_bytes(wav_bytes)
        except Exception:
            pass

        return wav_bytes, cleaned_text

    finally:
        if temp_mp3.exists():
            try:
                temp_mp3.unlink()
            except Exception:
                pass


# =====================================================================
# RIPRODUZIONE AUDIO ASINCRONA LOCALE (Non-blocking)
# =====================================================================

_current_sound: Optional[pygame.mixer.Sound] = None
_play_lock = threading.Lock()

def play_jarvis_speech(text: str, blocking: bool = False) -> str:
    """
    Sintetizza e riproduce la voce di J.A.R.V.I.S. con il filtro olografico
    direttamente sugli altoparlanti locali in modo asincrono.
    """
    global _current_sound
    _ensure_mixer()

    wav_bytes, cleaned_text = synthesize_jarvis_speech(text)

    def _play_worker():
        global _current_sound
        with _play_lock:
            try:
                if pygame.mixer.get_init():
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
    with _play_lock:
        if pygame.mixer.get_init():
            try:
                pygame.mixer.stop()
            except Exception:
                pass
