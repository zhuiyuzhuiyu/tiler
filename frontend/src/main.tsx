import React from 'react'
import ReactDOM from 'react-dom/client'
import { App as AntdApp, ConfigProvider } from 'antd'
import 'antd/dist/reset.css'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 12,
          colorPrimary: '#1677ff',
          colorSuccess: '#23b26d',
          colorWarning: '#ff9f1a',
          colorError: '#ff5d5d',
          colorBgLayout: '#f3f5f7',
          colorBgContainer: '#ffffff',
          colorText: '#0f172a',
          colorBorderSecondary: '#e5e7eb',
          fontFamily: '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Layout: {
            bodyBg: '#f3f5f7',
            headerBg: '#f3f5f7',
            siderBg: '#111827',
          },
          Menu: {
            darkItemBg: '#111827',
            darkSubMenuItemBg: '#111827',
            darkItemSelectedBg: '#1677ff',
            itemBorderRadius: 10,
          },
          Card: {
            headerBg: '#ffffff',
          },
        },
      }}
    >
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
)
