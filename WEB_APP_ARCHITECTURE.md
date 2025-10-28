# Web Application Architecture

This document provides a visual overview of the web application's architecture and data flow.

## File Structure

```
biblio-zotero/
│
├── Web Application (NEW)
│   ├── index.html              # Main application (14 KB)
│   ├── styles.css              # Styling (8.4 KB)
│   └── app.js                  # Core logic (31 KB)
│
├── Documentation (NEW)
│   ├── WEB_APP_README.md       # Complete guide (12 KB)
│   ├── QUICK_START_WEB.md      # Quick start (6.6 KB)
│   ├── TEST_WEB_APP.md         # Testing guide (12 KB)
│   ├── PYTHON_VS_WEB_COMPARISON.md  # Comparison (11 KB)
│   ├── WEB_APP_SUMMARY.md      # Summary (12 KB)
│   └── WEB_APP_ARCHITECTURE.md # This file
│
├── Original Python Script
│   ├── omeka_bib_to_zotero.py  # Python implementation (27 KB)
│   ├── CLAUDE.md               # Technical docs (12 KB)
│   └── README.md               # Project overview (8.3 KB)
│
├── Examples
│   └── examples/
│       └── test_bibliography.txt  # Sample data
│
└── Configuration
    ├── .gitignore              # Git ignore rules
    └── LICENSE                 # Apache 2.0
```

## Application Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         WEB BROWSER                              │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                      index.html                             │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │           User Interface Components                   │  │ │
│  │  │  • Input source selection (URL/File)                  │  │ │
│  │  │  • Output format selection (CSL-JSON/RIS)            │  │ │
│  │  │  • LLM configuration (OpenAI/OpenRouter)             │  │ │
│  │  │  • Progress indicators                                │  │ │
│  │  │  • Log viewer                                         │  │ │
│  │  │  • Results display                                    │  │ │
│  │  │  • Download buttons                                   │  │ │
│  │  │  • CORS solutions guide                              │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  │                           ↕                                  │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │                   styles.css                          │  │ │
│  │  │  • Layout and responsive design                       │  │ │
│  │  │  • Visual styling                                     │  │ │
│  │  │  • Animations                                         │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  │                           ↕                                  │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │                     app.js                            │  │ │
│  │  │                                                        │  │ │
│  │  │  ┌─────────────────────────────────────────────────┐ │  │ │
│  │  │  │          Input Processing Layer                  │ │  │ │
│  │  │  │  • fetchPageText() - Web scraping               │ │  │ │
│  │  │  │  • readLocalFile() - File reading               │ │  │ │
│  │  │  │  • readTextFile() - .txt handler                │ │  │ │
│  │  │  │  • readDocxFile() - .docx handler (mammoth.js) │ │  │ │
│  │  │  └─────────────────────────────────────────────────┘ │  │ │
│  │  │                         ↓                              │  │ │
│  │  │  ┌─────────────────────────────────────────────────┐ │  │ │
│  │  │  │        Entry Processing Layer                    │ │  │ │
│  │  │  │  • splitEntries() - Entry separation            │ │  │ │
│  │  │  │  • expandRepeatedAuthors() - Ditto expansion    │ │  │ │
│  │  │  └─────────────────────────────────────────────────┘ │  │ │
│  │  │                         ↓                              │  │ │
│  │  │  ┌─────────────────────────────────────────────────┐ │  │ │
│  │  │  │          LLM Integration Layer                   │ │  │ │
│  │  │  │  • batchParseWithLLM() - Batch orchestrator     │ │  │ │
│  │  │  │  • callOpenAIChat() - OpenAI API               │ │  │ │
│  │  │  │  • callOpenRouterChat() - OpenRouter API       │ │  │ │
│  │  │  │  • Retry logic with exponential backoff         │ │  │ │
│  │  │  └─────────────────────────────────────────────────┘ │  │ │
│  │  │                         ↓                              │  │ │
│  │  │  ┌─────────────────────────────────────────────────┐ │  │ │
│  │  │  │          Output Generation Layer                 │ │  │ │
│  │  │  │  • createCSLJSON() - CSL-JSON formatter         │ │  │ │
│  │  │  │  • createRIS() - RIS formatter                  │ │  │ │
│  │  │  │  • cslToRISRecord() - Format conversion         │ │  │ │
│  │  │  │  • createFailedEntriesText() - Failure report   │ │  │ │
│  │  │  │  • downloadFile() - Browser download            │ │  │ │
│  │  │  └─────────────────────────────────────────────────┘ │  │ │
│  │  │                         ↓                              │  │ │
│  │  │  ┌─────────────────────────────────────────────────┐ │  │ │
│  │  │  │              UI Management Layer                 │ │  │ │
│  │  │  │  • initializeUI() - Event handlers              │ │  │ │
│  │  │  │  • updateProgress() - Progress bar              │ │  │ │
│  │  │  │  • addLog() - Log entries                       │ │  │ │
│  │  │  │  • showResults() - Results display              │ │  │ │
│  │  │  └─────────────────────────────────────────────────┘ │  │ │
│  │  │                                                        │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                               ↕
                    External Dependencies
                               ↕
        ┌─────────────────────────────────────┐
        │  mammoth.js (CDN)                   │
        │  • DOCX parsing library              │
        │  • Loaded from jsdelivr.net         │
        └─────────────────────────────────────┘
                               ↕
        ┌─────────────────────────────────────┐
        │  External APIs (Optional)            │
        │  • OpenAI API                        │
        │  • OpenRouter API                    │
        │  • CORS Proxy (if needed)           │
        └─────────────────────────────────────┘
