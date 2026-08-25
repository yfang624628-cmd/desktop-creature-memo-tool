/* 生成 demo.html —— 给 README 截图用的四块屏，内容全是编的。
 *
 * 外壳从 index.html 里现抠，样式直接链项目里的 style.css / desktop.css，
 * 精灵和原型名字读 sprites.js / data.js。所以界面改了重跑一次就同步，
 * 不用再拿自己真实的便签去截图。
 *
 *   node tools/make-demo.mjs
 *
 * 唯一会漂的是「条目」那层标记（便签 li、回看 item、图鉴格子）——
 * 那些是 ui.js 运行时拼的，这里照抄了一份。改 ui.js 的渲染时对一下这个文件。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
global.window = {};
require(path.join(ROOT, 'js/sprites.js'));
const SPR = global.window.SPRITES;
const DATA = JSON.parse(readFileSync(path.join(ROOT, 'js/data.js'), 'utf8').match(/\{[\s\S]*\}/)[0]);
const PROTOS = DATA.prototypes.prototypes;

/* ---------- 从 index.html 里抠出一整块（按标签名数深度，能穿过同名嵌套） ---------- */
const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function block(openTag) {
  const i = HTML.indexOf(openTag);
  if (i < 0) throw new Error('index.html 里找不到：' + openTag);
  const tag = openTag.match(/^<([a-z]+)/)[1];
  const re = new RegExp(`</?${tag}\\b`, 'g');
  re.lastIndex = i;
  let depth = 0, m;
  while ((m = re.exec(HTML))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return HTML.slice(i, HTML.indexOf('>', m.index) + 1);
  }
  throw new Error('没闭合：' + openTag);
}
const DESK = block('<section class="desk">');
const PET  = block('<section class="pet">');
const ARCH = block('<div class="arch-panel">');
const DEX  = block('<div class="dex-panel">');

