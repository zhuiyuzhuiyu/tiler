package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type TileTreeNode struct {
	Key     string `json:"key"`
	Title   string `json:"title"`
	Level   string `json:"level"`
	IsLeaf  bool   `json:"isLeaf"`
	Z       int    `json:"z,omitempty"`
	X       int    `json:"x,omitempty"`
	Y       int    `json:"y,omitempty"`
	TileURL string `json:"tileUrl,omitempty"`
}

func (task *Task) TileTree(parent string) ([]TileTreeNode, error) {
	parent = strings.Trim(strings.TrimSpace(parent), "/")
	if parent == "" {
		return task.listTileZoomNodes()
	}

	parts := strings.Split(parent, "/")
	switch len(parts) {
	case 1:
		z, err := strconv.Atoi(parts[0])
		if err != nil {
			return nil, fmt.Errorf("invalid zoom path")
		}
		return task.listTileColumnNodes(z)
	case 2:
		z, err := strconv.Atoi(parts[0])
		if err != nil {
			return nil, fmt.Errorf("invalid zoom path")
		}
		x, err := strconv.Atoi(parts[1])
		if err != nil {
			return nil, fmt.Errorf("invalid column path")
		}
		return task.listTileLeafNodes(z, x)
	default:
		return nil, fmt.Errorf("invalid tile tree path")
	}
}

func (task *Task) listTileZoomNodes() ([]TileTreeNode, error) {
	switch task.outformat {
	case "mbtiles":
		return task.listMBTilesZoomNodes()
	default:
		return task.listFileZoomNodes()
	}
}

func (task *Task) listTileColumnNodes(z int) ([]TileTreeNode, error) {
	switch task.outformat {
	case "mbtiles":
		return task.listMBTilesColumnNodes(z)
	default:
		return task.listFileColumnNodes(z)
	}
}

func (task *Task) listTileLeafNodes(z, x int) ([]TileTreeNode, error) {
	switch task.outformat {
	case "mbtiles":
		return task.listMBTilesLeafNodes(z, x)
	default:
		return task.listFileLeafNodes(z, x)
	}
}

func (task *Task) listFileZoomNodes() ([]TileTreeNode, error) {
	values, err := readNumericDirectory(filepath.Join(task.File))
	if err != nil {
		return nil, err
	}

	nodes := make([]TileTreeNode, 0, len(values))
	for _, z := range values {
		nodes = append(nodes, TileTreeNode{
			Key:    strconv.Itoa(z),
			Title:  fmt.Sprintf("层级 Z %d", z),
			Level:  "zoom",
			IsLeaf: false,
			Z:      z,
		})
	}
	return nodes, nil
}

func (task *Task) listFileColumnNodes(z int) ([]TileTreeNode, error) {
	values, err := readNumericDirectory(filepath.Join(task.File, strconv.Itoa(z)))
	if err != nil {
		return nil, err
	}

	nodes := make([]TileTreeNode, 0, len(values))
	for _, x := range values {
		nodes = append(nodes, TileTreeNode{
			Key:    fmt.Sprintf("%d/%d", z, x),
			Title:  fmt.Sprintf("列 X %d", x),
			Level:  "column",
			IsLeaf: false,
			Z:      z,
			X:      x,
		})
	}
	return nodes, nil
}

func (task *Task) listFileLeafNodes(z, x int) ([]TileTreeNode, error) {
	dir := filepath.Join(task.File, strconv.Itoa(z), strconv.Itoa(x))
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []TileTreeNode{}, nil
		}
		return nil, err
	}

	type fileTile struct {
		y int
	}

	values := make([]fileTile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(entry.Name())), ".")
		if ext != strings.ToLower(task.TileMap.Format) {
			continue
		}
		y, err := strconv.Atoi(strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))
		if err != nil {
			continue
		}
		values = append(values, fileTile{y: y})
	}

	sort.Slice(values, func(i, j int) bool {
		return values[i].y < values[j].y
	})

	nodes := make([]TileTreeNode, 0, len(values))
	for _, item := range values {
		nodes = append(nodes, TileTreeNode{
			Key:     fmt.Sprintf("%d/%d/%d", z, x, item.y),
			Title:   fmt.Sprintf("行 Y %d", item.y),
			Level:   "tile",
			IsLeaf:  true,
			Z:       z,
			X:       x,
			Y:       item.y,
			TileURL: fmt.Sprintf("/api/tasks/%s/tiles/%d/%d/%d", task.ID, z, x, item.y),
		})
	}
	return nodes, nil
}

