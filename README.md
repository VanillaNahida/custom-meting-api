# Custom Meting API

基于服务器时间的自定义MetingJS兼容歌单列表推送服务

## 功能特性

- 根据服务器时间自动切换日间/夜间歌单
- 支持常见的音频文件格式（MP3, FLAC, OGG, WAV, M4A, AAC, OPUS）
- 自动扫描并读取歌曲内嵌封面或同名图像文件
- 支持LRC歌词文件
- 歌单缓存机制
- PM2进程管理
- MeteingJS兼容的JSON输出格式
- 详细的请求日志（支持CDN来源IP解析
- 基于外部配置的URL构建完整资源链接

## 目录结构

```
custom-meting-api/
├── app.js                    # 主服务器文件
├── config.js                 # 配置文件
├── package.json              # 项目配置
├── ecosystem.config.js       # PM2配置文件
├── cma.sh                    # 统一管理脚本
├── .env.example              # 环境变量示例
├── playlist/                 # 歌单目录
│   ├── daytime/              # 日间歌单
│   │   ├── song1.mp3
│   │   ├── song1.lrc
│   │   └── song1.jpg         # 封面
│   └── night/                # 夜间歌单
│       ├── song2.mp3
│       └── song2.lrc
└── logs/                     # 日志目录
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，根据需要修改配置。

### 3. 添加歌曲

将音乐文件放入对应的歌单文件夹：

- `playlist/daytime/` - 日间时段播放的歌单（默认6:00-22:00）
- `playlist/night/` - 夜间时段播放的歌单（默认22:00-6:00）

支持的文件格式：`.mp3`, `.flac`, `.ogg`, `.wav`, `.m4a`, `.aac`, `.opus`

### 4. 添加歌词（可选）

创建与歌曲同名的 `.lrc` 文件，例如：

```
playlist/daytime/song1.mp3
playlist/daytime/song1.lrc
```

### 5. 添加封面（可选）

创建与歌曲同名的图像文件，支持：`.jpg`, `.jpeg`, `.png`, `.webp`

或者直接使用歌曲内嵌的封面。

## 配置说明

### 配置文件 (config.js)

所有以 `env.` 开头的配置项会从环境变量读取。

### 环境变量 (.env)

```env
# 服务端口和地址
PORT=9527
BIND_IP=0.0.0.0

# 外部访问 URL（用于构建完整的资源链接，例如：http://your-domain.com 或 http://192.168.1.100:9527
# 如果不配置此选项，返回的URL会是相对路径
EXTERNAL_URL=http://localhost:9527

# 歌单配置
PLAYLIST_BASE_DIR=./playlist
DAYTIME_FOLDER=daytime
NIGHT_FOLDER=night

# 时段配置
DAYTIME_START_HOUR=6
DAYTIME_END_HOUR=22
NIGHT_START_HOUR=22
NIGHT_END_HOUR=6

# 缓存配置
CACHE_ENABLED=true
CACHE_MAX_AGE=3600
```

## API接口

### 获取歌单

```
GET /api/playlist
```

返回MetingJS兼容的JSON格式：

```json
{
  "success": true,
  "period": "daytime",
  "folder": "daytime",
  "currentTime": "2024-01-01T12:00:00.000Z",
  "updateTime": "2024-01-01T12:00:00.000Z",
  "data": [
    {
      "name": "歌曲名称",
      "artist": "歌手名称",
      "url": "http://your-domain.com/daytime/song.mp3",
      "pic": "http://your-domain.com/daytime/song.jpg",
      "lrc": "[00:00.00]歌词内容"
    }
  ]
}
```

### 获取服务状态

```
GET /api/status
```

### 刷新歌单缓存

```
POST /api/refresh
```

## 开发模式

```bash
npm run dev
```

使用 `nodemon` 自动重启服务。

## 生产环境管理

### 安装PM2（首次）

```bash
npm install -g pm2
```

所有管理操作通过 `cma.sh` 统一管理脚本完成：

| 命令 | 说明 |
|------|------|
| `./cma.sh start` | 启动服务（自动创建目录、清理旧实例） |
| `./cma.sh stop` | 停止服务 |
| `./cma.sh restart` | 重启服务 |
| `./cma.sh status` | 查看服务状态 |
| `./cma.sh log` | 查看最近日志（默认100行） |
| `./cma.sh log -f` | 实时查看日志 |
| `./cma.sh log --err` | 查看错误日志 |
| `./cma.sh monit` | 进入PM2监控面板 |
| `./cma.sh clean` | 清理日志 |
| `./cma.sh chmod` | 修复 `playlist/`、`data/`、`assets/` 目录权限 |

若无法执行脚本，请允许执行权限：

```bash
chmod +x cma.sh
```

### 权限修复

在 Linux 服务器上如果遇到文件写入权限问题（如封面提取失败），运行：

```bash
# 普通用户
./cma.sh chmod

# 权限不足时
sudo ./cma.sh chmod
```