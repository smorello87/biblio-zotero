#!/usr/bin/env python3
"""Investigate the entry count discrepancy between the two methods."""

from proposed_fixes import split_entries_v2, fetch_entries_from_html
from omeka_bib_to_zotero import fetch_page_text

url = "https://italianamericanimprints.omeka.net/actual-bibliography"

print("Investigating entry count discrepancy...")
print("=" * 80)

# Get entries from both methods
raw_text = fetch_page_text(url)
entries_text = split_entries_v2(raw_text)
entries_html = fetch_entries_from_html(url)

print(f"Method 1 (text splitting): {len(entries_text)} entries")
print(f"Method 2 (HTML parsing):   {len(entries_html)} entries")
print(f"Difference:               {len(entries_html) - len(entries_text)} entries")

# Find entries in HTML but not in text method
print("\n" + "=" * 80)
print("Entries in HTML but missing from text method:")
print("-" * 80)

# Create sets of first 60 chars for comparison
text_set = set(e[:60] for e in entries_text)
html_set = set(e[:60] for e in entries_html)

missing_in_text = html_set - text_set
print(f"\nFound {len(missing_in_text)} unique entry prefixes in HTML not in text method")

# Find the full entries
missing_entries = []
for entry in entries_html:
    if entry[:60] in missing_in_text:
        missing_entries.append(entry)

print("\nMissing entries:")
for i, entry in enumerate(missing_entries[:20], 1):
    print(f"\n[{i}] {entry[:150]}...")

# Check entries around "Agatodemon" specifically
print("\n" + "=" * 80)
print("Checking around entry 8 (Agatodemon issue):")
print("-" * 80)

# Find Agatodemon in both
agatodemon_text = [i for i, e in enumerate(entries_text) if 'Agatodemon' in e]
agatodemon_html = [i for i, e in enumerate(entries_html) if 'Agatodemon' in e]

print(f"\nAgatodemon in text method: {agatodemon_text}")
print(f"Agatodemon in HTML method: {agatodemon_html}")

if agatodemon_html:
    idx = agatodemon_html[0]
    print(f"\nContext in HTML method (entries {idx-2} to {idx+2}):")
    for i in range(max(0, idx-2), min(len(entries_html), idx+3)):
        print(f"  [{i}] {entries_html[i][:100]}...")

if agatodemon_text:
    idx = agatodemon_text[0]
    print(f"\nContext in text method (entries {idx-2} to {idx+2}):")
    for i in range(max(0, idx-2), min(len(entries_text), idx+3)):
        print(f"  [{i}] {entries_text[i][:100]}...")
else:
    print("\n❌ Agatodemon NOT FOUND in text method!")
    print("\nChecking raw text for 'Agatodemon':")
    if 'Agatodemon' in raw_text:
        # Find position
        pos = raw_text.find('Agatodemon')
        print(f"  Found at position {pos}")
        print(f"  Context: ...{raw_text[max(0, pos-100):pos+200]}...")
    else:
        print("  Not in raw text either!")

# Check the raw HTML around Agatodemon
print("\n" + "=" * 80)
print("Raw text analysis around Adams/Agatodemon boundary:")
print("-" * 80)

adams_pos = raw_text.find('Adams, Joseph H.')
if adams_pos != -1:
    print(f"\nFound 'Adams, Joseph H.' at position {adams_pos}")
    snippet = raw_text[adams_pos:adams_pos+600]
    print("\nRaw text (next 600 chars):")
    print(repr(snippet))

# Check if Agatodemon might be getting merged with Adams
print("\n" + "=" * 80)
print("Searching for merged entries:")
print("-" * 80)

for i, entry in enumerate(entries_text):
    if 'Adams' in entry and 'Agatodemon' in entry:
        print(f"\n❌ FOUND MERGED ENTRY at position {i}:")
        print(f"  {entry}")
        break
    if 'Adams' in entry:
        print(f"\nAdams entry in text method [{i}]:")
        print(f"  {entry[:200]}...")
        if i+1 < len(entries_text):
            print(f"\nNext entry [{i+1}]:")
            print(f"  {entries_text[i+1][:200]}...")
        break
