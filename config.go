package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/paulmach/orb"
	"github.com/paulmach/orb/geojson"
	"github.com/spf13/viper"
)

type LayerConfig struct {
	Min     int    `json:"min"`
	Max     int    `json:"max"`
	GeoJSON string `json:"geojson"`
	URL     string `json:"url,omitempty"`
}

type TileMapConfig struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Schema      string `json:"schema"`
	Format      string `json:"format"`
	JSON        string `json:"json,omitempty"`
	URL         string `json:"url"`
}

type CreateTaskRequest struct {
	Name         string        `json:"name"`
	Description  string        `json:"description,omitempty"`
	OutputFormat string        `json:"outputFormat"`
	TileMap      TileMapConfig `json:"tileMap"`
	Layers       []LayerConfig `json:"layers"`
}

type GeoJSONOption struct {
	Name  string     `json:"name"`
	Path  string     `json:"path"`
	Bound [4]float64 `json:"bounds"`
}

type TileSourcePreset struct {
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	URL         string `json:"url"`
	Format      string `json:"format"`
	Schema      string `json:"schema"`
}

type BootstrapResponse struct {
	Defaults     CreateTaskRequest  `json:"defaults"`
	GeoJSONFiles []GeoJSONOption    `json:"geojsonFiles"`
	Presets      []TileSourcePreset `json:"presets"`
}

func loadDefaultTaskRequest() (CreateTaskRequest, error) {
	req := CreateTaskRequest{
		Name:         viper.GetString("tm.name"),
		Description:  viper.GetString("tm.description"),
		OutputFormat: normalizeOutputFormat(viper.GetString("output.format")),
		TileMap: TileMapConfig{
			Name:        viper.GetString("tm.name"),
			Description: viper.GetString("tm.description"),
			Schema:      firstNonEmpty(viper.GetString("tm.schema"), "xyz"),
			Format:      strings.ToLower(firstNonEmpty(viper.GetString("tm.format"), "jpg")),
			JSON:        viper.GetString("tm.json"),
			URL:         viper.GetString("tm.url"),
		},
	}

	if req.Name == "" {
		req.Name = "Map Task"
		req.TileMap.Name = req.Name
	}

	var layers []LayerConfig
	if err := viper.UnmarshalKey("lrs", &layers); err != nil {
		return req, err
	}
	for i := range layers {
		absPath, err := resolveGeoJSONPath(layers[i].GeoJSON)
		if err != nil {
			return req, err
		}
		layers[i].GeoJSON = toDisplayPath(absPath)
	}
	req.Layers = layers

	return req, nil
}

func loadBootstrap() (BootstrapResponse, error) {
	defaults, err := loadDefaultTaskRequest()
	if err != nil {
		return BootstrapResponse{}, err
	}

	files, err := listGeoJSONFiles("geojson")
	if err != nil {
		return BootstrapResponse{}, err
	}

	return BootstrapResponse{
		Defaults:     defaults,
		GeoJSONFiles: files,
		Presets:      defaultTileSourcePresets(),
	}, nil
}

func NewTaskFromRequest(req CreateTaskRequest) (*Task, error) {
	req = normalizeTaskRequest(req)
	if strings.TrimSpace(req.TileMap.URL) == "" {
		return nil, fmt.Errorf("tile map url is required")
	}
	if len(req.Layers) == 0 {
		return nil, fmt.Errorf("at least one layer is required")
	}

	layers, normalizedLayers, minZoom, maxZoom, err := buildLayers(req.Layers, req.TileMap.URL)
	if err != nil {
		return nil, err
	}

	tm := TileMap{
		Name:        req.Name,
		Description: req.Description,
		Schema:      req.TileMap.Schema,
		Min:         minZoom,
		Max:         maxZoom,
		Format:      req.TileMap.Format,
		JSON:        req.TileMap.JSON,
		URL:         req.TileMap.URL,
	}
	task := NewTask(layers, tm)
	if task == nil {
		return nil, fmt.Errorf("failed to create task")
	}

	task.Name = req.Name
	task.Description = req.Description
	task.TileMap.Name = req.Name
	task.TileMap.Description = req.Description
	task.TileMap.Schema = req.TileMap.Schema
	task.TileMap.Format = req.TileMap.Format
	task.TileMap.JSON = req.TileMap.JSON
	task.TileMap.URL = req.TileMap.URL
	task.LayerSpecs = normalizedLayers
	task.SetOutputFormat(req.OutputFormat)

	preview, err := buildPreviewGeoJSON(normalizedLayers)
	if err != nil {
		return nil, err
	}
	task.PreviewJSON = preview
	return task, nil
}

func normalizeTaskRequest(req CreateTaskRequest) CreateTaskRequest {
	req.Name = firstNonEmpty(strings.TrimSpace(req.Name), strings.TrimSpace(req.TileMap.Name), "Map Task")
	req.Description = strings.TrimSpace(req.Description)
	req.OutputFormat = normalizeOutputFormat(req.OutputFormat)
	req.TileMap.Name = req.Name
	req.TileMap.Description = req.Description
	req.TileMap.Schema = firstNonEmpty(strings.ToLower(strings.TrimSpace(req.TileMap.Schema)), "xyz")
	req.TileMap.Format = strings.ToLower(firstNonEmpty(strings.TrimSpace(req.TileMap.Format), "jpg"))
	req.TileMap.JSON = strings.TrimSpace(req.TileMap.JSON)
	req.TileMap.URL = strings.TrimSpace(req.TileMap.URL)
	return req
}

