const express = require('express');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const playlistService = require('./services/playlistService');

const app = express();

app.use(express.json());

// 配置 CORS
if (config.cors.enabled) {
  const corsOptions = {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      
      const allowed = config.cors.allowedOrigins.some(allowedOrigin => {
        if (allowedOrigin === '*') {
          return true;
        }
        if (allowedOrigin.startsWith('*.')) {
          const suffix = allowedOrigin.slice(1);
          return origin.endsWith(suffix) || origin === suffix.slice(1);
        }
        return origin === allowedOrigin;
      });
      
      if (allowed) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  };
  
  app.use(cors(corsOptions));
}

const getClientIp = (req) => {
  const headers = [
    'x-forwarded-for',
    'x-real-ip',
    'x-client-ip',
    'x-cluster-client-ip',
    'forwarded-for',
    'forwarded'
  ];

  for (const header of headers) {
    const value = req.headers[header];
    if (value) {
      const ips = value.split(/\s*,\s*/);
      const realIp = ips.find(ip => {
        return !['127.0.0.1', '::1', '::ffff:127.0.0.1', 'unknown'].includes(ip) &&
               !ip.startsWith('10.') &&
               !ip.startsWith('192.168.') &&
               !ip.startsWith('172.16.') &&
               !ip.startsWith('172.31.');
      });
      return realIp || ips[0];
    }
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
};

const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  const requestTime = new Date().toISOString();
  const clientIp = getClientIp(req);
  const method = req.method;
  const url = req.originalUrl;

  console.log(`[${requestTime}] [INFO] ${clientIp} - ${method} ${url} - 开始处理`);

  const originalJson = res.json;
  const originalSend = res.send;

  let responseData;
  const logResponse = () => {
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    const statusCode = res.statusCode;

    let responseResult = statusCode;
    if (responseData) {
      try {
        const data = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
        if (data.success !== undefined) {
          responseResult = `${statusCode} (${data.success ? 'success' : 'failed'})`;
        }
      } catch (e) {
        responseResult = statusCode;
      }
    }

    console.log(`[${new Date().toISOString()}] [INFO] ${clientIp} - ${method} ${url} - 完成 - ${responseResult} - ${processingTime}ms`);
  };

  res.json = function(data) {
    responseData = data;
    const result = originalJson.call(this, data);
    logResponse();
    return result;
  };

  res.send = function(data) {
    responseData = data;
    const result = originalSend.call(this, data);
    logResponse();
    return result;
  };

  res.on('finish', logResponse);

  next();
};

app.use(requestLogger);

// 提供测试网页访问
if (config.testPage.enabled) {
  app.use('/test', express.static(path.join(__dirname, 'test')));
}

// 提供静态资源访问（包含默认封面）
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// 提供歌单文件访问
app.use('/', express.static(config.playlist.baseDir, {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.mp3': 'audio/mpeg',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.opus': 'audio/opus',
      '.lrc': 'text/plain',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp'
    };

    if (mimeTypes[ext]) {
      res.setHeader('Content-Type', mimeTypes[ext]);
    }
  }
}));

app.get('/api/playlist', async (req, res) => {
  try {
    const playlist = await playlistService.scanPlaylist();
    
    res.set({
      'X-Period': playlistService.getCurrentPeriod(),
      'X-Current-Time': new Date().toISOString()
    });
    
    res.json(playlist);
  } catch (error) {
    console.error('获取歌单失败:', error);
    res.status(500).json([]);
  }
});

app.get('/api/status', (req, res) => {
  const period = playlistService.getCurrentPeriod();

  res.json({
    status: 'running',
    port: config.port,
    host: config.host,
    period: period,
    currentTime: new Date().toISOString(),
    config: {
      daytimeHours: `${config.playlist.daytime.startHour}:00 - ${config.playlist.daytime.endHour}:00`,
      nightHours: `${config.playlist.night.startHour}:00 - ${config.playlist.night.endHour}:00`,
      playlistDir: path.resolve(config.playlist.baseDir)
    }
  });
});

app.post('/api/refresh', async (req, res) => {
  try {
    playlistService.clearCache();
    const playlist = await playlistService.scanPlaylist(true);
    
    res.set({
      'X-Period': playlistService.getCurrentPeriod(),
      'X-Current-Time': new Date().toISOString()
    });
    
    res.json(playlist);
  } catch (error) {
    console.error('刷新歌单失败:', error);
    res.status(500).json([]);
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: '请求的路由不存在'
  });
});

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: err.message
  });
});

const PORT = config.port;
const HOST = config.host;

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = app.listen(PORT, HOST, (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      console.log(`====================================`);
      console.log(`  Custom Meting API 服务已启动`);
      console.log(`====================================`);
      console.log(`  地址: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
      if (config.testPage.enabled) {
        console.log(`  测试页面: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/test/`);
      }
      console.log(`  日间时段: ${config.playlist.daytime.startHour}:00 - ${config.playlist.daytime.endHour}:00`);
      console.log(`  夜间时段: ${config.playlist.night.startHour}:00 - ${config.playlist.night.endHour}:00`);
      console.log(`====================================`);
      console.log(`  API端点:`);
      console.log(`    - GET  /api/playlist  获取当前时段的歌单`);
      console.log(`    - GET  /api/status    获取服务状态`);
      console.log(`    - POST /api/refresh    刷新歌单缓存`);
      console.log(`====================================`);
      console.log(`  按 Ctrl+C 即可停止服务`);
      console.log(`====================================`);
      
      resolve();
    });
  });
}

// 优雅关闭函数
function gracefulShutdown(signal) {
  console.log(`\n${signal} 收到关闭信号，正在停止服务...`);
  
  if (server) {
    server.close((err) => {
      if (err) {
        console.error('关闭服务器时出错:', err);
        process.exit(1);
      }
      
      console.log('HTTP 服务器已正常关闭');
      process.exit(0);
    });
  } else {
    console.log('服务器未启动，直接退出');
    process.exit(0);
  }

  // 如果10秒后还没关闭，强制退出
  setTimeout(() => {
    console.error('无法正常关闭，强制退出');
    process.exit(1);
  }, 10000);
}

// 监听关闭信号
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 处理未捕获的异常
process.on('uncaughtException', (err) => {
  console.error('未捕获的异常:', err);
  gracefulShutdown('uncaughtException');
});

// 处理未拒绝的Promise
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
});

// 启动服务器
startServer().catch((err) => {
  console.error('启动服务器失败:', err);
  process.exit(1);
});

module.exports = app;
