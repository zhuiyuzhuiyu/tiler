package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/paulmach/orb/maptile"
	log "github.com/sirupsen/logrus"
	"github.com/spf13/viper"
)

var transparentPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
	0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f,
	0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00,
	0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

type TaskManager struct {
	mu    sync.RWMutex
	tasks map[string]*Task
	store *TaskStore
}

func NewTaskManager(store *TaskStore) *TaskManager {
	return &TaskManager{
		tasks: make(map[string]*Task),
		store: store,
	}
}

func (m *TaskManager) Create(req CreateTaskRequest) (*Task, error) {
	task, err := NewTaskFromRequest(req)
	if err != nil {
		return nil, err
	}

	m.attach(task)

	if err := m.persist(task); err != nil {
		m.mu.Lock()
		delete(m.tasks, task.ID)
		m.mu.Unlock()
		return nil, err
	}

	go func() {
		if err := task.Run(); err != nil {
			log.Errorf("task %s run error ~ %s", task.ID, err)
		}
	}()

	return task, nil
}

func (m *TaskManager) Restore() error {
	if m.store == nil {
		return nil
	}

	tasks, err := m.store.LoadTasks()
	if err != nil {
		return err
	}

	for _, task := range tasks {
		m.attach(task)
		if err := m.persist(task); err != nil {
			return err
		}
	}
	return nil
}

func (m *TaskManager) Get(id string) (*Task, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	task, ok := m.tasks[id]
	return task, ok
}

func (m *TaskManager) List() []TaskSnapshot {
	m.mu.RLock()
	tasks := make([]*Task, 0, len(m.tasks))
	for _, task := range m.tasks {
		tasks = append(tasks, task)
	}
	m.mu.RUnlock()

	sort.Slice(tasks, func(i, j int) bool {
		return tasks[i].CreatedAt().After(tasks[j].CreatedAt())
	})

	result := make([]TaskSnapshot, 0, len(tasks))
	for _, task := range tasks {
		result = append(result, task.Snapshot())
	}
	return result
}

func (m *TaskManager) Delete(id string, purge bool) error {
	m.mu.RLock()
	task, ok := m.tasks[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("task %s not found", id)
	}

	task.Cancel()
	<-task.Done()

	if purge {
		if err := task.DeleteOutput(); err != nil {
			return err
		}
	}

	m.mu.Lock()
	delete(m.tasks, id)
	m.mu.Unlock()

	if m.store != nil {
		if err := m.store.Delete(id); err != nil {
			return err
		}
	}
	return nil
}

func (m *TaskManager) attach(task *Task) {
	task.SetOnChange(func() {
		if err := m.persist(task); err != nil {
			log.Errorf("persist task %s error ~ %s", task.ID, err)
		}
	})

	m.mu.Lock()
	m.tasks[task.ID] = task
	m.mu.Unlock()
}

func (m *TaskManager) persist(task *Task) error {
	if m.store == nil {
		return nil
	}
	return m.store.Upsert(task)
}

type APIServer struct {
	manager *TaskManager
}

func startServer(addr string) error {
	store, err := OpenTaskStore(viper.GetString("task.database"))
	if err != nil {
		return err
	}
	defer func() {
		if err := store.Close(); err != nil {
			log.Warnf("close task store error ~ %s", err)
		}
	}()

	server := &APIServer{
		manager: NewTaskManager(store),
	}
	if err := server.manager.Restore(); err != nil {
		return err
	}

	mux := http.NewServeMux()
	server.routes(mux)

	url := addr
	if strings.HasPrefix(url, ":") {
		url = "127.0.0.1" + url
	} else if strings.HasPrefix(url, "0.0.0.0:") {
		url = "127.0.0.1:" + strings.TrimPrefix(url, "0.0.0.0:")
	}

	log.Infof("web console listening on http://%s", url)
	return http.ListenAndServe(addr, mux)
}

func (s *APIServer) routes(mux *http.ServeMux) {
	mux.HandleFunc("/api/bootstrap", s.handleBootstrap)
	mux.HandleFunc("/api/geojson", s.handleGeoJSON)
	mux.HandleFunc("/api/tasks", s.handleTasks)
	mux.HandleFunc("/api/tasks/", s.handleTask)
	mux.Handle("/", s.frontendHandler())
}

func (s *APIServer) frontendHandler() http.Handler {
	distDir := filepath.Join("frontend", "dist")
	indexFile := filepath.Join(distDir, "index.html")

	if _, err := os.Stat(indexFile); err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/" {
				http.NotFound(w, r)
				return
			}

			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_, _ = w.Write([]byte("frontend build not found. Run `npm install` and `npm run dev` in ./frontend, or `npm run build` to let Go serve the static bundle."))
		})
	}

	fileServer := http.FileServer(http.Dir(distDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}

		target := filepath.Join(distDir, filepath.FromSlash(strings.TrimPrefix(pathOrIndex(r.URL.Path), "/")))
		if info, err := os.Stat(target); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}

		http.ServeFile(w, r, indexFile)
	})
}

func (s *APIServer) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	resp, err := loadBootstrap()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *APIServer) handleGeoJSON(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	targetPath := r.URL.Query().Get("path")
	absPath, err := resolveGeoJSONPath(targetPath)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}

	w.Header().Set("Content-Type", "application/geo+json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

func (s *APIServer) handleTasks(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.manager.List())
	case http.MethodPost:
		var req CreateTaskRequest
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
			return
		}

		task, err := s.manager.Create(req)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, err)
			return
		}

		writeJSON(w, http.StatusCreated, task.Snapshot())
	default:
		writeMethodNotAllowed(w)
	}
}