func buildLayers(specs []LayerConfig, fallbackURL string) ([]Layer, []LayerConfig, int, int, error) {
	layers := make([]Layer, 0)
	normalized := make([]LayerConfig, 0, len(specs))
	minZoom := int(^uint(0) >> 1)
	maxZoom := -1

	for _, spec := range specs {
		if spec.Max < spec.Min {
			return nil, nil, 0, 0, fmt.Errorf("layer max zoom must be greater than or equal to min zoom")
		}

		geoPath, err := resolveGeoJSONPath(spec.GeoJSON)
		if err != nil {
			return nil, nil, 0, 0, err
		}
		collection, err := readCollection(geoPath)
		if err != nil {
			return nil, nil, 0, 0, err
		}

		layerURL := strings.TrimSpace(spec.URL)
		if layerURL == "" {
			layerURL = fallbackURL
		}
		if layerURL == "" {
			return nil, nil, 0, 0, fmt.Errorf("layer url is empty")
		}

		normalized = append(normalized, LayerConfig{
			Min:     spec.Min,
			Max:     spec.Max,
			GeoJSON: toDisplayPath(geoPath),
			URL:     strings.TrimSpace(spec.URL),
		})

		if spec.Min < minZoom {
			minZoom = spec.Min
		}
		if spec.Max > maxZoom {
			maxZoom = spec.Max
		}

		for z := spec.Min; z <= spec.Max; z++ {
			layers = append(layers, Layer{
				URL:        layerURL,
				Zoom:       z,
				Collection: collection,
			})
		}
	}

	if maxZoom < 0 {
		return nil, nil, 0, 0, fmt.Errorf("no valid layers configured")
	}

	return layers, normalized, minZoom, maxZoom, nil
}

func listGeoJSONFiles(root string) ([]GeoJSONOption, error) {
	base, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}

	files := make([]GeoJSONOption, 0)
	err = filepath.Walk(base, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info == nil || info.IsDir() || !strings.EqualFold(filepath.Ext(path), ".geojson") {
			return nil
		}

		fc, err := readFeatureCollection(path)
		if err != nil {
			return err
		}

		bound := boundFromFeatureCollection(fc)
		files = append(files, GeoJSONOption{
			Name:  filepath.Base(path),
			Path:  toDisplayPath(path),
			Bound: [4]float64{bound.Left(), bound.Bottom(), bound.Right(), bound.Top()},
		})
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})

	return files, nil
}

func buildPreviewGeoJSON(specs []LayerConfig) ([]byte, error) {
	fc := geojson.NewFeatureCollection()
	seen := make(map[string]struct{})

	for _, spec := range specs {
		geoPath, err := resolveGeoJSONPath(spec.GeoJSON)
		if err != nil {
			return nil, err
		}
		if _, ok := seen[geoPath]; ok {
			continue
		}
		seen[geoPath] = struct{}{}

		part, err := readFeatureCollection(geoPath)
		if err != nil {
			return nil, err
		}
		for _, feature := range part.Features {
			fc.Append(feature)
		}
	}

	return json.Marshal(fc)
}

func resolveGeoJSONPath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("geojson path is required")
	}

	candidates := []string{path}
	if !filepath.IsAbs(path) {
		candidates = append(candidates, filepath.Join(".", path))
		candidates = append(candidates, filepath.Join("geojson", filepath.Base(path)))
	}

	for _, candidate := range candidates {
		absPath, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if _, err := os.Stat(absPath); err == nil {
			return absPath, nil
		}
	}

	return "", fmt.Errorf("geojson file not found: %s", path)
}

func toDisplayPath(path string) string {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return filepath.ToSlash(path)
	}

	wd, err := os.Getwd()
	if err != nil {
		return filepath.ToSlash(absPath)
	}

	rel, err := filepath.Rel(wd, absPath)
	if err != nil {
		return filepath.ToSlash(absPath)
	}

	rel = filepath.ToSlash(rel)
	if !strings.HasPrefix(rel, ".") {
		rel = "./" + rel
	}
	return rel
}

func readCollection(path string) (orb.Collection, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	fc, err := geojson.UnmarshalFeatureCollection(data)
	if err != nil {
		return nil, err
	}

	var collection orb.Collection
	for _, feature := range fc.Features {
		collection = append(collection, feature.Geometry)
	}
	return collection, nil
}

func readFeatureCollection(path string) (*geojson.FeatureCollection, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	return geojson.UnmarshalFeatureCollection(data)
}

func boundFromFeatureCollection(fc *geojson.FeatureCollection) orb.Bound {
	bound := orb.Bound{Min: orb.Point{1, 1}, Max: orb.Point{-1, -1}}
	for _, feature := range fc.Features {
		bound = bound.Union(feature.Geometry.Bound())
	}
	return bound
}

func defaultTileSourcePresets() []TileSourcePreset {
	return []TileSourcePreset{
		{
			Label:       "天地图影像",
			Description: "适合国内影像抓取预览",
			URL:         "https://t0.tianditu.gov.cn/DataServer?T=img_w&x={x}&y={y}&l={z}&tk=75f0434f240669f4a2df6359275146d2",
			Format:      "jpg",
			Schema:      "xyz",
		},
		{
			Label:       "天地图矢量",
			Description: "标准矢量底图",
			URL:         "https://t0.tianditu.gov.cn/DataServer?T=vec_w&x={x}&y={y}&l={z}&tk=75f0434f240669f4a2df6359275146d2",
			Format:      "png",
			Schema:      "xyz",
		},
		{
			Label:       "Google 影像",
			Description: "通用卫星影像模板",
			URL:         "http://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
			Format:      "jpg",
			Schema:      "xyz",
		},
		{
			Label:       "OpenStreetMap",
			Description: "开放街道底图",
			URL:         "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
			Format:      "png",
			Schema:      "xyz",
		},
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}


