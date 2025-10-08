#!/usr/bin/env python3
"""Test the proposed fixes on the actual Omeka website."""

import re
from proposed_fixes import split_entries_v2, expand_repeated_authors_v2, fetch_entries_from_html
from omeka_bib_to_zotero import fetch_page_text

url = "https://italianamericanimprints.omeka.net/actual-bibliography"

print("=" * 80)
print("TESTING PROPOSED FIXES ON REAL DATA")
print("=" * 80)

# Method 1: Using improved text-based splitting
print("\n[METHOD 1] Text-based extraction with improved splitting")
print("-" * 80)
raw_text = fetch_page_text(url)
print(f"Raw text length: {len(raw_text):,} characters")

entries_v2 = split_entries_v2(raw_text)
print(f"Entries after improved split: {len(entries_v2)}")

expanded_v2 = expand_repeated_authors_v2(entries_v2)
print(f"Entries after ditto expansion: {len(expanded_v2)}")

# Check first 10 entries
print("\n--- First 10 entries (Method 1) ---")
for i, entry in enumerate(expanded_v2[:10], 1):
    print(f"\n[{i}] {entry[:150]}{'...' if len(entry) > 150 else ''}")

# Check for issues
print("\n--- Quality Checks (Method 1) ---")

# 1. Check for accumulated years
accumulated_years = []
for i, entry in enumerate(expanded_v2):
    if re.search(r'\d{4}[a-z]?\s+\d{4}', entry):
        accumulated_years.append((i, entry))

print(f"\n✓ Entries with accumulated years: {len(accumulated_years)}")
if accumulated_years:
    print("Sample:")
    for i, entry in accumulated_years[:3]:
        print(f"  [{i+1}] {entry[:120]}...")

# 2. Check for split entries
split_entries = []
for i, entry in enumerate(expanded_v2):
    if entry and not re.match(r'^[A-Z]', entry) and not entry.startswith('______'):
        split_entries.append((i, entry))

print(f"\n✓ Entries starting with lowercase (split candidates): {len(split_entries)}")
if split_entries:
    print("Sample:")
    for i, entry in split_entries[:5]:
        print(f"  [{i+1}] {entry[:120]}...")

# 3. Check for very short entries
short_entries = [e for e in expanded_v2 if len(e) < 50]
print(f"\n✓ Entries < 50 chars: {len(short_entries)}")
if short_entries:
    print("Sample:")
    for e in short_entries[:5]:
        print(f"  '{e}'")

# Method 2: Direct HTML parsing
print("\n\n" + "=" * 80)
print("[METHOD 2] Direct HTML parsing")
print("-" * 80)

try:
    entries_html = fetch_entries_from_html(url)
    print(f"Entries from HTML: {len(entries_html)}")

    expanded_html = expand_repeated_authors_v2(entries_html)
    print(f"Entries after ditto expansion: {len(expanded_html)}")

    # Check first 10 entries
    print("\n--- First 10 entries (Method 2) ---")
    for i, entry in enumerate(expanded_html[:10], 1):
        print(f"\n[{i}] {entry[:150]}{'...' if len(entry) > 150 else ''}")

    # Quality checks
    print("\n--- Quality Checks (Method 2) ---")

    accumulated_years_html = []
    for i, entry in enumerate(expanded_html):
        if re.search(r'\d{4}[a-z]?\s+\d{4}', entry):
            accumulated_years_html.append((i, entry))

    print(f"\n✓ Entries with accumulated years: {len(accumulated_years_html)}")

    split_entries_html = []
    for i, entry in enumerate(expanded_html):
        if entry and not re.match(r'^[A-Z]', entry) and not entry.startswith('______'):
            split_entries_html.append((i, entry))

    print(f"✓ Entries starting with lowercase: {len(split_entries_html)}")

    short_entries_html = [e for e in expanded_html if len(e) < 50]
    print(f"✓ Entries < 50 chars: {len(short_entries_html)}")

except Exception as e:
    print(f"❌ HTML parsing failed: {e}")
    import traceback
    traceback.print_exc()

# Comparison
print("\n\n" + "=" * 80)
print("COMPARISON SUMMARY")
print("=" * 80)
print(f"\nOriginal method (from previous analysis): 1113 entries")
print(f"Method 1 (improved text splitting):      {len(expanded_v2)} entries")
try:
    print(f"Method 2 (direct HTML parsing):          {len(expanded_html)} entries")
except:
    print(f"Method 2 (direct HTML parsing):          Failed")

print(f"\nExpected based on separators (~1087):     ~1087 entries")

# Recommendation
print("\n" + "=" * 80)
print("RECOMMENDATION")
print("=" * 80)

if len(accumulated_years) == 0 and len(split_entries) < 10:
    print("\n✓ Method 1 (improved text splitting) is working well!")
    print(f"  - No accumulated years detected")
    print(f"  - Minimal split entries ({len(split_entries)})")
    print(f"  - Entry count: {len(expanded_v2)}")
else:
    print(f"\n⚠ Method 1 needs more work:")
    print(f"  - Accumulated years: {len(accumulated_years)}")
    print(f"  - Split entries: {len(split_entries)}")

try:
    if len(accumulated_years_html) == 0 and len(split_entries_html) < 10:
        print(f"\n✓ Method 2 (HTML parsing) is working well!")
        print(f"  - No accumulated years detected")
        print(f"  - Minimal split entries ({len(split_entries_html)})")
        print(f"  - Entry count: {len(expanded_html)}")
except:
    pass
