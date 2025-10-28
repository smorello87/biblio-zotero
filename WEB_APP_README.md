# Bibliography to Zotero Converter - Web Application

A browser-based tool that converts bibliographic entries from Omeka Classic websites or local files into Zotero-importable formats (CSL-JSON or RIS).

This web application replicates the functionality of the Python script `omeka_bib_to_zotero.py` for use directly in web browsers.

## Features

- **Multiple Input Sources**
  - Web scraping from Omeka websites
  - Local file upload (.txt and .docx)

- **Intelligent Processing**
  - Entry splitting with triple-newline separators
  - Author ditto mark expansion (handles `______` and `—` markers)
  - Preserves bibliographic integrity

- **LLM Integration (Optional)**
  - OpenAI API support (GPT-4, GPT-4o-mini, etc.)
  - OpenRouter API support (Claude, GPT-4, etc.)
  - Batch processing with retry logic
  - Configurable batch sizes

- **Output Formats**
  - CSL-JSON (native Zotero format)
  - RIS (alternative citation format)

- **Robust Error Handling**
  - Failed entry tracking
  - Downloadable failed entries report
  - Progress indicators and detailed logs

## Quick Start

### 1. Open the Application

Simply open `index.html` in a modern web browser. No installation or server required!

**Recommended browsers:**
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

### 2. Basic Usage (Without LLM)

1. **Choose input source:**
   - Select "URL" and enter an Omeka bibliography URL, OR
   - Select "Local File" and upload a .txt or .docx file

2. **Select output format:**
   - CSL-JSON (recommended for Zotero)
   - RIS (alternative format)

3. **Configure options:**
   - Set output filename
   - Optionally limit entries for testing

4. **Process:**
   - Click "Process Bibliography"
   - Wait for completion
   - Download the output file

### 3. Advanced Usage (With LLM Parsing)

For high-quality structured metadata, enable LLM parsing:

1. **Choose LLM provider:**
   - OpenAI (GPT-4, GPT-4o-mini, etc.)
   - OpenRouter (Claude, GPT-4, Gemini, etc.)

2. **Configure LLM:**
   - Enter model name (e.g., `gpt-4o-mini` or `anthropic/claude-3.5-sonnet`)
   - Enter your API key (stored only in memory, never saved)
   - Adjust batch size (default: 25 entries per API call)

3. **Process:**
   - Click "Process Bibliography"
   - Monitor progress as batches are processed
   - Download structured output when complete

## CORS Solutions for Web Scraping

Due to browser security policies, direct web scraping from external sites may be blocked by CORS (Cross-Origin Resource Sharing) restrictions.

### Solution 1: Use a CORS Proxy (Easiest)

Add a CORS proxy prefix to your URL:

**Popular CORS proxies:**
- `https://corsproxy.io/?` (prepend to URL)
- `https://api.allorigins.win/raw?url=` (prepend to URL)
- `https://cors-anywhere.herokuapp.com/` (requires temporary access request)

**Example:**
```
Original URL:
https://italianamericanimprints.omeka.net/actual-bibliography

With CORS proxy:
https://corsproxy.io/?https://italianamericanimprints.omeka.net/actual-bibliography
```

### Solution 2: Browser Extension

Install a CORS extension:

**Chrome/Edge:**
- "Allow CORS: Access-Control-Allow-Origin"
- "CORS Unblock"

**Firefox:**
- "CORS Everywhere"
- "CORS Toggle"

**Warning:** Disable these extensions after use for security!

### Solution 3: Download and Upload

If scraping doesn't work:
1. Manually save the webpage (Ctrl+S / Cmd+S)
2. Copy the bibliography text into a .txt file
3. Upload using the "Local File" option

### Solution 4: Local Proxy Server (Advanced)

Run a local CORS proxy:

```bash
# Install cors-anywhere
npm install -g cors-anywhere

# Run proxy on port 8080
cors-anywhere

# Use in the app:
# http://localhost:8080/https://italianamericanimprints.omeka.net/actual-bibliography
```

## File Format Requirements

### Text Files (.txt)

Entries should be separated by **triple newlines** (blank lines):

