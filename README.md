# Omeka Bibliography to Zotero Converter

A Python utility that converts bibliographic entries from Omeka Classic websites or local files into Zotero-importable formats (CSL-JSON or RIS).

## Features

- **Multiple Input Sources**:
  - Web scraping from Omeka Classic websites
  - Local text files (.txt)
  - Microsoft Word documents (.docx)

- **Intelligent Processing**:
  - Automatic author ditto mark expansion (e.g., "______" → previous author name)
  - Smart entry splitting and normalization
  - Optional LLM-powered structured parsing (OpenAI or OpenRouter)

- **Flexible Output**:
  - CSL-JSON format (native Zotero import)
  - RIS format (alternative citation format)

- **Robust Error Handling**:
  - Retry logic with exponential backoff for API calls
  - Detailed failed entries tracking
  - Stub records for entries that can't be parsed

## Installation

### Required Dependencies
```bash
pip install requests beautifulsoup4
```

### Optional Dependencies
```bash
# For Word document support
pip install python-docx
```

## Quick Start

### Interactive Mode (Recommended)
```bash
python omeka_bib_to_zotero.py
```

The script will guide you through:
1. Choosing input source (URL or local file)
2. Selecting output format
3. Configuring LLM parsing (optional)

### Command-Line Usage

#### From URL (Web Scraping)
```bash
# Basic conversion (no LLM)
python omeka_bib_to_zotero.py \
  --url https://italianamericanimprints.omeka.net/actual-bibliography \
  --out bibliography.json \
  --format csljson

# With OpenAI LLM parsing
OPENAI_API_KEY=sk-... python omeka_bib_to_zotero.py \
  --url https://italianamericanimprints.omeka.net/actual-bibliography \
  --use-llm openai \
  --model gpt-4o-mini \
  --out bibliography.json
```

#### From Local File
```bash
# From text file
python omeka_bib_to_zotero.py \
  --file bibliography.txt \
  --out output.json

# From Word document with OpenRouter LLM
OPENROUTER_API_KEY=... python omeka_bib_to_zotero.py \
  --file bibliography.docx \
  --use-llm openrouter \
  --model openrouter/anthropic/claude-3.5-sonnet \
  --out output.json
```

#### Generate RIS Format
```bash
python omeka_bib_to_zotero.py \
  --file bibliography.txt \
  --format ris \
  --out output.ris
```

## Input File Format

For local files, entries should be separated by **triple newlines** (two blank lines between entries):

```
Smith, John. 2020. Book Title. New York: Publisher.


Jones, Mary. 2021. Another Book. Boston: MIT Press.


Brown, Alice. 2022. Third Book. Chicago: University Press.
```

This format matches the structure extracted from Omeka websites and ensures proper entry separation.

## Command-Line Options

| Option | Description |
|--------|-------------|
| `--url <URL>` | Source URL for web scraping |
| `--file <PATH>` | Local file path (.txt or .docx) |
| `--out <PATH>` | Output file path |
| `--format {csljson,ris}` | Output format (default: csljson) |
| `--use-llm {openai,openrouter}` | LLM provider for structured parsing |
| `--model <NAME>` | Model name (e.g., gpt-4o-mini, claude-3.5-sonnet) |
| `--max <N>` | Limit number of entries (for testing) |

**Note**: `--url` and `--file` are mutually exclusive.

## LLM-Powered Parsing

Without LLM parsing, the script creates minimal records with raw citation text. For high-quality structured fields (authors, year, title, etc.), use LLM parsing:

### OpenAI
```bash
export OPENAI_API_KEY=sk-...
python omeka_bib_to_zotero.py \
  --use-llm openai \
  --model gpt-4o-mini \
  --out output.json
```

**Recommended models**: `gpt-4o-mini` (cost-effective), `gpt-4o` (higher quality)

### OpenRouter
```bash
export OPENROUTER_API_KEY=...
python omeka_bib_to_zotero.py \
  --use-llm openrouter \
  --model openrouter/anthropic/claude-3.5-sonnet \
  --out output.json
```

**Note**: API keys can also be entered interactively when prompted.

## Output Files

The script generates:

