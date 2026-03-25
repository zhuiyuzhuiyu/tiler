export interface LayerConfig {
  min: number
  max: number
  geojson: string
  url?: string
}

export interface TileMapConfig {
  name: string
  description?: string
  schema: string
  format: string
  json?: string
  url: string
}

export interface CreateTaskRequest {
  name: string
  description?: string
  outputFormat: string
  tileMap: TileMapConfig
  layers: LayerConfig[]
}

export interface GeoJSONOption {
  name: string
  path: string
  bounds: [number, number, number, number]
}

export interface TileSourcePreset {
  label: string
  description?: string
  url: string
  format: string
  schema: string
}

export interface BootstrapResponse {
  defaults: CreateTaskRequest
  geojsonFiles: GeoJSONOption[]
  presets: TileSourcePreset[]
}

export interface TaskSnapshot {
  id: string
  name: string
  description?: string
  status: 'queued' | 'running' | 'paused' | 'completed' | 'canceled' | 'failed'
  file?: string
  outputFormat: string
  total: number
  current: number
  success: number
  failed: number
  progress: number
  min: number
  max: number
  bounds: [number, number, number, number]
  center: [number, number]
  tileMap: TileMapConfig
  layers: LayerConfig[]
  previewable: boolean
  canPause: boolean
  canResume: boolean
  canCancel: boolean
  error?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
}

export interface FeatureCollectionData {
  type: 'FeatureCollection'
  features: Record<string, unknown>[]
}

export interface TileTreeNode {
  key: string
  title: string
  level: 'zoom' | 'column' | 'tile'
  isLeaf: boolean
  z?: number
  x?: number
  y?: number
  tileUrl?: string
}
