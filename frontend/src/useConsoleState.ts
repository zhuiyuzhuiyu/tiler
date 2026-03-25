import { Form, message } from 'antd'
import { useEffect, useState } from 'react'
import type {
  BootstrapResponse,
  CreateTaskRequest,
  FeatureCollectionData,
  TaskSnapshot,
} from './types'
import { countByStatus, requestJSON } from './consoleUtils'
import type { PreviewMode } from './viewConfig'

export function useConsoleState() {
  const [form] = Form.useForm<CreateTaskRequest>()
  const [messageApi, contextHolder] = message.useMessage()
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null)
  const [tasks, setTasks] = useState<TaskSnapshot[]>([])
  const [taskGeoJSON, setTaskGeoJSON] = useState<FeatureCollectionData | null>(null)
  const [previewTarget, setPreviewTarget] = useState<string>('')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('overlay')
  const [tileNonce, setTileNonce] = useState<number>(Date.now())
  const [loadingBootstrap, setLoadingBootstrap] = useState<boolean>(true)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [serverError, setServerError] = useState<string>('')
  const [deletingTaskId, setDeletingTaskId] = useState<string>('')

  const selectedTask = previewTarget ? tasks.find((task) => task.id === previewTarget) || null : null

  useEffect(() => {
    let active = true

    async function initialize() {
      setLoadingBootstrap(true)
      try {
        const [bootstrapData, taskList] = await Promise.all([
          requestJSON<BootstrapResponse>('/api/bootstrap'),
          requestJSON<TaskSnapshot[]>('/api/tasks'),
        ])

        if (!active) {
          return
        }

        setBootstrap(bootstrapData)
        form.setFieldsValue(bootstrapData.defaults)
        setTasks(taskList)
        setServerError('')
      } catch (error) {
        if (!active) {
          return
        }
        const nextMessage = error instanceof Error ? error.message : '初始化失败'
        setServerError(nextMessage)
        messageApi.error(nextMessage)
      } finally {
        if (active) {
          setLoadingBootstrap(false)
        }
      }
    }

    void initialize()
    return () => {
      active = false
    }
  }, [form, messageApi])

  useEffect(() => {
    let stopped = false

    async function refreshTasks() {
      try {
        const taskList = await requestJSON<TaskSnapshot[]>('/api/tasks')
        if (!stopped) {
          setTasks(taskList)
          setServerError('')
        }
      } catch (error) {
        if (!stopped) {
          setServerError(error instanceof Error ? error.message : '任务同步失败')
        }
      }
    }

    void refreshTasks()
    const timer = window.setInterval(() => {
      void refreshTasks()
    }, 2500)

    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let active = true

    async function loadTaskPreview() {
      if (!previewTarget) {
        setTaskGeoJSON(null)
        return
      }

      try {
        const response = await fetch(`/api/tasks/${previewTarget}/geojson`)
        if (!response.ok) {
          throw new Error('加载任务范围失败')
        }

        const payload = (await response.json()) as FeatureCollectionData
        if (active) {
          setTaskGeoJSON(payload)
        }
      } catch (error) {
        if (active) {
          const nextMessage = error instanceof Error ? error.message : '任务范围加载失败'
          messageApi.warning(nextMessage)
          setTaskGeoJSON(null)
        }
      }
    }

    void loadTaskPreview()
    return () => {
      active = false
    }
  }, [previewTarget, messageApi])

  async function refreshTaskList() {
    const nextTasks = await requestJSON<TaskSnapshot[]>('/api/tasks')
    setTasks(nextTasks)
  }

  async function handleResetDefaults() {
    if (!bootstrap) {
      return
    }

    form.setFieldsValue(bootstrap.defaults)
  }

  function handleApplyPreset(value?: string) {
    const preset = bootstrap?.presets.find((item) => item.label === value)
    if (!preset) {
      return
    }

    const currentTileMap = form.getFieldValue('tileMap') || {}
    form.setFieldsValue({
      tileMap: {
        ...currentTileMap,
        url: preset.url,
        format: preset.format,
        schema: preset.schema,
      },
    })
  }

  async function handleSubmit(values: CreateTaskRequest) {
    setSubmitting(true)
    try {
      const task = await requestJSON<TaskSnapshot>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(values),
      })

      messageApi.success('任务已创建并开始抓取')
      setPreviewTarget(task.id)
      setPreviewMode(task.previewable ? 'overlay' : 'source')
      await refreshTaskList()
      setTileNonce(Date.now())
      return task
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '任务创建失败')
      return null
    } finally {
      setSubmitting(false)
    }
  }

  async function handleTaskAction(taskId: string, action: 'pause' | 'resume' | 'cancel') {
    try {
      await requestJSON<TaskSnapshot>(`/api/tasks/${taskId}/${action}`, { method: 'POST' })
      await refreshTaskList()
      setTileNonce(Date.now())
      messageApi.success(
        action === 'pause' ? '任务已暂停' : action === 'resume' ? '任务已继续' : '任务已取消',
      )
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '任务状态更新失败')
    }
  }

  async function handleDeleteTask(taskId: string) {
    setDeletingTaskId(taskId)
    try {
      await requestJSON<{ deleted: boolean }>(`/api/tasks/${taskId}`, { method: 'DELETE' })
      if (previewTarget === taskId) {
        setPreviewTarget('')
        setPreviewMode('overlay')
      }
      await refreshTaskList()
      setTileNonce(Date.now())
      messageApi.success('任务已删除')
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '任务删除失败')
    } finally {
      setDeletingTaskId('')
    }
  }

  function openTaskPreview(task: TaskSnapshot) {
    setPreviewTarget(task.id)
    setPreviewMode(task.previewable ? 'overlay' : 'source')
  }

  function refreshTiles() {
    setTileNonce(Date.now())
  }

  const previewGeoJSON = selectedTask ? taskGeoJSON : null
  const previewTips = selectedTask
    ? selectedTask.previewable
      ? '当前为任务实时叠加预览，底图和本地瓦片会自动合成显示。'
      : '当前任务不是图片瓦片格式，仅显示范围和源图。'
    : '先从左侧选择一个任务，再查看地图预览。'

  const runningCount = countByStatus(tasks, 'running')
  const pausedCount = countByStatus(tasks, 'paused')
  const completedCount = countByStatus(tasks, 'completed')
  const failedCount = countByStatus(tasks, 'failed')
  const successTiles = tasks.reduce((sum, task) => sum + task.success, 0)
  const currentTiles = tasks.reduce((sum, task) => sum + task.current, 0)

  return {
    form,
    messageApi,
    contextHolder,
    bootstrap,
    tasks,
    previewTarget,
    previewMode,
    tileNonce,
    loadingBootstrap,
    submitting,
    serverError,
    deletingTaskId,
    selectedTask,
    previewGeoJSON,
    previewTips,
    runningCount,
    pausedCount,
    completedCount,
    failedCount,
    successTiles,
    currentTiles,
    setPreviewMode,
    handleResetDefaults,
    handleApplyPreset,
    handleSubmit,
    handleTaskAction,
    handleDeleteTask,
    openTaskPreview,
    refreshTiles,
  }
}
