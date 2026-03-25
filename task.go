package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/paulmach/orb"
	"github.com/paulmach/orb/maptile"
	"github.com/paulmach/orb/maptile/tilecover"
	log "github.com/sirupsen/logrus"
	"github.com/spf13/viper"
	"github.com/teris-io/shortid"
)

const MBTileVersion = "1.2"

const (
	TaskStateQueued    = "queued"
	TaskStateRunning   = "running"
	TaskStatePaused    = "paused"
	TaskStateCompleted = "completed"
	TaskStateCanceled  = "canceled"
	TaskStateFailed    = "failed"
)

var errTaskCanceled = errors.New("task canceled")

type Task struct {
	ID          string
	Name        string
	Description string
	File        string
	Min         int
	Max         int
	Layers      []Layer
	LayerSpecs  []LayerConfig
	TileMap     TileMap
	Total       int64
	Current     int64
	Success     int64
	Failed      int64
	PreviewJSON []byte

	db           *sql.DB
	workerCount  int
	savePipeSize int
	timeDelay    int
	retryCount   int
	retryDelay   int
	workers      chan maptile.Tile
	savingpipe   chan Tile
	tileWG       sync.WaitGroup
	saveWG       sync.WaitGroup
	outformat    string
	ctx          context.Context
	cancel       context.CancelFunc
	done         chan struct{}
	doneOnce     sync.Once

	mu         sync.RWMutex
	cond       *sync.Cond
	onChange   func()
	state      string
	lastError  string
	createdAt  time.Time
	startedAt  *time.Time
	finishedAt *time.Time
}

type TaskSnapshot struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Description string        `json:"description,omitempty"`
	Status      string        `json:"status"`
	File        string        `json:"file,omitempty"`
	Output      string        `json:"outputFormat"`
	Total       int64         `json:"total"`
	Current     int64         `json:"current"`
	Success     int64         `json:"success"`
	Failed      int64         `json:"failed"`
	Progress    float64       `json:"progress"`
	Min         int           `json:"min"`
	Max         int           `json:"max"`
	Bounds      [4]float64    `json:"bounds"`
	Center      [2]float64    `json:"center"`
	TileMap     TileMapConfig `json:"tileMap"`
	Layers      []LayerConfig `json:"layers"`
	Previewable bool          `json:"previewable"`
	CanPause    bool          `json:"canPause"`
	CanResume   bool          `json:"canResume"`
	CanCancel   bool          `json:"canCancel"`
	Error       string        `json:"error,omitempty"`
	CreatedAt   time.Time     `json:"createdAt"`
	StartedAt   *time.Time    `json:"startedAt,omitempty"`
	FinishedAt  *time.Time    `json:"finishedAt,omitempty"`
}

func NewTask(layers []Layer, m TileMap) *Task {
	if len(layers) == 0 {
		return nil
	}

	id, _ := shortid.Generate()
	ctx, cancel := context.WithCancel(context.Background())

	task := &Task{
		ID:           id,
		Name:         m.Name,
		Description:  m.Description,
		Layers:       layers,
		Min:          m.Min,
		Max:          m.Max,
		TileMap:      m,
		workerCount:  viper.GetInt("task.workers"),
		savePipeSize: viper.GetInt("task.savepipe"),
		timeDelay:    viper.GetInt("task.timedelay"),
		retryCount:   maxInt(viper.GetInt("task.retrycount"), 0),
		retryDelay:   maxInt(viper.GetInt("task.retrydelay"), 0),
		outformat:    normalizeOutputFormat(viper.GetString("output.format")),
		createdAt:    time.Now(),
		state:        TaskStateQueued,
		ctx:          ctx,
		cancel:       cancel,
		done:         make(chan struct{}),
	}
	task.cond = sync.NewCond(&task.mu)
	task.workers = make(chan maptile.Tile, task.workerCount)
	task.savingpipe = make(chan Tile, maxInt(task.savePipeSize, 1))

	for i := range task.Layers {
		tiles := tilecover.Collection(task.Layers[i].Collection, maptile.Zoom(task.Layers[i].Zoom))
		task.Layers[i].Count = int64(len(tiles))
		task.Total += task.Layers[i].Count
		log.Printf("zoom: %d, tiles: %d", task.Layers[i].Zoom, task.Layers[i].Count)
	}

	task.ensureOutputPath()
	return task
}

