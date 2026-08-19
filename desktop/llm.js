'use strict';

/* 桌面壳 · LLM 调用层
 * 渲染进程负责「说什么」，这里负责「拿 key 发出去」。key 不进渲染进程。
 * 所有失败都安静返回，引擎那边有静态池接着。 */

const fs = require('fs');
const path = require('path');

let Anthropic = null;
try {
  const mod = require('@anthropic-ai/sdk');
  Anthropic = mod.default || mod;
} catch (e) {
  // 没装依赖也要能跑——这一层整个不可用，别的部分照旧
}

let configPath = null;

const TEMPLATE = {
  _说明: '这个文件只有你这台电脑上有，不会进仓库，也不会跟着存档导出。',
  _怎么填: '三行都填上，保存，重启一次它。之后每天开机自己生成一次，不用你管。',

  _apiKey: '你的服务商给的密钥。留空 = 不用 AI，走静态文案，产品照常跑，不缺任何功能。',
  apiKey: '',

  _baseURL: '接口地址，照服务商文档填。留空则走默认地址。',
  _baseURL2: '这套代码按 Messages 协议（/v1/messages）发请求。多数服务商都提供这样一个入口，'
           + '在它们文档里通常叫「Anthropic 兼容」或「Claude 兼容」——找那个地址填进来。',
  baseURL: '',

  _model: '模型名，照服务商文档填。留空则用 data/riff.json 里写的那个。',
  model: '',

  _换服务商: '这三行一起换就行：apiKey / baseURL / model。代码一个字都不用动。'
};

function init(dir) {
  configPath = path.join(dir, 'llm.json');
  if (!fs.existsSync(configPath)) {
    try { fs.writeFileSync(configPath, JSON.stringify(TEMPLATE, null, 2), 'utf8'); } catch (e) {}
  }
  return configPath;
}

function config() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(configPath, 'utf8')) || {}; } catch (e) {}
  // 环境变量兜底：从终端起的时候不用填文件也能跑
  const key = (c.apiKey || '').trim() || (process.env.ANTHROPIC_API_KEY || '').trim();
  return {
    apiKey: key,
    baseURL: (c.baseURL || '').trim() || undefined,
    model: (c.model || '').trim() || undefined
  };
}

/* 能不能用。渲染进程靠这个决定要不要显示入口，不需要知道 key 本身。 */
function ready() {
  if (!Anthropic) return { ok: false, why: 'nosdk' };
  const c = config();
  if (!c.apiKey) return { ok: false, why: 'nokey', path: configPath };
  return { ok: true, path: configPath };
}

/* 渲染进程把「说什么」整个组装好递过来，这里只负责发出去。
 * payload = { system, user, model, effort, maxTokens, schema } */
async function generate(payload) {
  const st = ready();
  if (!st.ok) return { ok: false, why: st.why };

  const c = config();
  const client = new Anthropic({ apiKey: c.apiKey, baseURL: c.baseURL });

  try {
    const res = await client.messages.create({
      model: c.model || payload.model,
      max_tokens: payload.maxTokens || 1500,
      // 不关思考（Opus 5 上关掉会把内部标签漏进正文），靠低 effort 省
      output_config: {
        effort: payload.effort || 'low',
        format: { type: 'json_schema', schema: payload.schema }
      },
      system: [{
        type: 'text',
        text: payload.system,
        // 提示词是稳定前缀，挂上缓存；Opus 5 的最低可缓存前缀是 512 token
        cache_control: { type: 'ephemeral' }
      }],
      messages: [{ role: 'user', content: payload.user }]
    });

    if (res.stop_reason === 'refusal') return { ok: false, why: 'refusal' };
    const text = (res.content.find(b => b.type === 'text') || {}).text;
    if (!text) return { ok: false, why: 'empty' };

    // 别家会忽略 json_schema 回散文，所以 raw 原样带回去
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    if (!data) {
      // 有些模型会把 JSON 包在 ```json 围栏里
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) { try { data = JSON.parse(fence[1]); } catch (e) {} }
    }
    return { ok: true, data: data, raw: text, usage: res.usage };
  } catch (err) {
    // 分类只为了让日志好读。对调用方来说都一样：这次没拿到，走静态池。
    let why = 'error';
    if (Anthropic.RateLimitError && err instanceof Anthropic.RateLimitError) why = 'ratelimit';
    else if (Anthropic.APIConnectionError && err instanceof Anthropic.APIConnectionError) why = 'offline';
    else if (Anthropic.AuthenticationError && err instanceof Anthropic.AuthenticationError) why = 'badkey';
    else if (Anthropic.APIError && err instanceof Anthropic.APIError) why = 'api' + (err.status || '');
    return { ok: false, why: why, message: err && err.message };
  }
}

module.exports = { init, ready, generate, configPath: () => configPath };
