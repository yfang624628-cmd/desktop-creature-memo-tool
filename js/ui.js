/* 职场生物 · 渲染与交互（桌宠 + 便签版）
 *
 * 与网页版的区别：没有操作按钮、没有属性条、没有日程表、没有分享。
 * 界面只有三块——它、你交给它的东西、它说过的话。
 */
(function () {
  'use strict';

  var E = window.Engine, C = null;
  var live = false;                   // 是否已定型。定型前不写盘，否则重抽中途刷新会把没确认的那只存下来
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = function (t, cls, txt) {
    var n = document.createElement(t);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };

  /* ---------- 像素角色 ---------- */

  var blinkUntil = 0;

  /* 可动部件。生物本体的轮廓一格不改，动的是 sprites 里 idle / take 标出的那几个格子——
   * 马克杯的热气、（将来）猫的尾巴、章鱼的触手。不画新帧，只开关像素。 */
  var partAt = 0;          // 待机动作当前帧
  var partBurst = null;    // { frames, stepMs, at } —— 接便签这类一次性动作

  function partCells(sp) {
    var out = [];
    if (partBurst && sp[partBurst.name]) {
      var b = sp[partBurst.name];
      var i = Math.floor((Date.now() - partBurst.at) / b.stepMs);
      if (i < b.frames.length) return b.frames[i];
      partBurst = null;                                   // 放完了，回待机
    }
    if (sp.idle) out = sp.idle.frames[partAt % sp.idle.frames.length];
    return out;
  }

  function paintSprite(host, protoId) {
    var sp = window.SPRITES[protoId];
    host.innerHTML = '';
    if (!sp) return;
    var blinking = Date.now() < blinkUntil;
    var grid = sp.body.map(function (r) { return r.split(''); });
    if (!blinking) sp.eyes.forEach(function (p) { if (grid[p[0]]) grid[p[0]][p[1]] = '.'; });
    (sp.mouth || []).forEach(function (p) { if (grid[p[0]]) grid[p[0]][p[1]] = '.'; });
    partCells(sp).forEach(function (p) { if (grid[p[0]]) grid[p[0]][p[1]] = '#'; });

    var frag = document.createDocumentFragment();
    for (var y = 0; y < grid.length; y++) {
      for (var x = 0; x < grid[y].length; x++) {
        if (grid[y][x] !== '#') continue;
        var d = el('i');
        d.style.gridArea = (y + 1) + '/' + (x + 1);
        frag.appendChild(d);
      }
    }
    host.appendChild(frag);
  }

  // 待机动作自己的节拍，跟眨眼、跟场景层都不同步——同步了就会看出机械感
  function schedulePart() {
    var sp = C && window.SPRITES[C.prototypeId];
    var ms = (sp && sp.idle && sp.idle.stepMs) || 500;
    setTimeout(function () { partAt++; drawSprite(); schedulePart(); }, ms);
  }

  function burst(name) {
    var sp = C && window.SPRITES[C.prototypeId];
    if (!sp || !sp[name]) return;
    partBurst = { name: name, at: Date.now() };
    var total = sp[name].frames.length * sp[name].stepMs;
    var tick = setInterval(drawSprite, sp[name].stepMs / 2);
    setTimeout(function () { clearInterval(tick); drawSprite(); }, total + 60);
  }

  function drawSprite() { if (C) paintSprite($('#sprite'), C.prototypeId); }

  function scheduleBlink() {
    setTimeout(function () {
      blinkUntil = Date.now() + 140;
      drawSprite();
      setTimeout(drawSprite, 150);
      scheduleBlink();
    }, 2600 + Math.random() * 4200);
  }


  /* ---------- 即兴文案 ----------
   * 这一层只组装「说什么」，key 在主进程。
   * 便签原文不出这台电脑：模型写带 {text} 的模板，engine 本地填。 */

  var riffBusy = false;

  /* 有 json_schema 就用 {lines:[]}，没有就按行拆（别家会忽略那个参数）。 */
  function linesFrom(res) {
    if (!res || !res.ok) return [];
    if (res.data && res.data.lines && res.data.lines.length) return res.data.lines;
    return String(res.raw || '')
      .split(/\n+/)
      .map(function (t) {
        return t.trim()
          .replace(/^\s*(?:\d+[.、)]|[-*•])\s*/, '')
          .replace(/^[「『"']|[」』"']$/g, '')
          .trim();
      })
      .filter(function (t) { return t.length >= 4 && t.length <= 40; });
  }

  function shapeOfLoad() {
    // 只送形状分布，不送任何一条原文
    var open = E.loadNotes(C), by = {};
    open.forEach(function (n) {
      var k = (n.cls && n.cls.kind) || 'desk';
      by[k] = (by[k] || 0) + 1;
    });
    var names = window.GAME_DATA.classify.schema.kind, out = [];
    for (var k in by) out.push((names[k] || k) + ' ' + by[k]);   // 值是中文串，直接用
    return out.join('、') || '空着';
  }

  function riffUserBlock(now) {
    var p = E.PROTO(C.prototypeId), job = E.JOB(C.jobId);
    var lv = window.GAME_DATA.rules.levels[C.levelId];
    var open = E.loadNotes(C);
    var today = E.dateKey(now);
    var addedToday = (C.notes || []).filter(function (n) { return n.text && E.dateKey(n.createdAt) === today; }).length;
    var doneToday = (C.done || []).filter(function (d) { return E.dateKey(d.doneAt) === today; }).length;
    var oldest = 0;
    open.forEach(function (n) { oldest = Math.max(oldest, Math.floor((now - n.createdAt) / 86400000)); });

    return [
      '物种：' + p.name,
      '性格：' + p.keywords.join('、'),
      '调子：' + p.tone,
      '职位：' + (job ? job.name : '—'),
      '职级：' + ((lv && lv.name) || C.levelId),
      '今天：' + ['周日','周一','周二','周三','周四','周五','周六'][new Date(now).getDay()],
      '它手边替人拿着 ' + open.length + ' 件，形状是：' + shapeOfLoad(),
      '最老的那件放了 ' + oldest + ' 天',
      '今天新接了 ' + addedToday + ' 件，划掉了 ' + doneToday + ' 件'
    ].join('\n');
  }

  /* 每天一次，纯自动，全程静默。没 key / 断网 / 失败都不弹任何东西——
   * 静态 impulse 池一直在那儿接着，产品完整可用。 */
  function refreshRiffs() {
    var D = window.DESKTOP;
    var CFG = window.GAME_DATA.riff;
    if (!D || !D.llmGenerate || !CFG || !CFG.enabled || riffBusy || !C) return;

    var now = Date.now(), today = E.dateKey(now);
    if (C.riffs && C.riffs.protoId === C.prototypeId
        && C.riffs.byDay && C.riffs.byDay[today]) return;      // 今天已经有了

    // 只在白天生成
    var hour = new Date(now).getHours();
    if (hour < (CFG.genFromHour || 0) || hour >= (CFG.genUntilHour || 24)) return;

    riffBusy = true;
    D.llmGenerate({
      system: CFG.systemPrompt.split('{{COUNT}}').join(String(CFG.count)),
      user: riffUserBlock(now),
      model: CFG.model,
      effort: CFG.effort,
      maxTokens: CFG.maxTokens,
      schema: {
        type: 'object',
        properties: { lines: { type: 'array', items: { type: 'string' } } },
        required: ['lines'],
        additionalProperties: false
      }
    }).then(function (res) {
      riffBusy = false;
      // 失败不弹任何东西：静态池接着，这是正常路径不是异常路径
      var lines = linesFrom(res);
      if (!lines.length) return;
      if (!C.riffs || C.riffs.protoId !== C.prototypeId) C.riffs = { protoId: C.prototypeId, byDay: {} };
      C.riffs.byDay[today] = lines;
      // 只留最近三天，存档不该被这个撑大
      var keys = Object.keys(C.riffs.byDay).sort().slice(0, -3);
      keys.forEach(function (k) { delete C.riffs.byDay[k]; });
      E.save(C);
      render();
    }, function () { riffBusy = false; });
  }

  /* ---------- 渲染 ---------- */

  function render() {
    var now = Date.now();

    // 黑色只放状态，灰色是唯一的文案出口
    sayNow(E.behaviorCopy(E.behaviorOf(C, now)).label);
    impulseNow(E.deskLine(C, now));

    refreshLoad();
    renderNotes();
  }

  /* 桌上摆什么、它压弯到什么程度。单独拆出来是因为正在打字的时候不能重建便签列表，
   * 但纸堆和那句「它手里拿着 N 件事」还是要跟着变。 */
  function refreshLoad() {
    var open = E.loadNotes(C).length;                 // 黄色才有重量
    window.SCENE.set(E.behaviorOf(C, Date.now()), open, E.bubbleNotes(C).length, E.styleOf(C));
    $('.pet-stage').classList.toggle('is-busy', window.SCENE.isBusy());
    window.SCENE.redraw($('#props'));

    /* 状态系统已删除。它累不累现在只有一个来源：你手边压着多少件。
     * 没有隐藏数值——你看见的纸堆就是全部。 */
    var stage = $('.pet-stage');
    stage.classList.toggle('is-tired', open >= 4 && open < 8);
    stage.classList.toggle('is-spent', open >= 8);
    stage.style.setProperty('--sag', open >= 8 ? 2 : (open >= 4 ? 1 : 0));

    $('#load').textContent = E.loadText(C);
  }

  // 动画要能重复触发：先摘掉 class，强制回流，再挂上去
  function react(cls) {
    var n = $('.pet-react');
    n.className = 'pet-react';
    void n.offsetWidth;
    n.className = 'pet-react ' + cls;
  }

  /* statusLine 每次调用都是随机抽的。直接每 10 秒渲染一次，它就会不停地改口——
   * 一个陪着你的东西不该这样。同一时段内锁住这句话，最多 12 分钟换一次。 */
  /* 状态栏后面那半句：它计划外自己做的事。
   * 只在真的换了内容时才重播淡入——render 每 10 秒跑一次，
   * 每次都重播就变成一直在闪的东西，看久了很烦。 */
  function impulseNow(text) {
    var n = $('#impulse');
    if (!text) { n.hidden = true; n.textContent = ''; return; }
    if (n.textContent === text) { n.hidden = false; return; }
    n.textContent = text;
    n.hidden = false;
    n.classList.remove('in');
    void n.offsetWidth;
    n.classList.add('in');
  }

  function sayNow(text) {
    var n = $('#say');
    if (n.textContent === text) return;
    n.textContent = text;
    n.classList.remove('turn');
    void n.offsetWidth;
    n.classList.add('turn');
  }

  // 按自然日算，不按经过的毫秒——昨晚 11 点贴的，今早看应该是「昨天」而不是空
  function noteAge(n, now) {
    var a = new Date(n.createdAt), b = new Date(now);
    var d = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate())
                      - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
    if (d <= 0) return '';
    if (d === 1) return '昨天';
    return d + ' 天前';
  }

  /* 桌上现在该看见哪些：还没勾的，加上今天勾掉的（明天它们就只在回看里了）。
   * 划掉的一律沉到底下，按划掉的先后排——顶上永远是还欠着的那些，
   * 今天干完的在下面堆成一摞，看得见但不挡路。 */
  function deskList(now) {
    var today = E.dateKey(now);
    var open = [], done = [];
    C.notes.forEach(function (n) {
      // 刚划掉的那张先按「没划掉」排：删除线要在你点的那个位置划完，
      // 一勾就瞬移到底下的话，动画会发生在你没在看的地方。
      if (!n.doneAt || n.id === sinkHold) open.push(n);
      else if (E.dateKey(n.doneAt) === today) done.push(n);
    });
    done.sort(function (a, b) { return a.doneAt - b.doneAt; });
    return open.concat(done);
  }

  /* 整表重建。轮询每 10 秒跑一次，正在打字的那张必须躲开——
   * 否则 textarea 会被连内容带光标一起冲掉，而 debounce 还没来得及落盘。
   * force 只有在「先把待存的字冲进存档了」之后才允许传。 */
  function renderNotes(force) {
    var now = Date.now();
    var host = $('#notes');
    var a = document.activeElement;
    if (!force && a && a.classList && a.classList.contains('note-text') && host.contains(a)) return;

    host.innerHTML = '';
    var list = deskList(now);
    $('#notes-empty').hidden = list.length > 0 || !!undo;

    // 它刚刚提起过的那张，高亮一下——「它记得」这件事要看得见
    var top = C.log[0];
    var mentioned = (top && top.kind === 'note' && now - top.ts < 10000) ? top.text : null;

    var stale = E.NOTES.stale.staleDays;
    list.forEach(function (n, i) {
      var li = el('li', 'note note-' + n.color);
      li.dataset.id = n.id;
      li.draggable = false;       // 只有在 .note-grip 上按下去时才临时打开，见 bindDrag()
      if (n.doneAt) li.classList.add('done');
      // 放旧了的只有黄色会显出来——粉色不压在它身上，没有「拖了几天」这回事
      if (n.color !== 'pink' && !n.doneAt && now - n.createdAt >= stale * 86400000) li.classList.add('stale');
      if (n.id === flash.id) li.classList.add(flash.cls);
      if (mentioned && n.text && mentioned.indexOf(n.text) >= 0) li.classList.add('mentioned');
      // 纸片感：固定的微小倾斜，不随重渲染跳动
      li.style.transform = 'rotate(' + (((i * 37) % 5) - 2) * 0.28 + 'deg) translateX(' + (((i * 23) % 3) - 1) + 'px)';

      li.appendChild(el('span', 'note-grip'));

      var box = el('button', 'note-box');
      box.setAttribute('aria-label', n.doneAt ? '撤销' : '完成');
      box.addEventListener('click', function () { onToggle(n.id); });
      li.appendChild(box);

      var ta = el('textarea', 'note-text');
      ta.value = n.text;
      ta.maxLength = E.NOTE_MAX;
      ta.rows = 1;
      ta.placeholder = '…';
      ta.addEventListener('input', function () { autosize(ta); queueSave(n, ta); });
      ta.addEventListener('blur', function () { onBlur(n, ta); });
      li.appendChild(ta);

      var age = noteAge(n, now);
      if (age && !n.doneAt) li.appendChild(el('span', 'note-age', age));

      var x = el('button', 'note-x', '×');
      x.setAttribute('aria-label', '拿走');
      x.addEventListener('click', function () { onDrop(n.id); });
      li.appendChild(x);

      host.appendChild(li);
      autosize(ta);            // 必须挂上去之后再量，scrollHeight 要有布局才有值
    });

    if (undo) {
      var u = el('li', 'note-undo');
      u.appendChild(el('span', 'note-undo-text', '它拿走了。'));
      var back = el('button', 'note-undo-btn', '撤回来');
      back.addEventListener('click', undoDrop);
      u.appendChild(back);
      // 回到它原来站的位置，而不是掉到队尾
      var at = host.children[undo.visIdx];
      if (at) host.insertBefore(u, at); else host.appendChild(u);
    }

    flash = { id: null, cls: '' };   // 入场动画只放一次，之后的 10 秒轮询不再重播
  }

  // 3:1 是起步高度，字多了往下长——宁可便签不齐，也不要把字藏起来
  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  /* 底部那条流水已经删了。它一天要说几十句，堆在下面反而把「此刻它在干嘛」压没了——
   * 状态只在顶部两行更新就够。c.log 本身不能删：behaviorOf 靠它判断周末在忙什么，
   * 便签高亮靠它知道刚被提起的是哪张，离线摘要也从它来。数据继续记，只是不再摊开给你看。 */

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast on';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  /* ---------- 便签交互 ---------- */

  var flash = { id: null, cls: '' };   // 只给刚被操作的那张便签播入场/划线动画
  var sinkHold = null;                 // 刚划掉、还没沉到底下去的那张

  /* 新建 = 桌上多一张空白便签，光标直接落进去。
   * 它这时候没有任何反应——你还什么都没交给它。反应在第一次写进字的时候，见 commit()。 */
  function onNew(color) {
    flushSave();
    var n = E.addNote(C, color, Date.now());
    flash = { id: n.id, cls: 'fresh' };
    E.save(C);
    renderNotes(true);
    var ta = $('.note[data-id="' + n.id + '"] .note-text');
    if (ta) ta.focus();
  }

  /* 就地编辑。存两次：打字时 600ms 一存（防丢），失焦立刻存（防漏）。
   * 存的时候不重渲染——重渲染就是把用户正在打的那个 textarea 拆掉重建。 */
  var pending = null;                  // { note, ta }

  function queueSave(n, ta) {
    pending = { note: n, ta: ta };
    clearTimeout(queueSave._t);
    queueSave._t = setTimeout(function () { commit(); }, 600);
  }

  function flushSave() {
    clearTimeout(queueSave._t);
    if (pending) commit();
  }

  /* 失焦时空着的便签直接拿走。两种情况都算：点了圆钮什么都没写，
   * 以及把字全删光了——空白的纸留在桌上没有任何意思，何况旁边就有 ×。
   * 这里不能只在 commit 里做：从没打过字的那张根本没进过 debounce。 */
  function onBlur(n, ta) {
    flushSave();
    if (ta.value.trim() || n.text.trim()) return;
    E.dropNote(C, n.id, Date.now());
    E.save(C);
    renderNotes(true);
    refreshLoad();
  }

  function commit() {
    if (!pending) return;
    var n = pending.note;
    var ta = pending.ta;
    pending = null;

    var was = n.earned;
    E.editNote(C, n.id, ta.value, Date.now());
    // 第一次写进字 = 你把这件事交出去了。它的反应绑在这一刻，不绑在点圆钮那一刻。
    if (!was && n.earned) {
      react('take');
      burst('take');                                    // 它自己那部分（马克杯：热气窜一下）
      if (n.color === 'pink') window.SCENE.puff();      // 头顶上多冒一个泡
      else window.SCENE.drop();                         // 一张纸从上面掉到堆顶
    }
    E.save(C);
    refreshLoad();
  }

  function onToggle(id) {
    flushSave();
    var wasOpen = E.loadNotes(C).length;
    E.toggleNote(C, id, Date.now());
    var nowOpen = E.loadNotes(C).length;
    if (nowOpen < wasOpen) {
      flash = { id: id, cls: 'struck' };
      react(nowOpen === 0 ? 'clear' : 'relief');
      // 原地划完线再沉底。这里只能用非 force 的重绘：万一勾完立刻去别的便签上打字，
      // force 会连内容带光标一起冲掉。被躲开也没关系——sinkHold 已经清了，下一次重绘它自然就沉下去。
      sinkHold = id;
      setTimeout(function () {
        if (sinkHold !== id) return;
        sinkHold = null;
        renderNotes();
      }, 560);
    } else {
      sinkHold = null;   // 撤销：它得马上回到未完成那摞里去
    }
    E.save(C);
    renderNotes(true);
    refreshLoad();
  }

  /* ---------- 拿走的那一下，给几秒反悔 ----------
   * 只活在这一层。存档里没有回收站、没有 trashedAt——便签当场就真的从存档里走了，
   * 这里只是在内存里替你按住那张纸几秒。关掉窗口就是放弃这次反悔，
   * 跟你看到的「它拿走了」是一致的：它确实已经拿走了。 */

  var UNDO_MS = 6000;
  var undo = null;     // { note, idx, visIdx, timer }

  function onDrop(id) {
    flushSave();
    if (undo) { clearTimeout(undo.timer); undo = null; }   // 连删两张：前一张就此定案

    var idx = -1;
    for (var i = 0; i < C.notes.length; i++) if (C.notes[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    var n = C.notes[idx];

    // 它在桌上排第几，撤回来要回到原来那个位置，不能掉到队尾
    var vis = deskList(Date.now()), visIdx = 0;
    for (var j = 0; j < vis.length; j++) if (vis[j].id === id) { visIdx = j; break; }

    E.dropNote(C, id);
    E.save(C);

    undo = { note: n, idx: idx, visIdx: visIdx, timer: null };
    /* 到点只摘掉那一个节点，不整表重绘——重绘会把你正在打字的那张
     * 连内容带光标一起冲掉，而这个定时器是在别处敲字的时候到期的。 */
    undo.timer = setTimeout(function () {
      var row = $('.note-undo');
      if (row && row.parentNode) row.parentNode.removeChild(row);
      undo = null;
      $('#notes-empty').hidden = deskList(Date.now()).length > 0;
    }, UNDO_MS);

    renderNotes(true);
    refreshLoad();
  }

  function undoDrop() {
    if (!undo) return;                    // 已经过期：那张是真的走了
    var u = undo;
    clearTimeout(u.timer);
    undo = null;

    C.notes.splice(Math.min(u.idx, C.notes.length), 0, u.note);
    E.save(C);
    renderNotes(true);
    refreshLoad();
  }

  /* ---------- 拖动排序 ----------
   * 拖动只从左边那道窄边（.note-grip）发起。整张卡都能拖的话，
   * 在 textarea 里选一段字就会变成拖便签——想改字反而先把它拖走了。 */

  var dragId = null;

  function bindDrag() {
    var host = $('#notes');

    host.addEventListener('mousedown', function (e) {
      var li = e.target.closest && e.target.closest('.note');
      if (li) li.draggable = !!(e.target.classList && e.target.classList.contains('note-grip'));
    });

    host.addEventListener('dragstart', function (e) {
      var li = e.target.closest && e.target.closest('.note');
      if (!li) return;
      dragId = li.dataset.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch (x) {}
    });

    // 拖的过程中直接把 DOM 挪过去，松手时再按最终顺序落盘
    host.addEventListener('dragover', function (e) {
      if (!dragId) return;
      e.preventDefault();
      var li = host.querySelector('.dragging');
      if (!li) return;
      var before = insertBefore(host, e.clientY);
      if (before) host.insertBefore(li, before);
      else host.appendChild(li);
    });

    host.addEventListener('drop', function (e) { e.preventDefault(); finishDrag(); });
    host.addEventListener('dragend', finishDrag);
  }

  function insertBefore(host, y) {
    var items = host.querySelectorAll('.note:not(.dragging)');
    for (var i = 0; i < items.length; i++) {
      var r = items[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return items[i];
    }
    return null;
  }

  function finishDrag() {
    var host = $('#notes');
    var li = host.querySelector('.dragging');
    if (li) { li.classList.remove('dragging'); li.draggable = false; }
    if (!dragId) return;

    /* 落点报「排在它前面的是谁」。列表里看不见前几天划掉的那些，下标对不上完整数组。
     * 划掉的那摞只是显示时被排到了底下，数组里不在那个位置——拿它当锚点会把便签
     * 甩到一个谁也没指过的地方。往前找到最近一张没划掉的，等于「落在未完成那摞的末尾」。 */
    var prev = li && li.previousElementSibling;
    while (prev && prev.classList.contains('done')) prev = prev.previousElementSibling;
    E.moveNote(C, dragId, prev ? prev.dataset.id : null);
    dragId = null;
    E.save(C);
    renderNotes(true);
  }

  /* ---------- 图鉴 ----------
   * 换的只有「谁在陪你」。便签、念头、它记得的事、熟悉度——全部原样留下。
   * 这是这个功能唯一的硬约束：换宠物不是重开一局。 */

  function dexRender() {
    var host = $('#dex-grid');
    host.innerHTML = '';
    var owned = C.owned || [C.prototypeId];
    E.PROTOS.forEach(function (p) {
      var has = owned.indexOf(p.id) >= 0;
      var li = el('li', 'dex-item' + (p.id === C.prototypeId ? ' on' : '') + (has ? '' : ' locked'));
      var cell = el('div', 'dex-sprite');
      paintSprite(cell, has ? p.id : 'UNKNOWN');   // 没解锁的一律同一个形状，别泄露轮廓
      li.appendChild(cell);
      li.appendChild(el('span', 'dex-name', has ? p.name : '???'));
      li.appendChild(el('span', 'dex-kw', has ? p.keywords.join(' · ') : ''));
      if (has) li.addEventListener('click', function () { dexPick(p.id); });
      host.appendChild(li);
    });
    $('#dex-count').textContent = owned.length + ' / ' + E.PROTOS.length;
    // 身份放在图鉴里，不占主界面——升职那一刻事件流会说，平时想查再来看
    $('#dex-who').textContent = [C.name, E.RULES.levels[C.levelId].name, E.JOB(C.jobId).name].join(' · ');
    $('#dex-points').textContent = (C.points || 0) + ' 分';
    $('#dex-roll').textContent = '抽一只（' + E.GACHA.roll.cost + '）';
    $('#dex-roll').disabled = (C.points || 0) < E.GACHA.roll.cost;
  }

  /* ---------- 回看：按天 ---------- */

  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // 最近三天叫得出名字，再往前就报日期——「11 天前」这种说法回看的时候没有用
  function dayTitle(ts, now) {
    var a = new Date(ts), b = new Date(now);
    var d = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate())
                      - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
    if (d === 0) return '今天';
    if (d === 1) return '昨天';
    if (d === 2) return '前天';
    return (a.getMonth() + 1) + ' 月 ' + a.getDate() + ' 日 ' + WEEK[a.getDay()];
  }

  function archRender() {
    var now = Date.now();
    var days = E.archive(C);
    var host = $('#arch-list');
    host.innerHTML = '';
    $('#arch-empty').hidden = days.length > 0;

    days.forEach(function (d) {
      var sec = el('section', 'arch-day');

      var h = el('div', 'arch-day-head');
      h.appendChild(el('b', 'arch-day-title', dayTitle(d.ts, now)));
      // 只报这天划掉了几件。没有连续天数，没有完成率——那会变成又一个考核你的东西
      h.appendChild(el('span', 'arch-day-count', d.items.length + ' 件'));
      sec.appendChild(h);

      var ul = el('ul', 'arch-items');
      d.items.forEach(function (item) {
        var li = el('li', 'arch-item arch-' + item.color);
        li.appendChild(el('span', 'arch-mark', '✓'));
        li.appendChild(el('span', 'arch-text', item.text));
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      host.appendChild(sec);
    });
  }

  /* ---------- 按月回看 ----------
   * 只报当月每天划掉了几件，不算完成率、不连续打卡——那会把回看变成
   * 一个考核你的东西。年份夹在 2026–2036：往前十年够用，也不必无限翻。 */

  var WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
  var ARCH_MONTH_MIN = { y: 2026, m: 0 };
  var ARCH_MONTH_MAX = { y: 2036, m: 11 };
  var archMonthState = (function () {
    var n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  })();

  function archSwitchTab(tab) {
    $('#arch-tab-day').classList.toggle('on', tab === 'day');
    $('#arch-tab-month').classList.toggle('on', tab === 'month');
    $('#arch-view-day').hidden = tab !== 'day';
    $('#arch-view-month').hidden = tab !== 'month';
    if (tab === 'day') archRender(); else archMonthRender();
  }

  function archMonthRender() {
    var y = archMonthState.y, m = archMonthState.m;
    var now = new Date();
    $('#arch-month-title').textContent = y + ' 年 ' + (m + 1) + ' 月';
    $('#arch-month-prev').disabled = (y === ARCH_MONTH_MIN.y && m === ARCH_MONTH_MIN.m);
    $('#arch-month-next').disabled = (y === ARCH_MONTH_MAX.y && m === ARCH_MONTH_MAX.m);

    var counts = E.archMonth(C, y, m);
    var host = $('#arch-month-grid');
    host.innerHTML = '';
    WEEKDAY_SHORT.forEach(function (w) { host.appendChild(el('span', 'arch-month-wd', w)); });

    var lead = new Date(y, m, 1).getDay();
    var days = new Date(y, m + 1, 0).getDate();
    var isThisMonth = (y === now.getFullYear() && m === now.getMonth());
    for (var i = 0; i < lead; i++) host.appendChild(el('span', 'arch-month-cell blank'));
    for (var d = 1; d <= days; d++) {
      var cell = el('span', 'arch-month-cell' + (isThisMonth && d === now.getDate() ? ' today' : ''));
      cell.appendChild(el('b', 'arch-month-day', String(d)));
      var n = counts[d] || 0;
      if (n) cell.appendChild(el('span', 'arch-month-n', String(n)));
      host.appendChild(cell);
    }
  }

  function archMonthShift(delta) {
    var idx = archMonthState.y * 12 + archMonthState.m + delta;
    var lo = ARCH_MONTH_MIN.y * 12 + ARCH_MONTH_MIN.m;
    var hi = ARCH_MONTH_MAX.y * 12 + ARCH_MONTH_MAX.m;
    idx = Math.max(lo, Math.min(hi, idx));
    archMonthState.y = Math.floor(idx / 12);
    archMonthState.m = idx % 12;
    archMonthRender();
  }

  function archMonthToday() {
    var now = new Date();
    archMonthState.y = now.getFullYear();
    archMonthState.m = now.getMonth();
    archMonthRender();
  }

  function dexRoll() {
    var r = E.rollPet(C, Date.now());
    E.save(C);
    $('#dex-msg').textContent = r.text;
    $('#dex-msg').className = 'dex-msg on' + (r.ok && !r.dup ? ' got' : '');
    if (r.ok) dexRender();
  }

  function dexPick(id) {
    if (id === C.prototypeId) return;
    C.prototypeId = id;
    C.name = E.renameFor(id);
    E.save(C);
    E.resetDeskLine();                     // 换了一只，让它重新说一句
    partBurst = null; partAt = 0;
    $('#dex').hidden = true;
    drawSprite();
    render();
  }

  /* ---------- 存档进出 ----------
   * 两个用途，缺一不可：
   *   1. 浏览器清一次数据这只就没了——它是「作品」，唯一的备份手段
   *   2. tools/*.mjs 读的就是这个文件（分类、生成它自己的一天） */

  function exportSave() {
    var raw = localStorage.getItem('workplace-creature/v1');
    if (!raw) return;
    var d = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
    var a = el('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(JSON.parse(raw), null, 2)], { type: 'application/json' }));
    a.download = '职场生物-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    $('#dex-msg').textContent = '存档已导出。';
    $('#dex-msg').className = 'dex-msg on';
  }

  function importSave(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var c = JSON.parse(r.result);
        if (!c || !c.prototypeId) throw new Error('不像是这个的存档');
        localStorage.setItem('workplace-creature/v1', r.result);
        location.reload();
      } catch (e) {
        $('#dex-msg').textContent = '这个文件读不了：' + e.message;
        $('#dex-msg').className = 'dex-msg on';
      }
    };
    r.readAsText(file);
  }

  /* ---------- OOBE 测评 ---------- */

  var oobe = { step: 1, hits: [], blanks: [], hobbies: [] };

  function oobeCfg() {
    var f = E.ASSESS.flow;
    return oobe.step === 1 ? f.step1 : (oobe.step === 2 ? f.step2 : f.step3);
  }

  function oobeRender() {
    var A = E.ASSESS, cfg = oobeCfg();
    $('#oobe-step').textContent = oobe.step;
    $('#oobe-prompt').textContent = cfg.prompt;
    $('#oobe-sub').textContent = cfg.sub;

    var host = $('#oobe-cards');
    host.innerHTML = '';
    var pool;
    if (oobe.step === 1) pool = A.cards.map(function (c) { return { id: c.id, text: c.text }; });
    // 第二步只展示第一步没选中的卡
    else if (oobe.step === 2) pool = A.cards.filter(function (c) { return oobe.hits.indexOf(c.id) < 0; })
                                            .map(function (c) { return { id: c.id, text: c.text }; });
    else pool = A.hobbies.map(function (h) { return { id: h.id, text: h.label }; });

    host.classList.toggle('compact', oobe.step === 3);
    pool.forEach(function (c) {
      var b = el('button', 'ocard', c.text);
      b.dataset.id = c.id;
      if (oobeSelected().indexOf(c.id) >= 0) b.classList.add('on');
      b.addEventListener('click', function () { oobePick(c.id); });
      host.appendChild(b);
    });
    oobeCount();
  }

  function oobeSelected() {
    if (oobe.step === 1) return oobe.hits;
    if (oobe.step === 2) return oobe.blanks;
    return oobe.hobbies;
  }

  function oobeCount() {
    var need = oobeCfg().pick, got = oobeSelected().length;
    $('#oobe-count').textContent = got + ' / ' + need;
    $('#oobe-next').disabled = got !== need;
    $('#oobe-next').textContent = oobe.step === 3 ? '生成' : '下一步';
    $('#oobe-back').hidden = oobe.step === 1;
  }

  // 只切换 class，不重建网格——整表重渲染会丢焦点、闪烁。
  function oobePick(id) {
    var list = oobeSelected();
    var i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else if (list.length < oobeCfg().pick) list.push(id);
    else return;
    var on = list;
    Array.prototype.forEach.call($('#oobe-cards').children, function (b) {
      b.classList.toggle('on', on.indexOf(b.dataset.id) >= 0);
    });
    oobeCount();
  }

  function oobeNext() {
    if (oobe.step < 3) {
      oobe.step++;
      oobeRender();
      window.scrollTo(0, 0);
      return;
    }
    rank = E.rankPrototypes(E.axesFromPicks(oobe.hits, oobe.blanks));
    rankAt = 0;
    unlocked = 1;
    makeAt(0);
  }

  // 回上一步。只有第二步的池子跟着第一步变，所以只有退回第一步才清选择；
  // 爱好跟前两步无关，退回去不该白选一次。
  function oobeBack() {
    if (oobe.step === 1) return;
    if (oobe.step === 2) oobe.blanks.length = 0;
    oobe.step--;
    oobeRender();
    window.scrollTo(0, 0);
  }

  /* 「换一只」负责解锁，箭头只负责在已解锁的范围里挪——两件事分开，
   * 不然箭头能在没点过「换一只」的情况下直接跳到还没解锁的候选，等于白解锁。
   * 候选池是同一份排序里的前三名（rankAt 0~2），再往下已经不像你了。
   * unlocked 记录到目前为止解锁到了第几个：
   *   一开始 unlocked=1，只看得到第 0 个，箭头两边都是灰的；
   *   每点一次「换一只」，没解锁满之前解锁一个新的、顺带跳过去；
   *   解锁满了之后，「换一只」变成纯循环，用来回看之前选项。
   * 箭头永远只在 [0, unlocked-1] 里走，退到头/解锁边界就停，不循环。 */
  var rank = [], rankAt = 0, unlocked = 1;
  var REROLL_MAX = 2, POOL = REROLL_MAX + 1;

  function makeAt(i) {
    rankAt = i;
    C = E.newCreature(Date.now(), {
      hits: oobe.hits, blanks: oobe.blanks, hobbies: oobe.hobbies,
      protoId: rank[i] && rank[i].id
    });
    showReveal();
  }

  function reroll() {
    if (unlocked < POOL) { unlocked++; makeAt(unlocked - 1); }
    else makeAt((rankAt + 1) % POOL);
  }
  function nextProto() { if (rankAt < unlocked - 1) makeAt(rankAt + 1); }
  function prevProto() { if (rankAt > 0) makeAt(rankAt - 1); }

  function showReveal() {
    var proto = E.PROTO(C.prototypeId);
    var m = E.ASSESS.mirror[C.prototypeId] || { strength: '', cost: '' };
    $('#reveal-proto').textContent = proto.name;
    $('#reveal-strength').textContent = m.strength;
    $('#reveal-cost').textContent = m.cost;
    $('#reveal-name').textContent = C.name;
    $('#reveal-eyebrow').textContent = rankAt === 0 ? '在你身上长出来的是' : '那这只呢';
    $('#reveal-prev').disabled = rankAt <= 0;
    $('#reveal-next').disabled = rankAt >= unlocked - 1;
    $('#reveal-hint').textContent = '定下来之后就不能换了。';
    paintSprite($('#reveal-sprite'), C.prototypeId);
    $('#oobe').hidden = true;
    $('#reveal').hidden = false;
  }

  function enterApp() {
    live = true;                     // 定型：存档只在这一刻落地，之前重抽不写盘
    E.save(C);
    $('#oobe').hidden = true;
    $('#reveal').hidden = true;
    $('#app').hidden = false;
    drawSprite();
    schedulePart();
    render();
  }

  /* ---------- 循环 ---------- */

  function tick() {
    var res = E.advanceTo(C, Date.now());
    E.save(C);
    render();
    if (res.offline && res.offline.tier === 'long') toast(res.offline.text);
  }

  function boot() {
    bindChrome();
    C = E.load();
    if (!C) {
      $('#oobe').hidden = false;
      oobeRender();
      scheduleBlink();
      return;
    }
    E.advanceTo(C, Date.now());
    enterApp();
    scheduleBlink();

    // 今天还没有就生成一次。失败不弹任何东西
    // 每分钟问一次系统空闲了多久，告诉引擎你还在不在
    (function pollAwake() {
      var D = window.DESKTOP;
      if (!D || !D.idleSeconds) return;
      var within = (window.GAME_DATA.copy.impulse.awakeWithinMin || 5) * 60;
      var ask = function () {
        D.idleSeconds().then(function (sec) { E.setAwake(sec < within); }, function () {});
      };
      ask();
      setInterval(ask, 60000);
    })();

    setTimeout(function () { refreshRiffs(); }, 3000);
    // 跨天了再要一次（开着不关的话）
    setInterval(function () { if (live) refreshRiffs(); }, 30 * 60000);
  }

  function bindChrome() {
    setInterval(function () { if (live) tick(); }, 10000);
    setInterval(function () { if (live) drawSprite(); }, 30000);
    // 场景逐帧：页面藏起来时不画，省电
    setInterval(function () {
      if (live && !document.hidden) window.SCENE.tick($('#props'));
    }, 100);
    $('#oobe-next').addEventListener('click', oobeNext);
    $('#oobe-back').addEventListener('click', oobeBack);
    $('#reveal-go').addEventListener('click', enterApp);
    $('#reveal-reroll').addEventListener('click', reroll);
    $('#reveal-prev').addEventListener('click', prevProto);
    $('#reveal-next').addEventListener('click', nextProto);
    $('#new-yellow').addEventListener('click', function () { onNew('yellow'); });
    $('#new-pink').addEventListener('click', function () { onNew('pink'); });
    bindDrag();
    $('#open-dex').addEventListener('click', function () {
      $('#dex-msg').textContent = ''; $('#dex-msg').className = 'dex-msg';
      dexRender(); $('#dex').hidden = false;
    });
    $('#dex-roll').addEventListener('click', dexRoll);
    $('#save-export').addEventListener('click', exportSave);
    $('#save-import').addEventListener('click', function () { $('#save-file').click(); });
    $('#save-file').addEventListener('change', function (e) {
      if (e.target.files[0]) importSave(e.target.files[0]);
    });
    $('#dex-close').addEventListener('click', function () { $('#dex').hidden = true; });
    $('#dex').addEventListener('click', function (e) { if (e.target.id === 'dex') $('#dex').hidden = true; });
    $('#open-arch').addEventListener('click', function () { archSwitchTab('day'); $('#arch').hidden = false; });
    $('#arch-close').addEventListener('click', function () { $('#arch').hidden = true; });
    $('#arch').addEventListener('click', function (e) { if (e.target.id === 'arch') $('#arch').hidden = true; });
    $('#arch-tab-day').addEventListener('click', function () { archSwitchTab('day'); });
    $('#arch-tab-month').addEventListener('click', function () { archSwitchTab('month'); });
    $('#arch-month-prev').addEventListener('click', function () { archMonthShift(-1); });
    $('#arch-month-next').addEventListener('click', function () { archMonthShift(1); });
    $('#arch-month-today').addEventListener('click', archMonthToday);
    // 窗口一变尺寸就把便签重新量一遍：高度是按当时的纸宽算出来写死的，纸一变宽就不对了
    window.addEventListener('resize', function () {
      var tas = document.querySelectorAll('.note-text');
      for (var i = 0; i < tas.length; i++) autosize(tas[i]);
    });
    // 关页面之前把还在 debounce 里的那几个字冲进存档
    window.addEventListener('beforeunload', flushSave);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
