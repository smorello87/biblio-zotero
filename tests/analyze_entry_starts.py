#!/usr/bin/env python3
"""Analyze what the entry start patterns actually look like."""

from proposed_fixes import fetch_entries_from_html

url = "https://italianamericanimprints.omeka.net/actual-bibliography"

entries_html = fetch_entries_from_html(url)

print("Analyzing first 60 characters of all entries to identify patterns:")
print("=" * 80)

# Collect unique start patterns
patterns = {}
for entry in entries_html:
    # Get first 40 chars
    start = entry[:40]
    # Extract the "name. year" pattern
    import re
    m = re.match(r'^([^\.]+\.)\s*(\[?\d{4}[a-z]?\]?\.|\[?n\.d\.\]?)', entry)
    if m:
        pattern = m.group(0)
        if pattern not in patterns:
            patterns[pattern] = []
        patterns[pattern].append(entry[:80])

print(f"\nFound {len(patterns)} unique start patterns\n")

# Show sample of each pattern type
pattern_categories = {
    'ditto': [],
    'single_word': [],
    'surname_given': [],
    'acronym': [],
    'other': []
}

for pattern, examples in patterns.items():
    if pattern.startswith('___'):
        pattern_categories['ditto'].append((pattern, examples[0]))
    elif ', ' in pattern:
        pattern_categories['surname_given'].append((pattern, examples[0]))
    elif re.match(r'^[A-Z]{2,}\.', pattern):
        pattern_categories['acronym'].append((pattern, examples[0]))
    elif re.match(r'^[A-Z][a-z]+\.', pattern):
        pattern_categories['single_word'].append((pattern, examples[0]))
    else:
        pattern_categories['other'].append((pattern, examples[0]))

print("Pattern Categories:")
print("-" * 80)

for category, items in pattern_categories.items():
    print(f"\n{category.upper()} ({len(items)} patterns):")
    for pattern, example in sorted(items)[:10]:
        print(f"  {pattern:45} -> {example}")
    if len(items) > 10:
        print(f"  ... and {len(items) - 10} more")

# Look for entries that might NOT be matched by our pattern
print("\n\n" + "=" * 80)
print("Checking if our pattern catches all entries:")
print("-" * 80)

entry_start_pattern = r'^(?:[A-Z][a-zA-Z\'\-]+(?:\s+[A-Z]\.)?,\s+[A-Z]|[A-Z][a-z]+\.\s+\d|______|Anonymous\.|DAB\.|DBI\.|DBIO\.)'

mismatches = []
for i, entry in enumerate(entries_html):
    if not re.match(entry_start_pattern, entry):
        mismatches.append((i, entry[:100]))

print(f"\nEntries NOT matched by pattern: {len(mismatches)}")
if mismatches:
    print("\nSample mismatches:")
    for i, entry in mismatches[:20]:
        print(f"  [{i}] {entry}")
