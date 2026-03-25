# Tiler

[English](./README-EN.md)

> 说明：本项目后端主要基于 [atlasdatatech/tiler](https://github.com/atlasdatatech/tiler) 进行二次开发，并在此基础上补充了任务暂停/继续、Web 任务管理、地图预览、瓦片浏览器、单瓦片重试和一键启动脚本等能力。感谢原项目作者的开源工作。

`Tiler` 是一个面向影像瓦片抓取与管理的下载工具，支持通过 GeoJSON 范围分级抓取地图瓦片，并提供 Web 控制台用于任务创建、进度查看、地图叠加预览和单瓦片浏览。

当前项目同时支持两种使用方式：

- Web 控制台模式：创建任务、暂停/继续/取消、预览范围与瓦片
- CLI 模式：按 `conf.toml` 直接执行一个默认任务

## 功能特性

- 支持自定义瓦片 URL 模板
- 支持按不同缩放级别配置不同 GeoJSON 抓取范围
- 支持图片瓦片和 PBF 矢量瓦片
- 支持文件目录与 MBTiles 两种输出格式
- 支持任务状态持久化与恢复
- 支持任务暂停、继续、取消、删除
- 支持地图叠加预览
- 支持瓦片浏览器按 `Z / X / Y` 树结构查看已落盘瓦片
- 支持单瓦片失败自动重试

## 技术栈

- 后端：Go
- 前端：React 19 + TypeScript + Vite + Ant Design + Cesium
- 数据存储：SQLite（任务状态 / MBTiles）

## 目录结构

```text
.
├─ frontend/          Web 控制台前端
├─ geojson/           示例范围文件
├─ output/            默认输出目录
├─ conf.toml          默认配置文件
├─ main.go            程序入口
├─ server.go          Web 服务与 API
├─ task.go            任务执行与下载逻辑
└─ tile_browser.go    瓦片树与单瓦片浏览逻辑
```

## 环境要求

- Go 1.24 或更高版本
- Node.js 18 或更高版本
- npm 9 或更高版本

## 快速开始

### 1. 安装前端依赖

```bash
cd frontend
npm install
```

### 2. 构建前端

```bash
cd frontend
npm run build
```

构建完成后，Go 服务会直接托管 `frontend/dist`。

### 3. 启动 Web 控制台

在项目根目录执行：

```bash
go run . -c conf.toml -serve
```

如果你在 Windows 上想一键启动，可以直接运行：

```powershell
.\start.bat
```

或者：

```powershell
.\start.ps1
```

脚本会自动完成以下步骤：

- 检查前端依赖
- 自动构建前端
- 启动 Go 服务
- 默认自动打开浏览器

默认监听地址为：

```text
http://127.0.0.1:8080
```

如果需要自定义地址：

```bash
go run . -c conf.toml -serve -addr :9090
```

### 4. 使用 CLI 模式执行默认任务

```bash
go run . -c conf.toml -serve=false
```

CLI 模式会读取 `conf.toml` 中的默认任务配置并直接开始抓取。

## 配置说明

项目默认配置文件为 `conf.toml`。

### 输出配置

```toml
[output]
format = "file"        # file 或 mbtiles
directory = "output"   # 输出目录
```

### 任务配置

```toml
[task]
workers = 3            # 并发抓取数
savepipe = 1           # 保存队列并发
timedelay = 50         # 请求间隔（毫秒）
retrycount = 2         # 单瓦片失败后的重试次数
retrydelay = 1000      # 重试间隔（毫秒）
```

### 默认地图源配置

```toml
[tm]
name = "google satelite"
min = 0
max = 11
format = "jpg"         # jpg / png / webp / pbf
schema = "xyz"         # xyz / tms
url = "https://..."
json = ""
```

### 分级抓取范围

```toml
[[lrs]]
min = 0
max = 5
geojson = "./geojson/global.geojson"

[[lrs]]
min = 6
max = 8
geojson = "./geojson/china.geojson"
```

含义是：

- `0-5` 级使用 `global.geojson`
- `6-8` 级使用 `china.geojson`

这样可以在低层级抓大范围、高层级抓小范围，减少无效下载。

## 瓦片 URL 模板

支持以下占位符：

- `{z}`：缩放级别
- `{x}`：列号
- `{y}`：行号
- `{-y}`：TMS 反转行号
- `{s}`：子域名占位符，当前会替换为 `a`

示例：

```text
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

## Web 控制台说明

启动服务后可以使用以下页面：

- 运行概览：查看任务统计和整体状态
- 任务管理：创建任务、维护分级规则、管理任务生命周期
- 地图预览：查看任务范围和叠加预览效果
- 瓦片浏览器：按 `Z / X / Y` 浏览已保存的瓦片，并查看单张图片

说明：

- 地图预览默认使用“叠加预览”
- 瓦片浏览器展示的是“已经写入本地目录或 MBTiles 的瓦片”
- 运行中任务也可以浏览，但要等对应瓦片实际落盘后才会在树里出现

## 输出格式

### 文件目录

输出结构类似：

```text
output/task-name-z0-11.xxxxx/
├─ 0/
├─ 1/
└─ ...
```

### MBTiles

输出为单个 `.mbtiles` 文件，便于后续发布或导入其他 GIS / 地图服务。

## 失败重试机制

当前版本已经加入单瓦片自动重试：

- 首次下载失败后自动重试
- 默认额外重试 2 次
- 默认每次重试间隔 1000ms

只有在所有重试都失败后，该瓦片才会记入任务失败数。

## 常见开发命令

### 前端开发

```bash
cd frontend
npm run dev
```

### 前端生产构建

```bash
cd frontend
npm run build
```

### 后端编译

```bash
go build .
```

注意：如果使用 `go build ./...`，可能会扫到 `frontend/node_modules` 中的第三方示例 Go 文件，建议在本项目中直接使用 `go build .`。

## 适用场景

- 离线地图数据准备
- 指定行政区范围瓦片抓取
- 分级瓦片缓存构建
- MBTiles 数据打包
- 瓦片源测试与校验

## 免责声明

请确保你抓取和使用的地图服务符合对应服务商的协议、授权与访问限制。项目本身不提供第三方地图资源授权。
