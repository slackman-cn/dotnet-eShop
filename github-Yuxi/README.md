# github-Yuxi：xerrors/Yuxi 分析与环境记录

本目录收录对上游项目 [xerrors/Yuxi](https://github.com/xerrors/Yuxi) 的分析，与同级的 `github-eShop/`、`github-Articles/`、`github-paperless-ngx/`、`github-trustgraph/`、`github-WeKnora/` 并列。源码不进入本仓库，只保存在本机研究环境（如 `/workspace/Yuxi`）。这不是 .NET 项目，但仍作为多项目分析仓库中的独立条目。

## 项目信息

| 项 | 内容 |
| --- | --- |
| 上游 | https://github.com/xerrors/Yuxi |
| 本机检出 | 浅克隆（`--depth 1`），默认分支 `main`，提交 `47e4e5a`（fix: 优化会话工具时间线和 Shell 结果展示，2026-11-18 17:30 Asia/Shanghai），约 35 MB |
| 仓库版本 | `backend/pyproject.toml` 为 `0.8.0`。官方快速开始文档要求用 `git clone --branch v0.8.0`；本机当时按默认分支拉的是 `main` |
| 技术栈 | 可私有部署的多租户知识智能体平台（Cloud Agents + Knowledge RAG）。Python 3.13 后端、前端开发端口 5173；默认用 PostgreSQL 16、Redis、MinIO、Milvus（依赖 etcd）和 Neo4j。官方路径是 Docker Compose，应用镜像在本机构建 |
| 主要启动路径 | `./scripts/init.sh` 生成 `.env` 后，`docker compose --profile container up --build -d`。生产用 `docker-compose.prod.yml` 和 `.env.prod` |
| 官方文档 | https://xerrors.github.io/Yuxi/intro/quick-start 、仓库内 `docs/advanced/deployment.md` |
| Step 1 结论 | 已浅克隆到本机 `/workspace/Yuxi`，未把源码提交进分析仓库 |
| Step 2 结论 | 已对照官方文档与 Compose 文件，确认标准部署是 Docker Compose（开发编排与生产编排各一份）。本机 Docker Engine 29.9.3、Compose v5.7.1 满足生产文档要求的 Engine 28.0+、Compose v2.33.1+。尚未运行初始化脚本，尚未启动 |

## 文档

- [analysis.md](./analysis.md)：仓库分析与部署评估（形态、启动命令、核心服务、本机对照）
- [yuxi-steps.md](./yuxi-steps.md)：分步记录（命令、版本、结果、限制）
- [architecture.md](./architecture.md)：系统架构长文（进程拓扑、数据归属、运行链路、扩展登记；基于本机 `main` @ `47e4e5a`，不是官方 `v0.8.0` 标签树）
- [features.md](./features.md)：功能规格长文（按能力域与二次开发场景整理内核、默认开启项和少数真实开关）

以上两份长文不覆盖 `analysis.md` 与 `yuxi-steps.md` 中已有的部署短笔记。正文只依据本机 Yuxi 源码树和仓库内官方文件，撰写时未启动 Compose。
