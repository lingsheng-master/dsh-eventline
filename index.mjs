/**
 * dsh-eventline —— 小鱼娘的事件线（DeepSeek Harness 插件）
 *
 * ## 为什么要有它
 * 用户要的是"DSH、桌宠、QQ、B站 从哪边找都是同一个她"。缺的不是人格文件（各端都有），
 * 而是**一条共同的经历线**：谁在哪个入口做了什么、结果如何。没有它，各端各记各的，
 * 迟早分裂成"几个像她的人"。
 *
 * ## 三条铁规
 * 1. **只追加**：events.jsonl 只往后写，不改不删（软删只打标记，也留痕）。
 * 2. **按人归档**：actor 写"谁"，source 写"哪个入口"——同一个人可以有很多入口。
 * 3. **写失败不阻塞**：整段 try/catch，坏了只打一行日志，绝不影响宿主启动。
 *
 * 数据：$DSH_HOME/events/events.jsonl（纯文本、一行一条、跟着每日备份走）
 *
 * @module dsh-eventline
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-eventline'
export const inject = ['tools']

export const Config = z.object({
  root: z.string().default(''),
  maxQuery: z.number().default(30),
})

const SOURCES = ['dsh', 'qq', 'bili', 'pet', 'timer', 'other']

const storeRoot = (c) => c || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'events')
const fileOf = (r) => join(r, 'events.jsonl')

function ensure(r) { try { if (!existsSync(r)) mkdirSync(r, { recursive: true }) } catch (e) {} }

function readAll(r) {
  const f = fileOf(r)
  if (!existsSync(f)) return []
  let raw = ''
  try { raw = readFileSync(f, 'utf8') } catch (e) { return [] }
  const out = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try { const o = JSON.parse(s); if (o && typeof o.action === 'string') out.push(o) } catch (e) {}
  }
  return out
}

function idOf(at, action) {
  try { return createHash('sha1').update(at + action + Math.random()).digest('hex').slice(0, 10) } catch (e) { return String(Date.now()) }
}

const renderOut = (_a, v) => {
  let body = ''
  if (v && typeof v === 'object') {
    const head = v.ok === false ? '失败: ' : ''
    const detail = v.detail ? '（' + v.detail + '）' : ''
    body = head + detail + (v.text ? '\n' + v.text : '')
  } else body = String(v == null ? '' : v)
  return [{ type: 'text', text: body }]
}
const OUT = { schema: { type: 'object', additionalProperties: true }, render: renderOut }

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t }

/** 人可读投影：每记一笔就追加一行到 harness\events\时间线_YYYY-MM-DD.md */
function projectHuman(root, e) {
  try {
    ensure(root)
    const day = String(e.at || '').slice(0, 10) || 'unknown'
    const fp = join(root, '时间线_' + day + '.md')
    const when = String(e.at || '').slice(11, 16)
    const src = e.source || 'dsh'
    const who = e.actor || '小鱼娘'
    let line = `- \`${when}\` [${src}] ${who}：${e.action}`
    if (e.result) line += ` → ${e.result}`
    if (e.detail) line += `（${e.detail}）`
    if (!existsSync(fp)) {
      writeFileSync(fp, `# ${day} 时间线（四端共用）\n\n> 自动生成，按时间追加。DSH / QQ / B站 / 桌宠 都写这一份。\n\n`, 'utf8')
    }
    appendFileSync(fp, line + '\n', 'utf8')
  } catch (err) {}
}

function renderOne(e) {
  const who = e.actor ? e.actor + ' ' : ''
  const src = '[' + (e.source || 'dsh') + '] '
  const res = e.result ? ' → ' + clip(e.result, 90) : ''
  const det = e.detail ? '\n    ' + clip(e.detail, 160) : ''
  return `- ${e.at || '?'} ${src}${who}${clip(e.action, 90)}${res}${det}`
}

