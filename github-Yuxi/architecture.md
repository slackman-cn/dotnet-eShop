# Yuxi 系统架构文档

本文是对本地源码树中 Yuxi（语析）的系统架构说明，依据仓库根目录 `ARCHITECTURE.md`、`docker-compose.yml` 及其叠加文件、`backend/yuxi` 与 `frontend/src` 的包结构和官方文档目录 `docs/` 整理。分析对象是本机浅克隆的默认分支 `main`，提交 `47e4e5a6d905584b3ed47c993c8a7aeb47c15f39`（说明为「fix: 优化会话工具时间线和 Shell 结果展示」，提交时间 2026-11-18 17:30:36 +0800，Asia/Shanghai）。`backend/pyproject.toml` 与 `frontend/package.json` 的版本字段仍写作 `0.8.0`。官方快速开始文档 `docs/intro/quick-start.md` 与根目录 `README.md` 要求克隆发布标签 `v0.8.0`，并且声明 0.8 只面向全新部署、不为旧数据库与文件布局提供自动升级。本树是比该教程说明更新的 `main` 提交，不能把它当作已打标签的 `v0.8.0` 发行包来复述。空库 Schema 基线以本树 `backend/yuxi/infrastructure/postgres/schema.py` 为准：`BUSINESS_SCHEMA_VERSION = 4`，`KNOWLEDGE_SCHEMA_VERSION = 2`。发布说明 `docs/develop-guides/releases/0.8.0.md` 里出现过 “business 2 / knowledge 2” 的表述，那是相对 `v0.7.3` 的发行说明文本；与当前 `main` 源码中的常量并不相同，下文以源码常量为准。

本文只讨论相对稳定的系统边界、进程拓扑、模块职责、数据归属、运行链路和二次开发落点，不代替部署操作手册，也不枚举每一项产品功能。部署步骤见同目录已有的短笔记，此处不再重复命令清单。分析过程未启动 Compose，未生成 `.env`，也未改写运行中的系统。

## 1. 产品定位与不可再瘦的核心闭环

Yuxi 在根目录 `README.md` 中把自己概括为「Cloud Agents + Knowledge RAG」：一套可私有部署的多租户知识智能体平台。它把知识库检索、知识图谱、基于 LangGraph 的智能体编排、MCP 与 Skills、沙盒工具，以及用户与部门权限，放进同一个工作区。官方介绍页 `docs/intro/project-overview.md` 进一步把产品对象说成需要自己掌握数据、模型和团队权限的组织，而不是一个不带权限、也不带文件操作的单文档聊天页。若只做后者，Yuxi 的能力会显得偏多；这并不是功能堆砌的结果，而是因为它把「提问—执行—交付文件—引用知识—在团队范围内授权」当成一条必须闭合的链路。

这条闭环可以收成四个始终同时出现的结构性部分。

第一是智能体运行时。用户或外部系统提交的输入并不直接调用模型，而是先作为持久 `Input` 进入线程队列，由调度器原子地生成正式消息、`Turn` 与 `Run`，再经 Redis/ARQ 交给独立 worker，在 LangGraph 图中完成工具循环，最终把终态写回 PostgreSQL。过程事件走 Redis Stream，前端用 SSE 订阅，断线后从 PostgreSQL 快照恢复。没有这套接收—调度—执行—收敛的骨架，会话、审批、协作和定时任务都无处挂靠。

第二是知识检索。默认交付完整知识能力。`YUXI_KNOWLEDGE_ENABLED` 的缺省值在 `.env.template` 和 Compose 环境中都是 `true`。Milvus、etcd 与 Neo4j 出现在开发与生产 Compose 的默认服务列表里，不靠额外 profile 才能起来。智能体通过内置 `knowledge` MCP 与 `knowledge-base` 插件按需取用知识库工具，而不是把检索逻辑写死在某个页面里。知识库可以被部署开关整段关掉，但那是显式的叠加编排，不是产品默认形态。

第三是多租户与权限。账号角色分为 `superadmin`、`admin` 和 `user`，资源共享使用 `read_scope` / `manage_scope`，访问级别为 `global`、`department` 或 `user`。前端路由守卫只负责体验，最终授权在 FastAPI 依赖和仓储可见性查询中完成。没有这一层，私有部署的「多用户工作区」就不能成立。

第四是沙盒与工作区。每个 Project 绑定一个持久 `workdir_path`。智能体的文件工具、在线预览、附件准备和交付物展示，都落到同一套由 `modules/workspace` 拥有的宿主路径边界上。执行本身可以选择 Container 或 Cube，但「文件必须有一个被授权的持久工作目录」不是可选项。

这四部分互相咬合：智能体运行时调用知识工具和沙盒工具；知识入库和图谱构建走后台作业而不是阻塞在 API 进程里；权限在构图和每次工具出站时被再次核对；Workdir 既是执行环境也是用户可见的文件空间。二次开发通常是在这条闭环上替换模型供应商、增加工具、增加解析器或增加路由，而不是再并列一套独立产品。

需要诚实写出的是：默认开启并不等于「每一个附属能力都同样不可关闭」。源码里确实存在少数真实开关。`docker-compose.no-knowledge.yml` 把 `milvus`、`etcd`、`graph` 的副本数设为 0，并把 `api`、`worker`、`app-init` 的 `YUXI_KNOWLEDGE_ENABLED` 设为 `false`。`--profile container` 才构建沙盒镜像并启动 `sandbox-runner`；Cube 则要求单独的 Linux/KVM 执行节点，启动命令不加该 profile。`--profile all` 才启动自托管 `mineru-api`。`docker-compose.abridge.yml` 额外接入 `ghcr.io/xerrors/abridge`。企业 OIDC、Yuxi 自身作为 OIDC 签发端、Langfuse、网络搜索凭据，都是配置后才生效的能力。图谱存储随默认拓扑启动，但图谱构建不会在文档解析后自动触发，必须由管理员提交构建任务。这些开关改变的是部署面和某条支路是否装配，并不把核心闭环拆成可以任意删减的模块超市。后文会在相应章节用文件路径说明每个开关实际切除或增加了什么。

## 2. 版本故事与语言运行时

本树后端包名是 `yuxi`，声明 `requires-python = ">=3.12,<3.14"`，仓库内 `backend/.python-version` 固定为 `3.13`。API 镜像由 `docker/api.Dockerfile` 构建，开发与生产 Compose 中的 `api`、`worker`、`app-init` 以及 Container 模式下的 `sandbox-runner` 共用同一镜像标签 `${COMPOSE_PROJECT_NAME:-yuxi}-api:${YUXI_VERSION:-0.8.0}`。API 进程入口是 `yuxi.api.main:app`，用 uvicorn 监听容器内 `5050` 端口；worker 入口是 `python -m yuxi.workers.main`；一次性初始化入口是 `python -m yuxi.bootstrap.app`。包管理使用 `uv`，锁文件在 `backend/uv.lock`。核心运行时依赖在 `backend/pyproject.toml` 中写明，其中包括 FastAPI、ARQ、LangGraph 与 `langgraph-checkpoint-postgres`、LangChain 及相关 MCP 适配、SQLAlchemy 异步栈与 asyncpg、Redis、MinIO 客户端、`pymilvus==3.0.2`、Neo4j 驱动、`cubesandbox==0.7.3`、docling-slim、RapidOCR 与 ONNX Runtime 等。这些依赖对应的是「HTTP API + 图编排 + 多存储 + 文档解析」这条主链，而不是可有可无的插件清单。

前端包名 `yuxi-frontend`，版本同样是 `0.8.0`。技术栈为 Vue 3、Vite、Pinia、Vue Router 和 Ant Design Vue，开发镜像由 `docker/frontend.Dockerfile` 的 `development` 目标构建，容器内执行 `pnpm run server`，默认把宿主机 `${YUXI_FRONTEND_PORT:-5173}` 映射到容器 `5173`。生产编排改用同一 Dockerfile 的生产目标，并由 nginx 在容器 80 端口提供静态资源与反向代理，宿主机默认发布 80 端口；API 在生产中默认只绑定 `127.0.0.1:6050`。前端源码按 `app`、`pages`、`modules`、`apis`、`shared` 分层，与后端业务域大致对齐，但不实现授权。

命令行工具位于 `packages/yuxi-cli`，是独立的 Node.js 客户端，不随 API 镜像发布。`docs/develop-guides/releases/0.8.0.md` 写明 CLI 需要 Node.js 22 以上，旧 Python CLI 配置不会自动导入，并且仓库源码不代表 npm 包已经发布。`packages/agent-demo` 是面向公开 Agent API 的演示包。二者都是接入面，不是运行时内核。

版本上必须分清三件事情。第一，官方教程钉的是 git 标签 `v0.8.0`，用于可复现的全新部署。第二，本分析树是 `main` 上的 `47e4e5a`，包版本字符串尚未抬升，但业务 Schema 已经是 4，并且提交说明涉及会话工具时间线与 Shell 结果展示，说明发行标签之后仍有行为修正。第三，0.8 明确拒绝从 0.7.x 原地升级；`app-init` 只在空库上初始化当前基线，API 与 worker 在域版本缺失、过旧或过新时拒绝启动，历史结构调整要由部署侧显式完成。知识域从 v1 到 v2 的路径目录转换是离线审计入口，运行进程不会自动迁移。把本树直接接到一份旧数据目录上，并不在官方支持范围内。

许可证方面，Yuxi 本体是 MIT，见根目录 `LICENSE`。Compose 引入的 PostgreSQL、Redis、MinIO、Milvus、etcd、Neo4j 以及可选的 MinerU、aBridge 镜像遵循各自上游许可。生产文档要求在再分发和商业部署前按实际镜像版本核对义务。这不影响架构判断，但说明「私有部署」并不是「只有一个 MIT 包」。

## 3. 进程与服务拓扑

开发与运行拓扑的事实来源是仓库根目录的 `docker-compose.yml`。生产对应 `docker-compose.prod.yml`，默认环境文件分别是 `.env` 与 `.env.prod`。两套编排的服务集合基本一致，差异主要在端口绑定、是否挂载源码、前端构建目标、凭据是否允许开发缺省值，以及数据目录约定。官方路径只有 Docker Compose，仓库中没有 Helm 图表，也没有单独的 Kubernetes 安装文档。

在不叠加关闭配置、也不附加可选 profile 时，开发编排仍会启动以下常驻或一次性服务。

`storage-init` 是无网络的一次性进程，镜像由 `docker/storage-init.Dockerfile` 构建。它以 root 运行，为 API、worker、`app-init` 以及 Milvus 使用的挂载根准备属主和模式，不递归修改已有文件，成功退出后其他消费进程才继续。它挂载用户数据目录、Skill 源与投影目录，以及 Milvus 的数据与日志目录。没有这一步，后续进程会在权限不正确的数据根上启动。

`postgres` 使用 `postgres:16`，开发环境把 `127.0.0.1:${YUXI_POSTGRES_PORT:-5432}` 映射到容器 5432，并设置 `shm_size: 1g`，启动参数包含 `max_connections=${POSTGRES_MAX_CONNECTIONS:-600}`。它保存业务数据、知识库元数据、持久输入队列、Turn/Run、LangGraph checkpoint，以及系统配置和模型供应商等。健康检查使用 `pg_isready`。

`redis` 使用 `redis:7.4.10-alpine`，开启 AOF（`redis-server --appendonly yes`），开发端口默认 `127.0.0.1:6379`。它承担 ARQ 投递、运行事件流、取消信号，以及跨进程的配置和模型缓存。它不是 AgentRun 终态的唯一来源。

`minio` 由 `docker/minio` 在上游 `RELEASE.2024-12-18T13-15-44Z` 基础上本机构建。开发环境发布 `127.0.0.1:9000` 与控制台 `9001`。对象数据与配置分别落在状态目录下的 `milvus/minio` 与 `milvus/minio_config`。MinIO 保存知识库原始文件、解析产物和临时上传对象；正式的 Agent 附件字节归 Workdir，附件事实归 PostgreSQL。

`etcd` 使用 `quay.io/coreos/etcd:v3.5.25`，客户端 URL 在内部网络 `etcd:2379`，不发布到宿主机。它是 Milvus 的元数据协调依赖，而不是业务可直接调用的服务。

`milvus` 使用 `milvusdb/milvus:v3.0.2`，以 standalone 方式运行，开发端口 `127.0.0.1:19530` 与健康端口 `9091`。它依赖 `storage-init` 成功、`etcd` 与 `minio` 健康。向量索引默认数据库名由 `MILVUS_DB` 给出，缺省为 `yuxi`；知识库与图向量使用同一数据库，API 与 worker 重建后生效。Compose 注释说明内存随数据量线性增长，故意不设硬上限，避免合法增长时陷入 OOM 重启循环；CPU 可用 `YUXI_MILVUS_CPUS` 约束。

`graph` 使用 `neo4j:5.26.29`，开发环境发布 `127.0.0.1:7474`（HTTP）与 `7687`（Bolt）。它保存从已索引文档块抽取的实体和关系。默认拓扑包含该服务，并不表示每个知识库都会自动建成图谱。

`app-init` 复用 API 镜像，在 PostgreSQL 健康且 `storage-init` 成功后运行 `python -m yuxi.bootstrap.app`，然后退出。它在 PostgreSQL advisory lock 内先建立或校验当前 Schema，再同步系统配置定义、内置供应商、Agent 预设、MCP 与 Skill 来源文件。API 与 worker 必须等待它全部成功。共享同步失败时保留已提交内容，修正后可以幂等重跑；任一步骤失败都会阻止 API 和 worker 启动。

`api` 以用户 `1000:1000` 运行 uvicorn，开发环境挂载 `backend/yuxi`、测试与脚本目录，并把状态目录中的 `yuxi/threads`、`skill-sources`、`skill-projections` 分别挂到 `/app/user-data`、`/app/skill-sources`、`/app/skill-projections`。它依赖 Postgres、Redis、MinIO 健康以及 `storage-init`、`app-init` 成功。开发端口默认 `${YUXI_API_PORT:-5050}:5050`。它负责 HTTP 协议、认证上下文、响应装配，以及把已校验的用例交给各业务域服务。知识库 MCP 也挂在同一进程的 `/api/mcp`。

`worker` 使用同一镜像和同一组数据挂载，入口改为 ARQ worker。它执行已经派发的 AgentRun、注册的后台作业，并周期触发用户自建的定时 Agent。这三类工作分别使用 PostgreSQL 中的运行租约、任务租约和调度锁来闭合并发与恢复。worker 不对外发布端口。

