
# 当前版本问题与漂移清单（勿遗漏）

核对时间：2026-11-01 14:06 Asia/Shanghai

## 版本事实

| 项 | 版本 | 说明 |
|----|------|------|
| 本机官方 CLI | **1.0.62** | `~/.grok/bin/grok` |
| 官方 changelog 最新 | **1.0.70**（2026-10-23） | 本机尚未升到最新 |
| Grox 上游壳 | **v0.3.5** @ `f20c42a` | 2026-09-06 发版 |
| Grox 已验证集成基线 | **CLI 1.0.5**（2026-08-18） | `.grox/official-cli.json` |
| 漂移跨度 | **1.0.5 → 1.0.62（本机）→ 1.0.70（上游最新）** | 约两个月、六十多个小版本 |

结论：**壳能跑，不等于已验证当前 CLI。** 维护上必须把「升 CLI + 冒烟」写成固定步骤；fork 后要把集成基线从 1.0.5 往当前目标推。

## 对本机桌面封装特别相关的变更（1.0.6–1.0.70 摘要）

下列是会碰到 UI/ACP/权限/会话的点，不是完整 changelog。

### 权限 / 安全（P0 冒烟）
- 1.0.7：Always allow / Never allow 默认出现；MCP/web-fetch 可持久 Never
- 1.0.11：默认可配置；auto 模式分类器失败时应出正常权限卡而非静默拒绝
- 1.0.44：并行改同一文件串行化
- 1.0.49：hook 权限在各批准模式都出现；Allow once 只对下一命令
- 1.0.50+：权限规则认原生工具名；auto 对破坏性 git 更谨慎
- 1.0.64：Untrusted 目录只跑 managed hooks；auto 模式 shell 需整条命令匹配 allowlist
- 1.0.67：worktree 继承主仓 always-allow（可关）

### 会话 / 恢复 / 队列（P0 冒烟）
- 多处 resume/picker/标题匹配改进（1.0.54–1.0.65）
- 1.0.51：取消/改发不再错误还原工作区文件（严重修复）
- 1.0.52：关会话时后台任务/审批卡生命周期修正
- 1.0.0+ dashboard / fork / rewind 行为持续变；壳若镜像这些交互需回归

### Memory（P1）
- 1.0.34：Memory GA
- 1.0.51：Memory 仅 on/off（`[memory] enabled`）
- 1.0.63：始终用简洁 MEMORY.md 索引；`/memory` 按读取频率列主题

### Worktree / Git（P1）
- 1.0.42+：`grok worktree create` 等运维命令扩充
- 1.0.50–1.0.68：删除保护、丢失文件报告、sandbox 拒绝创建、Unicode 名等——壳侧 worktree UI 需按「CLI 真相」展示错误，勿吞掉

### MCP / Plugins / Skills（P1）
- 多版本：OAuth、结构化结果、同名工具、插件热更新、hooks
- 1.0.70：`/plugins` 只计成功加载的 skills，并报告因外链跳过的数量——扩展管理页应对齐

### Headless / 管道（P2，脚本向；壳进程托管仍相关）
- 1.0.62：管道提前关闭不再崩；`grok update`/`login` 在 stdout 不可写时不崩；headless 等后台后续回合
- 1.0.67：headless 结束挂起修复
- 壳用 stdio ACP：关注「子进程异常退出清算」是否仍正确

### 配置破坏性（P0 文档）
- 1.0.69：`[ui] simple_mode` 废弃；`[ui] vim_mode` → `[keys] vim`；`grok doctor` 会提示旧键
- 若壳或用户文档仍写旧键，会误导

### 产品移除
- 1.0.51：`/share` 与会话分享从 CLI 移除——壳勿再做分享入口

## 壳侧已知风险（来自 Grox 自身文档，非 CLI）

- 协议模型 TS/Rust 双份手工镜像，易在 CLI 升级后漂移（PRODUCT_REVIEW）
- 集成基线停在 1.0.5，pendingIntegrations 为空但现实已落后
- macOS Computer Use 弱于 Windows（README）
- 未打 DMG 安装包：当前是 `target/debug/grox-desktop` 开发构建

## 冒烟清单（对当前本机 1.0.62，建议升到 1.0.70 后再复测）

1. 启动壳 → 识别到的 CLI 版本号是否为真实本机版本  
2. 登录态 / 发一条只读任务 → 流式思考+回答  
3. 触发一次文件编辑权限卡 → 批准/拒绝/Always（若 UI 有）  
4. Diff 展示与会话重开恢复  
5. 设置里看 MCP/Skills/Plugins 列表是否报错  
6. Worktree 新建失败时错误是否可见  
7. 故意关掉 CLI 或杀子进程 → 壳是否清算为可恢复事故，而非假「仍在运行」

## 维护约定（写入 fork 后）

- 目标 CLI：跟随本机 `grok --version`；官方有更新先 `grok update`，再跑上表冒烟  
- 每升一大截（跨 5+ 小版本）核对 https://x.ai/changelog/build 中权限/会话/MCP/Memory/Worktree  
- 通过后更新 `.grox/official-cli.json` 的 verifiedIntegration（不要只改数字不测）
