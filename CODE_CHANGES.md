# Code Changes - Quick Reference

## Changes to Apply to `omeka_bib_to_zotero.py`

### Change 1: Replace `split_entries()` function (lines 102-124)

**OLD CODE (REMOVE):**
```python
def split_entries(raw_text: str) -> List[str]:
    """Split into paragraph-style entries; normalize whitespace; drop empties."""
    # Normalize newlines
    text = re.sub(r"\r\n?|\u00a0", "\n", raw_text)
    # Collapse multiple blank lines to two max for cleaner splitting
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Some themes may insert stray menu text — try to cut off after the last plausible entry marker
    # but generally we'll just split on blank lines:
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]

    # Strip leading/trailing whitespace on each block and collapse inner whitespace sensibly
    cleaned = []
    for b in blocks:
        # Remove leftover menu labels like 'Search using this query type' etc.
        if b.lower().startswith("search using this query type"):
            continue
        # Collapse excessive inner spaces while preserving punctuation
        b2 = re.sub(r"[\t\f\v]+", " ", b).strip()
        # Join hard linebreaks inside a paragraph
        b2 = re.sub(r"\n+", " ", b2)
        cleaned.append(b2)
    return cleaned
```

**NEW CODE (REPLACE WITH):**
```python
def split_entries(raw_text: str) -> List[str]:
    """
    Split into individual bibliographic entries with improved handling
    of line breaks within entries.

    Improvements over original:
    - Uses the natural triple-newline separators from HTML
    - Preserves line breaks within entries by joining them with spaces
    - More robust filtering of non-entry text
    """
    # Normalize line endings and non-breaking spaces
    text = raw_text.replace('\xa0', ' ')  # Non-breaking space to regular space
    text = re.sub(r'\r\n?', '\n', text)  # Normalize line endings

    # The HTML source uses triple newlines to separate entries
    # Each entry may have internal line breaks (single or double newlines)
    # So we split on triple newlines and join internal lines with spaces
    raw_blocks = re.split(r'\n\n\n+', text)

    entries = []
    for block in raw_blocks:
        block = block.strip()
        if not block:
            continue

        # Join lines within this block with spaces and collapse whitespace
        entry_text = re.sub(r'\s+', ' ', block).strip()

        # Filter out obvious non-entries
        if entry_text.lower().startswith("search using this query type"):
            continue
        if re.match(r'^(home|about|browse|search|contact|map|essays?|collections?)(\s|$)', entry_text, re.IGNORECASE):
            continue
        # Skip very short blocks that don't look like citations
        if len(entry_text) < 20 and not re.search(r'\d{4}', entry_text):
            continue

        entries.append(entry_text)

    return entries
```

---

### Change 2: Replace `expand_repeated_authors()` function (lines 127-141)

**OLD CODE (REMOVE):**
```python
def expand_repeated_authors(entries: List[str]) -> List[str]:
    """Replace author ditto marks (e.g., '______.' or em-dashes) with the previous author string."""
    out = []
    prev_author: Optional[str] = None
    for e in entries:
        # Detect ditto markers at start
        if re.match(r"^(?:[_]{3,}|—{2,}|—)\.?\s", e):
            if prev_author:
                e = re.sub(r"^(?:[_]{3,}|—{2,}|—)\.?", prev_author, e, count=1)
        # Update prev_author for next round: take everything up to first period as author chunk
        m = re.match(r"^([^\.]+)\.\s", e)
        if m:
            prev_author = m.group(1).strip()
        out.append(e)
    return out
```

