# dotnet-eShop 学习文档

本仓库只记录对 [dotnet/eShop](https://github.com/dotnet/eShop) 的学习笔记、截图和辅助脚本，不包含 eShop 源码。

对照提交：[`913acea66708a59595351174cee9b29f37179d29`](https://github.com/dotnet/eShop/commit/913acea66708a59595351174cee9b29f37179d29)（Confine catalog picture reads to Pics）

## 文档

- [步骤记录](docs/eShop-steps.md)：Step 1 环境搭建、Step 2 项目结构 / 依赖 / 中间件分析、Step 3 Aspire 本地部署、Step 4 架构设计研究、Step 5 架构设计 v2、Step 6 Serverless 可行性对比，以及附录
- [架构设计](docs/architecture.md)：按真实项目规划口径整理的微服务 / 云原生参考架构说明
- [架构设计 v2（详细版）](docs/architecture-v2.md)：在 v1 结论上展开技术选型、服务拆分、通信与可靠性、开发部署与测试
- [架构改造：Serverless / FaaS / BaaS 对比](docs/serverless-faas-baas.md)：评估现有微服务能否改为 Serverless，以及混合改造路径
- [截图](docs/screenshots/)：首页、商品详情、Aspire 仪表板等
- [脚本](docs/scripts/)：用 Playwright 打开站点与仪表板的辅助脚本