```

## Data Flow Diagram

```
┌─────────────┐
│   USER      │
│  INPUT      │
└──────┬──────┘
       │
       ├──────────────────────────┬────────────────────────┐
       │                          │                        │
       ▼                          ▼                        ▼
┌─────────────┐         ┌──────────────┐        ┌──────────────┐
│     URL     │         │  .txt FILE   │        │ .docx FILE   │
└──────┬──────┘         └──────┬───────┘        └──────┬───────┘
       │                       │                        │
       │ fetch()               │ FileReader             │ FileReader
       │                       │                        │ + mammoth.js
       ▼                       ▼                        │
┌─────────────┐         ┌──────────────┐               │
│ HTML Page   │         │  Text Data   │◄──────────────┘
└──────┬──────┘         └──────┬───────┘
       │                       │
       │ DOMParser             │
       │                       │
       ▼                       │
┌─────────────┐               │
│  Text Data  │───────────────┘
└──────┬──────┘
       │
       │ splitEntries()
       ▼
┌─────────────┐
│  Raw        │
│  Entries    │ (Array of strings)
└──────┬──────┘
       │
       │ expandRepeatedAuthors()
       ▼
┌─────────────┐
│  Processed  │
│  Entries    │ (Ditto marks expanded)
└──────┬──────┘
       │
       ├──────────────────────────┬────────────────────────┐
       │                          │                        │
       ▼                          ▼                        ▼
┌─────────────┐         ┌──────────────┐        ┌──────────────┐
│  No LLM     │         │  OpenAI      │        │ OpenRouter   │
│             │         │  API         │        │ API          │
└──────┬──────┘         └──────┬───────┘        └──────┬───────┘
       │                       │                        │
       │ Create stubs          │ Batch + Parse          │ Batch + Parse
       │                       │                        │
       │                       ▼                        │
       │              ┌──────────────┐                  │
       │              │  Batch 1     │                  │
       │              │  (25 entries)│                  │
       │              └──────┬───────┘                  │
       │                     │                          │
       │                     │ LLM_SYSTEM_PROMPT        │
       │                     │ LLM_USER_TEMPLATE        │
       │                     │                          │
       │                     ▼                          │
       │              ┌──────────────┐                  │
       │              │  Retry Loop  │                  │
       │              │  (max 3x)    │                  │
       │              │  2s, 4s, 8s  │                  │
       │              └──────┬───────┘                  │
       │                     │                          │
       │                     ▼                          │
       │              ┌──────────────┐                  │
       │              │ Parsed JSON  │                  │
       │              │  {"items"}   │                  │
       │              └──────┬───────┘                  │
       │                     │                          │
       │              ┌──────▼───────┐                  │
       │              │  More        │                  │
       │              │  batches...  │                  │
       │              └──────┬───────┘                  │
       │                     │                          │
       │                     │ 1s delay between batches │
       │                     │                          │
       └─────────────────────┴──────────────────────────┘
                             │
                             ▼
                    ┌──────────────┐
                    │  CSL-JSON    │
                    │  Items       │ (Array of objects)
                    └──────┬───────┘
                           │
       ┌───────────────────┴───────────────────┐
       │                                       │
       ▼                                       ▼
┌─────────────┐                      ┌──────────────┐
│  CSL-JSON   │                      │  RIS Format  │
│  Format     │                      │              │
└──────┬──────┘                      └──────┬───────┘
       │                                     │
       │ JSON.stringify()                    │ cslToRISRecord()
       │                                     │
       ▼                                     ▼
