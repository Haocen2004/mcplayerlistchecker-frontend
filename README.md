# MC Player List Checker Frontend

独立运行的 Next.js 监控面板，默认读取父项目 `config.json` 中的 MongoDB 和 bot API 配置。依赖已固定为兼容 Node.js 16.15.1 的版本。

功能包括：

- 按 MongoDB `server` 字段筛选历史 TPS、MSPT、在线人数和进退服事件。
- 支持预设时间范围和自定义开始/结束时间查询。
- 支持浅色/深色模式，本地浏览器会记住选择。
- 实时玩家列表通过当前 bot WebSocket 代理刷新。
- 默认 `admin` / `admin` 首次登录后必须进入设置密码页，设置完成前不能访问监控面板或数据 API。

## Commands

```bash
pnpm install
pnpm build
pnpm start
```

服务器环境要求：

- Node.js 16.15.1
- pnpm 8.15.9（已在 `package.json` 中固定；Node 16 不建议用 pnpm 10）
- MongoDB 可访问
- bot API/WS 可访问

默认地址：`http://localhost:3001`

## Environment

```bash
PORT=3001
MONGO_URI=mongodb://localhost:27017
MONGO_DB=mc_checker
BOT_HTTP_URL=http://localhost:3000
BOT_WS_URL=ws://localhost:3000
FRONTEND_AUTH_USER=admin
FRONTEND_AUTH_PASSWORD=admin
# Optional: if omitted, the first startup generates .frontend_jwt_secret
FRONTEND_JWT_SECRET=replace-with-a-long-random-secret
FRONTEND_JWT_SECRET_FILE=.frontend_jwt_secret
FRONTEND_COOKIE_SECURE=false
```

`FRONTEND_COOKIE_SECURE=true` 只应在 HTTPS 部署时启用。本地 HTTP 调试保持 `false`。

如果不设置 `FRONTEND_JWT_SECRET`，应用会在首次启动时生成 `.frontend_jwt_secret`。这个文件必须保留并保持私密；删除后已有登录态会全部失效。
