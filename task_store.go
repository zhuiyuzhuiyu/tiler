package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

const interruptedTaskMessage = "服务重启后任务已中断"

type TaskStore struct {
	db *sql.DB
	mu sync.Mutex
}

type taskRecord struct {
	ID           string
	RequestJSON  string
	PreviewJSON  []byte
	FilePath     string
	OutputFormat string
	State        string
	Total        int64
	Current      int64
	Success      int64
	Failed       int64
	LastError    string
	CreatedAt    time.Time
	StartedAt    *time.Time
	FinishedAt   *time.Time
}

func OpenTaskStore(path string) (*TaskStore, error) {
	if path == "" {
		return nil, fmt.Errorf("task database path is empty")
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(absPath), os.ModePerm); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite3", absPath)
	if err != nil {
		return nil, err
	}
	if err := optimizeConnection(db); err != nil {
		_ = db.Close()
		return nil, err
	}

	store := &TaskStore{db: db}
	if err := store.init(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *TaskStore) init() error {
	schema := `
create table if not exists tasks (
	id text primary key,
	request_json text not null,
	preview_json blob,
	file_path text,
	output_format text,
	state text not null,
	total integer not null default 0,
	current integer not null default 0,
	success integer not null default 0,
	failed integer not null default 0,
	last_error text,
	created_at text not null,
	started_at text,
	finished_at text
);
create index if not exists idx_tasks_created_at on tasks(created_at desc);
`
	_, err := s.db.Exec(schema)
	return err
}

func (s *TaskStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *TaskStore) Upsert(task *Task) error {
	if s == nil || s.db == nil || task == nil {
		return nil
	}

	record, err := buildTaskRecord(task)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	_, err = s.db.Exec(`
insert into tasks (
	id, request_json, preview_json, file_path, output_format, state,
	total, current, success, failed, last_error,
	created_at, started_at, finished_at
) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
on conflict(id) do update set
	request_json = excluded.request_json,
	preview_json = excluded.preview_json,
	file_path = excluded.file_path,
	output_format = excluded.output_format,
	state = excluded.state,
	total = excluded.total,
	current = excluded.current,
	success = excluded.success,
	failed = excluded.failed,
	last_error = excluded.last_error,
	created_at = excluded.created_at,
	started_at = excluded.started_at,
	finished_at = excluded.finished_at
`,
		record.ID,
		record.RequestJSON,
		record.PreviewJSON,
		record.FilePath,
		record.OutputFormat,
		record.State,
		record.Total,
		record.Current,
		record.Success,
		record.Failed,
		record.LastError,
		formatNullableTime(&record.CreatedAt),
		formatNullableTime(record.StartedAt),
		formatNullableTime(record.FinishedAt),
	)
	return err
}

func (s *TaskStore) Delete(id string) error {
	if s == nil || s.db == nil {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec("delete from tasks where id = ?", id)
	return err
}

func (s *TaskStore) LoadTasks() ([]*Task, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}

	rows, err := s.db.Query(`
select
	id, request_json, preview_json, file_path, output_format, state,
	total, current, success, failed, last_error,
	created_at, started_at, finished_at
from tasks
order by created_at desc
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tasks := make([]*Task, 0)
	for rows.Next() {
		record, err := scanTaskRecord(rows)
		if err != nil {
			return nil, err
		}

		task, err := restoreTaskFromRecord(record)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func buildTaskRecord(task *Task) (taskRecord, error) {
	reqJSON, err := json.Marshal(task.Request())
	if err != nil {
		return taskRecord{}, err
	}

	snapshot := task.Snapshot()
	return taskRecord{
		ID:           task.ID,
		RequestJSON:  string(reqJSON),
		PreviewJSON:  task.PreviewGeoJSONData(),
		FilePath:     snapshot.File,
		OutputFormat: snapshot.Output,
		State:        snapshot.Status,
		Total:        snapshot.Total,
		Current:      snapshot.Current,
		Success:      snapshot.Success,
		Failed:       snapshot.Failed,
		LastError:    snapshot.Error,
		CreatedAt:    snapshot.CreatedAt,
		StartedAt:    snapshot.StartedAt,
		FinishedAt:   snapshot.FinishedAt,
	}, nil
}

func scanTaskRecord(rows *sql.Rows) (taskRecord, error) {
	var record taskRecord
	var createdAt string
	var startedAt sql.NullString
	var finishedAt sql.NullString

	err := rows.Scan(
		&record.ID,
		&record.RequestJSON,
		&record.PreviewJSON,
		&record.FilePath,
		&record.OutputFormat,
		&record.State,
		&record.Total,
		&record.Current,
		&record.Success,
		&record.Failed,
		&record.LastError,
		&createdAt,
		&startedAt,
		&finishedAt,
	)
	if err != nil {
		return taskRecord{}, err
	}

	record.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return taskRecord{}, err
	}
	record.StartedAt, err = parseNullableTime(startedAt)
	if err != nil {
		return taskRecord{}, err
	}
	record.FinishedAt, err = parseNullableTime(finishedAt)
	if err != nil {
		return taskRecord{}, err
	}
	return record, nil
}

func restoreTaskFromRecord(record taskRecord) (*Task, error) {
	var req CreateTaskRequest
	if err := json.Unmarshal([]byte(record.RequestJSON), &req); err != nil {
		return nil, err
	}

	task, err := NewTaskFromRequest(req)
	if err != nil {
		return nil, err
	}

	task.ID = record.ID
	task.File = record.FilePath
	task.outformat = normalizeOutputFormat(firstNonEmpty(record.OutputFormat, req.OutputFormat))
	task.PreviewJSON = append([]byte(nil), record.PreviewJSON...)

	if len(task.PreviewJSON) == 0 {
		task.PreviewJSON, err = buildPreviewGeoJSON(task.LayerSpecs)
		if err != nil {
			return nil, err
		}
	}

	state := record.State
	lastError := record.LastError
	if !isTerminalTaskState(state) {
		state = TaskStateCanceled
		lastError = firstNonEmpty(lastError, interruptedTaskMessage)
		now := time.Now()
		record.FinishedAt = &now
	}

	task.applyPersistedState(record.CreatedAt, record.StartedAt, record.FinishedAt, state, lastError, record.Current, record.Success, record.Failed)
	return task, nil
}

func formatNullableTime(value *time.Time) interface{} {
	if value == nil {
		return nil
	}
	return value.Format(time.RFC3339Nano)
}

func parseNullableTime(value sql.NullString) (*time.Time, error) {
	if !value.Valid || value.String == "" {
		return nil, nil
	}

	parsed, err := time.Parse(time.RFC3339Nano, value.String)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func isTerminalTaskState(state string) bool {
	switch state {
	case TaskStateCompleted, TaskStateCanceled, TaskStateFailed:
		return true
	default:
		return false
	}
}

func (task *Task) applyPersistedState(createdAt time.Time, startedAt, finishedAt *time.Time, state, lastError string, current, success, failed int64) {
	task.mu.Lock()
	task.createdAt = createdAt
	task.startedAt = startedAt
	task.finishedAt = finishedAt
	task.state = state
	task.lastError = lastError
	task.mu.Unlock()

	atomic.StoreInt64(&task.Current, current)
	atomic.StoreInt64(&task.Success, success)
	atomic.StoreInt64(&task.Failed, failed)

	if isTerminalTaskState(state) {
		task.doneOnce.Do(func() {
			close(task.done)
		})
	}
}
