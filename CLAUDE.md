# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository contains **two implementations** of a bibliography converter that transforms bibliographic entries into Zotero-importable formats:

1. **Python Script** (`omeka_bib_to_zotero.py`) - Command-line utility
2. **Web Application** (`index.html`, `app.js`, `styles.css`) - Browser-based tool

Both implementations support:
- Web scraping from Omeka Classic websites
- Local file input (.txt, .docx for Python; .txt for web)
- Copy/paste text input (web only)
- LLM-powered parsing (OpenAI/OpenRouter)
- CSL-JSON and RIS output formats
- Author ditto mark expansion

**Key Files**:
- `omeka_bib_to_zotero.py` - Python implementation (27 KB)
- `index.html` - Web app HTML structure (22 KB)
- `app.js` - Web app JavaScript logic (35 KB)
- `styles.css` - Web app CSS styling (16 KB, CUNY blue theme)

**Default Test URL**: `https://italianamericanimprints.omeka.net/actual-bibliography` (1,088 entries)

## Common Commands

### Web Application (Browser-Based)

**Start local server**:
```bash
python -m http.server 8000
# or
python3 -m http.server 8000
```

**Access**: Open `http://localhost:8000` in browser

**No dependencies required** - runs entirely in browser

### Python Script (Command-Line)

**Dependencies**:
```bash
pip install requests beautifulsoup4 python-docx
```

**Interactive mode**:
```bash
python omeka_bib_to_zotero.py
```

**Basic usage**:
```bash
python omeka_bib_to_zotero.py --url https://italianamericanimprints.omeka.net/actual-bibliography --out output.json --format csljson
# Then select option 1 (No LLM) when prompted
```

### Basic usage from local file (no LLM)
```bash
# From text file
python omeka_bib_to_zotero.py --file bibliography.txt --out output.json

# From Word document
python omeka_bib_to_zotero.py --file bibliography.docx --out output.json
```

### With OpenAI LLM parsing
```bash
OPENAI_API_KEY=sk-... python omeka_bib_to_zotero.py --use-llm openai --model gpt-4o-mini --out output.json --format csljson
```

### With OpenRouter LLM parsing
```bash
OPENROUTER_API_KEY=... python omeka_bib_to_zotero.py --use-llm openrouter --model openrouter/anthropic/claude-3.5-sonnet --out output.json --format csljson
```

### Generate RIS format instead
```bash
python omeka_bib_to_zotero.py --format ris --out output.ris
```

### Test with limited entries
```bash
python omeka_bib_to_zotero.py --max 10 --out test.json
```

### Verify extraction correctness
```bash
python -c "
from omeka_bib_to_zotero import fetch_page_text, split_entries, expand_repeated_authors
raw = fetch_page_text('https://italianamericanimprints.omeka.net/actual-bibliography')
entries = split_entries(raw)
entries = expand_repeated_authors(entries)
print(f'Total: {len(entries)}')  # Should be 1088
print(f'First: {entries[0][:80]}...')  # Should start with 'Abbamonte, Salvatore. 1907...'
"
```

## Architecture

### Web Application Architecture

The web app is a **client-side only** JavaScript application with three main files:

#### `index.html` - UI Structure
- **Input options**: URL scraping, file upload (.txt only), or paste text
- **CORS proxy**: Checkbox to auto-prepend `https://corsproxy.io/?` to URLs
- **Model selection**: Dropdown with pre-configured models:
  - `openai/gpt-oss-120b` (Very Cheap - Default)
  - `google/gemini-2.5-flash`
  - `anthropic/claude-sonnet-4.5` (Best Quality)
  - `openai/gpt-4o`
  - `qwen/qwen3-235b-a22b-2507`
  - Custom model option
- **API key storage**: localStorage with security warnings
- **Test mode**: Checkbox to limit processing to 10 entries
- **Progress indicators**: Real-time updates and logging
- **Modal overlays**: CORS help and About sections
- **Footer**: Full-width with developer credits and GNU GPL v3 license

#### `styles.css` - CUNY Blue Theme
- **Color scheme**: `--primary-blue: #003DA5`, `--secondary-blue: #002D72`
- **Layout**: Full-width header/footer, centered 980px content
- **Components**: Styled buttons, inputs, radios, checkboxes, progress bars
- **Professional shadows**: sm (0 1px 2px), md (0 4px 6px), lg (0 10px 15px)
- **Responsive**: Mobile-friendly with media queries

#### `app.js` - Core Logic

**Entry Splitting (`splitEntries`)**:
- **Critical**: Detects format automatically:
  - If text contains `\n\n` (blank lines): splits on blank lines (Omeka format)
  - If no blank lines: splits on single newlines (pasted format)
- Normalizes whitespace and line endings
- Filters out navigation artifacts
- **Note**: This dual-format detection is essential for handling both web-scraped and pasted text

