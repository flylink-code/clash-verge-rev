# Clash Verge Rev（fork）

本仓库是 [flylink-code/clash-verge-rev](https://github.com/flylink-code/clash-verge-rev)，上游为官方 [clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev)。

完整规则见 [AGENTS.md](AGENTS.md)。摘要：

- `dev` 跟踪官方；自定义只在 `feat/chain-proxy`。
- 同步：`git fetch upstream` → `git rebase upstream/dev`（在 `feat/chain-proxy` 上）→ 测过 → `git push --force-with-lease origin feat/chain-proxy`。
- 发版：`pnpm build:fast`；tag 用 `chain-v2.5.x.y`，不要打官方 `v2.5.x`。
- 已发：https://github.com/flylink-code/clash-verge-rev/releases/tag/chain-v2.5.3.2
- 不要把链式提交推到跟踪官方的 `dev`。
