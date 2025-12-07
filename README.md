# 轨迹可视化应用

基于 Flask 和 Parquet 数据的轨迹可视化应用，支持密接关系分析和可视化。

## 🚀 快速部署到 Railway

### 方法 1：通过 GitHub 自动部署（推荐）

1. **将代码推送到 GitHub**
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **连接 Railway**
   - 访问 [Railway.app](https://railway.app)
   - 使用 GitHub 账号登录
   - 点击 "New Project" → "Deploy from GitHub repo"
   - 选择你的仓库

3. **完成**
   - Railway 会自动检测 Python 项目（通过 `requirements.txt`）
   - 使用 Nixpacks 自动构建和部署
   - 部署完成后会提供 URL（如：`https://your-app.railway.app`）
   - 每次推送到 GitHub 会自动重新部署

### 方法 2：使用 GitHub Actions 自动部署

1. **获取 Railway Token**
   - 访问 Railway Dashboard → Account Settings → Tokens
   - 创建新 Token

2. **配置 GitHub Secrets**
   - 在 GitHub 仓库：Settings → Secrets and variables → Actions
   - 添加 Secret：`RAILWAY_TOKEN`

3. **推送代码**
   ```bash
   git push origin main
   ```

## 📁 项目结构

```
.
├── api/                    # Flask 后端
│   ├── app.py             # 主应用文件
│   ├── parquet_loader.py  # Parquet 数据加载器
│   └── trajectory_parquet/ # Parquet 数据文件
├── js/                     # 前端 JavaScript
├── index.html              # 前端页面
├── requirements.txt        # Python 依赖
└── railway.json            # Railway 配置
```

## 🔧 环境变量

Railway 会自动设置以下环境变量，也可以手动配置：

- `DATA_SOURCE=parquet` - 数据源类型
- `FLASK_ENV=production` - Flask 环境
- `PORT=5000` - 端口（Railway 会自动设置）

## 📦 本地开发

### 直接运行

```bash
# 安装依赖
pip install -r requirements.txt

# 运行应用
cd api
python app.py
```

## 📊 数据文件

Parquet 数据文件位于 `api/trajectory_parquet/` 目录下，包含：
- `contacts/` - 直接密接数据
- `contacts2/` - 间接密接数据

## 🔗 API 端点

- `GET /api/timestamps` - 获取所有时间戳
- `GET /api/contacts/<timestamp>` - 获取指定时间戳的密接数据
- `GET /api/bounds` - 获取地理边界
- `GET /api/user/<user_id>/contacts` - 获取用户直接密接
- `GET /api/user/<user_id>/secondary-contacts` - 获取用户次密接
- `GET /api/trajectory/<id1>/<id2>` - 获取两个用户之间的轨迹

## 📝 注意事项

- 数据文件需要包含在 Git 仓库中（或使用 Git LFS）
- Railway 免费额度：$5/月
- 应用会自动启用 HTTPS

## 🆘 故障排查

### 部署失败
- 检查 `requirements.txt` 依赖是否完整
- 确认 `railway.json` 配置正确
- 查看 Railway 部署日志

### 数据加载失败
- 确认 `api/trajectory_parquet/` 目录存在
- 检查 Parquet 文件格式是否正确
- 查看应用日志

## 📚 相关资源

- [Railway 文档](https://docs.railway.app)
- [Flask 文档](https://flask.palletsprojects.com/)
- [PyArrow 文档](https://arrow.apache.org/docs/python/)

