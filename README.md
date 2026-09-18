# Claude Code 手机端预览

在 Mac 上起一个本地网页服务，用 [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) 单独跑一个 headless 的 Claude Code 会话，手机在同一局域网内打开网页即可查看输出、发送消息、审批工具调用权限。

这是一个**独立于桌面客户端的新会话**（桌面客户端本身没有对外暴露的接口可以被镜像/远程发消息）。

## 首次使用：登录

SDK 内置了自己的一份 `claude` 可执行文件，和桌面客户端是分开登录状态的，第一次需要单独登录一次：

```bash
npm install
./node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/claude
```

会进入一个交互式会话并引导你完成浏览器登录（Claude Pro/Max 账号）。登录成功后 `Ctrl+C` 退出即可，凭证会保存下来，以后启动网页服务时会自动复用，不需要重复登录。

> 如果 `node_modules` 目录下是 `claude-agent-sdk-darwin-arm64`（Apple Silicon）而不是 `darwin-x64`，把上面命令里的路径换成对应的文件夹名即可。

## 启动服务

```bash
npm start
```

终端会打印出局域网访问地址，例如：

```
Network: http://192.168.3.110:4173   <-- 用手机在同一 WiFi 下打开这个
```

手机连上同一个 WiFi，浏览器打开这个地址即可。

默认 Claude 的工作目录是你的用户主目录（`~`）。想指定别的项目目录：

```bash
PROJECT_DIR=/path/to/your/project npm start
```

也可以指定端口（默认 `4173`）：

```bash
PORT=8080 npm start
```

## 功能

- 手机网页里直接发消息给 Claude Code，实时看到回复、思考过程、工具调用和结果
- 工具调用需要授权时，网页上会弹出确认卡片（允许 / 拒绝 / 本次会话始终允许）
- 顶部可以切换权限模式：默认逐项确认 / 自动接受编辑 / 仅规划
- 中断按钮（■）可以打断正在进行的操作
- **多 Session 管理**：点头部标题打开会话面板，可以新建 Session（自定义项目路径）、切换 Session、关闭 Session（点两次 × 确认）
- **重启不丢会话**：Session 列表和聊天记录会存到本地 `data/sessions/*.json`，重启 `npm start` 后自动恢复，并通过 SDK 的 `resume` 接回真实的 Claude Code 对话上下文（不只是界面回放）

## 说明 & 限制

- 只监听局域网（`0.0.0.0`），网页本身没有登录验证，请勿暴露到公网
- 同一个 Session 被多个设备/标签页同时查看时，看到的是同一份对话，历史会自动同步；不同 Session 之间相互独立
- 新打开网页会自动接到"最近活跃"的那个 Session；想开一个全新的对话，去会话面板点"＋"
- `data/` 目录里是明文保存的聊天记录，注意不要把这个目录传出去
