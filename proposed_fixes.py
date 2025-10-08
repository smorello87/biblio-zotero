#!/usr/bin/env python3
"""
Proposed fixes for the web scraping issues identified in SCRAPING_ANALYSIS.md

These functions can be integrated into omeka_bib_to_zotero.py to replace
the buggy implementations.
"""

import re
from typing import List, Optional
import requests
from bs4 import BeautifulSoup


# ==============================================================================
# FIX 1: Improved Entry Splitting
# ==============================================================================

def split_entries_v2(raw_text: str) -> List[str]:
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


# ==============================================================================
# FIX 2: Improved Ditto Mark Expansion
# ==============================================================================

def expand_repeated_authors_v2(entries: List[str]) -> List[str]:
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


# ==============================================================================
# ALTERNATIVE: Direct HTML Parsing (More Robust)
# ==============================================================================

def fetch_entries_from_html(url: str) -> List[str]:
    """
    Alternative approach: Parse HTML directly instead of text extraction.

    Advantages:
    - Respects HTML structure (no splitting issues)
    - More robust to formatting variations
    - Preserves intended entry boundaries

    Disadvantages:
    - Assumes entries are in <p> tags
    - May need adjustment for different Omeka themes
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

        # Also check for div containers (some themes wrap paragraphs)
        elif sib.name == "div":
            for p in sib.find_all("p"):
                text = p.get_text(" ", strip=True)
                text = re.sub(r'\s+', ' ', text)
                if text and len(text) > 10:
                    if text.lower().startswith("search using this query type"):
                        continue
                    entries.append(text)

    if not entries:
        # Fallback: try getting all paragraphs after heading
        for p in bib_heading.find_all_next("p"):
            text = p.get_text(" ", strip=True)
            text = re.sub(r'\s+', ' ', text)
            if text and len(text) > 10:
                if text.lower().startswith("search using this query type"):
                    continue
                entries.append(text)
            # Stop after collecting reasonable number
            if len(entries) > 2000:
                break

    return entries


# ==============================================================================
# TEST HARNESS
# ==============================================================================

def test_fixes():
    """Test the proposed fixes against known problematic cases."""

    # Test case 1: Ditto mark expansion
    test_entries_ditto = [
        "Abbamonte, Salvatore. 1907. Patria e donna: Episodio della guerra italo-austriaca del 1859. Dramma in un prologo e 4 atti. New York: Cappabianca.",
        "______. 1919. Sacrificio: dramma in tre atti. New York: Bagnasco Press.",
        "______. 1940a. Nella colonia di quarantacinque anni or sono. La Follia, January 14.",
        "______. 1940b. Nei primordi del teatro coloniale. La Follia, February 11.",
    ]

    print("=" * 80)
    print("TEST 1: Ditto Mark Expansion")
    print("=" * 80)

    expanded = expand_repeated_authors_v2(test_entries_ditto)
    for i, entry in enumerate(expanded, 1):
        print(f"\n[{i}] {entry[:120]}...")
        # Check for accumulated years
        if i > 1 and re.search(r'\d{4}[a-z]?\s+\d{4}', entry):
            print("    ❌ ERROR: Accumulated years detected!")
        else:
            print("    ✓ OK")

    # Test case 2: Entry splitting with embedded line breaks
    test_raw_text = """Abbamonte, Salvatore. 1940d.
I figli dello Spirito Santo, ovvero, Le avventure di due trovatelli.
Storia  rustica siciliana
. New York: Eugene Printing Service.


Adams, Joseph H. [1903].
In the Italian Quarter of New York
. New York: [n.p.]."""

    print("\n\n" + "=" * 80)
    print("TEST 2: Entry Splitting with Line Breaks")
    print("=" * 80)
    print("\nInput text:")
    print(repr(test_raw_text))

    entries = split_entries_v2(test_raw_text)
    print(f"\n\nExtracted {len(entries)} entries:")
    for i, entry in enumerate(entries, 1):
        print(f"\n[{i}] {entry}")

    if len(entries) == 2:
        print("\n✓ Correct number of entries")
    else:
        print(f"\n❌ ERROR: Expected 2 entries, got {len(entries)}")


if __name__ == "__main__":
    test_fixes()
