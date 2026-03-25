import type {
  CreateTaskRequest,
  FeatureCollectionData,
  TaskSnapshot,
} from './types'

export async function requestJSON<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text()

  if (!response.ok) {
    throw new Error(payload?.error || payload || `请求失败 (${response.status})`)
  }

  return payload as T
}

function mergeFeatureCollections(collections: FeatureCollectionData[]): FeatureCollectionData {
  return collections.reduce<FeatureCollectionData>(
    (accumulator, current) => {
      if (Array.isArray(current?.features)) {
        accumulator.features.push(...current.features)
      }
      return accumulator
    },
    { type: 'FeatureCollection', features: [] },
  )
}

export async function loadGeoJSONPreview(
  layers: CreateTaskRequest['layers'] | undefined,
): Promise<FeatureCollectionData | null> {
  const paths = [...new Set((layers || []).map((item) => item?.geojson).filter(Boolean))]
  if (!paths.length) {
    return null
  }

  const collections = await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(`/api/geojson?path=${encodeURIComponent(path)}`)
      if (!response.ok) {
        throw new Error(`加载 GeoJSON 失败: ${path}`)
      }
      return response.json() as Promise<FeatureCollectionData>
    }),
  )

  return mergeFeatureCollections(collections)
}

export function formatTime(value?: string) {
  if (!value) {
    return '--'
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function countByStatus(tasks: TaskSnapshot[], status: TaskSnapshot['status']) {
  return tasks.filter((task) => task.status === status).length
}