`frontend` 在开发中挂载前端源码并热更新，依赖 `api` 启动，默认入口 `http://localhost:5173`。它对后端源码修改不敏感；API 与 worker 的源码修改需要显式重启容器后才生效，这是 `ARCHITECTURE.md` 写明的开发不变量。

加上 `--profile container` 之后，还会出现两个与沙盒相关的服务。`sandbox-image` 使用 `docker/sandbox.Dockerfile` 构建 `yuxi-sandbox:${YUXI_VERSION:-0.8.0}`（可用 `SANDBOX_CONTAINER_IMAGE` 覆盖），命令为 `true`，作用是把镜像构建并留在本地，供执行段使用。`sandbox-runner` 仍用 API 镜像，但以 root 运行，执行 `uvicorn yuxi.sandbox_runner.main:app --host 0.0.0.0 --port 8090`，并挂载 Docker socket。它在容器内网 8090 端口上为 API 和 worker 提供认证 HTTP，不把该端口发布给浏览器。挂载、镜像和资源限制由 runner 拥有；Run 归属与清理责任仍由 PostgreSQL 拥有。默认 `SANDBOX_CONTAINER_NETWORK=none`，禁止沙盒联网。Makefile 里的 `COMPOSE` 默认已带 `--profile container`，因此本地 `make up` 走的是这条路径。

`--profile all` 再增加 `mineru-api`，镜像由 `docker/mineru.Dockerfile` 构建，标签为 `${COMPOSE_PROJECT_NAME:-yuxi}-mineru:4.1.3`，命令为 `mineru-kit api-server --host 0.0.0.0 --port 30001 --tier advanced`。开发与生产都把端口绑在 `127.0.0.1:${YUXI_MINERU_PORT:-30001}`。生产编排还为该服务声明了 NVIDIA GPU 设备预留。它不是文档解析的唯一引擎：RapidOCR 随 API/worker 安装；MinerU 官方云、DeepSeek OCR 以及三套 PaddleOCR 云服务适配器走外部 HTTP，不依赖这个 profile。

Cube 不表现为 Compose 里的一个常驻服务，而是由 `SANDBOX_BACKEND=cube` 加上 `CUBE_API_URL` 等变量指向外部 Linux/KVM 执行节点。相关镜像与脚本在 `docker/cube/`。每个用户拥有一个持久普通账号虚拟机，Workspace 与授权 Skills 共享宿主文件。需要 VM 隔离或持久用户环境时才走这条路径；本分析不假设研究环境已具备 `/dev/kvm`。

`docker-compose.no-knowledge.yml` 是叠加文件，不是独立的完整编排。它只做四件事：给 `api`、`worker`、`app-init` 写入 `YUXI_KNOWLEDGE_ENABLED=false`，并把 `milvus`、`etcd`、`graph` 的 `scale` 设为 0。数据目录仍然保留，以后可以再开回来。官方说明这不是热切换，改完后需要重建 API 和 worker。关闭之后，启动装配不再挂载知识库、图谱、评估及知识视图入口，discovery 宣告知识能力关闭，worker 暂停知识作业派发和投影清理，但保留持久数据和待执行意图；内置 Skill 文件还在，知识工具不进入可用目录，普通聊天保持可用。

`docker-compose.abridge.yml` 是另一条叠加路径。它要求先运行 `scripts/init_abridge.py` 生成专用 OIDC 与管理凭据，再为 `api` 和 `worker` 注入 Yuxi 作为身份签发端的配置，并启动外部镜像 `ghcr.io/xerrors/abridge:0.4.13`（带固定 digest）。aBridge 通过 OIDC 接收 Yuxi 身份，设备能力由 `abridge` 插件在智能体中按需加载。这不是核心启动路径。

服务之间的调用关系可以概括如下。浏览器只接触前端以及前端同源或显式配置的 API。API 读写 PostgreSQL、Redis、MinIO，按需访问 Milvus 与 Neo4j，并向 `sandbox-runner` 或 Cube API 发出执行请求；它不持有 Docker socket。worker 使用同一组存储连接，是唯一领取 AgentRun 租约和后台作业租约的执行者。知识库 MCP 与 HTTP API 共用 API 进程。MinerU 自托管实例只在解析器被选中且相应 URI 可达时被文档处理引擎调用。etcd 只被 Milvus 使用。所有应用容器连接在 Compose 网络 `app-network` 上。默认数据根是 `./docker/volumes`，也可用 `YUXI_STATE_DIR` 指到外部目录；同一目录只允许一套运行中的环境写入。

生产编排的拓扑与开发相同，但默认把 API、Postgres、Redis、MinIO、Milvus、Neo4j、MinerU 等维护端口绑到回环地址，避免和开发环境抢端口，例如 API 缺省 `6050`、Postgres 缺省 `6432`、Redis 缺省 `7379`。生产不允许使用开发缺省口令：`POSTGRES_PASSWORD` 必须显式给出，`JWT_SECRET_KEY` 与 `API_KEY_DERIVATION_SECRET` 必须各自至少 32 个字符且彼此不同。Container 模式在生产中还要求镜像 digest 与 runner 令牌。Web 容器只监听 HTTP 80，公网部署必须由部署方自行在前面加 TLS 反向代理。这些是部署边界，不是另外一套架构。

就绪探针的语义被写进 `ARCHITECTURE.md` 和不变量列表。`GET /api/system/health` 只表示 API 进程存活。`GET /api/system/ready` 表示启动完成、PostgreSQL 与 Redis 可用，并且存在完成启动的兼容 worker 租约。它不能证明知识库、模型或沙盒业务链路已经跑通。worker 需要同时续租短 TTL 的 ARQ 消费健康、AgentRun 租约对账以及后台作业对账；持久键、超长 TTL、错误的 Redis 地址或持续无法收敛失联执行，都不能维持就绪。

## 4. 后端包结构与依赖方向

后端只有一个 Python 包 `backend/yuxi`。项目元数据由 `backend/pyproject.toml` 拥有。目录职责在 `ARCHITECTURE.md` 中写得很硬，二次开发时「改动应该落在哪里」首先遵循这些边界。

`yuxi/api` 是进程适配层。`api/main.py` 创建 FastAPI 应用并把路由挂在前缀 `/api` 下。`api/routers` 按域注册 HTTP 路由，`api/lifespan.py` 连接生命周期，`api/dependencies` 提供认证与作用域，`api/middleware` 与 `api/responses` 处理协议级行为。`api/uploads.py` 把 `UploadFile` 转成小文件字节或借用的二进制流；业务服务消费中立输入，不保存上传对象，输入流由 HTTP 请求拥有，必须在请求结束前消费完毕。HTTP 路由保持薄，只处理协议、认证上下文和响应装配，不承载用例流程。

`yuxi/workers` 是另一套进程适配层。`workers/main.py` 暴露 ARQ 的 `WorkerSettings`；`workers` 拥有任务入口和健康上报，真正的连接装配、恢复循环和关闭顺序在 `bootstrap/worker.py`。worker 不得变成第二个「什么都写」的应用核。

`yuxi/bootstrap` 负责启动资源装配。`bootstrap/api.py` 装配 API 的必需与可选组件；`bootstrap/app.py` 是 `app-init` 入口，调用 `migrations/main.py` 做空库初始化与各域共享内容同步；`bootstrap/capabilities.py` 与 `bootstrap/options.py`、`bootstrap/environment.py` 处理能力发现和进程环境。`YUXI_KNOWLEDGE_ENABLED` 由启动装配读取，显式关闭时集中停掉相关入口，而不是在每个路由里散落判断。

`yuxi/migrations` 独占 Schema 修改。`migrations/schema.py` 拥有 DDL，`infrastructure/postgres/schema.py` 向 API 和 worker 提供只读版本检查。运行中的 API 与 worker 不建表，也不在启动时同步发布内置定义。当前版本在非空库上跳过结构初始化，其他版本明确拒绝。附加脚本如 `migrations/mcp_personal_credentials.py`、`migrations/agent_plugins.py`、`migrations/knowledge_directories.py` 属于显式离线迁移，不是自动升级器。

`yuxi/infrastructure` 提供技术连接与解析引擎，不拥有业务状态。`infrastructure/postgres` 管理业务 session 与 LangGraph checkpoint 连接池，`infrastructure/postgres/models.py` 显式注册分域 ORM，维持 business 与 knowledge 两套 metadata。`infrastructure/redis` 提供连接，业务键与事件语义留在对应模块。`infrastructure/minio`、`infrastructure/neo4j`、`infrastructure/oidc` 封装远端客户端。`infrastructure/observability` 封装日志与 Langfuse SDK。`infrastructure/document_parsing` 只生成完整的本地 Markdown 目录，`engines/` 集中 OCR 契约、注册与实现。`infrastructure/crypto.py` 读取部署级 Fernet 凭据密钥，业务域拥有加密载荷。`infrastructure/runtime_settings.py` 管理进程环境、公开站点来源与运行目录。`infrastructure/file_preview.py` 与 `infrastructure/office_conversion.py` 准备预览和 Office 到 PDF 的转换，缓存分别由 Workspace 与 Knowledge 拥有。

`yuxi/modules` 按业务域组织用例与持久化，是二次开发最常改动的层。域与域之间通过服务接口和共享契约协作，而不是互相深入对方的 repository。主要域如下。

`modules/agents` 拥有输入接收、优先队列调度、Turn/Run、消息、事件、运行租约与 LangGraph runtime。`services/run_lifecycle.py` 拥有终态的 Thread→Turn→Input→Run 锁序、steer 裁决、投影及提交后清理。`runtime/agent_backends` 拥有执行图实现与显式注册，目前注册表里只有 `ChatbotAgent`。`runtime/sandbox` 拥有沙盒执行与生命周期抽象，Container 与 Cube 是后端实现。`runtime/middlewares` 拥有模型与工具策略。Context 装配留在 runtime，知识库可见范围解析由 knowledge service 拥有。

`modules/knowledge` 拥有知识库、分块、检索、图谱与评估的业务状态。上传、URL 导入和工作区原件的哈希及 MinIO 暂存在 `services/uploads.py`；库元数据生命周期在 `services/bases.py`；可见性在 `access.py`；本地文件读取与目录用例分别在 `documents.py` 与 `directories.py`。manager 只负责执行器配置与装配、解析、索引、检索、外部阅读和外部资源清理。删除与清理 outbox 由 `services/administration.py` 编排。图谱提交准入与作业登记在 `services/graph_build.py`，真正的抽取与投影由图谱执行器在 worker 中完成。`modules/documents` 解析配置与 MinIO 输入，并按调用方指定的位置发布资源。

`modules/workspace` 拥有 UserWorkspace 的路径映射、no-follow 文件操作、Workdir 和预览。Agent 沙盒与 Viewer 共用的 runtime 虚拟路径由 `runtime_paths.py` 拥有。宿主 `Path` 只能由这个模块持有，普通 Service 或 Repository 不得取得真实宿主路径。

`modules/identity` 拥有用户、部门、权限、凭据与 OIDC 账号用例，以及 Public API 的 Key 校验与 App/end_user 身份解析。`modules/extensions` 拥有 Skills、部署插件、MCP 与工具目录，以及网络搜索、aBridge 适配。`modules/models` 拥有模型适配和供应商配置。`modules/schedules` 拥有用户定时 Agent 定义和 occurrence。`modules/background_jobs` 拥有任务登记、观察记录和取消意图，dispatch 与 registry 在提交侧，领取和失联维护在 worker。`modules/system` 拥有系统配置、Dashboard 与跨域共享资源所有权治理。

`yuxi/shared` 只保存不依赖业务域与 HTTP 的小型公共契约，例如 `shared/errors.py` 的失败类型、`shared/files.py` 的文件输入与 MIME 识别。领域失败由 API 的错误适配层转换成 HTTP 状态；内部服务优先依赖已有类型、事务和仓储约束，避免用静默回退掩盖设计错误。

`yuxi/sandbox_runner` 是 Container 后端的独立 HTTP 服务实现，只在 `sandbox-runner` 进程中启动，不进入 API 或 worker 的默认装配。

依赖方向因此是单向的：路由依赖服务，服务依赖仓储与基础设施客户端，基础设施不反向依赖某个 HTTP 路由，业务域不直接持有宿主路径或 Docker socket。前端不能突破这层方向：组件不得自行拼接普通 HTTP 接口，调用集中在 `frontend/src/apis`。智能体能力通过 context、middleware、toolkits、Skills、插件、MCP 和 backends 组合，知识库、沙盒或扩展逻辑不应被硬编码进单个页面或路由。这是二次开发时最重要的方向约束。

## 5. 数据模型与存储归属

持久状态按「谁拥有事实」划分，而不是按「哪一种数据库比较方便」。下面按对象域说明表与存储位置，表名来自各模块的 ORM 定义。

### 5.1 身份与租户

`departments` 保存部门，字段包括名称与描述。`users` 保存账号：显示名 `username`、登录标识 `uid`、可选手机号、头像、密码哈希、角色、用户类别 `user_kind`（缺省 `human`）、可选的 `owner_user_id`、`app_id`、`end_user_id`、部门、登录失败计数与锁定期、软删除标记。角色注释明确为 `superadmin`、`admin`、`user`。Public API 可以为外部应用创建终端用户身份，这类用户通过 `app_id` 与 `end_user_id` 隔离会话，并不等于一个可登录的人类管理员。`user_config` 按 `uid` 保存用户级偏好，当前可见字段包括 `enable_memory`。`api_keys` 只保存密钥哈希、前缀、可选的请求幂等 ID 与意图指纹、名称、访问级别、关联用户与部门、过期与撤销时间；原始密钥在创建时返回，之后不再存储。`cli_auth_sessions` 支持设备码登录。`oidc_identities`、`oidc_sessions`、`oidc_logouts` 与 `revoked_access_tokens` 支持企业 OIDC 登录与登出。这些表全部在 PostgreSQL 的 business 域。

这里的「多租户」不是独立数据库或独立 Schema 按租户拆分，而是同一套库内以用户、部门、资源共享范围和 App/end_user 作用域来隔离可见性。部署实例标识是 `YUXI_INSTANCE_ID`，用于区分不同安装，而不是租户主键。

### 5.2 智能体、会话与运行

