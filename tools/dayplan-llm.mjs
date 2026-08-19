/* 职场生物 · 「它自己的一天」生成器（可选）
 *
 *   node tools/dayplan-llm.mjs 存档.json            为今天生成
 *   node tools/dayplan-llm.mjs 存档.json --days 7   一次生成一周
 *   node tools/dayplan-llm.mjs 存档.json --dry      只打印
 *
 * 为什么是离线预生成，不是实时调用：
 *   零延迟、零 key 泄露、成本可控、断网照常跑。生成的是它一天的日程和台词，
 *   引擎从里面播，没有就退回 job.taskPool 的随机日程——降级是正常路径。
 *
 * 为什么不把便签内容喂进去：
 *   你的 memo 不进它的日程。它替你拿着那些事，但并不替你做。
 *   prompt 里只有「它手边有几件事」这个数字，没有任何一条便签的原文。
 */
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.resolve(import.meta.dirname, '..');
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8')
  .replace(/^[\s\S]*?window\.GAME_DATA = /, '').replace(/;\s*$/, ''));

const BEHAVIORS = Object.entries(D.copy.behavior)
  .filter(([k]) => !k.startsWith('_'))
  .map(([k, v]) => `  ${k}  ${v.label}`).join('\n');

/* 提示词在 data/dayplan.json 里，不在这儿——它是文案，该跟其他文案一起放。
 * {{BEHAVIORS}} 在这里替换成 copy.json 的行为码清单。 */
const CFG = D.dayplan;
const SYSTEM = CFG.systemPrompt.split('{{BEHAVIORS}}').join(BEHAVIORS);

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          at: { type: 'string' },
          behavior: { type: 'string', enum: Object.keys(D.copy.behavior).filter(k => !k.startsWith('_')) },
          line: { type: 'string' },
        },
        required: ['at', 'behavior', 'line'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const client = new Anthropic();

async function genDay(proto, job, date, load) {
  const res = await client.messages.create({
    model: CFG.model,
    max_tokens: CFG.maxTokens,
    // 编排一天不需要长思考，但要一点变化——所以留着 adaptive，只把 effort 压到 low。
    // Opus 5 上关掉思考反而可能把内部标签漏进文本，低 effort 是更稳的省法。
    output_config: { effort: CFG.effort, format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [
        `物种：${proto.name}`,
        `性格：${proto.keywords.join('、')}`,
        `调子：${proto.tone}`,
        `职位：${job.name}`,
        `今天：${WEEKDAY[date.getDay()]}`,
        `它手边替人拿着 ${load} 件事`,
      ].join('\n'),
    }],
  });

  if (res.stop_reason === 'refusal') throw new Error('refusal');
  const text = res.content.find(b => b.type === 'text')?.text;
  if (!text) throw new Error('空响应');
  return { items: JSON.parse(text).items, usage: res.usage };
}

const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hm2min = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) { console.error('用法: node tools/dayplan-llm.mjs <存档.json> [--days N] [--dry]'); process.exit(1); }
  const dry = flags.includes('--dry');
  const days = Math.max(1, Math.min(14, +(flags[flags.indexOf('--days') + 1] || 1)));

  const save = JSON.parse(fs.readFileSync(file, 'utf8'));
  const proto = D.prototypes.prototypes.find(p => p.id === save.prototypeId);
  const job = D.jobs.jobs.find(j => j.id === save.jobId);
  if (!proto || !job) { console.error('存档里的 prototypeId / jobId 找不到'); process.exit(1); }

  // 负载只数黄色，跟引擎的 loadNotes() 一个口径：粉色飘在头顶，没有重量
  const load = (save.notes || []).filter(n => n.color !== 'pink' && !n.doneAt && n.text).length;
  save.dayplans = save.dayplans || {};

  console.log(`${proto.name}（${proto.tone}）· ${job.name} · 手边 ${load} 件\n`);
  let made = 0;

  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const key = dateKey(d);
    if (save.dayplans[key]) { console.log(`${key} 已有，跳过`); continue; }

    try {
      const { items, usage } = await genDay(proto, job, d, load);
      const plan = items
        .map(it => ({ min: hm2min(it.at), behavior: it.behavior, line: it.line }))
        .filter(x => x.min >= 0 && x.min < 1440)
        .sort((a, b) => a.min - b.min);
      save.dayplans[key] = plan;
      made++;
      console.log(`${key}  ${WEEKDAY[d.getDay()]}   (${usage.input_tokens}↓ ${usage.output_tokens}↑ cache ${usage.cache_read_input_tokens ?? 0})`);
      plan.forEach(x => console.log(`   ${it2hm(x.min)}  ${x.line}`));
      console.log('');
    } catch (err) {
      // 生成不出来不是错误，是降级：引擎会退回 job.taskPool 的随机日程。
      if (err instanceof Anthropic.RateLimitError) console.error(`${key} 限流，跳过（今天走随机日程）`);
      else if (err instanceof Anthropic.APIConnectionError) console.error(`${key} 网络不通，跳过`);
      else if (err instanceof Anthropic.APIError) console.error(`${key} API ${err.status}: ${err.message}`);
      else console.error(`${key} 解析失败: ${err.message}`);
    }
  }

  if (!made) { console.log('没有生成任何一天。'); return; }
  if (dry) { console.log('--dry，未写盘'); return; }
  fs.writeFileSync(file, JSON.stringify(save, null, 2), 'utf8');
  console.log(`✓ ${made} 天已写回 ${file}`);
}

const it2hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

main().catch(e => { console.error(e); process.exit(1); });
