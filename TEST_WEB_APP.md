# Web App Testing Guide

This document provides test cases to verify the web application functions correctly.

## Prerequisites

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection (for LLM APIs and mammoth.js CDN)
- Optional: API keys for OpenAI or OpenRouter

## Test Suite

### Test 1: Basic File Upload (Text File)

**Objective:** Verify text file reading and basic entry splitting

**Steps:**
1. Open `index.html` in browser
2. Select "Local File" as input source
3. Upload `examples/test_bibliography.txt`
4. Keep "No LLM" selected
5. Click "Process Bibliography"

**Expected Results:**
- Processing completes in ~2 seconds
- 5 entries detected
- Log shows: "Found 5 entries"
- Download button appears
- Preview shows entries with raw text

**Pass Criteria:**
- ✅ No errors in console
- ✅ Correct entry count
- ✅ Output file downloads successfully

---

### Test 2: DOCX File Upload

**Objective:** Verify DOCX file reading with mammoth.js

**Steps:**
1. Create a test .docx file with sample bibliography entries (separated by blank lines)
2. Open `index.html` in browser
3. Select "Local File"
4. Upload the .docx file
5. Process with "No LLM"

**Expected Results:**
- DOCX parses successfully
- Entries extracted correctly
- No mammoth.js errors

**Pass Criteria:**
- ✅ File reads without errors
- ✅ Correct number of entries extracted
- ✅ Text formatting preserved

**Note:** If mammoth.js fails to load (no internet), this test will fail with a clear error message.

---

### Test 3: URL Scraping (Without CORS Proxy)

**Objective:** Verify CORS error handling

**Steps:**
1. Open `index.html`
2. Select "URL (Web Scraping)"
3. Use default URL (without proxy): `https://italianamericanimprints.omeka.net/actual-bibliography`
4. Click "Process Bibliography"

**Expected Results:**
- CORS error occurs
- Clear error message displayed
- Suggests solutions (CORS proxy, etc.)

**Pass Criteria:**
- ✅ Error message mentions "CORS"
- ✅ Provides helpful suggestions
- ✅ Application doesn't crash

---

### Test 4: URL Scraping (With CORS Proxy)

**Objective:** Verify web scraping functionality

**Steps:**
1. Open `index.html`
2. Select "URL (Web Scraping)"
3. Use URL with CORS proxy: `https://corsproxy.io/?https://italianamericanimprints.omeka.net/actual-bibliography`
4. Set "Max Entries" to 10 for testing
5. Keep "No LLM" selected
6. Click "Process Bibliography"

**Expected Results:**
- Page fetches successfully
- 10 entries extracted (limited by max entries)
- First entry starts with "Abbamonte, Salvatore. 1907"
- Processing completes in ~5 seconds

**Pass Criteria:**
- ✅ No fetch errors
- ✅ Correct number of entries
- ✅ First entry matches expected format
- ✅ Download works

**Note:** If CORS proxy is down, try alternative: `https://api.allorigins.win/raw?url=`

---

### Test 5: Author Ditto Mark Expansion

**Objective:** Verify author expansion logic

**Steps:**
1. Create a test file with ditto marks:
```
Smith, John. 2020. First Book. New York: Press.


______. 2021. Second Book. Boston: MIT.


______. 2022. Third Book. Chicago: Press.
```
2. Upload and process
3. Examine output in preview

**Expected Results:**
- All three entries have "Smith, John" as author
- Ditto marks replaced correctly
- No accumulation of years

**Pass Criteria:**
- ✅ Second entry doesn't start with `______`
- ✅ Third entry doesn't start with `______`
- ✅ Author name properly expanded

---

### Test 6: CSL-JSON Output Format

**Objective:** Verify CSL-JSON generation

**Steps:**
1. Process any file with "No LLM"
2. Select "CSL-JSON" format (default)
3. Download output
4. Open in text editor
5. Verify JSON structure

**Expected Results:**
- Valid JSON array
- Each entry has required fields: `type`, `title`, `note`
- Proper UTF-8 encoding (diacritics preserved)
- File extension is `.json`

**Pass Criteria:**
- ✅ JSON parses without errors
- ✅ Array of objects
- ✅ Can be imported to Zotero

---

### Test 7: RIS Output Format

**Objective:** Verify RIS generation

**Steps:**
1. Process any file with "No LLM"
2. Select "RIS" format
3. Download output
4. Open in text editor
5. Verify RIS structure

**Expected Results:**
- Proper RIS format with tags
- Each entry starts with `TY  -` and ends with `ER  -`
- File extension is `.ris`
- Title field populated