`agents` 与 `agent_envs` 保存智能体定义及其环境变量。预置角色由 `modules/agents/presets` 发现：`default-chatbot`（智能助手，预加载 `chat-widgets`，默认插件 `knowledge-base`）、`knowledge-base-qa`（知识库问答，同样启用该插件）、`deep-research`（深度研究，绑定 `deep-research` Skill 与专门的系统提示）。它们都使用同一个执行后端 `ChatbotAgent`，差异在 context 里的技能、插件和提示，而不是三套运行时。

会话与执行事实拆成多张表，这是本树最核心的数据设计。`sessions`（对外协议里常称为 Session，内部讨论也使用 Thread）保存长期对话，并持有不可变的 `project_id`。`agent_inputs` 保存持久接收的原始内容与优先队列项，`agent_input_receipts` 保存幂等接收事实。`agent_turns` 表示一轮工作。`agent_runs` 与 `agent_run_attempts` 保存执行段、输出和租约。`messages` 保存进入执行投影后的正式消息。`agent_attachments` 把附件事实绑到 Input 或消息。`session_cooperation_events` 与 `session_cooperation_runtimes` 支持会话协作树。`agent_feedback_records` 保存改进线索和用户反馈。`user_sandboxes` 与 `sandbox_commands` 记录用户级沙盒环境和命令。`projects` 在 workspace 域，保存 Project 与 `workdir_path` 的绑定。

这套模型把「用户提交了什么」「系统是否已经收到」「哪一轮在执行」「哪一次尝试持有租约」「最终对外可见的消息是什么」分成不同的事实，避免用单一 message 表同时表示草稿、队列和结果。接收事务保存 Input 原文和 Receipt；消费事务原子生成正式 Message、Turn 与首个 Run，并把附件归属挂到消息上；提交之后才向 ARQ 投递 pending Run。未消费的取消不生成消息。数据库唯一约束防止重复投影。

### 5.3 扩展、模型与系统

`skills` 与 `skill_versions` 保存受管理 Skill 的目录引用和历史版本。当前完整内容由 PostgreSQL 目录引用拥有，内容更新先准备不可变包再提交引用。个人 Skill 的字节在 UserWorkspace 的 `agents/skills` 下，不进这组表的文件列。`mcp_servers`、`mcp_connections`、`mcp_oauth_attempts` 保存远程 MCP 配置、个人连接和授权事务。`model_providers` 保存供应商与模型配置，PostgreSQL 是持久化 Owner，Redis 只提供可失效缓存。`config_options` 保存管理员系统配置，优先级为代码默认值小于环境变量，再小于数据库中保存的值。`scheduled_agent_jobs` 与 `scheduled_agent_runs` 保存定时定义和 occurrence。`background_jobs` 保存知识解析、评估和图谱构建等作业的持久意图与租约。

### 5.4 知识库、分块、图谱与评估

知识域使用独立的 ORM metadata。`knowledge_bases` 保存库元数据，包括类型 `kb_type`。内置执行器在 `modules/knowledge/factory.py` 显式注册四种类型：`MilvusKB`、`FeishuKB`、`DifyKB`、`NotionKB`。后三种是只读连接器，不在 Yuxi 中上传或同步源文档。`knowledge_files` 保存文件或目录项及其状态。文件状态契约在 `modules/knowledge/file_status.py`：`uploaded`、`parsing`、`parsed`、`error_parsing`、`indexing`、`indexed`、`error_indexing`、`deleted`；目录创建即就绪，状态固定为 `done`。读取筛选时，历史存量值 `done`/`failed` 会被展开映射，但不会改写已有记录。`knowledge_imports` 记录导入批次，`knowledge_projection_outbox` 以 `pending`/`applied` 登记清理或投影意图。`knowledge_chunks` 保存切分后的块及图谱抽取标记：结构写入后置 `graph_structure_indexed`，向量回填完成才置 `graph_indexed`。`knowledge_graph_entities`、`knowledge_graph_entity_mentions`、`knowledge_graph_triples`、`knowledge_graph_triple_mentions` 保存图谱投影在 PostgreSQL 侧的元数据与向量状态；图结构本身在 Neo4j，图与文本融合检索还使用 Milvus 中的图向量。评估使用 `evaluation_datasets`、`evaluation_dataset_items`、`evaluation_runs`、`evaluation_run_items`。

知识库原始文件和解析得到的 Markdown 目录、图片，落在 MinIO。向量和混合检索索引在 Milvus。图谱结构在 Neo4j。元数据、状态机和作业在 PostgreSQL。关闭知识能力时，这些数据不被删除，只是运行入口停止装配。

### 5.5 各存储的责任边界

PostgreSQL 是业务事实和 LangGraph checkpoint 的唯一 Owner，也是 Input 队列、Turn/Run 租约、后台作业租约和定时锁的 Owner。Redis 承担投递、短期公开事件、取消加速信号和跨进程缓存，不能作为运行终态的权威来源。MinIO 拥有知识库与临时上传对象。每个用户的 UserWorkspace 拥有 Workdir 与个人 Skill 字节，路径在状态目录 `yuxi/threads` 下。Milvus 拥有向量检索及其图向量。Neo4j 拥有知识图谱结构。Cube 或 Container 只是执行环境：Container 为每个 Run 懒创建临时容器，工作目录文件仍然持久留在宿主挂载上；Cube 的用户 VM 在无活动 Run 与命令时于空闲五分钟后休眠，重建保留 Workspace 与 Skills。用户可见路径、对象存储 URL 与宿主机真实路径不能混用，这是写在架构不变量里的文件边界。

文件边界只允许三种跨层路径：数据库中的 Project `workdir_path`，Viewer 当前 scope 相对路径（形如 `/foo`），以及 Agent 或 artifact runtime 的绝对虚拟路径（形如 `/home/user/workspace/...`）。沙盒虚拟路径由当前 Project Workdir、Workspace 与共享 Skills 根共同约束。个人 Skill 的沙盒标准入口 `~/.agents/skills` 链接到 UserWorkspace 的 `agents/skills`；共享与内置 Skill 才投影到只读的 `/home/user/skills`。Container 单独挂载个人目录。这些规则保证二次开发在新增文件工具时，不会把宿主路径泄露到提示词或 API 响应里。

## 6. 智能体运行时架构

一次普通输入的边界在 `ARCHITECTURE.md` 的「智能体运行链路」中按十步写出，这里按架构观点重述，并补上工具、沙盒和知识调用的衔接。

前端 `AgentView` 装配 `SessionWorkspace`，收集文本、图片、附件、模型与审批配置，经 `frontend/src/apis/agent_api.js` 调用 Public Session API。仓库层批量读取事实，由唯一的 Session 投影生成详情、列表、搜索和更新响应。协议入口在 `backend/yuxi/api/routers/public_v1/agents`，前缀为 `/api/v1/agents`。它把 JWT 或 API Key 身份转为完整 `ActorScope`，再把有序消息和配置交给 `modules/agents/services/inputs.py`。接入事务锁定 Thread，校验作用域与幂等回执，保存独立 Input 原文、提交级文件引用和 Receipt，并把附件绑到 Input；配置在接收时冻结，正文与原始文件 ID 永久保留。

调度器 `services/scheduler.py` 在线程锁下领取未暂停队列的就绪优先队头，原子创建 Turn、首个 pending Run 和正式 Message。follow-up 按 FIFO 单条领取；steer 优先，并在消费时合并连续就绪前缀，各 Input 保持独立。未就绪的队头不能被越过。`services/queue_control.py` 从待办派生暂停；用户主动提交的恢复消息会持久固定优先位置并单独消费。等待回答或审批时拒绝普通消息。消费事务提交后，才向 ARQ 投递 pending Run。恢复扫描可以补投尚未成功投递的同一个 Run，但不会自动重试已经失败的工作。

worker 中的 `modules/agents/services/runner.py` 使用进程身份与 job-attempt token 取得 Run lease；未取得所有权的重复任务不会执行。runner 核验输入、执行用户与 Workdir 授权，启动独立事务续租的心跳，由 `services/preparation.py` 准备 Context，在有效租约下提交 write-once 运行清单后才进入 LangGraph。Langfuse 使用 Turn 级 trace 与 Run 级 observation，远端观测不拥有业务终态。

所有 Session 通过同一 Agent 后端与中间件组合 Workdir、Skills、插件、MCP、审批、摘要及协作能力。执行后端注册表目前只有 `ChatbotAgent`，位于 `modules/agents/runtime/agent_backends/chatbot`。预置角色和新的自定义智能体都是在这一个后端上叠加 context，而不是并列多套图框架。要新增一种完全不同的编排，需要在 `AGENT_BACKENDS` 显式注册，而不是改路由。

中间件目录在 `modules/agents/runtime/middlewares`。文档 `docs/agents/middleware.md` 按「Graph 创建前的准备」和内置顺序说明它们的职责，源码文件与之对应：文件系统中间件基于 DeepAgents 的 `FilesystemMiddleware` 做 Yuxi 适配，提供 `read_file`、`write_file`、`edit_file`、`glob`、`grep`、`execute` 等沙盒文件与命令工具，并把 `open_kb_document` 列入工具结果驱逐豁免；`CooperationMiddleware` 提供 `create_session`；`YuxiMemoryMiddleware` 提供 `remember_memory`、`search_thread_messages`、`read_thread_messages`；`PluginLoaderMiddleware` 提供 `load_plugin`；此外还有授权、技能正文、模型输入、网络重试、steer、摘要压缩、Token 用量、工具错误守卫和工具媒体处理。授权中间件依据直接选择、基础工具和当前仍获授权的已激活插件过滤模型可见工具，并在实际执行前再次拒绝未授权调用。工具真实开始与进度来自 BaseTool 回调，最外层 `ToolErrorGuardMiddleware` 按最终 ToolMessage 发布结局。

工具分成两层。本地工具包括平台内置和插件专用工具，由 `modules/extensions/tools` 的 `@tool` 装饰器或 `register_tool` 登记。内置模块显式导入 `web_search`、`web_fetch`、`ask_user_question`、`mark_for_improvement`、`ocr_parse_file`、`present_artifacts`。其中 `ask_user_question` 与 `mark_for_improvement` 构成 `BASE_TOOL_NAMES`，所有正常 Agent 图自动注册，不受工具选择或插件激活限制。网络搜索与抓取只有在当前有效供应商和凭据存在时才进入本轮 ToolNode；缺少配置的能力本轮不绑定，不会默默换一家供应商重试。知识库工具不再本地注册，而由内置 `knowledge` MCP 提供：`list_kbs`、`query_kb`、`find_kb_document`、`open_kb_document`、`search_file`。Agent 启用 `knowledge-base` 插件并调用 `load_plugin` 后，下一轮模型请求才会开放这些工具。每次出站由 Knowledge 按当前用户签发最长五分钟的委托凭据，并在每次调用处复核权限交集。关闭 Knowledge 时保留内置服务器身份，发现和执行按不可用处理。

沙盒在运行时通过 `UserSandboxBackend` 抽象选择 `container` 或 `cube`。Container 路径下，API 和 worker 只调用 `SANDBOX_RUNNER_URL`（缺省 `http://sandbox-runner:8090`），用 `SANDBOX_RUNNER_TOKEN` 认证；runner 为每个 Run 懒创建临时容器，镜像、内存、CPU、PID、家目录与临时目录配额、最大容器数和最长生命周期由 `SANDBOX_CONTAINER_*` 变量约束。默认网络为 `none`。Project 外写入和命令执行在「请求审批」模式下会形成等待点；`docs/develop-guides/releases/0.8.0.md` 说明 0.8 之后新会话默认「完全信任」，已保存的审批选择继续生效。Cube 路径下，每个用户一个持久 VM，同一用户的所有协作树共用该 VM；空闲五分钟休眠，文件工具访问其他路径会唤醒。惰性创建与恢复不得绕过 uid、代次及 Run/attempt owner 校验。Run 终态必须确认所属命令清理。

协作成员拥有独立上下文和独立的 Thread/Input/Turn/Run，以父关系和树内名称关联，不继承父历史。全树共享 Project Workdir。执行名额由系统配置 `max_cooperation_concurrency` 限制，缺省为四个。普通取消只影响指定 Turn，用户明确停止才停止整树。父完成或失败保留后代的独立工作。

安全接管点在工具批次及 checkpoint 保存之后，或在无工具的模型调用完成之后。pending steer 被固定为消费批次，旧 Run yielded，同一 Turn 创建下一 Run；提交后确认旧 Run 的 runtime 清理再投递接续。人工等待使 Run 进入 interrupted、Turn 进入 waiting，并保存绑定该 Run 的等待点；结构化回答或审批消费等待点后，在同一 Turn 创建新 Run。完成、失败和取消由当前 owner 在数据库事务中收敛。最终结果指向明确的顶层 result Run 的 output Message。取消先持久化状态并暂停待消费输入，再发送 Redis 加速信号；失联 Run 由 lease reconciliation 形成可观察失败。外部副作用按至少一次语义核对。

上下文压缩由 `summary` 中间件和相关机制文档 `docs/mechanisms/context-compression.md` 描述：自动压缩、确定性工具结果压缩、摘要与 checkpoint、主动压缩是不同步骤。内部文件如 `large_tool_results` 和会话摘要不会作为交付物展示。Memory 是否启用受用户配置 `enable_memory` 影响。模型用量统计在服务层按供应商汇聚；`USAGE_UNTRUSTED_PROVIDER_IDS` 明确把 `siliconflow-cn` 和 `siliconflow` 的 usage_metadata 视为不可信，避免错误账单数据污染 Run 与 Thread 聚合。

知识 RAG 在一次 Agent 回合中的调用方式，不是检索中间件偷偷塞上下文，而是模型按需调用知识 MCP 工具。先由 `list_kbs` 看到当前运行可见的库，再 `query_kb` 取片段，必要时用 `find_kb_document` 或 `open_kb_document` 回到原文，用 `search_file` 按文件名定位。引用保留文件身份和行范围，选择器与引用读取走 SDK 调用 MCP。权限在工具执行处重算，模型提示词和 Agent 配置不能授权。这使「知识是否进入本回合」成为可观察的工具事件，而不是隐式提示拼接。

## 7. 知识与 RAG 架构

知识子系统默认随完整拓扑交付，但在内部又分成「本地可写的 Milvus 知识库」和「外部只读连接器」两条链路，机制说明见 `docs/mechanisms/knowledge-base.md`。架构上值得分开的是元数据所有权、解析与分块、索引与检索、图谱，以及 Agent 可见性。

