import { Empty } from 'antd'
import * as Cesium from 'cesium'
import { useEffect, useRef } from 'react'
import type { FeatureCollectionData, TaskSnapshot } from '../types'

interface CesiumPreviewProps {
  task: TaskSnapshot | null
  geoJSON: FeatureCollectionData | null
  mode: 'overlay' | 'source' | 'local'
  tileNonce: number
}

const DEFAULT_RECTANGLE = Cesium.Rectangle.fromDegrees(73, 18, 135, 54)

function rectangleFromBounds(bounds?: [number, number, number, number]) {
  if (!bounds || bounds.length !== 4) {
    return undefined
  }

  const [west, south, east, north] = bounds
  return Cesium.Rectangle.fromDegrees(west, south, east, north)
}

function removeLayer(viewer: Cesium.Viewer, layer: Cesium.ImageryLayer | null) {
  if (layer) {
    viewer.imageryLayers.remove(layer, true)
  }
}

export default function CesiumPreview({ task, geoJSON, mode, tileNonce }: CesiumPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<Cesium.Viewer | null>(null)
  const sourceLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  const localLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  const geoJsonRef = useRef<Cesium.GeoJsonDataSource | null>(null)
  const lastViewKeyRef = useRef<string>('')

  const taskId = task?.id ?? ''
  const bounds = task?.bounds
  const boundsKey = bounds ? bounds.join(',') : ''
  const taskMin = task?.min ?? 0
  const taskMax = task?.max ?? 18
  const previewable = Boolean(task?.previewable)
  const viewKey = `${taskId}|${mode}|${taskMin}|${taskMax}|${previewable ? 1 : 0}|${boundsKey}`

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) {
      return
    }

    const viewer = new Cesium.Viewer(containerRef.current, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      requestRenderMode: true,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
    })

    viewer.imageryLayers.removeAll()
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#081626')
    viewer.scene.screenSpaceCameraController.enableTilt = false
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = false
    viewer.camera.setView({ destination: DEFAULT_RECTANGLE })

    viewerRef.current = viewer

    return () => {
      if (!viewer.isDestroyed()) {
        viewer.destroy()
      }
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) {
      return
    }

    const rectangle = rectangleFromBounds(bounds)
    const viewChanged = lastViewKeyRef.current !== viewKey
    const showSource = Boolean(taskId) && (mode === 'source' || mode === 'overlay')
    const showLocal = Boolean(taskId) && previewable && (mode === 'local' || mode === 'overlay')

    removeLayer(viewer, sourceLayerRef.current)
    removeLayer(viewer, localLayerRef.current)
    sourceLayerRef.current = null
    localLayerRef.current = null

    if (!taskId) {
      if (viewChanged) {
        viewer.camera.flyTo({ destination: DEFAULT_RECTANGLE, duration: 0.6 })
      }
      lastViewKeyRef.current = viewKey
      viewer.scene.requestRender()
      return
    }

    if (showSource) {
      const provider = new Cesium.UrlTemplateImageryProvider({
        url: `/api/tasks/${taskId}/source/{z}/{x}/{y}?v=${tileNonce}`,
        minimumLevel: taskMin,
        maximumLevel: taskMax,
        rectangle,
      })
      const layer = viewer.imageryLayers.addImageryProvider(provider)
      layer.alpha = mode === 'overlay' ? 0.72 : 1
      sourceLayerRef.current = layer
    }

    if (showLocal) {
      const provider = new Cesium.UrlTemplateImageryProvider({
        url: `/api/tasks/${taskId}/tiles/{z}/{x}/{y}?v=${tileNonce}`,
        minimumLevel: taskMin,
        maximumLevel: taskMax,
        rectangle,
      })
      const layer = viewer.imageryLayers.addImageryProvider(provider)
      layer.alpha = mode === 'overlay' ? 0.98 : 1
      localLayerRef.current = layer
    }

    if (viewChanged && rectangle) {
      viewer.camera.flyTo({ destination: rectangle, duration: 0.6 })
    }

    lastViewKeyRef.current = viewKey
    viewer.scene.requestRender()
  }, [boundsKey, mode, previewable, taskId, taskMax, taskMin, tileNonce, viewKey])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) {
      return
    }

    let canceled = false

    async function syncGeoJSON() {
      if (geoJsonRef.current) {
        viewer.dataSources.remove(geoJsonRef.current, true)
        geoJsonRef.current = null
      }

      if (!geoJSON) {
        viewer.scene.requestRender()
        return
      }

      const dataSource = await Cesium.GeoJsonDataSource.load(geoJSON as unknown as object, {
        clampToGround: false,
        fill: Cesium.Color.fromCssColorString('#8dc4ff').withAlpha(0.16),
        stroke: Cesium.Color.fromCssColorString('#1677ff'),
        strokeWidth: 2,
      })

      if (canceled || !viewerRef.current) {
        return
      }

      geoJsonRef.current = dataSource
      viewer.dataSources.add(dataSource)

      if (!taskId) {
        await viewer.flyTo(dataSource, { duration: 0.6 })
      }

      viewer.scene.requestRender()
    }

    void syncGeoJSON()

    return () => {
      canceled = true
    }
  }, [geoJSON, taskId])

  if (!task && !geoJSON) {
    return (
      <div className="map-empty">
        <Empty
          description="还没有可预览的数据，先配置范围或选择任务。"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    )
  }

  return <div className="cesium-stage" ref={containerRef} />
}
