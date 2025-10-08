#!/usr/bin/env python3
"""Detailed analysis of problematic entries."""

import re
from omeka_bib_to_zotero import fetch_page_text, split_entries, expand_repeated_authors

url = "https://italianamericanimprints.omeka.net/actual-bibliography"

raw_text = fetch_page_text(url)
entries = split_entries(raw_text)
expanded = expand_repeated_authors(entries)

print("=" * 80)
print("DETAILED ANALYSIS OF PROBLEMATIC ENTRIES")
print("=" * 80)

# Issue 1: Ditto mark expansion problem (entries 3-6)
print("\n\n[CRITICAL ISSUE 1] Ditto Mark Expansion Concatenating Years")
print("-" * 80)
print("The expand_repeated_authors() function is incorrectly accumulating years")
print("when replacing ditto marks. It should only extract the author name, not")
print("carry forward the year from the previous match.\n")

print("Example problematic entries:")
for i in [0, 1, 2, 3, 4, 5]:
    print(f"\n[{i+1}] {expanded[i]}")

# Show what the raw text looks like before expansion
print("\n\nRaw text before ditto expansion (first 600 chars):")
print(raw_text[:600])

# Issue 2: Split entries (entry 6-7)
print("\n\n[CRITICAL ISSUE 2] Entry Splitting Breaks Mid-Citation")
print("-" * 80)
print("Some entries are being split incorrectly when the source HTML contains")
print("line breaks within a single bibliographic entry.\n")

print("Entry 6 (incomplete):")
print(f"  {expanded[5]}")
print("\nEntry 7 (continuation):")
print(f"  {expanded[6]}")

# Find more split entries
print("\n\nSearching for more potentially split entries...")
split_candidates = []
for i, entry in enumerate(expanded):
    # Entries that start with lowercase or don't have standard citation structure
    if entry and not re.match(r'^[A-Z]', entry):
        split_candidates.append((i, entry))
    # Entries that are very short and don't have a period
    elif len(entry) < 50 and '.' not in entry:
        split_candidates.append((i, entry))

print(f"Found {len(split_candidates)} potential split entries:")
for i, entry in split_candidates[:15]:
    print(f"  [{i+1}] {entry}")

# Issue 3: Incomplete entries
print("\n\n[ISSUE 3] Incomplete/Truncated Entries")
print("-" * 80)
incomplete = []
for i, entry in enumerate(expanded):
    # Entries ending with just author and year, no content
    if re.match(r'^[^.]+\.\s+\d{4}[a-z]?\.\s*$', entry):
        incomplete.append((i, entry))

print(f"Found {len(incomplete)} potentially incomplete entries:")
for i, entry in incomplete[:10]:
    print(f"  [{i+1}] {entry}")

# Check the raw HTML for patterns
print("\n\n[ANALYSIS] Raw Text Patterns")
print("-" * 80)

# Look for how entries are separated in the raw text
sample = raw_text[500:2000]
print("Sample of raw text (chars 500-2000) to see separators:")
print(repr(sample))

# Count different types of line breaks
double_newlines = raw_text.count('\n\n')
triple_newlines = raw_text.count('\n\n\n')
print(f"\nDouble newlines (\\n\\n): {double_newlines}")
print(f"Triple newlines (\\n\\n\\n): {triple_newlines}")