创建知识库时，管理接口 `POST /api/knowledge/knowledge-bases` 在 PostgreSQL 中登记库元数据，并按 `kb_type` 由 `KnowledgeBaseFactory` 取得执行器。Milvus 类型会在向量库中准备集合，并把原始对象准备到 MinIO。飞书、Dify、Notion 类型保存连接凭据（加密由基础设施 Fernet 密钥支持），执行器只按配置只读查询外部服务，不把源文档搬进 MinIO 做一份本地副本。工厂在启动时为已使用的类型创建实例；未知类型会被跳过并记入失败，而不是把整个 API 静默降级成「没有知识库」。

文档进入 Milvus 知识库的路径是：权限校验之后，上传、URL 抓取或从工作区导入在同一套哈希与暂存逻辑中落入 MinIO，并在同一 PostgreSQL 事务里发布目录项、唯一名称、文件记录、幂等回执和后台作业，提交后再投递。URL 导入受白名单约束，环境变量 `YUXI_URL_WHITELIST` 可提供缺省域名列表，页面保存的安全设置优先，显式空列表不会回退到环境变量。worker 领取已登记文件后，按状态机推进解析和索引。解析器是惰性加载的，只有真实发生解析动作时才构造引擎实例。

解析由 `modules/documents` 与 `infrastructure/document_parsing` 分工：前者拥有配置和对象输入，并按调用方指定位置发布资源；后者只负责在本地目录生成完整 Markdown（通常包含 `document.md` 和相对路径图片）。支持的上传格式在 `docs/advanced/document-processing.md` 中列出：文本类 `.txt`、`.md`、`.html`、`.htm`、`.json`、`.csv`；Office 类 `.docx`、`.pptx`、`.xls`、`.xlsx`；PDF；图片 `.jpg`、`.jpeg`、`.png`、`.bmp`、`.tiff`、`.tif`、`.webp`；以及内部必须包含 UTF-8 Markdown 的 ZIP。Office 文件本地转换：`.docx`、`.pptx`、`.xlsx` 走 Docling Slim，`.xls` 走 pandas 与 xlrd。图片必须启用 OCR；PDF 在选择禁用 OCR 时只读文本层，扫描件通常得不到内容。HTML 默认复制正文引用的本地图片，越界或缺失会使整篇失败；可用 `html_text_only: true` 改成只保留 alt 文本。

OCR 引擎在 `ENGINE_SPECS` 中登记七个标识：`rapid_ocr`（本地 ONNX，默认轻量方案）、`mineru_ocr`（自托管 MinerU）、`mineru_official`（官方云，支持格式较少）、`deepseek_ocr`，以及 `paddleocr_vl_1_6`、`paddleocr_pp_ocrv6`、`paddleocr_pp_structure_v3`（三者共用 `paddleocr_api` 适配器，走官网云服务）。系统默认引擎由配置项 `default_ocr_engine` 保存，知识库上传和附件解析可以单独指定；未指定时用系统默认。RapidOCR 随 API/worker 安装，第一次实际解析时加载模型，模型目录优先 `RAPIDOCR_MODEL_DIR`。自托管 MinerU 默认 URI 为 `http://mineru-api:30001`，必须提供 4.1 Tasks 协议，健康检查核验 `/v1/health` 与 `/v1/tiers`。官方云与社区自托管不能只靠替换 URL 互通。附件侧的 `ocr_parse_file` 工具把结果写到当前 Project Workdir 的 `outputs/ocr/`，只返回路径和短预览，完整文本由后续 `read_file` 读取。

分块策略在 `modules/knowledge/chunking`，预设注册于 `chunking/presets.py`。默认预设 `general` 对应内部解析器 `naive`，引擎版本为 `ragflow_like_v1`，实现明显参考了 RAGFlow 的切分思路，根目录 README 也承认这一点。其他预设包括 `qa`、`book`、`laws`、`semantic`、`separator`。解析参数在知识库、文件和单次请求三层合并，请求与文件可以覆盖库级 `chunk_preset_id` 和 `chunk_parser_config`。切分结果写入 `knowledge_chunks`，再由 Milvus 执行器做嵌入和索引。嵌入与重排模型来自 `modules/models` 中已启用的供应商能力，不是写死在分块器里的单一远端。

检索方面，Milvus 知识库提供向量、BM25 与混合检索，并可接重排。管理端有查询测试、查询参数读写和示例问题生成接口。检索测试工作台按官方产品说明展示初筛、混合结果和重排分数变化。评估模块允许上传或自动生成基准问答集，批量跑检索召回，并在提供参考答案和评判模型时评估答案准确性。评估作业同样走后台作业表，只向管理员开放。

图谱是默认拓扑中的存储，但构建是显式作业。管理员在已索引的文档块上配置抽取模型并提交构建；系统抽取实体与关系，结构先写入 Neo4j 并在 PostgreSQL 中标记 `graph_structure_indexed`，向量回填完成后才标记 `graph_indexed`。失败块可以查看、清理、重置和对账，接口在 `/api/knowledge/knowledge-bases/{kb_id}/graph-build/*`。浏览接口在 `/api/graph`，提供列表、子图、标签和统计。README 写明早期图谱思路参考过 LightRAG，但当前实现的提交准入、作业和投影锁都在本树的 `modules/knowledge/graphs` 中。图谱完成后可以与文本块检索融合；它不是另一套独立的问答产品，而是知识库上的增强索引。

Agent 看到知识库的路径已在上一节说明。对外，同一组工具还经过 `GET/POST /api/v1/knowledge/tools/*` 和 `/api/mcp` 暴露给外部客户端。外部客户端使用 API Key；内部 Agent 使用 Knowledge 自己提供的 SDK Auth。通用 MCP 装配复用工具发现与执行策略，但不解释 Knowledge 的范围、Token 或结果结构。关闭知识能力时，这些路由和 manager 都不装配，调用应得到明确的不可用而不是一套伪装成功的空结果。

后台作业与 AgentRun 共享 PostgreSQL 事实加 Redis/ARQ 投递模式，但状态模型不得合并。知识解析、评估和图谱构建由业务服务登记 `job_type + handler_version + payload`，提交后投递；worker 从 registry 惰性加载领域 Handler，用 BackgroundJob 行的唯一 owner、heartbeat 和 lease 执行。文件中间态绑定作业与 attempt owner，失败 hook 与作业终态同事务收敛。取消先保存请求，由执行方在安全检查点响应。共享 ARQ worker 的执行槽由 Compose 配置，后台作业的 PG claim 上限为 4，不能占满 AgentRun 容量。这是为了避免入库或建图把对话执行挤掉，体现了「知识是核心能力，但执行槽要给智能体留下配额」的取舍。

## 8. API 表面按域划分

所有 HTTP API 挂在 `/api` 下，OpenAPI 在开发环境默认位于 `http://localhost:5050/docs`。路由注册中心是 `backend/yuxi/api/routers/__init__.py`。下面按限界上下文归组，只描述表面形状和所有权，不把本文写成接口手册。

系统与就绪：`/api/system/health`、`/ready`、`/discovery`、`/config` 及其更新、`/config/options`、`/ocr/options`、`/ocr/health`、`/info`、日志和跨域资源所有权变更。discovery 用于宣告包括知识能力在内的部署能力。这类路由由 `modules/system` 支撑。

身份：`/api/auth` 覆盖口令登录令牌、首次运行检查与超级管理员初始化、当前用户与资料、用户和密码管理、头像、以及企业 OIDC 的配置、登录、回调、换票与登出。`/api/auth/provider` 是可选的 OIDC 签发端，提供发现文档、JWKS、授权、换票与 userinfo，仅限显式登记的静态客户端。`/api/user` 覆盖用户配置、图片上传、API Key、Agent 环境变量和消息活动。`/api/departments` 管理部门。`/api/user/sandbox` 提供重建与磁盘用量。身份域的最终授权在此完成。

公开智能体协议：`/api/v1/agents` 是外部应用和网页会话共同依赖的 Session 协议。它包括智能体目录、会话的创建、搜索、查看、归档与队列，消息与回执、Turn、审计、Run 与 Input 读取，SSE 事件的提交与拉取，以及文件、协作、压缩、附件和交付物。0.8 起旧接口不保留兼容层，客户端必须按 Session、Turn、Run、Input 的语义编程。网页反馈另行挂在 `/api/agent/threads/{thread_id}/.../feedback`。智能体定义管理在 `/api/agent`：后端列表、默认智能体、按 Skill 创建、读写删除、设默认、以及专属 Skill 的读写和上传。提及搜索在 `/api/mention`。引用与会话导航、Langfuse 追踪链接也在 agent 线程路径下。

工作区与项目：`/api/projects` 管理 Project；`/api/workspace` 提供用户工作区的树、搜索、文件读写、目录、上传与下载；`/api/workspace/knowledge/*` 把知识库文件以只读方式映射进工作区视图；`/api/viewer/filesystem` 为预览器提供另一组树和文件接口。它们都经过 workspace 模块的路径边界。

知识：`/api/knowledge` 是管理与入库主表面，覆盖库的增删改查与可访问列表、文档的上传、解析、索引、重解析、正文与 Markdown、移动和批量删除、目录、URL 抓取与工作区导入、检索与检索参数、示例问题、导出、统计、类型与分块预设，以及图谱构建与对账。`/api/evaluation` 管理评估集与评估运行。`/api/graph` 提供图谱浏览。`/api/v1/knowledge/tools` 是与 MCP 对齐的工具接口。这些路由在知识关闭时不装配。

扩展：Skills 管理同时挂在 `/api/system/skills` 与 `/api/skills`（个人安装、远程来源、草稿确认、内容与文件树、版本与导出）。MCP 在 `/api/system/mcp-servers`，含测试、启用状态、工具开关和个人 OAuth 回调。工具目录在 `/api/system/tools/options`，网络搜索配置在 `/api/system/web-tools`。设备在 `/api/devices`，服务于 aBridge 一类集成。模型供应商在 `/api/system/model-providers`，包括远程模型列表、缓存刷新和状态。

运行治理：`/api/scheduled-tasks` 管理定时 Agent；`/api/background-jobs` 供管理员观察、取消或删除作业；`/api/dashboard` 仅超级管理员使用，提供用户、虚拟机、工具、智能体、调用时序和会话审计等统计。

这一表面看起来条目不少，但域的数量是有限的，并且每个域都能在 `modules/` 中找到单一所有权。二次开发新增对外能力时，应先进入已有域的 router 与 service，而不是在 `main.py` 旁再挂一套平行前缀。

## 9. 前端信息架构与后端限界上下文

前端是 Vue 3 应用，入口在 `frontend/src/app/main.js`，根布局与主题在 `App.vue`，路由在 `app/router/index.js`。公开首页是 `/`，登录页是 `/login`，OIDC 回调为 `/auth/oidc/callback`，Yuxi 作为签发端的页面为 `/auth/provider`，CLI 授权为 `/auth/cli/authorize`。登录后的核心工作区是 `/agent` 与 `/agent/:thread_id`，查询参数可携带 `agent_id`、`project_id`、`member_session_id`。工作区文件页是 `/workspace`。智能体管理是 `/agent-manage`。扩展中心是 `/extensions`，其子路由进入知识库详情、评估集详情、MCP 详情和 Skill 详情。数据总览是 `/dashboard`，路由元数据要求 `requiresSuperAdmin`。未匹配路径进入空页。

路由守卫在导航前加载当前用户：需要登录而未登录时记住 redirect 并转到 `/login`；需要管理员或超级管理员而不满足时给出警告并退回 `/agent`。`ARCHITECTURE.md` 写明：`/extensions` 对所有登录用户开放，Skills 与 MCP 个人连接对普通用户可见，知识库和工具仅管理员可见，MCP 配置仅超级管理员可修改，Token、API Key、OAuth 凭证由用户分别配置；Dashboard 仅超级管理员可访问。这些是体验级约束，后端检查始终是最终边界。

`frontend/src/modules` 的划分几乎是后端域的投影：`session` 负责会话编排、Input 排队、Thread SSE、审批和提及；`agents` 负责智能体目录与编辑；`projects` 与 `workspace` 负责项目和工作区文件，其中 `filePreviewSession` 拥有预览标签、缓存和对象 URL 的生命周期；`knowledge` 负责知识库界面；`extensions` 负责 Skills、MCP、工具与插件相关界面；`identity` 负责登录与用户状态；`settings` 负责系统与个人设置；`background-jobs` 观察作业；`dashboard` 对应总览。`pages` 只做路由适配与装配，例如 `AgentView` 把路由选择交给串行协调器。`apis` 是集中 HTTP 边界，复用 `base.js` 的请求、鉴权和错误处理。ESLint 限制模块不得依赖 `app/pages`，`shared` 不得依赖业务模块或 API，跨模块只能走公开入口。

因此，前端信息架构并没有引入第五套业务模型。二次开发若要加一个管理页，应先确认后端域和 API 已经存在或将要存在，再在对应 `modules/<domain>` 增加模型和界面，而不是在 `pages` 里直接堆请求。

## 10. 多租户与安全边界

安全边界从部署网络开始。开发与生产都将数据库、对象存储、向量库和图谱的维护端口默认绑在回环地址；生产还把 API 绑在 `127.0.0.1`。浏览器只应访问前端和经反向代理的 API。沙盒 runner 的 8090 端口留在内部网络，并用至少 32 字符的令牌认证。Container 默认禁止联网，共享宿主内核，官方把它定位为本地试用和单租户可信代码，而不是多租户强隔离。需要内核级隔离时必须改用 Cube。把 Container 用于不可信多租户执行，是部署选择上的误用，不是架构保证。

身份认证支持本地口令、可选企业 OIDC，以及 API Key。JWT 签名密钥与 API Key 派生密钥必须分离，初始化脚本会拒绝二者相同或长度不足。通用持久凭据用独立的 `YUXI_ENCRYPTION_KEY`（Fernet），文档明确要求不要复用 JWT 密钥。API Key 由服务端主密钥和客户端幂等 ID 确定性派生，只存哈希；撤销保留 request-id 墓碑，同一请求可恢复创建响应，但不能复活已撤销凭据。Public API 把 Key 解析为 ActorScope，区分人类用户、应用和终端用户。跨域方面，开发缺省允许 `localhost:5173` 与 `127.0.0.1:5173`；生产除非显式设置 `YUXI_CORS_ORIGINS`，否则不允许跨域浏览器请求。

