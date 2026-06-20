const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// 项目根目录
const ROOT = path.resolve(__dirname, '..');

// 尝试加载 config.yaml，如果不存在则加载 config.yaml.example
function loadConfig() {
  const configPath = path.join(ROOT, 'config.yaml');
  const examplePath = path.join(ROOT, 'config.yaml.example');

  let configFile = configPath;
  if (!fs.existsSync(configFile)) {
    if (fs.existsSync(examplePath)) {
      configFile = examplePath;
      console.warn('[WARN] config.yaml 不存在，使用 config.yaml.example 作为配置');
      console.warn('[WARN] 请复制 config.yaml.example 为 config.yaml 并根据需要修改');
    } else {
      return {};
    }
  }

  try {
    const doc = yaml.load(fs.readFileSync(configFile, 'utf8'));
    return doc || {};
  } catch (err) {
    console.error(`[ERROR] 读取配置文件失败: ${err.message}`);
    return {};
  }
}

const cfg = loadConfig();

const config = {
  port: cfg.port || 9527,
  host: cfg.bind_ip || '0.0.0.0',

  // 外部访问 URL（用于构建完整的资源链接）
  externalUrl: cfg.external_url || '',

  playlist: {
    baseDir: cfg.playlist?.base_dir || './playlist',
    daytime: {
      folder: cfg.playlist?.daytime?.folder || 'daytime',
      startHour: cfg.playlist?.daytime?.start_hour ?? 6,
      endHour: cfg.playlist?.daytime?.end_hour ?? 22
    },
    night: {
      folder: cfg.playlist?.night?.folder || 'night',
      startHour: cfg.playlist?.night?.start_hour ?? 22,
      endHour: cfg.playlist?.night?.end_hour ?? 6
    }
  },

  supportedFormats: ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus'],

  cache: {
    enabled: cfg.cache?.enabled !== false,
    maxAge: cfg.cache?.max_age || 3600
  },

  cors: {
    enabled: cfg.cors?.enabled !== false,
    allowedOrigins: cfg.cors?.allowed_origins
      ? (Array.isArray(cfg.cors.allowed_origins) ? cfg.cors.allowed_origins : cfg.cors.allowed_origins.split(',').map(s => s.trim()).filter(Boolean))
      : ['*.xcnahida.cn']
  },

  testPage: {
    enabled: cfg.test_page?.enabled !== false
  },

  sortManager: {
    enabled: cfg.sort_manager?.enabled === true,
    password: cfg.sort_manager?.password || ''
  },

  ffmpeg: {
    ffmpegPath: cfg.ffmpeg?.ffmpeg_path || 'ffmpeg',
    ffprobePath: cfg.ffmpeg?.ffprobe_path || 'ffprobe'
  }
};

module.exports = config;