func (task *Task) ensureOutputPath() {
	if task.File != "" {
		return
	}

	outdir := viper.GetString("output.directory")
	base := fmt.Sprintf("%s-z%d-%d.%s", sanitizeFileName(task.Name), task.Min, task.Max, task.ID)
	if task.outformat == "mbtiles" {
		task.File = filepath.Join(outdir, base+".mbtiles")
	} else {
		task.File = filepath.Join(outdir, base)
	}

	if abs, err := filepath.Abs(task.File); err == nil {
		task.File = abs
	}
}

func (task *Task) SetOutputFormat(format string) {
	task.outformat = normalizeOutputFormat(format)
	task.File = ""
	task.ensureOutputPath()
}

func (task *Task) Request() CreateTaskRequest {
	return CreateTaskRequest{
		Name:         task.Name,
		Description:  task.Description,
		OutputFormat: task.OutputFormat(),
		TileMap: TileMapConfig{
			Name:        task.TileMap.Name,
			Description: task.TileMap.Description,
			Schema:      task.TileMap.Schema,
			Format:      task.TileMap.Format,
			JSON:        task.TileMap.JSON,
			URL:         task.TileMap.URL,
		},
		Layers: append([]LayerConfig(nil), task.LayerSpecs...),
	}
}

func (task *Task) Status() string {
	task.mu.RLock()
	defer task.mu.RUnlock()
	return task.state
}

func (task *Task) ErrorMessage() string {
	task.mu.RLock()
	defer task.mu.RUnlock()
	return task.lastError
}

func (task *Task) CreatedAt() time.Time {
	task.mu.RLock()
	defer task.mu.RUnlock()
	return task.createdAt
}

func (task *Task) OutputFormat() string {
	task.mu.RLock()
	defer task.mu.RUnlock()
	return task.outformat
}

func (task *Task) SetOnChange(fn func()) {
	task.mu.Lock()
	defer task.mu.Unlock()
	task.onChange = fn
}

func (task *Task) notifyChange() {
	task.mu.RLock()
	fn := task.onChange
	task.mu.RUnlock()
	if fn != nil {
		fn()
	}
}

func (task *Task) Done() <-chan struct{} {
	return task.done
}

func (task *Task) PreviewGeoJSONData() []byte {
	task.mu.RLock()
	defer task.mu.RUnlock()
	return append([]byte(nil), task.PreviewJSON...)
}

func (task *Task) Pause() bool {
	task.mu.Lock()
	if task.state != TaskStateRunning {
		task.mu.Unlock()
		return false
	}
	task.state = TaskStatePaused
	task.mu.Unlock()
	task.notifyChange()
	return true
}

func (task *Task) Resume() bool {
	task.mu.Lock()
	if task.state != TaskStatePaused {
		task.mu.Unlock()
		return false
	}
	task.state = TaskStateRunning
	task.cond.Broadcast()
	task.mu.Unlock()
	task.notifyChange()
	return true
}

func (task *Task) Cancel() bool {
	task.mu.Lock()
	switch task.state {
	case TaskStateCompleted, TaskStateCanceled, TaskStateFailed:
		task.mu.Unlock()
		return false
	default:
		task.state = TaskStateCanceled
		task.cancel()
		task.cond.Broadcast()
		task.mu.Unlock()
		task.notifyChange()
		return true
	}
}

