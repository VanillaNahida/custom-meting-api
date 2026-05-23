const fs = require('fs').promises;
const path = require('path');
const mm = require('music-metadata');
const config = require('../config');

class PlaylistService {
  constructor() {
    this.cache = new Map();
    this.lastScanTime = new Map();
  }

  // 构建完整的 URL
  buildUrl(relativePath) {
    // 确保路径以 / 开头，并去除多余的斜杠
    let normalizedPath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
    // 将所有反斜杠替换为正斜杠
    normalizedPath = normalizedPath.replace(/\\/g, '/');
    // 将多个连续的斜杠替换为单个斜杠
    normalizedPath = normalizedPath.replace(/\/+/g, '/');
    
    // 使用外部 URL 配置
    if (config.externalUrl) {
      return `${config.externalUrl}${normalizedPath}`;
    }
    
    // 默认返回相对路径
    return normalizedPath;
  }

  getCurrentPeriod() {
    const now = new Date();
    const hour = now.getHours();

    const { daytime, night } = config.playlist;

    if (hour >= daytime.startHour && hour < daytime.endHour) {
      return 'daytime';
    } else if (hour >= night.startHour || hour < night.endHour) {
      return 'night';
    } else if (hour >= daytime.startHour) {
      return 'daytime';
    }

    return 'night';
  }

  getPlaylistFolder() {
    const period = this.getCurrentPeriod();
    const folderName = period === 'daytime'
      ? config.playlist.daytime.folder
      : config.playlist.night.folder;

    return path.resolve(config.playlist.baseDir, folderName);
  }

  async getLrcFile(audioPath) {
    const lrcPath = audioPath.replace(/\.[^.]+$/, '.lrc');
    try {
      await fs.access(lrcPath);
      const relativePath = path.relative(config.playlist.baseDir, lrcPath);
      return this.buildUrl(relativePath);
    } catch {
      return '';
    }
  }

  getDefaultCoverUrl() {
    return this.buildUrl('assets/default_cover.png');
  }

  async getCoverFile(audioPath, baseDir) {
    const audioName = path.basename(audioPath, path.extname(audioPath));

    const possibleExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

    for (const ext of possibleExtensions) {
      const coverPath = path.join(baseDir, audioName + ext);
      try {
        await fs.access(coverPath);
        const relativePath = path.relative(config.playlist.baseDir, coverPath);
        return this.buildUrl(relativePath);
      } catch {
        continue;
      }
    }

    return '';
  }

  async parseAudioFile(filePath, baseDir) {
    try {
      const metadata = await mm.parseFile(filePath);
      const { common, format } = metadata;

      let cover = '';

      if (common.picture && common.picture.length > 0) {
        const picture = common.picture[0];
        const ext = picture.format.includes('jpeg') || picture.format.includes('jpg') ? '.jpg' : '.png';
        const coverName = `${path.basename(filePath, path.extname(filePath))}_cover${ext}`;
        const coverPath = path.join(baseDir, coverName);

        if (!require('fs').existsSync(coverPath)) {
          require('fs').writeFileSync(coverPath, picture.data);
        }

        const relativePath = path.relative(config.playlist.baseDir, coverPath);
        cover = this.buildUrl(relativePath);
      } else {
        cover = await this.getCoverFile(filePath, baseDir);
      }

      if (!cover) {
        cover = this.getDefaultCoverUrl();
      }

      const lrc = await this.getLrcFile(filePath);

      const relativePath = path.relative(config.playlist.baseDir, filePath);
      const url = this.buildUrl(relativePath);

      return {
        name: common.title || path.basename(filePath, path.extname(filePath)),
        artist: common.artist || '未知艺术家',
        url: url,
        pic: cover,
        lrc: lrc
      };
    } catch (error) {
      console.error(`解析文件失败 ${filePath}:`, error.message);
      const relativePath = path.relative(config.playlist.baseDir, filePath);
      const url = this.buildUrl(relativePath);

      return {
        name: path.basename(filePath, path.extname(filePath)),
        artist: '未知艺术家',
        url: url,
        pic: this.getDefaultCoverUrl(),
        lrc: ''
      };
    }
  }

  async scanPlaylist() {
    const period = this.getCurrentPeriod();
    const cacheKey = period;

    if (config.cache.enabled && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      const cacheAge = (Date.now() - cached.timestamp) / 1000;

      if (cacheAge < config.cache.maxAge) {
        return cached.data;
      }
    }

    const folderPath = this.getPlaylistFolder();

    try {
      await fs.access(folderPath);
    } catch {
      console.warn(`歌单文件夹不存在: ${folderPath}`);
      return [];
    }

    const files = await fs.readdir(folderPath);
    const audioFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return config.supportedFormats.includes(ext);
    });

    const playlist = [];

    for (const file of audioFiles) {
      const filePath = path.join(folderPath, file);
      const track = await this.parseAudioFile(filePath, folderPath);
      playlist.push(track);
    }

    playlist.sort((a, b) => a.name.localeCompare(b.name));

    if (config.cache.enabled) {
      this.cache.set(cacheKey, {
        data: playlist,
        timestamp: Date.now()
      });
    }

    this.lastScanTime.set(period, new Date());

    return playlist;
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = new PlaylistService();
