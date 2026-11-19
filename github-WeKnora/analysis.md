# WeKnora 仓库分析与部署评估

对照提交：上游 [Tencent/WeKnora](https://github.com/Tencent/WeKnora) 的 `main` 分支，提交 [`81a0304`](https://github.com/Tencent/WeKnora/commit/81a03046bed16504d249bb22591492966fc9c9b9)（2026-11-18 20:55，Asia/Shanghai）。仓库内 `VERSION` 为 `0.9.0`。本机浅克隆在 `/workspace/WeKnora`，源码不进入本分析仓库。本文只根据仓库文档与编排文件说明部署方式，尚未实际启动。

## 项目是什么

WeKnora 是腾讯开源的知识库与问答系统。文档解析、向量化、混合检索和大模型推理拆成可替换组件，Web 界面开箱即用。它和 TrustGraph 同属知识库一类项目，但路径不同：WeKnora 默认把业务数据、BM25 关键词检索和向量检索都放在 ParadeDB（PostgreSQL 17）里，知识图谱是可选增强，不是默认运行时。

## 官方有哪些部署形态

官方安装文档见 [安装部署](https://weknora.weixin.qq.com/docs/01-getting-started/02-installation)。仓库里能对应上的形态如下。

| 形态 | 入口 | 数据库与队列 | 适用场景 |
| --- | --- | --- | --- |
| Docker Compose（标准） | 仓库根目录 `docker-compose.yml` | ParadeDB + Redis / Asynq | 生产或团队自托管，官方推荐 |
| Docker Compose（开发） | `docker-compose.dev.yml` + `scripts/dev.sh` | 同上，但只有基础设施进容器 | 本地开发：`app` 与前端在宿主机跑 |
| Kubernetes Helm | `helm/` | Chart 内置 ParadeDB 与 Redis | Kubernetes >= 1.25 |
| Lite 单二进制 | `make build-lite` | SQLite（FTS5 + sqlite-vec）+ 内存队列 | 本机、离线或低资源环境 |
| 桌面应用 | `cmd/desktop`（Wails v2） | 与 Lite 相同 | 文档写明尚未正式发布，需自行构建 |

本次只把标准 Docker Compose 当作后续部署路径，不使用 Kubernetes / Helm。另有腾讯云轻量应用服务器模板和微信对话开放平台在线使用，不属于本机研究范围。

## 标准 Compose 怎么启动

依赖 Docker 20.10+ 与 Compose v2。仓库根目录的推荐命令是：

```bash
cd WeKnora
cp .env.example .env    # 按需编辑，详见文件内注释
docker compose pull
docker compose up -d
```

也可以用 `make start-all`，它调用 `./scripts/start_all.sh`，会额外检查 Ollama、给缺失的 `.env` 做兜底，并预拉取沙箱镜像。`make docker-run` 是较老的 `docker-compose up` 封装。停止用 `docker compose down`；加 `-v` 会连数据卷一起删除。

`.env.example` 里的 `JWT_SECRET`、`SYSTEM_AES_KEY` 默认留空，首次部署需要生成并保存：`JWT_SECRET` 可用 `openssl rand -hex 32`，`SYSTEM_AES_KEY` 必须是 32 字节，可用 `openssl rand -hex 16`。同时还要设置 `DB_USER` / `DB_PASSWORD` / `DB_NAME` 和 `REDIS_PASSWORD`。`docker-compose.yml` 的 `app` 服务使用 `env_file: [.env]`，没有这个文件时 compose 会解析失败。本文不记录任何密钥明文。

业务镜像标签由 `.env` 中的 `WEKNORA_VERSION` 决定，缺省为 `latest`。升级时要先改这个变量（或保持 `latest`），再 `docker compose pull` 后 `up -d`；只执行 `up -d` 可能复用本地缓存镜像，造成界面版本和期望不一致。

启动成功后：

| 服务 | 默认地址 |
| --- | --- |
| Web UI | `http://localhost`（端口由 `FRONTEND_PORT` 决定，默认 80） |
| 后端 API | `http://localhost:8080`（前端 Nginx 也会把 `/api/` 反代到后端） |
| 链路追踪 Langfuse | `http://localhost:3000`（仅在启用 `langfuse` profile 时） |

首次打开界面会进入注册页。大模型可走本机 Ollama（默认 `http://host.docker.internal:11434`），或任意 OpenAI 兼容接口。`OLLAMA_OPTIONAL=true` 时，Ollama 不可用只告警，不阻断启动。

## 硬件与本机对照

官方建议标准 Docker 部署从 4 核 CPU、8 GB 内存起步。`docreader` 含 LibreOffice、Playwright，比较吃内存。磁盘要给 Postgres 卷和 `/data/files` 文件卷留余量。启用 Milvus、OpenSearch、Langfuse 等可选组件还要再加内存。上述 8 GB 起步不含本机 Ollama 的模型权重。

ParadeDB 镜像自 `v0.22.6-pg17` 起，x86 CPU 基线为 `x86-64-v2`（含 SSE4.2、POPCNT），不再强制 AVX2。

本机研究环境是 Debian 13，8 核、15 GiB 内存，Docker Engine 29.9.3、Compose v5.7.1、Buildx v0.39.0 已在此前安装并可用。对照官方门槛：CPU 与内存满足起步建议；Docker 已具备。分析当时尚未为 WeKnora 准备 `.env`，也尚未 `compose up`。本机没有 GPU，适合走托管 LLM 或本机 Ollama。

若同时启用可选的 SearXNG，它默认绑定 `127.0.0.1:8888`。这和此前 TrustGraph 管理界面用过的 8888 可能冲突，但 TrustGraph 已于 2026-11-19 关闭；若以后两边都要跑，需要改 `SEARXNG_PORT`。

## 默认启动的核心服务

不带 `--profile` 时，`docker-compose.yml` 只启动下面五个服务。应用镜像来自 Docker Hub 的 `wechatopenai/weknora-*`，不必先编译这份源码。

| 服务 | 镜像 | 端口（宿主:容器） | 说明 |
| --- | --- | --- | --- |
| `frontend` | `wechatopenai/weknora-ui:${WEKNORA_VERSION:-latest}` | `${FRONTEND_PORT:-80}:80` | Nginx 托管前端，并把 `/api` 反代到 `app` |
| `app` | `wechatopenai/weknora-app:${WEKNORA_VERSION:-latest}` | `${APP_PORT:-8080}:8080` | Go 主服务；REST、SSE、Agent、进程内 Asynq worker；健康检查 `GET /health` |
| `docreader` | `wechatopenai/weknora-docreader:${WEKNORA_VERSION:-latest}` | 仅容器内 `50051`，不发到宿主 | Python gRPC 文档解析；与 `app` 通过共享卷传递图片 |
| `postgres` | `paradedb/paradedb:v0.25.11-pg17` | 标准编排不映射宿主端口 | PostgreSQL 17，带 BM25 / 向量扩展，默认检索引擎 |
| `redis` | `redis:7.0-alpine` | 标准编排不映射宿主端口 | Asynq 队列、流管理、PubSub、限流；需 `REDIS_PASSWORD` |

对应的 Dockerfile 在 `docker/Dockerfile.app`、`docker/Dockerfile.docreader` 等，需要从源码构建时可用 `make docker-build-all` 或 `scripts/build_images.sh`。官方快速路径是直接拉取已发布镜像。

## 可选 profile

按需用 `docker compose --profile <name> up -d` 叠加。`full` 会带上标注了“含 full”的一组服务。

| Profile | 服务 | 用途 |
| --- | --- | --- |
| `neo4j`（含 `full`） | `neo4j:2025.10.1` | 知识图谱，需同时设 `NEO4J_ENABLE=true` |
| `minio`（含 `full`） | `pgsty/minio:...` | S3 兼容对象存储 |
| `qdrant`（含 `full`） | `qdrant/qdrant:v1.16.2` | 可选向量库 |
| `milvus` | `milvusdb/milvus:v2.6.11` | 可选向量库 |
| `weaviate` | `semitechnologies/weaviate:1.28.4` | 可选向量库 |
| `doris` | `apache/doris` FE/BE 4.1.0 | 可选检索引擎 |
| `searxng`（含 `full`） | `searxng/searxng:latest` | 自建 Web 搜索，默认只绑回环 8888 |
| `langfuse`（含 `full`） | Langfuse Web/Worker 以及专用 ClickHouse、MinIO 等 | 可观测性 |
| `dex`（含 `full`） | `dexidp/dex` | 测试用 OIDC |
| `odl-hybrid` | 本地构建的 `weknora-odl-hybrid:local` | Docling / OpenDataLoader 混合解析 |
| `full` | 另含 `sandbox`、`mcp` 及上述带 full 标记的服务 | `sandbox` 镜像默认只构建或拉取，非常驻；MCP 默认端口 8082 |

开发编排 `docker-compose.dev.yml` 会把 Postgres（5432）、Redis（6379）、docreader（50051）映射到宿主机，便于本地 `go run` 和前端开发服务器连接。这不是本次推荐的运行路径。

## 当前状态与限制

- 已完成浅克隆与部署方式对照，未启动 Compose，未验证注册、上传文档或问答。
- 未生成 `.env`，未拉取 WeKnora 业务镜像。
- 知识库链路的说明见 [pipeline.md](./pipeline.md)，依据是仓库内官方文档与编排文件，不是本机实测。
