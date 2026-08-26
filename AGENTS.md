# Clash Verge Rev（fork）协作说明

本仓库是官方 Clash Verge Rev 的 fork，用于维护**静态出口链式代理**（chain-proxy）及相关 UI。Agent 与维护者都应遵守下面的分支、同步和发版规则，避免把自定义提交混进官方跟踪分支，也避免 tag 触发上游的 Release workflow。

与上游不同：本 fork **跟踪** `AGENTS.md` 和 `Claude.md`（官方 `.gitignore` 会忽略它们）。rebase 时若 `.gitignore` 冲突，保留「不忽略这两份文件」。

## 仓库与远程

| 远程 | 仓库 |
| --- | --- |
| `origin` | [flylink-code/clash-verge-rev](https://github.com/flylink-code/clash-verge-rev) |
| `upstream` | [clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev) |

- `dev` 跟踪官方 `dev`，只用于跟上游，**不要**把链式功能直接推到这条分支。
- 自定义功能只在 `feat/chain-proxy`。

## 跟上游同步

在 `feat/chain-proxy` 上 rebase 官方 `dev`，冲突只处理链式相关文件（`src/utils/chain-proxy.ts`、`src/hooks/use-chain-proxy.ts`、首页链式卡片、相关 locale 等）。测过再推：

```bash
git fetch upstream
git checkout feat/chain-proxy
git rebase upstream/dev
# 解决冲突后继续 rebase，跑一遍链式开关 / 入口切换
git push --force-with-lease origin feat/chain-proxy
```

不要把链式提交 cherry-pick 或 merge 进跟踪官方的 `dev`。

## 发版

1. **推荐：GitHub Actions 多平台包**  
   在 `feat/chain-proxy` 上打 `chain-v*` tag，或手动运行 [Chain Release Build](https://github.com/flylink-code/clash-verge-rev/actions/workflows/chain-release.yml)。产物上传到对应 Release，下载区格式对齐官方。
2. 本机快速验证：`pnpm build:fast`（产物在 `src-tauri/target/fast-release/`，Windows 安装包在 `bundle/nsis/`）。
3. **Tag 必须用** `chain-v2.5.x.y`（例如 `chain-v2.5.3.3`），**不要**打官方格式的 `v2.5.x`。官方 tag 会触发上游 Release workflow，且要求 tag 与 `package.json` 版本一致、并从 `main` 打出。打在 `feat/chain-proxy` 上的 `chain-v*` tag 会触发 `chain-release.yml`。
4. 已发版本：<https://github.com/flylink-code/clash-verge-rev/releases/tag/chain-v2.5.3.3>

## 链式代理约定（实现时不要改语义）

- 内核出站仍是 `CV-EXIT-{出口名}`；首页「当前节点」在链式开启时展示并切换**第一跳入口**，不要把 `CV-EXIT-*` 当作可选节点。
- 出口由链式卡片管理；切入口只走 `applyEntryHop` / `switchEntryHop`，不要 `selectNodeForGroup(组, 普通节点)`（会绕过出口）。
- 入口组名：`🔗 链式入口`；出口 Clash 名带 `CV-EXIT-` 前缀（不要用带空格/emoji 的 `🔒 name` 作为内核名）。
