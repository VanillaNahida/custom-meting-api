const fs = require('fs').promises;
const path = require('path');

const ORDER_FILE = path.resolve(__dirname, '../data/playlist-order.json');

async function ensureOrderFile() {
  try {
    await fs.access(ORDER_FILE);
  } catch {
    await fs.mkdir(path.dirname(ORDER_FILE), { recursive: true });
    await fs.writeFile(ORDER_FILE, '{}', 'utf-8');
  }
}

async function loadOrder() {
  await ensureOrderFile();
  const raw = await fs.readFile(ORDER_FILE, 'utf-8');
  return JSON.parse(raw);
}

async function getOrder(period) {
  const data = await loadOrder();
  return data[period] || [];
}

async function saveOrder(period, orderIds) {
  const data = await loadOrder();
  data[period] = orderIds;
  await fs.writeFile(ORDER_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function applyOrder(songs, orderIds) {
  const map = new Map(songs.map(s => [s.id, s]));

  const ordered = orderIds
    .map(id => map.get(id))
    .filter(Boolean);

  const orderedIds = new Set(orderIds);
  const remaining = songs.filter(s => !orderedIds.has(s.id));

  return [...ordered, ...remaining];
}

async function getOrderedPlaylist(songs, period) {
  const order = await getOrder(period);
  if (!order || order.length === 0) {
    return songs;
  }
  return applyOrder(songs, order);
}

module.exports = {
  getOrder,
  saveOrder,
  getOrderedPlaylist,
  applyOrder
};
