import React, { useEffect, useRef, useState } from 'react'
import { ControlOutlined, DashboardOutlined, PictureOutlined, RadarChartOutlined, SearchOutlined } from '@ant-design/icons'
import { Input, List, Modal, Space, Typography } from 'antd'
import type { TaskSnapshot } from '../types'
import type { AdminView } from '../viewConfig'

const { Text } = Typography

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <span
    style={{
      padding: '2px 6px',
      fontSize: '11px',
      fontWeight: 600,
      color: '#64748b',
      background: '#f1f5f9',
      border: '1px solid #e2e8f0',
      borderRadius: '4px',
      boxShadow: '0 1px 0 rgba(0,0,0,0.1)',
      marginLeft: 'auto',
    }}
  >
    {children}
  </span>
)

interface CommandMenuProps {
  open: boolean
  onClose: () => void
  onNavigate: (view: AdminView) => void
  tasks: TaskSnapshot[]
  selectedTask: TaskSnapshot | null
  onOpenPreview: (task: TaskSnapshot) => void
  onOpenTileBrowser: (task: TaskSnapshot) => void
  onRefreshTiles: () => void
}

export default function CommandMenu({
  open,
  onClose,
  onNavigate,
  tasks,
  selectedTask,
  onOpenPreview,
  onOpenTileBrowser,
  onRefreshTiles,
}: CommandMenuProps) {
  const [search, setSearch] = useState('')
  const inputRef = useRef<any>(null)

  useEffect(() => {
    if (open && inputRef.current) {
      window.setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      setSearch('')
    }
  }, [open])

  const menuItems = [
    { key: 'dashboard', label: '运行概览', icon: <DashboardOutlined />, type: 'nav' as const },
    { key: 'tasks', label: '任务管理', icon: <ControlOutlined />, type: 'nav' as const },
    { key: 'preview', label: '地图预览', icon: <RadarChartOutlined />, type: 'nav' as const },
    { key: 'tileBrowser', label: '瓦片浏览器', icon: <PictureOutlined />, type: 'nav' as const },
  ]

  const quickActions = selectedTask
    ? [
        {
          key: `preview-${selectedTask.id}`,
          label: `预览 ${selectedTask.name}`,
          icon: <RadarChartOutlined />,
          action: () => onOpenPreview(selectedTask),
        },
        {
          key: `browser-${selectedTask.id}`,
          label: `浏览 ${selectedTask.name} 的瓦片`,
          icon: <PictureOutlined />,
          action: () => onOpenTileBrowser(selectedTask),
        },
        {
          key: 'refresh-tiles',
          label: '刷新当前瓦片视图',
          icon: <SearchOutlined />,
          action: () => onRefreshTiles(),
        },
      ]
    : []

  const filteredNav = menuItems.filter((item) => item.label.toLowerCase().includes(search.toLowerCase()))
  const filteredQuickActions = quickActions.filter((item) => item.label.toLowerCase().includes(search.toLowerCase()))
  const filteredTasks = tasks.filter((task) => task.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={600}
      className="command-menu-modal"
      styles={{ body: { padding: 0 } }}
      centered
    >
      <div className="command-menu-search">
        <Input
          ref={inputRef}
          prefix={<SearchOutlined style={{ color: '#94a3b8', fontSize: 20 }} />}
          placeholder="搜索页面或任务..."
          variant="borderless"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '20px 24px', fontSize: 18 }}
        />
      </div>
      <div className="command-menu-content" style={{ maxHeight: 400, overflow: 'auto', paddingBottom: 12 }}>
        {filteredNav.length > 0 ? (
          <div className="command-section">
            <div className="command-section-title">页面导航</div>
            <List
              dataSource={filteredNav}
              renderItem={(item) => (
                <div
                  className="command-item"
                  onClick={() => {
                    onNavigate(item.key as AdminView)
                    onClose()
                  }}
                >
                  <span className="command-item-icon">{item.icon}</span>
                  <span className="command-item-label">{item.label}</span>
                  <Kbd>Enter</Kbd>
                </div>
              )}
            />
          </div>
        ) : null}

        {filteredQuickActions.length > 0 ? (
          <div className="command-section">
            <div className="command-section-title">快捷操作</div>
            <List
              dataSource={filteredQuickActions}
              renderItem={(item) => (
                <div
                  className="command-item"
                  onClick={() => {
                    item.action()
                    onClose()
                  }}
                >
                  <span className="command-item-icon">{item.icon}</span>
                  <span className="command-item-label">{item.label}</span>
                  <Kbd>Enter</Kbd>
                </div>
              )}
            />
          </div>
        ) : null}

        {filteredTasks.length > 0 ? (
          <div className="command-section">
            <div className="command-section-title">任务</div>
            <List
              dataSource={filteredTasks}
              renderItem={(task) => (
                <div
                  className="command-item"
                  onClick={() => {
                    onOpenPreview(task)
                    onClose()
                  }}
                >
                  <span className="command-item-icon">
                    <ControlOutlined />
                  </span>
                  <span className="command-item-label">{task.name}</span>
                  <Text type="secondary" style={{ marginRight: 12, fontSize: '12px' }}>
                    任务
                  </Text>
                  <Kbd>Enter</Kbd>
                </div>
              )}
            />
          </div>
        ) : null}

        {!filteredNav.length && !filteredQuickActions.length && !filteredTasks.length ? (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>
            <Text type="secondary">没有找到相关结果</Text>
          </div>
        ) : null}
      </div>
      <div className="command-menu-footer">
        <Space size={16}>
          <span>
            <Text type="secondary" style={{ fontSize: '11px' }}>
              快捷键
            </Text>
          </span>
          <Space size={4}>
            <Kbd>↑↓</Kbd>
            <Text type="secondary" style={{ fontSize: '11px' }}>
              选择
            </Text>
          </Space>
          <Space size={4}>
            <Kbd>Enter</Kbd>
            <Text type="secondary" style={{ fontSize: '11px' }}>
              确认
            </Text>
          </Space>
          <Space size={4}>
            <Kbd>Esc</Kbd>
            <Text type="secondary" style={{ fontSize: '11px' }}>
              关闭
            </Text>
          </Space>
        </Space>
      </div>
    </Modal>
  )
}
