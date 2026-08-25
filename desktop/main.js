'use strict';

/* 桌面壳 · 主进程
 *
 * 这里只做网页做不到的那几件事：把窗口变透明、让它浮在别的窗口上面、
 * 在没有鼠标碰它的时候让点击穿过去、以及右键那个原生菜单。
 * 产品逻辑一行都不在这儿——渲染进程加载的还是同一个 index.html，
 * 浏览器里直接打开照样跑（desktop.js 检测不到这个壳就整个不干活）。
 */

const { app, BrowserWindow, Menu, ipcMain, screen, globalShortcut, shell, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const llm = require('./llm');

const ROOT = path.join(__dirname, '..');

/* 四种形态的窗口尺寸。窗口永远只有「此刻要显示的东西」那么大：
 * 平时桌面上只有它，透明窗口越小，压在别人上面的死区就越小。 */
const SIZE = {
  pet:   { w: 168, h: 124 },   // 只有它。舞台 38×22 格 × --px(4px) = 152×88，四周留一点给白边和阴影
  panel: { w: 252, h: 620 },   // 它 + 便签板。620 = 屏 450 + 它 120 + 余量，见 desktop.css 的 --screen-h
  big:   { w: 284, h: 620 },   // 图鉴 / 回看。高度跟 panel 一样——三块屏是同一块屏，只是装的东西不同
  oobe:  { w: 600, h: 680 }    // 第一次那三道题
};

let win = null;
let drag = null;               // 按下的那一刻窗口和光标的差值，拖动全程按它算
let posFile = null;

/* ---------- 它站在哪儿 ----------
 * 记住位置是桌宠的基本礼貌：每次开机都跳回右下角的话，
 * 「它一直在那儿」这件事就不成立了。 */

function loadPos() {
  try { return JSON.parse(fs.readFileSync(posFile, 'utf8')); } catch (e) { return null; }
}

function savePos() {
  if (!win) return;
  const b = win.getBounds();
  // 存的是它站的那条线（底边中点），不是窗口左上角——窗口会随形态变大变小
  try {
    fs.writeFileSync(posFile, JSON.stringify({ cx: b.x + b.width / 2, bottom: b.y + b.height }));
  } catch (e) {}
}

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

/* 换形态。锚点是「它站的那条线」和「它的中轴」：便签板往上长、图鉴往两边长，
 * 它自己在屏幕上一动不动。窗口跟着鼠标跑的桌宠会让人晕。 */
function resize(name) {
  const s = SIZE[name];
  if (!s || !win) return;
  const b = win.getBounds();
  const cx = b.x + b.width / 2;
  const bottom = b.y + b.height;
  const wa = screen.getDisplayMatching(b).workArea;
  win.setBounds({
    x: clamp(Math.round(cx - s.w / 2), wa.x, wa.x + wa.width - s.w),
    y: clamp(Math.round(bottom - s.h), wa.y, wa.y + wa.height - s.h),
    width: s.w,
    height: s.h
  });
  savePos();   // 存的是锚点（它站的那条线），换形态不改变它，但测评完那一次会落盘
}

function createWindow() {
  const saved = loadPos();
  const wa = screen.getPrimaryDisplay().workArea;
  // 有存过位置 = 不是第一次开，直接以「只有它」的形态出现在上次站的地方
  const s = saved ? SIZE.pet : SIZE.oobe;
  const x = saved ? clamp(Math.round(saved.cx - s.w / 2), wa.x, wa.x + wa.width - s.w)
                  : Math.round(wa.x + (wa.width - s.w) / 2);
  const y = saved ? clamp(Math.round(saved.bottom - s.h), wa.y, wa.y + wa.height - s.h)
                  : Math.round(wa.y + (wa.height - s.h) / 2);

  win = new BrowserWindow({
    x: x, y: y, width: s.w, height: s.h,
    frame: false,
    transparent: true,
    hasShadow: false,          // 透明窗口带阴影的话，空白区域会显出一圈灰边
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(ROOT, 'index.html'));
  win.once('ready-to-show', function () { win.show(); });

  // 浮在普通窗口之上，但不去打扰全屏应用——你在全屏写东西的时候它不该杵在那儿
  win.setAlwaysOnTop(true, 'floating');
  /* 这里必须是 false。macOS 的全屏应用自己就是一个独立桌面空间，
   * 一旦允许窗口「加入所有空间」，这个标记会压过 visibleOnFullScreen，
   * 它就照样飘在全屏窗口上面。代价是它只留在自己那块桌面，不跟着你换空间。 */
  win.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: false });

  /* Dock 藏起来之后菜单栏也跟着没了，Cmd+C/V/Z 会失效。
   * 这个产品的全部内容都是打字打出来的，这几个键必须手动接回来。 */
  win.webContents.on('before-input-event', function (e, input) {
    if (input.type !== 'keyDown' || !input.meta) return;
    const wc = win.webContents;
    const k = (input.key || '').toLowerCase();
    if      (k === 'c') wc.copy();
    else if (k === 'v') wc.paste();
    else if (k === 'x') wc.cut();
    else if (k === 'a') wc.selectAll();
    else if (k === 'z') input.shift ? wc.redo() : wc.undo();
    else return;
    e.preventDefault();
  });

  win.on('moved', savePos);
  win.on('closed', function () { win = null; });
}

