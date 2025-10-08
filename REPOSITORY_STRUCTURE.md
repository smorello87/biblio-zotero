# Repository Structure

This document explains the organization of files in this repository.

## Root Directory

```
biblio-zotero/
├── README.md                    # User-facing documentation
├── CLAUDE.md                    # Development guidance for Claude Code
├── LICENSE                      # Apache 2.0 license
├── omeka_bib_to_zotero.py      # Main script
├── .gitignore                   # Git ignore rules
├── docs/                        # Development documentation
├── examples/                    # Example input files
└── tests/                       # Test and analysis scripts
```

## Directory Contents

### Root Files

- **omeka_bib_to_zotero.py** - The main Python script
- **README.md** - Complete user guide with installation, usage, and examples
- **CLAUDE.md** - Development documentation for AI-assisted coding
- **LICENSE** - Apache 2.0 open source license
- **REPOSITORY_STRUCTURE.md** - This file

### `/docs` - Development Documentation

Documentation created during development and bug fixing:

- Implementation summaries
- Feature guides
- Code change documentation
- Analysis reports
- Bug fix documentation

See [docs/README.md](docs/README.md) for details.

### `/examples` - Example Files

Sample input files for testing:

- `test_bibliography.txt` - Properly formatted example bibliography

See [examples/README.md](examples/README.md) for usage instructions.

### `/tests` - Test Scripts

Development and analysis scripts:

- Scraping tests
- Fix validation scripts
- Analysis tools
- Proposed fix implementations

See [tests/README.md](tests/README.md) for details.

## What's Not Tracked

The following files are ignored by Git (see `.gitignore`):

- **Output files**: `*.json`, `*.ris`, `failed_entries.txt`
- **Test outputs**: `test_*.json`, `test_*.ris`
- **Python bytecode**: `__pycache__/`, `*.pyc`
- **Virtual environments**: `venv/`, `.venv/`
- **IDE files**: `.vscode/`, `.idea/`
- **AI editor files**: `.claude/`, `.cursor/`
- **macOS files**: `.DS_Store`

## For New Contributors

1. **Users**: Start with [README.md](README.md)
2. **Developers**: Read [CLAUDE.md](CLAUDE.md)
3. **Testing**: Use files in [examples/](examples/) and [tests/](tests/)
4. **Understanding changes**: Check [docs/](docs/) for implementation details

## Git Workflow

```bash
# Clone the repository
git clone <repository-url>
cd biblio-zotero

# Install dependencies
pip install requests beautifulsoup4 python-docx

# Test with example file
python omeka_bib_to_zotero.py --file examples/test_bibliography.txt --out test.json

# Run your own conversions
python omeka_bib_to_zotero.py
```

## Clean Repository

To maintain a clean repository:

- Output files (`.json`, `.ris`) are automatically ignored
- Test outputs are ignored
- Development/analysis docs are in `docs/`
- Example files are in `examples/`
- Test scripts are in `tests/`

This keeps the root directory clean and organized for GitHub.
