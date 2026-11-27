# Splash `note` 命令与字符画拟物浮层备忘录设计文档

为 Splash 新增 `note` 复杂命令（`new`、`ls`、`rm`、`<id>` 读写、`--gui`），并配套实现 Shell 通用多段管道（含 `echo` 与支持 `stdin` 的 `cat`）、三层环境变量机制（行内前缀、`export`/`unset`/`env`、`/etc/splash.d/config` 的 `env.EDITOR`）、以及复用 `VimSession` 的字符软木板便签墙与浮层 Vim 编辑器。

- Design: `.ryugi/artifacts/document/note-command/doc.xml`
- Read: `ryugi get --artifact document/note-command --detail --project-dir /Users/bytedance/i/m9ch/splash` (through the ryugi:artifacts launcher)
- Boards: `artboard/note-gui` (chosen: `q1-corkboard`)
- Approved: 2026-11-27
