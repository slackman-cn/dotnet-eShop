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
| Step 4 结论 | 已编写从零复现手册 quickstart-from-scratch.md（不是 clone 后启动）；未改源码，未停服务，未改 architecture.md 与仓库根 README |
| Step 5 结论 | 已编写独立手册 quickstart-from-scratch-v2.md（从空目录创建并跑通，正文约 2 万字；含架构、数据结构、流程图与状态图）；未改源码，未覆盖 v1 与 architecture.md |

## 文档

- [quickstart.md](./quickstart.md)：如何把**现成仓库**跑起来（开发环境、IDE、中间件 compose、宿主机启动 5 个 API、验证与常见问题）
- [quickstart-from-scratch.md](./quickstart-from-scratch.md)：从空白目录**复现** Articles（Step1 环境 → Step2 官方/第三方模板建项目 → Step3 测试验证技术选型 → Step4 整体结构与建议补上的 CI → Step5 按功能模块做 MVP）
- [quickstart-from-scratch-v2.md](./quickstart-from-scratch-v2.md)：从空目录创建并跑通的独立手册（v2，约 2 万字；含完整架构、数据结构、流程图与状态图，不依赖其他文档）
- [architecture.md](./architecture.md)：架构设计分析（2026-11-15，正文 17,753 字，70 段源码摘录；基于提交 `63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721`）
- [Articles-steps.md](./Articles-steps.md)：分步记录（命令、版本、结果、地址、问题）
- [screenshots/](./screenshots/)：Swagger、Hasura Console、RabbitMQ 管理页截图
- [docker-compose.local.yml](./docker-compose.local.yml)：叠加在上游 compose 上的 Postgres 健康检查覆盖（与 quickstart 中的完整中间件 YAML 一致）

2026-11-15 起，本仓库决定继续用现有微服务方案分析这类 .NET 项目（已放弃把 eShop 改成 Serverless）。
