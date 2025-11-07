# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Comic Reader** - A modern Electron-based desktop comic/manga reader application with a React frontend. Features a minimalist iPhone-style design with support for library management, reading interface, search/filter, and settings.

## Tech Stack

- **Framework**: Electron 28+ (Chrome 120 + Node.js 20)
- **Frontend**: React 18 + TypeScript 5
- **Build Tool**: Vite 5
- **Styling**: Tailwind CSS 3
- **State Management**: Zustand
- **Code Quality**: ESLint + Prettier
- **Package Manager**: npm

## Project Structure

```
comic-reader/
├── src/
│   ├── main/              # Electron main process
│   │   ├── main.ts        # Main process entry, window management, IPC
│   │   └── preload.ts     # Preload script (contextBridge API)
│   │
│   ├── renderer/          # React frontend (rendered in Electron window)
│   │   ├── App.tsx        # Main app component, view routing
│   │   ├── main.tsx       # React entry point
│   │   ├── components/    # React components
│   │   │   ├── layout/    # TopBar, Sidebar
│   │   │   ├── MainInterface/  # ComicGrid, SearchBar
│   │   │   ├── ReadingInterface/  # Reader components
│   │   │   ├── SearchInterface/   # Filter and results
│   │   │   └── SettingsInterface/ # Settings panels
│   │   ├── services/      # Business logic
│   │   │   ├── database.ts    # JSON data manager
│   │   │   └── file-scanner.ts # File scanning utilities
│   │   ├── store/         # Zustand state management
│   │   │   └── slices/
│   │   │       └── comicStore.ts # Main app state
│   │   └── styles/        # Global styles
│   │
│   ├── shared/            # Shared types and interfaces
│   │   ├── interfaces/    # TypeScript interfaces
│   │   ├── constants/     # App constants
│   │   └── enums/         # TypeScript enums
│   │
│   └── types/             # Additional type definitions
│
├── html/                  # Design reference prototypes
│   ├── demo.html          # Basic prototype
│   ├── demo-minimal.html  # Minimalist design reference
│   └── demo-dark.html     # Dark theme reference
│
├── public/                # Static assets
├── dist/                  # Build output
├── index.html             # Main HTML entry
├── vite.config.ts         # Vite configuration
├── tailwind.config.js     # Tailwind CSS config
├── tsconfig.json          # TypeScript config
└── package.json           # Dependencies and scripts
```

## Architecture

### Process Model
- **Main Process** (`src/main/`): Electron window management, file system access, native dialogs, system integration
- **Renderer Process** (`src/renderer/`): React UI, all frontend logic
- **Preload Script** (`src/main/preload.ts`): Secure bridge exposing APIs to renderer via `contextBridge`

### Data Flow
1. **Main Process** handles file I/O via IPC (`read-data-file`, `write-data-file`, `get-app-path`)
2. **Renderer Process** uses Zustand store (`useComicStore`) for state management
3. **Services** (`database.ts`, `file-scanner.ts`) provide business logic
4. **JSON files** store application data (collections, chapters, progress, favorites, history)

### State Management (Zustand)
The main store is in `src/renderer/store/slices/comicStore.ts`:

```typescript
interface ComicState {
  // Data
  collections: Collection[]
  chapters: Chapter[]
  readingProgress: Map<string, ReadingProgress>
  favorites: Set<string>

  // UI State
  currentView: ViewMode  // 'grid' | 'list'
  sortBy: SortOption     // 'relevance' | 'latest' | 'rating' | 'pageCount'
  searchKeyword: string
  filter: FilterCriteria

  // Methods
  loadData: () => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  saveProgress: (collectionId: string, chapterIndex: number, page: number) => Promise<void>
  getFilteredCollections: () => Collection[]
}
```

### Data Models (TypeScript Interfaces)
Located in `src/shared/interfaces/index.ts`:

- **Collection**: Comic series metadata (id, name, author, tags, rating, coverPath)
- **Chapter**: Individual chapter (id, collectionId, index, title, pages, totalPages)
- **ReadingProgress**: Track reading position (collectionId, chapterIndex, currentPage)
- **ComicData**: Root data structure (collections, chapters, progress, history, favorites)
- **AppSettings**: User preferences (reading, display, shortcuts, storage settings)

