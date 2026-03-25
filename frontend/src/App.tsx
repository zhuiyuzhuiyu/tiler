import { Alert, Badge, Button, Layout, Menu, Space, Spin, Tag, Typography } from 'antd'
import {
  CloudServerOutlined,
  ControlOutlined,
  DashboardOutlined,
  PictureOutlined,
  RadarChartOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useEffect, useState } from 'react'
import DashboardPage from './pages/DashboardPage'
import PreviewPage from './pages/PreviewPage'
import TasksPage from './pages/TasksPage'
import TileBrowserPage from './pages/TileBrowserPage'
import { PAGE_META, PATH_TO_VIEW, VIEW_TO_PATH, type AdminView } from './viewConfig'
import { useConsoleState } from './useConsoleState'
import CommandMenu from './components/CommandMenu'
import './App.css'

const { Header, Sider, Content } = Layout
const { Title, Paragraph } = Typography

function getViewFromPath(pathname: string): AdminView {
  return PATH_TO_VIEW[pathname] || 'dashboard'
}

export default function App() {
  const {
    form,
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
    handleResetDefaults,
    handleApplyPreset,
    handleSubmit,
    handleTaskAction,
    handleDeleteTask,
    openTaskPreview,
    refreshTiles,
  } = useConsoleState()

  const [activeView, setActiveView] = useState<AdminView>(() => getViewFromPath(window.location.pathname))
  const [commandOpen, setCommandOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandOpen((prev) => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const normalizedView = getViewFromPath(window.location.pathname)
    const normalizedPath = VIEW_TO_PATH[normalizedView]
    if (window.location.pathname !== normalizedPath) {
      window.history.replaceState({}, '', normalizedPath)
    }
    setActiveView(normalizedView)

    const handlePopState = () => {
      setActiveView(getViewFromPath(window.location.pathname))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function navigate(view: AdminView) {
    const path = VIEW_TO_PATH[view]
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
    setActiveView(view)
  }

  async function handleCreateTask(values: Parameters<typeof handleSubmit>[0]) {
    const task = await handleSubmit(values)
    if (task) {
      navigate('tasks')
    }
    return task
  }

  function handleOpenTaskPreview(task: (typeof tasks)[number]) {
    openTaskPreview(task)
    navigate('preview')
  }

  function handleOpenTaskTileBrowser(task: (typeof tasks)[number]) {
    openTaskPreview(task)
    navigate('tileBrowser')
  }

  const activePage = PAGE_META[activeView]

  if (loadingBootstrap) {
    return (
      <div className="page-loading">
        {contextHolder}
        <Spin size="large" tip="正在加载任务控制台..." />
      </div>
    )
  }

  return (
    <Layout className="admin-shell">
      {contextHolder}

      <Sider breakpoint="lg" collapsedWidth={0} width={248} className="admin-sider">
        <div className="brand-block">
          <div className="brand-mark">T</div>
          <div>
            <div className="brand-title">瓦片抓取后台</div>
            <div className="brand-subtitle">任务调度与瓦片预览控制台</div>
          </div>
        </div>

        <Menu
          className="admin-menu"
          selectedKeys={[activeView]}
          items={[
            { key: 'dashboard', icon: <DashboardOutlined />, label: '运行概览' },
            { key: 'tasks', icon: <ControlOutlined />, label: '任务管理' },
            { key: 'preview', icon: <RadarChartOutlined />, label: '地图预览' },
            { key: 'tileBrowser', icon: <PictureOutlined />, label: '瓦片浏览器' },
          ]}
          mode="inline"
          theme="dark"
          onClick={({ key }) => navigate(key as AdminView)}
        />

        <div className="sider-panel">
          <div className="sider-panel-title">服务状态</div>
          <div className="sider-status-row">
            <Badge status={serverError ? 'error' : 'success'} text={serverError ? '连接异常' : '服务在线'} />
          </div>
          <div className="sider-stat-grid">
            <div className="sider-stat-box">
              <span>运行中</span>
              <strong>{runningCount}</strong>
            </div>
            <div className="sider-stat-box">
              <span>已暂停</span>
              <strong>{pausedCount}</strong>
            </div>
            <div className="sider-stat-box">
              <span>已完成</span>
              <strong>{completedCount}</strong>
            </div>
            <div className="sider-stat-box">
              <span>失败</span>
              <strong>{failedCount}</strong>
            </div>
          </div>
        </div>
      </Sider>

      <Layout className="admin-main">
        <Header className="admin-header">
          <div className="header-copy">
            <Title level={3}>{activePage.title}</Title>
            <Paragraph>{activePage.description}</Paragraph>
          </div>

          <Space wrap>
            <Button
              icon={<PictureOutlined />}
              disabled={!selectedTask}
              onClick={() => selectedTask && handleOpenTaskTileBrowser(selectedTask)}
            >
              瓦片浏览器
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void handleResetDefaults()}>
              恢复默认
            </Button>
            <Button icon={<ReloadOutlined />} onClick={refreshTiles}>
              刷新视图
            </Button>
            <Tag color={serverError ? 'error' : 'processing'} icon={<CloudServerOutlined />}>
              {serverError ? '接口异常' : '接口正常'}
            </Tag>
          </Space>
        </Header>

        <Content className="admin-content">
          {serverError ? <Alert banner className="page-alert" message={serverError} showIcon type="warning" /> : null}

          {activeView === 'dashboard' ? (
            <DashboardPage
              completedCount={completedCount}
              currentTiles={currentTiles}
              failedCount={failedCount}
              pausedCount={pausedCount}
              runningCount={runningCount}
              successTiles={successTiles}
              tasks={tasks}
              loading={loadingBootstrap}
              onOpenPreview={() => navigate('preview')}
              onOpenTasks={() => navigate('tasks')}
              onPreviewTask={handleOpenTaskPreview}
            />
          ) : null}

          {activeView === 'tasks' ? (
            <TasksPage
              bootstrap={bootstrap}
              deletingTaskId={deletingTaskId}
              form={form}
              previewTarget={previewTarget}
              submitting={submitting}
              tasks={tasks}
              onApplyPreset={handleApplyPreset}
              onDeleteTask={handleDeleteTask}
              onOpenTileBrowser={handleOpenTaskTileBrowser}
              onPreviewTask={handleOpenTaskPreview}
              onSubmit={handleCreateTask}
              onTaskAction={handleTaskAction}
            />
          ) : null}

          {activeView === 'preview' ? (
            <PreviewPage
              deletingTaskId={deletingTaskId}
              previewGeoJSON={previewGeoJSON}
              previewMode={previewMode}
              previewTarget={previewTarget}
              previewTips={previewTips}
              selectedTask={selectedTask}
              tasks={tasks}
              tileNonce={tileNonce}
              onDeleteTask={handleDeleteTask}
              onOpenTask={handleOpenTaskPreview}
              onOpenTileBrowser={handleOpenTaskTileBrowser}
              onRefreshTiles={refreshTiles}
            />
          ) : null}

          {activeView === 'tileBrowser' ? (
            <TileBrowserPage
              previewTarget={previewTarget}
              selectedTask={selectedTask}
              tasks={tasks}
              tileNonce={tileNonce}
              onOpenTask={handleOpenTaskTileBrowser}
            />
          ) : null}
        </Content>
      </Layout>

      <CommandMenu
        open={commandOpen}
        selectedTask={selectedTask}
        tasks={tasks}
        onClose={() => setCommandOpen(false)}
        onNavigate={navigate}
        onOpenPreview={handleOpenTaskPreview}
        onOpenTileBrowser={handleOpenTaskTileBrowser}
        onRefreshTiles={refreshTiles}
      />
    </Layout>
  )
}
