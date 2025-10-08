# Web Scraping Analysis & Recommendations

## Executive Summary

The current scraping logic successfully extracts **1,113 entries** from the Omeka bibliography page, but has **three critical issues** that reduce data quality:

1. **Ditto mark expansion incorrectly accumulates years** (40+ affected entries)
2. **Entry splitting breaks mid-citation** (46+ split entries)
3. **Some entries are incomplete/truncated** (4 confirmed cases)

## Detailed Analysis

### Issue 1: Ditto Mark Expansion Bug (CRITICAL)

**Problem:** The `expand_repeated_authors()` function extracts the author name by taking "everything up to the first period" as the author chunk. This works for the first entry but **accumulates years** when processing subsequent ditto marks.

**Example:**
```
Entry 1: Abbamonte, Salvatore. 1907. [title]...
Entry 2: ______. 1919. [title]...  → Abbamonte, Salvatore 1919. [title]...  ✗ (missing period)
Entry 3: ______. 1940a. [title]... → Abbamonte, Salvatore 1919 1940a. [title]... ✗ (accumulated years)
Entry 4: ______. 1940b. [title]... → Abbamonte, Salvatore 1919 1940a 1940b. [title]... ✗ (more accumulation)
```

**Root Cause (lines 137-139):**
```python
m = re.match(r"^([^\.]+)\.\s", e)  # Matches "Abbamonte, Salvatore 1919 1940a" (no period after name)
if m:
    prev_author = m.group(1).strip()  # Stores the entire string including years
```

**Affected Entries:** 40+ entries where an author has multiple works with ditto marks.

**Fix:** Extract only the author name (before the year) from the pattern:
```python
# Extract author name before year pattern (matches "Surname, Name" or just "Surname")
m = re.match(r"^([^\.]+?),\s+[^\.]+\.\s+\d{4}", e)  # Full "Surname, Given. YEAR" pattern
if not m:
    m = re.match(r"^([^\.]+)\.\s", e)  # Fallback to period-based extraction
if m:
    prev_author = m.group(1).strip()
```

---

### Issue 2: Entry Splitting Breaks Mid-Citation (CRITICAL)

**Problem:** The HTML source contains line breaks **within** individual bibliographic entries. The current logic splits on blank lines (`\n\n`), which works for most entries, but some entries have **triple newlines** (`\n\n\n`) that include a line break in the middle of a title or description.

**Example from raw HTML:**
```
______. 1940d.
I figli dello Spirito Santo, ovvero, Le avventure di due trovatelli.
Storia  rustica siciliana
. New York: Eugene Printing Service.
```

Note the line break between "Storia" and "rustica siciliana" - this creates a double newline that the splitter interprets as an entry boundary.

**Current Splitting Logic (lines 106-111):**
```python
text = re.sub(r"\n{3,}", "\n\n", text)  # Collapses triple+ newlines to double
blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]  # Splits on blank lines
```

**Result:** Entry 6 becomes "...Storia" and entry 7 becomes "rustica siciliana..."

**Affected Entries:** 46+ entries are incorrectly split (identified by starting with lowercase or missing standard citation structure).

**Fix Options:**

**Option A (Conservative):** Better heuristic for entry boundaries
```python
# An entry boundary is a blank line followed by a capitalized name pattern
# This prevents splitting on blank lines within entry content
blocks = []
current = []
for line in text.split('\n'):
    if line.strip() == '':
        # Check if next non-empty line starts a new entry
        continue
    elif re.match(r'^[A-Z][a-z]+,\s+[A-Z]|^______', line):
        # New entry starting (author name or ditto)
        if current:
            blocks.append('\n'.join(current))
        current = [line]
    else:
        current.append(line)
if current:
    blocks.append('\n'.join(current))
```

