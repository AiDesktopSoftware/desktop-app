# Git 协作与自动提交规则

## 自动提交（用户指令，最高优先级）

每次任务完成后，AI 必须**自动完成提交与推送**，不需要用户提醒：

1. 任务结束前执行 `git status`，把本次任务涉及的文件加入暂存区（不要 `git add -A`）
2. 提交信息格式：`<type>: <description>`（feat / fix / refactor / docs / chore / test）
3. 推送到远程当前分支（按下方「分支与评审」判断该推哪个分支）
4. **禁止**提交 `开发日记.md`（已被 .gitignore 排除，见 dev-log.md）
5. 提交与推送的结果（成功，或失败的具体原因）必须在回复中说明，不许静默跳过

## 远程仓库

- 组织：`AiDesktopSoftware`（注意：**无连字符**；`ai-desktop-software` 是另一个无关组织，不要用）
- 远程地址：`https://github.com/AiDesktopSoftware/desktop-app.git`
- 本机凭据账号：`ducenwu`，在组织中角色为 admin，可直接推送

## 网络（GitHub 直连不通）

- 本机 GitHub 443 直连超时，推送前若连不上，先启动 `E:\softwareInstall\Clash Verge\clash-verge.exe`，
  并在当前会话设置代理后再推送：`$env:HTTPS_PROXY='http://127.0.0.1:7897'`（混合端口 7897）
- 代理未开启时不要反复重试推送，先确认代理端口 7897 是否在监听

## 分支与协作（三人分工，用户明确要求）

| 改动范围 | 提交分支 | 说明 |
|---|---|---|
| 公共外壳（`App.vue`、`assets/main.css`、`src/main/`、`src/preload/`、构建配置、规则文档、备份脚本） | `main` | 共有前端，改动需保证不影响三个模块 |
| 赵的个人模块（`views/work/`） | `feat/zhao-work` | AI 只在此分支做赵的模块，做完推送；需要合入 main 时走 PR |
| 龙的个人模块（`views/chat/`） | `feat/long-chat` | 由龙自己开发，AI 不得在该目录写任何内容 |
| 胡的个人模块（`views/info/`） | `feat/hu-info` | 由胡自己开发，AI 不得在该目录写任何内容 |

铁律：

1. 除公共外壳外，赵的所有任务都只在 `feat/zhao-work` 分支进行，不得直接提到 `main`
2. `views/chat/`、`views/info/` 对 AI 只读，禁止添加业务内容、mock 数据或样式
3. 公共外壳改动提交到 `main` 后，赵的分支需定期 `merge main` 同步，避免长期分叉
4. 个人分支合入 `main` 走 Pull Request，不直接强推

## 本地备份（防误删，用户明确要求）

- 一键备份：`npm run backup`（脚本 `scripts/backup.ps1`）
- 双保险：仓库外文件快照 `E:\programFiles\traeCode\_backups\project3P\<时间戳>`（保留最近 20 份）
  + git 标签 `snapshot/<时间戳>`（并推送到远程）
- 已跑通的代码改动完成后、以及大改之前，都应先跑一次 `npm run backup`
- 严禁用 `git reset --hard`、`git clean -fdx`、删除目录等破坏性操作清理工作区

## 分支与评审

- 默认在「分支与协作」表中对应分支提交
- 涉及跨模块改动、或需要队友评审时，开 `feat/xxx` 分支并走 Pull Request
