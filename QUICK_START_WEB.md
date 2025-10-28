# Quick Start Guide - Web Application

Get started with the Bibliography to Zotero Converter web app in 5 minutes!

## Step 1: Open the Application

1. Navigate to the project folder: `/Users/veritas44/Downloads/github/biblio-zotero/`
2. Double-click `index.html` to open in your default browser
3. Or right-click → Open With → Choose your preferred browser

**That's it!** No installation, no dependencies, no server required.

## Step 2: Basic Test (No LLM)

Let's do a quick test with the included example file:

1. **Choose Input Source:**
   - Select "Local File"
   - Click "Choose file..."
   - Navigate to `examples/test_bibliography.txt`
   - Select it

2. **Configure Output:**
   - Keep "CSL-JSON" selected (default)
   - Keep output filename as `zotero_bibliography.json`

3. **LLM Settings:**
   - Keep "No LLM" selected (default)

4. **Process:**
   - Click "Process Bibliography"
   - Wait ~2 seconds
   - See results showing 5 entries processed

5. **Download:**
   - Click "Download Output"
   - Import the `.json` file into Zotero

**Result:** You'll get a basic CSL-JSON file with raw citation text in the title field.

## Step 3: Advanced Test (With LLM)

Now let's try with LLM parsing for structured data:

### Option A: Using OpenAI

1. **Get API Key:**
   - Go to https://platform.openai.com/
   - Sign up or log in
   - Navigate to API Keys
   - Create a new key

2. **Configure:**
   - Select "Local File" and choose `examples/test_bibliography.txt`
   - Select "OpenAI" under LLM provider
   - Model: `gpt-4o-mini` (pre-filled)
   - API Key: Paste your key
   - Batch Size: `5` (small for testing)

3. **Process:**
   - Click "Process Bibliography"
   - Watch progress (should take ~30 seconds)
   - Download structured output

**Cost:** ~$0.01 for this test

### Option B: Using OpenRouter

1. **Get API Key:**
   - Go to https://openrouter.ai/
   - Sign up or log in
   - Create an API key

2. **Configure:**
   - Select "Local File" and choose `examples/test_bibliography.txt`
   - Select "OpenRouter" under LLM provider
   - Model: `anthropic/claude-3.5-sonnet` (pre-filled)
   - API Key: Paste your key
   - Batch Size: `5` (small for testing)

3. **Process:**
   - Click "Process Bibliography"
   - Watch progress
   - Download structured output

**Cost:** ~$0.02-0.05 for this test

## Step 4: Web Scraping Test

Now let's try fetching from a URL:

### Handling CORS (Important!)

The default URL will likely be blocked by CORS. Here's the easiest solution:

1. **Choose Input Source:**
   - Select "URL (Web Scraping)"

2. **Add CORS Proxy:**
   - Change the URL from:
     ```
     https://italianamericanimprints.omeka.net/actual-bibliography
     ```
   - To:
     ```
     https://corsproxy.io/?https://italianamericanimprints.omeka.net/actual-bibliography
     ```

3. **Process:**
   - Configure output and LLM as desired
   - For first test, use "No LLM" and limit to 10 entries
   - Click "Process Bibliography"

**Expected Result:** 1,088 entries from the URL (or 10 if limited)

### Alternative: Download and Upload

If CORS proxy doesn't work:

1. Open https://italianamericanimprints.omeka.net/actual-bibliography in browser
2. Press Ctrl+S (Cmd+S on Mac) to save page
3. Copy bibliography text to a .txt file
4. Upload using "Local File" option

## Step 5: Import to Zotero

### Import Process

1. **Open Zotero**
   - Desktop app or web version

2. **Import:**
   - File → Import
   - Select your downloaded `.json` or `.ris` file
   - Choose appropriate format (usually auto-detected)
   - Click "Import"

3. **Verify:**
   - Check that entries appear in your library
   - Review metadata fields
   - Note any entries that need manual cleanup

### What to Check

**With LLM parsing:**
- Author names properly split into family/given
- Publication years extracted
- Publishers and places separated
- Container titles for journal articles

**Without LLM parsing:**
- Full citation text in title field
- Can be cleaned up later in Zotero

## Common Issues & Quick Fixes

### "CORS error: Unable to fetch URL"

**Fix:** Use a CORS proxy prefix:
```
https://corsproxy.io/?[YOUR_URL]
```

Or install a CORS browser extension (remember to disable after use!).

### "Please enter an API key"

**Fix:** Make sure you've selected an LLM provider AND entered the API key. For testing, use "No LLM" instead.

### "Failed to read DOCX file"

**Fix:**
- Check internet connection (mammoth.js loads from CDN)
- Or convert .docx to .txt file

### Processing takes forever

**Fix:**
- For full dataset (1,088 entries), expect 60-90 minutes with LLM
- Test with limited entries first (use "Max Entries" field)
- Reduce batch size if seeing timeouts

### Entries don't look right

**Check:**
- File format: entries should be separated by blank lines (triple newlines)
- Source quality: garbage in, garbage out
- Try with example file first to verify app is working

## Performance Tips

### For Testing
- Limit entries to 10-20
- Use small batch sizes (5-10)
- Use "No LLM" for quick validation

### For Production
- Use gpt-4o-mini (fast and cheap)
- Batch size: 25-40
- Be patient (60-90 min for full dataset)
- Review failed entries file

### Cost Optimization
- Start with "No LLM" to validate entries
- Use OpenRouter for better pricing
- Choose cost-effective models:
  - `gpt-4o-mini` (OpenAI)
  - `anthropic/claude-3-haiku` (OpenRouter)
  - `google/gemini-flash-1.5` (OpenRouter)

## Next Steps

1. **Read the full documentation:**
   - `WEB_APP_README.md` - Complete guide
   - `CLAUDE.md` - Technical details

2. **Explore advanced features:**
   - Different output formats (RIS)
   - Custom batch sizes
   - Different LLM models

3. **Process your own data:**
   - Prepare your bibliography file
   - Choose appropriate settings
   - Import to Zotero

4. **Provide feedback:**
   - Report issues
   - Suggest improvements
   - Share your experience

## File Reference

**Web App Files:**
- `index.html` - Main application page
- `app.js` - JavaScript code
- `styles.css` - Styling

**Documentation:**
- `WEB_APP_README.md` - Full documentation
- `QUICK_START_WEB.md` - This file
- `CLAUDE.md` - Technical reference

**Examples:**
- `examples/test_bibliography.txt` - Sample entries for testing

## Support Resources

**CORS Solutions:**
- See detailed CORS section in index.html
- Multiple proxy options provided
- Browser extension alternatives

**LLM Providers:**
- OpenAI: https://platform.openai.com/
- OpenRouter: https://openrouter.ai/

**Zotero:**
- Download: https://www.zotero.org/download/
- Import guide: https://www.zotero.org/support/kb/importing_standardized_formats

---

**Happy Converting!** 🎉

For questions or issues, refer to the troubleshooting section in `WEB_APP_README.md`.
