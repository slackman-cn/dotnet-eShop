# github-eShop：dotnet/eShop 分析与运行记录

本目录收录对上游项目 [dotnet/eShop](https://github.com/dotnet/eShop) 的部署记录与分析，与同级的 `github-Articles/` 并列。源码不进入本仓库，只保存在本机研究环境（如 `/workspace/eShop`）。

## 项目信息

| 项 | 内容 |
| --- | --- |
| 上游 | https://github.com/dotnet/eShop |
| 对照提交 | `913acea66708a59595351174cee9b29f37179d29`（分支 `main`） |
| 技术栈 | .NET 10、.NET Aspire 13.6；官方本地启动是 **`aspire run` / AppHost**，不是 docker compose 全栈 |
| 中间件 | Postgres + pgvector、Redis、RabbitMQ（由 Aspire 拉起；本目录另有中间件合约 compose） |
| 本机实测 | SDK 10.0.303，Aspire CLI 13.6.5，Docker 29.9.3；17 个资源 Running / Healthy |

## 文档

- [quickstart.md](./quickstart.md)：如何把**现成仓库**跑起来（开发环境、IDE、中间件 compose 合约、Aspire 启动与验证）
- [quickstart-from-scratch.md](./quickstart-from-scratch.md)：从空白目录**复现** eShop（Step1 环境 → Step2 官方/第三方模板建项目 → Step3 测试验证技术选型 → Step4 整体结构与 DevOps → Step5 按功能模块做 MVP）
- [docker-compose.middleware.yml](./docker-compose.middleware.yml)：仅含中间件的独立 compose 合约（配 [docker-compose.middleware.init.sql](./docker-compose.middleware.init.sql)）
- [eShop-steps.md](./eShop-steps.md)：分步记录（命令、版本、结果、地址、问题）
- [architecture.md](./architecture.md)：架构设计（v1）
- [architecture-v2.md](./architecture-v2.md)：架构设计详细版
- [serverless-faas-baas.md](./serverless-faas-baas.md)：Serverless 可行性对比（已决定不采用）
- [screenshots/](./screenshots/)、[scripts/](./scripts/)

2026-11-15 起，本仓库决定继续用现有微服务方案分析这类 .NET 项目（已放弃把 eShop 改成 Serverless）。
