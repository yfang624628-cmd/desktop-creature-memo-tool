(function () {
  'use strict';

  /* 桌面壳 · 渲染进程那一半
   *
   * 浏览器里打开时 window.DESKTOP 不存在，这个文件立刻返回，网页版一个字节都没变。
   *
   * 桌面上的交互规则：
   *   平时      只有它。窗口只有它那么大，别的地方点击一律穿过去
   *   鼠标碰它   便签板浮出来；鼠标挪走，板子收回去
   *   左键单击   板子钉住，要按 × 才收
   *   右键      原生菜单：按天回看 / 图鉴 / 导出导入
   *   按住拖    把它挪到桌面上任何地方，位置记住
   */

  var D = window.DESKTOP;
  if (!D) return;

  /* 桌面形态的样式在这里挂，不写进 index.html：浏览器版根本不会去下载它。
   * 必须在解析阶段就挂上（这个脚本在 </body> 之前跑），晚一步会先闪一帧网页版的排版。 */
  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'desktop/desktop.css';
  document.head.appendChild(css);

  /* 这两个类也必须在解析阶段就打上，不能等 start()：ui.js 的首次渲染在 start() 之前，
     那一刻窗口只有它那么宽，style.css 里给手机的断点会把便签板缩到窗口宽——
     便签被压窄，autosize 就把压窄时的行数写死进高度，之后板子撑开也不会再量一次。 */
  document.documentElement.classList.add('desktop');
  document.body.classList.add('desktop');

  var GRACE = 260;      // 鼠标离开后等这么久再收板子：从它身上挪到板子上要穿过一小段空隙
  var $ = function (s) { return document.querySelector(s); };

  var pinned = false;         // 左键钉住的
  var showing = false;        // 板子这会儿在不在
  var overlaid = false;       // 图鉴 / 回看开着
  var before = null;          // 开浮层之前是什么样，关掉之后还原成这样
  var hideTimer = null;

  /* ---------- 形态 ---------- */

  function currentMode() {
    if ($('#app').hidden) return 'oobe';     // 测评和定型页都算这个
    if (overlaid) return 'big';
    return showing ? 'panel' : 'pet';
  }

  function apply() {
    var m = currentMode();
    document.body.dataset.mode = m;
    document.body.classList.toggle('pinned', pinned);
    D.mode(m);
    reportHot();
  }

  /* 把此刻「实心」的那几块报给主进程。窗口改尺寸是异步的，报早了量到的是旧布局，
   * 所以除了状态一变就报，还挂了 resize 和一个兜底的轮子——便签越写越长也要跟着更新。 */
  function reportHot() {
    var rects = [];
    var push = function (el) {
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (r.width && r.height) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    var m = currentMode();
    if (m === 'oobe' || m === 'big') {
      rects.push({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
    } else {
      push($('.layer-pet'));
      if (showing) push($('.desk'));
    }
    D.hot(rects);
  }

  /* ---------- 板子的显隐 ---------- */

  function show() {
    clearTimeout(hideTimer);
    if (showing) return;
    showing = true;
    apply();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (pinned || overlaid) return;
      // 正在写字的时候绝不收：手指还在键盘上，板子没了字也就没了
      var a = document.activeElement;
      if (a && a.classList && a.classList.contains('note-text')) return;
      showing = false;
      apply();
    }, GRACE);
  }

  function unpin() {
    pinned = false;
    showing = false;
    apply();
  }

  /* ---------- 拖着它走 ---------- */

  function bindPet() {
    var pet = $('.layer-pet');
    if (!pet) return;

    pet.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var sx = e.screenX, sy = e.screenY, moved = false;
      document.body.classList.add('dragging');
      D.drag('start');

      function move(ev) {
        if (!moved && Math.abs(ev.screenX - sx) + Math.abs(ev.screenY - sy) > 4) moved = true;
        if (moved) D.drag('move');
      }
      function up() {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        document.body.classList.remove('dragging');
        D.drag('end');
        // 没挪动 = 这是一次单击，不是一次拖动
        if (!moved) {
          if (pinned) unpin();
          else { pinned = true; show(); D.focus(); }
        }
      }
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    });

    pet.addEventListener('contextmenu', function (e) { e.preventDefault(); D.menu(); });
  }

  /* ---------- 右键菜单接到现成的按钮上 ----------
   * 这几件事网页版里都已经有按钮了（只是在桌面形态下被藏起来了）。
   * 直接点它们，逻辑一份，不复制。 */

  var MENU = {
    arch:   '#open-arch',
    dex:    '#open-dex',
    export: '#save-export',
    import: '#save-import'
  };

  /* ---------- 装上 ---------- */

  function watchHidden(sel, fn) {
    var node = $(sel);
    if (!node) return;
    new MutationObserver(function () { fn(); })
      .observe(node, { attributes: true, attributeFilter: ['hidden'] });
  }

  function start() {
    bindPet();

    // 碰没碰到它由主进程说了算（它轮询全局光标位置，不看谁在前台）
    D.onHover(function (on) {
      if (on) show();
      else if (!pinned) scheduleHide();
    });

    window.addEventListener('resize', reportHot);
    setInterval(reportHot, 500);   // 便签写长了、图鉴开了，实心区域会变

    /* 把「它说的话」和「它在干嘛」挪进便签板的底边。
     * 留在原地的话这两行是浮在桌面上的——深色壁纸上的 11px 浅灰字，
     * 加多少层描边柔光都读不了。板子自己是实心的，字落上去天然可读；
     * 而板子的底边就贴着它的头顶，话看上去还是从它那儿出来的。
     * ui.js 一直是按 id 找这两个节点更新的，搬家不影响它写字。 */
    var foot = $('.desk-foot');
    if (foot) {
      if ($('.say')) foot.appendChild($('.say'));
      if ($('.behavior')) foot.appendChild($('.behavior'));
      if ($('.weather')) foot.appendChild($('.weather'));   // 同理，天气那行也不能留在壁纸上
    }

    // 便签板钉住时右上角那个 ×（网页版不需要，所以不在 index.html 里）
    var head = $('.desk-head');
    if (head) {
      var x = document.createElement('button');
      x.className = 'desk-close';
      x.setAttribute('aria-label', '收起');
      x.innerHTML = '<svg width="10" height="10" viewBox="0 0 5 5" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">'
        + '<rect x="0" y="0" width="1" height="1"/><rect x="1" y="1" width="1" height="1"/><rect x="2" y="2" width="1" height="1"/>'
        + '<rect x="3" y="3" width="1" height="1"/><rect x="4" y="4" width="1" height="1"/><rect x="4" y="0" width="1" height="1"/>'
        + '<rect x="3" y="1" width="1" height="1"/><rect x="1" y="3" width="1" height="1"/><rect x="0" y="4" width="1" height="1"/></svg>';
      x.addEventListener('click', unpin);
      head.appendChild(x);
    }

    /* 桌面版是一份新的存档，浏览器里养的那只不会自己跟过来。
     * 而「导入存档」原本只藏在图鉴里——图鉴要先有生物才打得开，第一次进来根本够不着。
     * 所以测评页上补一个入口：不想重做一遍三道题的人，从这儿把它搬进来。 */
    if ($('#oobe')) {
      var carry = document.createElement('button');
      carry.className = 'oobe-carry';
      carry.textContent = '已经有它了，导入存档';
      carry.addEventListener('click', function () { $('#save-import').click(); });
      $('#oobe').appendChild(carry);
    }

    D.onMenu(function (action) {
      var btn = $(MENU[action]);
      if (!btn) return;
      // 不用先把板子支起来：浮层一开，形态就是 big，跟板子在不在无关
      D.focus();
      btn.click();
    });

    // 测评做完（#app 露出来）、图鉴或回看开关——形态跟着变，不用去改 ui.js
    watchHidden('#app', apply);
    watchHidden('#dex', syncOverlay);
    watchHidden('#arch', syncOverlay);

    apply();
  }

  /* 图鉴和回看是「盖上去看一眼」的东西，关掉之后要回到打开它之前的样子：
   * 从右键菜单进来的，看完就只剩它自己站着；从板子上进去的，看完板子还在。
   * 以前是不管从哪进来都强行钉住板子，于是右键看完图鉴，桌上凭空多一块板。 */
  function syncOverlay() {
    var now = !$('#dex').hidden || !$('#arch').hidden;
    if (now !== overlaid) {
      if (now) before = { pinned: pinned, showing: showing };
      else if (before) { pinned = before.pinned; showing = before.showing; before = null; }
      overlaid = now;
    }
    apply();
  }

  // ui.js 的 DOMContentLoaded 先注册，boot() 已经跑完，这时 #app 的显隐是准的
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