func (task *Task) markStarted() {
	task.mu.Lock()
	now := time.Now()
	task.startedAt = &now
	if task.state == TaskStateQueued {
		task.state = TaskStateRunning
	}
	task.mu.Unlock()
	task.notifyChange()
}

func (task *Task) finish(state string, err error) {
	task.mu.Lock()
	now := time.Now()
	task.finishedAt = &now
	task.state = state
	if err != nil {
		task.lastError = err.Error()
	}
	task.cond.Broadcast()
	task.doneOnce.Do(func() {
		close(task.done)
	})
	task.mu.Unlock()
	task.notifyChange()
}

func (task *Task) addProgress(successDelta, failedDelta int64) {
	current := atomic.AddInt64(&task.Current, successDelta+failedDelta)
	if successDelta != 0 {
		atomic.AddInt64(&task.Success, successDelta)
	}
	if failedDelta != 0 {
		atomic.AddInt64(&task.Failed, failedDelta)
	}

	if current == task.Total || current%25 == 0 || failedDelta != 0 {
		task.notifyChange()
	}
}

func (task *Task) waitUntilRunnable() error {
	task.mu.Lock()
	defer task.mu.Unlock()

	for task.state == TaskStatePaused {
		task.cond.Wait()
	}
	if task.state == TaskStateCanceled {
		return errTaskCanceled
	}
	return nil
}

func (task *Task) Bound() orb.Bound {
	bound := orb.Bound{Min: orb.Point{1, 1}, Max: orb.Point{-1, -1}}
	for _, layer := range task.Layers {
		for _, g := range layer.Collection {
			bound = bound.Union(g.Bound())
		}
	}
	return bound
}

func (task *Task) Center() orb.Point {
	layer := task.Layers[len(task.Layers)-1]
	bound := orb.Bound{Min: orb.Point{1, 1}, Max: orb.Point{-1, -1}}
	for _, g := range layer.Collection {
		bound = bound.Union(g.Bound())
	}
	return bound.Center()
}

func (task *Task) MetaItems() map[string]string {
	b := task.Bound()
	c := task.Center()

	return map[string]string{
		"id":          task.ID,
		"name":        task.Name,
		"description": task.Description,
		"attribution": `<a href="http://www.atlasdata.cn/" target="_blank">&copy; MapCloud</a>`,
		"basename":    task.TileMap.Name,
		"format":      task.TileMap.Format,
		"type":        task.TileMap.Schema,
		"pixel_scale": strconv.Itoa(TileSize),
		"version":     MBTileVersion,
		"bounds":      fmt.Sprintf("%f,%f,%f,%f", b.Left(), b.Bottom(), b.Right(), b.Top()),
		"center":      fmt.Sprintf("%f,%f,%d", c.X(), c.Y(), (task.Min+task.Max)/2),
		"minzoom":     strconv.Itoa(task.Min),
		"maxzoom":     strconv.Itoa(task.Max),
		"json":        task.TileMap.JSON,
	}
}

func (task *Task) SetupMBTileTables() error {
	task.ensureOutputPath()
	os.MkdirAll(filepath.Dir(task.File), os.ModePerm)
	_ = os.Remove(task.File)

	db, err := sql.Open("sqlite3", task.File)
	if err != nil {
		return err
	}
	if err := optimizeConnection(db); err != nil {
		return err
	}

	if _, err := db.Exec("create table if not exists tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);"); err != nil {
		return err
	}
	if _, err := db.Exec("create table if not exists metadata (name text, value text);"); err != nil {
		return err
	}
	if _, err := db.Exec("create unique index name on metadata (name);"); err != nil {
		return err
	}
	if _, err := db.Exec("create unique index tile_index on tiles(zoom_level, tile_column, tile_row);"); err != nil {
		return err
	}

	for name, value := range task.MetaItems() {
		if _, err := db.Exec("insert into metadata (name, value) values (?, ?)", name, value); err != nil {
			return err
		}
	}

	task.db = db
	return nil
}

