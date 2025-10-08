# Examples

This folder contains example input files for testing the script.

## Files

- **test_bibliography.txt** - Sample bibliography file with proper formatting

## File Format

Bibliography entries should be separated by **triple newlines** (two blank lines):

```
Entry 1 text here.


Entry 2 text here.


Entry 3 text here.
```

## Usage

Test the script with the example file:

```bash
python omeka_bib_to_zotero.py --file examples/test_bibliography.txt --out output.json
```

## Creating Your Own

To create your own bibliography file:

1. Save entries in a .txt or .docx file
2. Separate each entry with two blank lines
3. Ensure proper citation formatting
4. Run the script with `--file` argument

See the main [README.md](../README.md) for more information.
