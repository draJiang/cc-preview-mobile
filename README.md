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

`npm start` 会先用 Vite 把 `client/` 构建到 `dist/`，再启动服务。

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

## 开发前端

前端在 `client/`（Vue 3 + Vite + Tailwind CSS v4 + [shadcn-vue](https://www.shadcn-vue.com/)，聊天组件来自 [ai-elements-vue](https://github.com/vuepont/ai-elements-vue)，源码直接放在 `client/src/components/` 里，可以随意修改）。

```bash
npm run dev
```

同时启动后端（`PORT`，默认 4173）和带热更新的 Vite 开发服务器（默认 5173，`/ws` 会代理到后端）。改完后用 `npm run typecheck` 做类型检查。

## 功能

- 手机网页里直接发消息给 Claude Code，实时看到回复、思考过程、工具调用和结果；连续的工具调用会折叠成步骤，Bash 显示命令、Edit 显示 diff
- 工具调用需要授权时，网页上会弹出确认卡片（允许 / 拒绝 / 本次会话始终允许）；卡片滚出屏幕时，输入框上方会出现"待审批"提示，点一下跳回卡片
- 右上角 ⚙ 是唯一的设置入口：权限模式、模型、用量、主题（跟随系统 / 浅色 / 深色）、默认是否展开工具详情和思考过程、关闭当前会话
- 权限模式不是"默认"时，输入框上方会显示当前模式
- Claude 工作时，没输入内容的情况下发送按钮变成停止（■），可以打断当前操作；输入了内容则照常发送（排队到下一轮）
- **多 Session 管理**：点左上角 ☰ 或标题打开会话列表（按项目分组），可以新建 Session（从最近项目中选，或输入任意路径）、切换 Session、关闭 Session（⋯ 菜单里关闭，需二次确认）
- **重启不丢会话**：Session 列表和聊天记录会存到本地 `data/sessions/*.json`，重启 `npm start` 后自动恢复，并通过 SDK 的 `resume` 接回真实的 Claude Code 对话上下文（不只是界面回放）

## 说明 & 限制

- 只监听局域网（`0.0.0.0`），网页本身没有登录验证，请勿暴露到公网
- 同一个 Session 被多个设备/标签页同时查看时，看到的是同一份对话，历史会自动同步；不同 Session 之间相互独立
- 新打开网页会自动接到"最近活跃"的那个 Session；想开一个全新的对话，去会话面板点"＋"
- `data/` 目录里是明文保存的聊天记录，注意不要把这个目录传出去