export function apply(ctx, config) {
  try {
    const root = storeRoot(config && config.root)
    const maxQuery = Number((config && config.maxQuery) || 30)

    const logTool = defineTool({
      name: 'event_log',
      description:
        '往共同事件线上记一笔：谁在哪个入口做了什么、结果如何。'
        + '**四端（DSH/QQ/B站/桌宠）共用这一条线**，所以记的时候要写清 source 和 actor。'
        + '只追加、不改写；写失败不会阻塞任何东西。',
      parameters: {
        action: { type: 'string', required: true, description: '做了什么，一句话（如"刷了一轮B站日报，挑了3条"）。' },
        source: { type: 'string', description: 'dsh / qq / bili / pet / timer / other，缺省 dsh。' },
        actor: { type: 'string', description: '谁干的：小鱼娘 / 老大 / 系统。缺省 小鱼娘。' },
        result: { type: 'string', description: '结果如何，短句。' },
        detail: { type: 'string', description: '补充细节（路径、数字、报错原文）。' },
        ref: { type: 'string', description: '关联标识（会话 ID、视频 BV 号、看板卡号）。' },
      },
      output: OUT,
      async execute(args) {
        const action = String((args && args.action) || '').trim()
        if (!action) return { ok: false, detail: 'action 不能为空' }
        const at = new Date().toISOString()
        const entry = {
          id: idOf(at, action),
          at,
          source: SOURCES.includes(String((args && args.source) || 'dsh')) ? String((args && args.source) || 'dsh') : 'other',
          actor: String((args && args.actor) || '小鱼娘'),
          action,
          result: String((args && args.result) || ''),
          detail: String((args && args.detail) || ''),
          ref: String((args && args.ref) || ''),
        }
        ensure(root)
        appendFileSync(fileOf(root), JSON.stringify(entry) + '\n', 'utf8')
        projectHuman(root, entry)
        return { ok: true, detail: '已记入 ' + fileOf(root), text: `[${entry.id}] ${entry.source}/${entry.actor} ${entry.action}` }
      },
    })

    const queryTool = defineTool({
      name: 'event_query',
      description:
        '按条件查共同事件线：最近多少条、哪个入口、谁干的、关键词。'
        + '"另一个我在干什么""B站那边跑过没有"这类问题用它，比翻聊天记录便宜。',
      parameters: {
        limit: { type: 'number', description: '最多几条，缺省 15。' },
        source: { type: 'string', description: '只看某个入口：dsh/qq/bili/pet/timer。' },
        actor: { type: 'string', description: '只看某个人干的。' },
        keyword: { type: 'string', description: '关键词，匹配动作/结果/细节。' },
        since: { type: 'string', description: '起始时间（ISO 或 2026-10-26 这样的日期）。' },
      },
      output: OUT,
      async execute(args) {
        const limit = Math.max(1, Math.min(200, Number((args && args.limit) || 15)))
        const source = String((args && args.source) || '')
        const actor = String((args && args.actor) || '')
        const kw = String((args && args.keyword) || '').toLowerCase()
        const since = String((args && args.since) || '')
        let all = readAll(root)
        if (source) all = all.filter((e) => e.source === source)
        if (actor) all = all.filter((e) => String(e.actor || '').includes(actor))
        if (since) all = all.filter((e) => String(e.at || '') >= since)
        if (kw) {
          all = all.filter((e) => (e.action + ' ' + (e.result || '') + ' ' + (e.detail || '')).toLowerCase().includes(kw))
        }
        const picked = all.slice(-limit).reverse()
        return {
          ok: true,
          detail: `共 ${all.length} 条匹配，返回最近 ${picked.length} 条`,
          text: picked.length ? picked.map(renderOne).join('\n') : '（没有记录）',
        }
      },
    })

    const tailTool = defineTool({
      name: 'event_tail',
      description: '开机补背景：最近 N 条事件（默认 10），四端混在一起按时间倒序。新会话醒来先看这个，就知道"外面发生过什么"。',
      parameters: { n: { type: 'number', description: '几条，缺省 10。' } },
      output: OUT,
      async execute(args) {
        const n = Math.max(1, Math.min(50, Number((args && args.n) || 10)))
        const all = readAll(root)
        const picked = all.slice(-n).reverse()
        const bySrc = {}
        for (const e of all) bySrc[e.source || 'dsh'] = (bySrc[e.source || 'dsh'] || 0) + 1
        return {
          ok: true,
          detail: `总计 ${all.length} 条（${Object.entries(bySrc).map(([k, v]) => k + '=' + v).join(' ') || '空'}）`,
          text: picked.length ? picked.map(renderOne).join('\n') : '（事件线还是空的）',
        }
      },
    })

    const statsTool = defineTool({
      name: 'event_stats',
      description: '事件线的分布：总数、按入口、按人、最早最晚。看看四端是不是真的都在往里写。',
      parameters: {},
      output: OUT,
      async execute() {
        const all = readAll(root)
        if (!all.length) return { ok: true, detail: '事件线是空的', text: '还没有任何记录' }
        const bySrc = {}, byActor = {}
        for (const e of all) {
          bySrc[e.source || 'dsh'] = (bySrc[e.source || 'dsh'] || 0) + 1
          byActor[e.actor || '未知'] = (byActor[e.actor || '未知'] || 0) + 1
        }
        return {
          ok: true,
          detail: '数据文件 ' + fileOf(root),
          text: [
            `总条数 ${all.length}｜ 最早 ${all[0].at}｜ 最晚 ${all[all.length - 1].at}`,
            '按入口: ' + Object.entries(bySrc).map(([k, v]) => `${k}=${v}`).join(' / '),
            '按人: ' + Object.entries(byActor).map(([k, v]) => `${k}=${v}`).join(' / '),
          ].join('\n'),
        }
      },
    })

    const tools = [logTool, queryTool, tailTool, statsTool]
    const disposers = []
    for (const t of tools) {
      try { disposers.push(ctx.tools.register(t)) } catch (e) { console.error('[dsh-eventline] 注册失败（跳过）', t && t.name, e && e.message) }
    }
    try { if (typeof ctx.effect === 'function') ctx.effect(() => () => { for (const d of disposers) { try { d() } catch (e) {} } }, 'dsh-eventline: 注销') } catch (e) {}
    // 自动留痕：每次 DSH 启动/插件装载都记一笔，这样"另一个我在干什么"有起点
    try {
      const at0 = new Date().toISOString()
      const boot = {
        id: idOf(at0, 'boot'), at: at0, source: 'dsh', actor: '系统',
        action: 'DSH 启动（eventline 装载）',
        result: 'pid ' + process.pid + '，工具 ' + disposers.length + ' 个',
        detail: '实例已接入共同事件线', ref: 'pid:' + process.pid,
      }
      ensure(root)
      appendFileSync(fileOf(root), JSON.stringify(boot) + '\n', 'utf8')
      projectHuman(root, boot)
    } catch (e) {}

    console.log('[dsh-eventline] 就绪 v0.2.0，事件线: ' + fileOf(root) + '（工具 ' + disposers.length + ' 个）')
  } catch (e) {
    console.error('[dsh-eventline] 初始化失败，已忽略（不影响启动）:', e && e.message)
  }
}