**Option B (Recommended):** Look for entry start patterns more precisely
```python
# Entries start with either:
# 1. "Surname, Firstname. YEAR."
# 2. "______. YEAR." (ditto mark)
# 3. "Surname, Firstname [year]." (bracketed year)

entry_start_pattern = r'^(?:[A-Z][a-z]+(?:-[A-Z][a-z]+)?,\s+[A-Z]|______)'

# Split by triple newline first (entry separator), then validate
raw_blocks = re.split(r'\n\n\n+', text)
blocks = []
temp_accumulator = []

for block in raw_blocks:
    block = block.strip()
    if not block:
        continue

    # Check if block starts with an entry pattern
    if re.match(entry_start_pattern, block):
        # Flush any accumulated text
        if temp_accumulator:
            blocks.append(' '.join(temp_accumulator))
            temp_accumulator = []
        blocks.append(block)
    else:
        # This might be a continuation of the previous entry
        if blocks:
            blocks[-1] += ' ' + block
        else:
            temp_accumulator.append(block)

# Handle any remaining accumulator
if temp_accumulator:
    blocks.append(' '.join(temp_accumulator))
```

---

### Issue 3: Incomplete/Truncated Entries (MEDIUM)

**Problem:** 4 entries consist only of "Author. Year." with no title or content:
- Bencivenni, Marcella. 2011.
- Concordia, Tomaso. 1911.
- Pane, Michele. 1949.
- Tusiani, Joseph [Giuseppe]. 1943.

**Likely Cause:** These might be:
1. Data entry errors in the original Omeka database
2. Multi-part entries where the continuation is on the next line (similar to Issue 2)
3. See-also references that are incomplete

**Investigation Needed:** Check the raw HTML around these entries to determine if data is missing or just needs better parsing.

**Example Check:**
```python
# Search for "Bencivenni, Marcella. 2011" in raw HTML to see what follows
```

---

### Issue 4: Non-breaking Spaces and Formatting (MINOR)

**Observation:** The raw HTML contains non-breaking spaces (`\xa0`) that are being converted to regular spaces. This is working correctly.

**Example from raw text:**
```
Storia\xa0\xa0 rustica siciliana
```

**Current handling (line 105):** `re.sub(r"\r\n?|\u00a0", "\n", raw_text)` - converts `\xa0` to newline, which might be contributing to Issue 2.

**Fix:** Replace non-breaking spaces with regular spaces instead:
```python
text = text.replace('\xa0', ' ')  # Non-breaking space to regular space
text = re.sub(r'\r\n?', '\n', text)  # Normalize line endings
```

---

## Entry Count Verification

**Current Count:** 1,113 entries

To verify this is correct:
1. The raw text shows `\n\n` appears 1,087 times
2. Triple newlines `\n\n\n` also appear 1,087 times (this is the separator pattern)
3. This suggests ~1,087 entries if we split correctly

**Discrepancy:** Current code gets 1,113 entries (26 more than expected). This is likely due to:
- Incorrect splitting creating extra fragments (Issue 2)
- The split logic creating entries from non-entry text

**Recommendation:** After fixing Issues 1 and 2, re-count to verify we get the correct number.

---

## HTML Structure Analysis

Based on WebFetch analysis:

```html
<h1>Bibliography</h1>
<p>Abbamonte, Salvatore. 1907. <em>Patria e donna...</em></p>
<p>______. 1919. <em>Sacrificio...</em></p>
...
```

- **Heading:** `<h1>Bibliography</h1>`
- **Entries:** Each entry appears to be in a `<p>` tag
- **Separator:** Blank lines between entries (rendered as paragraph breaks)
- **Ditto marks:** Underscores (`______`) indicate repeated author
- **Italics:** Titles are in `<em>` tags (currently being stripped correctly)

**Current extraction strategy is sound:** Finding the h1 heading and extracting following content is correct.

---

## Recommendations

### Priority 1: Fix Ditto Mark Expansion (Immediate)

**Impact:** 40+ entries have corrupted author fields
**Effort:** Low (5-10 lines of code)
**Risk:** Low (easy to test and verify)

Replace lines 137-139 in `omeka_bib_to_zotero.py`:
```python
# OLD (buggy):
m = re.match(r"^([^\.]+)\.\s", e)
if m:
    prev_author = m.group(1).strip()

# NEW (fixed):
# Match "Surname, Given. YEAR" pattern and extract only "Surname, Given"
m = re.match(r"^([^,]+,\s+[^.]+?)\.\s+\d{4}", e)
if not m:
    # Fallback for entries without years or unusual formats
    m = re.match(r"^([^\.]+)\.\s", e)
if m:
    prev_author = m.group(1).strip()
```

