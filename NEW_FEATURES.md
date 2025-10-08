# New Features Added

## Summary

Two major features have been added to `omeka_bib_to_zotero.py`:

1. ✅ **Local file input support** - Read from .txt or .docx files
2. ✅ **Enhanced failed entries tracking** - Detailed txt file for entries that couldn't be parsed

## 1. Local File Input Support

### What's New

The script now supports reading bibliography entries from local files in addition to web scraping from URLs.

**Supported formats:**
- `.txt` - Plain text files
- `.docx` - Microsoft Word documents (requires `python-docx` package)

### Installation

For Word document support, install the optional dependency:
```bash
pip install python-docx
```

### Usage

**Interactive mode:**
```bash
python omeka_bib_to_zotero.py
# Choose option 2 (Local file) when prompted for input source
# Enter the file path when requested
```

**Command-line mode:**
```bash
# From a text file
python omeka_bib_to_zotero.py --file bibliography.txt --out output.json

# From a Word document
python omeka_bib_to_zotero.py --file bibliography.docx --out output.json --format csljson
```

### File Format Requirements

**For best results, entries in your local file should be separated by triple newlines (blank lines):**

```
Entry 1 text here.


Entry 2 text here.


Entry 3 text here.
```

This matches the format extracted from Omeka websites. If your entries are separated by single or double newlines, they may be merged together.

### New Functions

- `read_text_file(file_path)` - Reads .txt files
- `read_docx_file(file_path)` - Reads .docx files (requires python-docx)
- `read_local_file(file_path)` - Main function that detects file type and calls appropriate reader
- `prompt_input_source()` - Interactive prompt to choose between URL or local file

## 2. Enhanced Failed Entries Tracking

### What's New

The script now creates a detailed `failed_entries.txt` file that lists all bibliographic entries that couldn't be successfully parsed by the LLM.

**Previous behavior:**
- Created `failed.txt` with raw entries (one per line)
- Minimal information

**New behavior:**
- Creates `failed_entries.txt` with formatted, numbered entries
- Header with total count and explanation
- Clear visual separation between entries
- More helpful for manual review and re-processing

### Output Format

```
================================================================================
FAILED BIBLIOGRAPHY ENTRIES
================================================================================
Total failed entries: 3
These entries could not be parsed by the LLM and were added as stub records.
Consider re-processing them individually or manually adding them to Zotero.
================================================================================

1. First failed entry text here...

--------------------------------------------------------------------------------

2. Second failed entry text here...

--------------------------------------------------------------------------------

3. Third failed entry text here...

--------------------------------------------------------------------------------
```

### What Happens to Failed Entries

When an entry fails LLM parsing:
1. It's added to the output JSON/RIS as a **stub record**:
   - `type`: "manuscript"
   - `title`: Contains the raw citation text
   - `note`: Explains that parsing failed
2. It's added to `failed_entries.txt` for your review
3. You can import the stub record to Zotero and manually fix it later

## Testing

### Test Local File Input

```bash
# Create a test file
cat > test_bib.txt << 'EOF'
Smith, John. 2020. Test Book Title. New York: Academic Press.


Jones, Mary. 2021. Another Book. Boston: MIT Press.
EOF

# Process it
python omeka_bib_to_zotero.py --file test_bib.txt --out test.json
```

### Verify Failed Entries File

When using LLM parsing, if any entries fail, check:
```bash
cat failed_entries.txt
```

## Command-Line Examples

### Process local file with OpenAI
```bash
OPENAI_API_KEY=sk-... python omeka_bib_to_zotero.py \
  --file my_bibliography.txt \
  --use-llm openai \
  --model gpt-4o-mini \
  --out output.json
```

### Process Word document with OpenRouter
```bash
OPENROUTER_API_KEY=... python omeka_bib_to_zotero.py \
  --file bibliography.docx \
  --use-llm openrouter \
  --model openrouter/anthropic/claude-3.5-sonnet \
  --out output.json
```

### Mix and match options
```bash
# Local file, RIS format, test with 10 entries
python omeka_bib_to_zotero.py \
  --file bibliography.txt \
  --format ris \
  --out output.ris \
  --max 10
```

## Updated Dependencies

**Required:**
- `requests` - For URL fetching
- `beautifulsoup4` - For HTML parsing

**Optional:**
- `python-docx` - For .docx file support

**Install all:**
```bash
pip install requests beautifulsoup4 python-docx
```

## Notes

- Local files use the same entry splitting logic as web scraping (triple-newline separators)
- Author ditto mark expansion works the same for local files and web scraping
- The `failed_entries.txt` file is only created when using LLM parsing and entries fail
- Without LLM parsing, all entries are preserved as stub records (no "failures")
