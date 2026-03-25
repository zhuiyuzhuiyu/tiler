# Tiler

> Note: the backend of this project is mainly developed as a derivative of [atlasdatatech/tiler](https://github.com/atlasdatatech/tiler), with additional work for pause/resume controls, Web-based task management, map preview, tile browser support, single-tile retry, and one-click startup scripts. Thanks to the original author for the open-source work.

`Tiler` is a tile downloading and task management tool for imagery and map tile workflows. It supports GeoJSON-based multi-level download ranges and provides a Web console for task creation, progress tracking, map overlay preview, and single-tile inspection.

The project currently supports two usage modes:

- Web console mode: create tasks, pause/resume/cancel them, preview ranges and inspect tiles
- CLI mode: run a default task directly from `conf.toml`

## Features

- Custom tile URL templates
- Different GeoJSON ranges for different zoom levels
- Image tiles and PBF vector tiles
- File directory and MBTiles output formats
- Persistent task state and restore support
- Pause, resume, cancel, and delete task operations
- Overlay map preview
- Tile browser with `Z / X / Y` tree navigation
- Automatic retry for failed single-tile downloads

## Tech Stack

- Backend: Go
- Frontend: React 19 + TypeScript + Vite + Ant Design + Cesium
- Storage: SQLite for task state and MBTiles

## Project Structure

```text
.
├─ frontend/          Web console frontend
├─ geojson/           Example GeoJSON range files
├─ output/            Default output directory
├─ conf.toml          Default configuration
├─ main.go            Application entry
├─ server.go          Web server and API
├─ task.go            Task execution and download logic
└─ tile_browser.go    Tile tree and single-tile browser logic
```

## Requirements

- Go 1.24 or later
- Node.js 18 or later
- npm 9 or later

## Quick Start

### 1. Install frontend dependencies

```bash
cd frontend
npm install
```

### 2. Build the frontend

```bash
cd frontend
npm run build
```

After the build is complete, the Go server will serve `frontend/dist` directly.

### 3. Start the Web console

From the project root:

```bash
go run . -c conf.toml -serve
```

If you want one-click startup on Windows, run:

```powershell
.\start.bat
```

or:

```powershell
.\start.ps1
```

The script will:

- check frontend dependencies
- build the frontend automatically
- start the Go server
- open the browser by default

Default address:

```text
http://127.0.0.1:8080
```

To use a custom address:

```bash
go run . -c conf.toml -serve -addr :9090
```

### 4. Run in CLI mode

```bash
go run . -c conf.toml -serve=false
```

CLI mode reads the default task configuration from `conf.toml` and starts downloading immediately.

## Configuration

The default configuration file is `conf.toml`.

### Output

```toml
[output]
format = "file"        # file or mbtiles
directory = "output"   # output directory
```

### Task

```toml
[task]
workers = 3            # concurrent fetch workers
savepipe = 1           # save pipeline concurrency
timedelay = 50         # request delay in milliseconds
retrycount = 2         # retry count after the first failure
retrydelay = 1000      # retry interval in milliseconds
```

### Default tile source

```toml
[tm]
name = "google satelite"
min = 0
max = 11
format = "jpg"         # jpg / png / webp / pbf
schema = "xyz"         # xyz / tms
url = "https://..."
json = ""
```

### Multi-level download ranges

```toml
[[lrs]]
min = 0
max = 5
geojson = "./geojson/global.geojson"

[[lrs]]
min = 6
max = 8
geojson = "./geojson/china.geojson"
```

This means:

- zoom `0-5` uses `global.geojson`
- zoom `6-8` uses `china.geojson`

This pattern is useful for downloading large areas at low zoom and smaller areas at high zoom.

## Tile URL Templates

Supported placeholders:

- `{z}`: zoom level
- `{x}`: tile column
- `{y}`: tile row
- `{-y}`: inverted TMS row
- `{s}`: subdomain placeholder, currently replaced with `a`

Example:

```text
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

## Web Console

Once the service is running, the console provides:

- Dashboard: overall task statistics and runtime status
- Task Management: task creation, layered rules, lifecycle operations
- Map Preview: task range and overlay preview
- Tile Browser: inspect saved tiles with `Z / X / Y` navigation and single-tile preview

Notes:

- The preview page uses overlay preview by default
- The tile browser shows tiles that have already been written to disk or MBTiles
- Running tasks can also be inspected, but a tile only appears after it has actually been saved

## Output Formats

### File directory

Typical structure:

```text
output/task-name-z0-11.xxxxx/
├─ 0/
├─ 1/
└─ ...
```

### MBTiles

Exports a single `.mbtiles` file, which is convenient for publishing or importing into GIS and tile services.

## Retry Behavior

Single-tile retry is enabled in the current version:

- automatically retries after a failed tile request
- default extra retries: 2
- default retry interval: 1000ms

A tile is counted as failed only after all retry attempts are exhausted.

## Common Development Commands

### Frontend development

```bash
cd frontend
npm run dev
```

### Frontend production build

```bash
cd frontend
npm run build
```

### Backend build

```bash
go build .
```

Note: `go build ./...` may traverse third-party example Go files inside `frontend/node_modules`. For this project, prefer `go build .`.

## Typical Use Cases

- Offline map preparation
- Administrative-area tile capture
- Layered tile cache generation
- MBTiles packaging
- Tile source validation and inspection

## Disclaimer

Make sure your use of any tile source complies with the provider's terms, licensing rules, and access limitations. This project does not grant authorization to use third-party map resources.
