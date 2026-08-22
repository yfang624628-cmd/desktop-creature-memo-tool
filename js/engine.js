/* 职场生物 · 引擎
 * 所有规则来自 data/*.json（经 build-data.py 打包为 window.GAME_DATA）。
 * 本文件不硬编码任何数值——改平衡请改 data/rules.json 后重新 build。
 */
(function (global) {
  'use strict';

  var D = global.GAME_DATA;
  var RULES = D.rules, PROTOS = D.prototypes.prototypes, JOBS = D.jobs.jobs,
      TASKS = D.tasks.tasks, EVENTS = D.events.events, COMBOS = D.combos.combos,
      COPY = D.copy, ASSESS = D.assessment, NOTES = D.notes, NOTEMAP = D.notemap, GACHA = D.gacha;

  var SAVE_KEY = 'workplace-creature/v1';
  var LOCAL_KEY = 'workplace-creature/local';

  /* 本机覆盖。存在 localStorage 里，不在仓库里——所以它跟着「这台机器上的这一只」走：
   * git pull 冲不掉，也不可能手滑提交出去。在控制台跑一次就生效：
   *   localStorage.setItem('workplace-creature/local', '{"forcePrototype":"R15"}')
   * 撤掉：localStorage.removeItem('workplace-creature/local') */
  function local() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch (e) { return {}; }
  }

  /* 固定成某一只、跳过测评结果。默认关。 */
  function forcedPrototype() { return local().forcePrototype || null; }
  var STEP_MIN = 15;               // 模拟步长（分钟）
  var MS_PER_MIN = 60000;

  var byId = function (arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; };
  var TASK = function (id) { return byId(TASKS, id); };
  var PROTO = function (id) { return byId(PROTOS, id); };
  var JOB = function (id) { return byId(JOBS, id); };
  var EVENT = function (id) { return byId(EVENTS, id); };

  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var randInt = function (a, b) { return Math.floor(rand(a, b + 1)); };
  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };

  function weightedPick(items, wKey) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += items[i][wKey];
    var r = Math.random() * total;
    for (i = 0; i < items.length; i++) { r -= items[i][wKey]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }

  /* ---------- 时间 ---------- */

  function hm2min(s) { var p = s.split(':'); return (+p[0]) * 60 + (+p[1]); }
  function min2hm(m) {
    m = ((m % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function dateKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function minOfDay(ts) { var d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); }

  function dayTypeOf(ts) {
    return RULES.dayTypes.byWeekday[new Date(ts).getDay()];
  }
  function isWeekend(ts) { return dayTypeOf(ts) !== 'weekday'; }

  function phaseInMap(map, mod, fallback) {
    for (var k in map) {
      if (k.charAt(0) === '_' || k === fallback) continue;
      var a = hm2min(map[k].start), b = hm2min(map[k].end);
      if (b === 0) b = 1440;
      if (mod >= a && mod < b) return k;
    }
    return fallback;
  }

  // phaseAt 必须知道今天是星期几——周末的作息跟工作日完全不同。
  function phaseAt(mod, ts) {
    if (ts != null && isWeekend(ts)) return phaseInMap(RULES.weekendPhases.map, mod, 'wnight');
    return phaseInMap(RULES.phases.map, mod, 'night');
  }

  function phaseMeta(ph) {
    return RULES.phases.map[ph] || RULES.weekendPhases.map[ph] || { label: '' };
  }

  /* ---------- 性格 ----------
   * v2.0：性格只改变过程，不改变结果。所有原型的机制、数值、消耗、回血完全一致。
   * 原先的 passive.effect / modifier() / evalCond() 已整块删除——数值差异会偷偷
   * 引入优劣（水豚扛得住、猫扛不住 = 把猫写成了缺点），违反「两端对称赋值，不存在负极」。
   * 差异走这两个字段：换动作的频率 / 演出时的小动作。
   * peak（日程分布）已删除——用户根本感知不到，而它是唯一需要日程系统的字段。 */
  var DEFAULT_STYLE = { pace: 'quick', quirk: 'none' };

  function styleOf(c) {
    var p = PROTO(c && c.prototypeId);
    return (p && p.style) || DEFAULT_STYLE;
  }

  /* ---------- 生成 ---------- */

  /* ---------- 职级 ----------
   * 纯时间驱动：开局一律实习生，每隔 14–30 天（不定时）升一级，到首席生物封顶。
   * 这不是被删掉的那种隐藏数值——升职是可见的、单向的、必然发生的。
   * 你们一起待够久它就升了，不需要你做对任何事。 */

  function levelIds() {
    return Object.keys(RULES.levels).filter(function (k) { return /^L\d/.test(k); }).sort();
  }

  function nextPromoteAt(from) {
    var d = RULES.levels.promoteEveryDays;
    return from + Math.round(rand(d[0], d[1]) * 86400000);
  }

  function checkPromotion(c, now) {
    var ids = levelIds(), guard = 0;
    while (c.promoteAt && now >= c.promoteAt && guard++ < 20) {
      var i = ids.indexOf(c.levelId);
      if (i < 0 || i >= ids.length - 1) { c.promoteAt = 0; return; }   // 到顶，不再排下一次
      c.levelId = ids[i + 1];
      var name = RULES.levels[c.levelId].name;
      var atTop = i + 1 === ids.length - 1;
      // 按等级序号取，不随机——一辈子只升 6 次，每次说不同的话比随机更好
      var pool = atTop ? COPY.promotion.top : COPY.promotion.lines;
      var line = pool[(i) % pool.length];
      log(c, c.promoteAt, line.split('{name}').join(name), 'promote');
      c.promoteAt = atTop ? 0 : nextPromoteAt(c.promoteAt);
    }
  }

  function rollJob(levelId) {
    var pool = JOBS.filter(function (j) {
      return !j.levelHint || j.levelHint.indexOf(levelId) >= 0;
    });
    return pick(pool).id;
  }

  function findCombo(prototypeId, jobId) {
    for (var i = 0; i < COMBOS.length; i++)
      if (COMBOS[i].prototypeId === prototypeId && COMBOS[i].jobId === jobId) return COMBOS[i];
    return null;
  }

  function makeName(proto) {
    var n = COPY.names;
    if (Math.random() < 0.5) return pick(n.prefixes) + pick(n.cores);
    var ch = pick(n.cores);
    return ch + ch;
  }

  /* ---------- 测评 ----------
   * 原型来自测评（= 你是谁），职位与职级仍然随机（= 你的境遇）。 */

  function axesFromPicks(hits, blanks) {
    var v = {};
    Object.keys(ASSESS.axes).forEach(function (a) { v[a] = 0; });
    var card = function (id) {
      for (var i = 0; i < ASSESS.cards.length; i++) if (ASSESS.cards[i].id === id) return ASSESS.cards[i];
      return null;
    };
    var add = function (id, weight) {
      var c = card(id); if (!c) return;
      for (var k in c.w) v[k] += c.w[k] * weight;
    };
    (hits || []).forEach(function (id) { add(id, ASSESS.flow.step1.weight); });
    // 单选时代传进来的是一个 id，现在是数组；两种都收，老存档不至于炸
    var bl = blanks == null ? [] : (Array.isArray(blanks) ? blanks : [blanks]);
    bl.forEach(function (id) { add(id, ASSESS.flow.step2.weight); });
    return v;
  }

  /* 20 只按「像不像你」从高到低排开。
   * calibration 是均等化偏置：对同一个用户是常数，不改变谁离你更近的逻辑，
   * 只把全量组合下的中签分布从 1%~11% 拉平到各 5%。见 assessment.json > _calibrationNote。 */
  function rankPrototypes(v) {
    var axes = Object.keys(ASSESS.axes), cal = ASSESS.calibration || {};
    var norm = function (o) {
      var s = 0; axes.forEach(function (a) { s += (o[a] || 0) * (o[a] || 0); });
      return Math.sqrt(s) || 1e-9;
    };
    var nv = norm(v), out = [];
    for (var pid in ASSESS.signatures) {
      var sig = ASSESS.signatures[pid], dot = 0;
      axes.forEach(function (a) { dot += (v[a] || 0) * (sig[a] || 0); });
      var cos = dot / (nv * norm(sig));
      out.push({ id: pid, cos: cos, score: cos + (cal[pid] || 0) });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  function matchPrototype(v) {
    var r = rankPrototypes(v);
    return r.length ? r[0].id : null;
  }

  var c_matchedId = null;

  function newCreature(now, assessment) {
    now = now || Date.now();
    var levelId = RULES.levels.start || 'L01';
    var jobId = rollJob(levelId);
    var axes = assessment && assessment.hits && assessment.hits.length
      ? axesFromPicks(assessment.hits, assessment.blanks) : null;
    var matched = axes ? PROTO(matchPrototype(axes)) : pick(PROTOS);
    var forced = forcedPrototype();
    // 「换一只」传 protoId 进来：仍然是你的向量，只是换成排名次一位的那只，不走随机
    var picked = (assessment && assessment.protoId && PROTO(assessment.protoId)) || matched;
    var proto = (forced && PROTO(forced)) || picked;
    c_matchedId = matched.id;                       // 测评真正算出来的那只，存下来备查

    var c = {
      version: 1,
      prototypeId: proto.id,
      jobId: jobId,
      levelId: levelId,
      promoteAt: nextPromoteAt(now),
      name: makeName(proto),
      createdAt: now, lastTickAt: now,
      day: null, schedule: [], log: [],
      activeTaskId: null, activeUntil: 0,
      transient: {},
      consecutiveSuccess: 0, consecutiveFailure: 0,
      eventsToday: 0, eventLast: {}, lastEventAt: 0,
      lastVisitAt: now,
      axes: axes,
      matchedId: c_matchedId,   // 测评算出的原型。被 forcePrototype 压住时用来对照
      hobbies: (assessment && assessment.hobbies) || [],
      notes: [], noteSeq: 0, noteRecallAt: 0,
      done: [], doneSeq: 0,               // 完成快照。回看的唯一来源，见 archive()
      points: 0, pointsDay: null, pointsToday: 0, owned: [proto.id]
    };

    var combo = findCombo(proto.id, jobId);
    c.comboTitle = combo ? combo.title : null;
    c.comboCopy = combo ? combo.copy : null;
    c.rarity = combo ? combo.rarity : null;

    c.day = dateKey(now);
    c.scheduleDay = null;
    // 先补算——让日程在「早间」生成，这样今天已过去的部分会真实地跑一遍。
    // 顺序反了的话日程会被整体标记为 missed，补算就空转了。
    backfillToday(c, now);
    ensureDay(c, now, true);   // 深夜/早间开局时兜底生成
    // 深夜开局时今天还没发生任何事，事件流会是空的——补一句，别让首屏空着。
    if (!c.log.length) log(c, now, statusLine(c, now), 'day');
    return c;
  }

  /* ---------- 日程 ---------- */

  function hobby(id) {
    for (var i = 0; i < ASSESS.hobbies.length; i++) if (ASSESS.hobbies[i].id === id) return ASSESS.hobbies[i];
    return null;
  }

  // 周末不排工作，排你自己的事——爱好来自 OOBE 第三步。
  function generateWeekendSchedule(c, now) {
    var W = RULES.weekendPhases;
    var pool = (c.hobbies && c.hobbies.length ? c.hobbies : ['H01', 'H10']).slice();
    var count = randInt(W.eventsPerDay[0], W.eventsPerDay[1]);
    var slots = [];
    W.activityPhases.forEach(function (ph) {
      var m = W.map[ph], a = hm2min(m.start), b = hm2min(m.end);
      for (var t = a; t < b - 30; t += 30) slots.push(t);
    });
    // 两顿饭先入座，爱好活动再避开——否则会出现 19:00 做饭和 19:00 吃饭撞车
    var chosen = [
      { min: hm2min('12:30'), taskId: 'T12', status: 'pending', fixed: true, label: '吃饭' },
      { min: hm2min('19:00'), taskId: 'T12', status: 'pending', fixed: true, label: '吃饭' }
    ];
    var fixedCount = chosen.length, guard = 0, deck = [];
    while (chosen.length - fixedCount < count && guard++ < 200) {
      var min = pick(slots);
      if (!chosen.every(function (x) { return Math.abs(x.min - min) >= 60; })) continue;
      // 无放回发牌：先把选中的爱好都轮一遍再重复，
      // 否则只选了两个爱好时经常一天两次「做饭」、另一个一次不出现。
      if (!deck.length) deck = pool.slice().sort(function () { return Math.random() - 0.5; });
      var h = hobby(deck.shift());
      if (!h) continue;
      chosen.push({ min: min, hobbyId: h.id, label: h.label.split('，')[0], status: 'pending' });
    }
    chosen.sort(function (a, b) { return a.min - b.min; });
    c.schedule = chosen;
  }

  /* 它有自己的一天。你的便签不进它的日程——它替你拿着那些事，但并不替你做。 */
  /* tools/dayplan-llm.mjs 离线预生成的「它自己的一天」。
   * 没有就退回下面的随机日程——降级是正常路径，不是异常路径。 */
  function planFromDayplan(c, now) {
    var plan = c.dayplans && c.dayplans[dateKey(now)];
    if (!plan || !plan.length) return null;
    return plan.map(function (x) {
      return { min: x.min, status: 'pending', planned: true, behavior: x.behavior, line: x.line };
    });
  }

  function generateSchedule(c, now) {
    var planned = planFromDayplan(c, now);
    if (planned) { c.schedule = planned; return; }
    if (isWeekend(now)) return generateWeekendSchedule(c, now);

    var job = JOB(c.jobId);
    var count = randInt(RULES.schedule.eventsPerDay[0], RULES.schedule.eventsPerDay[1]);
    var gap = RULES.schedule.minGapMin;
    var slots = [];
    ['morning', 'afternoon', 'dusk'].forEach(function (ph) {
      var m = RULES.phases.map[ph], a = hm2min(m.start), b = hm2min(m.end);
      for (var t = a; t < b - 15; t += 15) slots.push({ min: t, phase: ph });
    });

    // 固定日程先入座，随机日程再避开它们——否则会出现 15:00 做提案和 15:00 下午茶撞车。
    var chosen = [], guard = 0, used = {};
    RULES.schedule.fixedEvents.forEach(function (f) {
      if (f.optional && Math.random() < 0.5) return;
      chosen.push({ min: hm2min(f.at), taskId: f.taskId, status: 'pending', fixed: true, label: f.label });
    });
    var fixedCount = chosen.length;

    while (chosen.length - fixedCount < count && guard++ < 300) {
      var slot = pick(slots);
      var ok = chosen.every(function (x) { return Math.abs(x.min - slot.min) >= gap; });
      if (!ok) continue;
      var pool = job.taskPool.filter(function (e) {
        var t = TASK(e.taskId);
        if (!t) return false;
        if ((used[e.taskId] || 0) >= 2) return false;   // 同一任务一天最多两次，避免「修改反馈×3」
        return t.phases.indexOf(slot.phase) >= 0 || t.phases.indexOf('all') >= 0;
      });
      if (!pool.length) continue;
      var tid = weightedPick(pool, 'weight').taskId;
      used[tid] = (used[tid] || 0) + 1;
      chosen.push({ min: slot.min, taskId: tid, status: 'pending' });
    }

    chosen.sort(function (a, b) { return a.min - b.min; });
    c.schedule = chosen;
  }

  // 跨零点：只重置当日计数，不生成日程也不播报——此时它在睡觉。
  function rolloverDay(c, now) {
    c.day = dateKey(now);
    c.eventsToday = 0;
    c.eventLast = {};
    c.schedule = [];
    c.activeTaskId = null;
    c.plannedBehavior = null;
  }

  // 日程在早间（dawn）生成，符合 rules.schedule.generateAt。
  // 若用户中途才打开，也在这里补生成，并把已过去的日程标记为错过。
  function startDay(c, now, silent) {
    c.day = dateKey(now);
    c.scheduleDay = c.day;
    generateSchedule(c, now);
    var mod = minOfDay(now);
    c.schedule.forEach(function (s) { if (s.min < mod) s.status = 'missed'; });
    if (!silent) {
      var n = c.schedule.filter(function (s) { return !s.fixed; }).length;
      // 周末不能播报「它到工位了」——早间文案是工作日专用的
      var line = isWeekend(now)
        ? pick(COPY.weekend.wmorning)
        : pick(COPY.dawnPool.lines).replace('{count}', n);
      log(c, now, line, 'day');
    }
    // 每日 roll 类事件（Blob 形变、袜子丢袜等）
    EVENTS.forEach(function (e) {
      if (e.trigger.when !== 'dailyRoll') return;
      if (e.trigger.prototypeIds && e.trigger.prototypeIds.indexOf(c.prototypeId) < 0) return;
      if (Math.random() < e.probability) applyEvent(c, e, now);
    });
  }

  // 每步调用：处理跨天与日程生成时机
  function ensureDay(c, ts, silent) {
    if (dateKey(ts) !== c.day) rolloverDay(c, ts);
    if (c.scheduleDay !== c.day && phaseAt(minOfDay(ts), ts) !== 'night' && phaseAt(minOfDay(ts), ts) !== 'wnight') startDay(c, ts, silent);
  }

  /* ---------- 日志 ---------- */

  function log(c, ts, text, kind) {
    c.log.unshift({ ts: ts, text: text, kind: kind || 'event' });
    if (c.log.length > 60) c.log.length = 60;
  }

  /* 事件只剩文案。成败仍然分岔（那是好内容），但不再有任何状态增减——
   * 一枚公平的硬币决定它今天是顺还是不顺，然后它说一句对应的话。 */
  function applyEvent(c, e, ts) {
    var text = e.copy, eff = e.effect || {};

    if (e.check) {
      var roll = Math.random(), success = roll < 0.55;
      text = success ? (e.copySuccess || e.copy) : (e.copyFailure || e.copy);
      var f = RULES.randomEvent;
      if (success ? roll < 0.03 : roll > 0.97)
        text += ' ' + pick(success ? COPY.check.criticalSuccess : COPY.check.criticalFailure);
      c.consecutiveSuccess = success ? c.consecutiveSuccess + 1 : 0;
      c.consecutiveFailure = success ? 0 : c.consecutiveFailure + 1;
    }
    if (eff.taskDelayMin) c.activeUntil += eff.taskDelayMin * MS_PER_MIN;

    log(c, ts, text, e.category === 'user' ? 'user' : 'event');
    c.eventsToday++;
    c.lastEventAt = ts;
    c.eventLast[e.id] = ts;
    return text;
  }

  /* ---------- 随机事件 ---------- */

  function eventMatches(c, e, ts, when) {
    var t = e.trigger;
    if (t.when !== when) return false;
    if (t.prototypeIds && t.prototypeIds.indexOf(c.prototypeId) < 0) return false;
    if (t.jobIds && t.jobIds.indexOf(c.jobId) < 0) return false;
    if (t.phases && t.phases.indexOf(phaseAt(minOfDay(ts), ts)) < 0) return false;
    if (t.requireActiveTask && !c.activeTaskId) return false;
    if (t.consecutiveFailures != null && c.consecutiveFailure < t.consecutiveFailures) return false;
    if (t.consecutiveSuccesses != null && c.consecutiveSuccess < t.consecutiveSuccesses) return false;
    if (t.taskIds && (!c.activeTaskId || t.taskIds.indexOf(c.activeTaskId) < 0)) return false;
    return true;
  }

  function throttled(c, e, ts) {
    var r = RULES.randomEvent;
    var exclusive = !!e.trigger.prototypeIds;
    if (!exclusive || !r.prototypeExclusiveBypassesCap) {
      if (c.eventsToday >= r.maxPerDay) return true;
      if (ts - c.lastEventAt < r.cooldownMin * MS_PER_MIN) return true;
    }
    var last = c.eventLast[e.id];
    if (last && ts - last < r.noRepeatWithinHours * 3600000) return true;
    return false;
  }

  function rollEvents(c, ts, when, taskId) {
    var fired = [];
    for (var i = 0; i < EVENTS.length; i++) {
      var e = EVENTS[i];
      if (e.trigger.when === 'userAction' || e.trigger.when === 'dailyRoll') continue;
      if (when === 'taskEnd') {
        if (e.trigger.when !== 'taskEnd') continue;
        if (e.trigger.taskIds && e.trigger.taskIds.indexOf(taskId) < 0) continue;
        if (e.trigger.requireCheckSuccess && c.consecutiveSuccess === 0) continue;
        if (e.trigger.jobIds && e.trigger.jobIds.indexOf(c.jobId) < 0) continue;
      } else if (!eventMatches(c, e, ts, when)) continue;
      if (throttled(c, e, ts)) continue;
      if (Math.random() >= e.probability) continue;
      fired.push(applyEvent(c, e, ts));
      break; // 一次最多触发一条，避免刷屏
    }
    return fired;
  }

  /* ---------- 主推进 ---------- */

  function processSchedule(c, ts, allowEvents) {
    var mod = minOfDay(ts);
    // 结束当前任务
    if (c.activeTaskId && ts >= c.activeUntil) {
      var ended = c.activeTaskId;
      c.activeTaskId = null;
      if (allowEvents) rollEvents(c, ts, 'taskEnd', ended);
    }
    // 开始到点的任务
    for (var i = 0; i < c.schedule.length; i++) {
      var s = c.schedule[i];
      if (s.status !== 'pending' || s.min > mod) continue;
      s.status = 'done';
      if (s.hobbyId) {                       // 周末的爱好活动
        var h = hobby(s.hobbyId);
        if (!h) continue;
          c.activeTaskId = null;
        log(c, ts, pick(h.lines), 'hobby');
        continue;
      }
      // LLM 排的那一天：只有一句话和一个行为码，没有任务实体
      if (s.planned) {
        c.activeTaskId = null;
        c.plannedBehavior = { id: s.behavior, until: ts + 45 * MS_PER_MIN };
        log(c, ts, s.line, 'task');
        continue;
      }

      var t = TASK(s.taskId);
      if (!t) continue;
      var dur = t.durationMin || 30;
      var line = '它开始' + (s.label || t.name) + '了。';
      c.activeTaskId = t.id;
      c.activeMin = s.min;   // 同一任务一天可能出现两次（早饭/午饭都是 T12），按时间点区分
      c.activeUntil = ts + dur * MS_PER_MIN;
      log(c, ts, line, 'task');
    }
  }

  // 「它演的事 = 你交的事」的文案落点。放久了的那张被拿出来时有专属句。
  function runSteps(c, from, to, allowEvents) {
    var cursor = from, guard = 0;
    while (cursor < to && guard++ < 400) {
      var next = Math.min(cursor + STEP_MIN * MS_PER_MIN, to);
      var mins = (next - cursor) / MS_PER_MIN;
      ensureDay(c, next, false);
      c.lastTickAt = next;
      processSchedule(c, next, allowEvents);
      if (allowEvents) noteRecall(c, next, mins);
      if (allowEvents) rollEvents(c, next, 'phaseTick');
      if (allowEvents && c.activeTaskId) rollEvents(c, next, 'taskDuring');
      cursor = next;
    }
  }

  /* 新生物开局补算：从今天的早间跑到现在。
   * 否则傍晚才第一次打开页面的用户，会看到一个空的「今日记录」——
   * 而这正是整个产品最需要有内容的模块。 */
  function backfillToday(c, now) {
    var mod = minOfDay(now);
    // 周末起床晚，补算起点跟着变——否则周六早上八点就开始『补算今天』了
    var dawnMin = hm2min(isWeekend(now) ? RULES.weekendPhases.map.wmorning.start
                                        : RULES.phases.map.dawn.start);
    if (mod <= dawnMin) return;
    var dawnTs = now - (mod - dawnMin) * MS_PER_MIN;
    c.lastTickAt = dawnTs;
    runSteps(c, dawnTs, now, true);
    c.lastTickAt = now;
    c.eventsToday = Math.min(c.eventsToday, RULES.randomEvent.maxPerDay - 1);
  }

  function advanceTo(c, now) {
    checkPromotion(c, now);
    var elapsed = now - c.lastTickAt;
    if (elapsed < MS_PER_MIN) return { offline: null };
    var hours = elapsed / 3600000;
    var tiers = RULES.offline.tiers;
    var tier = tiers[2];
    if (hours <= tiers[0].maxHours) tier = tiers[0];
    else if (hours <= tiers[1].maxHours) tier = tiers[1];

    var offlineInfo = null;

    if (tier.mode === 'rebaseline') {
      // 长时间离线：不累加衰减，重置到当前时段基线 + 投放摘要
      rolloverDay(c, now);
      ensureDay(c, now, true);
      c.activeTaskId = null;
      offlineInfo = { tier: 'long', text: buildDigest(c, now, hours) };
      log(c, now, offlineInfo.text, 'digest');
      c.lastTickAt = now;
      c.lastVisitAt = now;
      return { offline: offlineInfo };
    }

    runSteps(c, c.lastTickAt, now, tier.mode === 'full');
    c.lastTickAt = now;

    if (tier.mode === 'damped') {
      offlineInfo = { tier: 'medium', text: pick(COPY.offlineDigest.shortAbsence) };
      log(c, now, offlineInfo.text, 'digest');
    }
    c.lastVisitAt = now;
    return { offline: offlineInfo };
  }

  function buildDigest(c, now, hours) {
    var f = RULES.offline.digest.fabricate;
    var days = Math.max(1, Math.round(hours / 24));
    var meetings = randInt(f.meetingsPerDay[0], f.meetingsPerDay[1]) * days;
    var conclusive = Math.max(0, Math.round(meetings * rand(f.conclusiveRatio[0], f.conclusiveRatio[1])));
    var revisions = randInt(f.revisionsPerDay[0], f.revisionsPerDay[1]) * days;
    var lastVisit = hours < 48 ? '昨天' : days + ' 天前';
    return pick(COPY.offlineDigest.templates)
      .replace('{lastVisit}', lastVisit).replace('{days}', days)
      .replace('{meetings}', meetings).replace('{conclusive}', conclusive)
      .replace('{revisions}', revisions);
  }

  /* ---------- 派生展示状态 ---------- */

  var TASK2BEHAVIOR = {
    T01: 'A02', T02: 'A03', T03: 'A03', T04: 'A03', T05: 'A04', T06: 'A05',
    T07: 'A06', T08: 'A05', T09: 'A06', T10: 'A05', T11: 'A07', T12: 'A08',
    T13: 'A07', T14: 'A09', T15: 'A10', T17: 'A07'
  };

  var WEEKEND_BEHAVIOR = { wnight: 'W01', wmorning: 'W02', wafternoon: 'W04', wevening: 'W04', wlate: 'W04' };

  /* 加班、失眠：跟周日恐惧（W05）同一套办法——按「今天/今晚 + 这只生物」算一个确定性种子，
   * 不查任务表也不用 Math.random。同一晚反复刷新永远是同一个结论，翻篇了才可能换。 */
  function overtimeTonight(c, ts) { return seeded(dateKey(ts) + ':' + c.prototypeId, 'overtime') < 0.32; }
  function insomniaTonight(c, ts) { return seeded(dateKey(ts) + ':' + c.prototypeId, 'insomnia') < 0.30; }

  function behaviorOf(c, ts) {
    var ph = phaseAt(minOfDay(ts), ts);
    if (isWeekend(ts)) {
      if (dayTypeOf(ts) === 'sunday' && new Date(ts).getHours() >= RULES.dayTypes.sunday.dread.fromHour) return 'W05';
      // 刚做完爱好活动的 90 分钟内算「在忙自己的事」。
      // 不能只看 log[0]——吃饭之类的日志会把爱好顶下去。
      for (var i = 0; i < c.log.length && i < 6; i++) {
        var L = c.log[i];
        if (ts - L.ts >= 90 * MS_PER_MIN) break;
        if (L.kind === 'hobby') return 'W03';
      }
      return WEEKEND_BEHAVIOR[ph] || 'W04';
    }
    if (c.plannedBehavior && ts < c.plannedBehavior.until) return c.plannedBehavior.id;
    if (c.activeTaskId && TASK2BEHAVIOR[c.activeTaskId]) return TASK2BEHAVIOR[c.activeTaskId];

    var mod = minOfDay(ts);
    // 通勤（去）：早间刚开始那一小段，比早饭早，不会跟它撞
    if (ph === 'dawn' && mod - hm2min(RULES.phases.map.dawn.start) < 20) return 'A13';
    /* 晚上是一条线：下班 → 路上 → 到家做饭 → 瘫着。
     * 加班的夜里这条线整条都不走——它连往家走的那一步都还没到，回到家也不会再开火了。 */
    if (ph === 'evening') {
      var into = mod - hm2min(RULES.phases.map.evening.start);
      if (overtimeTonight(c, ts)) return into < 90 ? 'A14' : 'A10';
      if (into < 20) return 'A13';    // 通勤（回）
      if (into < 60) return 'A16';    // 到家先开火
      return 'A10';
    }
    if (ph === 'night') return insomniaTonight(c, ts) ? 'A15' : 'A10';
    if (ph === 'lunch') return 'A08';
    return 'A01';
  }

  function behaviorCopy(id) {
    return COPY.behavior[id] || COPY.weekendBehavior[id] || { label: '—', lines: ['—'] };
  }

  /* ---------- 计划外的那一下 ----------
   * 它按日程过一天，这件事本身是好的——它开会的时候你也在开会，那种同步感是这个东西的底。
   * 但完全照表走就只是一张时间表。所以留一个口子：偶尔它会自己越出日程做点什么，
   * 只挂在状态栏后面，不改行为、不改任务、不碰任何数值。
   *
   * 必须是确定性的。UI 每 10 秒重绘一次，这里要是用 Math.random，
   * 这句话就会每 10 秒换一次——那是闪烁，不是惊喜。
   * 所以拿「第几个时段 + 它是谁」算一个种子：同一个 13 分钟里永远是同一句，
   * 时段翻页了才可能换掉，或者干脆没有。 */

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0; }
    return h;
  }

  // 同一个种子派生出几个互不相关的 0~1：分别决定「这段有没有」「说自己还是说你」「说哪句」
  function seeded(seed, salt) { return (hashStr(seed + '|' + salt) % 100003) / 100003; }

  /* 今天的即兴池。按天存，认原型。 */
  function riffsOf(c, ts) {
    var r = c && c.riffs;
    if (!r || r.protoId !== c.prototypeId) return [];
    var got = r.byDay && r.byDay[dateKey(ts || Date.now())];
    return (got && got.length) ? got : [];
  }

  /* 你还在不在电脑前。外层每分钟从系统空闲时间刷进来。 */
  var awake = false;
  function setAwake(v) { awake = !!v; }

  /* 今天轮到第几句。数已出过几句，按当天固定顺序往下走——一轮走完才重复。 */
  function riffTurn(c, ts, n) {
    var IMP = COPY.impulse, slot = IMP.slotMs;
    var day = new Date(ts); day.setHours(0, 0, 0, 0);
    var dayStart = day.getTime();
    var mine = Math.floor(ts / slot);
    var used = 0;

    for (var t = Math.floor(dayStart / slot); t < mine; t++) {
      var sd = t + ':' + c.prototypeId + ':' + (c.createdAt || 0);
      if (seeded(sd, 'on') >= IMP.chance) continue;                  // 那一格没冒 impulse
      if (seeded(sd, 'riff') >= (IMP.riffChance || 0)) continue;     // 冒了但没用即兴
      used++;
    }

    // 当天固定的一个偏移，让不同的日子起点不同
    var off = Math.floor(seeded(dateKey(ts) + ':' + c.prototypeId, 'order') * n);
    return (off + used) % n;
  }

  function impulseOf(c, ts) {
    var IMP = COPY.impulse;
    if (!IMP || !c) return null;

    var bid = behaviorOf(c, ts);
    if ((IMP.mute || []).indexOf(bid) >= 0) return null;      // 睡着的时候不该还有小动作

    // 深夜闭嘴，除非你还在动。深夜没有自己的行为码，只能按时段挡
    if (IMP.muteNightUnlessAwake && phaseAt(minOfDay(ts), ts) === 'night' && !awake) return null;

    var seed = Math.floor(ts / IMP.slotMs) + ':' + c.prototypeId + ':' + (c.createdAt || 0);
    if (seeded(seed, 'on') >= IMP.chance) return null;        // 大部分时段它就是在老实上班

    var at = function (pool, salt) { return pool[Math.floor(seeded(seed, salt) * pool.length)]; };

    var notes = (c.notes || []).filter(function (n) { return n.text && !n.doneAt; });

    // 今天的即兴。没生成就落到下面的静态池
    var rf = riffsOf(c, ts);
    if (rf.length && seeded(seed, 'riff') < (IMP.riffChance || 0)) {
      var line = rf[riffTurn(c, ts, rf.length)];
      if (line.indexOf('{text}') < 0) return line;
      // 要引一张便签但手边空着——这句今天用不上，落回静态池
      if (notes.length) return line.split('{text}').join(at(notes, 'which').text);
    }

    // 提你手边的一张。这是最像「它真的在」的一下，所以先试它
    if (notes.length && seeded(seed, 'about') < IMP.noteChance)
      return at(IMP.aboutNote, 'line').split('{text}').join(at(notes, 'which').text);

    // 跟此刻在干嘛有关的更贴，但不能每次都是——不然它就只有一套反应了
    var byB = IMP.byBehavior[bid];
    var byQ = IMP.byQuirk[styleOf(c).quirk] || IMP.byQuirk.none;
    return at((byB && seeded(seed, 'src') < 0.6) ? byB : byQ, 'pick');
  }

  /* 档位不再由隐藏数值决定，而是由「它手边有多少件」决定。
   * 文案池一条没浪费，而且更诚实——它沉重是因为你给的多，不是因为某个看不见的数字。 */
  var LOAD_TIERS = [
    { from: 8, key: 'danger' }, { from: 5, key: 'low' },
    { from: 3, key: 'normal' }, { from: 1, key: 'stable' }, { from: 0, key: 'excellent' }
  ];

  function tierByLoad(c) {
    var n = loadNotes(c).length, t = COPY.stateTier;
    for (var i = 0; i < LOAD_TIERS.length; i++)
      if (n >= LOAD_TIERS[i].from) return t[LOAD_TIERS[i].key] || t.normal;
    return t.normal;
  }

  function tierOf(v) {
    var t = COPY.stateTier;
    // 必须跳过下划线开头的注释字段——data/*.json 里到处是 _note，
    // 直接 for...in 会把它当成档位去读 .range，白天打开必崩。
    for (var k in t) {
      if (k.charAt(0) === '_' || !t[k] || !t[k].range) continue;
      if (v >= t[k].range[0] && v <= t[k].range[1]) return t[k];
    }
    return t.normal;
  }

  function statusLine(c, ts) {
    var ph = phaseAt(minOfDay(ts), ts);
    if (isWeekend(ts)) {
      // 周日晚八点之后压过一切——这是全周最该被说中的一刻
      if (dayTypeOf(ts) === 'sunday' && new Date(ts).getHours() >= RULES.dayTypes.sunday.dread.fromHour)
        return pick(COPY.sundayDread.lines);
      var w = COPY.weekend[ph];
      if (dayTypeOf(ts) === 'saturday' && Math.random() < 0.25) w = COPY.weekend.saturdayBonus;
      return pick(w || COPY.weekend.wafternoon);
    }
    if (ph === 'night') return pick(COPY.nightPool.lines);
    if (ph === 'evening') {
      var h = new Date(ts).getHours();
      var key = h < 21 ? '19-21' : (h < 23 ? '21-23' : '23-24');
      return pick(COPY.eveningPool[key]);
    }
    return pick(tierByLoad(c).lines);
  }

  /* 板子底边那一行。黑色只放状态标签，文案全从这儿出。
   * 按轻重排队：周日恐惧 > 即兴 > 按时段的静态池。
   * （删过一条「晚上+手边≥4件=加班档」：便签多不等于在加班。） */
  /* 一格之内不重抽。impulse 本来就按 13 分钟的格子走，静态池跟着同一个格子，
   * 整行就稳定了——否则 render 每 10 秒跑一次，pick() 每次都换一句。 */
  var deskCache = { slot: -1, id: null, text: '' };

  function deskLine(c, ts) {
    ts = ts || Date.now();
    var slot = Math.floor(ts / (COPY.impulse.slotMs || 780000));
    if (deskCache.slot === slot && deskCache.id === c.prototypeId) return deskCache.text;

    var text = deskPick(c, ts);
    deskCache = { slot: slot, id: c.prototypeId, text: text };
    return text;
  }

  function deskPick(c, ts) {

    /* 它刚把某张翻出来提了一句。那是它自己想起来的，不是你动了它才说——
     * 所以该说出口，而不是只让那张便签闪一下。 */
    var top = c.log && c.log[0];
    if (top && top.kind === 'note' && ts - top.ts < (COPY.impulse.slotMs || 780000))
      return top.text;

    // 周日晚上：全周最该被说中的一刻
    if (isWeekend(ts) && dayTypeOf(ts) === 'sunday'
        && new Date(ts).getHours() >= RULES.dayTypes.sunday.dread.fromHour)
      return pick(COPY.sundayDread.lines);

    var imp = impulseOf(c, ts);
    if (imp) return imp;

    return statusLine(c, ts);
  }

  /* ---------- 用户操作 ---------- */

  var ACTION2EVENT = {
    accompany: null, feed: 'E31', rest: 'E32', encourage: 'E33',
    drink: 'E34', slack: 'E35', snack: 'E36'
  };

  /* 手动让它重说一句。换宠物、勾掉最后一件这种时刻，不该等满一格 */
  function resetDeskLine() { deskCache.slot = -1; }

  function userAction(c, action, now) {
    if (action === 'accompany') {
      var t = c.activeTaskId;
      var e29 = EVENT('E29'), e30 = EVENT('E30');
      var e = (t && e30.trigger.requireTaskIds.indexOf(t) >= 0) ? e30
            : (t && e29.trigger.requireTaskIds.indexOf(t) >= 0) ? e29 : null;
      if (!e) return { ok: false, reason: '它现在没有在做什么正经事，陪不上。' };
      c.companionUntil = c.activeUntil;
      return { ok: true, text: applyEvent(c, e, now) };
    }
    var id = ACTION2EVENT[action];
    var ev = EVENT(id);
    if (!ev) return { ok: false, reason: '未知操作' };
    if (ev.trigger.phases && ev.trigger.phases.indexOf(phaseAt(minOfDay(now), now)) < 0)
      return { ok: false, reason: '现在不是时候。' };
    // 低状态时用专属文案
    var saved = ev.copy;
    var text = applyEvent(c, ev, now);
    ev.copy = saved;
    return { ok: true, text: text };
  }

  /* ---------- 便签 ----------
   * 桌面版的驱动源。用户贴一张便签 = 把一件事交给它拿着。
   * 堆积 → 它被压弯；划掉 → 它松一口气；放久了它会提起。
   * 这取代了 jobs.taskPool 作为「它今天在承受什么」的来源。
   *
   * 待办 / 灵感这对区分已经删掉：两种颜色都能勾、都能改、都进回看。
   * 颜色留下的唯一差别在画面上——黄色堆成地上的纸，粉色飘成头顶的泡泡。
   * 「纸有重量、泡泡没有」这对反义词因此仍然成立，见 loadNotes()。
   */

  // 多行之后 60 字就不够写了。上限仍然要有：便签是「一件事」，不是日记本。
  var NOTE_MAX = 200;

  function openNotes(c) {
    if (!c.notes) return [];
    return c.notes.filter(function (n) { return !n.doneAt; });
  }

  /* 负载 = 手边未勾选的黄色，就是你在桌上看见的那摞纸。
   * 粉色再多也不算——它飘在头顶，没有重量。这条是「颜色只改变它的反应」的落点：
   * 它决定文案档位、决定它压弯到什么程度，但两种颜色在功能上依然完全平等。
   *
   * 还没写字的空白便签也不算：你点了个圆钮而已，什么都还没交给它。
   * 跟「它的反应绑在第一次写进字那一刻」是同一条线。 */
  function loadNotes(c) {
    return openNotes(c).filter(function (n) { return n.text && n.color !== 'pink'; });
  }

  function bubbleNotes(c) {
    return openNotes(c).filter(function (n) { return n.text && n.color === 'pink'; });
  }

  function findNote(c, id) {
    for (var i = 0; i < (c.notes || []).length; i++) if (c.notes[i].id === id) return c.notes[i];
    return null;
  }

  /* 个性化包里有同名的池就用它，否则用静态池。认原型——换宠物不串音。 */
  function noteLine(pool, map) {
    var t = pick(pool);
    for (var k in map) t = t.split('{' + k + '}').join(map[k]);
    return t;
  }

  /* 新建 = 桌上多一张空白便签，文字由用户就地敲。
   * 因此这里不跑分类（还没有文字可分）、也不给分（连点圆钮就成了刷分）——
   * 两件事都推迟到 editNote 里第一次写进字的那一刻。 */
  function addNote(c, color, now) {
    if (!c.notes) c.notes = [];
    now = now || Date.now();
    var n = {
      id: 'N' + (++c.noteSeq),
      text: '',
      color: color === 'pink' ? 'pink' : 'yellow',
      createdAt: now,
      doneAt: null,
      recalledAt: 0,
      earned: false
    };
    c.notes.unshift(n);
    return n;
  }

  /* 就地编辑。只动文字：doneAt 和回看快照都不碰。 */
  function editNote(c, id, text, now) {
    var n = findNote(c, id);
    if (!n) return null;
    text = String(text == null ? '' : text);
    if (text.length > NOTE_MAX) text = text.slice(0, NOTE_MAX);
    if (n.text === text) return n;

    var wasBlank = !n.text.trim();
    n.text = text;
    delete n.cls;                               // 字改了，分类得重算

    if (text.trim()) {
      global.Classify.of(n);
      // 第一次写进字，才算「你把一件事交给了它」——它这时候才反应、才给分
      if (!n.earned) {
        n.earned = true;
        earn(c, n.color, now || Date.now());
        // 不出声。你交东西给它是你的动作，它说话只因为它自己的事
      }
    } else if (wasBlank) {
      n.earned = false;                         // 一直是空的，等于还没交出来
    }
    return n;
  }

  /* 拖动排序。顺序就是 c.notes 的数组顺序，没有单独的 order 字段。
   * 落点用「拖完之后排在它前面的是谁」表示，不用下标——列表里会隐藏前几天划掉的便签，
   * 屏幕上的下标跟完整数组对不上。afterId 为空表示拖到了最前面。 */
  function moveNote(c, id, afterId) {
    if (!c.notes || id === afterId) return;
    var idx = function (x) {
      for (var i = 0; i < c.notes.length; i++) if (c.notes[i].id === x) return i;
      return -1;
    };
    var from = idx(id);
    if (from < 0) return;
    var n = c.notes.splice(from, 1)[0];
    var at = afterId ? idx(afterId) + 1 : 0;
    c.notes.splice(at < 0 ? 0 : at, 0, n);
  }

  function toggleNote(c, id, now) {
    now = now || Date.now();
    var n = findNote(c, id);
    if (!n || !n.text.trim()) return null;      // 空白便签没有可勾的东西

    // 撤销：不给回血（避免反复勾选刷状态），并且把回看里那条一并抹掉——
    // 撤销的意思是「那件事并没有完」，回看不该留着它。
    // 快照的 doneAt 就是便签的 doneAt，同一张勾过很多次也只会命中这一次的那条。
    if (n.doneAt) {
      var at = n.doneAt;
      n.doneAt = null;
      c.done = (c.done || []).filter(function (d) { return !(d.noteId === n.id && d.doneAt === at); });
      return null;
    }

    n.doneAt = now;
    snapshot(c, n, now);
    earn(c, 'done', now);
    return null;
  }

  /* 勾选那一刻抓一份文字快照。这是回看能成立的全部理由：
   * 便签随时可以改，直接引用便签本体的话，今天改一个字三天前那条记录会跟着变。 */
  function snapshot(c, n, now) {
    if (!c.done) { c.done = []; c.doneSeq = c.doneSeq || 0; }
    c.done.push({
      id: 'D' + (++c.doneSeq),
      noteId: n.id,
      text: n.text,
      color: n.color,
      doneAt: now
    });
  }

  /* 拿走一张便签。已经勾过的那些，快照留着不动——那件事确实完成过，
   * 删掉便签只是把桌面收拾了一下，不是把它没发生过。 */
  function dropNote(c, id) {
    if (!c.notes) return;
    c.notes = c.notes.filter(function (x) { return x.id !== id; });
  }

  /* ---------- 按天回看 ----------
   * 按「划掉的那天」归档，读 c.done 的快照而不是便签本体——便签可以随时改，
   * 直接引用的话三天前的记录会跟着变。
   * 没勾过的不进这里。 */
  function archive(c) {
    var byDay = {}, days = [];
    (c.done || []).forEach(function (d) {
      var k = dateKey(d.doneAt);
      if (!byDay[k]) { byDay[k] = { key: k, ts: d.doneAt, items: [] }; days.push(byDay[k]); }
      if (d.doneAt < byDay[k].ts) byDay[k].ts = d.doneAt;
      byDay[k].items.push(d);
    });
    days.forEach(function (d) {
      d.items.sort(function (a, b) { return a.doneAt - b.doneAt; });   // 一天之内按划掉的先后
    });
    return days.sort(function (a, b) { return b.ts - a.ts; });         // 最近的一天在最上面
  }

  /* 回看的月视图：只报当月每天划掉了几件，不算完成率、不连续打卡——
   * 那会把回看变成一个考核你的东西。 */
  function archMonth(c, year, month) {
    var counts = {};
    (c.done || []).forEach(function (d) {
      var t = new Date(d.doneAt);
      if (t.getFullYear() === year && t.getMonth() === month) {
        counts[t.getDate()] = (counts[t.getDate()] || 0) + 1;
      }
    });
    return counts;
  }

  /* 板子顶上那行只报数，不替它说话。 */
  function loadText(c) {
    var n = loadNotes(c).length;
    return n ? n + ' 条便签' : '';
  }

  /* 每个模拟步调用：深夜负载 / 压久了的黄色 / 放久了的粉色。三者互斥，一步最多说一句。
   * 前两条读黄色（那是压着它的），第三条读粉色（那是它翻出来的）——
   * 跟画面上「地上的纸 / 头顶的泡泡」是同一套口径。 */
  function noteRecall(c, ts, minutes) {
    if (!c.notes || !c.notes.length) return;
    if (ts - (c.noteRecallAt || 0) < 90 * MS_PER_MIN) return;   // 至少隔 90 分钟才再提一次
    var scale = minutes / 60;
    var DAY = 86400000;

    var hour = new Date(ts).getHours();
    var open = loadNotes(c);
    var NL = NOTES.nightLoad;
    if (hour >= NL.fromHour && open.length >= NL.minOpen && Math.random() < NL.chancePerHour * scale) {
      log(c, ts, noteLine(NL.lines, { n: open.length }), 'note');
      c.noteRecallAt = ts;
      resetDeskLine();
      return;
    }

    var stale = open.filter(function (n) { return ts - n.createdAt >= NOTES.stale.staleDays * DAY; });
    if (stale.length && Math.random() < NOTES.stale.chancePerHour * scale) {
      var s = pick(stale);
      // 用 round 而不是 floor：模拟步落在 ts 之前几分钟，floor 会把「5 天前」说成「4 天前」
      log(c, ts, noteLine(NOTES.stale.lines, {
        text: s.text, days: Math.max(NOTES.stale.staleDays, Math.round((ts - s.createdAt) / DAY))
      }), 'note');
      c.noteRecallAt = ts;
      resetDeskLine();
      return;
    }

    var kept = bubbleNotes(c).filter(function (n) {
      return n.text
          && ts - n.createdAt >= NOTES.pinkRecall.afterDays * DAY
          && ts - (n.recalledAt || 0) >= 7 * DAY;
    });
    if (kept.length && Math.random() < NOTES.pinkRecall.chancePerHour * scale) {
      var d = pick(kept);
      d.recalledAt = ts;
      log(c, ts, noteLine(NOTES.pinkRecall.lines, { text: d.text }), 'note');
      c.noteRecallAt = ts;
      resetDeskLine();
    }
  }

  /* ---------- 积分与抽宠物 ----------
   * 积分来自「你记了东西」，不来自「你照顾了它」——后者就是被删掉的喂食按钮。
   * 抽卡不碰任何状态：它不会让它好受一点，也不会让它更累。 */

  function earn(c, key, now) {
    var e = GACHA.earn, add = (e[key] || {}).points || 0;
    if (!add) return 0;
    var day = dateKey(now || Date.now());
    if (c.pointsDay !== day) { c.pointsDay = day; c.pointsToday = 0; }
    add = Math.min(add, Math.max(0, e.dailyCap - c.pointsToday));   // 每日上限，防刷
    c.pointsToday += add;
    c.points = (c.points || 0) + add;
    return add;
  }

  function rollPet(c, now) {
    var R = GACHA.roll, CP = GACHA.copy;
    c.owned = c.owned || [c.prototypeId];
    if (c.owned.length >= PROTOS.length) return { ok: false, text: CP.allOwned };
    if ((c.points || 0) < R.cost) return { ok: false, text: CP.notEnough.replace('{n}', R.cost - c.points) };

    c.points -= R.cost;
    var got = pick(PROTOS);                                        // 全池随机，重复是机制的一部分
    var dup = c.owned.indexOf(got.id) >= 0;
    if (dup) c.points += R.dupRefund;
    else c.owned.push(got.id);

    var text = pick(dup ? CP.dupPet : CP.newPet).split('{name}').join(got.name);
    log(c, now || Date.now(), text, 'gacha');
    return { ok: true, dup: dup, id: got.id, name: got.name, text: text };
  }

  /* ---------- 存档 ---------- */

  /* 待办 / 灵感 → 黄 / 粉。
   * 已经划掉的那些要补一条快照，否则老存档一进来回看就是空的。
   * 快照的 text 只能用当前文字——勾选那一刻的文字没有被记下来过，这是能拿到的最好近似。 */
  function migrateNotes(c) {
    if (!c.done) { c.done = []; c.doneSeq = c.doneSeq || 0; }
    var need = [];
    c.notes.forEach(function (n) {
      if (!n.color) n.color = n.kind === 'idea' ? 'pink' : 'yellow';
      delete n.kind;
      if (n.text == null) n.text = '';
      if (n.earned == null) n.earned = !!n.text.trim();
      if (n.doneAt && !hasSnapshot(c, n)) need.push(n);
    });
    need.sort(function (a, b) { return a.doneAt - b.doneAt; })
        .forEach(function (n) { snapshot(c, n, n.doneAt); });
  }

  function hasSnapshot(c, n) {
    for (var i = 0; i < c.done.length; i++)
      if (c.done[i].noteId === n.id && c.done[i].doneAt === n.doneAt) return true;
    return false;
  }

  function save(c) {
    var str;
    try { str = JSON.stringify(c); } catch (e) { return; }
    try { localStorage.setItem(SAVE_KEY, str); } catch (e) {}
    /* 桌面壳在的话，顺手往 userData 抄一份。浏览器里没有这条路——
     * 那边的保险只有图鉴底部那个「导出存档」，记得定期导。 */
    try { if (global.DESKTOP && global.DESKTOP.backup) global.DESKTOP.backup(str); } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || c.version !== 1 || !c.prototypeId) return null;
      // 便签系统上线前的存档没有这几个字段
      if (!c.notes) { c.notes = []; c.noteSeq = 0; c.noteRecallAt = 0; }
      migrateNotes(c);
      if (c.points == null) { c.points = 0; c.pointsToday = 0; c.pointsDay = null; }
      if (!c.owned || !c.owned.length) c.owned = [c.prototypeId];
      if (c.promoteAt == null) c.promoteAt = nextPromoteAt(c.createdAt || Date.now());

      /* matchedId 这个字段是后加的，更早的存档里没有——但五轴原始值一直都在，
       * 拿它重算一次就能把测评结果找回来。 */
      if (!c.matchedId && c.axes) c.matchedId = matchPrototype(c.axes);

      /* 测评算出来的那只本来就属于你，哪怕当时被 forcePrototype 压住、没能出场。
       * 补进图鉴，随时可以换过去。 */
      if (c.matchedId && c.owned.indexOf(c.matchedId) < 0) c.owned.push(c.matchedId);

      /* 本机覆盖对已有存档也生效一次——否则改了只有新建的存档看得到。
       * 只切一次并打标记：之后你在图鉴里换成谁，就是谁。 */
      var forced = forcedPrototype();
      if (forced && c.devForced !== forced) {
        c.devForced = forced;
        c.prototypeId = forced;
        if (c.owned.indexOf(forced) < 0) c.owned.push(forced);
      }
      return c;
    } catch (e) { return null; }
  }
  function reset() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  global.Engine = {
    newCreature: newCreature, advanceTo: advanceTo, userAction: userAction,
    save: save, load: load, reset: reset,
    riffsOf: riffsOf, setAwake: setAwake,
    addNote: addNote, editNote: editNote, moveNote: moveNote,
    toggleNote: toggleNote, dropNote: dropNote, NOTE_MAX: NOTE_MAX,
    openNotes: openNotes, loadNotes: loadNotes, bubbleNotes: bubbleNotes,
    loadText: loadText, styleOf: styleOf,
    archive: archive, archMonth: archMonth, dateKey: dateKey,
    NOTEMAP: NOTEMAP,
    behaviorOf: behaviorOf, statusLine: statusLine, impulseOf: impulseOf,
    deskLine: deskLine, resetDeskLine: resetDeskLine,
    phaseAt: phaseAt, dayTypeOf: dayTypeOf, isWeekend: isWeekend,
    phaseMeta: phaseMeta, behaviorCopy: behaviorCopy, minOfDay: minOfDay, min2hm: min2hm, hm2min: hm2min,
    TASK: TASK, PROTO: PROTO, JOB: JOB, forcedPrototype: forcedPrototype,
    rollPet: rollPet, GACHA: GACHA, checkPromotion: checkPromotion,
    PROTOS: PROTOS, renameFor: function (id) { return makeName(PROTO(id)); },
    RULES: RULES, COPY: COPY, ASSESS: ASSESS, NOTES: NOTES, pick: pick,
    axesFromPicks: axesFromPicks, matchPrototype: matchPrototype, rankPrototypes: rankPrototypes
  };
})(window);
