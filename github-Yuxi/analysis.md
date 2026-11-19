# Yuxi 仓库分析与部署评估

对照本机浅克隆：上游 [xerrors/Yuxi](https://github.com/xerrors/Yuxi) 的 `main` 分支，提交 [`47e4e5a`](https://github.com/xerrors/Yuxi/commit/47e4e5a6d905584b3ed47c993c8a7aeb47c15f39)（2026-11-18 17:30，Asia/Shanghai）。`backend/pyproject.toml` 版本为 `0.8.0`。源码在 `/workspace/Yuxi`，不进入本分析仓库。本文只根据仓库文档与编排文件说明部署方式，尚未实际启动。

## 项目是什么

Yuxi（语析）自称「Cloud Agents + Knowledge RAG」，是可私有部署的多租户知识智能体平台。它把知识库检索、知识图谱、LangGraph 多智能体编排、MCP/Skills、沙盒工具和权限管理放在同一个工作区。和 WeKnora、TrustGraph 同属知识库一类，但默认就把向量库（Milvus）和图谱库（Neo4j）放进标准 Compose，而不是作为可选 profile。

官方文档的快速开始固定使用发布标签 `v0.8.0`：`git clone --branch v0.8.0 --depth 1 https://github.com/xerrors/Yuxi.git`。0.8 只面向全新部署，旧数据库、索引和文件布局不提供自动升级，要用独立数据目录。本机当前检出的是 `main` 上比该说明更新的一次提交，包版本仍写 `0.8.0`；若按官方教程复现，应改用 `v0.8.0` 标签或另开数据目录，不要拿旧库直接升级。

## 官方部署路径

官方只用 Docker Compose，仓库里没有 Helm 目录。分成两套编排：

| 形态 | 入口 | 适用场景 |
| --- | --- | --- |
| 开发 Compose | 根目录 `docker-compose.yml` | 本地试用；Web 默认 `http://localhost:5173`，API 默认 `5050` |
| 生产 Compose | `docker-compose.prod.yml` + `.env.prod` | 正式部署；Web 默认宿主机 80 端口，API 与存储维护端口只绑 `127.0.0.1` |
| 关闭知识库叠加 | `docker-compose.no-knowledge.yml` | 与上面任一编排叠加，停掉 Milvus、etcd、Neo4j，并设 `YUXI_KNOWLEDGE_ENABLED=false` |
| Abridge 叠加 | `docker-compose.abridge.yml` | 额外接入 `ghcr.io/xerrors/abridge`，不是核心启动路径 |

生产文档要求 Docker Engine 28.0 或更高、Compose v2.33.1 或更高，并有访问镜像和模型服务的网络。使用本地 GPU OCR 时才需要 NVIDIA Container Toolkit。生产 Web 容器只监听 HTTP 80，公网部署必须自行在前面加 TLS 反向代理。

没有单独的 Kubernetes 安装文档。智能体沙盒有两种，和编排相互配合：

| 沙盒 | 适用 | 要求 |
| --- | --- | --- |
| Container（默认） | 本地试用、单租户可信代码 | 只要 Docker；与宿主共享内核；需同时设置 `SANDBOX_BACKEND=container` 和 `--profile container` |
| Cube | 需要 VM 隔离和持久用户环境 | 另备 Linux/KVM 执行节点（`/dev/kvm`），启动命令不加 `container` profile |

本机研究环境没有为 Cube 准备 KVM 节点，后续若启动应走默认的 Container 沙盒。

## 开发环境怎么启动

依赖 Git、Docker Engine 和 Compose v2，以及一个可用的大模型 API。官方步骤是：

```bash
# 文档推荐：git clone --branch v0.8.0 --depth 1 https://github.com/xerrors/Yuxi.git
cd Yuxi
./scripts/init.sh
docker compose --profile container config --quiet
docker compose --profile container up --build -d
```

Windows 用 `.\scripts\init.ps1`。初始化脚本会提示填写 `SILICONFLOW_API_KEY`，生成应用安全密钥、runner 认证密钥和实例标识，并准备基础镜像。文档写明：即使生产打算用其他供应商，初始化也无条件要求这个变量，其他供应商可在登录后于「智能体 → 模型供应商」接入。已有 `.env` 时保留原密钥，不要用模板覆盖。也可以先 `cp .env.template .env` 再手动编辑（权限 600）。

`make up` 等价于 `docker compose --profile container up -d`，但要求 `.env` 已经存在，不会替你初始化。停止用 `docker compose --profile container down` 或 `make down`。默认数据目录是 `./docker/volumes`，同一目录只允许一套运行中的环境写入。`make reset` 会删掉这个默认目录；若设置了外部 `YUXI_STATE_DIR`，脚本会拒绝删除。

验证：

```bash
docker compose --profile container ps
curl --fail http://localhost:5050/api/system/ready
```

`/api/system/health` 只表示 API 进程存活；`/api/system/ready` 表示启动完成、PostgreSQL/Redis 可用，并且有健康的 worker 租约。`status` 为 `ready` 后，打开 http://localhost:5173 ，初始化超级管理员并登录。API 文档在 http://localhost:5050/docs 。就绪接口不能证明知识库、模型或沙盒业务链路已经跑通。

生产启动要显式加 `--env-file .env.prod -f docker-compose.prod.yml`，先构建 `api`、`frontend`、`minio`、`storage-init`，再 `up -d --no-build`。Web 默认 `http://<host>/`，API 默认发布到 `127.0.0.1:6050`。必填项包括数据库和对象存储口令、彼此不同的 `JWT_SECRET_KEY` 与 `API_KEY_DERIVATION_SECRET`（各至少 32 字符），以及 Container 的镜像 digest 和 runner 令牌。本文不记录任何密钥明文。

需要自托管 MinerU（文档解析 / OCR）时，再加 `--profile all`。

## 默认会启动哪些服务

开发 Compose 在不叠加关闭配置时，知识库是默认开启的。完整知识库路径必须启动 Milvus、etcd 和 Neo4j。应用镜像名称形如 `yuxi-api:0.8.0`、`yuxi-frontend:0.8.0`，由仓库里的 `docker/*.Dockerfile` **在本机构建**，编排文件里没有现成的 Docker Hub 应用镜像可直接 `pull`。中间件则使用官方或固定版本镜像。

不带 `container` / `all` profile 时，仍会启动下面这些服务（开发编排端口）：

| 服务 | 镜像 | 端口（宿主:容器） | 说明 |
| --- | --- | --- | --- |
| `frontend` | 本机构建 `yuxi-frontend:${YUXI_VERSION:-0.8.0}` | `${YUXI_FRONTEND_PORT:-5173}:5173` | Web 界面 |
| `api` | 本机构建 `yuxi-api:${YUXI_VERSION:-0.8.0}` | `${YUXI_API_PORT:-5050}:5050` | 后端 API |
| `worker` | 同上 api 镜像 | 不发布 | 后台任务消费者 |
| `app-init` | 同上 api 镜像 | 无常驻端口 | 等 Postgres 与 `storage-init` 成功后初始化 Schema 和内置内容，然后退出 |
| `postgres` | `postgres:16` | `127.0.0.1:${YUXI_POSTGRES_PORT:-5432}:5432` | 业务库；Compose 配置了 `shm_size: 1g` |
| `redis` | `redis:7.4.10-alpine` | `127.0.0.1:${YUXI_REDIS_PORT:-6379}:6379` | 队列与心跳 |
| `minio` | 本机构建，基于 `RELEASE.2024-12-18T13-15-44Z` | `127.0.0.1:9000` / `9001` | 对象存储 |
| `storage-init` | 本机构建 | 无 | 给状态目录设权限后退出 |
| `milvus` | `milvusdb/milvus:v3.0.2` | `127.0.0.1:19530` / `9091` | 向量库 |
| `etcd` | `quay.io/coreos/etcd:v3.5.25` | 不发布到宿主 | Milvus 依赖 |
| `graph` | `neo4j:5.26.29` | `127.0.0.1:7474` / `7687` | 知识图谱；官方说明从 Milvus 中的文档块抽取实体和关系后写入 Neo4j |

加上 `--profile container` 后，还会构建并启动：

| 服务 | 说明 |
| --- | --- |
| `sandbox-image` | 构建 `yuxi-sandbox:${YUXI_VERSION:-0.8.0}`，供执行段使用 |
| `sandbox-runner` | 容器内网 8090，仅 API/worker 访问；默认禁止沙盒联网 |

`--profile all` 再增加本机构建的 `mineru-api`（默认 `127.0.0.1:30001`）。

与 WeKnora 的一个明显差别：Yuxi 默认就把 Neo4j 和 Milvus 放进核心拓扑；若暂时不要知识库，用 `docker-compose.no-knowledge.yml` 把这三个存储的副本数设为 0，并关闭相关路由（返回 404）。数据目录仍保留，以后可以再开回来。这个开关不是热切换，改完要重建 API 和 worker。

## 本机对照

本机是 Debian 13，8 核、15 GiB 内存。Docker Engine 29.9.3、Compose v5.7.1 已安装，满足生产文档的版本下限。官方部署文档没有给出单一的内存下限；但默认拓扑同时包含 PostgreSQL、Redis、MinIO、Milvus、etcd 和 Neo4j，再加上本机构建的 api/frontend/worker，内存和首次 `--build` 时间都会比「只跑五个核心容器」的项目更紧。本机没有 GPU，若做文档解析，更适合走云端 OCR，而不是本地 MinerU GPU。本机也没有准备 Cube 所需的 `/dev/kvm` 节点。

开发端口 5173、5050、5432、6379、9000、7474、7687、19530 需保持空闲。生产编排会改用另一组回环端口（例如 API `6050`、Postgres `6432`），避免和开发环境抢端口。

当前状态：已完成浅克隆与部署方式对照；尚未运行 `./scripts/init.sh`，尚未生成 `.env`，尚未 `compose up`。完整运行还需要模型 API（初始化至少要有 SiliconFlow 的密钥占位，其他供应商可后配）。
