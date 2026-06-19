const express = require('express');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const cors = require('cors');
const config = require('./config');
const playlistService = require('./services/playlistService');

const app = express();

// 彩色日志输出配置
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',
  fg: {
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
  },
  bg: {
    black: '\x1b[40m',
    red: '\x1b[41m',
    green: '\x1b[42m',
    yellow: '\x1b[43m',
    blue: '\x1b[44m',
    magenta: '\x1b[45m',
    cyan: '\x1b[46m',
    white: '\x1b[47m',
  }
};

// 日志工具函数
const logger = {
  info: (message) => {
    console.log(`${colors.fg.cyan}[INFO]${colors.reset} ${message}`);
  },
  error: (message) => {
    console.error(`${colors.fg.red}[ERROR]${colors.reset} ${message}`);
  },
  success: (message) => {
    console.log(`${colors.fg.green}[SUCCESS]${colors.reset} ${message}`);
  },
  warning: (message) => {
    console.log(`${colors.fg.yellow}[WARNING]${colors.reset} ${message}`);
  },
  debug: (message) => {
    console.log(`${colors.fg.magenta}[DEBUG]${colors.reset} ${message}`);
  },
  server: (message) => {
    console.log(`${colors.fg.blue}${colors.bright}[SERVER]${colors.reset} ${message}`);
  },
  request: (message) => {
    console.log(`${colors.fg.green}${colors.bright}[REQUEST]${colors.reset} ${message}`);
  }
};

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

  logger.request(`${colors.fg.white}[${requestTime}] ${colors.fg.yellow}${clientIp} ${colors.reset}- ${colors.fg.green}${method} ${colors.fg.blue}${url} ${colors.reset}- 开始处理`);

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
          responseResult = `${statusCode} (${data.success ? `${colors.fg.green}success${colors.reset}` : `${colors.fg.red}failed${colors.reset}`})`;
        }
      } catch (e) {
        responseResult = statusCode;
      }
    }

    logger.request(`${colors.fg.white}[${new Date().toISOString()}] ${colors.fg.yellow}${clientIp} ${colors.reset}- ${colors.fg.green}${method} ${colors.fg.blue}${url} ${colors.reset}- 完成 - ${responseResult} - ${colors.fg.cyan}${processingTime}ms${colors.reset}`);
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
  app.use('/test', express.static(path.join(__dirname, '..', 'assets', 'test')));
}

// 排序管理页面
if (config.sortManager.enabled) {
  if (!config.sortManager.password) {
    config.sortManager.password = crypto.randomBytes(16).toString('hex');
  }
  app.use('/', require('./routes/sortManager'));
}

// 提供 favicon
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'assets', 'favicon.ico'));
});

// 提供静态资源访问（包含默认封面）
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

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
    logger.error(`获取歌单失败: ${error.message}`);
    res.status(500).json([]);
  }
});

app.get('/meting/api', async (req, res) => {
  try {
    const { server, type, id } = req.query;
    const validPeriods = ['daytime', 'night'];
    const period = validPeriods.includes(id) ? id : null;

    const playlist = await playlistService.scanPlaylist(false, period);

    res.set({
      'X-Period': period || playlistService.getCurrentPeriod(),
      'X-Current-Time': new Date().toISOString()
    });

    res.json(playlist);
  } catch (error) {
    logger.error(`获取歌单失败: ${error.message}`);
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
    logger.error(`刷新歌单失败: ${error.message}`);
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
  logger.error(`服务器错误: ${err.message}`);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: err.message
  });
});

const PORT = config.port;
const HOST = config.host;

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push({ name, address: addr.address });
      }
    }
  }
  return ips;
}

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = app.listen(PORT, HOST, (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      logger.server(`${colors.bright}====================================${colors.reset}`);
      logger.success(`  ${colors.bright}Custom Meting API 服务已启动${colors.reset}`);
      logger.server(`${colors.bright}====================================${colors.reset}`);
      logger.info(`  监听地址: ${colors.fg.green}http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${colors.reset}`);

      const localIPs = getLocalIPs();
      if (localIPs.length > 0) {
        logger.info(`  本机 IP:`);
        localIPs.forEach(ip => {
          logger.info(`    ${colors.fg.cyan}${ip.name}${colors.reset}: ${colors.fg.green}http://${ip.address}:${PORT}${colors.reset}`);
        });
      }
      if (config.externalUrl) {
        logger.info(`  外部访问: ${colors.fg.green}${config.externalUrl}${colors.reset}`);
      }
      if (config.testPage.enabled) {
        logger.info(`  测试页面: ${colors.fg.green}http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/test/${colors.reset}`);
      }
      if (config.sortManager.enabled) {
        logger.info(`  排序管理: ${colors.fg.green}http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/manage/${colors.reset}`);
        logger.warning(`  管理密码: ${colors.fg.yellow}${colors.bright}${config.sortManager.password}${colors.reset}`);
        logger.warning(`  请妥善保管此密码！使用 Authorization: Bearer ${config.sortManager.password} 进行鉴权`);
      }
      logger.info(`  日间时段: ${colors.fg.yellow}${config.playlist.daytime.startHour}:00 - ${config.playlist.daytime.endHour}:00${colors.reset}`);
      logger.info(`  夜间时段: ${colors.fg.blue}${config.playlist.night.startHour}:00 - ${config.playlist.night.endHour}:00${colors.reset}`);
      logger.server(`${colors.bright}====================================${colors.reset}`);
      logger.info(`  API端点:`);
      logger.info(`    - ${colors.fg.green}GET${colors.reset}  ${colors.fg.cyan}/api/playlist${colors.reset}  获取当前时段的歌单`);
      logger.info(`    - ${colors.fg.green}GET${colors.reset}  ${colors.fg.cyan}/api/status${colors.reset}    获取服务状态`);
      logger.info(`    - ${colors.fg.yellow}POST${colors.reset} ${colors.fg.cyan}/api/refresh${colors.reset}    刷新歌单缓存`);
      logger.server(`${colors.bright}====================================${colors.reset}`);
      logger.warning(`  按 ${colors.fg.red}Ctrl+C${colors.reset} 即可停止服务`);
      logger.server(`${colors.bright}====================================${colors.reset}`);
      
      resolve();
    });
  });
}

// 优雅关闭函数
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.warning(`\n${colors.fg.yellow}${signal}${colors.reset} 收到关闭信号，正在停止服务...`);
  
  if (server) {
    server.closeAllConnections();
    server.closeIdleConnections();

    const forceExit = setTimeout(() => {
      logger.error('无法正常关闭，强制退出');
      process.exit(1);
    }, 3000);

    server.close((err) => {
      clearTimeout(forceExit);
      if (err) {
        logger.error(`关闭服务器时出错: ${err.message}`);
        process.exit(1);
      }
      logger.success('HTTP 服务器已正常关闭');
      process.exit(0);
    });
  } else {
    logger.info('服务器未启动，直接退出');
    process.exit(0);
  }
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));

// 处理未捕获的异常
process.on('uncaughtException', (err) => {
  logger.error(`未捕获的异常: ${err.message}`);
  gracefulShutdown('uncaughtException');
});

// 处理未拒绝的Promise
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`未处理的Promise拒绝: ${reason}`);
});

// 启动服务器
startServer().catch((err) => {
  logger.error(`启动服务器失败: ${err.message}`);
  process.exit(1);
});

module.exports = app;