### Priority 2: Fix Entry Splitting (High Priority)

**Impact:** 46+ entries are incorrectly split
**Effort:** Medium (20-30 lines of code with testing)
**Risk:** Medium (needs careful testing to avoid over/under-splitting)

Replace the `split_entries()` function with the improved version (Option B above).

### Priority 3: Investigate Incomplete Entries (Medium Priority)

**Impact:** 4 entries are incomplete
**Effort:** Low (manual investigation + potential fix)
**Risk:** Low

Manually check the source HTML for these 4 entries to determine if:
- They're actually incomplete in the source
- They're being truncated by the parser
- They need special handling

### Priority 4: Improve Non-breaking Space Handling (Low Priority)

**Impact:** Contributes to splitting issues
**Effort:** Trivial (1 line change)
**Risk:** None

Change line 105 to preserve spaces instead of converting to newlines.

---

## Testing Plan

1. **Unit Tests:** Create test cases for:
   - Ditto mark expansion with various patterns
   - Entry splitting with embedded line breaks
   - Edge cases (bracketed years, "See" references, etc.)

2. **Integration Test:** Run full scrape and verify:
   - Expected entry count (~1,087 based on separators)
   - No entries starting with lowercase (except "ed." patterns)
   - No ditto marks in final output
   - All entries have minimum required fields

3. **Sample Validation:** Manually review:
   - First 10 entries
   - Last 10 entries
   - 20 random entries from middle
   - All "Abbamonte, Salvatore" entries (known problematic case)
   - All 4 incomplete entries

4. **LLM Parse Test:** Run with `--max 50` and LLM to verify structured output quality

---

## Code Quality Observations

**Strengths:**
- Good separation of concerns (fetch, split, expand, parse)
- Robust fallback when h1 heading not found
- Handles multiple LLM providers
- UTF-8 encoding handled correctly

**Improvement Opportunities:**
- Add logging/debug output to show entry boundaries during splitting
- Add validation for expected entry patterns
- Consider using BeautifulSoup to extract `<p>` tags directly instead of text-based splitting
- Add entry count warning if count differs significantly from expected

---

## Alternative Approach: Direct HTML Parsing

Instead of extracting text and splitting on blank lines, consider parsing HTML paragraphs directly:

```python
def fetch_entries_from_html(url: str) -> List[str]:
    """Fetch entries by parsing HTML paragraph tags directly."""
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    # Find the Bibliography heading
    bib_heading = None
    for tag in soup.find_all(["h1", "h2", "h3"]):
        if tag.get_text(strip=True).lower() == "bibliography":
            bib_heading = tag
            break

    if not bib_heading:
        raise ValueError("Bibliography heading not found")

    # Extract all paragraphs after the heading
    entries = []
    for sib in bib_heading.find_next_siblings():
        if sib.name in ["h1", "h2"]:
            break  # Stop at next major heading
        if sib.name == "p":
            # Get text content, preserving some structure
            text = sib.get_text(" ", strip=True)
            if text and not text.lower().startswith("search using"):
                entries.append(text)

    return entries
```

**Advantages:**
- Eliminates splitting issues
- More robust to HTML formatting variations
- Respects the actual HTML structure

**Disadvantages:**
- Assumes entries are in `<p>` tags (may not be true for all Omeka themes)
- Requires testing against actual HTML structure

---

## Conclusion

The scraping logic is **fundamentally sound** but has **fixable implementation bugs**:

1. ✅ Successfully extracts the bibliography section
2. ✅ Identifies entries (with some splitting errors)
3. ✅ Handles ditto marks (but with accumulation bug)
4. ✅ Filters navigation text effectively

**Recommended Action Plan:**
1. Fix the ditto mark expansion bug (Priority 1) - **30 minutes**
2. Fix the entry splitting logic (Priority 2) - **1-2 hours**
3. Verify the fixes with full scrape + manual review - **30 minutes**
4. Investigate incomplete entries - **15 minutes**

**Total effort:** ~3-4 hours to achieve high-quality extraction.

**Current Status:** The script is **functional but needs refinement** before processing all entries through the LLM to avoid propagating parsing errors.