## Common Commands

```bash
# Install dependencies
npm install

# Start development mode (runs both Electron and Vite with hot reload)
npm run dev

# Start only the renderer process (Vite dev server)
npm run dev:renderer

# Start only the main process (Electron)
npm run dev:main

# Build production bundle
npm run build

# Package the application (creates distributable)
npm run pack

# Create installer/package
npm run dist

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code with Prettier
npm run format

# Type check
npm run type-check
```

## Development Workflow

### Starting Development
1. Run `npm install` to install dependencies
2. Run `npm run dev` to start the development server
3. The app will open automatically with hot reload support

### Key Development Patterns

#### IPC Communication (Main ↔ Renderer)
Main process exposes methods via `contextBridge` in `preload.ts`:
```typescript
contextBridge.exposeInMainWorld('api', {
  readDataFile: (filePath: string) => ipcRenderer.invoke('read-data-file', filePath),
  writeDataFile: (filePath: string, data: any) => ipcRenderer.invoke('write-data-file', filePath, data),
  getPath: (name: string) => ipcRenderer.invoke('get-app-path', name),
})
```

Main process handles IPC in `main.ts`:
```typescript
ipcMain.handle('read-data-file', async (_event, filePath: string) => {
  const data = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(data)
})
```

#### State Management (Zustand)
Access store in components:
```typescript
const { collections, loadData, toggleFavorite } = useComicStore()
```

Update state and persist:
```typescript
const toggleFavorite = async (collectionId: string) => {
  set((state) => {
    const newFavorites = new Set(state.favorites)
    if (newFavorites.has(collectionId)) {
      newFavorites.delete(collectionId)
    } else {
      newFavorites.add(collectionId)
    }
    return { favorites: newFavorites }
  })
  await dataManager.saveFavorites(get().favorites)
}
```

#### Data Persistence
The `database.ts` service manages JSON file operations:
```typescript
class DataManager {
  async loadData(): Promise<ApiResponse<ComicData>>
  async saveData(data: ComicData): Promise<void>
  async saveProgress(progress: ReadingProgress): Promise<void>
  async getProgress(collectionId: string): Promise<ReadingProgress | null>
}
```

### File Scanning
The `file-scanner.ts` service handles directory scanning and collection detection:
```typescript
class FileScanner {
  async scanDirectory(rootPath: string): Promise<ScanResult>
  detectCollections(directories: Directory[]): Collection[]
  generateThumbnails(comic: Comic): Promise<void>
}
```

Supports common naming patterns:
- `/第(\d+)话/` (Chapter pattern)
- `/Vol\.(\d+)/` (Volume pattern)
- `/第(\d+)卷/` (Volume pattern - Chinese)
- `/Chapter\s+(\d+)/i` (English chapter pattern)

## UI Components

### Component Organization
```
src/renderer/components/
├── layout/           # Global layout components
│   ├── TopBar/       # App title bar with actions
│   └── Sidebar/      # Navigation sidebar
│
├── MainInterface/    # Main library view
│   ├── SearchBar/    # Search input and filters
│   └── ComicGrid/    # Grid of comic cards
│
├── ReadingInterface/ # Reading experience
│   └── ReaderInterface  # Full reader view
│
├── SearchInterface/  # Search results
│   └── SearchInterface  # Filter panel + results
│
├── SettingsInterface/ # App settings
│   └── SettingsInterface  # Settings panels
│
└── ui/               # Reusable UI components
```

### Design System
Colors (defined in Tailwind config):
- **Primary**: `#4A90E2` (minimalist blue)
- **Background**: `#F8F9FA` (light gray)
- **Border**: `#E9ECEF` (subtle gray)
- **Text**: `#2C3E50` (dark gray)
- **Muted**: `#6C757D` (secondary text)

Typography:
- Font Family: `Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`
- Border Radius: `8px` standard
- Spacing: Tailwind scale (4px, 8px, 12px, 16px, 20px, 24px, 32px, etc.)

## Configuration Files

### Vite Config (`vite.config.ts`)
- Base path: `./` (for Electron packaging)
- Build output: `dist/renderer`
- Dev server: `http://localhost:8888`
- Aliases: `@` → `src/renderer`, `@shared` → `src/shared`