┌─────────────┐                      ┌──────────────┐
│ .json File  │                      │  .ris File   │
└──────┬──────┘                      └──────┬───────┘
       │                                     │
       └─────────────────┬───────────────────┘
                         │
                         │ Blob + URL.createObjectURL
                         ▼
                  ┌──────────────┐
                  │  Browser     │
                  │  Download    │
                  └──────────────┘
```

## Component Interaction Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                        User Interface (index.html)              │
│                                                                  │
│  [Input Source: URL/File] → [Output Format: JSON/RIS]          │
│             ↓                         ↓                          │
│  [LLM Provider: None/OpenAI/OpenRouter] → [Process Button]     │
│                                                                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ onclick → processEntries()
                           ▼
┌────────────────────────────────────────────────────────────────┐
│                    State Management (app.js)                    │
│                                                                  │
│  state = {                                                       │
│    entries: [],              // Raw bibliographic entries       │
│    parsedItems: [],          // Structured CSL-JSON items       │
│    failedEntries: [],        // Failed to parse entries         │
│    outputFormat: 'csljson',  // Selected format                 │
│    outputFilename: '...'     // Output file name                │
│  }                                                               │
│                                                                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│                   Processing Pipeline (app.js)                  │
│                                                                  │
│  1. Input Acquisition                                           │
│     ├─ fetchPageText() ────────────► fetch() API                │
│     └─ readLocalFile() ────────────► FileReader API             │
│                                                                  │
│  2. Text Processing                                             │
│     ├─ splitEntries() ──────────────► regex: /\n\n\n+/          │
│     └─ expandRepeatedAuthors() ─────► regex patterns x3         │
│                                                                  │
│  3. LLM Integration (Optional)                                  │
│     └─ batchParseWithLLM()                                      │
│        ├─ Batch entries (25 per call)                           │
│        ├─ callOpenAIChat() ──────────► OpenAI API               │
│        ├─ callOpenRouterChat() ──────► OpenRouter API           │
│        ├─ Retry logic (3x, exponential backoff)                 │
│        └─ Parse JSON response                                   │
│                                                                  │
│  4. Output Generation                                           │
│     ├─ createCSLJSON() ──────────────► JSON.stringify()         │
│     ├─ createRIS() ───────────────────► cslToRISRecord()        │
│     └─ createFailedEntriesText() ─────► formatted text          │
│                                                                  │
│  5. Download                                                    │
│     └─ downloadFile() ────────────────► Blob + URL API          │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

## Error Handling Flow

```
┌─────────────┐
│   Error     │
│  Occurs     │
└──────┬──────┘
       │
       ├────────────────┬────────────────┬────────────────┐
       │                │                │                │
       ▼                ▼                ▼                ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ CORS Error  │  │ API Error   │  │ Network Err │  │ Parse Error │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │                │
       │                ▼                ▼                │
       │         ┌─────────────┐  ┌─────────────┐        │
       │         │ Status 401  │  │ Timeout     │        │
       │         │ Status 429  │  │ Connection  │        │
       │         └──────┬──────┘  └──────┬──────┘        │
       │                │                │                │
       │                ▼                ▼                │
       │         ┌─────────────┐  ┌─────────────┐        │
       │         │ Retry?      │  │ Retry?      │        │
       │         │ (Yes: 3x)   │  │ (Yes: 3x)   │        │
       │         └──────┬──────┘  └──────┬──────┘        │
       │                │                │                │
       └────────────────┴────────────────┴────────────────┘
                                  │
                                  ▼
                        ┌──────────────────┐
                        │ Error Handling   │
                        │  • addLog()      │
                        │  • alert()       │
                        │  • Stub records  │
                        │  • Failed list   │
                        └──────────────────┘
```

## Performance Optimization Points

```
1. Entry Splitting
   └─ Optimized regex: /\n\n\n+/ (single pass)

2. Author Expansion
   └─ Single-pass algorithm (O(n) complexity)

3. LLM Batching
   ├─ Batch size: 25 (configurable)
   ├─ Parallel processing within batch
   └─ 1s delay between batches (rate limit prevention)

4. Retry Logic
   ├─ Exponential backoff: 2s → 4s → 8s
   ├─ Max 3 attempts per batch
   └─ Timeout: 180s per request

5. Output Generation
   ├─ In-memory processing (no intermediate files)
   ├─ Streaming JSON generation
   └─ Blob API for efficient downloads

