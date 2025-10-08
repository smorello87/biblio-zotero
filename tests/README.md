# Tests and Analysis Scripts

This folder contains test scripts and analysis tools used during development.

## Files

- **test_scraping.py** - Tests web scraping functionality
- **test_fixes_on_real_data.py** - Validates fixes against real data
- **proposed_fixes.py** - Working implementations of bug fixes
- **detailed_analysis.py** - Detailed analysis of entry processing
- **investigate_discrepancy.py** - Investigates entry count discrepancies
- **analyze_entry_starts.py** - Analyzes patterns in entry beginnings

## Running Tests

These are development/analysis scripts, not automated unit tests. To run:

```bash
python tests/test_scraping.py
python tests/test_fixes_on_real_data.py
```

## For Testing the Main Script

Use the main script with `--max` parameter:

```bash
python omeka_bib_to_zotero.py --max 10 --out test.json
```
