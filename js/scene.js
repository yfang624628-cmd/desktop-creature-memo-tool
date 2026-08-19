/* 职场生物 · 场景层
 *
 * 20 个原型不可能各画一套「在打电脑」的帧——那是 20 倍的工作量。
 * 所以生物本体一格不改，动的是它旁边的东西：电脑屏在闪、笔在纸上走、便签从天上掉下来。
 * 这也是 Tamagotchi 的老办法——角色是一个 sprite，道具是另一个，动画是它们之间的关系。
 *
 * 舞台 34×17 格：便签堆在左，生物在中（第 9 列起），道具在右（第 25 列起）。
 * '#' = 实心   '+' = 浅色（屏幕光 / 纸上的字）   '.' = 空
 */
(function (global) {
  'use strict';

  var W = 38, H = 22;
  var PET_COL = 10;         // 生物左上角所在列
  var PET_ROW = 5;          // 上面空出 5 行给念头飘
  var FLOOR   = 20;         // 生物脚底 / 道具底边所在行
  var PROP_COL = 27;
  var STACK_COL = 0;

  /* ---------- 道具 ----------
   * 全部用实心块，不用描边。6px 一格的细描边只读得出「一个方框」，
   * 而生物本体是很重的剪影，道具太轻就完全打不过它。
   */

  var LAPTOP = [
    '.########.',
    '.#++++++#.',
    '.#++++++#.',
    '.#++++++#.',
    '.#++++++#.',
    '.########.',
    '##########',
    '.########.'
  ];
  // 屏幕上的字，画在 laptop 的 (col 2, row 1) 起 6×4 区域。'#' 是字，'.' 是屏幕底光。
  // 字必须短——盖满一半屏幕就不像字了，像一块脏东西。
  var LAPTOP_TEXT = [
    ['##....', '###...', '#.....', '......'],
    ['###...', '##....', '##....', '......'],
    ['##....', '###...', '###...', '#.....'],
    ['###...', '#.....', '##....', '##....'],
    ['#.....', '###...', '##....', '###...'],
    ['##....', '##....', '###...', '#.....']
  ];

  // 纸内部是浅色实心的。空心的话，写上去的字会跟边框糊成一团。
  var PAPER = [
    '##########',
    '#++++++++#',
    '#++++++++#',
    '#++++++++#',
    '#++++++++#',
    '#++++++++#',
    '##########'
  ];

  /* 5×9：屏幕占满上半身，下面三行实心边框放 Home 键。
   * Home 键和屏幕之间必须隔一整行实心的，否则两块浅色会连成一片。 */
  var PHONE = [
    '#####',
    '#+++#',
    '#+++#',
    '#+++#',
    '#+++#',
    '#+++#',
    '#####',
    '##+##',
    '#####'
  ];

  var BOWL = [
    '.#######.',
    '#########',
    '#########',
    '..#####..'
  ];

  // 尾巴朝左下——指着生物那边，否则读起来是个显示器不是气泡
  var BUBBLE = [
    '.########.',
    '#++++++++#',
    '#++++++++#',
    '#++++++++#',
    '#++++++++#',
    '.########.',
    '.##.......',
    '##........'
  ];

  /* 小电脑：比 LAPTOP 小一圈，只有屏幕和一条底座。
   * 它不是「在打电脑」那个状态的道具——那个是大的。这个是它写着写着切过去敲两下，
   * 所以必须一眼看出来更小，不然就跟 A05 混了。 */
  var MINI_LAPTOP = [
    '.####.',
    '.#++#.',
    '.#++#.',
    '.####.',
    '######'
  ];

  var ZED = [
    '###',
    '..#',
    '.#.',
    '#..',
    '###'
  ];

  var NOTE = [
    '########',
    '#......#',
    '########'
  ];

  // 一张纸从侧面看就是一条边。不加抖动——加了就变成楼梯，不是一摞。
  var STACK_NOTE = [
    '########',
    '#......#'
  ];

  // 念头：浅色的泡泡。跟深色实心的纸堆是一对反义词——纸有重量、会把它压弯，念头没有。
  var BUBBLE_L = [
    '.++.',
    '+..+',
    '+..+',
    '.++.'
  ];
  var BUBBLE_S = [
    '.+.',
    '+.+',
    '.+.'
  ];
  var BUBBLE_DOT = ['++', '++'];

  // 固定落点，不随帧跳。大小交替，看起来才像一簇而不是一排
  var BUBBLE_SLOTS = [
    [2, 3], [7, 0], [12, 2], [17, 0], [22, 3], [27, 1], [32, 3], [34, 0]
  ];
  var DRIFT_Y = [0, 0, -1, -1, -1, 0, 0, 1, 1, 1];
  var DRIFT_X = [0, 1, 1, 0, 0, -1, -1, 0];

  /* ---------- 画笔 ---------- */

  var cells;   // 本帧要画的格子：{x, y, lit}

  function put(x, y, lit) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    cells.push({ x: x, y: y, lit: !!lit });
  }

  // art 用 '#'/'+' 描述形状，(ox, oy) 是它左上角在舞台上的位置
  function blit(art, ox, oy) {
    for (var y = 0; y < art.length; y++) {
      for (var x = 0; x < art[y].length; x++) {
        var ch = art[y].charAt(x);
        if (ch === '.') continue;
        put(ox + x, oy + y, ch === '+');
      }
    }
  }

  // 底边贴地
  function blitFloor(art, ox) { blit(art, ox, FLOOR - art.length + 1); }

  /* ---------- 各个场景 ---------- */

  // 打电脑：屏幕上的字一行行往下滚
  function drawLaptop(f) {
    var top = FLOOR - LAPTOP.length + 1;
    blitFloor(LAPTOP, PROP_COL);
    var s = LAPTOP_TEXT[f % LAPTOP_TEXT.length];
    for (var y = 0; y < s.length; y++)
      for (var x = 0; x < s[y].length; x++)
        if (s[y].charAt(x) === '#') put(PROP_COL + 2 + x, top + 1 + y, false);
  }

  // 一行字：隔一格画一格。整行填满会读成一条实心杠，不像字
  function textRow(row, from, to) {
    for (var x = from; x <= to; x++) if (x % 2) put(PROP_COL + x, row, false);
  }

  // 笔：画在纸面上方，两格斜线。压在纸里会跟字糊在一起
  function pen(top, x) {
    put(PROP_COL + x, top - 1, false);
    put(PROP_COL + x + 1, top - 2, false);
  }

  // 写东西：笔一格一格往右走，走过的地方长出字；写满三行就翻篇重来
  function drawWriting(f) {
    var top = FLOOR - PAPER.length + 1;
    blitFloor(PAPER, PROP_COL);

    var LINES = 3, SPAN = 9;
    var step = f % (LINES * SPAN + 4);
    var line = Math.min(Math.floor(step / SPAN), LINES - 1);
    var done = step >= LINES * SPAN;
    var head = done ? 8 : step % SPAN;
    var rowOf = function (i) { return top + 1 + i * 2; };

    for (var r = 0; r < line; r++) textRow(rowOf(r), 1, 8);   // 写完的行
    textRow(rowOf(line), 1, Math.min(head, 8));               // 正在写的行
    if (!done && head > 0) pen(top, head);
  }

  // 改稿：字早就写满了，笔从右往左把中间那行划掉，划完又重新出现
  function drawRevising(f) {
    var top = FLOOR - PAPER.length + 1;
    blitFloor(PAPER, PROP_COL);
    var rows = [top + 1, top + 3, top + 5];
    for (var r = 0; r < rows.length; r++) textRow(rows[r], 1, 8);

    var step = f % 13;
    if (step < 9) {
      var head = 8 - step;
      for (var i = head; i <= 8; i++) put(PROP_COL + i, rows[1], false);   // 划掉中间那行
      pen(top, head);
    }
  }

  // 它中途切去电脑上敲两下。屏幕里那一点在动，不然就是个静止的方块
  function drawMiniLaptop(f) {
    var top = FLOOR - MINI_LAPTOP.length + 1;
    blitFloor(MINI_LAPTOP, PROP_COL + 2);          // 比正经道具窄，居中放，看得出是临时支起来的
    put(PROP_COL + (f % 4 < 2 ? 4 : 5), top + 1 + (f % 4 < 2 ? 0 : 1), false);
  }

  // 开会：气泡里的省略号一直在走，但一直没走到结论
  function drawMeeting(f) {
    var top = FLOOR - BUBBLE.length + 1;
    blitFloor(BUBBLE, PROP_COL);
    var lit = f % 5;
    for (var i = 0; i < 3; i++) {
      if (i >= lit) continue;
      put(PROP_COL + 3 + i * 2, top + 2, false);   // 隔一格一个点，挨着会连成一条杠
      put(PROP_COL + 3 + i * 2, top + 3, false);
    }
  }

  /* 摸鱼：屏幕上的内容一条条往上滚。每条长短不一，才像内容不像进度条。 */
  function drawPhone(f) {
    var top = FLOOR - PHONE.length + 1;
    blitFloor(PHONE, PROP_COL + 3);
    var feed = [1, 1, 0, 1, 0, 0];                 // 一段内容、一段空隙，循环着往上走
    for (var y = 0; y < 5; y++) {
      if (!feed[(y + f) % feed.length]) continue;
      var w = ((y + f) % 3) ? 3 : 2;
      for (var x = 0; x < w; x++) put(PROP_COL + 4 + x, top + 1 + y, false);
    }
  }

  // 吃饭：冒热气
  function drawBowl(f) {
    blitFloor(BOWL, PROP_COL + 1);
    var top = FLOOR - BOWL.length + 1;
    var drift = [0, 1, 2, 1];
    for (var i = 0; i < 3; i++) {
      var x = PROP_COL + 4 + drift[(f + i) % 4];
      put(x, top - 1 - i, true);
      put(x + 1, top - 1 - i, true);
    }
  }

  // 睡着：Z 一个一个升上去。间距必须拉开，挨太近三个 Z 会连成一条锯齿链
  function drawSleep(f) {
    for (var i = 0; i < 2; i++) {
      var age = (f - i * 5) % 10;
      if (age < 0 || age > 4) continue;
      blit(ZED, PROP_COL + 2 + age * 2, FLOOR - 5 - age * 2);
    }
  }

  /* ---------- 便签堆：手里拿着几件，桌上就堆几张 ---------- */

  function drawStack(open) {
    var n = Math.min(open, 8);
    for (var i = 0; i < n; i++) blit(STACK_NOTE, STACK_COL, FLOOR - 1 - i * 2);
  }

  /* ---------- 念头：飘着的泡泡，也是最多 8 个 ---------- */

  var PUFF_MS = 560;

  function drawBubbles(f, ideas, puffAt) {
    var n = Math.min(ideas, BUBBLE_SLOTS.length);
    var pop = puffAt ? (Date.now() - puffAt) / PUFF_MS : 2;   // >1 表示已经结束

    for (var i = 0; i < n; i++) {
      var s = BUBBLE_SLOTS[i];
      // 两个漂移周期互质，合起来才不会看出规律
      var dy = DRIFT_Y[(Math.floor(f / 2) + i * 3) % DRIFT_Y.length];
      var dx = DRIFT_X[(Math.floor(f / 3) + i * 2) % DRIFT_X.length];
      var art = (i % 2) ? BUBBLE_S : BUBBLE_L;

      // 刚记下的那个：从下面升上来，同时一级级张开。
      // 只换大小是看不出来的——2×2 的点和 3×3 的圈亮着的格子一样多。
      if (i === n - 1 && pop < 1) {
        dy += Math.round(4 * (1 - pop));
        art = pop < 0.34 ? BUBBLE_DOT : (pop < 0.67 ? BUBBLE_S : art);
      }

      blit(art, s[0] + dx, s[1] + dy);
    }
  }

  // 新贴的那张：从天上掉到堆顶
  function drawDrop(progress, open) {
    var landY = FLOOR - 2 - Math.min(Math.max(open - 1, 0), 7) * 2;
    var startY = -3;
    var y = Math.round(startY + (landY - startY) * progress);
    blit(NOTE, STACK_COL, y);
  }

  /* ---------- 调度 ---------- */

  var SCENES = {
    A01: null,          // 待机：桌上什么也没有
    A02: drawMeeting,
    A03: drawWriting,
    A04: drawRevising,
    A05: drawLaptop,
    A06: drawMeeting,
    A07: drawPhone,
    A08: drawBowl,
    A09: drawSleep,
    A10: drawPhone,
    W01: drawSleep,
    W02: drawSleep,
    W03: drawWriting,
    W04: null,
    W05: null
  };

  // 打电脑和写字的时候，生物本体会跟着小幅抖——这是「在动手」的关键
  var BUSY = { A03: 1, A04: 1, A05: 1 };

  // chatter 会在这两个状态里切去敲电脑。A05 本来画的就是电脑，再换一台小的只会看着像闪
  var CHATTER_SWAP = { A03: 1, A04: 1 };

  /* ---------- 性格：只改变过程，不改变结果 ----------
   * pace  换动作的频率     —— 不影响任务时长与消耗
   * quirk 演出时的小动作   —— 不含任何数值
   */
  var PACE_DIV = { slow: 3, quick: 2, burst: 1 };   // 场景帧每 N 个 tick 走一格

  // quirk = pause：做一会儿就停很久。停的时候画面定住，身体也不抖。
  var PAUSE_CYCLE = 26, PAUSE_HOLD = 11;

  var state = {
    behavior: 'A01',
    open: 0,
    ideas: 0,
    frame: 0,
    dropAt: 0,
    puffAt: 0,
    pace: 'quick',
    quirk: 'none'
  };

  // 它此刻是不是正停着（quirk=pause 专用）
  function paused() {
    return state.quirk === 'pause' && BUSY[state.behavior]
        && (state.frame % PAUSE_CYCLE) >= PAUSE_CYCLE - PAUSE_HOLD;
  }

  var DROP_MS = 620;
  var sub = 0;

  function draw(host) {
    cells = [];
    var f = state.frame;

    drawStack(state.open);
    drawBubbles(f, state.ideas, state.puffAt);

    var now = Date.now();
    if (state.dropAt && now - state.dropAt < DROP_MS) {
      drawDrop((now - state.dropAt) / DROP_MS, state.open);
    }

    var fn = SCENES[state.behavior];
    // quirk=pause：动作定在停下来的那一帧，不是不画
    if (fn && paused()) f = state.frame - (state.frame % PAUSE_CYCLE) + (PAUSE_CYCLE - PAUSE_HOLD) - 1;

    /* quirk=chatter：它爱搭话，但不是每件事都在出声。
     * 开会、对齐这种本来就在讲话的，主道具已经是气泡了，不用再加一个。
     * 写东西、改稿这种不出声的，原来也冒气泡——那是错的，它没在跟谁说话。
     * 改成时不时切去电脑上敲两下，而且是「换掉纸」不是「盖在纸上」：
     * 所有道具都画在同一个位置，叠上去两样东西会糊成一团。 */
    if (state.quirk === 'chatter' && CHATTER_SWAP[state.behavior] && (state.frame % 14) < 5) {
      drawMiniLaptop(state.frame);
    } else if (fn) {
      fn(f);
    }

    var frag = document.createDocumentFragment();
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var d = document.createElement('i');
      if (c.lit) d.className = 'lit';
      d.style.gridArea = (c.y + 1) + '/' + (c.x + 1);
      frag.appendChild(d);
    }
    host.innerHTML = '';
    host.appendChild(frag);
  }

  global.SCENE = {
    W: W, H: H, PET_COL: PET_COL, PET_ROW: PET_ROW,

    set: function (behavior, open, ideas, style) {
      state.behavior = behavior;
      state.open = open;
      state.ideas = ideas || 0;
      if (style) { state.pace = style.pace; state.quirk = style.quirk; }
    },

    drop: function () { state.dropAt = Date.now(); },
    puff: function () { state.puffAt = Date.now(); },

    // 停下来的时候身体也不该抖
    isBusy: function () { return !!BUSY[state.behavior] && !paused(); },

    // 每 100ms 调一次，场景帧走得慢一些——便签下落需要足够多的中间帧，
    // 否则会看成瞬移；而屏幕闪字走太快就成了噪点。
    // pace 只改这个分频，不碰任何时长与消耗。
    tick: function (host) {
      sub++;
      if (sub % (PACE_DIV[state.pace] || 2) === 0) state.frame++;
      draw(host);
    },

    redraw: function (host) { draw(host); }
  };
})(window);
