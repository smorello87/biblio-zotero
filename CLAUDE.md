# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Two implementations of a bibliography converter for Zotero-importable formats:
- **Python Script** (`omeka_bib_to_zotero.py`) - CLI with OpenAI/OpenRouter support
- **Web App** (`index.html`, `app.js`, `styles.css`) - Browser-based, OpenRouter only

Both support: Omeka web scraping, local files (.txt/.docx/.pdf), LLM parsing, CSL-JSON/RIS output, author ditto expansion, Vision OCR for PDFs, ISBN/OCLC enrichment.

**Test URL**: `https://italianamericanimprints.omeka.net/actual-bibliography` (1,088 entries)

## Commands

### Web App
```bash
python3 -m http.server 8000  # Access at http://localhost:8000
```

### Python Script
```bash
# Install dependencies
pip install requests beautifulsoup4 python-docx pdfplumber Pillow

# Interactive mode
python omeka_bib_to_zotero.py

# Basic usage (no LLM)
python omeka_bib_to_zotero.py --file bibliography.txt --out output.json

# With LLM parsing
OPENROUTER_API_KEY=... python omeka_bib_to_zotero.py --use-llm openrouter --model openai/gpt-4o-mini --out output.json

# With ISBN enrichment
python omeka_bib_to_zotero.py --file bibliography.txt --enrich-isbn --out output.json

# Vision OCR for problematic PDFs
OPENROUTER_API_KEY=... python omeka_bib_to_zotero.py --file scan.pdf --vision-ocr --out output.json

# Test with limited entries
python omeka_bib_to_zotero.py --max 10 --out test.json

# Verify entry count (should be 1,088)
python -c "from omeka_bib_to_zotero import fetch_page_text, split_entries; print(len(split_entries(fetch_page_text('https://italianamericanimprints.omeka.net/actual-bibliography'))))"
```

## Critical Constraints

**DO NOT change without asking:**
1. **Default model**: `openai/gpt-oss-120b` (very cheap)
2. **Model list**: User explicitly specified each model in dropdown
3. **CUNY blue theme**: `--primary-blue: #003DA5`, `--secondary-blue: #002D72`
4. **License**: GNU GPL v3 (not Apache 2.0)
5. **Footer credits**: Stefano Morello name and GitHub link

## Architecture

### Entry Splitting
- **Web app** (`splitEntries`): Dual-format detection
  - If text contains `\n\n` (blank lines): splits on blank lines
  - If no blank lines: splits on single newlines
- **Python** (`split_entries`): Triple-newline separators only
- Debug tool: `debug_split_test.html`

### LLM Integration
- Models must support `response_format: {"type": "json_object"}`
- Working models: GPT OSS 120B, Gemini 2.5 Flash, Claude Sonnet 4.5, GPT-4o, Qwen 3 235B
- Batch size: 25 entries per request
- Timeout: 180 seconds, retry: 3 attempts with exponential backoff
- System prompt enforces JSON-only output (no commentary)

### ISBN Enrichment (`enrichItemsWithISBN` / `enrich_items_with_isbn`)
- Searches Open Library API first, Google Books as fallback
- Pre-1970 books: searches for OCLC/LCCN instead (ISBN didn't exist)
- Fills missing fields only (doesn't overwrite existing data):
  - `ISBN`, `OCLC`, `call-number` (LCCN)
  - `publisher`, `publisher-place`, `number-of-pages`
  - `issued` (year), `keyword` (subjects), `abstract`
- 200ms delay between API calls for rate limiting
- Web app uses CORS proxy for Open Library

### Vision OCR (`extractPdfWithVision` / `read_pdf_with_vision`)
- For PDFs with font encoding issues (text appears garbled like "zffff" instead of "1985")
- Renders PDF pages to images, sends to vision model via OpenRouter
- Available models: `qwen/qwen3-vl-235b-a22b-instruct` (recommended), `google/gemini-2.5-flash`, `openai/gpt-4o`, `anthropic/claude-sonnet-4`
- Web app: checkbox + model selector appears when PDF selected
- Python: `--vision-ocr` flag, `--vision-model` option

### File Reading
- `.txt`: Plain text (FileReader API / UTF-8)
- `.docx`: mammoth.js (web) / python-docx (Python)
- `.pdf`: PDF.js (web) / pdfplumber (Python)

### Output Formats
- **CSL-JSON**: Native Zotero format (recommended)
- **RIS**: Alternative citation format
- Failed entries saved to `failed_entries.txt`

## Common Issues

| Issue | Solution |
|-------|----------|
| LLM returns commentary instead of JSON | Model may not support `response_format`; switch to Claude Sonnet 4.5 or GPT-4o |
| CORS errors in web app | Enable "Use CORS proxy" checkbox or install browser extension |
| Wrong entry count | Check newline format: web app (dual detection), Python (triple newlines) |
| PDF text garbled | Enable Vision OCR checkbox (web) or `--vision-ocr` flag (Python) |
| Model not working | Verify model supports `response_format` via OpenRouter API |

## Web App UI Structure

- **Step 1**: Input source (URL/file/paste), CORS proxy checkbox, Vision OCR option for PDFs
- **Step 2**: Output format (CSL-JSON/RIS)
- **Step 3**: AI model config (model dropdown, API key with localStorage option, batch size)
- **Step 4**: Output options (test mode, ISBN enrichment, filename)
- **Modals**: CORS help, About section

## Key Files

| File | Purpose |
|------|---------|
| `omeka_bib_to_zotero.py` | Python CLI (~900 lines) |
| `index.html` | Web app UI structure |
| `app.js` | Web app logic (~1400 lines) |
| `styles.css` | CUNY blue theme |
| `debug_split_test.html` | Entry splitting debugger |
