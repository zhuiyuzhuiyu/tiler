import { Alert, Empty, Image, Skeleton, Space, Tag, Tree, Typography } from 'antd'
import { FileImageOutlined, FolderOpenOutlined, PictureOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DataNode, EventDataNode } from 'antd/es/tree'
import type { TaskSnapshot, TileTreeNode } from '../types'

const { Paragraph, Text } = Typography

interface TileBrowserProps {
  task: TaskSnapshot | null
  tileNonce: number
}

interface BrowserTreeNode extends DataNode {
  key: string
  title: string
  path: string
  level: 'zoom' | 'column' | 'tile'
  isLeaf?: boolean
  tileUrl?: string
  z?: number
  x?: number
  y?: number
  children?: BrowserTreeNode[]
}

async function fetchTileTree(taskId: string, node = ''): Promise<TileTreeNode[]> {
  const response = await fetch(`/api/tasks/${taskId}/tree?node=${encodeURIComponent(node)}`)
  const payload = await response.json().catch(() => [])
  if (!response.ok) {
    throw new Error(payload?.error || '加载瓦片树失败')
  }
  return payload as TileTreeNode[]
}

function iconForLevel(level: BrowserTreeNode['level']) {
  switch (level) {
    case 'tile':
      return <FileImageOutlined />
    case 'column':
      return <PictureOutlined />
    default:
      return <FolderOpenOutlined />
  }
}

function mapNodes(nodes: TileTreeNode[]): BrowserTreeNode[] {
  return nodes.map((node) => ({
    key: node.key,
    title: node.title,
    path: node.key,
    level: node.level,
    isLeaf: node.isLeaf,
    tileUrl: node.tileUrl,
    z: node.z,
    x: node.x,
    y: node.y,
    icon: iconForLevel(node.level),
  }))
}

function replaceChildren(treeData: BrowserTreeNode[], key: string, children: BrowserTreeNode[]): BrowserTreeNode[] {
  return treeData.map((node) => {
    if (node.key === key) {
      return { ...node, children }
    }

    if (!node.children?.length) {
      return node
    }

    return {
      ...node,
      children: replaceChildren(node.children, key, children),
    }
  })
}

function findNodeByKey(treeData: BrowserTreeNode[], key: string): BrowserTreeNode | null {
  for (const node of treeData) {
    if (node.key === key) {
      return node
    }
    if (node.children?.length) {
      const match = findNodeByKey(node.children, key)
      if (match) {
        return match
      }
    }
  }
  return null
}

function explainTileTreeError(message: string, outputFormat: string) {
  if (message.includes('database is locked')) {
    return outputFormat === 'mbtiles'
      ? '当前 MBTiles 正在写入，树结构暂时读不到。重启服务后重新创建任务，就可以在抓取过程中实时浏览。'
      : '瓦片数据正在写入，树结构暂时无法读取，请稍后再试。'
  }

  return message
}

