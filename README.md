# 项目分析文档

本仓库用来记录对多个开源项目的分析、步骤记录和结论，不包含各项目的源代码。早期条目以 .NET 项目为主，也收录其他技术栈。

每个上游项目对应一个目录。当前已收录：

| 目录 | 上游项目 | 说明 |
| --- | --- | --- |
| [github-eShop](github-eShop/) | [dotnet/eShop](https://github.com/dotnet/eShop) | Microsoft 官方的云原生电商参考应用；本仓库按现有微服务架构进行分析 |
| [github-Articles](github-Articles/) | [ldumit/Articles](https://github.com/ldumit/Articles) | 学术期刊投稿与审稿微服务系统；用 Docker Compose + 各 API 进程启动（不是 Aspire） |
| [github-paperless-ngx](github-paperless-ngx/) | [paperless-ngx/paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) | 文档管理系统（Python / Django + Angular）；主要用 Docker Compose 启动 |

后续分析其他项目时，会在仓库根目录新增同级目录，并在上表补充条目。

## github-eShop：dotnet/eShop

- **上游仓库：** [dotnet/eShop](https://github.com/dotnet/eShop)
- **对照提交：** [`913acea66708a59595351174cee9b29f37179d29`](https://github.com/dotnet/eShop/commit/913acea66708a59595351174cee9b29f37179d29)（Confine catalog picture reads to Pics）
- **项目定位：** AdventureWorks 风格的参考网上商店，用来演示 .NET 云原生微服务。
- **技术栈（摘要）：** .NET 10、.NET Aspire 13.6、ASP.NET Core Minimal API、Blazor WebApp、gRPC（Basket）、EF Core + PostgreSQL（含 pgvector）、Redis、RabbitMQ、Duende IdentityServer、YARP（`mobile-bff`）。
- **本地研究环境：** 在分析用的 Linux 环境中克隆并运行，由 Aspire 编排 17 个资源（Step 3 实测全部为 Running / Healthy）。本仓库只保存文档、截图和辅助脚本，不保存 eShop 源码。
- **架构决策：** 2026-11-15 决定不采用 Serverless / FaaS / BaaS，继续使用现有的进程型微服务架构。评估过程见 [Serverless 对比](github-eShop/serverless-faas-baas.md)。
- **文档目录：** [github-eShop/](github-eShop/)（由原 `docs/` 于 2026-11-15 更名而来）

### 文档清单

- [从零搭建 Quickstart](github-eShop/quickstart.md)：如何把现成仓库跑起来（开发环境、IDE、中间件 compose 合约、Aspire 启动与验证）
- [从零复现手册](github-eShop/quickstart-from-scratch.md)：不克隆上游，按 Step1–Step5 从空白目录复现（环境、模板建项目、测试验证技术选型、整体结构与 DevOps、按模块做 MVP）
- [从零复现手册 v2](github-eShop/quickstart-from-scratch-v2.md)：从空目录创建并跑通的独立手册（v2，约 2.5 万字；含完整架构、数据结构、流程图与状态图，不依赖其他文档）
- [中间件 docker-compose 合约](github-eShop/docker-compose.middleware.yml)：仅含 Postgres + pgvector、Redis、RabbitMQ（配 [初始化脚本](github-eShop/docker-compose.middleware.init.sql)）；官方启动路径仍是 Aspire
- [步骤记录](github-eShop/eShop-steps.md)：Step 1 环境搭建、Step 2 项目结构 / 依赖 / 中间件分析、Step 3 Aspire 本地部署、Step 4 架构设计研究、Step 5 架构设计 v2、Step 6 Serverless 可行性对比、Step 7 决定维持微服务架构、Step 8 将文档目录改为 `github-eShop`、Step 9 编写 quickstart、Step 10 编写从零复现手册，以及附录
- [架构设计](github-eShop/architecture.md)：按真实项目规划口径整理的微服务 / 云原生参考架构说明
- [架构设计 v2（详细版）](github-eShop/architecture-v2.md)：在 v1 结论上展开技术选型、服务拆分、通信与可靠性、开发部署与测试
- [架构改造：Serverless / FaaS / BaaS 对比](github-eShop/serverless-faas-baas.md)：评估现有微服务能否改为 Serverless。已决定不采用，文档仅作评估记录保留
- [截图](github-eShop/screenshots/)：首页、商品详情、Aspire 仪表板等
- [脚本](github-eShop/scripts/)：用 Playwright 打开站点与仪表板的辅助脚本

## github-Articles：ldumit/Articles

- **上游仓库：** [ldumit/Articles](https://github.com/ldumit/Articles)
- **对照提交：** [`63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721`](https://github.com/ldumit/Articles/commit/63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721)（[All] Cleanup），分支 `master`
- **项目定位：** 学术期刊的投稿、审稿相关微服务系统。
- **技术栈（摘要）：** .NET 9（`net9.0`）；启动方式为 Docker Compose 中间件 + 各 API 在宿主机 `dotnet run`（不是 Aspire）。业务服务包括 Auth、Journals、ArticleHub、Submission、Review；Production 在上游 compose 中被注释，未纳入默认启动。中间件包括 SQL Server、Postgres、Redis Stack、MongoDB、RabbitMQ、Hasura。
- **本地研究环境：** 源码检出在分析用 Linux 环境的 `/workspace/Articles`。Step 1 已在该环境跑通 5 个 API 与中间件，HTTP / Swagger 可访问。Step 2 完成架构设计分析。本仓库只保存文档、截图和本地覆盖配置，不保存 Articles 源码。
- **文档目录：** [github-Articles/](github-Articles/)

### 文档清单

- [从零搭建 Quickstart](github-Articles/quickstart.md)：如何把现成仓库跑起来（开发环境、IDE、中间件 compose、宿主机启动 5 个 API）
- [从零复现手册](github-Articles/quickstart-from-scratch.md)：不克隆上游，按 Step1–Step5 从空白目录复现（环境、模板建项目、测试验证技术选型、整体结构与建议补上的 CI、按模块做 MVP）
- [从零复现手册 v2](github-Articles/quickstart-from-scratch-v2.md)：从空目录创建并跑通的独立手册（v2，约 2 万字；含完整架构、数据结构、流程图与状态图，不依赖其他文档）
- [架构设计](github-Articles/architecture.md)：基于源码与 Step 1 实测的微服务架构分析（正文 17,753 字，70 段源码摘录）
- [步骤记录](github-Articles/Articles-steps.md)：Step 1 尝试部署运行，Step 2 架构设计分析，Step 3 编写 quickstart，Step 4 编写从零复现手册
- [本地覆盖配置](github-Articles/docker-compose.local.yml)：叠加在上游 compose 上的 Postgres 健康检查覆盖
- [截图](github-Articles/screenshots/)：各 API 的 Swagger、Hasura Console、RabbitMQ 管理页
- 目录说明见 [github-Articles/README.md](github-Articles/README.md)

## github-paperless-ngx：paperless-ngx/paperless-ngx

- **上游仓库：** [paperless-ngx/paperless-ngx](https://github.com/paperless-ngx/paperless-ngx)
- **对照提交：** [`4610171a94e5932e85a80e480032e397cdb6f309`](https://github.com/paperless-ngx/paperless-ngx/commit/4610171a94e5932e85a80e480032e397cdb6f309)（Chore (dev): add tsconfig missing types），分支 `dev`
- **项目定位：** 文档管理系统，负责文档摄入、OCR、分类、全文检索、邮件收件和 Web 管理界面。
- **技术栈（摘要）：** Python ≥ 3.11、Django 5.2、Celery、Granian ASGI；前端 Angular 22（`src-ui`，pnpm）。中间件为 Valkey（Redis 兼容）、Postgres 18 / MariaDB 12 / SQLite，可选 Apache Tika 与 Gotenberg。应用容器内同时运行 Web、Celery worker/beat 和消费目录监视进程。
- **本地研究环境：** 已在分析用 Linux 环境浅克隆，并完成本机部署（官方 Postgres + Tika + Gotenberg Compose）。Web 为 http://127.0.0.1:8000/ ，镜像版本 v3.4.2，服务保持运行。本仓库只保存文档和截图，不保存 paperless-ngx 源码与密钥。
- **文档目录：** [github-paperless-ngx/](github-paperless-ngx/)

### 文档清单

- [仓库分析](github-paperless-ngx/analysis.md)：项目结构、依赖、中间件、进程模型、启动命令、部署与配置、数据流
- [本机部署与运行](github-paperless-ngx/deploy.md)：独立部署记录（环境、Compose、端口、镜像、管理员、验证、实际问题）
- [步骤记录](github-paperless-ngx/paperless-ngx-steps.md)：Step 1 下载代码，Step 2 仓库分析，Step 3 本机部署运行
- [截图](github-paperless-ngx/screenshots/)：登录页与仪表盘
- 目录说明见 [github-paperless-ngx/README.md](github-paperless-ngx/README.md)