授权分三层。角色决定管理能力上限：普通用户对共享的智能体、Skill 和知识库最高拿到 `read`，管理员和超级管理员可以到达 `manage`，见 `ResourcePermission` 与三类 `ResourcePermissionPolicy`。共享范围用 `access_level` 加部门列表或用户列表进一步收窄；管理范围不能超出读取范围。私有资源由创建者拥有。前端隐藏入口并不构成授权。工具执行时还要再查当前用户对目标文件、知识库或 MCP 连接的权限，模型无法通过提示词提权。Knowledge MCP 的短期委托每次调用都复核权限交集。MCP 个人 OAuth 的浏览器事务绑定用户、浏览器和配置修订，连接行锁串行化刷新与断开，世代号阻止旧回调恢复授权。

沙盒文件访问必须落在当前 Project Workdir、User Data 或已授权 Skills 之内。Workspace 使用 no-follow 校验来绑定已有目录，拒绝通过符号链接逃出。Cube 的恢复路径必须核对 uid 和 owner。审批模式控制命令执行和 Project 外写入是否需要人确认；默认完全信任改变的是产品交互，不是权限模型本身，未获授权的资源仍然拒绝。

密钥与密钥材料不得进入本文，也不应进入提示词、Skill 正文或沙盒用户环境。网络搜索凭据保存在系统配置中，执行时由服务读取。初始化脚本会生成并持久保存应用密钥、runner 令牌和实例标识；已有 `.env` 时保留原密钥，避免用模板覆盖。

## 11. 配置分类与二次开发扩展点

配置分成几层，来源和优先级在 `docs/advanced/configuration.md` 中说明。部署层由 Compose 与 `.env` 提供：数据库与对象存储地址、知识开关、沙盒后端、CORS、公开站点来源、连接池和并发容量、OIDC 开关等。这些项通常要重建容器才完全生效。安全密钥由初始化脚本保证存在且形态合法。管理员系统配置保存在 PostgreSQL，覆盖默认模型、快速模型、引用模型、嵌入与重排、协作深度与并发、默认 OCR 引擎、网络搜索与抓取供应商等可运行时修改的字段。用户配置和用户级 Agent 环境变量属于个人范围。模型供应商以数据库为准，环境变量只为内置供应商提供初始 API Key 名称映射。

初始化脚本 `scripts/init.sh`（Windows 为 `scripts/init.ps1`）无条件要求 `SILICONFLOW_API_KEY`，即便生产打算使用其他供应商。这是引导缺省，不是运行时唯一允许的模型来源。内置供应商定义在 `modules/models/providers/builtin.py`，包括 OpenAI、DeepSeek、多组 DashScope 与阿里云 Coding Plan、智谱与 Z.AI、小米 MiMo、Kimi Code、Moonshot、MiniMax、OpenRouter、ModelScope、OpenCode，以及硅基流动国内站 `siliconflow-cn` 和国际站 `siliconflow`。Anthropic 与 Google Gemini 的块在源码中被注释，不能当成已交付的内置项。硅基流动国内站预置了聊天、嵌入和重排的启用模型列表，并声明同时具备这三类能力。登录后可在「智能体 → 模型供应商」接入或调整，不必把所有密钥写进环境文件。自定义 OpenAI 兼容端点（例如 Ollama）通过供应商配置完成，而不是另写一套客户端。

二次开发的落点可以从「增加什么」来看。

增加一种预置角色：在 `modules/agents/presets` 新增模块，导出 `AgentPreset`，给出唯一 `slug`、名称、描述、`backend_id`（通常仍是 `ChatbotAgent`）和 context（系统提示、skills、plugins 等）。`discover_agent_presets` 会自动发现，拒绝重复标识。

增加一种执行后端：在 `runtime/agent_backends` 实现 `BaseAgent` 的子类，并写入 `AGENT_BACKENDS`。需要同时处理 Context 字段、中间件和工具装配，文档见 `docs/agents/agent-backend-development.md`。这是较重的扩展，大多数场景不必走到这一步。

增加内置工具：在 `modules/extensions/tools/builtin` 用 `@tool` 注册，并在包初始化中显式导入。产生文件、网络或数据库副作用的工具必须在执行边界再次校验用户和目标资源。注册不等于授权，也不自动出现在每一轮 ToolNode 中。

增加部署插件：按 `docs/agents/plugin-development.md` 在独立目录提供 `plugin.py` 与可选 `skills/`，实现受限的 `YuxiPlugin` 接口，并在 `modules/extensions/plugins/registry.py` 的 `REGISTERED_PLUGINS` 元组中显式登记。当前源码只登记了 `KnowledgePlugin` 与 `AbridgePlugin`。插件不可由用户上传代码路径加载。`load_plugin` 只返回入口说明并写入 `activated_plugins`，下一轮才开放工具。插件专属工具不得与平台工具或其它插件重名。

增加 Skill：共享 Skill 经管理接口或内置同步进入 PostgreSQL 目录；个人 Skill 落入 UserWorkspace。内置 Skill 现有 `chat-widgets`、`deep-research`、`image-gen`、`mysql-reporter`，以及插件自带的 `knowledge-base` 与 `abridge`。Skill 只提供操作说明，不声明运行依赖，也不保存激活状态。新增内置 Skill 应走现有同步通道，而不是让运行进程改写用户配置。

增加或适配 MCP：超级管理员登记远程服务器，用户配置个人 Token 或完成 OAuth。传输、授权事务和出站复查的边界在 `docs/mechanisms/mcp.md` 与 `docs/agents/mcp-integration.md`。不要把 Knowledge 的范围解释逻辑写进通用 MCP 装配。

增加模型供应商：优先通过管理界面添加 OpenAI 兼容供应商；若要成为内置项，再改 `BUILTIN_PROVIDERS` 并处理用量元数据是否可信。嵌入与重排能力要显式声明，不能假设所有供应商都具备。

增加文档解析引擎：在 `infrastructure/document_parsing/engines` 实现 `DocumentEngine`，并在 `ENGINE_SPECS` 登记 `engine_id`、显示名、支持的扩展名和类路径。引擎按需惰性实例化。不要把解析器初始化放到 API 启动路径上。

增加知识库类型：实现 `KnowledgeExecutor`（只读外部源可继承 `ReadOnlyConnectors`），调用 `KnowledgeBaseFactory.register`。管理用例通过工厂读取类型能力。外部连接器不应假装支持本地上传。

增加 HTTP 路由：在对应域的 `api/routers` 增加薄路由，把用例放到 `modules/<domain>/services`，查询放到同域 `repositories`，并在 `routers/__init__.py` 按开关装配。知识相关路由必须尊重 `YUXI_KNOWLEDGE_ENABLED`。

增加中间件：放到 `runtime/middlewares`，并进入构图时的固定顺序。中间件只应调用已公开的模型和工具包装钩子，不应私自改写终态所有权。

这些扩展点之所以集中、显式，是因为产品把「可定制」设计成替换和登记，而不是打开几十个互相独立的可选子系统。下一节用这个观察回答与更宽型企业套件之间的取舍。

## 12. 设计取舍：紧凑核心与可选广度

从 Compose 文件可以直接读出一种与「功能超市」不同的态度。知识库、向量检索和图谱存储被放进默认拓扑，应用镜像在本机构建，开发者启动一套环境后就同时拥有对话、文件工作区和知识入库的前置依赖。真正被做成开关的，是少数几种成本或隔离模型显著不同的东西：整段关闭知识运行能力、选择 Container 或 Cube、可选自托管 MinerU、可选 aBridge、可选企业登录和观测。即使关闭知识，聊天、会话、沙盒和权限仍然在；即使不启动 MinerU，RapidOCR 和云端 OCR 仍可配置；即使不用 Cube，Container 也能完成可信代码场景下的命令执行。产品没有把这些对等列为「模块 1 到模块 N，按许可证勾选」。

与这种默认完整交付相配套的，是运行时内部的克制。执行后端目前只注册一个 `ChatbotAgent`，多种产品角色靠预设和 context 区分。知识工具没有在本地再注册一套平行实现，而是统一走 MCP。插件必须显式登记，不能动态加载用户提交的代码。Schema 变更不在运行进程里自动发生。三种后台机制共享投递通道，但拒绝合并状态模型。文件路径跨层只允许三种形态。这些约束让二次开发者面对的是一套可以读完的代码地图，而不是必须先关闭十几项企业选项才能看清主路径。

可选广度仍然存在，而且应当被如实描述。外部知识连接器、多种 OCR、多种模型供应商、MCP OAuth、会话协作、评估、定时任务、Dashboard、品牌定制、用量统计和 Langfuse，都会增加理解成本和运维面。但它们挂在已有域的扩展点上：连接器是知识工厂里的类型，OCR 是引擎登记表里的一项，供应商是模型模块里的配置，协作是中间件和一组表，评估是知识域的后台作业。关闭或不用其中某项，并不需要拆掉核心闭环。这与「先提供大量可关可开的企业子系统，再在其中拼装场景」是两种结构。本树更接近前者的对偶：先交付一条不能再随便拆掉的主链，再把差异点做成登记和配置。

因此，把 Yuxi 判断为「功能都很核心、适合在自己的场景上二次开发」，在源码结构上是站得住的，前提是不要把这句话理解成「没有任何可选部分」。正确的表述是：智能体运行时、默认开启的知识检索、多租户权限和沙盒工作区构成不可再瘦的产品内核；少数 Compose profile 与叠加文件处理隔离模型、重解析器和外部设备桥；其余能力是内核上的显式扩展，而不是另外一排可以整体卸下的产品线。二次开发应当沿着第 11 节的登记点进入，而不是复制一套并行的服务拓扑。


## 13. 会话记录的形状与队列并发模型

把智能体运行时说成「先入队再执行」还不够，因为表结构本身就在强制一种并发语义。`sessions` 表用 `thread_id` 作为对外稳定标识，整型 `id` 只做内部主键。协作树用 `tree_root_thread_id`、`parent_thread_id`、`cooperation_name` 和 `cooperation_path` 表达：根会话默认名称为 `root`、路径为 `/root`。`created_by_run_id` 指向创建该成员会话的父 Run。`config_snapshot` 在创建时冻结配置，`creation_request_id` 保证新建 Session 的幂等。归属字段同时包含 `uid` 和可选的 `app_id`，使 Public API 的应用作用域不会和人类用户的会话混在一起。`agent_id` 是智能体 slug，`project_id` 不可变，`status` 取 `active`、`archived` 或 `deleted`，`queue_paused` 标记队列暂停，`is_pinned` 用于置顶，`last_viewed_run_id` 记录用户看过的最近顶层 Run。Thread 只归档，不在仍有活跃 Turn 或待处理 Input 时删除所属 Project。

`agent_turns` 用字符串主键，状态缺省为 `running`，并保存 `current_run_id` 与 `result_run_id`。一轮工作的对外结果必须以 `result_run_id` 指向的顶层 Run 及其 `output_message_id` 为准，禁止从未完成的子 Run 或相邻 Run 猜测输出。`waitpoint` 以 JSON 保存人工等待点，`langfuse_root_observation_id` 只是观测关联，不是业务终态。`next_output_index` 为输出项提供稳定序号。

`agent_runs` 把一次执行段写得很完整。状态包括 `pending`、`running`、`completed`、`failed`、`cancel_requested`、`cancelled`、`interrupted`、`yielded`；终态集合是前五个完成类再加 `interrupted` 与 `yielded`。`pending` 表示已经持久化的投递意图，还不是正在跑的进程。`running` 与 `cancel_requested` 必须由唯一 attempt lease 拥有，心跳只能由当前 owner 续租，过期所有权不能被另一个执行者静默接管。`execution_seq` 提供跨 Run 订阅的持久执行顺序。`runtime_scope_id` 指向所属 Thread 的运行作用域，`runtime_cleanup_pending` 标记终态 Run 是否仍负有运行时清理责任；领取边界会拒绝同一 Thread 尚有清理责任的首次执行。来源快照包括 `source`（缺省 `chat`）、`channel`（缺省 `web`）、`app_id`、`api_key_id`、`external_id` 和不可变的 `origin_metadata`。`resume_from_run_id` 与 `created_by_run_id` 分别表达接续与派生。`input_payload` 保存原始输入，`token_usage` 按模型分组。`manifest` 与 `manifest_fingerprint` 在进入 LangGraph 前 write-once 固化，避免运行清单在中途被改写。时间戳区分 `started_at`、`prepared_at`、`first_model_request_at`、`first_output_at` 和 `finished_at`，用于并发容量文档中所说的 Run 内持久时延口径，而不是只给一个模糊的「耗时」。

输入侧，`agent_inputs` 保存尚未或已经进入消费的原始内容，`agent_input_receipts` 保存幂等接收事实。同一用户、同一 APP、同一智能体和同一 Thread 上的 follow-up 按 FIFO 单条领取；steer 优先，并在消费时把连续就绪前缀合并进同一次领取，多个 Input 通过 `consumed_run_id` 归属于同一 Run，但每个 Input 仍然保持独立身份。未就绪队头不能被越过。等待回答或审批时，普通消息会被拒绝，直到等待点被结构化回答消费，或用户明确控制队列。暂停从待办派生，恢复消息会持久固定在优先位置并单独消费，完成后再回到原队列。这些规则保证「插入纠正」不会把已经排队的后续输入丢到不确定的位置上，也保证幂等重试不会生成第二套消息历史。

协作树在这个模型上是递归的，而不是另起一套会话类型。成员会话拥有自己的 Input 队列和 Turn，但共享 Project Workdir，并且在系统配置的并发上限内争夺执行名额。稳定 ID 负责全范围寻址，路径只在本树内解析。取消语义因此必须分层：取消指定 Turn 不影响兄弟成员；用户显式停止整树才取消所有在途 Turn。父会话结束也不会自动抹掉已经派生的后代工作。理解这些表之间的指向关系，是二次开发时改调度或加一种新输入通道时最容易踩空的地方——新通道必须先成为 Input，而不能直接写 Message。

## 14. 检索参数、图检索开关和知识文件代次

