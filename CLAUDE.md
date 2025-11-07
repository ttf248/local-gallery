# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Comic Reader** - A Python-based comic/manga scanner and viewer application. This is the **web branch** containing HTML prototypes and design mockups. The main application code is in the `main` branch.

### Branch Information

- **web** (current): HTML prototypes, design mockups, and UI demos
- **main**: Active Tkinter/Python application with full functionality
- **pyqt6**: Legacy PyQt6 implementation (deprecated)

## Branch Structure

```
comic-reader/
├── README.md                    # Main project documentation (from main branch)
├── html/                        # Web prototypes and demos
│   ├── demo.html                # Basic prototype
│   ├── demo-minimal.html        # Minimalist design version
│   └── demo-dark.html           # Dark theme version
│
├── .cnb.yml                     # Cloud note configuration
├── .github/workflows/
│   └── build.yml                # CI/CD for main branch
└── .gitignore
```

## Working with This Branch

This branch contains:
- HTML/CSS/JS prototypes for UI/UX design
- Interactive demos for the comic reader interface
- Visual references for the minimalistic design

### Viewing Prototypes

Open HTML files in a browser to view the design prototypes:
```bash
# Option 1: Direct file open
open html/demo.html

# Option 2: Start a local server
cd html
python -m http.server 8000
# Then open http://localhost:8000/demo.html
```

## Main Application Development

**For actual development**, switch to the `main` branch:

```bash
git checkout main
```

### Main Branch Overview

The `main` branch contains the complete Python application with:
- **Framework**: Tkinter + ttkthemes (not PyQt6)
- **Architecture**: 4-layer modular design
- **Testing**: Comprehensive unittest suite
- **Performance**: 1000+ albums/s scanning speed
- **Concurrency**: 8-thread parallel processing

### Key Files in Main Branch

```
comic-reader/
├── main.py                      # Application entry point
├── app_manager.py               # Main controller
├── src/                         # Source code
│   ├── core/                    # Business logic
│   ├── ui/                      # UI components
│   └── utils/                   # Utilities
├── tests/                       # Test suite
├── docs/                        # Documentation
└── requirements.txt             # Dependencies
```

### Common Commands (Main Branch)

```bash
# Run the application
python main.py

# Run tests
cd tests
python test_suite.py

# Build executable
pip install pyinstaller
pyinstaller --onefile --name comic-reader main.py
```

See the main branch's CLAUDE.md for complete development guidance.

## Design Philosophy

The project follows a **minimalist iPhone-style** design:

### Visual System
- **Primary Color**: #4A90E2 (minimalist blue)
- **Background**: #F8F9FA (clean light gray)
- **Border**: #E9ECEF (subtle gray)
- **Text**: #2C3E50 (dark gray)
- **Border Radius**: 8px unified
- **Font**: Inter / PingFang SC / Microsoft YaHei

### UI Components (HTML Prototypes)
1. **Main Library View** - Grid-based comic browsing
2. **Reader View** - Fullscreen immersive reading
3. **Search & Filter** - Multi-dimensional filtering
4. **Settings** - Comprehensive configuration

## Recent Changes

- **2025-11-07**: Web branch created with HTML prototypes
- **2025-11-07**: Main branch has complete test framework
- **2025-11-07**: Performance optimizations (1000+ albums/s)

## Development Notes

### For Web Prototypes
- Pure HTML/CSS/JavaScript
- No build process required
- Can be version controlled independently
- Useful for design iteration and user testing

### For Python Application
- Use main branch
- Requires Python 3.7+
- Dependencies: Pillow, ttkthemes
- Full test coverage
- Production-ready performance

## Cross-Reference

- **Prototypes**: `html/` directory (this branch)
- **Implementation**: `main` branch
- **Documentation**: `main:docs/`
- **Tests**: `main:tests/`

## Recommendation

For active development:
1. Use `main` branch for Python/Tkinter implementation
2. Use this `web` branch only for design prototyping
3. HTML demos can inform Python UI implementation
4. Keep prototypes in sync with implemented features

## Documentation

- **Main README**: `main:README.md` (comprehensive project docs)
- **Architecture**: `main:docs/ARCHITECTURE.md`
- **Shortcuts**: `main:docs/SHORTCUTS.md`
- **Tests**: `main:tests/README.md`

---

**Quick Tip**: For any development task, always check if the code is in the `main` branch first. This `web` branch is primarily for design and prototyping.
