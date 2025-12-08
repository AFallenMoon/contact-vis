# 传染病密接轨迹可视化系统

基于 Flask 和 Parquet 数据的轨迹可视化应用，支持密接关系分析和可视化。通过交互式地图展示用户之间的接触轨迹和密接关系，提供时间维度的动态分析和轨迹追踪功能，帮助用户直观理解密接关系的时空分布特征。

[https://afallenmoon.github.io/contact-vis](https://afallenmoon.github.io/contact-vis)

## ✨ 功能特性

- 🗺️ **地图可视化**：支持标记点和热力图两种可视化模式
- ⏱️ **时间轴动画**：按时间戳动态展示密接关系变化
- 🔍 **密接查询**：支持按用户 ID 查询直接密接和次密接
- 📊 **轨迹分析**：可视化两个用户之间的接触轨迹
- 💾 **数据缓存**：前端缓存机制减少 API 调用
- 🚀 **Serverless 架构**：前后端分离，自动扩展

## 🛠️ 技术栈

- **前端**：原生 JavaScript (ES6+)、Leaflet、Tailwind CSS
- **后端**：Flask、PyArrow
- **数据存储**：Parquet 文件格式
- **部署**：GitHub Pages + 阿里云函数计算

## 📁 项目结构

```
.
├── api/                    # 后端
│   ├── app.py              # Flask 应用主文件
│   ├── parquet_loader.py   # Parquet 数据加载器
│   └── trajectory_parquet/ # Parquet 数据文件目录
├── js/                     # 前端
│   ├── cache-manager.js    # 缓存管理器
│   ├── data-loader.js      # 数据加载器
│   ├── config.js           # 配置管理
│   ├── app.js              # 应用主逻辑
│   ├── visualization.js    # 可视化模块
│   └── visualization-trajectory.js  # 轨迹可视化模块
├── index.html              # 前端入口页面
├── requirements.txt        # Python 依赖列表
└── README.md              # 项目文档
```

## 🎯 核心功能

### 地图导览视图

- 时间轴滑块控制，动态展示不同时间戳的密接关系
- 支持标记点和热力图两种可视化模式切换
- 播放/暂停动画，支持倍速播放（1x、2x、5x、10x）
- 显示新增密接列表，支持查看轨迹明细

### 密接查询视图

- 输入用户 ID 查询该用户的所有密接和次密接记录
- 地图上标记所有接触点位置
- 点击密接记录查看两个用户之间的接触轨迹
- 轨迹地图显示起点、终点和中间停留点

### 轨迹可视化

- 在地图上绘制两个用户之间的接触轨迹
- 起点标记（红色）、终点标记（绿色）、中间点标记（蓝色）
- 轨迹列表显示所有接触位置和时间戳
- 支持在查询视图和总览视图中查看轨迹

## 🔗 API 端点

- `GET /api/timestamps` - 获取所有时间戳
- `GET /api/contacts/<timestamp>` - 获取指定时间戳的密接数据
- `GET /api/bounds` - 获取地理边界
- `GET /api/user/<user_id>/contacts` - 获取用户直接密接
- `GET /api/user/<user_id>/secondary-contacts` - 获取用户次密接
- `GET /api/trajectory/<id1>/<id2>` - 获取两个用户之间的轨迹

## 🚀 快速开始

### 本地开发

1. **安装依赖**：
```bash
pip install -r requirements.txt
```

2. **启动后端**：
```bash
cd api
python app.py
```

3. **启动前端**：
使用任意 HTTP 服务器打开 `index.html`，例如：
```bash
python -m http.server 8000
```

4. **访问应用**：
打开浏览器访问 `http://localhost:8000`

### 部署

项目采用前后端分离架构：
- **前端**：部署到 GitHub Pages
- **后端**：部署到阿里云函数计算

详细部署步骤请参考项目中的部署文档。

## 🆘 常见问题

**前端无法连接后端**：
- 检查 API 地址配置是否正确
- 确认后端服务已启动并可访问
- 检查浏览器控制台的 CORS 错误

**地图不显示**：
- 检查网络连接，确保可以访问地图瓦片服务
- 检查浏览器控制台是否有错误信息

**数据加载失败**：
- 确认 Parquet 数据文件路径正确
- 检查后端日志查看详细错误信息

## 📝 许可证

本项目仅供学习和研究使用。
