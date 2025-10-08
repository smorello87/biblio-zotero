# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a single-script Python utility that converts bibliographic entries from an Omeka Classic website or local files into Zotero-importable formats (CSL-JSON or RIS). The script supports web scraping, local file input (.txt, .docx), and optionally uses LLMs (OpenAI or OpenRouter) to structure the citations.

**Main script**: `omeka_bib_to_zotero.py`

**Input sources**:
- URLs (web scraping from Omeka sites)
- Local .txt files (plain text)
- Local .docx files (Microsoft Word)

**Expected results**: 1,088 bibliographic entries from the default URL

## Dependencies

**Required:**
- `requests`: HTTP client for fetching web pages and making API calls
- `beautifulsoup4`: HTML parsing for extracting bibliography content

**Optional:**
- `python-docx`: For reading .docx files

Install with: `pip install requests beautifulsoup4 python-docx`

## Common Commands

### Interactive mode (recommended for first-time use)
```bash
python omeka_bib_to_zotero.py
# Follow prompts:
#   1. Choose input source (URL or local file)
#   2. Enter URL or file path
#   3. Choose output format (CSL-JSON or RIS)
#   4. Enter output file name
#   5. Choose LLM provider (or none)
#   6. Enter model name (if using LLM)
#   7. Enter API key (if using LLM)
#   8. Enter max entries (optional, for testing)
```

### Basic usage from URL (no LLM)
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

The script is organized into functional sections:

### 1. Web Scraping (`fetch_page_text`)
- Fetches HTML from the Omeka page
- Locates the "Bibliography" heading (tries h1/h2/h3 tags)
- Extracts all content after that heading until the next major heading
- Falls back to extracting everything after first "Bibliography" occurrence if structured extraction fails

### 2. Entry Splitting (`split_entries`)
- Splits on triple-newline separators (actual HTML structure from Omeka)
- Joins internal line breaks within entries with spaces
- Normalizes whitespace and removes non-breaking spaces
- Filters out navigation/menu artifacts with multiple detection patterns
- **Critical**: Must produce exactly 1,088 entries from the default URL

### 3. Author Expansion (`expand_repeated_authors`)
- Handles bibliographic ditto marks (underscores or em-dashes) that reference the previous author
- Uses three regex patterns to extract author names without accumulating metadata (years, etc.)
- Pattern 1: `"Surname, Given [middle]. YEAR"` (most common)
- Pattern 2: `"Surname, Given [pseudonym]."` (with brackets)
- Pattern 3: Simple `"Surname, Given."` with year stripping
- **Critical**: Must NOT accumulate years when expanding ditto marks

### 4. LLM Parsing (`batch_parse_with_llm`)
- Batches entries (default 25 per batch) to minimize API calls
- Supports two providers: OpenAI (`call_openai_chat`) and OpenRouter (`call_openrouter_chat`)
- Both providers use `response_format: {"type": "json_object"}` for structured output
- **Retry logic**: 3 attempts with exponential backoff (2s, 4s, 8s) for timeouts and rate limits
- **Timeout**: 180 seconds (increased from original 60s)
- **Batch mismatch handling**: Creates stub records for missing entries when LLM returns incomplete batches
- Falls back to minimal stub records if LLM parsing fails
- Writes failed entries to `failed_entries.txt` for manual review (formatted with headers, numbers, separators)
- Expects API keys via environment variables: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`
- 1.0 second delay between batches to avoid rate limiting

### 5. LLM Prompt Strategy
- **System prompt** (`LLM_SYSTEM_PROMPT`): instructs the LLM to output valid JSON with no commentary
- **User prompt** (`LLM_USER_TEMPLATE`): requests `{"items": [...]}` format (required for json_object response format)
- Handles Italian/English bibliographic entries
- Maps editors to 'editor' array, authors to 'author' array with `{family, given}` structure
- Preserves year suffixes (e.g., "1940a") in notes
- Detects uncertain dates like `[1903]` or `n.d.` and adds clarifying notes
- **Important**: Response must be wrapped in `{"items": [...]}` object, not a raw array

### 6. Output Formats

**CSL-JSON** (`write_csl_json`):
- Native Zotero import format
- Simple JSON array serialization with UTF-8 encoding

**RIS** (`write_ris`):
- Alternative citation format also supported by Zotero
- Maps CSL types to RIS types via `CSL_TYPE_TO_RIS` dict
- Generates line-based format with tags like `TY`, `AU`, `TI`, `ER`
- Uses `csl_to_ris_record` to convert each CSL-JSON item

### 7. Local File Reading (`read_local_file`)
- Supports both .txt and .docx file formats
- `read_text_file()`: Reads plain text files with UTF-8 encoding
- `read_docx_file()`: Reads Word documents paragraph-by-paragraph (requires python-docx)
- Automatically detects file type from extension
- Raises clear errors for unsupported formats or missing files

### 8. Interactive Prompts (`prompt_*` functions)
- `prompt_input_source()`: Choose between URL or local file input
- `prompt_output_format()`: Select CSL-JSON or RIS format
- `prompt_output_file()`: Enter output file path with format-specific defaults
- `prompt_use_llm()`: Choose LLM provider (None, OpenAI, OpenRouter)
- `prompt_model()`: Enter model name with provider-specific suggestions
- `prompt_api_key()`: Enter API key (checks environment first)
- `prompt_max_entries()`: Optionally limit entries for testing

## Key Data Flow

1. **Input**: Fetch HTML from Omeka URL OR read from local file (.txt/.docx)
2. Extract bibliography section text (or use file content directly)
3. Split into individual entries using triple-newline separators
4. Expand ditto marks for repeated authors
5. Batch-process entries through LLM (if enabled) or create minimal stubs
6. Format as CSL-JSON or RIS
7. Write output file + `failed_entries.txt` for any LLM failures

## Testing Strategy

When testing changes:
- Use `--max 10` to limit the number of entries processed
- Test without LLM first to verify scraping/splitting logic (should extract 1,088 entries)
- Verify first entry starts with "Abbamonte, Salvatore. 1907..."
- Verify last entry starts with "Zucchi, John E. 1992..."
- Test with LLM on a small batch before full runs
- Check `failed_entries.txt` for parsing issues
- Verify output imports cleanly into Zotero

**Testing local file input:**
```bash
# Create test file with triple-newline separators
cat > test.txt << 'EOF'
Smith, John. 2020. Test Book. New York: Press.