Milvus 知识库的检索并不是固定的「向量 top-k」。`MilvusRetrievalConfig` 把可配置项直接暴露给管理界面和查询参数接口。检索模式 `search_mode` 缺省为 `vector`，可选 `keyword`（只用 BM25）和 `hybrid`（向量与 BM25 融合）。过滤条件包括空格分隔的必含词、排除词，以及按分词顺序匹配、不允许间隔的完整短语。`highlight_results` 缺省开启命中高亮。`final_top_k` 缺省 10，上限 100，表示重排序后返回的块数。`similarity_threshold` 缺省 0，只对纯向量检索生效。`bm25_top_k` 缺省 50，上限 200。混合检索的缺省权重是向量 0.7、BM25 0.3。`bm25_drop_ratio_search` 用于丢弃低分稀疏项，数值越大检索越快，但可能降低召回。`include_distances` 控制是否显示相似度。这些默认值都写在执行器配置里，知识库可以用 `query_params` 覆盖，测试接口 `POST /api/knowledge/knowledge-bases/{kb_id}/query-test` 允许管理员在不改持久参数的情况下观察差异。

图检索是另一组显式开关，而不是「有 Neo4j 就自动走图」。`use_graph_retrieval` 缺省为 `false`。打开之后才使用 `graph_entity_top_k`、`graph_triple_top_k`（缺省都是 10，上限 100）、`graph_max_nodes`（缺省 10000，上限与执行器常量 `MAX_GRAPH_NODES` 一致，为 50000）、`graph_top_k`（缺省 20，上限 200）以及 `graph_weight`、`ppr_damping` 等融合参数。执行器还为最终返回、召回、BM25、图实体、图三元组和路径召回分别设置了硬上限。也就是说，默认拓扑里的 Neo4j 提供的是「能够构建并可选启用图检索」的能力，而不是每次问答都做 2-hop 扩散。这与「图谱存储默认在、图谱构建要提交作业、图检索要打开开关」三条事实是一致的，不能简化成「图谱完全是可有可无的装饰」，也不能简化成「图谱与向量检索始终同等强制」。

知识库元数据本身很克制。`knowledge_bases` 用公开的 `kb_id` 作业务标识，保存名称、描述、类型、嵌入模型规格、可选的 LLM 规格、查询参数、附加参数、共享配置和示例问题。未删除库的名称在小写后全局唯一，软删除后名称可以被新库复用。文件表同时充当目录树：`is_folder` 区分目录，`parent_id` 构成层级，复合外键保证子节点与父节点同属一个知识库，并且是可延迟约束，允许同一事务内按任意顺序写入树。未删除行在同一父目录内的文件名必须经过 NFC 和小写归一后唯一，根层同样不允许同名；文件名必须是干净叶子名，不能包含路径分隔符、控制字符或首尾空白。`file_id` 单列唯一，同时与 `kb_id` 构成复合唯一，避免跨库引用被错接。

文件事实还带有单调代次。`generation` 是当前事实代次，`building_generation` 记录在途重建，投影成功后晋升 `active_generation`。软删除先在 PostgreSQL 生效，向量库等外部投影通过 `knowledge_projection_outbox` 异步清理，状态只有 `pending` 和 `applied`，用 `event_key` 保证唯一。导入回执 `knowledge_imports` 按操作者与 `import_id` 唯一，删除文件或知识库不能复活同一请求。这些设计解决的是分布式索引常见的「元数据已删、向量还在」或「重复导入生成两套文件」问题，也解释了为什么知识清理必须走后台作业而不能在 API 请求里直接删远端集合。二次开发如果自行往 Milvus 写集合或绕过 outbox 删文件，就会破坏这套代次与投影约定。

## 15. 两种沙盒后端的实现边界

沙盒选择发生在进程装配，而不是在某次工具调用里临时决定。`modules/agents/runtime/sandbox/provider.py` 读取 `SANDBOX_BACKEND`，缺省为 `container`，只接受 `cube` 或 `container`。选中 cube 时校验 Cube 配置；选中 container 时要求 `SANDBOX_RUNNER_TOKEN` 至少 16 个字符（初始化脚本在部署层还会按至少 32 个字符生成更严格的密钥）。`get_sandbox_provider()` 为进程缓存一个无长期连接的客户端：`CubeSandboxProvider` 或 `ContainerSandboxProvider`。就绪检查把 `health()` 放到线程中执行，镜像和资源限制由执行节点自身校验，API 进程不重复实施一份 Docker 约束。

Container 路径里，业务进程使用 `SandboxRunnerClient` 访问 runner。runner 进程在 `yuxi/sandbox_runner/main.py` 中暴露经过令牌校验的 HTTP：按 `run_id` 执行命令、取消指定命令、移除某个 Run 的容器、按容器 ID 删除、列出受管 Run，以及统计与健康检查。公开的 `/health` 与需要认证的健康检查是分开的。生命周期里有过期循环，用于回收超出 `SANDBOX_CONTAINER_MAX_LIFETIME_SECONDS`（模板缺省注释为 7200 秒）的容器。标准输入上限在客户端侧以 `MAX_STDIN_BYTES = 100 * 1024 * 1024` 给出。工作目录解析由 runner 侧的路径函数完成，业务进程只传递虚拟路径和身份。`.env.template` 中与 Container 相关的其它上限还包括内存 1073741824 字节、1 个 CPU、256 个 PID、家目录与临时目录各 268435456 字节、最多 32 个容器、最多 8 个并发 exec，以及运行用户 `1000:1000`。这些数字是模板里的缺省值，生产可以用环境变量覆盖，但架构含义不变：限制的 Owner 是 runner，不是 LangGraph 工具函数。

Cube 路径的适配在 `cube.py` 与 `cube_provider.py`。它面向持久用户环境，事件流读取带有 `MAX_FRAME_BYTES = 1024 * 1024` 的帧上限，退出码从事件中解析。用户环境在无活动 Run 与命令时按 `SANDBOX_IDLE_SECONDS` 休眠，缺省 300 秒。命令超时与输出体积另由 `SANDBOX_EXEC_TIMEOUT_SECONDS`（缺省 180）和 `SANDBOX_MAX_OUTPUT_BYTES`（缺省 262144）约束，这两项对两种后端都有意义。Cube 节点还要配置 API 地址、可选认证、代理节点与端口、模板 ID，以及与 Yuxi 共享的用户数据目录和 Skill 投影目录。官方运维文档强调：Yuxi 与执行节点必须看到同一份文件目录，路径不能各写各的。

`UserSandboxBackend` 把具体后端组合成工具可用的执行面，文件系统中间件再把它暴露为 `execute` 等工具。因此，二次开发若要改命令策略，应改 sandbox backend 或 runner，而不是在某个 Skill 里直接调用 `docker run`。若要支持第三种隔离模型，需要新增 Provider、在 `validate_sandbox_configuration` 中登记，并提供对等的健康检查与清理语义；这是明确的扩展点，但不是轻量改动。

与沙盒紧密相关的是审批和网络。Container 默认 `SANDBOX_CONTAINER_NETWORK=none`，改为 `bridge` 会削弱网络隔离，文档把它写成已知的权衡。0.8 把网页默认审批模式改为完全信任，敏感工具可自动执行，但这只影响是否插入等待点，并不允许命令写到授权目录之外，也不改变 runner 的资源上限。已知限制还包括：临时软件与登录态不跨执行段保留（Container 尤其如此），以及共享内核带来的隔离强度上限。这些限制属于架构事实，而不是使用说明里的附带提醒。

## 16. 启动装配、并发容量和失败恢复

`app-init` 的入口 `bootstrap/app.py` 调用 `migrations/main.py` 的 `initialize_schema`。空库才会建表并写入 `business=4`、`knowledge=2` 的版本记录；非空库走校验而不是重建。`_require_empty_database` 阻止在已经有业务对象的库上静默执行当前版本的结构初始化。随后在同一 advisory lock 内同步代码拥有的共享定义：系统配置项、内置模型供应商、预置 Agent、内置 MCP 与内置 Skill 文件。同步失败会阻止 API 和 worker 成为就绪，但已提交的内容保留，便于修正后重跑。这个「一次性进程 + 锁 + 幂等同步」的模式，避免了多个副本在启动时互相覆盖内置定义，也避免了运行进程拥有 DDL 权限。

worker 的容量由 `workers/settings.py` 的 `worker_max_jobs()` 读取。`.env.template` 的注释给出设计口径：默认按单个 worker、100 个同时运行的 AgentRun 来配置，`ARQ_MAX_JOBS` 缺省建议为 140，因为 AgentRun、后台作业和已登记的控制工作共用执行上限，需要留出恢复与对账的槽位。后台作业另外受 PostgreSQL 全局最多 4 个 `running` claim 限制。协作树的 Run 上限是系统配置 `max_cooperation_concurrency`，默认 4、最小 1，在领取下一次执行时读取当前值；调低上限不会取消已经领取的 Run，调高也不能突破 worker 或模型供应商容量。取消收尾同样占位。协作树限额不限制其他树的总并发，也不等于用户 VM 的命令或磁盘配额。取消链路不使用 Redis Pub/Sub，也不为每个 Run 长期占用一个 Redis 连接；并发文档给出 100 个活跃 Run 时取消键读取上界约为每秒 500 次，这是容量规划用的数量级，而不是运行时保证的 SLA。

连接池与之配套。模板为 API 与 worker 分别给出 PostgreSQL 池大小 120、溢出 40、超时 30 秒，Redis 每池连接上限 256，并特别区分 LangGraph 使用的 checkpoint 池：API 侧缺省 10，worker 侧缺省 120。Postgres 容器 `max_connections` 缺省 600。这些数字说明架构已经按「API 负责大量短请求和少量 checkpoint 访问，worker 负责大量执行和大量 checkpoint 写入」来分配池，而不是让两个进程共用一份默认的小型连接池。调容量时必须同时看 ARQ 槽位、数据库连接、Redis 连接和模型供应商速率，只改其中一个会把压力转移到另一层。

失败恢复沿着所有权展开，而不是沿着「再把任务丢进队列一次」。AgentRun 靠 lease reconciliation：失联的 running 或 cancel_requested 会变成可观察失败，或在仍有清理责任时先完成清理再允许下一轮领取。pending Run 可以被恢复扫描补投，已失败的工作不会自动重试。后台作业靠 publisher 补发仍然为 pending 的 PostgreSQL 行，执行方在检查点响应取消。知识文件的错误态与作业终态同事务收敛，避免出现「作业显示失败、文件还停在 parsing」的撕裂。图谱构建有 failed-chunks 查询、单文件清理、重置和对账接口，因为抽取和向量回填是两阶段过程，只重跑整库既昂贵也不安全。Redis 重建后必须恢复 worker 健康租约，否则 `/api/system/ready` 不会重新变为就绪；这是生产排障文档单独列出的原因。SSE 断线时客户端读取 PostgreSQL 快照，不从相邻 Run 推断结果，也不把 Redis Stream 当成可以无限重放的日志。

观测上，优先通过 Compose 查看 `api`、`worker` 和依赖服务的日志。Langfuse 是可选接入，配置后在服务层和 AgentRun 上下文中产生 Turn 级 trace 与 Run 级 observation，但它不拥有业务终态，也不能代替数据库里的 Run 状态。硅基流动等被标记为用量不可信的供应商，其 usage_metadata 不会进入累计，以免污染按用户统计。把观测当成控制面，或把外部追踪系统当成恢复依据，都不符合本树的所有权划分。

## 17. 把二次开发放回这条结构里

如果把前面的模块、表、开关和扩展点压缩成一句给二次开发者的指引，那就是：先承认核心闭环是完整的，再只在登记点上长出自己的场景，不要把可选开关当成可以拆掉内核的借口，也不要把内核里的每一张表都当成可以随意合并的实现细节。

一个典型的场景定制路径是这样的。先用内置供应商或自行添加的 OpenAI 兼容供应商接好聊天、嵌入和可选重排，这决定了对话和入库能不能跑通。再决定知识是否需要出现在本部署中：需要，就保留默认拓扑，选择分块预设和 OCR 引擎，按部门或人员配置知识库共享范围，并在智能体上启用 `knowledge-base` 插件；暂不需要，就用 `docker-compose.no-knowledge.yml` 整段关闭运行能力，而不是删掉模块代码。然后用预设或新建 Agent 定义描述自己的角色，把场景操作写进 Skill，把必须受控的副作用写成内置工具或 MCP，把文件交付放进 Workdir 并由 `present_artifacts` 展示。若任务需要隔离更强的执行环境，再准备 Cube 节点并切换 `SANDBOX_BACKEND`；若只是本地可信自动化，Container 已经闭合。最后才考虑 OIDC、aBridge、Langfuse、评估集和 Dashboard 这些治理与集成面。

沿这条路径前进时，最危险的改法是为了「简单」而打通本树刻意分开的所有权：让 API 进程直接执行长时间的解析或模型循环，让 Redis 保存 Run 终态，让工具函数持有宿主路径，让知识检索绕过 MCP 和权限复核，让运行进程修改 Schema，让插件从用户上传的路径加载代码，让 Container 默认桥接网络去模拟「能上网的开发机」。这些改法都会把紧凑核心重新变成难以推理的单体。相反，遵守包边界、事务边界、路径边界和开关边界，Yuxi 作为二次开发基座的价值才能成立：功能集中在一条主链上，差异通过显式登记进入，而不是靠关闭大量冗余模块来寻找主链。


## 18. 生产入口、请求体与流式边界

开发环境里，浏览器直接访问 Vite 开发服务器，API 单独暴露在 5050 端口。生产环境则把前端静态资源与反向代理放进同一个 Web 容器，配置位于 `docker/nginx/default.conf`。默认监听 80，`client_max_body_size` 为 20M，普通 `/api/` 请求按这个上限转发到 `api:5050`，并关闭缓冲、关闭缓存，把读、连接和发送超时设为 600 秒，以同时覆盖上传和 SSE。这解释了为什么就绪检查、会话事件和长任务观察必须走同一套 `/api/` 代理，而不能另外开一个未关闭缓冲的短超时入口。

有两处刻意放宽或改写。第一，匹配 `/api/v1/agents/sessions` 以及带事件后缀的路径时，请求体上限提高到 100M。配置注释写明：公开协议创建会话和消息事件可以承载内联 base64 图片，单条消息最多 10 张、合计 80 MiB，因此必须把该正则 location 的请求体放到 100M，并且显式重复全部代理和流式设置，因为正则 location 不会继承前缀 location 的代理参数。第二，OIDC 与 MCP OAuth 的回调路径使用单独的 access log 格式，关闭 error_log，并加上 `Cache-Control: no-store` 与 `Referrer-Policy: no-referrer`，避免把回调查询串写进普通错误日志。前端回调页 `/auth/oidc/callback` 和扩展页 `/extensions` 直接回 `index.html`，不把这些浏览器路由误代理到 API。