6. UI Updates
   ├─ Batch progress updates (not per-entry)
   ├─ Debounced log updates
   └─ CSS animations (GPU-accelerated)
```

## Security Considerations

```
┌────────────────────────────────────────────────────────────────┐
│                      Security Measures                          │
│                                                                  │
│  1. API Key Handling                                            │
│     ├─ Stored only in memory (JavaScript variables)            │
│     ├─ Never written to localStorage or disk                    │
│     ├─ Cleared on page unload                                   │
│     └─ User responsibility for secure entry                     │
│                                                                  │
│  2. Input Validation                                            │
│     ├─ File type checking (.txt, .docx only)                    │
│     ├─ URL validation (basic format check)                      │
│     └─ Entry filtering (removes navigation artifacts)           │
│                                                                  │
│  3. CORS Handling                                               │
│     ├─ User informed about CORS restrictions                    │
│     ├─ Proxy usage documented with security notes               │
│     └─ Alternative manual methods provided                      │
│                                                                  │
│  4. Output Sanitization                                         │
│     ├─ No user input directly in HTML (XSS prevention)          │
│     ├─ JSON.stringify() for safe serialization                  │
│     └─ Blob API for secure downloads                            │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

## Browser Compatibility Matrix

```
Feature                  Chrome  Firefox  Safari  Edge
──────────────────────────────────────────────────────
ES6+ JavaScript          ✅      ✅       ✅      ✅
Fetch API                ✅      ✅       ✅      ✅
FileReader API           ✅      ✅       ✅      ✅
DOMParser                ✅      ✅       ✅      ✅
Blob API                 ✅      ✅       ✅      ✅
URL.createObjectURL      ✅      ✅       ✅      ✅
Async/Await              ✅      ✅       ✅      ✅
Arrow Functions          ✅      ✅       ✅      ✅
Template Literals        ✅      ✅       ✅      ✅
Destructuring            ✅      ✅       ✅      ✅
Promises                 ✅      ✅       ✅      ✅
AbortController          ✅      ✅       ✅      ✅
──────────────────────────────────────────────────────
Minimum Version          90+     88+      14+     90+
```

## Deployment Scenarios

```
┌────────────────────────────────────────────────────────────────┐
│                     Deployment Options                          │
│                                                                  │
│  1. Local Use (File System)                                     │
│     └─ Double-click index.html → opens in browser               │
│                                                                  │
│  2. Local Server                                                │
│     ├─ python -m http.server 8000                               │
│     ├─ npx http-server                                          │
│     └─ php -S localhost:8000                                    │
│                                                                  │
│  3. Static Hosting (Cloud)                                      │
│     ├─ GitHub Pages (free)                                      │
│     ├─ Netlify (free, drag-and-drop)                            │
│     ├─ Vercel (free, git integration)                           │
│     └─ AWS S3 + CloudFront                                      │
│                                                                  │
│  4. CDN Distribution                                            │
│     └─ Host files on CDN, share URL globally                    │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```

## Maintenance & Updates

```
Development Workflow:
┌─────────────┐
│ Edit Files  │ (HTML/CSS/JS in any text editor)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Refresh     │ (F5 in browser)
│ Browser     │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Test        │ (Use TEST_WEB_APP.md test cases)
│ Changes     │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Commit to   │ (git add, commit, push)
│ Git         │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Deploy      │ (automatic with GitHub Pages, etc.)
└─────────────┘
```

## Future Enhancement Opportunities

```
1. Offline Support
   └─ Service Worker for offline functionality

2. Session Persistence
   └─ IndexedDB for saving work in progress

3. Backend Integration
   ├─ Node.js proxy server (CORS solution)
   ├─ Backend LLM processing (hide API keys)
   └─ User authentication (saved configurations)

4. Additional Features
   ├─ BibTeX export format
   ├─ EndNote XML format
   ├─ Batch file processing
   ├─ Entry editing interface
   ├─ Zotero API integration (direct import)
   └─ Collaborative features (shared bibliographies)

5. Performance Enhancements
   ├─ WebAssembly for text processing
   ├─ Web Workers for background processing
   └─ Streaming LLM responses

6. UI Improvements
   ├─ Dark mode
   ├─ Accessibility enhancements (ARIA, screen readers)
   ├─ Internationalization (i18n)
   └─ Custom themes
```

---

This architecture provides a solid foundation for the web application while maintaining feature parity with the Python script. The modular design allows for easy maintenance and future enhancements.