func (task *Task) listMBTilesZoomNodes() ([]TileTreeNode, error) {
	db, err := task.mbtilesDB()
	if err != nil {
		if errorsIsNotFound(err) {
			return []TileTreeNode{}, nil
		}
		return nil, err
	}

	rows, err := db.Query("select distinct zoom_level from tiles order by zoom_level asc")
	if err != nil {
		if errorsIsNotFound(err) {
			return []TileTreeNode{}, nil
		}
		return nil, err
	}
	defer rows.Close()

	nodes := make([]TileTreeNode, 0)
	for rows.Next() {
		var z int
		if err := rows.Scan(&z); err != nil {
			return nil, err
		}
		nodes = append(nodes, TileTreeNode{
			Key:    strconv.Itoa(z),
			Title:  fmt.Sprintf("层级 Z %d", z),
			Level:  "zoom",
			IsLeaf: false,
			Z:      z,
		})
	}
	return nodes, rows.Err()
}

func (task *Task) listMBTilesColumnNodes(z int) ([]TileTreeNode, error) {
	db, err := task.mbtilesDB()
	if err != nil {
		if errorsIsNotFound(err) {
			return []TileTreeNode{}, nil
		}
		return nil, err
	}

	rows, err := db.Query("select distinct tile_column from tiles where zoom_level = ? order by tile_column asc", z)
	if err != nil {
		if errorsIsNotFound(err) {
			return []TileTreeNode{}, nil
		}
		return nil, err
	}
	defer rows.Close()

	nodes := make([]TileTreeNode, 0)
	for rows.Next() {
		var x int
		if err := rows.Scan(&x); err != nil {
			return nil, err
		}
		nodes = append(nodes, TileTreeNode{
			Key:    fmt.Sprintf("%d/%d", z, x),
			Title:  fmt.Sprintf("列 X %d", x),
			Level:  "column",
			IsLeaf: false,
			Z:      z,
			X:      x,
		})
	}
	return nodes, rows.Err()
}

func (task *Task) listMBTilesLeafNodes(z, x int) ([]TileTreeNode, error) {
	db, err := task.mbtilesDB()
	if err != nil {
		if errorsIsNotFound(err) {
			return []TileTreeNode{}, nil
		}
		return nil, err
	}

	rows, err := db.Query("select tile_row from tiles where zoom_level = ? and tile_column = ? order by tile_row desc", z, x)
	if err != nil {
		if errorsIsNotFound(err) {
			return []TileTreeNode{}, nil
		}
		return nil, err
	}
	defer rows.Close()

	nodes := make([]TileTreeNode, 0)
	maxRow := (1 << uint(z)) - 1
	for rows.Next() {
		var row int
		if err := rows.Scan(&row); err != nil {
			return nil, err
		}
		y := maxRow - row
		nodes = append(nodes, TileTreeNode{
			Key:     fmt.Sprintf("%d/%d/%d", z, x, y),
			Title:   fmt.Sprintf("行 Y %d", y),
			Level:   "tile",
			IsLeaf:  true,
			Z:       z,
			X:       x,
			Y:       y,
			TileURL: fmt.Sprintf("/api/tasks/%s/tiles/%d/%d/%d", task.ID, z, x, y),
		})
	}
	return nodes, rows.Err()
}

func (task *Task) mbtilesDB() (*sql.DB, error) {
	if task.db != nil {
		return task.db, nil
	}
	if err := task.openMBTilesForRead(); err != nil {
		return nil, err
	}
	if task.db == nil {
		return nil, sql.ErrNoRows
	}
	return task.db, nil
}

func readNumericDirectory(dir string) ([]int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []int{}, nil
		}
		return nil, err
	}

	values := make([]int, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		value, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		values = append(values, value)
	}

	sort.Ints(values)
	return values, nil
}