**Pass Criteria:**
- ✅ Proper RIS structure
- ✅ Each entry complete
- ✅ Can be imported to Zotero

---

### Test 8: OpenAI LLM Integration

**Objective:** Verify OpenAI API integration

**Prerequisites:** Valid OpenAI API key

**Steps:**
1. Open `index.html`
2. Upload `examples/test_bibliography.txt`
3. Select "OpenAI" as LLM provider
4. Model: `gpt-4o-mini`
5. Enter valid API key
6. Batch size: 5
7. Click "Process Bibliography"

**Expected Results:**
- API calls succeed
- Progress updates for batch
- Structured output with proper fields:
  - `author` array with `family`/`given` objects
  - `issued` with `date-parts`
  - `publisher`, `publisher-place` etc.
- Processing takes ~20-30 seconds
- Preview shows structured data

**Pass Criteria:**
- ✅ No API errors
- ✅ All entries parsed
- ✅ Proper metadata structure
- ✅ Output imports cleanly to Zotero

**Cost:** ~$0.01

---

### Test 9: OpenRouter LLM Integration

**Objective:** Verify OpenRouter API integration

**Prerequisites:** Valid OpenRouter API key

**Steps:**
1. Open `index.html`
2. Upload `examples/test_bibliography.txt`
3. Select "OpenRouter" as LLM provider
4. Model: `anthropic/claude-3.5-sonnet`
5. Enter valid API key
6. Batch size: 5
7. Click "Process Bibliography"

**Expected Results:**
- API calls succeed
- Structured output with proper fields
- Processing completes successfully

**Pass Criteria:**
- ✅ No API errors
- ✅ All entries parsed
- ✅ Quality metadata extraction
- ✅ Output imports cleanly to Zotero

**Cost:** ~$0.02-0.05

---

### Test 10: Error Handling - Invalid API Key

**Objective:** Verify API key validation and error handling

**Steps:**
1. Select OpenAI or OpenRouter
2. Enter invalid API key: `sk-invalid12345`
3. Process a file
4. Observe error handling

**Expected Results:**
- API returns 401 or 403 error
- Clear error message displayed
- Application doesn't crash
- Entries fall back to stub records
- Failed entries tracked

**Pass Criteria:**
- ✅ Error caught and displayed
- ✅ User-friendly error message
- ✅ Partial results available
- ✅ Can download failed entries

---

### Test 11: Large Dataset Processing

**Objective:** Verify performance with full dataset

**Prerequisites:**
- Full URL scraping working (with CORS proxy)
- Optional: LLM API key

**Steps:**
1. Use URL with CORS proxy (full dataset, no max entries limit)
2. Select LLM provider (or "No LLM" for faster test)
3. Process full bibliography
4. Monitor progress

**Expected Results:**
- **Without LLM:** ~10-15 seconds total
- **With LLM:** ~60-90 minutes total
- 1,088 entries extracted
- Progress bar updates regularly
- Log shows batch progress
- First entry: "Abbamonte, Salvatore. 1907..."
- Last entry: "Zucchi, John E. 1992..."

**Pass Criteria:**
- ✅ All 1,088 entries processed
- ✅ No memory issues
- ✅ Progress indicators work
- ✅ Output file complete

**Note:** For full LLM test, expect 60-90 minutes and ~$0.50-1.00 cost.

---

### Test 12: Retry Logic

**Objective:** Verify retry logic for API failures

**Steps:**
1. Use LLM provider with valid key
2. Process a batch
3. Simulate network issues (disable/enable network mid-process)
4. Observe retry behavior

**Expected Results:**
- Failed requests retry up to 3 times
- Exponential backoff: 2s, 4s, 8s
- Log shows retry attempts
- Eventually succeeds or creates stub records

**Pass Criteria:**
- ✅ Retries occur automatically
- ✅ Backoff delays implemented
- ✅ Clear logging of retries
- ✅ Graceful failure handling

---

### Test 13: Progress Indicators

**Objective:** Verify UI feedback during processing

**Steps:**
1. Process a file with LLM (multiple batches)
2. Observe progress bar and logs

**Expected Results:**
- Progress bar updates after each batch
- Percentage increases correctly
- Log shows detailed steps:
  - "Fetching from URL..." or "Reading file..."
  - "Splitting entries..."
  - "Found X entries"
  - "Processing batch 1/N..."
  - etc.
- Progress text updates with current step

**Pass Criteria:**
- ✅ Progress bar animates smoothly
- ✅ Accurate percentage calculation
- ✅ Log entries timestamped
- ✅ All major steps logged