func (task *Task) savePipe() {
	defer task.saveWG.Done()

	for tile := range task.savingpipe {
		err := saveToMBTile(tile, task.db)
		if err != nil {
			if strings.HasPrefix(err.Error(), "UNIQUE constraint failed") {
				log.Warnf("save %v tile to mbtiles db error ~ %s", tile.T, err)
			} else {
				log.Errorf("save %v tile to mbtiles db error ~ %s", tile.T, err)
			}
			task.addProgress(0, 1)
			continue
		}

		task.addProgress(1, 0)
	}
}

func (task *Task) saveTile(tile Tile) error {
	if err := saveToFiles(tile, task); err != nil {
		task.addProgress(0, 1)
		return err
	}

	task.addProgress(1, 0)
	return nil
}

func prepareTileURL(t maptile.Tile, url string) string {
	maxY := int(math.Pow(2, float64(t.Z))) - 1
	url = strings.ReplaceAll(url, "{x}", strconv.Itoa(int(t.X)))
	url = strings.ReplaceAll(url, "{y}", strconv.Itoa(int(t.Y)))
	url = strings.ReplaceAll(url, "{-y}", strconv.Itoa(maxY-int(t.Y)))
	url = strings.ReplaceAll(url, "{z}", strconv.Itoa(int(t.Z)))
	url = strings.ReplaceAll(url, "{s}", "a")
	return url
}

