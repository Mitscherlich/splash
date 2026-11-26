# Splash 页头动画（ascii.rest）与 vim /etc/splash.d/config 配置系统设计文档

将 `ascii.rest` 的四套页头动画（`big-text`、`night-coast`、`aurora-fjord`、`donut`）及关闭项 `none` 本地静态打包接入 Splash，并通过终端内交替屏幕模态编辑器 `vim /etc/splash.d/config` 与只读 `cat /etc/splash.d/config` 实现配置持久化与即时热更新。

- Design: `.ryugi/artifacts/document/header-and-vim-config/doc.xml`
- Read: `ryugi get --artifact document/header-and-vim-config --detail --project-dir /Users/bytedance/i/m9ch/splash` (through the ryugi:artifacts launcher)
- Boards: none (interactive preview: `html/header-animation`)
- Approved: 2026-11-27