/* ---------- 精灵：跟 ui.js 的 paintSprite 同一个算法 ---------- */
function sprite(id, mode) {
  const sp = SPR[id]; if (!sp) return '';
  const g = sp.body.map(r => r.split(''));
  if (mode !== 'blink') (sp.eyes || []).forEach(([y, x]) => { if (g[y]) g[y][x] = '.'; });
  (sp.mouth || []).forEach(([y, x]) => { if (g[y]) g[y][x] = '.'; });
  let out = '';
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++)
    if (g[y][x] === '#') out += `<i style="grid-area:${y + 1}/${x + 1}"></i>`;
  return out;
}
const CHECK = '<svg width="12" height="12" viewBox="0 0 6 6" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">'
  + [[0,2],[1,3],[2,4],[3,3],[4,2],[5,1]].map(([x,y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`).join('') + '</svg>';

/* ---------- 编的内容。真实感要够，但跟任何人的真实待办无关 ---------- */
const NOTES = [
  { c: 'pink',   t: '给门锁换电池' },
  { c: 'yellow', t: '把周会纪要发出去', age: '2 天前' },
  { c: 'yellow', t: '需求池：导出功能加个筛选', age: '5 天前' },
  { c: 'yellow', t: '预约周四的会议室', age: '9 天前', stale: true }
];
const DAYS = [
  { t: '今天', items: [['pink', '给门锁换电池'], ['yellow', '回一下合同的邮件']] },
  { t: '昨天', items: [['yellow', '把上周的数据补齐'], ['yellow', '清理下载文件夹'], ['yellow', '写完那份说明文档']] },
  { t: '8 月 21 日 周五', items: [['yellow', '确认一下导出字段能不能直接对上后台的命名'], ['yellow', '把筛选条件补进需求池']] },
  { t: '8 月 20 日 周四', items: [['yellow', '订下周三的会议室']] },
  { t: '8 月 19 日 周三', items: [['yellow', '跟进入库字段'], ['yellow', '查重方案再看一遍'], ['pink', '想一下日报能不能自动生成']] }
];
const MONTH = { y: 2026, m: 8, today: 25, counts: { 4:1, 5:2, 6:1, 7:3, 11:4, 12:3, 13:2, 14:7, 18:1, 19:2, 20:1, 21:2, 24:3, 25:2 } };
const OWNED = ['R01', 'R02', 'R03', 'R05', 'R10', 'R17'];
const ME = 'R02';              // 兔子

/* 行为只给代码，标签从 data.js 里查——写死两份迟早对不上：
   之前配了 A05（画面是电脑）却标「午饭中」。A14 加班中，画的正是电脑。 */
const BEHAVIOR = 'A14';
const BEHAVIOR_LABEL = DATA.copy.behavior[BEHAVIOR].label;

/* ---------- 把编好的内容填进外壳 ---------- */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fill = (html, id, inner) =>
  html.replace(new RegExp(`(<[^>]*id="${id}"[^>]*>)[\\s\\S]*?(</[a-z]+>)`), (_, a, b) => a + inner + b);
const unhide = (html, id) => html.replace(new RegExp(`(<[^>]*id="${id}"[^>]*?) hidden`), '$1');
const hide   = (html, id) => html.replace(new RegExp(`(<[^>]*id="${id}"[^>]*?)>`), '$1 hidden>');

/* 便签：条目标记照抄 ui.js renderNotes()，含那个固定的微小倾斜 */
const noteLi = (n, i) => `<li class="note note-${n.c}${n.stale ? ' stale' : ''}" style="transform:rotate(${(((i*37)%5)-2)*0.28}deg) translateX(${((i*23)%3)-1}px)">`
  + `<span class="note-grip"></span><button class="note-box" aria-label="完成"></button>`
  + `<textarea class="note-text" rows="1">${esc(n.t)}</textarea>`
  + (n.age ? `<span class="note-age">${n.age}</span>` : '')
  + `<button class="note-x" aria-label="拿走"></button></li>`;

/* desktop.js 启动时会把状态行和灰字从 .pet 里搬进板子底边。
   不照做的话 .pet 自带的那两个占位「—」会在四块屏上全露出来。 */
const SAY = `<p id="say" class="say">${BEHAVIOR_LABEL}</p>`
  + '<p class="behavior"><span id="impulse" class="impulse">· 11 天前那页纸被它折成了兔子，耳朵有些皱。</span></p>';
const petHtml = fill(PET, 'sprite', sprite(ME))
  .replace(/<p id="say"[\s\S]*?<\/p>/, '')
  .replace(/<p class="behavior">[\s\S]*?<\/p>/, '');

let desk = DESK;
desk = fill(desk, 'load', NOTES.length + ' 条便签');
desk = fill(desk, 'notes', NOTES.map(noteLi).join(''));
desk = hide(desk, 'notes-empty');
desk = desk.replace(/(<div class="desk-foot">[\s\S]*?)(<\/div>)/, `$1${SAY}$2`);

/* 回看 · 按天 */
const archDay = (() => {
  let a = fill(ARCH, 'arch-list', DAYS.map(d =>
    `<section class="arch-day"><div class="arch-day-head">`
    + `<b class="arch-day-title">${d.t}</b><span class="arch-day-count">${d.items.length} 件</span></div>`
    + `<ul class="arch-items">` + d.items.map(([c, t]) =>
        `<li class="arch-item arch-${c}"><span class="arch-mark">${CHECK}</span><span class="arch-text">${esc(t)}</span></li>`).join('')
    + `</ul></section>`).join(''));
  a = hide(a, 'arch-empty');
  a = fill(a, 'arch-month-title', `${MONTH.y} 年 ${MONTH.m} 月`);
  return a.replace('id="arch-view-month" class="arch-view-month"', 'id="arch-view-month" class="arch-view-month" hidden');
})();

/* 回看 · 按月 */
const archMonth = (() => {
  const WD = ['日','一','二','三','四','五','六'];
  const lead = new Date(MONTH.y, MONTH.m - 1, 1).getDay();
  const dim  = new Date(MONTH.y, MONTH.m, 0).getDate();
  let cells = WD.map(w => `<span class="arch-month-wd">${w}</span>`).join('');
  for (let i = 0; i < lead; i++) cells += '<span class="arch-month-cell blank"></span>';
  for (let d = 1; d <= dim; d++) {
    const n = MONTH.counts[d] || 0;
    cells += `<span class="arch-month-cell${d === MONTH.today ? ' today' : ''}">`
           + `<b class="arch-month-day">${d}</b>${n ? `<span class="arch-month-n">${n}</span>` : ''}</span>`;
  }
  let a = fill(ARCH, 'arch-month-grid', cells);
  a = fill(a, 'arch-month-title', `${MONTH.y} 年 ${MONTH.m} 月`);
  a = a.replace('id="arch-view-day" class="arch-view-day"', 'id="arch-view-day" class="arch-view-day" hidden');
  a = unhide(a, 'arch-view-month');
  a = a.replace('id="arch-tab-day" class="arch-tab on"', 'id="arch-tab-day" class="arch-tab"');
  a = a.replace('id="arch-tab-month" class="arch-tab"', 'id="arch-tab-month" class="arch-tab on"');
  return a;
})();

/* 图鉴 */
const dex = (() => {
  let d = fill(DEX, 'dex-grid', PROTOS.map(p => {
    const has = OWNED.includes(p.id);
    return `<li class="dex-item${p.id === ME ? ' on' : ''}${has ? '' : ' locked'}">`
      + `<div class="dex-sprite">${sprite(has ? p.id : 'UNKNOWN')}</div>`
      + `<span class="dex-name">${has ? p.name : '???'}</span>`
      + `<span class="dex-kw">${has ? p.keywords.map(w => `<i>${w}</i>`).join('') : ''}</span></li>`;
  }).join(''));
  d = fill(d, 'dex-count', `${OWNED.length} / ${PROTOS.length}`);
  d = fill(d, 'dex-who', `${PROTOS.find(p => p.id === ME).name} · 高级 · 品牌策划`);
  d = fill(d, 'dex-points', '120 分');
  d = fill(d, 'dex-roll', '抽一只（30）');
  return d;
})();

/* ---------- 四块屏，每块一个 iframe，各自是一份完整文档 ----------
   必须这么做：桌面版的样式挂在 body.desktop[data-mode] 上，
   一个页面里没法同时是 panel 又是 big。 */
const frame = (mode, body, w) => {
  const doc = `<!doctype html><html class="desktop" lang="zh-CN"><head><meta charset="utf-8">`
    + `<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="desktop/desktop.css">`
    + `<style>html,body{background:none}body{overflow:hidden}</style></head>`
    + `<body class="desktop" data-mode="${mode}">${body}</body>`
    + `<script src="js/sprites.js"></script><script src="js/scene.js"></script>`
    + `<script>try{window.SCENE.set('${BEHAVIOR}',3,1,${JSON.stringify(PROTOS.find(p => p.id === ME).style || {})});`
    + `window.SCENE.redraw(document.getElementById('props'));}catch(e){}</script></html>`;
  return `<iframe width="${w}" height="620" srcdoc="${doc.replace(/"/g, '&quot;')}" scrolling="no"></iframe>`;
};