---

### Test 14: Failed Entries Tracking

**Objective:** Verify failed entry handling and reporting

**Steps:**
1. Process entries with LLM
2. If some fail (or simulate failures), observe handling
3. Download failed entries file

**Expected Results:**
- Failed entries saved as stub records in main output
- "Download Failed Entries" button appears
- Failed entries file contains:
  - Header with count
  - Numbered entries
  - Visual separators
- Stub records have note: "LLM parse failed..."

**Pass Criteria:**
- ✅ Failed entries tracked separately
- ✅ Stub records in main output
- ✅ Failed entries file well-formatted
- ✅ User can review failures

---

### Test 15: Browser Compatibility

**Objective:** Verify cross-browser functionality

**Browsers to Test:**
- Chrome/Chromium
- Firefox
- Safari
- Edge

**Steps:**
1. Open `index.html` in each browser
2. Run basic file upload test
3. Check console for errors
4. Verify UI renders correctly

**Expected Results:**
- Works in all modern browsers
- No JavaScript errors
- UI renders properly
- File operations work

**Pass Criteria:**
- ✅ Chrome: Full functionality
- ✅ Firefox: Full functionality
- ✅ Safari: Full functionality (if available)
- ✅ Edge: Full functionality

---

### Test 16: Mobile/Responsive Design

**Objective:** Verify mobile responsiveness

**Steps:**
1. Open in browser
2. Toggle device emulation (mobile viewport)
3. Test all UI elements
4. Process a file

**Expected Results:**
- UI adapts to mobile viewport
- Buttons stack vertically
- Text remains readable
- File upload works
- Processing works

**Pass Criteria:**
- ✅ Responsive layout works
- ✅ Touch targets appropriate size
- ✅ No horizontal scrolling
- ✅ Full functionality on mobile

---

## Test Results Template

```
Test Date: _______________
Tester: _______________
Browser: _______________ (version: ___)
OS: _______________

| Test # | Test Name | Pass/Fail | Notes |
|--------|-----------|-----------|-------|
| 1 | Basic File Upload | ⬜ PASS ⬜ FAIL | |
| 2 | DOCX Upload | ⬜ PASS ⬜ FAIL | |
| 3 | CORS Error Handling | ⬜ PASS ⬜ FAIL | |
| 4 | URL Scraping | ⬜ PASS ⬜ FAIL | |
| 5 | Author Expansion | ⬜ PASS ⬜ FAIL | |
| 6 | CSL-JSON Output | ⬜ PASS ⬜ FAIL | |
| 7 | RIS Output | ⬜ PASS ⬜ FAIL | |
| 8 | OpenAI LLM | ⬜ PASS ⬜ FAIL | |
| 9 | OpenRouter LLM | ⬜ PASS ⬜ FAIL | |
| 10 | Error Handling | ⬜ PASS ⬜ FAIL | |
| 11 | Large Dataset | ⬜ PASS ⬜ FAIL | |
| 12 | Retry Logic | ⬜ PASS ⬜ FAIL | |
| 13 | Progress Indicators | ⬜ PASS ⬜ FAIL | |
| 14 | Failed Entries | ⬜ PASS ⬜ FAIL | |
| 15 | Browser Compat. | ⬜ PASS ⬜ FAIL | |
| 16 | Mobile/Responsive | ⬜ PASS ⬜ FAIL | |
```

## Debugging Tips

### Browser Console

Open Developer Tools (F12) and check:
- **Console tab:** JavaScript errors and debug messages
- **Network tab:** API calls and fetch requests
- **Application tab:** (not needed, no localStorage used)

### Common Issues

**"mammoth is not defined"**
- Check internet connection
- Verify mammoth.js CDN loads (Network tab)
- Try refreshing page

**"Failed to fetch"**
- CORS issue (use proxy or extension)
- Network connectivity
- Invalid URL

**"JSON parsing error"**
- LLM returned invalid JSON
- Check raw response in console
- May need to adjust prompts

**Slow processing**
- Normal for large datasets with LLM
- Check batch size (reduce if timing out)
- Monitor Network tab for stalled requests

## Automated Testing (Future)

For automated testing, consider:
- Jest for unit tests
- Playwright/Cypress for E2E tests
- Mock API responses for LLM tests
- Test fixtures for different file types

## Reporting Issues

When reporting issues, include:
1. Test number and name
2. Browser and version
3. OS and version
4. Console errors (screenshot or text)
5. Steps to reproduce
6. Expected vs actual behavior

---

**Happy Testing!** 🧪
