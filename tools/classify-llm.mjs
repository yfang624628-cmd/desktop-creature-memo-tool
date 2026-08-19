/* 职场生物 · 便签分类的 LLM 增强层（可选）
 *
 * 用法：
 *   node tools/classify-llm.mjs notes.json          分类并把结果写回原文件
 *   node tools/classify-llm.mjs notes.json --dry    只打印，不写盘
 *
 * notes.json 是从浏览器 localStorage 导出的存档（workplace-creature/v1）。
 * 只分类还没有 cls 或 cls.source === 'keyword' 的便签。
 *
 * 这个文件将来会被搬进桌面壳的主进程——key 必须留在原生侧，
 * 绝不能出现在浏览器里。现在的 CLI 形态就是为那一步准备的。
 *
 * 认证：ANTHROPIC_API_KEY，或先 `ant auth login`（零参构造会自动读 profile）。
 */
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.resolve(import.meta.dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/classify.json'), 'utf8'));
const L = CFG.llm;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id:      { type: 'string' },
          domain:  { type: 'string', enum: Object.keys(CFG.schema.domain) },
          kind:    { type: 'string', enum: Object.keys(CFG.schema.kind).filter(k => k[0] !== '_') },
          urgency: { type: 'string', enum: Object.keys(CFG.schema.urgency) },
        },
        required: ['id', 'domain', 'kind', 'urgency'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const client = new Anthropic();

/** 一批便签换一次调用。系统提示词是稳定前缀，挂 cache_control 让重复调用走缓存读。 */
async function classifyBatch(batch) {
  const response = await client.messages.create({
    model: L.model,
    max_tokens: 4096,
    // 分类任务不需要思考。Opus 5 上思考默认是开的，必须显式关掉；
    // 关闭思考只在 effort high 及以下被接受，所以两个一起设。
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: [{
      type: 'text',
      text: L.systemPrompt,
      // Opus 5 的最小可缓存前缀是 512 token；提示词短于这个数就静默不缓存，不报错。
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{
      role: 'user',
      content: batch.map(n => `${n.id}\t${n.text}`).join('\n'),
    }],
  });

  if (response.stop_reason === 'refusal') throw new Error('refusal: ' + response.stop_reason);
  const text = response.content.find(b => b.type === 'text')?.text;
  if (!text) throw new Error('空响应');
  return { items: JSON.parse(text).items, usage: response.usage };
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) { console.error('用法: node tools/classify-llm.mjs <存档.json> [--dry]'); process.exit(1); }
  const dry = flags.includes('--dry');

  const save = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pending = (save.notes || []).filter(n => !n.cls || n.cls.source === 'keyword');

  if (!pending.length) { console.log('没有需要分类的便签。'); return; }
  if (pending.length > L.maxPerDay) {
    console.log(`待分类 ${pending.length} 条，超过 maxPerDay=${L.maxPerDay}，只处理前 ${L.maxPerDay} 条。`);
    pending.length = L.maxPerDay;
  }

  const byId = new Map(save.notes.map(n => [n.id, n]));
  let ok = 0, failed = 0;
  const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  for (const batch of chunk(pending, L.batchSize)) {
    try {
      const { items, usage } = await classifyBatch(batch);
      cost.input += usage.input_tokens;
      cost.output += usage.output_tokens;
      cost.cacheRead += usage.cache_read_input_tokens ?? 0;
      cost.cacheWrite += usage.cache_creation_input_tokens ?? 0;

      for (const it of items) {
        const note = byId.get(it.id);
        if (!note) continue;                       // 模型编了个不存在的 id，丢掉
        note.cls = { domain: it.domain, kind: it.kind, urgency: it.urgency,
                     source: 'llm', at: Date.now() };
        ok++;
        console.log(`  ${it.domain}/${it.kind}/${it.urgency}\t${note.text}`);
      }
    } catch (err) {
      // 降级不是异常路径，是正常路径：分不了就保留关键词的结果，产品照常跑。
      failed += batch.length;
      if (err instanceof Anthropic.RateLimitError)        console.error('限流，这一批保留关键词分类');
      else if (err instanceof Anthropic.APIConnectionError) console.error('网络不通，这一批保留关键词分类');
      else if (err instanceof Anthropic.APIError)        console.error(`API ${err.status}: ${err.message}`);
      else                                                console.error('解析失败:', err.message);
    }
  }

  console.log(`\n✓ ${ok} 条已分类${failed ? `，${failed} 条降级为关键词` : ''}`);
  console.log(`  token  输入 ${cost.input}  输出 ${cost.output}  缓存读 ${cost.cacheRead}  缓存写 ${cost.cacheWrite}`);

  if (dry) { console.log('  --dry，未写盘'); return; }
  fs.writeFileSync(file, JSON.stringify(save, null, 2), 'utf8');
  console.log(`  已写回 ${file}`);
}

main().catch(e => { console.error(e); process.exit(1); });
