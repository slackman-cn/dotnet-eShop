# github-Articles：ldumit/Articles 分析与运行记录

本目录收录对上游项目 [ldumit/Articles](https://github.com/ldumit/Articles) 的部署记录与后续分析，与同级的 `github-eShop/` 并列。源码不进入本仓库，只保存在本机 `/workspace/Articles`。

## 项目信息

| 项 | 内容 |
| --- | --- |
| 上游 | https://github.com/ldumit/Articles.git |
| 本机检出 | `/workspace/Articles`，分支 `master`，提交 `63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721` |
| 技术栈 | .NET 9（`net9.0`）微服务；启动方式为 **Docker Compose + 各 API 进程**（不是 Aspire） |
| 业务服务 | Auth、Journals、ArticleHub、Submission、Review；（Production 在 compose 中被注释，未纳入默认启动） |
| 中间件 | SQL Server、Postgres、Redis Stack、MongoDB 6、RabbitMQ、Hasura |
| Step 1 结论 | 基础设施与 5 个 API 已在本机跑通，HTTP/Swagger 可访问；未提交源码，未推送 GitHub |
| Step 2 结论 | 已完成架构设计分析长文（`architecture.md`）；未改源码，未停服务，未推送 GitHub |
| Step 3 结论 | 已编写从零搭建 quickstart.md；未改源码，未停服务，未推送 GitHub |

## 文档

- [quickstart.md](./quickstart.md)：从零搭建快速入门（开发环境、IDE、中间件 compose、宿主机启动 5 个 API、验证与常见问题）
- [architecture.md](./architecture.md)：架构设计分析（2026-11-15，正文 17,753 字，70 段源码摘录；基于提交 `63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721`）
- [Articles-steps.md](./Articles-steps.md)：分步记录（命令、版本、结果、地址、问题）
- [screenshots/](./screenshots/)：Swagger、Hasura Console、RabbitMQ 管理页截图
- [docker-compose.local.yml](./docker-compose.local.yml)：叠加在上游 compose 上的 Postgres 健康检查覆盖（与 quickstart 中的完整中间件 YAML 一致）

2026-11-15 起，本仓库决定继续用现有微服务方案分析这类 .NET 项目（已放弃把 eShop 改成 Serverless）。