```
Smith, John. 2020. Test Book. New York: Press.


Jones, Mary. 2021. Another Book. Boston: MIT.


Williams, Bob. 2022. Third Entry. Chicago: University Press.
```

### Word Documents (.docx)

- Standard Word format (.docx files)
- Entries separated by blank lines
- Clean formatting recommended

**Note:** `.doc` (old Word format) is not supported. Convert to `.docx` first.

## LLM Configuration

### OpenAI

**Model options:**
- `gpt-4o-mini` (recommended, cost-effective)
- `gpt-4o` (higher quality, more expensive)
- `gpt-3.5-turbo` (fastest, lower quality)

**Getting an API key:**
1. Sign up at https://platform.openai.com/
2. Navigate to API Keys section
3. Create a new secret key
4. Copy and paste into the app

**Approximate costs (per 1,088 entries):**
- gpt-4o-mini: ~$0.50-$1.00
- gpt-4o: ~$5.00-$10.00

### OpenRouter

**Model options:**
- `anthropic/claude-3.5-sonnet` (high quality)
- `openai/gpt-4o` (via OpenRouter)
- `google/gemini-pro-1.5` (cost-effective)
- Many more available!

**Getting an API key:**
1. Sign up at https://openrouter.ai/
2. Navigate to Keys section
3. Create a new API key
4. Copy and paste into the app

**Advantages:**
- Access to multiple models from different providers
- Unified API interface
- Competitive pricing

## Expected Results

From the default URL (`https://italianamericanimprints.omeka.net/actual-bibliography`), the tool should extract **1,088 bibliographic entries**.

**Validation checks:**
- First entry should start with: "Abbamonte, Salvatore. 1907..."
- Last entry should start with: "Zucchi, John E. 1992..."
- Total count: 1,088 entries

## Performance

**Without LLM:**
- Processing time: ~5-10 seconds
- All entries preserved as raw text in notes

**With LLM:**
- Processing time: ~60-90 minutes (1,088 entries at 25/batch)
- Structured metadata with proper fields
- Progress updates every batch
- Automatic retries on failures

**Optimization tips:**
- Use smaller batch sizes for stability (15-20)
- Use larger batch sizes for speed (40-50)
- Test with limited entries first (`--max 10`)

## Output Files

### Main Output File

**CSL-JSON format** (`.json`):
```json
[
  {
    "type": "book",
    "title": "Example Book Title",
    "author": [
      {"family": "Smith", "given": "John"}
    ],
    "issued": {"date-parts": [[2020]]},
    "publisher": "Example Press",
    "publisher-place": "New York"
  }
]
```

**RIS format** (`.ris`):
```
TY  - BOOK
AU  - Smith, John
TI  - Example Book Title
PB  - Example Press
CY  - New York
PY  - 2020
ER  -
```

### Failed Entries File

If LLM parsing fails for some entries, download `failed_entries.txt` for review:

```
================================================================================
FAILED BIBLIOGRAPHY ENTRIES
================================================================================
Total failed entries: 5
These entries could not be parsed by the LLM and were added as stub records.
Consider re-processing them individually or manually adding them to Zotero.
================================================================================

1. Complex entry that failed parsing...

--------------------------------------------------------------------------------

2. Another failed entry...

--------------------------------------------------------------------------------
```

## Importing to Zotero

### CSL-JSON Import

1. Open Zotero
2. File → Import
3. Select your `.json` file
4. Choose "CSL JSON" as format
5. Click "Import"

### RIS Import

1. Open Zotero
2. File → Import
3. Select your `.ris` file
4. Format auto-detected as RIS
5. Click "Import"

**Tip:** CSL-JSON is the native Zotero format and generally provides better results.

## Troubleshooting

### "CORS error: Unable to fetch URL"

**Solution:** Use one of the CORS workarounds described above (proxy, extension, or manual download).

### "Failed to read DOCX file"

**Cause:** The mammoth.js library may not be loaded.

**Solution:** Ensure you have internet connection (mammoth.js loads from CDN). Alternatively, convert to .txt file.

### "LLM parse failed"

**Causes:**
- Invalid API key
- Rate limiting
- Network issues
- Model unavailable

**Solutions:**
- Verify API key is correct
- Reduce batch size
- Wait and retry
- Try a different model

