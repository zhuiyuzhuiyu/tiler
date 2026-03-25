import { Button, Card, Col, Empty, List, Progress, Row, Skeleton, Space, Statistic, Tag, Typography } from 'antd'
import { PlusOutlined, RadarChartOutlined } from '@ant-design/icons'
import type { TaskSnapshot } from '../types'
import { formatTime } from '../consoleUtils'
import { STATUS_META } from '../viewConfig'

const { Text } = Typography

interface DashboardPageProps {
  tasks: TaskSnapshot[]
  runningCount: number
  pausedCount: number
  completedCount: number
  failedCount: number
  successTiles: number
  currentTiles: number
  onOpenTasks: () => void
  onOpenPreview: () => void
  onPreviewTask: (task: TaskSnapshot) => void
  loading?: boolean
}

export default function DashboardPage({
  tasks,
  runningCount,
  pausedCount,
  completedCount,
  failedCount,
  successTiles,
  currentTiles,
  onOpenTasks,
  onOpenPreview,
  onPreviewTask,
  loading = false,
}: DashboardPageProps) {
  const recentTasks = tasks.slice(0, 5)

  return (
    <div className="page-surface dashboard-page animate-in">
      <Row gutter={[24, 24]} className="summary-row">
        {[1, 2, 3, 4].map((i) => (
          <Col key={i} xs={24} sm={12} xl={6}>
            <Card className="summary-card" bordered={false}>
              <Skeleton active loading={loading} paragraph={{ rows: 1 }}>
                {i === 1 && <Statistic title="任务总数" value={tasks.length} />}
                {i === 2 && <Statistic title="抓取中任务" value={runningCount} />}
                {i === 3 && <Statistic title="已抓取瓦片" value={currentTiles} />}
                {i === 4 && <Statistic title="成功写入瓦片" value={successTiles} />}
              </Skeleton>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[24, 24]} className="page-fill-row">
        <Col xs={24} xl={8}>
          <Card bordered={false} className="panel-card screen-card" title="运行状态">
            <Skeleton active loading={loading} paragraph={{ rows: 4 }}>
              <div className="status-grid">
                <div className="status-box">
                  <span>运行中</span>
                  <strong>{runningCount}</strong>
                </div>
                <div className="status-box">
                  <span>已暂停</span>
                  <strong>{pausedCount}</strong>
                </div>
                <div className="status-box">
                  <span>已完成</span>
                  <strong>{completedCount}</strong>
                </div>
                <div className="status-box">
                  <span>失败任务</span>
                  <strong>{failedCount}</strong>
                </div>
              </div>

              <div className="quick-actions">
                <Button block icon={<PlusOutlined />} onClick={onOpenTasks}>
                  去创建新任务
                </Button>
                <Button block icon={<RadarChartOutlined />} onClick={onOpenPreview}>
                  去看地图预览
                </Button>
              </div>
            </Skeleton>
          </Card>
        </Col>

        <Col xs={24} xl={16}>
          <Card
            bordered={false}
            className="panel-card screen-card"
            title="最近任务"
            extra={<Text type="secondary">最近 5 条</Text>}
          >
            <Skeleton active loading={loading} paragraph={{ rows: 6 }}>
              {recentTasks.length ? (
              <List
                dataSource={recentTasks}
                itemLayout="vertical"
                renderItem={(task) => {
                  const status = STATUS_META[task.status]
                  return (
                    <List.Item className="task-item" key={task.id}>
                      <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        <Space align="center" size={10} wrap>
                          <Text strong>{task.name}</Text>
                          <Tag color={status.color}>{status.label}</Tag>
                          <Text type="secondary">
                            {task.outputFormat === 'mbtiles' ? 'MBTiles' : '文件目录'}
                          </Text>
                        </Space>

                        <Progress percent={Number(task.progress.toFixed(1))} size="small" />

                        <Space size={[12, 6]} wrap>
                          <Text type="secondary">
                            进度: {task.current}/{task.total}
                          </Text>
                          <Text type="secondary">创建时间: {formatTime(task.createdAt)}</Text>
                        </Space>

                        <Space>
                          <Button size="small" onClick={() => onPreviewTask(task)}>
                            查看预览
                          </Button>
                        </Space>
                      </Space>
                    </List.Item>
                  )
                }}
              />
              ) : (
                <Empty description="还没有任务记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Skeleton>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
