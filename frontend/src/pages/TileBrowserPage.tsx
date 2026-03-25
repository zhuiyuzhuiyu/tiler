import { Button, Card, Col, Empty, List, Row, Space, Tag, Typography } from 'antd'
import { PictureOutlined } from '@ant-design/icons'
import TileBrowser from '../components/TileBrowser'
import type { TaskSnapshot } from '../types'
import { STATUS_META } from '../viewConfig'

const { Paragraph, Text } = Typography

interface TileBrowserPageProps {
  tasks: TaskSnapshot[]
  selectedTask: TaskSnapshot | null
  previewTarget: string
  tileNonce: number
  onOpenTask: (task: TaskSnapshot) => void
}

export default function TileBrowserPage({
  tasks,
  selectedTask,
  previewTarget,
  tileNonce,
  onOpenTask,
}: TileBrowserPageProps) {
  return (
    <div className="page-surface animate-in">
      <Row gutter={[16, 16]} className="page-fill-row tile-browser-layout">
        <Col xs={24} xxl={6}>
          <div className="page-stack">
            <Card bordered={false} className="panel-card screen-card" title="浏览任务">
              <Paragraph className="preview-tip">
                瓦片树展示的是当前已经落盘的瓦片。任务运行中也能看，但需要等瓦片实际写入后才会出现在树里。
              </Paragraph>

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
                        <Button
                          size="small"
                          type={previewTarget === task.id ? 'primary' : 'default'}
                          onClick={() => onOpenTask(task)}
                        >
                          打开
                        </Button>
                      </List.Item>
                    )
                  }}
                />
              ) : (
                <Empty description="还没有可浏览的任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>

            {selectedTask ? (
              <Card bordered={false} className="panel-card screen-card compact-card" title="当前任务">
                <div className="status-grid compact-status-grid">
                  <div className="status-box">
                    <span>任务名称</span>
                    <strong className="small">{selectedTask.name}</strong>
                  </div>
                  <div className="status-box">
                    <span>输出格式</span>
                    <strong className="small">
                      {selectedTask.outputFormat === 'mbtiles' ? 'MBTiles' : '文件目录'}
                    </strong>
                  </div>
                  <div className="status-box">
                    <span>当前进度</span>
                    <strong className="small">
                      {selectedTask.current}/{selectedTask.total}
                    </strong>
                  </div>
                </div>
              </Card>
            ) : null}
          </div>
        </Col>

        <Col xs={24} xxl={18}>
          <Card
            bordered={false}
            className="panel-card screen-card tile-browser-card"
            title={selectedTask ? `瓦片浏览器 / ${selectedTask.name}` : '瓦片浏览器'}
            extra={
              <Space>
                <PictureOutlined />
                <Text type="secondary">单张瓦片图片预览</Text>
              </Space>
            }
          >
            <TileBrowser task={selectedTask} tileNonce={tileNonce} />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
