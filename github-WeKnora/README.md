# github-WeKnora：Tencent/WeKnora 分析与环境记录

本目录收录对上游项目 [Tencent/WeKnora](https://github.com/Tencent/WeKnora) 的分析，与同级的 `github-eShop/`、`github-Articles/`、`github-paperless-ngx/`、`github-trustgraph/` 并列。源码不进入本仓库，只保存在本机研究环境（如 `/workspace/WeKnora`）。这不是 .NET 项目，但仍作为多项目分析仓库中的独立条目。

## 项目信息

| 项 | 内容 |
| --- | --- |
| 上游 | https://github.com/Tencent/WeKnora |
| 本机检出 | 浅克隆（`--depth 1`），默认分支 `main`，提交 `81a0304`（Merge pull request #5658 from NianJiuZst/fix/lite-kb-clone-move-progress，2026-11-18 20:55 Asia/Shanghai），约 276 MB |
| 仓库版本文件 | `VERSION` 为 `0.9.0` |
| 技术栈 | Go 后端 + Vue 前端 + Python `docreader`；默认用 ParadeDB（PostgreSQL 17）做业务库、BM25 与向量检索，Redis / Asynq 做异步任务。官方可用 Docker Compose 或 Kubernetes（Helm）部署，另有 Lite 单二进制。本次只分析 Compose，未使用 Helm |
| 默认核心服务 | `frontend`、`app`、`docreader`、`postgres`（`paradedb/paradedb:v0.25.11-pg17`）、`redis`（`redis:7.0-alpine`） |
| 主要启动路径 | 复制 `.env.example` 为 `.env` 并填写密钥后，`docker compose pull && docker compose up -d`，或 `make start-all` |
| 官方文档 | https://weknora.weixin.qq.com/docs/01-getting-started/02-installation |
| Step 1 结论 | 已浅克隆到本机 `/workspace/WeKnora`，未把源码提交进分析仓库 |
| Step 2 结论 | 已对照官方文档与 `docker-compose.yml`，确认标准部署是 Docker Compose；本机 Docker 已安装，硬件满足 4 核 / 8 GB 起步建议。尚未复制 `.env`，尚未启动 |
| Step 3 结论 | 已梳理知识库链路：文档入库是异步解析、分块、嵌入与索引；问答是检索增强管线。知识图谱依赖可选的 Neo4j，默认关闭。模型类型共五类，对话模型与嵌入模型是起步配置，不是全部 |

## 文档

- [analysis.md](./analysis.md)：仓库分析与部署评估（部署形态、门槛、本机对照、核心与可选服务镜像）
- [pipeline.md](./pipeline.md)：知识库链路（入库、问答、可选知识图谱、模型类型）
- [weknora-steps.md](./weknora-steps.md)：分步记录（命令、版本、结果、限制）