func fetchTileContent(ctx context.Context, mt maptile.Tile, url string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, prepareTileURL(mt, url), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://map.tianditu.gov.cn")

	client := &http.Client{
		Timeout: 60 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, resp.Header.Get("Content-Type"), fmt.Errorf("status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.Header.Get("Content-Type"), err
	}
	if len(body) == 0 {
		return nil, resp.Header.Get("Content-Type"), fmt.Errorf("empty tile body")
	}

	return body, resp.Header.Get("Content-Type"), nil
}

func (task *Task) fetchTileWithRetry(mt maptile.Tile, url string) ([]byte, string, error) {
	attempts := task.retryCount + 1
	if attempts < 1 {
		attempts = 1
	}

	var lastErr error
	var contentType string

	for attempt := 1; attempt <= attempts; attempt++ {
		body, ct, err := fetchTileContent(task.ctx, mt, url)
		if err == nil {
			return body, ct, nil
		}

		if errors.Is(err, context.Canceled) || errors.Is(task.ctx.Err(), context.Canceled) {
			return nil, ct, err
		}

		lastErr = err
		contentType = ct
		if attempt == attempts {
			break
		}

		log.Warnf(
			"fetch tile(z:%d, x:%d, y:%d) failed on attempt %d/%d, retrying: %s",
			mt.Z, mt.X, mt.Y, attempt, attempts, err,
		)

		if task.retryDelay <= 0 {
			continue
		}

		select {
		case <-time.After(time.Duration(task.retryDelay) * time.Millisecond):
		case <-task.ctx.Done():
			return nil, contentType, task.ctx.Err()
		}
	}

	return nil, contentType, fmt.Errorf("fetch failed after %d attempts: %w", attempts, lastErr)
}

func (task *Task) tileFetcher(mt maptile.Tile, url string) {
	defer task.tileWG.Done()
	defer func() {
		<-task.workers
	}()

	if err := task.waitUntilRunnable(); err != nil {
		return
	}

	body, _, err := task.fetchTileWithRetry(mt, url)
	if err != nil {
		task.addProgress(0, 1)
		log.Errorf("fetch tile(z:%d, x:%d, y:%d) error ~ %s", mt.Z, mt.X, mt.Y, err)
		return
	}

	td := Tile{T: mt, C: body}
	if task.TileMap.Format == PBF {
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		if _, err := zw.Write(body); err != nil {
			task.addProgress(0, 1)
			log.Errorf("gzip tile(z:%d, x:%d, y:%d) error ~ %s", mt.Z, mt.X, mt.Y, err)
			return
		}
		if err := zw.Close(); err != nil {
			task.addProgress(0, 1)
			log.Errorf("close gzip tile(z:%d, x:%d, y:%d) error ~ %s", mt.Z, mt.X, mt.Y, err)
			return
		}
		td.C = buf.Bytes()
	}

	if task.outformat == "mbtiles" {
		select {
		case task.savingpipe <- td:
		case <-task.ctx.Done():
			task.addProgress(0, 1)
		}
		return
	}

	if err := task.saveTile(td); err != nil {
		log.Errorf("create %v tile file error ~ %s", td.T, err)
	}
}

func (task *Task) acquireWorker(tile maptile.Tile) error {
	for {
		if err := task.waitUntilRunnable(); err != nil {
			return err
		}

		select {
		case task.workers <- tile:
			return nil
		case <-task.ctx.Done():
			return errTaskCanceled
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func (task *Task) downloadLayer(layer Layer) error {
	tiles := tilecover.Collection(layer.Collection, maptile.Zoom(layer.Zoom))
	for tile := range tiles {
		if err := task.acquireWorker(tile); err != nil {
			return err
		}

		if task.timeDelay > 0 {
			select {
			case <-time.After(time.Duration(task.timeDelay) * time.Millisecond):
			case <-task.ctx.Done():
				return errTaskCanceled
			}
		}

		task.tileWG.Add(1)
		go task.tileFetcher(tile, layer.URL)
	}

	task.tileWG.Wait()
	return task.waitUntilRunnable()
}

func (task *Task) Run() error {
	task.markStarted()

	if err := task.waitUntilRunnable(); err != nil {
		task.finish(TaskStateCanceled, nil)
		return nil
	}

	if task.outformat == "mbtiles" {
		if err := task.SetupMBTileTables(); err != nil {
			task.finish(TaskStateFailed, err)
			return err
		}
	} else {
		task.ensureOutputPath()
		_ = os.MkdirAll(task.File, os.ModePerm)
	}

	task.saveWG.Add(1)
	go task.savePipe()

	var runErr error
	for _, layer := range task.Layers {
		if err := task.downloadLayer(layer); err != nil {
			runErr = err
			break
		}
	}

	task.tileWG.Wait()
	close(task.savingpipe)
	task.saveWG.Wait()

	if task.db != nil {
		if err := optimizeDatabase(task.db); err != nil {
			log.Warnf("optimize database error ~ %s", err)
		}
	}

	if errors.Is(runErr, errTaskCanceled) || task.Status() == TaskStateCanceled {
		task.finish(TaskStateCanceled, nil)
		return nil
	}
	if runErr != nil {
		task.finish(TaskStateFailed, runErr)
		return runErr
	}

	task.finish(TaskStateCompleted, nil)
	return nil
}

func (task *Task) SourceURLForZoom(z int) string {
	for _, layer := range task.Layers {
		if layer.Zoom == z && layer.URL != "" {
			return layer.URL
		}
	}
	return task.TileMap.URL
}

func tileContentHeaders(format string, data []byte) (string, string) {
	switch strings.ToLower(format) {
	case "jpg", "jpeg":
		return "image/jpeg", ""
	case "png":
		return "image/png", ""
	case "webp":
		return "image/webp", ""
	case "pbf":
		return "application/x-protobuf", "gzip"
	default:
		return http.DetectContentType(data), ""
	}
}

func (task *Task) LoadTile(z, x, y int) ([]byte, string, string, error) {
	switch task.outformat {
	case "mbtiles":
		if task.db == nil {
			if err := task.openMBTilesForRead(); err != nil {
				return nil, "", "", err
			}
		}
		row := task.db.QueryRow("select tile_data from tiles where zoom_level = ? and tile_column = ? and tile_row = ?", z, x, (1<<uint(z))-1-y)
		var data []byte
		if err := row.Scan(&data); err != nil {
			return nil, "", "", err
		}
		contentType, encoding := tileContentHeaders(task.TileMap.Format, data)
		return data, contentType, encoding, nil
	default:
		fileName := filepath.Join(task.File, strconv.Itoa(z), strconv.Itoa(x), fmt.Sprintf("%d.%s", y, task.TileMap.Format))
		data, err := os.ReadFile(fileName)
		if err != nil {
			return nil, "", "", err
		}
		contentType, encoding := tileContentHeaders(task.TileMap.Format, data)
		return data, contentType, encoding, nil
	}
}

func (task *Task) openMBTilesForRead() error {
	task.mu.Lock()
	defer task.mu.Unlock()

	if task.db != nil {
		return nil
	}
	if task.File == "" {
		return sql.ErrNoRows
	}
	if _, err := os.Stat(task.File); err != nil {
		return err
	}

	db, err := sql.Open("sqlite3", task.File)
	if err != nil {
		return err
	}

	task.db = db
	return nil
}

func (task *Task) DeleteOutput() error {
	if task.db != nil {
		if err := task.db.Close(); err != nil {
			return err
		}
		task.db = nil
	}

	if task.File == "" {
		return nil
	}

	switch task.outformat {
	case "mbtiles":
		if err := os.Remove(task.File); err != nil && !os.IsNotExist(err) {
			return err
		}
	default:
		if err := os.RemoveAll(task.File); err != nil && !os.IsNotExist(err) {
			return err
		}
	}

	return nil
}

func (task *Task) Snapshot() TaskSnapshot {
	task.mu.RLock()
	state := task.state
	lastError := task.lastError
	createdAt := task.createdAt
	startedAt := task.startedAt
	finishedAt := task.finishedAt
	task.mu.RUnlock()

	current := atomic.LoadInt64(&task.Current)
	success := atomic.LoadInt64(&task.Success)
	failed := atomic.LoadInt64(&task.Failed)

	progress := 0.0
	if task.Total > 0 {
		progress = math.Min(float64(current)/float64(task.Total)*100, 100)
	}

	bound := task.Bound()
	center := task.Center()

	return TaskSnapshot{
		ID:          task.ID,
		Name:        task.Name,
		Description: task.Description,
		Status:      state,
		File:        task.File,
		Output:      task.outformat,
		Total:       task.Total,
		Current:     current,
		Success:     success,
		Failed:      failed,
		Progress:    progress,
		Min:         task.Min,
		Max:         task.Max,
		Bounds:      [4]float64{bound.Left(), bound.Bottom(), bound.Right(), bound.Top()},
		Center:      [2]float64{center.X(), center.Y()},
		TileMap: TileMapConfig{
			Name:        task.TileMap.Name,
			Description: task.TileMap.Description,
			Schema:      task.TileMap.Schema,
			Format:      task.TileMap.Format,
			JSON:        task.TileMap.JSON,
			URL:         task.TileMap.URL,
		},
		Layers:      append([]LayerConfig(nil), task.LayerSpecs...),
		Previewable: strings.ToLower(task.TileMap.Format) != PBF,
		CanPause:    state == TaskStateRunning,
		CanResume:   state == TaskStatePaused,
		CanCancel:   state == TaskStateQueued || state == TaskStateRunning || state == TaskStatePaused,
		Error:       lastError,
		CreatedAt:   createdAt,
		StartedAt:   startedAt,
		FinishedAt:  finishedAt,
	}
}

func sanitizeFileName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "task"
	}

	replacer := strings.NewReplacer(
		"<", "_",
		">", "_",
		":", "_",
		"\"", "_",
		"/", "_",
		"\\", "_",
		"|", "_",
		"?", "_",
		"*", "_",
	)
	name = replacer.Replace(name)
	name = strings.Trim(name, ". ")
	if name == "" {
		return "task"
	}
	return name
}

func normalizeOutputFormat(format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "mbtiles":
		return "mbtiles"
	default:
		return "file"
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