/* ---------- 鼠标到底碰没碰到它 ----------
 *
 * 这件事必须在主进程用「轮询全局光标位置」来做，不能靠渲染进程的 mousemove。
 * 原因是 macOS 的一条硬规则：**不在前台的 App 收不到鼠标移动事件**。
 * 而它绝大部分时间都不在前台——你正在别的窗口里干活，它只是站在旁边。
 * 一旦窗口进入「点击穿透」，就再也等不到那个能把它唤回来的 mousemove，
 * 碰它没反应、左键穿过去、右键也穿过去，整个东西变成一张贴纸（连退出都点不到）。
 *
 * getCursorScreenPoint 跟前台是谁无关，永远问得到。 */

let hot = [];            // 渲染进程报上来的实心区域（窗口内坐标），只有这些地方吃鼠标
let hovering = null;     // 光标此刻在不在实心区域上
let solid = false;       // 测评页 / 图鉴：整窗都是实心的，不用算
let dragging = false;

function inHot(p, b) {
  const x = p.x - b.x, y = p.y - b.y;
  for (let i = 0; i < hot.length; i++) {
    const r = hot[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

function setHover(on) {
  if (on === hovering) return;
  hovering = on;
  // forward:true 保留着：窗口在前台时它能让 hover 更跟手，但整套逻辑不依赖它
  win.setIgnoreMouseEvents(!on, { forward: true });
  win.webContents.send('pet:hover', on);
}

setInterval(function () {
  if (!win || win.isDestroyed() || dragging) return;
  if (solid) { setHover(true); return; }
  setHover(inHot(screen.getCursorScreenPoint(), win.getBounds()));
}, 60);

ipcMain.on('pet:hot', function (e, rects) { hot = rects || []; });

ipcMain.on('pet:mode', function (e, name) {
  solid = (name === 'oobe' || name === 'big');
  resize(name);
  if (solid) setHover(true);
});

ipcMain.on('pet:drag', function (e, phase) {
  if (!win) return;
  if (phase === 'start') {
    // 拖动期间停掉轮询：快速拖的时候光标会甩出实心区域，
    // 那时候要是把窗口切成穿透，鼠标松开的事件就丢了，它会一直粘在光标上
    dragging = true;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    drag = { dx: p.x - b.x, dy: p.y - b.y };
  } else if (phase === 'move' && drag) {
    // 光标位置从主进程拿，不用渲染进程传坐标——省掉一层坐标系换算的错
    const p = screen.getCursorScreenPoint();
    win.setPosition(Math.round(p.x - drag.dx), Math.round(p.y - drag.dy));
  } else if (phase === 'end') {
    drag = null;
    dragging = false;
    savePos();
  }
});

ipcMain.on('pet:focus', function () {
  // 不进 Dock 的应用要显式抢一次焦点，不然点了便签也打不进字
  app.focus({ steal: true });
  if (win) win.focus();
});

ipcMain.on('pet:menu', function () {
  if (!win) return;
  const send = function (action) { win.webContents.send('pet:menu-action', action); };
  Menu.buildFromTemplate([
    { label: '回看', click: function () { send('arch'); } },
    { label: '图鉴',     click: function () { send('dex'); } },
    { type: 'separator' },
    {
      label: 'AI 文案设置…',
      click: function () {
        // 直接用系统默认编辑器打开；文件不存在时 init 已经写过模板了
        var p = llm.configPath();
        if (p) shell.openPath(p);
      }
    },
    { type: 'separator' },
    { label: '导出存档', click: function () { send('export'); } },
    { label: '导入存档', click: function () { send('import'); } },
    { type: 'separator' },
    { label: '退出', click: function () { app.quit(); } }
  ]).popup({ window: win });
});

/* ---------- LLM ---------- */

// 系统级空闲秒数，深夜要不要出声靠它
ipcMain.handle('pet:idle', function () {
  try { return powerMonitor.getSystemIdleTime(); } catch (e) { return 0; }
});

ipcMain.handle('pet:llm-ready', function () { return llm.ready(); });
ipcMain.handle('pet:llm-generate', function (e, payload) { return llm.generate(payload); });

/* ---------- 存档备份 ----------
 * 存档的家还是渲染进程的 localStorage，桌面壳不接管内容。
 * 但 localStorage 是能被整块清掉的，清掉这只就没了——这是这个产品最大的单点故障。
 * 所以每次落盘顺手往 userData 抄一份，滚动留三代。
 *
 * 这份备份只进不出：程序永远不会自己回滚。要恢复走右键菜单的「导入存档」，
 * 手动选一次文件。自动恢复的风险是拿旧的盖掉新的，那比丢了更糟。 */

let backupFile = null;
let backupAt = 0;
const BACKUP_GAP = 60000;          // 一分钟最多写一次。敲一个字就写一次盘是没必要的

function rotate() {
  const gen = (i) => (i === 0 ? backupFile : backupFile.replace(/\.json$/, '.' + i + '.json'));
  try { if (fs.existsSync(gen(2))) fs.unlinkSync(gen(2)); } catch (e) {}
  for (let i = 1; i >= 0; i--) {
    try { if (fs.existsSync(gen(i))) fs.renameSync(gen(i), gen(i + 1)); } catch (e) {}
  }
}

ipcMain.on('pet:backup', function (e, json) {
  // 空串或炸掉的 JSON 不能覆盖好的那份——宁可这次不备份
  if (!backupFile || typeof json !== 'string' || json.length < 32) return;
  const now = Date.now();
  if (now - backupAt < BACKUP_GAP) return;
  backupAt = now;
  try {
    rotate();
    fs.writeFileSync(backupFile, json);
  } catch (err) {}
});

/* ---------- 启动 ---------- */

/* 没打包的 Electron 默认把存档写进 .../Application Support/Electron，
 * 那是所有本地 Electron 应用共用的一个筐。它得有自己的抽屉——
 * 便签是真东西，不能跟别人的调试数据堆在一起。 */
app.setPath('userData', path.join(app.getPath('appData'), 'workplace-creature'));

/* 只许有一只。两个实例会往同一个存档、同一份备份里写，便签互相盖掉。
 * 快速启动.command 里也有一道 pgrep 的粗筛，但那道靠目录名，改个名就失效了——
 * 这道锁认的是 userData 目录，跟仓库叫什么、从哪儿启动都无关。 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 第二次启动会走到这里（在已经跑着的那个实例里）：不新开窗口，把现有的这只叫到跟前
  app.on('second-instance', function () {
    if (!win) return;
    win.showInactive();
    app.focus({ steal: true });
  });
}

app.whenReady().then(function () {
  posFile    = path.join(app.getPath('userData'), 'pet-pos.json');
  backupFile = path.join(app.getPath('userData'), 'save-backup.json');
  llm.init(app.getPath('userData'));       // 没有配置文件就写一份带说明的模板

  // 它住在桌面上，不住在程序坞里：不占 Dock、不进 Cmd+Tab。退出走右键菜单。
  if (app.dock) app.dock.hide();

  // 菜单栏虽然看不见，这份还是要挂——少了它，输入框里的复制粘贴会连带出别的毛病
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));

  createWindow();

  /* 保命的后门：不进 Dock 也不进 Cmd+Tab，正常出口只有右键菜单。 */
  globalShortcut.register('Control+Alt+Command+Q', function () { app.quit(); });

  /* 控制台。注册失败不报错，所以挂两个组合，撞了一个还有另一个。 */
  ['Control+Alt+Command+I', 'Shift+Command+F12'].forEach(function (k) {
    globalShortcut.register(k, function () {
      // 透明无边框窗口内嵌不出 devtools，必须独立成窗
      if (!win) return;
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: 'detach' });
    });
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () { app.quit(); });