export default function TileBrowser({ task, tileNonce }: TileBrowserProps) {
  const [treeData, setTreeData] = useState<BrowserTreeNode[]>([])
  const [selectedLeaf, setSelectedLeaf] = useState<BrowserTreeNode | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  const [loadingRoot, setLoadingRoot] = useState(false)
  const [loadError, setLoadError] = useState('')
  const previousTaskIdRef = useRef('')
  const liveVersion = useMemo(
    () => `${tileNonce}-${task?.current ?? 0}-${task?.status ?? 'idle'}`,
    [task?.current, task?.status, tileNonce],
  )

  useEffect(() => {
    let canceled = false
    const taskId = task?.id ?? ''
    const taskChanged = previousTaskIdRef.current !== taskId
    previousTaskIdRef.current = taskId

    async function restoreExpandedBranches(taskIdValue: string, rootNodes: BrowserTreeNode[]) {
      const branchKeys = [...expandedKeys]
        .filter((key) => key.split('/').length <= 2)
        .sort((a, b) => a.split('/').length - b.split('/').length)

      let nextTree = rootNodes

      for (const key of branchKeys) {
        const node = findNodeByKey(nextTree, key)
        if (!node || node.isLeaf) {
          continue
        }

        try {
          const children = mapNodes(await fetchTileTree(taskIdValue, node.path))
          nextTree = replaceChildren(nextTree, key, children)
        } catch {
          continue
        }
      }

      return nextTree
    }

    async function loadRoot() {
      if (!task?.id || !task.previewable) {
        setTreeData([])
        setSelectedLeaf(null)
        setExpandedKeys([])
        setLoadError('')
        setLoadingRoot(false)
        return
      }

      setLoadingRoot(taskChanged || treeData.length === 0)
      if (taskChanged) {
        setSelectedLeaf(null)
        setExpandedKeys([])
      }

      try {
        const nodes = await fetchTileTree(task.id)
        if (!canceled) {
          const rootNodes = mapNodes(nodes)
          const nextTree = taskChanged ? rootNodes : await restoreExpandedBranches(task.id, rootNodes)
          setTreeData(nextTree)
          setLoadError('')
        }
      } catch (error) {
        if (!canceled) {
          setTreeData([])
          setLoadError(
            explainTileTreeError(error instanceof Error ? error.message : '加载瓦片树失败', task.outputFormat),
          )
        }
      } finally {
        if (!canceled) {
          setLoadingRoot(false)
        }
      }
    }

    void loadRoot()
    return () => {
      canceled = true
    }
  }, [expandedKeys, liveVersion, task?.id, task?.outputFormat, task?.previewable, treeData.length])

  useEffect(() => {
    if (!selectedLeaf) {
      return
    }

    const refreshedNode = findNodeByKey(treeData, selectedLeaf.key)
    if (refreshedNode && (refreshedNode.isLeaf || refreshedNode.level === 'tile')) {
      setSelectedLeaf(refreshedNode)
    }
  }, [selectedLeaf, treeData])

  async function handleLoadData(treeNode: EventDataNode<BrowserTreeNode>) {
    const node = treeNode as BrowserTreeNode
    if (!task?.id || node.isLeaf || node.children) {
      return
    }

    const children = mapNodes(await fetchTileTree(task.id, node.path))
    setTreeData((current) => replaceChildren(current, node.key, children))
  }

  const previewUrl = selectedLeaf?.tileUrl ? `${selectedLeaf.tileUrl}?v=${liveVersion}` : ''

  if (!task) {
    return (
      <div className="tile-browser-empty">
        <Empty description="先选择一个任务，再按 Z / X / Y 逐级浏览瓦片。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    )
  }

  if (!task.previewable) {
    return <Alert showIcon type="info" message="当前任务不是图片瓦片格式，暂时无法显示单张图片预览。" />
  }

  return (
    <div className="tile-browser-shell">
      <div className="tile-browser-pane tile-browser-tree">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            showIcon
            type={task.status === 'running' ? 'info' : 'success'}
            message={
              task.status === 'running'
                ? '任务仍在抓取中，左侧树会随着已落盘瓦片自动刷新。'
                : '当前展示的是任务已经保存下来的瓦片。'
            }
          />

          {loadError ? <Alert showIcon type="warning" message={loadError} /> : null}
          {loadError.includes('MBTiles 正在写入') ? (
            <Alert
              showIcon
              type="info"
              message="如果这是旧任务，建议重启服务后重新创建一个 MBTiles 任务，再查看运行中的实时树结构。"
            />
          ) : null}

          {loadingRoot ? (
            <Skeleton active paragraph={{ rows: 8 }} title={false} />
          ) : treeData.length ? (
            <Tree
              expandedKeys={expandedKeys}
              autoExpandParent={false}
              blockNode
              className="tile-browser-tree-widget"
              loadData={handleLoadData}
              selectedKeys={selectedLeaf ? [selectedLeaf.key] : []}
              showIcon
              showLine={{ showLeafIcon: false }}
              treeData={treeData}
              onExpand={(keys) => setExpandedKeys(keys.map((key) => String(key)))}
              onSelect={(keys) => {
                const key = String(keys[0] || '')
                const node = key ? findNodeByKey(treeData, key) : null
                setSelectedLeaf(node && (node.isLeaf || node.level === 'tile') ? node : null)
              }}
            />
          ) : (
            <Empty description="当前任务还没有可浏览的瓦片文件。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Space>
      </div>

      <div className="tile-browser-pane tile-browser-preview">
        {selectedLeaf && previewUrl ? (
          <Space direction="vertical" size={14} style={{ width: '100%', height: '100%' }}>
            <div className="tile-browser-meta">
              <Space size={[8, 8]} wrap>
                <Tag color="blue">缩放级别 Z {selectedLeaf.z}</Tag>
                <Tag color="geekblue">列号 X {selectedLeaf.x}</Tag>
                <Tag color="cyan">行号 Y {selectedLeaf.y}</Tag>
                <Tag>{task.outputFormat === 'mbtiles' ? 'MBTiles 输出' : '目录输出'}</Tag>
              </Space>
              <Paragraph className="tile-browser-copy">
                <Text code>{selectedLeaf.key}</Text>
              </Paragraph>
            </div>

            <div className="tile-image-stage">
              <Image alt={`tile-${selectedLeaf.key}`} className="tile-preview-image" preview src={previewUrl} />
            </div>
          </Space>
        ) : (
          <div className="tile-browser-empty">
            <Empty description="选择一个叶子节点后，右侧会显示对应的单张瓦片图片。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
      </div>
    </div>
  )
}