const shot = (title, note, el) => `<figure><figcaption><b>${title}</b><span>${note}</span></figcaption>${el}</figure>`;

writeFileSync(path.join(ROOT, 'demo.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>职场生物 · 界面预览</title>
<style>
  body { margin:0; padding:34px 26px 60px; background:#dcdad3;
         font:13px/1.8 -apple-system,'PingFang SC','Hiragino Sans GB',system-ui,sans-serif; color:#35362f; }
  h1 { margin:0 0 6px; font-size:15px; letter-spacing:3px; font-weight:500; }
  p.lead { margin:0 0 30px; font-size:12px; color:#6f6e67; max-width:740px; }
  code { font-size:11px; color:#45573a; }
  .row { display:flex; flex-wrap:wrap; gap:34px; align-items:flex-start; }
  figure { margin:0; display:flex; flex-direction:column; gap:10px; }
  figcaption { display:flex; flex-direction:column; gap:2px; }
  figcaption b { font-size:12px; letter-spacing:2px; font-weight:500; }
  figcaption span { font-size:11px; color:#8d8b83; }
  iframe { border:0; display:block; }
</style></head><body>
<h1>职场生物 · 界面预览</h1>
<p class="lead">
  内容全是编的，跟任何人的真实便签无关，可以直接截图放进 README。<br>
  样式和精灵是项目里的真东西——界面改了跑一次 <code>node tools/make-demo.mjs</code> 就同步。
</p>
<div class="row">
  ${shot('便签', '四条，列表在屏内滚', frame('panel', desk + petHtml, 252))}
  ${shot('回看 · 按天', '按划掉的那天排', frame('big', archDay + petHtml, 284))}
  ${shot('回看 · 按月', '只报每天划掉几件', frame('big', archMonth + petHtml, 284))}
  ${shot('图鉴', '20 只，没抽到的只留剪影', frame('big', dex + petHtml, 284))}
</div>
</body></html>`);
console.log('写好了 demo.html');
