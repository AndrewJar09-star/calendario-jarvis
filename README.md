# S.T.E.W.A.R.D. OS — J.A.R.V.I.S. Autonomous Edition

[![Python Version](https://img.shields.io/badge/Python-3.11%20%7C%203.12-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Edge TTS](https://img.shields.io/badge/Edge--TTS-Neural-0078D7?style=for-the-badge&logo=microsoft&logoColor=white)](https://github.com/rany2/edge-tts)
[![FullCalendar](https://img.shields.io/badge/FullCalendar-v6-337ab7?style=for-the-badge&logo=javascript&logoColor=white)](https://fullcalendar.io/)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

> **S.T.E.W.A.R.D. OS** (*Smart Task & Event Workflow Automation for Readiness & Dispatching*) is a production-grade, zero-cost operational management system and tactical calendar designed for stadium stewards and event safety operators. Powered by an autonomous, voice-driven **J.A.R.V.I.S. AI assistant** featuring neural Italian speech synthesis and custom digital signal processing (DSP) holographic filters.

---

## 📑 Table of Contents
- [1. Executive Overview & Problem Statement](#1-executive-overview--problem-statement)
- [2. System Architecture & Engineering Decisions](#2-system-architecture--technical-decisions)
  - [Architectural Topology](#architectural-topology)
  - [Data Model & Business Rule Automation](#data-model--business-rule-automation)
  - [Resilient Multi-Source Scraping & Fallback Seeding](#resilient-multi-source-scraping--fallback-seeding)
  - [J.A.R.V.I.S. Conversational NLP & Holographic Audio DSP](#jarvis-conversational-nlp--holographic-audio-dsp)
  - [Cloud Interoperability & 24/7 Google Calendar Sync](#cloud-interoperability--247-google-calendar-sync)
  - [Progressive Web App (PWA) & Stark HUD Frontend](#progressive-web-app-pwa--stark-hud-frontend)
- [3. Complete Tech Stack](#3-complete-tech-stack)
- [4. Getting Started & Installation](#4-getting-started--installation)
  - [Prerequisites](#prerequisites)
  - [Local Installation](#local-installation)
  - [Execution Methods](#execution-methods)
  - [Mobile Network Access](#mobile-network-access)
  - [Cloud Deployment (Render / Railway)](#cloud-deployment-render--railway)
- [5. API Documentation](#5-api-documentation)
- [6. Author & Academic Credits](#6-author--academic-credits)

---

## 1. Executive Overview & Problem Statement

Field stewards and security professionals working across major sports arenas and exhibition venues face critical logistical hurdles:
1. **Kickoff vs. Call-Time Discrepancy:** Shift gates open hours prior to the official event start. In professional football, stewards must report exactly **4 hours before kickoff** (e.g., 20:45 match requires a 16:45 on-site call time). Missing this distinction leads to severe operational delays.
2. **Dynamic League Rescheduling:** TV broadcast demands frequently shift fixtures across Fridays, Saturdays, Sundays, and Mondays with short notice.
3. **Multi-Venue Overlaps & Schedule Conflicts:** Operators managing shifts across diverse stadiums (e.g., *Stadio Diego Armando Maradona*, *Stadio Romeo Menti*, *Stadio Alberto Pinto*) and trade fairs (*Mostra d'Oltremare*) frequently encounter date collisions.
4. **Compensation & Shift Financial Tracking:** Lack of unified tracking for agreed hourly/shift compensation creates bookkeeping friction.
5. **View Noise vs. Shift Archival:** Operators need to decline shifts without permanently deleting prospective records.

**S.T.E.W.A.R.D. OS** resolves these challenges through an automated, event-driven architecture that ingests schedules, calculates reporting deadlines, detects collisions, tracks net earnings, synchronizes bi-directionally with mobile calendar engines, and interfaces via an offline-capable, Stark Industries-inspired HUD with voice intelligence.

---

## 2. System Architecture & Technical Decisions

### Architectural Topology

```
+-------------------------------------------------------------------------+
|                           CLIENT TIER                                   |
|   +------------------------------------+  +-------------------------+   |
|   |   Vanilla ES6+ Client Engine       |  |   PWA Service Worker    |   |
|   |   - FullCalendar v6 DOM Hooks      |  |   - Offline Asset Cache |   |
|   |   - Web Speech Recognition API     |  |   - Mobile Standalone   |   |
|   |   - Stark Cyberpunk HUD (CSS3)     |  +-------------------------+   |
|   +------------------^-----------------+                            |
+----------------------|--------------------------------------------------+
                       | HTTP / REST API (JSON) + Audio Streams (WAV/MP3)
+----------------------v--------------------------------------------------+
|                           SERVER TIER (FastAPI)                         |
|   +------------------------------------+  +-------------------------+   |
|   |   RESTful Routing & Endpoints      |  |  APScheduler (6h Cron)  |   |
|   |   - CRUD Operations (/api/events)  |  |  - Async Web Scraper    |   |
|   |   - RFC 5545 Feed (/calendar.ics)  |  +------------+------------+   |
|   +------------------+-----------------+               |                |
|                      |                                 |                |
|   +------------------v-----------------+  +------------v------------+   |
|   |   J.A.R.V.I.S. Core Engine         |  |   Scraper & Ingestion   |   |
|   |   - Token/Regex Fuzzy NLP Parser   |  |   - BeautifulSoup4      |   |
|   |   - Neural Edge-TTS Integration    |  |   - Resilient Seed Data |   |
|   |   - SciPy/NumPy 4-Stage Audio DSP  |  +------------+------------+   |
|   |   - MD5 Disk Audio LRU Cache       |               |                |
|   +------------------+-----------------+               |                |
+----------------------|---------------------------------|----------------+
                       |                                 |
+----------------------v---------------------------------v----------------+
|                           DATA PERSISTENCE TIER                         |
|   +-----------------------------------------------------------------+   |
|   |   SQLite Embedded Database (steward.db)                         |   |
|   |   - Schema: Indexed `event_start`, Concurrency-Safe WAL Mode     |   |
|   |   - Business Calculus: 4h Football Lead Time / 08:30 Fair Rule   |   |
|   +-----------------------------------------------------------------+   |
+-------------------------------------------------------------------------+
```

### Data Model & Business Rule Automation
The persistence layer relies on an embedded SQLite database (`steward.db`), chosen to ensure self-contained, zero-configuration local deployment without external DBMS daemon overhead:
* **Automated Call-Time Resolution:**
  $$\text{CallTime}_{\text{CALCIO}} = \text{EventStart} - 4\,\text{hours}$$
  $$\text{CallTime}_{\text{FIERA}} = \text{Date}(\text{EventStart}) + 08:30\,\text{AM}$$
* **Multi-Event Safe Insertion (`force_insert`):** Guarantees that personal appointments and concurrent shifts on the same calendar day co-exist without accidental overwriting.
* **Conflict & Update Detection Engine:** Performs programmatic boundary analysis across the event timeline to flag co-occurring shifts (`conflict: true`) in alert dashboards and track rescheduling deltas (`updated_flag: 1`).
* **Financial Ledger Integration:** Each shift entity maintains nullable floating-point compensation fields (`earnings`), feeding the frontend summary aggregators.

### Resilient Multi-Source Scraping & Fallback Seeding
The data ingestion module (`scraper.py`) continuously tracks official schedules across primary regional sports venues:
* **Target Venues:**
  * *Stadio Diego Armando Maradona* (SSC Napoli — Serie A, Champions League, Coppa Italia)
  * *Stadio Romeo Menti* (SS Juve Stabia — Serie B)
  * *Stadio Alberto Pinto* (Casertana FC — Serie C)
  * *Mostra d'Oltremare* (Naples International Fairgrounds & Exhibition Center)
* **High-Resilience Fallback (`seed_initial_data`):** To counter network timeouts, ISP blocks, or upstream web anti-scraping measures, the system embeds an immutable structured seed catalog. If live HTTP parsing fails or returns zero matches on cold start, the database transparently seeds with verified scheduled fixtures, preventing cold-start application failure.
* **Background Scheduling:** Handled in-process via `APScheduler` on a non-blocking daemon thread firing every 6 hours with a 1-hour misfire grace threshold.

### J.A.R.V.I.S. Conversational NLP & Holographic Audio DSP
The conversational engine (`jarvis_voice.py`) operates fully offline-first without requiring commercial API keys (OpenAI, ElevenLabs, etc.):
1. **Rule-Based & Fuzzy Italian NLP Parser:** Extracts dates (absolute, relative like *"domani"*, *"dopodomani"*, day-of-month), precise times, monetary figures (*"paga 50 euro"*), shift status modifications, and clitic commands via optimized regular expressions and token matching.
2. **Neural TTS Pipeline:** Leverages Microsoft Edge Neural Speech synthesis (`it-IT-DiegoNeural`) tuned with subtle prosodic adjustments (`pitch="-1Hz"`, `rate="+1%"`) to reproduce the composed, courteous cadence of a classic British butler.
3. **Custom Digital Signal Processing (DSP) Audio Chain:** Rather than outputting dry synthetic speech, raw PCM samples (44.1 kHz, 16-bit) pass through a 4-stage post-production pipeline built on `scipy.signal` and `numpy`:
   * **Stage 1 (High-Pass Butterworth Filter):** 2nd-order high-pass at $80\text{ Hz}$ to eliminate sub-bass rumble while preserving baritone warmth.
   * **Stage 2 (Presence Equalization Bandpass):** Peaking boost between $2500\text{ Hz} - 4500\text{ Hz}$ with $+12\%$ gain to inject metallic, holographic clarity.
   * **Stage 3 (Micro-Delay Comb Spatializer):** $6.5\text{ ms}$ delay buffer mixed at $10\%$ wet to emulate acoustic reflections inside an Iron Man helmet HUD.
   * **Stage 4 (Peak Normalization):** Headroom leveling capped at $0.95$ ($-0.45\text{ dBFS}$) to prevent digital clipping across speakers.
4. **Deterministic Audio Cache:** Audio artifacts are hashed (MD5) and saved to `static/audio_cache/`. A background pre-warming thread compiles standard system utterances during boot for instant zero-latency responses.

### Cloud Interoperability & 24/7 Google Calendar Sync
To ensure schedule synchronization when the host machine is powered off:
* **RFC 5545 Feed (`/api/calendar.ics`):** Exposes standard iCalendar payloads readable by iOS Calendar, Android, and Microsoft Outlook.
* **Autonomous Google Apps Script Engine (`google_calendar_sync.gs`):** Runs on Google's cloud serverless runtime. Driven by a cloud-side time-based trigger executing every 6 hours, it polls the S.T.E.W.A.R.D. OS API or executes autonomous cloud scraping if the local machine is offline, syncing changes directly into a dedicated Google Calendar with configurable 60-minute pre-call notifications.

### Progressive Web App (PWA) & Stark HUD Frontend
* **Zero Framework Overhead:** Implemented in standard Vanilla JavaScript (ES6+), HTML5, and pure CSS3, eliminating multi-megabyte bundle footprints and build pipeline fragility.
* **FullCalendar v6 Integration:** Tailored custom view rendering event call-times, status badges, earnings markers, and real-time conflict highlights.
* **Progressive Web App Compliance:** Equipped with `manifest.json` and a custom Service Worker (`sw.js`) implementing a Network-First strategy with stale-while-revalidate fallback for seamless mobile home screen installation.

---

## 3. Complete Tech Stack

| Domain | Technology / Library | Version / Spec | Purpose |
| :--- | :--- | :--- | :--- |
| **Backend Core** | [Python](https://www.python.org/) | 3.11 / 3.12 | Core backend runtime and computational logic |
| **API Framework** | [FastAPI](https://fastapi.tiangolo.com/) | $\ge 0.115$ | High-performance asynchronous REST endpoints |
| **ASGI Server** | [Uvicorn](https://www.uvicorn.org/) | Latest | Lightning-fast ASGI production web server |
| **Database** | [SQLite](https://www.sqlite.org/) | 3.x (Built-in) | Embedded transactional ACID persistence |
| **Task Scheduler** | [APScheduler](https://apscheduler.readthedocs.io/) | 3.x | Asynchronous cron worker for periodic syncs |
| **Web Ingestion** | [Requests](https://requests.readthedocs.io/) & [BeautifulSoup4](https://www.crummy.com/software/BeautifulSoup/) | $\ge 4.12$ | HTML parsing, DOM traversal, and HTTP extraction |
| **Speech Engine** | [Edge-TTS](https://github.com/rany2/edge-tts) | $\ge 7.0.0$ | Free high-fidelity Microsoft neural voice synthesis |
| **Audio DSP** | [NumPy](https://numpy.org/) & [SciPy](https://scipy.org/) | $\ge 2.0.0$ / $\ge 1.14.0$ | Waveform filtering, comb delay, FFT & audio math |
| **Frontend UI** | Vanilla HTML5, CSS3, JavaScript ES6+ | Modern Web Standards | Cyberpunk Stark HUD, Glassmorphism, Zero-bundle UI |
| **Calendar Engine**| [FullCalendar](https://fullcalendar.io/) | v6 | Interactive event matrix and schedule visualization |
| **Calendar Standard**| RFC 5545 (iCalendar) | Standard Specification | Cross-platform calendar feed syndication |
| **Cloud Automation**| Google Apps Script (V8) | Cloud Runtime | 24/7 cloud sync to Google Calendar with PC off |
| **PWA Layer** | Service Worker API | Cache API / Manifest | Offline asset availability and mobile standalone mode |

---

## 4. Getting Started & Installation

### Prerequisites
* **Python 3.11+** installed on the system path ([python.org](https://www.python.org/downloads/)).
* Git version control ([git-scm.com](https://git-scm.com/)).
* Modern web browser with Web Speech API support (Google Chrome, Microsoft Edge, Safari).

### Local Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/AndrewJar09-star/calendario-jarvis.git
   cd calendario-jarvis
   ```

2. **Initialize a virtual environment (recommended):**
   ```bash
   # Windows
   python -m venv venv
   .\venv\Scripts\activate

   # Linux / macOS
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

### Execution Methods

#### Method A: Instant Launcher (Windows)
Double-click `avvia.bat` located in the root directory. This automated script validates the Python runtime, boots Uvicorn on port `8000`, and opens the default browser automatically.

#### Method B: Manual CLI Execution
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Once initialized, navigate to:
```
http://localhost:8000
```

### Mobile Network Access
To interact with S.T.E.W.A.R.D. OS on an iPhone, iPad, or Android phone within the same local network:
1. Identify your workstation's local IPv4 address (e.g., via `ipconfig` on Windows or `ifconfig`/`ip a` on Unix):
   ```text
   IPv4 Address: 192.168.1.50
   ```
2. Navigate on your mobile browser to: `http://192.168.1.50:8000`
3. Tap **"Add to Home Screen"** in the mobile browser menu to run the software as a full-screen, native-feeling PWA.

### Cloud Deployment (Render / Railway)
The repository contains native deployment blueprints:
* **Render:** A declarative [`render.yaml`](render.yaml) is included. Connect the repository to Render, which automatically configures the Python web service, installs dependencies, and maps the internal `$PORT`.
* **Procfile:** A [`Procfile`](Procfile) is provided for immediate compatibility with Heroku, Railway, or Dokku:
  ```text
  web: uvicorn main:app --host 0.0.0.0 --port $PORT
  ```

---

## 5. API Documentation

When the server is running, interactive Swagger/OpenAPI documentation is available at `/docs` or `/redoc`.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/events` | Retrieves all scheduled events with computed call times and conflict flags |
| `POST` | `/api/events` | Creates a new shift/event with automatic 4h call-time calculation |
| `POST` | `/api/events/{id}/status` | Updates shift state (`Lavoro io`, `Riposo`, `Da confermare`) |
| `POST` | `/api/events/{id}/earnings` | Sets or modifies the agreed shift compensation in EUR |
| `DELETE`| `/api/events/{id}` | Deletes an event from the persistence layer |
| `POST` | `/api/events/resync` | Forces an immediate web scraping and schedule refresh cycle |
| `GET` | `/api/alerts` | Fetches active scheduling conflicts and fixture time modifications |
| `GET` | `/api/calendar.ics` | Dynamic RFC 5545 iCalendar feed for external calendar clients |
| `POST` | `/api/jarvis/command` | Natural Language endpoint processing speech text, intents, and voice actions |
| `GET` | `/api/jarvis/voice-test` | Emits a sample holographic speech stream for audio verification |
| `POST` | `/api/jarvis/stop-voice` | Terminate any ongoing local voice reproduction |

---

## 6. Author & Academic Credits

**Author:** Andrea Barattolo  
**Affiliation:** Università degli Studi di Napoli Federico II (UniNa)  
**GitHub:** [@AndrewJar09-star](https://github.com/AndrewJar09-star)  
**Contact:** [andrewjar04@gmail.com](mailto:andrewjar04@gmail.com)

Designed and engineered with a focus on high software resilience, zero-cost operational overhead, and modern human-machine interface design.

---

*Part of the S.T.E.W.A.R.D. OS Project &copy; 2026. All rights reserved.*