func (s *APIServer) handleTask(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/tasks/"), "/")
	if trimmed == "" {
		http.NotFound(w, r)
		return
	}

	parts := strings.Split(trimmed, "/")

	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			task, ok := s.manager.Get(parts[0])
			if !ok {
				writeJSONError(w, http.StatusNotFound, fmt.Errorf("task %s not found", parts[0]))
				return
			}
			writeJSON(w, http.StatusOK, task.Snapshot())
		case http.MethodDelete:
			purge := r.URL.Query().Get("purge") != "false"
			if err := s.manager.Delete(parts[0], purge); err != nil {
				writeJSONError(w, http.StatusBadRequest, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
		default:
			writeMethodNotAllowed(w)
		}
		return
	}

	task, ok := s.manager.Get(parts[0])
	if !ok {
		writeJSONError(w, http.StatusNotFound, fmt.Errorf("task %s not found", parts[0]))
		return
	}

	switch parts[1] {
	case "pause":
		s.handleTaskControl(w, r, task, task.Pause)
	case "resume":
		s.handleTaskControl(w, r, task, task.Resume)
	case "cancel":
		s.handleTaskControl(w, r, task, task.Cancel)
	case "geojson":
		s.handleTaskGeoJSON(w, r, task)
	case "tree":
		s.handleTaskTileTree(w, r, task)
	case "tiles":
		s.handleTaskTile(w, r, task, parts[2:])
	case "source":
		s.handleSourceTile(w, r, task, parts[2:])
	default:
		http.NotFound(w, r)
	}
}

func (s *APIServer) handleTaskControl(w http.ResponseWriter, r *http.Request, task *Task, action func() bool) {
	if r.Method != http.MethodPost {
		writeMethodNotAllowed(w)
		return
	}

	if !action() {
		writeJSONError(w, http.StatusConflict, fmt.Errorf("task state does not allow this action"))
		return
	}

	writeJSON(w, http.StatusOK, task.Snapshot())
}

func (s *APIServer) handleTaskGeoJSON(w http.ResponseWriter, r *http.Request, task *Task) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	data := task.PreviewGeoJSONData()
	if len(data) == 0 {
		w.Header().Set("Content-Type", "application/geo+json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(`{"type":"FeatureCollection","features":[]}`))
		return
	}

	w.Header().Set("Content-Type", "application/geo+json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

func (s *APIServer) handleTaskTileTree(w http.ResponseWriter, r *http.Request, task *Task) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	nodes, err := task.TileTree(r.URL.Query().Get("node"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}

	writeJSON(w, http.StatusOK, nodes)
}

func (s *APIServer) handleTaskTile(w http.ResponseWriter, r *http.Request, task *Task, tileParts []string) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	z, x, y, ok := parseTileParts(tileParts)
	if !ok {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("invalid tile path"))
		return
	}

	data, contentType, encoding, err := task.LoadTile(z, x, y)
	if err != nil {
		if errorsIsNotFound(err) {
			writeTransparentTile(w)
			return
		}
		writeTransparentTile(w)
		return
	}

	writeTileBytes(w, data, firstNonEmpty(contentType, "image/png"), encoding)
}

func (s *APIServer) handleSourceTile(w http.ResponseWriter, r *http.Request, task *Task, tileParts []string) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}

	z, x, y, ok := parseTileParts(tileParts)
	if !ok {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("invalid tile path"))
		return
	}

	sourceURL := task.SourceURLForZoom(z)
	if sourceURL == "" {
		writeTransparentTile(w)
		return
	}

	tile := maptile.Tile{X: uint32(x), Y: uint32(y), Z: maptile.Zoom(z)}
	data, contentType, err := fetchTileContent(r.Context(), tile, sourceURL)
	if err != nil {
		writeTransparentTile(w)
		return
	}

	writeTileBytes(w, data, firstNonEmpty(contentType, "image/png"), "")
}

func parseTileParts(parts []string) (int, int, int, bool) {
	if len(parts) != 3 {
		return 0, 0, 0, false
	}

	z, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, 0, false
	}
	x, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, 0, false
	}
	y, err := strconv.Atoi(parts[2])
	if err != nil {
		return 0, 0, 0, false
	}

	return z, x, y, true
}

func writeTileBytes(w http.ResponseWriter, data []byte, contentType, encoding string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", contentType)
	if encoding != "" {
		w.Header().Set("Content-Encoding", encoding)
	}
	_, _ = w.Write(data)
}

func writeTransparentTile(w http.ResponseWriter) {
	writeTileBytes(w, transparentPNG, "image/png", "")
}

func writeJSON(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(data)
}

func writeJSONError(w http.ResponseWriter, statusCode int, err error) {
	writeJSON(w, statusCode, map[string]string{
		"error": err.Error(),
	})
}

func writeMethodNotAllowed(w http.ResponseWriter) {
	writeJSONError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
}

func pathOrIndex(path string) string {
	if path == "" || path == "/" {
		return "/index.html"
	}
	return path
}

func errorsIsNotFound(err error) bool {
	return os.IsNotExist(err) || err == sql.ErrNoRows
}
