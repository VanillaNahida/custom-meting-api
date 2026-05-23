#!/usr/bin/env node
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const appName = 'custom-meting-api';
const ecosystemFile = path.join(__dirname, 'ecosystem.config.js');

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      ...options
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

function checkPm2() {
  try {
    const result = spawnSync('pm2', ['--version'], { stdio: 'ignore', shell: true });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function start() {
  if (!checkPm2()) {
    console.error('PM2 未安装，请先运行: npm install pm2 -g');
    process.exit(1);
  }

  console.log('正在启动服务...');
  await runCommand('pm2', ['start', ecosystemFile]);
  await runCommand('pm2', ['save']);
  console.log('服务启动成功！');
  console.log('查看状态: npm run status');
  console.log('查看日志: npm run log');
}

async function stop() {
  console.log('正在停止服务...');
  await runCommand('pm2', ['stop', appName]);
  await runCommand('pm2', ['delete', appName]);
  await runCommand('pm2', ['save']);
  console.log('服务已停止');
}

async function restart() {
  console.log('正在重启服务...');
  await runCommand('pm2', ['restart', appName]);
  await runCommand('pm2', ['save']);
  console.log('服务重启成功！');
}

function status() {
  console.log('====================================');
  console.log('  Custom Meting API 服务状态');
  console.log('====================================');
  console.log('');
  runCommand('pm2', ['status']);
}

function log(options = {}) {
  const args = ['logs', appName];
  
  if (options.follow) {
    args.push('-f');
  } else if (options.lines) {
    args.push('--lines', options.lines);
  } else if (options.err) {
    args.push('--err');
  } else if (options.out) {
    args.push('--out');
  } else {
    args.push('--lines', '100');
  }
  
  runCommand('pm2', args);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'start':
      await start();
      break;
    case 'stop':
      await stop();
      break;
    case 'restart':
      await restart();
      break;
    case 'status':
      status();
      break;
    case 'log':
      const logOptions = {};
      if (args.includes('-f') || args.includes('--follow')) logOptions.follow = true;
      if (args.includes('--err')) logOptions.err = true;
      if (args.includes('--out')) logOptions.out = true;
      const linesIndex = args.findIndex(arg => arg === '-n' || arg === '--lines');
      if (linesIndex !== -1 && args[linesIndex + 1]) logOptions.lines = args[linesIndex + 1];
      log(logOptions);
      break;
    case 'monit':
      runCommand('pm2', ['monit']);
      break;
    default:
      console.log(`
Usage: node scripts/manage.js [command]

Commands:
  start          启动服务
  stop           停止服务
  restart        重启服务
  status         查看状态
  log [options]  查看日志
    -f, --follow  实时查看日志
    --err         查看错误日志
    --out         查看标准输出日志
    -n, --lines   指定显示行数
  monit          进入监控面板

Examples:
  node scripts/manage.js start
  node scripts/manage.js log -f
  node scripts/manage.js log --err
      `);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
