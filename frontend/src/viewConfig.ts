import type { TaskSnapshot } from './types'

export type PreviewMode = 'overlay' | 'source' | 'local'
export type AdminView = 'dashboard' | 'tasks' | 'preview' | 'tileBrowser'

export const STATUS_META: Record<TaskSnapshot['status'], { color: string; label: string }> = {
  queued: { color: 'gold', label: '排队中' },
  running: { color: 'processing', label: '抓取中' },
  paused: { color: 'orange', label: '已暂停' },
  completed: { color: 'success', label: '已完成' },
  canceled: { color: 'default', label: '已取消' },
  failed: { color: 'error', label: '失败' },
}

export const PAGE_META: Record<AdminView, { title: string; description: string }> = {
  dashboard: {
    title: '运行概览',
    description: '查看任务总览、抓取进度和最近任务动态。',
  },
  tasks: {
    title: '任务管理',
    description: '创建抓取任务，并管理暂停、继续、取消和删除。',
  },
  preview: {
    title: '地图预览',
    description: '查看任务范围与源图叠加后的效果。',
  },
  tileBrowser: {
    title: '瓦片浏览器',
    description: '按 Z / X / Y 树结构浏览任务瓦片，并查看单张图片。',
  },
}

export const VIEW_TO_PATH: Record<AdminView, string> = {
  dashboard: '/dashboard',
  tasks: '/tasks',
  preview: '/preview',
  tileBrowser: '/tile-browser',
}

export const PATH_TO_VIEW: Record<string, AdminView> = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/tasks': 'tasks',
  '/preview': 'preview',
  '/tile-browser': 'tileBrowser',
}
