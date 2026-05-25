const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const mm = require('music-metadata');
const config = require('../config');
const sortService = require('./sortService');

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

  execFfprobe(filePath) {
    return new Promise((resolve, reject) => {
      execFile(config.ffmpeg.ffprobePath, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ], { maxBuffer: 1024 * 1024, timeout: 15000 }, (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch (parseErr) {
          reject(parseErr);
        }
      });
    });
  }

  extractCoverWithFfmpeg(filePath, outputPath) {
    return new Promise((resolve, reject) => {
      execFile(config.ffmpeg.ffmpegPath, [
        '-y',
        '-i', filePath,
        '-an',
        '-vcodec', 'copy',
        '-vframes', '1',
        outputPath
      ], { maxBuffer: 1024 * 1024, timeout: 15000 }, (err) => {
        if (err) return reject(err);
        resolve(outputPath);
      });
    });
  }

  async parseWithFfprobe(filePath, baseDir, refreshMetadata, existingStats) {
    const stats = existingStats || {
      titleFromMetadata: false,
      artistFromMetadata: false,
      coverFromMetadata: false,
      coverFromFile: false,
      lrcAvailable: false,
      ffmpegCoverExtracted: false,
      ffmpegMetadataExtracted: false
    };

    const probeData = await this.execFfprobe(filePath);
    const formatTags = (probeData.format && probeData.format.tags) || {};
    const title = formatTags.title || path.basename(filePath, path.extname(filePath));
    const artist = formatTags.artist || '未知艺术家';

    stats.titleFromMetadata = !!formatTags.title;
    stats.artistFromMetadata = !!formatTags.artist;
    stats.ffmpegMetadataExtracted = true;

    let cover = '';
    const baseName = path.basename(filePath, path.extname(filePath));
    const coverExts = ['.jpg', '.jpeg', '.png'];

    for (const ext of coverExts) {
      const existingCoverPath = path.join(baseDir, baseName + ext);
      try {
        await fs.access(existingCoverPath);
        cover = existingCoverPath;
        break;
      } catch {}
    }

    for (const ext of coverExts) {
      const coverName = `${baseName}_cover${ext}`;
      const coverPath = path.join(baseDir, coverName);
      try {
        await fs.access(coverPath);
        cover = coverPath;
        break;
      } catch {}
    }

    if (!cover) {
      try {
        const coverName = `${baseName}_cover.jpg`;
        const tmpCoverPath = path.join(baseDir, coverName);
        if (refreshMetadata || !fsSync.existsSync(tmpCoverPath)) {
          await this.extractCoverWithFfmpeg(filePath, tmpCoverPath);
          stats.ffmpegCoverExtracted = true;
        }
        cover = tmpCoverPath;
      } catch {}
    }

    if (cover) {
      const relativePath = path.relative(config.playlist.baseDir, cover);
      cover = this.buildUrl(relativePath);
      stats.coverFromMetadata = stats.ffmpegCoverExtracted;
    }

    if (!cover) {
      cover = await this.getCoverFile(filePath, baseDir);
      if (cover) {
        stats.coverFromFile = true;
      }
    }

    if (!cover) {
      cover = this.getDefaultCoverUrl();
    }

    const lrc = await this.getLrcFile(filePath);
    stats.lrcAvailable = !!lrc;

    const relativePath = path.relative(config.playlist.baseDir, filePath);
    const url = this.buildUrl(relativePath);
    const id = crypto.createHash('md5').update(filePath).digest('hex');

    return {
      track: {
        id: id,
        title: title,
        author: artist,
        url: url,
        pic: cover,
        lrc: lrc
      },
      stats: stats
    };
  }

  async parseAudioFile(filePath, baseDir, refreshMetadata = false) {
    const stats = {
      titleFromMetadata: false,
      artistFromMetadata: false,
      coverFromMetadata: false,
      coverFromFile: false,
      lrcAvailable: false,
      ffmpegCoverExtracted: false,
      ffmpegMetadataExtracted: false
    };

    try {
      const metadata = await mm.parseFile(filePath);
      const { common, format } = metadata;

      let cover = '';

      if (common.picture && common.picture.length > 0) {
        const picture = common.picture[0];
        const ext = picture.format.includes('jpeg') || picture.format.includes('jpg') ? '.jpg' : '.png';
        const coverName = `${path.basename(filePath, path.extname(filePath))}_cover${ext}`;
        const coverPath = path.join(baseDir, coverName);

        // 如果是刷新模式或者封面文件不存在，则写入
        if (refreshMetadata || !fsSync.existsSync(coverPath)) {
          fsSync.writeFileSync(coverPath, picture.data);
          stats.ffmpegCoverExtracted = true;
        }

        const relativePath = path.relative(config.playlist.baseDir, coverPath);
        cover = this.buildUrl(relativePath);
        stats.coverFromMetadata = true;
      } else {
        cover = await this.getCoverFile(filePath, baseDir);
        if (cover) {
          stats.coverFromFile = true;
        }
      }

      if (!cover) {
        cover = this.getDefaultCoverUrl();
      }

      const lrc = await this.getLrcFile(filePath);
      stats.lrcAvailable = !!lrc;

      const relativePath = path.relative(config.playlist.baseDir, filePath);
      const url = this.buildUrl(relativePath);

      const title = common.title || path.basename(filePath, path.extname(filePath));
      const artist = common.artist || '未知艺术家';

      const id = crypto.createHash('md5').update(filePath).digest('hex');

      stats.titleFromMetadata = !!common.title;
      stats.artistFromMetadata = !!common.artist;
      stats.ffmpegMetadataExtracted = true;

      return {
        track: {
          id: id,
          title: title,
          author: artist,
          url: url,
          pic: cover,
          lrc: lrc
        },
        stats: stats
      };
    } catch (error) {
      console.warn(`music-metadata 解析失败，尝试 ffprobe: ${filePath}`);
      try {
        const result = await this.parseWithFfprobe(filePath, baseDir, refreshMetadata, stats);
        return result;
      } catch (ffprobeError) {
        console.error(`ffprobe 解析也失败: ${filePath}`, ffprobeError.message);
      }
      const relativePath = path.relative(config.playlist.baseDir, filePath);
      const url = this.buildUrl(relativePath);
      const id = crypto.createHash('md5').update(filePath).digest('hex');

      return {
        track: {
          id: id,
          title: path.basename(filePath, path.extname(filePath)),
          author: '未知艺术家',
          url: url,
          pic: this.getDefaultCoverUrl(),
          lrc: ''
        },
        stats: stats
      };
    }
  }

  async scanPlaylist(refreshMetadata = false) {
    const period = this.getCurrentPeriod();
    const cacheKey = period;

    if (!refreshMetadata && config.cache.enabled && this.cache.has(cacheKey)) {
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
    const allStats = [];

    for (const file of audioFiles) {
      const filePath = path.join(folderPath, file);
      const result = await this.parseAudioFile(filePath, folderPath, refreshMetadata);
      playlist.push(result.track);
      allStats.push({
        file: file,
        ...result.stats
      });
    }

    playlist.sort((a, b) => a.title.localeCompare(b.title));

    const orderedPlaylist = await sortService.getOrderedPlaylist(playlist, period);

    // 如果是刷新模式，输出详细的元数据统计
    if (refreshMetadata) {
      this.logMetadataStats(allStats);
    }

    if (config.cache.enabled) {
      this.cache.set(cacheKey, {
        data: orderedPlaylist,
        timestamp: Date.now()
      });
    }

    this.lastScanTime.set(period, new Date());

    return orderedPlaylist;
  }

  logMetadataStats(stats) {
    const total = stats.length;
    let titleFromMetadata = 0;
    let artistFromMetadata = 0;
    let coverFromMetadata = 0;
    let coverFromFile = 0;
    let lrcAvailable = 0;
    let ffmpegCoverExtracted = 0;
    let ffmpegMetadataExtracted = 0;

    console.log('\n========== 歌单刷新元数据统计 ==========');
    console.log('详细歌曲信息：');
    
    stats.forEach((stat, index) => {
      if (stat.titleFromMetadata) titleFromMetadata++;
      if (stat.artistFromMetadata) artistFromMetadata++;
      if (stat.coverFromMetadata) coverFromMetadata++;
      if (stat.coverFromFile) coverFromFile++;
      if (stat.lrcAvailable) lrcAvailable++;
      if (stat.ffmpegCoverExtracted) ffmpegCoverExtracted++;
      if (stat.ffmpegMetadataExtracted) ffmpegMetadataExtracted++;

      const details = [];
      if (stat.titleFromMetadata) details.push('标题来自元数据');
      if (stat.artistFromMetadata) details.push('艺术家来自元数据');
      if (stat.coverFromMetadata) details.push('封面来自元数据');
      if (stat.coverFromFile) details.push('封面来自文件');
      if (stat.lrcAvailable) details.push('有歌词文件');
      if (stat.ffmpegCoverExtracted) details.push('提取了新封面');
      
      console.log(`${index + 1}. ${stat.file} - ${details.length > 0 ? details.join(', ') : '使用默认值'}`);
    });

    console.log('\n汇总统计：');
    console.log(`总计歌曲: ${total}`);
    console.log(`标题来自元数据: ${titleFromMetadata} (${((titleFromMetadata / total) * 100).toFixed(1)}%)`);
    console.log(`艺术家来自元数据: ${artistFromMetadata} (${((artistFromMetadata / total) * 100).toFixed(1)}%)`);
    console.log(`封面来自元数据: ${coverFromMetadata} (${((coverFromMetadata / total) * 100).toFixed(1)}%)`);
    console.log(`封面来自文件: ${coverFromFile} (${((coverFromFile / total) * 100).toFixed(1)}%)`);
    console.log(`有歌词文件: ${lrcAvailable} (${((lrcAvailable / total) * 100).toFixed(1)}%)`);
    console.log(`FFmpeg 提取封面: ${ffmpegCoverExtracted}`);
    console.log(`FFmpeg 提取元数据: ${ffmpegMetadataExtracted}`);
    console.log('==========================================\n');
  }

  clearCache() {
    this.cache.clear();
  }

  async scanAllPlaylists() {
    const periods = ['daytime', 'night'];
    const allSongs = {};

    for (const period of periods) {
      const folderName = period === 'daytime'
        ? config.playlist.daytime.folder
        : config.playlist.night.folder;

      const folderPath = path.resolve(config.playlist.baseDir, folderName);

      try {
        await fs.access(folderPath);
      } catch {
        allSongs[period] = [];
        continue;
      }

      const files = await fs.readdir(folderPath);
      const audioFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return config.supportedFormats.includes(ext);
      });

      const songs = [];
      for (const file of audioFiles) {
        const filePath = path.join(folderPath, file);
        const result = await this.parseAudioFile(filePath, folderPath, false);
        songs.push(result.track);
      }

      songs.sort((a, b) => a.title.localeCompare(b.title));

      const orderedSongs = await sortService.getOrderedPlaylist(songs, period);
      allSongs[period] = orderedSongs;
    }

    return allSongs;
  }
}

module.exports = new PlaylistService();