**LLM Integration**:
- **OpenRouter only** (browser environment)
- Uses `response_format: {"type": "json_object"}` for structured output
- **Important**: Models must support `response_format` parameter:
  - ✅ Works: GPT OSS 120B, Gemini 2.5 Flash, Claude Sonnet 4.5, GPT-4o, Qwen 3 235B
  - ❌ Removed: DeepSeek Chat v3 (doesn't support structured output)
- Batch size: 25 entries per request
- Retry logic: 3 attempts with exponential backoff
- Timeout: 180 seconds per request
- 1 second delay between batches to avoid rate limiting

**LLM Prompt Strategy**:
- System prompt emphasizes: "CRITICAL: Your response must be ONLY a JSON object starting with { and ending with }. NO commentary, NO explanations, NO analysis."
- User prompt requests `{"items": [...]}` format
- Handles Italian/English entries
- Maps authors/editors correctly
- Preserves year suffixes and handles uncertain dates

**localStorage API Key**:
- Saves key with user consent
- Clears on demand
- Security warnings about shared computers

**File Reading**:
- .txt files only (mammoth.js not included for .docx)
- Uses FileReader API

**Output Generation**:
- Creates CSL-JSON or RIS format
- Downloads via Blob URLs
- Generates `failed_entries.txt` for incomplete LLM responses

### Python Script Architecture

See full architecture details in sections 1-8 below (Web Scraping, Entry Splitting, Author Expansion, LLM Parsing, Prompts, Output Formats, File Reading). Key differences from web app:
- Supports both OpenAI and OpenRouter
- Reads .docx files (python-docx)
- Uses environment variables for API keys
- Command-line arguments and interactive prompts

## Critical Development Notes

### DO NOT Change Without Asking
1. **Default model**: Must be `openai/gpt-oss-120b` (very cheap)
2. **Model list**: User explicitly specified each model - ask before changing
3. **Styling**: Uses CUNY blue theme matching whisper-server-nml project
4. **License**: GNU GPL v3 (not Apache 2.0)
5. **Footer credits**: Developer name and GitHub link

### Common Issues

**Entry Splitting**:
- Web app uses dual-format detection (blank lines OR single newlines)
- Python uses triple-newline only
- When debugging: use `debug_split_test.html` to visualize newlines

**LLM Models Not Working**:
- Check if model supports `response_format: {"type": "json_object"}`
- Use curl to check OpenRouter API: `curl -s "https://openrouter.ai/api/v1/models" | python3 -c "import json, sys; models = json.load(sys.stdin)['data']; model = [m for m in models if 'MODEL_ID' in m['id']]; print(json.dumps(model[0]['supported_parameters'], indent=2))"`
- If `response_format` not in supported_parameters, model won't work reliably

**LLM Returning Commentary Instead of JSON**:
- Strengthen system prompt with "CRITICAL: NO commentary, NO explanations, NO analysis"
- Some models (like GPT OSS 120B) may still struggle - this is known behavior
- Users can switch to Claude Sonnet 4.5 or GPT-4o for better reliability

**CORS Errors**:
- Default checkbox auto-prepends `https://corsproxy.io/?` to URLs
- Users can uncheck if using CORS extension or running locally
- Modal overlay explains CORS and alternatives

## Repository Structure

```
biblio-zotero/
├── Web Application
│   ├── index.html                # Main UI (22 KB)
│   ├── app.js                    # JavaScript logic (35 KB)
│   ├── styles.css                # CUNY blue theme (16 KB)
│   ├── debug_split_test.html     # Entry splitting debugger
│   └── test_paste.txt            # Sample test data
│
├── Python Script
│   └── omeka_bib_to_zotero.py    # Command-line tool (27 KB)
│
├── Documentation
│   ├── CLAUDE.md                 # This file (developer guide)
│   ├── README.md                 # User documentation (Python)
│   ├── WEB_APP_README.md         # User documentation (Web)
│   ├── WEB_APP_ARCHITECTURE.md   # Technical architecture
│   ├── QUICK_START_WEB.md        # Web app quick start
│   ├── TEST_WEB_APP.md           # Testing guide
│   └── docs/                     # Development docs
│
├── Examples & Tests
│   ├── examples/test_bibliography.txt
│   └── tests/                    # Development test scripts
│
└── Configuration
    ├── .gitignore
    └── LICENSE                   # GNU GPL v3
```

## Testing

**Web App**:
```bash
# Start server
python3 -m http.server 8000

# Test with paste input using test_paste.txt
# Enable Test Mode checkbox to process only 10 entries
# Check browser console for debug output
```

**Python Script**:
```bash
# Test with limited entries
python omeka_bib_to_zotero.py --max 10 --out test.json

# Verify entry count (should be 1,088 from default URL)
python -c "from omeka_bib_to_zotero import fetch_page_text, split_entries; print(len(split_entries(fetch_page_text('https://italianamericanimprints.omeka.net/actual-bibliography'))))"
```

## Python Script Detailed Architecture

### 1. Web Scraping (`fetch_page_text`)
- Fetches HTML from Omeka page
- Locates "Bibliography" heading (h1/h2/h3)
- Extracts content after heading
- Falls back to full extraction if structured extraction fails

### 2. Entry Splitting (`split_entries`)
- Splits on triple-newline separators
- Normalizes whitespace and line endings
- Filters navigation artifacts
- **Critical**: Must produce exactly 1,088 entries from default URL

### 3. Author Expansion (`expand_repeated_authors`)
- Handles ditto marks (underscores, em-dashes)
- Three regex patterns to extract author names
- **Critical**: Must NOT accumulate years

### 4. LLM Parsing (`batch_parse_with_llm`)
- Batch size: 25 entries
- Supports OpenAI and OpenRouter
- Retry logic: 3 attempts, exponential backoff
- Timeout: 180 seconds
- 1 second delay between batches

### 5. Output Formats
- **CSL-JSON** (`write_csl_json`): Native Zotero format
- **RIS** (`write_ris`): Alternative format with type mapping

### 6. File Reading (`read_local_file`)
- .txt: UTF-8 text files
- .docx: Word documents (requires python-docx)

### 7. Interactive Prompts
- Input source, format, LLM provider, model, API key
- Checks environment variables first
- Sensible defaults provided
