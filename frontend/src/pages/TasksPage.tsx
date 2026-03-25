import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Steps,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd'
import type { FormInstance } from 'antd'
import {
  DeleteOutlined,
  EyeOutlined,
  PauseCircleOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RocketOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import type { BootstrapResponse, CreateTaskRequest, TaskSnapshot } from '../types'
import { formatTime } from '../consoleUtils'
import { STATUS_META } from '../viewConfig'

const { Paragraph, Text } = Typography

interface TasksPageProps {
  bootstrap: BootstrapResponse | null
  form: FormInstance<CreateTaskRequest>
  submitting: boolean
  tasks: TaskSnapshot[]
  previewTarget: string
  deletingTaskId: string
  onApplyPreset: (value?: string) => void
  onSubmit: (values: CreateTaskRequest) => Promise<unknown>
  onTaskAction: (taskId: string, action: 'pause' | 'resume' | 'cancel') => Promise<void>
  onDeleteTask: (taskId: string) => Promise<void>
  onPreviewTask: (task: TaskSnapshot) => void
  onOpenTileBrowser: (task: TaskSnapshot) => void
}

const STEP_ITEMS = [
  { key: 'base', title: '基础信息' },
  { key: 'tile', title: '瓦片设置' },
  { key: 'rules', title: '分级抓取规则' },
]

export default function TasksPage({
  bootstrap,
  form,
  submitting,
  tasks,
  previewTarget,
  deletingTaskId,
  onApplyPreset,
  onSubmit,
  onTaskAction,
  onDeleteTask,
  onPreviewTask,
  onOpenTileBrowser,
}: TasksPageProps) {
  const [messageApi, messageContextHolder] = message.useMessage()
  const watchedLayers = Form.useWatch('layers', form) || []
  const [activeRuleTab, setActiveRuleTab] = useState('0')
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [selectedPreset, setSelectedPreset] = useState<string | undefined>(undefined)

  useEffect(() => {
    const maxIndex = Math.max(watchedLayers.length - 1, 0)
    const currentIndex = Number(activeRuleTab)
    if (!Number.isFinite(currentIndex) || currentIndex > maxIndex) {
      setActiveRuleTab(String(maxIndex))
    }
  }, [activeRuleTab, watchedLayers.length])

  const presetOptions = useMemo(
    () =>
      (bootstrap?.presets || []).map((preset) => ({
        label: `${preset.label} · ${preset.description || '模板'}`,
        value: preset.label,
      })),
    [bootstrap?.presets],
  )

  const geoJSONOptions = useMemo(
    () =>
      (bootstrap?.geojsonFiles || []).map((item) => ({
        label: `${item.name} · ${item.path}`,
        value: item.path,
      })),
    [bootstrap?.geojsonFiles],
  )

  function applyDefaultPreset() {
    const firstPreset = bootstrap?.presets?.[0]
    if (!firstPreset) {
      setSelectedPreset(undefined)
      form.setFieldValue('__preset__', undefined)
      return
    }

    setSelectedPreset(firstPreset.label)
    form.setFieldValue('__preset__', firstPreset.label)
    onApplyPreset(firstPreset.label)
  }

  function openCreator() {
    setCurrentStep(0)
    setActiveRuleTab('0')
    applyDefaultPreset()
    setCreatorOpen(true)
  }

  function closeCreator() {
    setCreatorOpen(false)
    setCurrentStep(0)
    setSelectedPreset(undefined)
  }

  async function handleFinish(values: CreateTaskRequest) {
    const result = await onSubmit(values)
    if (result) {
      closeCreator()
    }
  }

  async function validateCurrentStep() {
    if (currentStep === 0) {
      if (presetOptions.length && !selectedPreset) {
        await form.validateFields(['__preset__'])
        return false
      }
      await form.validateFields(['name', 'description'])
      return true
    }

    if (currentStep === 1) {
      await form.validateFields([
        'outputFormat',
        ['tileMap', 'format'],
        ['tileMap', 'schema'],
        ['tileMap', 'json'],
        ['tileMap', 'url'],
      ])
      return true
    }

    await form.validateFields(['layers'])
    return true
  }

  async function validateAllSteps() {
    if (presetOptions.length && !selectedPreset) {
      await form.validateFields(['__preset__'])
    }

    await form.validateFields([
      '__preset__',
      'name',
      'description',
      'outputFormat',
      ['tileMap', 'format'],
      ['tileMap', 'schema'],
      ['tileMap', 'json'],
      ['tileMap', 'url'],
      'layers',
    ])
  }

  function getValidationMessage(error: unknown, fallback: string) {
    if (
      error &&
      typeof error === 'object' &&
      'errorFields' in error &&
      Array.isArray((error as { errorFields?: Array<{ errors?: string[] }> }).errorFields)
    ) {
      const firstField = (error as { errorFields: Array<{ errors?: string[] }> }).errorFields[0]
      const firstError = firstField?.errors?.[0]
      if (firstError) {
        return firstError
      }
    }

    return fallback
  }

  async function goNextStep() {
    try {
      const ok = await validateCurrentStep()
      if (ok) {
        setCurrentStep((prev) => Math.min(prev + 1, STEP_ITEMS.length - 1))
      }
    } catch (error) {
      messageApi.warning(getValidationMessage(error, '请先完善当前步骤的必填项'))
    }
  }

  async function handleSubmitFromModal() {
    try {
      await validateAllSteps()
    } catch (error) {
      messageApi.error(getValidationMessage(error, '表单校验未通过，请检查必填项'))
      return
    }

    const values = form.getFieldsValue(true) as CreateTaskRequest & { __preset__?: string }
    const { __preset__, ...request } = values
    void __preset__
    await handleFinish(request)
  }

  function renderTaskActionButtons(task: TaskSnapshot) {
    return (
      <Space wrap>
        <Button
          icon={<EyeOutlined />}
          type={previewTarget === task.id ? 'primary' : 'default'}
          onClick={() => onPreviewTask(task)}
        >
          地图预览
        </Button>
        <Button icon={<PictureOutlined />} onClick={() => onOpenTileBrowser(task)}>
          瓦片浏览器
        </Button>
        {task.canPause ? (
          <Button icon={<PauseCircleOutlined />} onClick={() => void onTaskAction(task.id, 'pause')}>
            暂停
          </Button>
        ) : null}
        {task.canResume ? (
          <Button icon={<PlayCircleOutlined />} onClick={() => void onTaskAction(task.id, 'resume')}>
            继续
          </Button>
        ) : null}
        {task.canCancel ? (
          <Button danger icon={<StopOutlined />} onClick={() => void onTaskAction(task.id, 'cancel')}>
            取消
          </Button>
        ) : null}
        <Popconfirm
          cancelText="取消"
          okText="删除"
          title="确认删除这个任务吗？"
          description="会移除任务记录，并清理当前任务输出文件。"
          onConfirm={() => void onDeleteTask(task.id)}
        >
          <Button danger icon={<DeleteOutlined />} loading={deletingTaskId === task.id}>
            删除
          </Button>
        </Popconfirm>
      </Space>
    )
  }

  return (
    <div className="page-surface animate-in tasks-page">
      {messageContextHolder}
      <Card
        bordered={false}
        className="panel-card screen-card task-list-card"
        title="任务列表"
        extra={
          <Button icon={<PlusOutlined />} type="primary" onClick={openCreator}>
            新建任务
          </Button>
        }
      >
        {tasks.length ? (
          <List
            dataSource={tasks}
            itemLayout="vertical"
            renderItem={(task) => {
              const status = STATUS_META[task.status]

              return (
                <List.Item
                  className={previewTarget === task.id ? 'task-item task-item-active' : 'task-item'}
                  key={task.id}
                >
                  <div className="task-main">
                    <div className="task-header-row">
                      <Space align="center" size={10} wrap>
                        <Text strong>{task.name}</Text>
                        <Tag color={status.color}>{status.label}</Tag>
                        <Text type="secondary">
                          {task.outputFormat === 'mbtiles' ? 'MBTiles' : '文件目录'}
                        </Text>
                      </Space>
                      {renderTaskActionButtons(task)}
                    </div>

                    <Progress percent={Number(task.progress.toFixed(1))} size="small" />

                    <Space className="task-meta" size={[12, 6]} wrap>
                      <Text type="secondary">
                        进度: {task.current}/{task.total}
                      </Text>
                      <Text type="secondary">成功: {task.success}</Text>
                      <Text type="secondary">失败: {task.failed}</Text>
                      <Text type="secondary">创建时间: {formatTime(task.createdAt)}</Text>
                    </Space>

                    <Paragraph className="task-file" ellipsis={{ rows: 1, expandable: true, symbol: '展开路径' }}>
                      输出位置: {task.file || '--'}
                    </Paragraph>

                    {task.error ? <Alert className="task-error" message={task.error} showIcon type="error" /> : null}
                  </div>
                </List.Item>
              )
            }}
          />
        ) : (
          <div className="task-list-empty">还没有任务，先创建一个抓取任务。</div>
        )}
      </Card>

      <Modal
        destroyOnHidden={false}
        footer={null}
        open={creatorOpen}
        title="新建抓取任务"
        width={880}
        onCancel={closeCreator}
      >
        <Form<CreateTaskRequest> form={form} layout="vertical" preserve>
          <Steps className="task-creator-steps" current={currentStep} items={STEP_ITEMS} />

          <div className="task-creator-body">
            <div className={`task-step-pane ${currentStep === 0 ? '' : 'task-step-pane-hidden'}`}>
              <Form.Item
                label="常用地图源"
                name="__preset__"
                rules={presetOptions.length ? [{ required: true, message: '请选择常用地图源' }] : []}
              >
                <Select
                  options={presetOptions}
                  placeholder="选择常用地图源模板"
                  onChange={(value) => {
                    setSelectedPreset(value)
                    onApplyPreset(value)
                  }}
                />
              </Form.Item>

              <Form.Item<CreateTaskRequest>
                label="任务名称"
                name="name"
                rules={[{ required: true, message: '请输入任务名称' }]}
              >
                <Input placeholder="例如：南京影像抓取任务" />
              </Form.Item>

              <Form.Item<CreateTaskRequest> label="任务描述" name="description">
                <Input.TextArea
                  autoSize={{ minRows: 5, maxRows: 7 }}
                  placeholder="补充抓取用途、区域说明或业务背景"
                />
              </Form.Item>
            </div>

            <div className={`task-step-pane ${currentStep === 1 ? '' : 'task-step-pane-hidden'}`}>
              <div className="task-step-grid">
                <Form.Item<CreateTaskRequest>
                  label="输出格式"
                  name="outputFormat"
                  rules={[{ required: true, message: '请选择输出格式' }]}
                >
                  <Select
                    options={[
                      { label: '文件目录', value: 'file' },
                      { label: 'MBTiles', value: 'mbtiles' },
                    ]}
                  />
                </Form.Item>

                <Form.Item<CreateTaskRequest>
                  label="瓦片格式"
                  name={['tileMap', 'format']}
                  rules={[{ required: true, message: '请选择瓦片格式' }]}
                >
                  <Select
                    options={[
                      { label: 'JPG', value: 'jpg' },
                      { label: 'PNG', value: 'png' },
                      { label: 'WEBP', value: 'webp' },
                      { label: 'PBF', value: 'pbf' },
                    ]}
                  />
                </Form.Item>

                <Form.Item<CreateTaskRequest>
                  label="坐标模式"
                  name={['tileMap', 'schema']}
                  rules={[{ required: true, message: '请选择坐标模式' }]}
                >
                  <Select
                    options={[
                      { label: 'XYZ', value: 'xyz' },
                      { label: 'TMS', value: 'tms' },
                    ]}
                  />
                </Form.Item>

                <Form.Item<CreateTaskRequest> label="TileJSON" name={['tileMap', 'json']}>
                  <Input placeholder="可选" />
                </Form.Item>
              </div>

              <Form.Item<CreateTaskRequest>
                label="瓦片 URL 模板"
                name={['tileMap', 'url']}
                rules={[{ required: true, message: '请输入瓦片 URL 模板' }]}
              >
                <Input.TextArea
                  autoSize={{ minRows: 6, maxRows: 8 }}
                  placeholder="例如：https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
              </Form.Item>
            </div>

            <div className={`task-step-pane ${currentStep === 2 ? '' : 'task-step-pane-hidden'}`}>
              <Form.List name="layers">
                {(fields, { add, remove }) => {
                  const items = fields.map((field, index) => ({
                    key: String(field.name),
                    label: `规则 ${index + 1}`,
                    children: (
                      <div className="rule-tab-pane">
                        <div className="task-step-grid">
                          <Form.Item
                            label="最小层级"
                            name={[field.name, 'min']}
                            rules={[{ required: true, message: '请输入最小层级' }]}
                          >
                            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                          </Form.Item>

                          <Form.Item
                            label="最大层级"
                            name={[field.name, 'max']}
                            rules={[{ required: true, message: '请输入最大层级' }]}
                          >
                            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
                          </Form.Item>
                        </div>

                        <Form.Item
                          label="GeoJSON 范围"
                          name={[field.name, 'geojson']}
                          rules={[{ required: true, message: '请选择范围文件' }]}
                        >
                          <Select options={geoJSONOptions} placeholder="选择范围文件" showSearch />
                        </Form.Item>

                        <Form.Item label="图层 URL 覆盖" name={[field.name, 'url']}>
                          <Input placeholder="留空则继承瓦片 URL 模板" />
                        </Form.Item>

                        {fields.length > 1 ? (
                          <Button
                            danger
                            type="text"
                            onClick={() => {
                              remove(field.name)
                              setActiveRuleTab(String(Math.max(index - 1, 0)))
                            }}
                          >
                            删除当前规则
                          </Button>
                        ) : null}
                      </div>
                    ),
                  }))

                  return (
                    <>
                      <div className="rule-tabs-toolbar">
                        <Text type="secondary">按规则标签切换不同缩放范围。</Text>
                        <Button
                          icon={<PlusOutlined />}
                          onClick={() => {
                            add({ min: 0, max: 0, geojson: '', url: '' })
                            setActiveRuleTab(String(fields.length))
                          }}
                        >
                          新增规则
                        </Button>
                      </div>

                      {fields.length ? (
                        <Tabs activeKey={activeRuleTab} className="rule-tabs" items={items} onChange={setActiveRuleTab} />
                      ) : (
                        <div className="rule-empty-state">
                          <Button
                            icon={<PlusOutlined />}
                            onClick={() => {
                              add({ min: 0, max: 0, geojson: '', url: '' })
                              setActiveRuleTab('0')
                            }}
                          >
                            添加第一条规则
                          </Button>
                        </div>
                      )}
                    </>
                  )
                }}
              </Form.List>
            </div>
          </div>

          <div className="task-creator-actions">
            <Button onClick={closeCreator}>取消</Button>
            <Space>
              {currentStep > 0 ? <Button onClick={() => setCurrentStep((prev) => prev - 1)}>上一步</Button> : null}
              {currentStep < STEP_ITEMS.length - 1 ? (
                <Button type="primary" onClick={() => void goNextStep()}>
                  下一步
                </Button>
              ) : (
                <Button icon={<RocketOutlined />} loading={submitting} type="primary" onClick={() => void handleSubmitFromModal()}>
                  创建并启动
                </Button>
              )}
            </Space>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
