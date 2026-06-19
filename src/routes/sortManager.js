const express = require('express');
const path = require('path');
const config = require('../config');
const playlistService = require('../services/playlistService');
const sortService = require('../services/sortService');

const router = express.Router();

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '未授权：缺少 Authorization 头' });
  }

  const token = authHeader.slice(7);
  if (token !== config.sortManager.password) {
    return res.status(403).json({ success: false, error: '未授权：密码错误' });
  }

  next();
}

router.use('/manage', express.static(path.join(__dirname, '..', '..', 'assets', 'sort-manager')));

router.use('/api/manage', authMiddleware);

router.get('/api/manage/songs', async (req, res) => {
  try {
    const allSongs = await playlistService.scanAllPlaylists();
    res.json({ success: true, data: allSongs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/manage/order/:period', async (req, res) => {
  try {
    const { period } = req.params;
    if (!['daytime', 'night'].includes(period)) {
      return res.status(400).json({ success: false, error: '无效的时段参数' });
    }
    const order = await sortService.getOrder(period);
    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/manage/order/:period', async (req, res) => {
  try {
    const { period } = req.params;
    const { order } = req.body;

    if (!['daytime', 'night'].includes(period)) {
      return res.status(400).json({ success: false, error: '无效的时段参数' });
    }

    if (!Array.isArray(order)) {
      return res.status(400).json({ success: false, error: 'order 必须是数组' });
    }

    const validIds = new Set(await playlistService.getSongIds(period));
    const cleanedOrder = order.filter(id => validIds.has(id));
    const removed = order.length - cleanedOrder.length;

    if (removed > 0) {
      console.log(`[排序] ${period}: 移除了 ${removed} 个不存在的歌曲ID`);
    }

    await sortService.saveOrder(period, cleanedOrder);
    playlistService.clearCache();

    res.json({ success: true, message: '排序已保存' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