### "Fewer entries than expected"

**Causes:**
- Incorrect URL or file
- Filtering of non-entry content
- Different data source

**Solutions:**
- Verify the source URL/file
- Check the log for filtering messages
- Manually inspect the source

### Processing is very slow

**Causes:**
- LLM API latency
- Large batch sizes causing timeouts
- Rate limiting

**Solutions:**
- Reduce batch size to 15-20
- Be patient (60-90 min for 1,088 entries is normal)
- Test with limited entries first (`max entries` field)

## Technical Details

### Architecture

**Client-Side Only:**
- No backend server required
- All processing in browser
- API keys never stored permanently

**Dependencies:**
- mammoth.js (for .docx support, loaded from CDN)
- Native browser APIs (Fetch, FileReader, DOMParser)

**Key Algorithms:**
1. Entry splitting: splits on `\n\n\n` (triple newlines)
2. Author expansion: 3 regex patterns to avoid accumulating years
3. LLM batching: 25 entries per batch with 1s delay
4. Retry logic: 3 attempts with exponential backoff (2s, 4s, 8s)

### Browser Compatibility

**Minimum versions:**
- Chrome/Edge: 90+
- Firefox: 88+
- Safari: 14+

**Required features:**
- ES6+ JavaScript (async/await, arrow functions, etc.)
- Fetch API
- FileReader API
- DOMParser

### Security & Privacy

**Your data never leaves your browser**, except for:
- Fetching the source URL (if using web scraping)
- API calls to LLM providers (if using LLM parsing)

**API keys:**
- Stored only in memory during session
- Never saved to disk or localStorage
- Cleared when you close the tab

**Recommendations:**
- Use HTTPS for all connections
- Rotate API keys regularly
- Review failed entries before manual entry

## Comparison with Python Script

### Functional Equivalence

The web app provides the same functionality as `omeka_bib_to_zotero.py`:

| Feature | Python Script | Web App |
|---------|--------------|---------|
| URL scraping | ✅ | ✅ (with CORS solutions) |
| Local file upload | ✅ | ✅ |
| .txt support | ✅ | ✅ |
| .docx support | ✅ | ✅ |
| Entry splitting | ✅ | ✅ |
| Author expansion | ✅ | ✅ |
| OpenAI LLM | ✅ | ✅ |
| OpenRouter LLM | ✅ | ✅ |
| CSL-JSON output | ✅ | ✅ |
| RIS output | ✅ | ✅ |
| Failed entry tracking | ✅ | ✅ |
| Batch processing | ✅ | ✅ |
| Retry logic | ✅ | ✅ |

### Advantages of Web App

- No installation required
- Cross-platform (works anywhere)
- Visual progress indicators
- Interactive UI
- Real-time logs
- Preview functionality

### Advantages of Python Script

- No CORS restrictions
- Faster processing (native code)
- Command-line automation
- Can be integrated into pipelines
- Better for very large datasets

## Development

### File Structure

```
biblio-zotero/
├── index.html          # Main HTML structure
├── styles.css          # Styling and layout
├── app.js              # Core JavaScript application
├── WEB_APP_README.md   # This file
└── omeka_bib_to_zotero.py  # Original Python script
```

### Customization

**To modify the UI:**
- Edit `index.html` for structure
- Edit `styles.css` for appearance

**To modify functionality:**
- Edit `app.js` for logic
- Key functions are well-documented

**To add new LLM providers:**
1. Add a new `call<Provider>Chat()` function in `app.js`
2. Update the `batchParseWithLLM()` function
3. Add UI option in `index.html`

### Local Development

Simply open `index.html` in a browser. No build process required!

For better development experience:
```bash
# Optional: Run a local server
python -m http.server 8000
# Then open: http://localhost:8000
```

## Contributing

Contributions welcome! Areas for improvement:

- Additional LLM providers
- Better CORS handling
- Improved error recovery
- UI enhancements
- Performance optimizations
- Additional output formats

## License

Apache 2.0 License - same as the original Python script.

## Support

For issues, questions, or contributions, please refer to the main project repository.

---

**Note:** This web application is part of the `biblio-zotero` project. For more information about the project and the original Python script, see the main README.md and CLAUDE.md files.
