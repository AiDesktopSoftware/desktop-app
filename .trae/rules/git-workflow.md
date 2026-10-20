# Git 协作与自动提交规则

## 自动提交（用户指令，最高优先级）

每次任务完成后，AI 必须**自动完成提交与推送**，不需要用户提醒：

1. 任务结束前执行 `git status`，把本次任务涉及的文件加入暂存区（不要 `git add -A`）
2. 提交信息格式：`<type>: <description>`（feat / fix / refactor / docs / chore / test）
3. 推送到远程当前分支（当前为 `main`）
4. **禁止**提交 `开发日记.md`（已被 .gitignore 排除，见 dev-log.md）
5. 提交与推送的结果（成功，或失败的具体原因）必须在回复中说明，不许静默跳过

## 远程仓库

- 组织：`ai-desktop-software`
- 远程地址：`https://github.com/ai-desktop-software/desktop-app.git`

## 网络（GitHub 直连不通）

- 本机 GitHub 443 直连超时，推送前若连不上，先启动 `E:\softwareInstall\Clash Verge\clash-verge.exe`，
  并在当前会话设置代理后再推送：`$env:HTTPS_PROXY='http://127.0.0.1:7897'`（混合端口 7897）
- 代理未开启时不要反复重试推送，先确认代理端口 7897 是否在监听

## 分支与评审

- 默认直接提交到当前分支
- 涉及跨模块改动、或需要队友评审时，开 `feat/xxx` 分支并走 Pull Request