对象存储的浏览器访问也被收窄。`/minio/public/` 只允许 GET 和 HEAD，并代理到 MinIO 的 `public` 桶路径；其余 `/minio/` 直接返回 404。生产模板里 `MINIO_PUBLIC_URL` 的缺省思路是走前端同源代理，而不是把 MinIO 控制台或写接口暴露到公网。这与「MinIO 拥有对象、浏览器只获得经过授权的读取路径」的存储划分一致。TLS、域名和证书不在这个 nginx 配置里出现，必须由部署方在更外层处理。架构上这意味着 Yuxi 的生产 Web 容器是应用入口，不是完整的边缘安全栈。

公开 Agent API 的事件与创建路径之所以要在网关层特殊处理，是因为它同时承担「提交」和「观察」。客户端可以创建会话、提交消息、用 SSE 读取增量，并在断线后用 PostgreSQL 快照和事件游标恢复。协议把 Session、Turn、Run、Input 分成可独立寻址的对象，网页和外部应用共用这一套，而不是给浏览器另做私有接口。0.8 去掉旧接口兼容层，正是为了让这条协议成为唯一的会话边界。二次开发如果要嵌入自己的业务系统，应使用该协议和 API Key，而不是去调用前端模块内部的 store。

## 19. 身份硬化与密钥作用域

口令登录不是单一计数器。账号级锁定定义在 `modules/identity/models.py`：连续失败达到 `MAX_LOGIN_FAILED_ATTEMPTS = 5` 次后，从最后一次失败时刻起锁定 `LOGIN_LOCK_DURATION_SECONDS = 300` 秒。这可以阻止对单个已知用户名的在线猜测，但也带来「攻击者故意输错密码、把合法用户锁在门外」的风险。因此 `services/login_limits.py` 在 Redis 中再叠加两个滑动窗口：同一 IP 加账号在 10 分钟内最多 10 次失败，同一 IP 全局最多 30 次失败。组合阈值高于账号锁定阈值，目的是让正常用户先看到账号锁定提示，而不是直接碰上 IP 限速。计数跨 worker、跨进程重启仍然有效。中间件里还有内存级的每 IP 尝试节流，作为更快但不可跨进程共享的防线。客户端 IP 优先取 `X-Forwarded-For` 的首段，与访问日志一致；生产必须由反向代理覆盖或剥离客户端自带的该头，否则攻击者可以伪造地址绕过限速。这是身份架构对部署的硬依赖，不是可忽略的运维建议。

首次初始化超级管理员使用独立的 PostgreSQL advisory lock（`administration.py` 中的 `_INITIALIZATION_LOCK_KEY = 0x59555849`），避免多个请求同时把空实例初始化成两个超管。身份变更与数据库触发器共用 `IDENTITY_CHANGE_LOCK_KEY = 1498765386`，注释明确要求升级不得改变已有键，否则会和库内触发器失去互斥。软删除、角色变更和超管人数约束都在这一把锁的保护范围内。OIDC 登录仍会检查账号是否被锁定、是否为人类用户、是否已删除，不会因为外部身份提供商已认证就绕过本地禁用状态。

API Key 的作用域是显式的。`api_keys.access_level` 只允许 `full`、`agents` 或 `knowledge`。缺省为 `full`。Public API 在解析调用者时，对智能体协议要求级别属于 `full` 或 `agents`；知识工具则走对应的 knowledge 级别。密钥派生与撤销语义前文已经说明。这里要强调的架构含义是：外部集成不必拥有与超级管理员网页会话相同的能力面，Key 的级别、所属用户、可选 `app_id` 和过期时间共同构成调用作用域。终端用户身份通过 `end_user_id` 进一步隔离会话，使同一个业务应用可以代理多个终端用户，而不把他们的 Thread 混在一起。

这些机制说明「多租户私有部署」在本树里首先是身份和密钥设计，其次才是资源共享范围。二次开发若要接入已有账号体系，应走企业 OIDC，并理解本地锁定与角色仍然有效；若要让外部系统调用智能体或知识库，应发放适当级别的 API Key，而不是把超管 cookie 或 JWT 签发逻辑复制到业务服务里。

## 20. 内置 MCP、图谱抽取器与其它显式登记表

除了工具、插件、知识库类型和 OCR 引擎，本树还有两张对架构很重要的登记表。

内置 MCP 清单在 `modules/extensions/mcp/builtin.py`。`knowledge` 的地址被写死为 `http://api:5050/api/mcp`，注释说明这是本平台自有服务，容器内地址不经环境变量改写，认证模式为 `delegation`，缺省启用。`abridge` 指向 `http://abridge:8765/mcp`，同样是委托认证、缺省启用，但 `supports_direct_mcp_selection` 对其返回假值：设备能力必须经过插件加载操作约束，不能像普通远程 MCP 那样被智能体直接勾选。`deepwiki-official` 指向公开的 `https://mcp.deepwiki.com/mcp`，用于查询公开 GitHub 仓库文档，不在缺省启用表里按委托模式写死。`builtin_mcp_available` 的规则是：关闭知识部署只让 `knowledge` 变为不可用，并不抹掉它的内置身份，也不改写管理员开关本身。这与启动装配「关闭时不装配路由与 manager，但保留身份」的说法一致。二次开发新增内置 MCP 时，应理解「身份保留、能力可关、是否允许直接选择」是三个分开的开关，而不是一个布尔值。

图谱抽取器工厂目前只注册一种类型：`llm`，对应 `LLMGraphExtractor`。基类规定实体名、实体标签和关系类型的最大长度分别为 512、128 和 256，并对抽取结果做归一化、可持久化判断和属性合并。LLM 抽取器带有默认的三元组抽取提示和 Schema 约束说明，缺省超时 60 秒，最大允许 600 秒。管理员在提交构建任务时配置抽取模型和相关选项，工厂在创建时校验配置，未知 `extractor_type` 会直接失败。这意味着当前图谱构建高度依赖聊天模型的结构化输出能力，而不是内置一套规则抽取或多种互备算法。若要增加一种非 LLM 抽取器，需要实现 `GraphExtractor` 并写入 `GraphExtractorFactory._registry`，这与知识库类型、OCR 引擎的扩展方式相同：显式登记，启动时或提交时校验，不允许运行中动态加载未注册实现。

把这些登记表和前面的 `AGENT_BACKENDS`、`REGISTERED_PLUGINS`、`KnowledgeBaseFactory`、`ENGINE_SPECS`、`BUILTIN_PROVIDERS`、`CHUNK_PRESETS` 放在一起看，Yuxi 的扩展模型非常一致。几乎所有「可以多一个」的东西都有一个代码拥有的注册表，由部署或初始化同步进入数据库，再在运行时按权限和配置决定是否对当前用户可见。没有注册表的位置，通常就不是扩展点。这种一致性降低了二次开发的记忆负担，也解释了为什么产品可以把较多能力收进一个核心，而不必靠功能开关矩阵来管理复杂度。

## 21. 架构结论

Yuxi 在本树中的系统形状，是一个以 Docker Compose 为部署事实来源、以单个 Python 包为后端内核、以 Vue 模块为体验投影的多租户智能体平台。进程上把 HTTP、后台执行、一次性初始化和可选的沙盒 runner 分开；存储上让 PostgreSQL 拥有事实，Redis 拥有投递与短期事件，MinIO、Milvus、Neo4j 和用户工作目录各拥有一类字节或索引；运行上把用户输入变成有所有权的 Input、Turn 与 Run，再在一个 Chatbot 后端上用中间件和工具组合出知识检索、文件执行、协作和压缩。知识能力默认随拓扑交付，也可以整段关闭运行面；图谱存储默认在场，构建与图检索却是显式动作；沙盒必须二选一，但工作目录始终存在。版本上要分清官方 `v0.8.0` 标签、本树 `main` 提交 `47e4e5a`，以及源码中的 Schema 基线 business 4 与 knowledge 2。

对二次开发而言，这条结构的价值不在于模块数量少到可以一眼数完，而在于主链完整、边界清楚、扩展靠登记。合适的定制是沿着预设、工具、Skill、插件、供应商、解析器和路由进入自己的场景；不合适的定制是拆掉队列与租约、把可选 profile 误认为内核也可以删除，或引入一套绕过权限和路径边界的平行实现。只要承认少数开关的真实存在，并坚持核心闭环不可再随意变瘦，Yuxi 就可以作为私有部署的智能体基座来理解，而不是作为需要先裁剪才能使用的企业套件来理解。


## 22. 消息、审计与前端会话投影

对外可见的对话历史并不是把 LangGraph 的内部消息直接倒给浏览器。`messages` 表用多层约束把「用户输入投影」「模型与工具审计」和「公开内容」分开。角色只允许常规的 user、assistant、system、tool 语义；`message_type` 缺省为 `text`，注释还列出 `tool_call` 与 `tool_result`。工具审计有更严的规则：`TOOL_AUDIT_MESSAGE_TYPE` 与 `MODEL_AUDIT_MESSAGE_TYPE` 是独立类型，且约束要求工具审计行的 `content` 必须为空，原始结果放在 `extra_metadata.output` 中，避免同一份工具结果在 `content` 和元数据里出现两套互相漂移的表示。公开适配器再把这些事实转成 OpenAI Agents 风格的事件给前端和 Public API。普通历史只读取已登记的公开项，不包含内部 prompt 或 checkpoint。

消息与执行范围的绑定也是硬约束。`run_id` 与 `turn_id` 必须同时为空或同时有值，并且通过复合外键指向同一条 `agent_runs` 记录的 turn 与 session。来自 Input 的用户消息必须同时具备 `source_input_id`、非负的 `input_position` 和 `received_at`，角色必须是 `user`，并且外键指向该 Input 被消费时的 `consumed_run_id` 与 `turn_id`。`received_at` 保留接收时间，`created_at` 表示进入执行投影的时间，二者不能混用。`operation_id` 是同一 Run 内模型或工具的稳定来源键，与 `run_id`、`role` 一起构成部分唯一索引，保证重放不会生成第二条审计。`sequence` 保存 LangGraph 根 StreamMux 的事件顺序。`execution_status` 只允许 `running`、`completed`、`failed`、`interrupted`、`abandoned`。`duration_ms` 用本进程单调时钟计算操作耗时，`started_at` 与 `finished_at` 则是观察到的墙上时间，用途不同。`image_content` 用于多模态消息的内联图像；单条提交的张数和体积上限在前后端同时声明：前端 `multimodal_image_limits.js` 写明最多 10 张、base64 总量 80 MiB，并注明后端 `input_messages.py` 中的 `MAX_CHAT_IMAGES` 与 `MAX_CHAT_IMAGE_TOTAL_BYTES` 才是权威，前端只是发请求前的同值前置校验。这与生产 nginx 把会话创建和事件路径的请求体放到 100M 是同一条限制链上的不同层。

前端并不各自维护一份「另一种消息模型」。`ARCHITECTURE.md` 要求 `sessionRuntime` 按 Thread 拥有一份 item 状态，历史分页、SSE 与恢复快照写入同一个 reducer，展示按需派生。`sessionInput` 拥有冻结提交、幂等重试和接收交接；输入队列观察者确认 Input 已被消费并触发持久运行恢复；共享 runtime 根据当前 Turn 选择唯一的运行订阅。`ThreadTimeline` 按 `threadId` 激活共享的首次装载与运行恢复，并拥有消息展示、历史分页和滚动视口。`SessionWorkspace` 装配读取、输入与面板，编辑器草稿和附件仍走输入路径。视图存活期间的草稿分别保留，首次进入 Thread 时从持久草稿初始化。前端模块目录里还能看到与这条链路对应的具体文件：`useAgentRunStream.js`、`useAgentStreamHandler.js`、`useAgentThreadState.js`、`useAgentInputQueue.js`、`reconnectBackoff.js`、`threadMessageProjection.js`、`toolCallProjection.js`、`toolApproval.js` 以及协作、提及和交付物相关模块。它们都是投影和交互，不拥有终态。SSE 的 data 是事件本身，逻辑 `event_id` 与恢复 cursor 分开；断线后先退避重连，过期则从 PostgreSQL 快照恢复。二次开发若要改会话 UI，应扩展这些投影，而不是在页面里再开一条直接解析 Redis 的通道。

## 23. Skill 投影和 worker 任务注册

Skill 的当前完整内容由 PostgreSQL 目录引用拥有，但运行时文件必须出现在用户可访问的投影目录里，沙盒才能按标准路径读取。`modules/extensions/skills/projection.py` 把「授权变更」和「目录字节」分成可单独调用的步骤。共享编辑通过文件修订值拒绝过期保存；读取、运行快照与投影复制持有共享行锁；授权变更按「先共享行锁、再用户投影锁」的顺序提交并刷新投影。`commit_skill_policy_and_refresh_projections` 在同一业务事务的政策提交之后刷新受影响用户的投影；`invalidate_skill_projections` 在撤销权限时先撤下旧投影。`refresh_user_skill_projection_async` 按用户重建可访问集合。个人 Skill 不走这套共享投影，而由 `personal.py` 在 UserWorkspace 边界访问，沙盒把 `~/.agents/skills` 链到该目录。共享与内置 Skill 投影到只读的 `/home/user/skills`。内容读取与引用清理共用资源锁，当前或历史引用仍在使用的目录不能清理。这个设计让「改了一份共享 Skill」不会在运行中的任务里半截换成新正文——0.8 的修复说明也强调：正在运行的任务保留准备内容，新任务才使用编辑后的内容。二次开发如果直接向投影目录写文件，或在运行进程里改 Skill 正文而不走修订与锁，就会打破这套准备与撤销语义。

