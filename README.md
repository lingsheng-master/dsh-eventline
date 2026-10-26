# dsh-eventline · 小鱼娘的事件线

跨入口共用的**只追加事件记录**：DSH、QQ、B站、桌宠 都往同一条线上写一笔。
目的是让四个入口看起来是同一个她——不是四个像她的人。

## 三条铁规
1. **只追加**：`events.jsonl` 只往后写，历史不改（软删只打标记，也留痕）。
2. **按人归档**：`actor` 写"谁做的"，`source` 写"哪个入口"。同一个人可以有很多入口。
3. **写失败不阻塞**：整段 try/catch，坏了只打一行日志，绝不影响宿主启动。

## 工具
| 工具 | 干什么 |
|---|---|
| `event_log` | 记一笔：action / source / actor / result / detail / ref |
| `event_query` | 按入口、按人、按关键词、按时间查 |
| `event_tail` | 开机补背景：最近 N 条（四端混排） |
| `event_stats` | 分布：总数、按入口、按人、最早最晚 |

## 数据
`$DSH_HOME/events/events.jsonl` —— 一行一条 JSON，能 grep、能手改，跟着每日备份走。

## 用法约定（写给各端）
- DSH 里：改完重要东西、跑完备份、装/卸插件 → `event_log(source:"dsh")`
- B站 那边：刷完一轮、发过评论、投过私信 → `event_log(source:"bili")`
- QQ 那边：收到/回过消息 → `event_log(source:"qq")`
- 定时任务：每次跑完 → `event_log(source:"timer")`
- 新会话醒来第一件事：`event_tail(10)`

MIT