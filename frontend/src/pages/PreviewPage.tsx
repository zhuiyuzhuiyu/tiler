import {
  Button,
  Card,
  Col,
  Empty,
  List,
  Popconfirm,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd'
import { DeleteOutlined, PictureOutlined, ReloadOutlined } from '@ant-design/icons'
import CesiumPreview from '../components/CesiumPreview'
import type { FeatureCollectionData, TaskSnapshot } from '../types'
import { STATUS_META, type PreviewMode } from '../viewConfig'

const { Paragraph, Text } = Typography

interface PreviewPageProps {
  tasks: TaskSnapshot[]
  selectedTask: TaskSnapshot | null
  previewTarget: string
  previewMode: PreviewMode
  previewGeoJSON: FeatureCollectionData | null
  previewTips: string
  deletingTaskId: string
  tileNonce: number
  onOpenTask: (task: TaskSnapshot) => void
  onOpenTileBrowser: (task: TaskSnapshot) => void
  onDeleteTask: (taskId: string) => Promise<void>
  onRefreshTiles: () => void
}

export default function PreviewPage({
  tasks,
  selectedTask,
  previewTarget,
  previewMode,
  previewGeoJSON,
  previewTips,
  deletingTaskId,
  tileNonce,
  onOpenTask,
  onOpenTileBrowser,
  onDeleteTask,
  onRefreshTiles,
}: PreviewPageProps) {
  return (
    <div className="page-surface animate-in">
      <Row gutter={[16, 16]} className="page-fill-row preview-layout">
        <Col xs={24} xxl={6}>
          <div className="page-stack">
            <Card bordered={false} className="panel-card screen-card" title="任务列表">
              <Paragraph className="preview-tip">
                这里只显示已创建任务。选择后右侧会展示叠加预览，运行中任务也可以实时查看。
              </Paragraph>

              <div className="preview-list-wrap">
                {tasks.length ? (
                  <List
                    className="preview-mini-list"
                    dataSource={tasks}
                    renderItem={(task) => {
                      const status = STATUS_META[task.status]

                      return (
                        <List.Item
                          className={previewTarget === task.id ? 'preview-target active' : 'preview-target'}
                          key={task.id}
                        >
                          <div className="preview-target-main">
                            <div className="preview-target-title-row">
                              <Text strong>{task.name}</Text>
                              <Tag color={status.color}>{status.label}</Tag>
                            </div>
                            <Text type="secondary">
                              {task.current}/{task.total} · {task.outputFormat === 'mbtiles' ? 'MBTiles' : '文件目录'}
                            </Text>
                          </div>
                          <Space wrap>
                            <Button
                              size="small"
                              type={previewTarget === task.id ? 'primary' : 'default'}
                              onClick={() => onOpenTask(task)}
                            >
                              查看
                            </Button>
                            <Popconfirm
                              cancelText="取消"
                              okText="删除"
                              title="确认删除这个任务吗？"
                              description="会移除任务记录，并清理当前任务输出文件。"
                              onConfirm={() => void onDeleteTask(task.id)}
                            >
                              <Button
                                danger
                                icon={<DeleteOutlined />}
                                loading={deletingTaskId === task.id}
                                size="small"
                              />
                            </Popconfirm>
                          </Space>
                        </List.Item>
                      )
                    }}
                  />
                ) : (
                  <Empty description="还没有可预览的任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </div>
            </Card>

            {selectedTask ? (
              <Card bordered={false} className="panel-card screen-card compact-card" title="任务摘要">
                <div className="status-grid compact-status-grid">
                  <div className="status-box">
                    <span>任务状态</span>
                    <strong className="small">{STATUS_META[selectedTask.status].label}</strong>
                  </div>
                  <div className="status-box">
                    <span>抓取进度</span>
                    <strong className="small">
                      {selectedTask.current}/{selectedTask.total}
                    </strong>
                  </div>
                  <div className="status-box">
                    <span>输出格式</span>
                    <strong className="small">
                      {selectedTask.outputFormat === 'mbtiles' ? 'MBTiles' : '文件目录'}
                    </strong>
                  </div>
                </div>

                <div className="preview-summary-actions">
                  <Button icon={<PictureOutlined />} onClick={() => onOpenTileBrowser(selectedTask)}>
                    打开瓦片浏览器
                  </Button>
                </div>
              </Card>
            ) : null}
          </div>
        </Col>

        <Col xs={24} xxl={18}>
          <Card
            bordered={false}
            className="panel-card screen-card preview-card"
            title={selectedTask ? `地图预览 / ${selectedTask.name}` : '地图预览'}
            extra={
              <Space>
                <Tag color="blue">叠加预览</Tag>
                <Button icon={<ReloadOutlined />} onClick={onRefreshTiles}>
                  刷新瓦片
                </Button>
              </Space>
            }
          >
            <Paragraph className="preview-tip">{previewTips}</Paragraph>
            <div className="preview-map-stage">
              <CesiumPreview
                geoJSON={previewGeoJSON}
                mode={selectedTask?.previewable ? previewMode : 'source'}
                task={selectedTask}
                tileNonce={tileNonce}
              />
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
