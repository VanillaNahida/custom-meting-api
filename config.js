require('dotenv').config();

const config = {
  port: process.env.PORT || 9527,
  host: process.env.BIND_IP || '0.0.0.0',

  // 外部访问 URL（用于构建完整的资源链接
  externalUrl: process.env.EXTERNAL_URL || '',

  playlist: {
    baseDir: process.env.PLAYLIST_BASE_DIR || './playlist',
    daytime: {
      folder: process.env.DAYTIME_FOLDER || 'daytime',
      startHour: parseInt(process.env.DAYTIME_START_HOUR) || 6,
      endHour: parseInt(process.env.DAYTIME_END_HOUR) || 22
    },
    night: {
      folder: process.env.NIGHT_FOLDER || 'night',
      startHour: parseInt(process.env.NIGHT_START_HOUR) || 22,
      endHour: parseInt(process.env.NIGHT_END_HOUR) || 6
    }
  },

  supportedFormats: ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.opus'],

  cache: {
    enabled: process.env.CACHE_ENABLED !== 'false',
    maxAge: parseInt(process.env.CACHE_MAX_AGE) || 3600
  },

  cors: {
    enabled: process.env.CORS_ENABLED !== 'false',
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '*.xcnahida.cn')
      .split(',')
      .map(origin => origin.trim())
      .filter(origin => origin)
  },

  testPage: {
    enabled: process.env.TEST_PAGE_ENABLED !== 'false'
  }
};

Object.keys(config).forEach(key => {
  if (typeof config[key] === 'object' && config[key] !== null) {
    Object.keys(config[key]).forEach(subKey => {
      if (subKey.startsWith('env.')) {
        const envKey = subKey.substring(4);
        config[key][subKey.replace('env.', '')] = process.env[envKey];
      }
    });
  }
});

module.exports = config;