- **Main output**: `output.json` or `output.ris` - Ready for Zotero import
- **Failed entries**: `failed_entries.txt` - Formatted list of entries that couldn't be parsed (if any)

### Failed Entries

When using LLM parsing, some complex entries may fail. These are:
1. Added to the output file as stub records (with raw text in the title field)
2. Listed in `failed_entries.txt` for manual review

Example `failed_entries.txt`:
```
================================================================================
FAILED BIBLIOGRAPHY ENTRIES
================================================================================
Total failed entries: 3
These entries could not be parsed by the LLM and were added as stub records.
Consider re-processing them individually or manually adding them to Zotero.
================================================================================

1. Complex entry text here...

--------------------------------------------------------------------------------

2. Another failed entry...

--------------------------------------------------------------------------------
```

## Performance

**Without LLM**:
- ~5 seconds total for ~1,000 entries
- No API costs

**With LLM**:
- ~60-90 minutes for ~1,000 entries
- API costs: ~$0.50-$1.00 with gpt-4o-mini
- Batch processing (25 entries per batch)
- Automatic retry on timeout/rate limit

## Testing

Test with a limited number of entries:
```bash
python omeka_bib_to_zotero.py \
  --file test.txt \
  --max 10 \
  --out test.json
```

Create a test file:
```bash
cat > test.txt << 'EOF'
Smith, John. 2020. Test Book. New York: Academic Press.


Jones, Mary. 2021. Another Book. Boston: MIT Press.
EOF
```

## Importing to Zotero

1. Open Zotero
2. Click **File → Import...**
3. Select your output file (`.json` or `.ris`)
4. Review imported entries
5. Manually fix any stub records (from `failed_entries.txt`)

## Features in Detail

### Author Ditto Mark Expansion

The script automatically expands bibliographic ditto marks that reference the previous author:

**Input**:
```
Smith, John. 2020. First Book. New York: Publisher.


______. 2021. Second Book. Boston: Press.
```

**Output**:
```
Smith, John. 2020. First Book. New York: Publisher.
Smith, John. 2021. Second Book. Boston: Press.
```

Supports multiple ditto mark formats: `______`, `———`, `—`

### Supported Citation Types

The LLM can identify and structure:
- Books
- Journal articles
- Magazine articles
- Book chapters
- Theses
- Reports
- Manuscripts
- Pamphlets

### Bilingual Support

Handles both English and Italian bibliographic entries, including:
- Diacritics preservation
- Italian publisher formats
- Mixed-language bibliographies

## Troubleshooting

### Word Document Support

If you get an import error for `.docx` files:
```bash
pip install python-docx
```

### API Timeouts

The script includes retry logic, but if you experience persistent timeouts:
- Check your internet connection
- Verify API key is valid
- Try reducing batch size (requires code modification)

### Incorrect Entry Count

Ensure local files use **triple newlines** (two blank lines) to separate entries. Single or double newlines may cause entries to merge.

### Failed Entries

Check `failed_entries.txt` for entries that couldn't be parsed. Options:
1. Re-run with `--max <N>` to process fewer entries
2. Manually add to Zotero after import
3. Edit the source file and re-run

## Examples

### Example 1: Italian-American Bibliography from Omeka
```bash
python omeka_bib_to_zotero.py \
  --url https://italianamericanimprints.omeka.net/actual-bibliography \
  --use-llm openai \
  --model gpt-4o-mini \
  --out italian_american_biblio.json
```

### Example 2: Local Bibliography with No LLM
```bash
python omeka_bib_to_zotero.py \
  --file my_bibliography.txt \
  --out output.json \
  --format csljson
```

### Example 3: Word Document to RIS
```bash
python omeka_bib_to_zotero.py \
  --file dissertation_biblio.docx \
  --format ris \
  --out dissertation.ris
```

### Example 4: Test Run
```bash
python omeka_bib_to_zotero.py \
  --url https://italianamericanimprints.omeka.net/actual-bibliography \
  --max 10 \
  --out test.json
```

## License

This is an open-source utility for academic and research purposes.

## Support

For issues, questions, or contributions, please refer to the project repository.

## Acknowledgments

- Designed for the Italian-American Imprints bibliography project
- Supports Zotero citation management workflows
- Built with requests, BeautifulSoup4, and optional python-docx