Jones, Mary. 2021. Another Book. Boston: MIT.
EOF

# Test reading
python omeka_bib_to_zotero.py --file test.txt --out test.json --max 10
```

## Interactive Mode

The script supports both command-line arguments and interactive prompts:
- If arguments are not provided, the script prompts interactively
- **New**: First prompt asks to choose between URL or local file input
- Prompts include: input source, URL/file path, output format (CSL-JSON/RIS), output file path, LLM provider, model name, API key, max entries
- API key prompt checks environment variables first and offers to use existing keys
- All prompts have sensible defaults (e.g., default URL, gpt-4o-mini for OpenAI, claude-3.5-sonnet for OpenRouter)

**Command-line arguments:**
- `--url <URL>` - Source URL for web scraping
- `--file <PATH>` - Local file path (.txt or .docx)
- `--out <PATH>` - Output file path
- `--format {csljson,ris}` - Output format
- `--use-llm {openai,openrouter}` - LLM provider
- `--model <NAME>` - Model name
- `--max <N>` - Limit entries for testing

**Note**: `--url` and `--file` are mutually exclusive; use one or the other

## Performance & Output

**Scraping performance**:
- ~3 seconds to fetch and parse all 1,088 entries
- Without LLM: ~5 seconds total
- With LLM: ~60-90 minutes (1,088 entries ÷ 25 per batch × 1s delay + processing time)
- API costs: ~$0.50-$1.00 for full run with gpt-4o-mini

**Output files**:
- `output.json` or `output.ris` - Main output file
- `failed_entries.txt` - Detailed list of entries that couldn't be parsed by LLM (if any)

**Without LLM**: All citation text is preserved verbatim in the `title` field with a note explaining that LLM parsing was disabled

**Input file format**: For local files (.txt or .docx), entries should be separated by triple newlines (blank lines) for best results

## Known Issues & Solutions

**Issue**: Script was returning 1,113 entries instead of 1,088
**Cause**: Entry splitting logic split on blank lines, incorrectly splitting some entries with internal line breaks
**Solution**: Now splits on triple-newline separators and joins internal lines (FIXED)

**Issue**: Author ditto marks accumulated years (e.g., "Abbamonte, Salvatore 1919 1940a 1940b")
**Cause**: Regex captured everything up to first period, including years
**Solution**: Three-pattern approach extracts only author name, strips years (FIXED)

**Issue**: API timeouts caused entire batches to fail
**Cause**: 60s timeout too short, no retry logic
**Solution**: Increased to 180s timeout, added exponential backoff retry (FIXED)

**Issue**: LLM sometimes returns fewer items than batch size
**Cause**: LLM parsing occasionally fails on complex entries
**Solution**: Creates stub records for missing entries, adds to failed_entries.txt (FIXED)

## Recent Additions

**Local File Input (NEW)**:
- Added support for reading from .txt and .docx files
- Interactive prompt allows choosing between URL and local file
- Command-line: `--file <path>` argument
- Requires `python-docx` for .docx support (optional dependency)
- Files should use triple-newline separators between entries

**Enhanced Failed Entries Tracking (NEW)**:
- Replaced basic `failed.txt` with formatted `failed_entries.txt`
- Includes header with count, explanation, and guidance
- Numbered entries with visual separators for easy reading
- Failed entries still added to output as stub records for import