worker 进程的任务面比「执行智能体」更窄，也更明确。`workers/settings.py` 只登记两个 ARQ 函数：`process_agent_run` 和 `process_background_job`。前者的超时是 `RUN_TIMEOUT_SECONDS + 30` 秒，后者是后台作业缺省超时再加 30 秒；多出来的 30 秒明确留给清理与终态提交，因为业务时限由 runner 拥有。`RUN_TIMEOUT_SECONDS` 来自环境变量 `YUXI_JOB_TIMEOUT_SECONDS`，代码缺省 3600 秒。`MAX_RUN_TRIES = 2`。`retry_jobs` 为真，但前面已经说明：业务上不会把已经失败的 Run 自动再跑成一次新的成功路径，恢复扫描只补投尚未成功投递的同一个 pending Run。轮询间隔 `poll_delay = 0.05`，注释说明交互请求不应继承 ARQ 默认的 500 毫秒空闲等待。健康检查使用短 TTL 键，间隔受 `WORKER_HEALTH_INTERVAL_SECONDS` 约束，模板要求必须大于 0 且不超过 10 秒。定时任务方面，worker 每分钟整秒运行 `cleanup_expired_mcp_oauth_attempts`，并在启动时立刻跑一次；若知识能力开启，再在每分钟的第 15 与 45 秒以及启动时运行 `process_knowledge_projections`，用于推进投影 outbox。用户自建的定时 Agent 不是另注册一个 ARQ cron 表达式去直接跑模型，而是由 worker 在启动与周期逻辑中锁定到期任务，再复用统一的 Thread、Input、Turn、Run 用例，occurrence 只保留来源关联。`worker_max_jobs()` 在环境变量缺失时的代码缺省是 10；容量规划文档和 `.env.template` 注释则按单 worker、约 100 个同时运行的 AgentRun 建议把 `ARQ_MAX_JOBS` 设为 140。部署时必须显式给出这个值，不能假定代码缺省已经等于规划建议。

把消息约束、前端投影和 worker 注册放在一起，可以看到同一原则在三处重复出现：公开历史、界面状态和后台任务都只是对 PostgreSQL 事实的投影或投递，谁也不能单独成为权威。这是 Yuxi 作为二次开发基座时最需要守住的架构不变量，也是它能够把智能体、知识和沙盒收在一条主链里、却仍然保持可推理性的原因。


## 24. API 生命周期、预览链路和命令行客户端

API 进程的生命周期在 `api/lifespan.py` 中写得很短，但边界清楚。启动时 `app.state.startup_complete` 先置为假，然后调用 `bootstrap/api.py` 的 `startup`。该函数按组件逐项初始化，并区分必需与可选：PostgreSQL、Redis 以及运行目录一类组件失败会阻止启动完成；知识 MCP 的 manager 只有在知识能力开启且组件被装配后，才进入 `AsyncExitStack` 与进程同寿命运行。`startup` 任意阶段失败时，已经取得的资源仍会走补偿清理。退出时按名称关闭队列客户端、Neo4j 连接和 PostgreSQL 管理器，并把 `startup_complete` 重新置假。`/api/system/ready` 不会在启动未完成时报告就绪，这与「健康是进程存活、就绪是装配完成且 worker 租约可用」的探针分工一致。二次开发若向启动路径添加新的远端依赖，必须在这里声明它是必需还是可选，以及失败时如何清理，而不能在首个请求里懒连接却把错误吞掉。

文件预览是工作区和知识库共用的基础设施，但缓存分别由各域拥有。`infrastructure/file_preview.py` 根据路径和内容头判断预览类型，支持 Markdown 家族、PDF、HTML、一批文本与代码扩展名，以及常见图片。文本预览有 `MAX_TEXT_PREVIEW_CHARS = 250000` 的字符上限；有界读取的预算来自 `shared/files.py` 的 `MAX_FILE_PREVIEW_BYTES = 30 * 1024 * 1024`，各预览用例必须把预算传给文件或对象存储边界，而不能一次性读入整个对象。Office 预览是另一条独立转换：`office_conversion.py` 只把 `.docx` 和 `.pptx` 交给 LibreOffice 无界面转换，超时时限由 `OFFICE_PREVIEW_TIMEOUT_SECONDS` 给出，缺省 60 秒，非数字配置回退到该缺省。转换在独立临时目录和独立 LibreOffice profile 中进行，避免污染进程环境。`.xls` 或 `.xlsx` 并不走这条 PDF 预览转换，知识入库时它们另有解析路径。0.8 发行说明提到对话内 HTML Preview 和知识库思维导图等旧入口已经退出，但 HTML 文件预览和知识图谱浏览仍在。架构上这意味着「预览」是只读展示，不是又一条可以修改 Workdir 或知识库的写入通道。

命令行客户端位于 `packages/yuxi-cli`，包名为 `@xerrors/yuxi`，版本是 `0.1.0`，与平台包版本 `0.8.0` 并不相同。可执行入口是 `yuxi`，源码按 `cli.ts`、`client.ts`、`chat.ts`、`config.ts`、`sse.ts` 和 `types.ts` 组织，依赖 `commander`。它面向 Public v1 API：登录实例、在终端对话、发送附件和图片、查询知识库、查看 Thread。官方文档明确写出第一阶段不包含的能力：Agent 评估与 Langfuse Dataset 实验、知识库上传解析索引和管理、MCP/Skill/模型与系统配置管理，以及工具审批和等待点恢复。遇到等待点时，CLI 只提示转到网页继续，不在终端提交回答。旧 Python CLI 的配置不会自动导入。仓库中的源码不代表 npm 包已经发布。这些限制说明 CLI 是核心协议上的一个瘦客户端，不是第二套管理面，更不能用来判断平台是否「功能过多」——它故意少，正是为了把复杂交互留在 Web 与公开 API。`packages/agent-demo` 同样只演示公开 Agent API 的嵌入方式。对二次开发来说，外部系统应复制的是这条 Public v1 路径，而不是去包一层未文档化的内部路由。

把生命周期、预览和 CLI 纳入架构叙述，是为了补全「谁在什么时候进入核心闭环」。API 启动完成之前，任何客户端都不应被当成系统已可用；预览和转换不能破坏文件边界和读取预算；CLI 只能看见协议已经稳定对外的那一部分。核心闭环仍然是智能体运行时、默认开启的知识检索、多租户权限和沙盒工作区。外围客户端可以变瘦，内核不能因此被拆掉。至此，本树的系统边界、进程拓扑、数据归属、运行链路和扩展登记已经可以在源码中逐项核对。下文的功能文档会在同一事实基础上，按能力说明哪些是不可再瘦的功能内核，哪些只由 Compose profile 或配置叠加引入。


## 25. 能力开关的严格性、定时任务和导航投影

知识能力开关的读取本身也体现了「不要静默回退」的架构原则。`bootstrap/capabilities.py` 的 `knowledge_enabled()` 从环境变量 `YUXI_KNOWLEDGE_ENABLED` 取值，缺省按 `true` 理解，但只接受去掉空白并转小写后的 `true` 或 `false`；任何其它字符串都会在启动时抛出 `ValueError`，从而阻止 API 或 worker 带着含义不明的配置进入就绪。叠加文件 `docker-compose.no-knowledge.yml` 之所以要把该变量显式写成字符串 `"false"` 并同时把存储副本数降到 0，是为了让装配开关和实际进程拓扑保持一致。只改其中一个，会出现「路由已关闭但 Milvus 仍在跑」或「容器已停但进程仍去连接」的撕裂。非法值直接失败，而不是被当成开启或关闭，正是为了让这种撕裂在启动阶段暴露。

定时 Agent 没有另造一套执行器。`scheduled_agent_jobs` 属于用户自建定义：它绑定同一用户下的 `project_id`（复合外键要求项目与任务同属该 `uid`），记录目标 `agent_slug`、名称、提示词、可选 `model_spec`、`cron_expression` 和 `timezone`，并用 `next_run_at` 作为领取依据。`enabled` 与 `deleted_at` 控制是否仍被扫描。创建过程带有 `creation_request_id` 与 `creation_intent_hash`，同一用户下的创建请求 ID 唯一，便于幂等重试。`tool_approval_mode` 只允许 `default` 或 `always_trust`，与网页会话的审批模式对齐，而不是再发明第三套权限。到期后，worker 锁定任务并复用统一的 Thread、Input、Turn、Run 用例，`scheduled_agent_runs` 只保存这次触发与统一运行模型之间的来源关联。因此，定时并不是「在 cron 里直接调用模型」，而是「到点后向已有队列投入一条冻结配置的输入」。理解了这一点，就不会把调度模块误认为可以绕过租约、沙盒和知识权限的后门。

登录后的应用导航在 `frontend/src/app/layouts/AppLayout.vue` 中投影为有限几个入口：智能体会话（默认回到最近 Thread 或 `/agent`）、智能体管理 `/agent-manage`、工作区 `/workspace`、扩展中心 `/extensions`，以及仅超级管理员可见的 `/dashboard`。设置、模型供应商、网络搜索和 OCR 配置位于扩展或设置界面内部，并不各自占据一条顶级路由。这种导航密度与后端限界上下文是吻合的：用户日常工作发生在会话和工作区，定义和资源治理发生在智能体管理与扩展中心，运行审计发生在总览。前端没有为每一种可选集成再增加一级产品入口，这也从体验结构上支持「核心闭环集中、扩展靠登记」的判断。

以上补充并不改变前文结论，只是把开关校验、定时复用和导航投影这三处容易被忽略的边界写清楚。能力开关必须合法且与拓扑一致；定时任务必须回到同一条运行链路；界面入口必须映射已有的后端域。满足这三点，二次开发在增加场景时才不会在「方便」的名义下打开平行世界。


## 26. Project 目录模式与运行时虚拟路径

Workdir 是核心闭环里最具体的文件系统契约，值得单独对照表结构和路径常量来写清。`projects` 表以 UUID 为主键，并用 `(id, uid)` 复合唯一约束保证项目不能脱离其拥有者被引用，这与定时任务外键要求「项目与任务同属一用户」是同一条隔离规则。`workdir_path` 保存的是相对于 UserWorkspace 的路径，而不是宿主绝对路径。`directory_mode` 只允许 `managed` 或 `linked`：managed 由服务端创建，路径形态在架构说明中写为 `projects/YYYYMMDD/<六位标识>[-N]`；linked 绑定当前用户工作区内已经通过 no-follow 校验的既存目录。`selection_status` 只允许 `implicit` 或 `selectable`，隐式项目可以没有名称，用于尚未被用户显式挑选的工作目录。`status` 只有 `active` 与 `deleted`，删除为软删除。同一用户下可以用 `idempotency_key` 幂等创建项目，避免前端重试生成多个目录。多个 Project 可以共享同一 `workdir_path`，但每个 Thread 的 `project_id` 一旦写入就不可变。删除 Project 时，若仍有活跃 Turn 或待处理 Input，请求会被拒绝，然后再软删除项目并归档所属 Thread。这些规则把「对话」和「文件目录」的生命周期分开，又用外键把它们钉在同一个用户命名空间里。

运行时智能体看到的并不是 `workdir_path` 本身。`runtime_paths.py` 规定沙盒虚拟根为 `/home/user/workspace`，共享与内置 Skill 为只读的 `/home/user/skills`，个人 Skill 则是工作区下的 `/home/user/workspace/agents/skills`。工具结果中的大型输出、会话历史摘录和工具媒体分别落到 `large_tool_results`、`conversation_history` 和 `tool_media` 这些约定目录名下，它们属于内部文件，不作为交付物展示。路径规范化函数负责在 Viewer 的 scope 相对路径、Workdir 相对路径和 runtime 绝对路径之间转换，并判断一段字符串是否已经是 runtime 路径。前端预览、附件准备、Artifact 保存和协作成员访问都必须经过这组转换，最后由 `modules/workspace` 持有真实宿主 `Path` 做 no-follow 的文件操作。只要二次开发遵守这组常量，Container 与 Cube 可以替换执行后端而不改变模型提示词里的路径语义；一旦把宿主路径写进提示词或 API，两种沙盒和预览器都会同时失真。

到此，架构文档对 Yuxi 本树的系统边界已经按进程、包、表、运行链路、登记点和路径契约逐层对齐。功能层面的能力清单、可选开关和定制场景，在 `features.md` 中展开。


## 27. 能力发现与首次初始化

对外宣告「这套实例究竟打开了哪些能力」的入口是公开接口 `GET /api/system/discovery`，不要求登录。它返回固定名称 `Yuxi`、`api_prefix` 为 `/api`，以及由 `get_version()` 给出的版本字符串。版本来自已安装 Python 包 `yuxi` 的发行元数据，读取失败时退回字面量 `unknown`；在本树中该包于 `pyproject.toml` 声明为 `0.8.0`，因此发现接口在正常装配后应报告这一包版本，而不是 git 提交号或 git 标签名。能力段里的 `features.knowledge` 直接调用 `knowledge_enabled()`，与启动装配使用同一函数。面向 CLI 的能力清单同步翻转：`kb_list`、`kb_files`、`kb_query`、`kb_open`、`kb_find` 都随知识开关变化，而 `browser_login`、`api_key_auth`、`remote_config`、`agent_list`、`agent_show` 保持为真。`min_cli_version` 写死为 `0.1.0`，与 `packages/yuxi-cli` 的包版本一致。endpoints 段给出健康、就绪、当前用户、CLI 设备码会话以及浏览器授权页 `/auth/cli/authorize` 的路径。命令行在登录前先做 discovery，就是为了在关闭知识的部署上不要假装本地还有知识子命令，也避免旧客户端去猜已经取消的内部路径。

实例在没有超级管理员时处于首次运行状态，由 `GET /api/auth/check-first-run` 查询，并由 `POST /api/auth/initialize` 在 advisory lock 下创建首位超级管理员。此前 discovery 已经可用，但业务会话和知识入库都还没有可授权的人类主体。初始化只发生一次，锁的存在是为了防止并发把空实例写成两个互不相认的超管。这个「先发现能力，再初始化身份，再进入核心闭环」的顺序，是私有部署开机过程在架构上的最后一段，也是所有二次开发集成首先应该探测的边界：先读 discovery 和 ready，再决定展示哪些功能、以及能否开始创建会话。


需要强调的是，discovery 报告知识能力关闭，并不表示数据库里的知识表或 MinIO 对象已经被删除，只表示当前进程拒绝装配相关路由与作业。CLI 或外部客户端若缓存了上一次为真的能力清单，必须在每次连接时重新探测，否则会在已经叠加 `docker-compose.no-knowledge.yml` 并重建 API 之后，仍然去调用已经不再挂载的知识工具路径。版本字段同样不能用来判断是否可以直接升级旧库：它只反映当前安装的包元数据，Schema 是否匹配要靠 `app-init` 写入的 business 与 knowledge 域版本来决定。把发现接口、就绪探针和 Schema 版本当成三个不同问题来对待，是运维和二次开发共用的最小架构纪律。


首次初始化完成之后，发现接口的字段集合本身不会增加新的顶级产品线；要让客户端看见新能力，仍然应该扩展 `capabilities` 中已有的明确开关，而不是让调用方去探测未文档化的内部路由是否返回 404。

这一纪律保证能力面始终是可发现的，而不是靠试错得来的。