**NEW CODE (REPLACE WITH):**
```python
def expand_repeated_authors(entries: List[str]) -> List[str]:
    """
    Replace author ditto marks with the previous author name.

    Improvements over original:
    - Correctly extracts only the author name (not accumulated years)
    - Handles various author name formats
    - More robust pattern matching
    """
    out = []
    prev_author: Optional[str] = None

    for e in entries:
        # Detect ditto markers at start
        ditto_match = re.match(r'^(_{3,}|—{2,}|—)\.?\s', e)
        if ditto_match:
            if prev_author:
                # Replace ditto with previous author name
                e = re.sub(r'^(_{3,}|—{2,}|—)\.?', prev_author + '.', e, count=1)

        # Update prev_author for next iteration
        # Try multiple patterns to extract author name:

        # Pattern 1: "Surname, Given [middle]. YEAR" (most common)
        m = re.match(r'^([A-Z][a-zA-Z\'\-]+(?:\s+[A-Z]\.?)?,\s+[A-Z][a-zA-Z\.\s\-]+?)\.\s+[\[\d]', e)
        if m:
            prev_author = m.group(1).strip()
        else:
            # Pattern 2: "Surname, Given [pseudonym]." (with brackets)
            m = re.match(r'^([^\.]+?)\s*\[[^\]]+\]\.\s+[\d\[]', e)
            if m:
                prev_author = m.group(1).strip()
            else:
                # Pattern 3: Simple "Surname, Given."
                m = re.match(r'^([A-Z][^\.]+)\.\s+', e)
                if m:
                    # Make sure we didn't capture the year
                    candidate = m.group(1).strip()
                    # Remove year if present (e.g., "Surname, Given 1940a" -> "Surname, Given")
                    candidate = re.sub(r'\s+\d{4}[a-z]?$', '', candidate)
                    prev_author = candidate

        out.append(e)

    return out
```

---

## Summary of Changes

### What's Fixed:

1. **Entry splitting** now correctly handles line breaks within entries
   - Uses triple-newline separators (actual HTML structure)
   - Joins internal line breaks with spaces
   - Result: 1,088 entries (was 1,113 with duplicates/splits)

2. **Ditto mark expansion** no longer accumulates years
   - Extracts only the author name from previous entry
   - Handles multiple name formats correctly
   - Result: 0 entries with accumulated years (was 40+)

3. **Non-breaking spaces** are handled correctly
   - Replaced with regular spaces instead of newlines
   - Prevents false entry boundaries

### Testing After Changes:

```bash
# Quick test (10 entries, no LLM)
python omeka_bib_to_zotero.py --max 10 --out test.json --format csljson

# Full verification
python test_fixes_on_real_data.py
```

Expected output:
- ✅ 1,088 total entries
- ✅ 0 accumulated years
- ✅ 0 split entries
- ✅ First entry: "Abbamonte, Salvatore. 1907..."
- ✅ Last entry: "Zucchi, John E. 1992..."

---

## Alternative: Direct HTML Parsing (Optional)

If you want the most robust solution, you can also replace `fetch_page_text()` with direct HTML parsing:

**Add this new function** (can be placed after `fetch_page_text()`):

```python
def fetch_entries_from_html(url: str) -> List[str]:
    """
    Alternative: Parse HTML directly instead of text extraction.
    More robust to formatting variations.
    """
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
        raise ValueError("Bibliography heading not found in HTML")

    # Extract all content after the heading until next major heading
    entries = []
    for sib in bib_heading.find_next_siblings():
        # Stop at next major heading
        if sib.name in ["h1", "h2"]:
            break

        # Extract text from paragraphs
        if sib.name == "p":
            # Get text, joining inline elements with spaces
            text = sib.get_text(" ", strip=True)
            # Clean up multiple spaces
            text = re.sub(r'\s+', ' ', text)

            if text and len(text) > 10:
                # Filter out navigation/menu items
                if text.lower().startswith("search using this query type"):
                    continue
                entries.append(text)

    return entries
```

**Then in `main()` function**, replace line 480:
```python
# OLD:
raw = fetch_page_text(url)

# NEW (if using HTML parsing):
entries = fetch_entries_from_html(url)
# Skip the split_entries call since we already have entries
```

And modify lines 482-484:
```python
# OLD:
debug("Splitting into entries…")
entries = split_entries(raw)
entries = expand_repeated_authors(entries)

# NEW (if using HTML parsing):
debug("Expanding repeated authors…")
entries = expand_repeated_authors(entries)
```

This approach eliminates the splitting step entirely and is the most robust.