### TypeScript Config (`tsconfig.json`)
- Target: `ES2020`
- Module: `ESNext`
- Strict mode enabled
- Path mapping for clean imports

### Tailwind Config (`tailwind.config.js`)
- Custom color palette (minimalist theme)
- Extended spacing/sizing scale
- Custom border radius values

## Building and Packaging

### Development Build
```bash
npm run build  # Creates optimized bundle in dist/
```

### Production Distribution
```bash
npm run dist   # Creates installers/packages
```
Output formats (configured in `package.json`):
- AppImage (Linux)
- DEB/RPM (Linux distributions)
-可能有其他平台支持

## Code Style and Conventions

### Naming Conventions
- **Components**: PascalCase (e.g., `ComicGrid.tsx`)
- **Files**: kebab-case (e.g., `file-scanner.ts`)
- **Functions**: camelCase
- **Constants**: UPPER_SNAKE_CASE
- **Interfaces**: PascalCase (e.g., `Collection`, `Chapter`)
- **Type Aliases**: PascalCase

### Type Safety
- All code must be TypeScript with strict mode enabled
- No `any` types without explicit `as any` or `@ts-ignore`
- Use interfaces from `@shared/interfaces` for all data models
- Prefer `type` over `interface` for unions and primitives

### ESLint Rules
- @typescript-eslint/recommended
- React hooks rules enforced
- No unused variables/imports
- Consistent naming conventions

## Testing

Currently **no test framework configured**. Future additions should use:
- **Unit**: Jest + Testing Library
- **E2E**: Playwright
- Run tests: `npm test`
- Coverage: `npm run test:coverage`

## Git Workflow

### Branching Strategy
- **main**: Stable production branch
- **web**: Active development branch (current)
- **feature/***: Feature branches
- **fix/***: Bug fix branches

### Commit Messages (Conventional Commits)
```bash
feat: add file scanner service
fix: resolve image loading issue
refactor: simplify store structure
style: update component spacing
docs: add component documentation
perf: optimize image lazy loading
test: add comic grid tests
build: update electron version
```

## Performance Considerations

- **Image Loading**: Implement lazy loading and caching
- **Virtual Scrolling**: Use for large comic lists (>100 items)
- **Thumbnails**: Cache generated thumbnails to disk
- **Memory Management**: Clear image cache when switching collections
- **Bundle Size**: Code split by route, tree shake unused code

## Known Issues and Limitations

- No test coverage (see Testing section)
- Dark theme partially implemented (see `html/demo-dark.html` for reference)
- File scanner currently returns mock data
- No automatic updates configured
- Linux-only builds currently (can extend to Windows/macOS)

## Reference Materials

### Design Prototypes
The `html/` directory contains reference implementations:
- **demo-minimal.html**: Primary design reference (100% pixel-perfect target)
- **demo-dark.html**: Dark theme reference
- **demo.html**: Basic implementation

These should be used as visual references when implementing or debugging UI components.

### Documentation
- **DEVELOPMENT_PLAN.md**: Comprehensive development roadmap and architecture decisions
- **package.json**: Dependencies and scripts
- **tailwind.config.js**: Design system configuration

## Best Practices

1. **Always use TypeScript strict mode**
2. **Keep business logic in services**, not components
3. **Use Zustand for state**, avoid prop drilling
4. **IPC calls are async**, always `await`
5. **Handle errors gracefully** with try/catch and user feedback
6. **No synchronous file I/O** in renderer process
7. **Use Tailwind classes** for styling, avoid inline styles
8. **Follow the existing component structure** for new features
9. **Keep interfaces in `@shared/interfaces`** for type sharing
10. **Test on Linux** (target platform)

## Debugging

### Development Mode
- Hot reload: Changes to renderer code auto-refresh
- DevTools: Automatically opens with `npm run dev`
- Main process debugging: Use Electron DevTools or VSCode debugger

### Common Issues
1. **Type errors**: Run `npm run type-check`
2. **Build failures**: Check `dist/` and `node_modules/`
3. **IPC not working**: Verify `preload.ts` exposes APIs
4. **Styles not applying**: Check Tailwind config and build output
5. **Data not persisting**: Verify `database.ts` file operations

---

**Note**: This is the **web branch** (Electron implementation). The main Python/Tkinter implementation is in the `main` branch.
