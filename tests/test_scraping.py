#!/usr/bin/env python3
"""Test script to analyze the web scraping quality without interactive prompts."""

import sys
import re
from omeka_bib_to_zotero import fetch_page_text, split_entries, expand_repeated_authors

# Test the scraping logic
url = "https://italianamericanimprints.omeka.net/actual-bibliography"

print("=" * 80)
print("TESTING WEB SCRAPING LOGIC")
print("=" * 80)

# Step 1: Fetch the raw text
print("\n[1] Fetching page text...")
raw_text = fetch_page_text(url)
print(f"✓ Fetched {len(raw_text)} characters")

# Save sample of raw text for inspection
print("\n--- First 1000 characters of raw text ---")
print(raw_text[:1000])
print("...")
print("\n--- Last 500 characters of raw text ---")
print(raw_text[-500:])

# Step 2: Split into entries
print("\n[2] Splitting into entries...")
entries = split_entries(raw_text)
print(f"✓ Split into {len(entries)} entries")

# Step 3: Expand ditto marks
print("\n[3] Expanding repeated authors (ditto marks)...")
expanded_entries = expand_repeated_authors(entries)
print(f"✓ Processed {len(expanded_entries)} entries")

# Analyze entry quality
print("\n" + "=" * 80)
print("ENTRY QUALITY ANALYSIS")
print("=" * 80)

# Show first 10 entries
print("\n--- First 10 entries ---")
for i, entry in enumerate(expanded_entries[:10], 1):
    print(f"\n[{i}] {entry[:150]}{'...' if len(entry) > 150 else ''}")

# Look for problematic patterns
print("\n" + "=" * 80)
print("CHECKING FOR ISSUES")
print("=" * 80)

# 1. Check for very short entries (might be navigation/menu items)
short_entries = [e for e in expanded_entries if len(e) < 50]
print(f"\n✓ Entries < 50 chars: {len(short_entries)}")
if short_entries:
    print("Sample short entries:")
    for e in short_entries[:5]:
        print(f"  - '{e}'")

# 2. Check for very long entries (might be merged)
long_entries = [e for e in expanded_entries if len(e) > 500]
print(f"\n✓ Entries > 500 chars: {len(long_entries)}")
if long_entries:
    print("Sample long entries:")
    for e in long_entries[:3]:
        print(f"  - {e[:200]}...")

# 3. Check for entries that look like navigation/menu items
nav_patterns = [
    r'^(home|about|browse|search|contact|map|essays?|collections?)',
    r'^[A-Z][a-z]+\s*$',  # Single capitalized word
    r'search using this query type',
    r'advanced search',
    r'simple pages',
]
suspicious = []
for entry in expanded_entries:
    for pattern in nav_patterns:
        if re.match(pattern, entry, re.IGNORECASE):
            suspicious.append(entry)
            break

print(f"\n✓ Suspicious navigation-like entries: {len(suspicious)}")
if suspicious:
    print("Sample suspicious entries:")
    for e in suspicious[:10]:
        print(f"  - '{e}'")

# 4. Check first and last entries to verify boundaries
print("\n--- First entry ---")
print(expanded_entries[0])

print("\n--- Last entry ---")
print(expanded_entries[-1])

# 5. Check for entries starting with ditto marks (should be expanded)
ditto_pattern = r'^(?:[_]{3,}|—{2,}|—)\.?\s'
remaining_dittos = [e for e in expanded_entries if re.match(ditto_pattern, e)]
print(f"\n✓ Entries still starting with ditto marks: {len(remaining_dittos)}")
if remaining_dittos:
    print("Sample unexpanded dittos:")
    for e in remaining_dittos[:5]:
        print(f"  - {e[:150]}...")

print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)
print(f"Total entries extracted: {len(expanded_entries)}")
print(f"Raw text length: {len(raw_text):,} characters")
print(f"Average entry length: {sum(len(e) for e in expanded_entries) / len(expanded_entries):.1f} characters")
print(f"Shortest entry: {min(len(e) for e in expanded_entries)} characters")
print(f"Longest entry: {max(len(e) for e in expanded_entries)} characters")
