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

  // 摸鱼摸出一条真鱼：身子一个菱形，尾巴在右边分叉，跟其他道具一样不描边、整块画
  var FISH = [
    '..##...',
    '.####.#',
    '######.',
    '.####.#',
    '..##...'
  ];

  var BOWL = [
    '.#######.',
    '#########',
    '#########',
    '..#####..'
  ];

  // 闲着的那杯茶：凉了，没人管，搁在那儿。跟 BOWL 一样实心，但不冒热气——
  // 这个状态本来就是「什么都没在干」，道具可以在，但不能动，一动就不是闲着了
  var MUG = [
    '.####.',
    '#####.',
    '######',
    '#####.',
    '.####.'
  ];

  /* 锅：盖和身分开画，盖才能被顶得一跳一跳——锅在烧，光冒气跟 BOWL 那碗饭分不开。
   * 除了把手那一行，其余各行一律齐平：宽度一路 2→8→10→6→4 地跳，读出来是个蘑菇不是锅。
   * 把手各探出 2 格（只探 1 格是毛刺），盖靠上面那颗钮认，不靠比锅身宽。 */
  var POT_LID = [
    '....##....',
    '..######..'
  ];
  // 把手不放在最上面一行：盖一跳，满宽的那行就跟锅身断开，单看像张桌子。
  // 挪到中段，盖子就是从同宽的锅沿上抬起来的。
  var POT_BODY = [
    '..######..',
    '##########',
    '..######..',
    '..######..'
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

  // 通勤：车厢一个实心方块，两个窗、两个轮子探出底边。车不动，甩在后面的速度线动
  var BUS = [
    '.######.',
    '#++++++#',
    '#++++++#',
    '########',
    '.#....#.'
  ];

  /* 月亮：加班和失眠共用的「这会儿是深夜」标记。四角对称削会读成十字——
   * 试过 '.##.'/'####'/'####'/'.##.'，四个角一样缺，正好是十字的定义。
   * 只削一个角，不对称，才不会拼出那个形状，顺便像缺了一块的月亮。 */
  var MOON = [
    '.##',
    '###',
    '###'
  ];

  // 电视：天线是两撇朝外斜的短划，光靠矩形加屏幕会跟 LAPTOP 撞脸，这个尖角是唯一的区分点
  var TV = [
    '.######.',
    '#++++++#',
    '#++++++#',
    '#++++++#',
    '########'
  ];

  // 被子：一个隆起的实心块。呼吸靠它整体上下移一格，不靠形状变化
  var BLANKET = [
    '..######..',
    '.########.',
    '##########'
  ];

  // 摊开的书：中缝留空，两页各画一半。翻页角在左右页之间切换
  var BOOK = [
    '.##.##.',
    '#++.++#',
    '#++.++#',
    '#++.++#',
    '#######'
  ];

  // 小闹钟：跟 LAPTOP 一样，边框实心、表盘是亮的屏幕色。表针是一个暗点在盘面上移动——
  // 跟 MINI_LAPTOP 屏幕上那个敲字的点是同一套手法，不是新发明一种「亮点叠亮点」会糊掉的画法。
  var CLOCK = [
    '.####.',
    '#++++#',
    '#++++#',
    '#++++#',
    '.####.'
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

  // 通勤：车不动，甩在车后的速度线跟着窗户的高度一格格换，读成「车在往前冲」
  function drawCommute(f) {
    var top = FLOOR - BUS.length + 1;
    blitFloor(BUS, PROP_COL + 1);
    var row = top + 1 + (f % 3);
    put(PROP_COL - 1, row, false);
    put(PROP_COL - 2, row, false);
  }

  // 加班：还是那台电脑，肩上多一个月亮——这个点了还在打，才是加班和深度工作的区别
  function drawOvertime(f) {
    drawLaptop(f);
    // 隔开两行空的再画月亮——贴着电脑顶边画会跟顶边糊成一个奇怪的缺角，得留出「浮在半空」的距离
    blit(MOON, PROP_COL + 3, FLOOR - LAPTOP.length - MOON.length - 2);
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

  /* 摸鱼：不用手机演了，干脆真的有条鱼在旁边游——这个词本来就是这么来的。
   * 飘在半空、不贴地：它是凭空游过来的，不是桌上的东西，这点不实反而是这只鱼的笑点。 */
  function drawFish(f) {
    var DX = [0, 1, 2, 1, 0, -1, -2, -1];
    var DY = [0, 0, 1, 0, 0, 0, -1, 0];
    var s = Math.floor(f / 2) % DX.length;         // 比其他道具慢半拍，像悠游不像乱窜
    blit(FISH, PROP_COL + 1 + DX[s], FLOOR - FISH.length - 2 + DY[s]);
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

  // 做饭：锅盖被里面顶得一跳一跳，蒸汽从盖钮那儿往上走
  function drawCooking(f) {
    blitFloor(POT_BODY, PROP_COL);
    var bodyTop = FLOOR - POT_BODY.length + 1;
    var jump = (f % 5) === 0 ? 1 : 0;                // 五帧顶一下，一直跳就成了没盖严
    var lidTop = bodyTop - POT_LID.length - jump;
    blit(POT_LID, PROP_COL, lidTop);

    var drift = [0, 1, 2, 1];
    for (var i = 0; i < 3; i++) {
      var x = PROP_COL + 4 + drift[(f + i) % 4];
      put(x, lidTop - 1 - i, true);
      put(x + 1, lidTop - 1 - i, true);
    }
  }

  // 闲着：那杯茶就搁在那儿，没有第二个动作
  function drawMug() {
    blitFloor(MUG, PROP_COL + 2);
  }

  // 睡着：Z 一个一个升上去。间距必须拉开，挨太近三个 Z 会连成一条锯齿链
  function drawSleep(f) {
    for (var i = 0; i < 2; i++) {
      var age = (f - i * 5) % 10;
      if (age < 0 || age > 4) continue;
      blit(ZED, PROP_COL + 2 + age * 2, FLOOR - 5 - age * 2);
    }
  }

  // 醒着但没起：不能冒 Z——那是睡着专属的。换成被子整体起伏，读成呼吸
  function drawLingering(f) {
    var top = FLOOR - BLANKET.length + 1;
    var breathe = (f % 8) < 4 ? 0 : 1;
    blit(BLANKET, PROP_COL + 1, top - breathe);
  }

  // 失眠：被子还在，月亮挂着，Z 才冒一半就掉回去——想睡但没睡着，
  // 跟 drawSleep 那一串完整升上去的 Z 得是明显不一样的节奏
  function drawInsomnia(f) {
    var top = FLOOR - BLANKET.length + 1;
    blit(BLANKET, PROP_COL + 1, top);
    blit(MOON, PROP_COL + 6, top - 6);
    var age = f % 10;
    if (age < 3) blit(ZED, PROP_COL + 4 + age, top - 2 - age);
  }

  // 下班恢复：窝着看电视，画面里有个东西慢慢挪，不是信号中断的静止画面
  function drawTV(f) {
    var top = FLOOR - TV.length + 1;
    blitFloor(TV, PROP_COL);
    put(PROP_COL, top - 2, false);          // 天线两撇，往两边斜着支出去
    put(PROP_COL + 1, top - 1, false);
    put(PROP_COL + 7, top - 2, false);
    put(PROP_COL + 6, top - 1, false);

    var x = f % 5;
    put(PROP_COL + 1 + x, top + 2, false);
    put(PROP_COL + 2 + x, top + 2, false);
  }

  // 忙自己的事：翻书，折角在左右页之间慢慢切换。节奏比写字慢得多——读东西不赶
  function drawReading(f) {
    var top = FLOOR - BOOK.length + 1;
    blitFloor(BOOK, PROP_COL + 1);
    var onRight = (f % 16) < 8;
    put(PROP_COL + 1 + (onRight ? 5 : 1), top + 1, false);
  }

  // 在想明天：表针在亮着的盘面上慢慢走一圈，不是真的看时间，只是偶尔想起
  function drawThinking(f) {
    var top = FLOOR - CLOCK.length + 1;
    blitFloor(CLOCK, PROP_COL + 2);
    var hand = [[2, 1], [4, 2], [2, 3], [1, 2]];
    var p = hand[Math.floor(f / 3) % hand.length];
    put(PROP_COL + 2 + p[0], top + p[1], false);
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
    A07: drawFish,
    A08: drawBowl,
    A09: drawSleep,
    A10: drawTV,
    A13: drawCommute,
    A14: drawOvertime,
    A15: drawInsomnia,
    A16: drawCooking,
    // 三顿饭共用一只碗：状态栏已经写明是哪顿，再画三种相似的食物只会更难分
    A17: drawBowl,
    A18: drawBowl,
    W01: drawSleep,
    W02: drawLingering,
    W03: drawReading,
    W04: drawMug,
    W05: drawThinking
  };

  // 打电脑和写字的时候，生物本体会跟着小幅抖——这是「在动手」的关键
  var BUSY = { A03: 1, A04: 1, A05: 1, A14: 1 };

  // 真的睡着的状态——跟这两个共用 drawSleep 的 Z 是同一个判断标准。
  // 失眠（A15）不算：它就是没睡着，眼睛不该被强制闭上
  var SLEEP = { A09: 1, W01: 1 };

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

    // 真睡着的时候眼睛该一直闭着，不是眨一下——ui.js 画本体眼睛时读这个
    isAsleep: function () { return !!SLEEP[state.behavior]; },

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
