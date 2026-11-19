# WeKnora 0.9.0 系统架构

本文对照本机检出的上游仓库写成。源码树对应 Git 提交 `81a03046bed16504d249bb22591492966fc9c9b9`（短哈希 `81a0304`），提交说明为合并 `fix/lite-kb-clone-move-progress`，提交时间换算为 2026-11-18 20:55（Asia/Shanghai）。仓库根目录 `VERSION` 文件内容为 `0.9.0`。下文引用的路径均相对于该源码树，例如 `internal/types/model.go`、`docker-compose.yml`，不把上游源码写入分析仓库。本文不是部署步骤，也不是功能规格；同目录已有的 `analysis.md`、`pipeline.md`、`weknora-steps.md` 仍保留作部署与链路备忘，功能面由 `features.md` 展开。文中所有行为判断均以该提交的源码、编排文件和仓库内官方文档 `website-docs/` 为依据，不把未启动的运行时现象写成已验证结论。

WeKnora 的产品形状本身就带有明显的“企业套件”特征：默认只需五个核心进程就能完成文档入库和检索问答，同时又在同一套主服务里挂上大量可替换引擎、可选基础设施、多入口客户端和按知识库开关的后处理管线。这种广度会反映到包结构、配置分类、路由分组和异步队列拓扑上。下面按系统边界、进程拓扑、后端分层、数据模型、控制流、存储与模型抽象、接口形状、扩展点、并发与安全边界来说明，并在能用文件证据核验的地方指出“看起来可选、实际在某条路径上被写死或被耦合”的情况。

## 一、它是什么，以及运行时如何切分

WeKnora（维娜拉）是腾讯开源的知识库问答系统。仓库内官方介绍 `website-docs/01-getting-started/01-introduction.md` 把它定义为面向私有化部署的检索增强生成（RAG）产品：先把 PDF、Office、网页以及飞书、Notion、Confluence、语雀等来源的资料解析并建立索引，再在会话里根据问题检索相关片段，由大模型生成带引用的回答。v0.9.0 在同一套引擎上又叠加了内置助手、多智能体协作、自动化调度和有范围的执行授权，这些能力走 Agent 运行时，而不是另起一套互不相通的产品。Go 模块路径为 `github.com/Tencent/WeKnora`，`go.mod` 声明语言版本为 `go 1.26.0`。

运行时按语言和进程切成三块核心，外加两个基础设施依赖：

第一块是 Go 主服务 `app`。入口在 `cmd/server/`（`main.go`、`bootstrap.go`、`listen.go` 以及按操作系统拆分的信号处理）。该进程同时承担 REST/SSE API、鉴权与 RBAC、知识库与会话业务、检索引擎装配、Agent 引擎、进程内 Asynq worker、内置 MCP 端点、IM/Embed 渠道接入。健康检查是 `GET /health`。换言之，后台任务执行器默认与 API 进程同驻，而不是必须再部署一套独立的 worker 集群。这降低了标准 Compose 的运维面，也意味着水平和垂直扩展时要把 API 流量与队列消费放在同一扩容单元里考虑。

第二块是 Vue 3 前端。源码在 `frontend/`，生产镜像 `wechatopenai/weknora-ui` 用 Nginx 托管静态产物，并把 `/api` 反向代理到 `app`。默认对外端口由 `FRONTEND_PORT` 决定，缺省为 80。前端本身几乎不持有业务状态，知识库、模型、会话、成员关系都以后端为权威。Lite 模式下若 `handler.Edition == "lite"`，静态资源可由 Go 进程直接托管，不再依赖独立的 frontend 容器。

第三块是 Python 文档解析微服务 `docreader`。源码在 `docreader/`，入口为 `main.py`，通过 gRPC 对外提供解析，默认只在 Compose 网络内暴露 `50051`，不映射到宿主机。它负责把文件或 URL 转成可供分块的文本（通常是 Markdown）以及抽取图片，并包含 OCR、版式分析和多种解析器。`app` 并不在 Go 进程内直接解析 PDF 或 DOCX，而是把字节或地址交给 `docreader`，再通过共享卷传递解析出的图片。

基础设施方面，标准编排默认使用 ParadeDB 发行版的 PostgreSQL 17（镜像 `paradedb/paradedb:v0.25.11-pg17`）保存业务数据，并利用其自带的 BM25 与向量能力作为默认检索引擎；Redis（`redis:7.0-alpine`）承担 Asynq 队列、跨实例 SSE 流管理、系统设置发布订阅、限流和模型并发闸门。知识图谱、对象存储、独立向量库、联网搜索、可观测栈、测试用 OIDC、混合 PDF 解析后端都不是这条最小路径的必要条件。

与上述核心相对，仓库里还有一批“同树但不同进程或不同发行形态”的配套：`cli/` 是独立 Go 模块的命令行客户端；`client/` 是 Go SDK；`mcp-server/` 是已弃用的独立 Python MCP 服务；`miniprogram/` 是微信小程序；`cmd/desktop` 是基于 Wails v2 的桌面包装，文档写明尚未作为正式发布形态；`helm/` 提供 Kubernetes Chart。这些配套共享同一套 HTTP API 语义，但不改变 `app` 作为业务权威的地位。

## 二、官方运行时拓扑以及进程之间如何通信

不带 Compose profile 时，`docker-compose.yml` 启动的核心服务是 `frontend`、`app`、`docreader`、`postgres`、`redis`。`sandbox` 镜像在标准路径里主要用于按需创建的 Agent Skills 运行环境，`full` profile 会把它列入编排，但“非常驻、按会话创建”的语义仍由沙箱后端决定，不能把它理解成与 `app` 对等的常驻业务进程。`app` 与 `docreader` 之间除 gRPC 外，还共享卷 `docreader-tmp`（容器内 `/tmp/docreader`）传递解析产物图片；`app` 的本地文件存储卷是 `data-files`（`/data/files`）。Postgres 与 Redis 在标准编排中不向宿主机映射端口，只在 Compose 网络内供 `app` 访问。

浏览器访问路径是：用户打开 `frontend` 的 Nginx，页面静态资源由 Nginx 直接提供，接口请求走 `/api` 反代到 `app` 的 `8080`。SDK、CLI 或开放 API 也可以直连 `app`，用 JWT 或 `X-API-Key` 认证。MCP 客户端（例如 Claude、Cursor）在新部署中应访问 `app` 内置的 MCP 端点（路由分组在 `internal/router/routes_mcp_endpoint.go`），而不是再启动 `mcp-server` 容器。官方介绍明确写了：`mcp-server/` 加 profile `full` 暴露的 `8082` 是旧版独立 MCP Server，新部署改用应用内置端点。这是一处已经在文档和源码注释里标明的历史重叠，而不是两套并行推荐的接入方式。

`app` 调用 `docreader` 的地址由 `DOCREADER_ADDR` 配置，传输方式由 `DOCREADER_TRANSPORT` 决定，默认是容器网络内的 gRPC。双方还可以启用 gRPC TLS、可选的双向证书以及 `GRPC_AUTH_TOKEN`。解析超时、文件大小上限、预处理线程与内存限制分散在一批 `DOCREADER_*` 与 `WEKNORA_DOCREADER_CALL_TIMEOUT` 环境变量中，说明解析被当作可独立扩容、可独立失败的下游，而不是嵌入 Go 二进制的库调用。

模型推理不在 Compose 默认拓扑里占一个固定容器。对话、嵌入、重排、视觉、语音都可以指向本机 Ollama（默认 `OLLAMA_BASE_URL` 指向 `host.docker.internal:11434`）或任意已实现协议的远程接口。`OLLAMA_OPTIONAL=true` 时，Ollama 不可达只告警，不阻断 `app` 启动。也就是说，模型进程在架构上是外部依赖，主服务只保存模型配置、凭证和调用适配。

可选组件通过 `docker compose --profile <name>` 叠加，`full` 会带上标注了该 profile 的一组服务。`neo4j` profile 提供 `neo4j:2025.10.1`，Bolt 端口 `7687`，并预装图谱写入所需的 APOC；要真正启用，还必须把 `NEO4J_ENABLE` 设为 `true`。`minio` 提供 S3 兼容对象存储。`qdrant`、`milvus`、`weaviate` 各自提供独立向量库，`doris` 提供 Apache Doris 4.1 的 FE/BE。`searxng` 提供自建元搜索，默认绑定回环 `8888`。`langfuse` 拉起一套独立的可观测栈（Web、Worker、ClickHouse、专用 MinIO 以及库初始化），复用主 Postgres 实例中的独立库和 Redis 的另一个逻辑库。`dex` 是测试用 OIDC 身份提供方。`odl-hybrid` 是需要本地构建的 OpenDataLoader/Docling 混合解析后端，`docreader` 通过 HTTP 调用它。Elasticsearch、OpenSearch、腾讯云 VectorDB 以及云厂商对象存储不在 Compose 内提供容器，但 Go 后端可以按环境变量或库内配置的 `vector_stores` / `storage_backends` 直连。

开发编排 `docker-compose.dev.yml` 会把 Postgres（5432）、Redis（6379）、docreader（50051）映射到宿主机，便于在宿主机上 `go run` 和启动 Vite 开发服务器。这改变的是进程落点，不是模块边界：业务权威仍然是同一套 `internal/` 代码。Lite 形态把 `DB_DRIVER` 设为 `sqlite`，并在不配置 `REDIS_ADDR` 时把 Asynq 退化为进程内 `SyncTaskExecutor`，用同一二进制覆盖“无外部 Postgres/Redis”的场景。桌面版在 Lite 存储模型之上再包一层 Wails，本机操作系统沙箱目前文档写明仅 macOS（Seatbelt）。Helm Chart 把同样的服务切分成 Kubernetes 资源，不引入第三套领域模型。

这些形态共享同一套配置键和同一套迁移思想，但失败域不同。标准 Compose 把解析、数据库、队列、前端和 API 拆开，单一服务崩溃不必让全部能力一起消失；Lite 把失败域收拢到一个进程和一组本地文件，换来的是运维简单和功能裁剪（例如没有独立 Redis 时的跨实例流管理）。架构阅读时应先分清“默认五个容器的标准形态”和“同一代码树支持的收缩或扩张形态”，避免把可选引擎写成默认运行时的一部分。

## 三、后端分层、包结构与依赖方向

Go 后端遵循 Handler、Service、Repository、基础设施的分层，层间用 `internal/types/interfaces/` 中的接口解耦，启动时由 `go.uber.org/dig` 在 `internal/container/container.go` 里装配。`website-docs/02-architecture/02-backend-design.md` 把这条依赖方向写得很明确，源码也与之相符：Handler 不直接操作 GORM，Service 不解析 HTTP 请求，Repository 不编排跨资源的业务规则。

路由与中间件位于 `internal/router/` 和 `internal/middleware/`。`router.go` 创建 Gin 引擎、挂载健康检查和 `/api/v1` 分组，再把领域路由拆到 `routes_auth_tenant.go`、`routes_knowledge.go`、`routes_chat.go`、`routes_agent.go`、`routes_infra.go`、`routes_memory.go`、`routes_automation.go`、`routes_graph.go`、`routes_mcp_endpoint.go` 以及文件访问用的 `files.go`。这种拆分已经反映出产品的限界上下文：认证与空间、知识与分块、会话与问答、智能体与渠道、基础设施（模型、向量库、存储、数据源、MCP 客户端、沙箱）、记忆、自动化、图谱只读查询、对外 MCP 端点，各自成组。RBAC 守卫集中在 `router/rbac.go`，API Key 能力策略与角色守卫正交注册，未登记策略的路由对 API Key 主体默认拒绝。

Handler 层在 `internal/handler/`，会话相关再下沉到 `internal/handler/session/`，请求 DTO 在 `internal/handler/dto/`。Handler 负责参数校验、调用 Service、写 JSON 或 SSE，本身不应包含入库状态机或检索融合算法。访问控制的非 HTTP 部分被抽到 `internal/application/access/`，处理知识库三层访问（自有库、组织共享库、共享智能体可见库）、文件与消息产物授权、跨库克隆和移动的许可。把授权规则从 Gin 中间件再抽一层，是为了让 Service 和异步任务在没有 HTTP 上下文时也能复用同一套许可判断。

Service 层在 `internal/application/service/`，文件数量已经超过普通单体应用的“一个领域一个文件”规模。知识库、知识对象、分块、会话问答、Agent、数据源同步、Wiki 摄入、FAQ、模型目录、租户与配额、沙箱技能、记忆、自动化、审计都在这里编排。检索问答的事件插件在子目录 `chat_pipeline/`。Service 通过 `TaskEnqueuer` 把耗时工作送进 Asynq 或 Lite 下的同步执行器，从而让 HTTP 请求在入库场景里尽早返回。

Repository 层在 `internal/application/repository/`，统一使用 GORM 访问 PostgreSQL 或 SQLite。检索引擎的实现按引擎分包于 `repository/retriever/` 下的 `postgres`、`elasticsearch`、`qdrant`、`milvus`、`weaviate`、`doris`、`opensearch`、`tencentvectordb`、`sqlite`、`neo4j`。业务表与向量/关键词索引因此被刻意分开：知识库行、分块文本、会话消息仍在主库；向量检索可以落在主库的 pgvector/ParadeDB 中，也可以落到外部引擎。Neo4j 仓储实现的是图谱节点与关系，而不是普通分块向量。

领域类型集中在 `internal/types/`。这里既有 GORM 实体（`KnowledgeBase`、`Knowledge`、`Chunk`、`Session`、`Message`、`Tenant`、`User` 等），也有枚举、上下文键、检索请求结构和任务载荷。把枚举和接口放在同一棵包下，避免 Service 与 Repository 互相引用具体实现，但也使 `types` 成为全仓最宽的依赖汇聚点。阅读架构时，判断一个概念是否“一等公民”，优先看它是否在 `types` 里拥有稳定的类型和状态机，而不是只看前端页面是否存在。

基础设施适配分散在多个包：`internal/infrastructure/docparser` 是 docreader 的客户端；`internal/infrastructure/chunker` 是分块策略；`internal/infrastructure/web_search` 与 `web_fetch` 负责联网搜索和抓取；`internal/models/` 按对话、嵌入、重排、视觉、语音分子包，并在 `models/api/` 下为不同线协议建立客户端；`internal/stream/` 管理 SSE；`internal/sandbox/` 管理技能执行环境；`internal/mcp/` 与 `internal/mcpserver/` 分别处理作为 MCP 客户端和作为 MCP 服务端的角色；`internal/im/` 按即时通讯平台分子包；`internal/agent/` 实现 ReAct 式智能体循环、策略与授权。`internal/database/` 负责迁移，`internal/config/` 与根目录 `config/config.yaml` 提供运行配置，`internal/tracing/` 对接 OpenTelemetry 与 Langfuse。

依赖方向可以概括为：路由和中间件依赖于 Handler 与鉴权接口；Handler 依赖于 Service 接口；Service 依赖于 Repository 接口、模型接口、文档解析客户端、任务入队接口和其他 Service 接口；Repository 依赖于 GORM 或外部引擎驱动；`types` 被各层引用，但不反向依赖 Handler。`container.go` 里对检索引擎、数据源连接器、Neo4j 驱动的条件装配，属于“启动期选择实现”，不应把未注册的引擎当成运行中一定会出现的协作进程。

还有一批辅助包说明产品边界已经被拉得很宽：`internal/automation` 与 Service 中的调度器对应；`internal/browserskill` 支持本机浏览器技能；`internal/credential` 与凭证保险库对应；`internal/embedpolicy` 约束嵌入聊天的来源；`internal/ratelimit` 做限流；`internal/localsandbox` 服务桌面或本机沙箱。它们都挂在主进程里，通过配置或部署能力接口决定是否真正工作。这种“代码常驻、运行可选”的模式，是 WeKnora 用单一后端覆盖多种企业场景的主要手段，也是复杂度和测试矩阵上升的主要来源。

## 四、领域数据模型

数据模型的根是租户（工作空间）。`tenants` 表从序号 10000 起分配整型主键，保存名称、检索引擎配置、状态、存储配额与已用量，以及大量 JSONB 配置列：智能体、上下文、会话、联网搜索、凭证、API 主体、记忆和默认设置。一个登录用户（`users`，UUID 主键）可以加入多个租户。成员关系在 `tenant_members` 中，角色枚举定义于 `internal/types/tenant_member.go`：`owner`、`admin`、`contributor`、`viewer`，级别分别为 40、30、20、10，用 `HasPermission` 做包含判断。邀请与邀请链接在 `tenant_invitations`，API 密钥在 `tenant_api_keys`，并区分租户作用域与平台作用域。用户还可以置顶知识库（`user_kb_pins`）和收藏资源（`user_resource_favorites`）。系统级设置在 `system_settings`，审计在 `audit_logs`。跨租户协作另有组织（Organization）相关表，用于在多个工作空间之间共享知识库和智能体。

知识库（`knowledge_bases`）是资料组织的基本单位。它绑定该库使用的模型、分块配置、索引策略、解析引擎规则、图谱抽取配置、多模态与语音配置，以及与向量库、存储后端的关联。`internal/types/indexing_strategy.go` 把索引策略拆成四个互相独立的布尔开关：`VectorEnabled`、`KeywordEnabled`、`WikiEnabled`、`GraphEnabled`。默认策略与“历史行为”对齐：向量和关键词开启，Wiki 与图谱关闭。`NeedsChunks` 在四种管线任一开启时为真；`NeedsEmbedding` 在向量或关键词开启时为真。后一点值得单独记下：类型层注释写明“目前只有向量和关键词检索需要嵌入模型”，因此即便运维直觉上认为 BM25 只需全文索引，知识库只要打开了 `KeywordEnabled`，`NeedsEmbeddingModel()` 仍会要求配置嵌入模型。这是“看起来可以只开关键词、实际上类型契约仍绑定嵌入”的一处硬耦合，是否在所有引擎实现里都真正调用嵌入，要以索引写入路径为准，但配置与创建知识库时的前置校验会按这个契约工作。

知识对象（`knowledges`）表示一条进入某个知识库的资料。类型常量目前在 `internal/types/knowledge.go` 里明确写出的有 `manual` 与 `faq`；文件、URL、数据源同步进来的对象则以文件类型、来源通道等字段区分，而不是再枚举一套互斥的“文件知识”常量。来源通道常量覆盖 Web、API、浏览器扩展、微信、企业微信、飞书、飞书云盘、Lark Drive、钉钉、Slack、通用 IM、Notion、Confluence、语雀、RSS、腾讯 IMA、Seafile、Nextcloud。这些通道值与数据源连接器和 IM 适配器对应，说明“同一种资料”可以从人工上传、连接器同步或聊天投递进入，入库后仍汇聚为同一类知识行。解析状态机是 `pending`、`processing`、`finalizing`、`completed`、`failed`、`deleting`、`cancelled`。`finalizing` 表示主解析、分块和索引已经完成，文档已可被向量/关键词检索，但摘要、问题生成、图谱抽取等富化子任务尚未全部结束；`pending_subtasks_count` 记录未完成子任务，最后一个子任务结束时原子地把行提升为 `completed`。`cancelled` 与 `deleting` 对在途任务采取类似的短路语义，但取消会保留已写入的行和分块，以便重新解析；删除则进入清理链路。摘要另有独立状态：`none`、`pending`、`processing`、`completed`、`failed`。

分块（`chunks`）是检索的基本粒度。知识库可启用父子分块：父块较大，用于提供上下文；子块较小，用于嵌入和召回。块还可以挂图片信息、生成问题、修订历史（`chunk_revisions`）以及 `chunk_images` 投影。知识库标签、文件夹、跨库移动与克隆、自动标签、知识库画像（profile）都是围绕知识对象和分块的附加结构，而不是另一套互不相干的存储。

会话与消息构成问答侧的数据模型。普通会话的 `kind` 为空；助手会话使用 `SessionKindAssistant`（值为 `assistant`），协作中的委派子会话使用 `SessionKindAgentDelegated`，后者不作为普通聊天列表的正式 API 种类开放。消息保存提问、回答、引用、附件、产物（artifacts）和建议问题。会话还可以附着临时文档、沙箱终端或桌面票据、转向（steer）指令和后台工作项。长期记忆有独立的设置、条目、主题和文档表，抽取任务按会话轮次防抖后异步执行，不把记忆写成普通聊天历史的别名。

当知识图谱启用时，实体和关系并不写入 Postgres 主库作为权威图存储，而是写入 Neo4j。`internal/types/graph.go` 定义 `GraphNode`（名称、关联分块、属性）和 `GraphRelation`（两端节点与关系类型）。命名空间 `NameSpace` 用知识库 ID 和知识 ID 生成标签，仓储层再加上 `ENTITY` 前缀并把连字符替换为下划线，从而按库、按文档隔离图数据。公开的图查询会把字段长度和返回行数截断，避免一次模糊实体名把整图拉回。Postgres 侧保存的是“该库是否启用图谱、抽取配置是什么、处理跨度里图谱任务是否完成”，而不是节点本身。

模型配置在 `models` 表，按租户隔离，类型为下文将详细说明的五类，来源与参数以 JSONB 保存，并可标记默认、内置或托管方式。向量库配置可以来自环境变量 `RETRIEVE_DRIVER` 的虚拟存储，也可以来自库表 `vector_stores` 的动态装配。对象存储后端在 `storage_backends`，统一资源登记在 `resources`，再用 `resource_bindings` 把文件绑定到知识、消息或会话，用 `resource_access_grants` 发放临时访问令牌。任务侧有 `task_pending_ops` 与 `task_dead_letters`，文档处理还有 `knowledge_processing_spans` 记录各阶段耗时与错误。这些表把“文件在哪、任务走到哪、哪次尝试失败”从知识行里拆出来，是为了支持对象存储替换、任务巡检和按阶段展示进度。

还需要标明一处遗留：`migrations/mysql/00-init-db.sql` 只包含约十张核心表的一次性建表脚本，官方数据库文档写明没有任何 Go 代码在启动流程中引用它，`go.mod` 里的 MySQL 驱动是给 Doris 检索引擎（MySQL 协议）使用的。因此不能把 MySQL 写成与 Postgres、SQLite 并列的主库选项。主库选择只有 `DB_DRIVER=postgres`（含原生 PostgreSQL 加 pgvector，以及官方默认的 ParadeDB）和 `DB_DRIVER=sqlite`（Lite）。

## 五、文档入库在进程之间的控制流

入库是异步管道，HTTP 只负责鉴权、去重、落盘和入队。路由在 `internal/router/routes_knowledge.go`：向某个知识库提交文件、URL 或手工文本的接口分别是 `POST /knowledge-bases/:id/knowledge/file`、`/url`、`/manual`。守卫要求对库有写权限（`OwnedKBOrAdmin` 与 `KBAccessWrite`）。创建逻辑在 Service 的 `knowledge_create.go`：计算文件哈希做去重，经文件服务写入当前存储后端，插入 `parse_status=pending` 的知识行，再向 Asynq 投递 `TypeDocumentProcess`（值为 `document:process`）。接口按设计尽早返回知识 ID，前端再轮询阶段信息、处理跨度或订阅进度。重新解析、批量重解析、取消解析是同一状态机上的另外几个入口，而不是另写一套解析器。

Worker 领取任务后，主路径在 `knowledge_process.go`。首先把文件字节或 URL 交给 `docreader`。音频会先走 ASR 转写，再进入文本管线。解析产物中的图片由 ImageResolver 上传到存储后端，并回写引用。随后按知识库或单次上传覆盖后的 `EffectiveProcessConfig` 分块。分块实现位于 `internal/infrastructure/chunker/`，策略取值包括 `auto`、`heading`、`heuristic`、`recursive`、`legacy`；还可启用父子分块，并按字符或近似 token 限制块大小，语言提示可显式指定或从文本检测。`ResolveProcessConfig` 允许单次上传覆盖分块、多模态、VLM、ASR、问题生成、图谱开关与抽取配置、解析引擎规则；约束之一是 `eff.GraphEnabled = eff.GraphEnabled && eff.ExtractConfig.Enabled`，即图谱必须同时有索引策略开关和有效抽取配置。覆盖配置会持久化在知识行上，重新解析时沿用。上传图片却未配置 VLM、上传音频却未配置 ASR、多模态所需对象存储不完整时，会在入队前被拒绝，而不是等到 Worker 中段失败。

分块写入 Postgres 之后，进入批量嵌入和索引。默认 `RETRIEVE_DRIVER=postgres` 时，向量和关键词都写到 ParadeDB；若注册了其他引擎，则按知识库或租户关联的存储组写入对应仓储。`IndexingStrategy` 决定这次写入走哪些管线：只开 Wiki 或图谱时仍需要分块，但不一定走向量索引；开了向量或关键词则走嵌入与相应索引。核心索引完成后，主状态可以从 `processing` 进入 `finalizing`，并向其他队列投递富化任务：`TypeImageMultimodal`（图片 OCR 与视觉描述）、`TypeSummaryGeneration`、`TypeDataTableSummary`、`TypeQuestionGeneration`、`TypeChunkExtract`（按分块抽取图谱）、`TypeWikiIngest`、`TypeKnowledgeAutoTag`、`TypeKnowledgeBaseProfile`。没有富化任务时，可以直接到 `completed`。子任务完成时通过 `FinalizeSubtask` 一类的原子递减，避免多个 Worker 同时把状态写乱。

除文件、URL、手工文本外，还有几条会维护分块和索引、但不一定完整走文档解析的入口。FAQ 导入走 `TypeFAQImport`；知识库复制走 `TypeKBClone`；知识移动走 `TypeKnowledgeMove`；手工知识更新走 `TypeManualProcess`（先清理再重新索引）；数据源同步走 `TypeDataSourceSync`，由连接器拉取外部变更后再落入知识对象。会话里的临时附件走 `TypeTemporaryDocumentProcess`，队列与知识库批量导入隔离，以免交互上传被大批量任务堵住。删除、批量删除和索引删除有单独的维护队列任务，并与 `ParseStatusDeleting` 互斥，防止异步解析与删除互相覆盖。

处理配置和进度是可观察的。`knowledge_processing_spans` 按知识 ID、attempt、span 记录 DocReader、分块、嵌入等阶段。重新解析会分配新的 attempt；属于旧 attempt 的任务必须跳过写行、删块或扣计数，避免两轮处理交错。官方入库文档还写明：上一轮仍在 `pending`、`processing` 或 `finalizing` 时，先取消排队中的任务并通知运行中的任务停止。Housekeeping 负责巡检卡住的作业。这些机制说明入库被设计成可在多实例 Worker 下安全重试的状态机，而不是单线程脚本。

解析器本身也可选。`docreader/parser/` 包含 PDF、DOCX、Excel、HTML、EPUB、Markdown、图片、网页、XMind、MHTML 以及 OpenDataLoader 等解析器，并由 registry 按类型分发。知识库的 `ParserEngineRules` 可以为不同文件类型指定引擎，从而在默认解析、OpenDataLoader 混合、以及文档中提到的 MinerU、PaddleOCR、WeKnora Cloud 等路径之间切换。`odl-hybrid` profile 只在规则真正指向该引擎时才进入数据路径。图片处理还可在 `default` 与 `smartocr` 管线之间选择，任务提交时会保存本轮管线配置，后续修改知识库默认值不会把已经入队的任务切到另一条管线。这与“配置可热更新”并不矛盾：热更新影响的是尚未提交的新任务。


## 六、检索与生成控制流

问答不走入库那条 Asynq 管道，而是在 `app` 进程内用事件插件链同步（对单次请求而言）推进，并通过 SSE 把中间事件和最终答案推给客户端。主入口在 `internal/router/routes_chat.go`：`POST /knowledge-chat/:session_id` 做知识库问答，`POST /agent-chat/:session_id` 做智能体对话，另有断线续传 `GET /sessions/continue-stream/:session_id` 和停止生成 `POST /sessions/:session_id/stop`。嵌入渠道和 IM 渠道会复用同一套会话与流式生成能力，但认证主体和可见知识范围不同。Agent 路径在检索之外还会进入 `internal/agent/` 的工具循环，不应把两条路径理解成完全相同的插件列表。

知识问答的管线并不是只会执行 `types.Pipeline["rag_stream"]` 里那组写死的事件。`internal/types/chat_manage.go` 确实保留了一份名为 `Pipeline` 的便利表，包含 `chat`、`chat_stream`、`chat_history_stream`、`rag`、`rag_stream` 等固定序列，并有历史拼写别名 `Pipline`。真正的知识问答入口在 `internal/application/service/session_knowledge_qa.go` 里用 `PipelineBuilder` 按请求动态装配。判断依据是：是否存在知识检索范围（知识库 ID、知识 ID，或由标签提及解析出的 `SearchTargets`），以及是否启用联网搜索。两者皆无则视为纯聊天：在需要时拼接图片描述、引用上下文和附件提示后，只执行可选的历史加载、长期记忆召回和流式生成。只要有知识范围或联网搜索，则装配完整 RAG 序列。这里有一处实现上的细致处理：仅使用标签提及时，原始知识库 ID 切片可能为空，但 `SearchTargets` 仍有值；若不把统一后的检索目标纳入判断，请求会被错误降级为纯聊天。

动态 RAG 序列的默认骨架是：可选 `LOAD_HISTORY`，必有 `MEMORY_RECALL` 与 `QUERY_UNDERSTAND`，然后 `CHUNK_SEARCH_PARALLEL`、`CHUNK_RERANK`，在联网搜索开启时插入 `WEB_FETCH`，再 `CHUNK_MERGE`、`FILTER_TOP_K`，在数据分析开启时插入 `DATA_ANALYSIS`，最后 `INTO_CHAT_MESSAGE` 与 `CHAT_COMPLETION_STREAM`。插件在 `internal/container/container.go` 启动时注册到同一个 `EventManager` 上，包括检索、重排、网页抓取、融合、数据分析、消息组装、流式与非流式补全、截断 Top-K、查询理解、加载历史、记忆召回、实体抽取、实体检索、并行检索、Wiki 加权和记忆亲和。事件管理器按插件声明的激活事件组装责任链，后注册的处理器被包在先注册的外层还是内层，由 `buildHandler` 反向包裹实现，调用方只需 `Trigger` 一组有序事件。

查询理解阶段会做改写、意图判断，并在需要时抽取图谱实体。若意图判定不需要检索（例如闲聊），`ChatManage.NeedsRetrieval()` 为假，`PluginSearchParallel` 会直接跳过检索并进入后续阶段，避免无意义的向量查询。并行检索插件在需要检索时同时启动分块检索和实体检索：分块检索走知识库混合检索（默认向量加 BM25，可按配置与已注册引擎变化），并可以叠加联网搜索；实体检索只有在查询理解已经抽出实体时才真正调用图谱仓储，没有实体就跳过。两边结果合并后去重。图谱未启用、Neo4j 驱动为空或未抽出实体时，实体支路不会贡献结果，分块检索仍然可以独立成功。这是图谱“可拔掉”的关键：并行检索把图查询设计成附加来源，而不是检索总闸门。

重排、融合与截断是检索和生成之间的缓冲层。`CHUNK_RERANK` 在配置了重排模型且总开关允许时，用 `ModelTypeRerank` 对召回片段重新打分；未配置重排模型时，这条插件不应成为整条问答的硬失败点，具体降级行为以插件实现为准，但产品配置把重排明确标为可选。融合阶段处理重叠、父子块还原、FAQ 合并、历史与记忆片段以及 Wiki 加权等逻辑，分别落在 `merge.go` 及同目录的专用文件里。`FILTER_TOP_K` 按会话或知识库的配额截断上下文。`DATA_ANALYSIS` 在启用时可用 DuckDB 对表格类结果做分析，这是面向表格知识的附加阶段，不是所有知识库的必经步骤。`INTO_CHAT_MESSAGE` 把截断后的上下文、引用、附件说明写入提示词。引用会先于完整答案推给客户端，以便界面尽早展示依据。

流式生成由 `CHAT_COMPLETION_STREAM` 调用对话模型（`ModelTypeKnowledgeQA`）。输出经过每请求的事件总线和 `StreamManager`，以 SSE 事件发送思考过程、答案增量、完成标记以及停止信号。`STREAM_MANAGER_TYPE` 与 Redis 配置决定流状态如何在多实例之间共享；Lite 且无 Redis 时，流管理退化为单进程能力。会话还可以 fork、rewind、在生成过程中注入 steer，这些是会话状态机上的附加操作，不改变检索插件的基本顺序，但会改变一次生成所读取的历史截点和运行中控制面。

还存在一条不经过完整聊天管线的检索 API：知识库的 hybrid-search 路由（`POST` 或 `GET /knowledge-bases/:id/hybrid-search`）只做检索和融合，不调用对话模型生成答案。它与问答管线共享知识库检索实现，供前端调试、开放 API 和 Agent 工具使用。把“检索”和“生成”拆开，是为了让同一套索引服务多种交互，而不是强迫所有调用都打一条 SSE 问答。Agent 路径则会在工具循环中按需调用 `search_knowledge`、`read_document`、Wiki 导航或数据分析工具，其系统提示、工具白名单和知识库能力过滤来自自定义智能体配置或 `config/agent_type_presets.yaml` 中的预设。预设与内置智能体（`config/builtin_agents.yaml`）是另一层可选装配：它们不新增检索引擎，只是把已有能力组合成面向不同场景的默认智能体。

## 七、知识图谱在架构上如何插入

知识图谱是可选增强，不是默认运行时的一部分。要让它真正工作，必须同时满足部署级和知识库级两道开关，并且抽取配置有效。

部署级开关是环境变量 `NEO4J_ENABLE`。`internal/container/container.go` 的 `initNeo4jClient` 在该变量（忽略大小写）不等于 `true` 时直接返回 `nil` 驱动，并打出“NOT SUPPORT RETRIEVE GRAPH”的调试日志；等于 `true` 时才用 `NEO4J_URI`、`NEO4J_USERNAME`、`NEO4J_PASSWORD` 创建 `neo4j-go-driver/v6` 驱动，并以最多 30 次、间隔 2 秒的方式重试认证，以等待可选容器就绪。`docker-compose.yml` 与 `.env.example` 都写明：自 v0.1.6 起，旧变量 `ENABLE_GRAPH_RAG` 已不再被 Go 主应用读取。Helm 模板注释重复了同一事实。因此，只拉起 `neo4j` profile 而不设置 `NEO4J_ENABLE`，进程里仍然没有可用驱动；只设置变量而不提供可达的 Neo4j，启动会在重试耗尽后失败。系统信息接口通过 `SystemHandler.getGraphDatabaseEngine` 报告状态：驱动为 `nil` 时返回字符串 `Not Enabled`，否则返回 `Neo4j`。初始化向导在开启图谱相关配置时也会检查该变量，未开启则返回错误，要求先正确配置 `NEO4J_ENABLE`。

知识库级开关由 `KnowledgeBase.IsGraphEnabled()` 定义：`IndexingStrategy.GraphEnabled` 为真，并且 `ExtractConfig` 非空且 `Enabled` 为真。知识库在加载时还会把旧数据里“只打开了 `ExtractConfig.Enabled`、尚未同步策略位”的情况，回写到 `IndexingStrategy.GraphEnabled`，以避免两套历史字段互相打架。即便如此，运行时判断仍然要求两个条件同时成立。单次上传覆盖必须遵守同一合取关系。关闭图谱的知识库不会为新文档入队 `TypeChunkExtract`，已有 Neo4j 中的数据也不会自动成为该库问答的必经来源。

抽取发生在入库富化阶段，而不是检索阶段临时从全文生成一张图。任务类型是 `chunk:extract`，进入 Asynq 队列 `graph`，由 enrichment worker 池消费，按分块入队。抽取使用的是对话模型，通过模型用途绑定 `extract_model`（`ModelUsageBindingExtractModel`）选择，并不存在第六种名为“图谱模型”的 `ModelType`。提示词来自 `config/config.yaml` 的 `extract` 段以及 `config/prompt_templates/` 中的图谱抽取模板，包括实体抽取与关系抽取两步。`internal/application/service/graph.go` 负责调用模型、解析 JSON、做实体对齐和关系校验，再请求图谱仓储写入。仓储实现 `repository/retriever/neo4j/repository.go` 用 APOC 的 `apoc.merge.node` 与 `apoc.merge.relationship` 做幂等合并，并把分块 ID 并入节点的 `chunks` 列表。节点标签由知识库与知识 ID 派生，从而把不同库、不同文档的同名实体隔开。若驱动为 `nil`，`AddGraph` 只记录告警并返回成功，不写入任何节点。这意味着：如果知识库级开关被打开，但进程没有可用的 Neo4j 驱动，抽取任务仍可能消耗对话模型配额，却不会留下图数据。正常的产品路径应在初始化或配置阶段就被 `NEO4J_ENABLE` 检查拦住；仓储层的空操作是防御性降级，不是推荐的工作模式。

检索使用图谱的方式有两条，职责不同。第一条走问答管线：查询理解抽出实体后，`PluginSearchParallel` 并发调用 `PluginSearchEntity`，仓储按实体查找相关节点和分块，结果与向量/关键词命中合并。这条路径在驱动为空或没有实体时静默无结果，不把整个问答变成 503。第二条是独立的只读查询 API：`POST /knowledge-bases/:id/graph-search`，由 `routes_graph.go` 注册，权限按读权限和 API Key 的 retrieve 能力校验。Handler 注释说明它按实体名做区分大小写的子串查询，返回实体、定向关系和仍然有效的来源分块，不调用模型，也不改变默认检索。仓储对公开查询做了种子数量和返回行数的上限（代码中可见探测上限与截断原因），并把名称、属性、分块列表做长度裁剪。驱动为 `nil` 时，`SearchGraph` 返回 `nil, nil`，以区别于“后端可用但没有命中”。Handler 的 Swagger 声明在图谱服务不可用时给出 503、在知识库未启用图谱时给出 409，这些错误由服务层在规范化请求和检查可用性之后返回。Wiki 虽然也使用“图”这一日常说法来描述页面链接，但其存储在 Postgres 的 Wiki 表中，重建链接与图谱抽取不是同一套写入路径，不能把 Wiki 导航和 Neo4j GraphRAG 写成同一个子系统。

关闭图谱时，混合检索、FAQ、Wiki（若开启）、联网搜索和普通问答仍然可用。开启图谱则会增加入库阶段的模型调用、对 Neo4j 与 APOC 的运维依赖，以及问答阶段一次额外的并发查询。官方功能说明把它定位为人物、组织、产品或条款之间关系较多的资料更合适，这与实现相符：抽取质量依赖于对话模型和提示词，检索收益依赖于关系是否被稳定写出并与分块 ID 对齐。

## 八、模型提供方抽象

模型在领域上只分成五类，定义于 `internal/types/model.go`：`KnowledgeQA`（对话）、`Embedding`（嵌入）、`Rerank`（重排）、`VLLM`（视觉）、`ASR`（语音）。前端把它显示为对话、向量、重排、视觉、语音，但后端存储和路由使用上述英文类型名。起步配置通常只需对话模型和嵌入模型，就可以完成普通入库和问答；这不等于系统只支持两类。重排、视觉、语音都是按场景启用的能力，缺省时相应管线关闭或降级。

同一类模型还会通过用途绑定（`ModelUsageBinding`）挂到不同功能槽位上。当前绑定包括：`embedding_model`、`summary_model`、`question_model`、`image_processing_model`、`vlm_model`、`asr_model`、`wiki_synthesis_model`、`auto_tag_model`、`chat_model`、`rerank_model`、`query_understand_model`、`follow_up_model`、`extract_model`。可以看到，摘要、问题生成、图谱抽取、Wiki 合成、自动标签、查询理解、追问建议都复用对话模型类型，只是在知识库或租户默认设置里指向可能不同的实例。视觉与语音有独立类型，但图片处理槽位和 VLM 槽位在配置上仍需分清，避免把 OCR 用模型和对话视觉理解写成同一个字段。模型状态有 `active`、`downloading`、`download_failed`，主要用于本地拉取场景。

提供方（`ModelSource`）在类型里列出的包括 `local`、`remote` 以及一批命名来源：`aliyun`、`zhipu`、`volcengine`、`deepseek`、`hunyuan`、`minimax`、`openai`、`gemini`、`mimo`、`siliconflow`、`jina`、`openrouter`、`litellm`、`requesty`、`nvidia`、`novita`、`azure_openai` 等。`internal/models/providers/` 目录还为更多厂商或接入层准备了声明文件，例如 Anthropic、Cohere、GPUStack、HuggingFace TEI、LKEAP、LongCat、ModelScope、Moonshot、Pinecone、千帆、七牛、RunCrate、WeKnora Cloud 以及通用兼容层。官方架构概述写明由该包声明二十余家厂商，并以 `internal/models/api/` 下的线格式分包实现 OpenAI、Anthropic Messages、Gemini、DashScope、Cohere Rank、NVIDIA NIM rerank 等协议。具体某一家是否在 0.9.0 中可用于全部五类模型，必须以提供方声明和支持的类型矩阵为准，不能从目录文件名反推“每个厂商都实现了 ASR 和重排”。已知约束之一是：重排模型不走 Ollama 本地源，需要独立的重排接口。凭证与额外密钥由模型配置保存，并使用 `SYSTEM_AES_KEY` 做落盘加密；接口上有独立的 credentials 读写，避免普通的模型更新请求误把密钥明文转出。

选择模型的层次是“租户或系统中已创建的模型实例 → 知识库或功能槽位绑定 → 某次请求的实际调用”。系统管理员可以维护模型目录（catalog），目录中的条目不会自动变成已配置模型，`deprecated` 只影响下拉候选。知识库可以为聊天、嵌入、重排、抽取等槽位指定不同实例。内置模型还可以通过 `builtin_models.yaml` 一类声明在启动时落地，属于部署期预置，而不是运行时动态发现。Ollama 有独立的设置页和可选探测，`OLLAMA_OPTIONAL` 控制探测失败是否阻断启动。调试接口允许对某个模型做连通性或相似性检查，但不会改变类型系统。

对架构而言，这套抽象的意义是：业务管线只依赖“某类型的模型接口”，不把厂商 SDK 散落到知识库服务里。代价是提供方矩阵、目录、内置预置、环境变量默认值和界面绑定之间会出现多重来源。阅读配置时应以数据库中的模型行和知识库绑定为运行时权威，目录和示例 YAML 只是创建时的辅助。

## 九、存储架构：主库、检索、缓存与文件

主事务库在标准形态下就是 ParadeDB。它同时承担租户、知识、分块、会话、任务元数据，以及默认的向量检索与 BM25 关键词检索。因此，默认部署不需要再启动 Qdrant 或 Milvus。`RETRIEVE_DRIVER` 可以是逗号分隔的多值，`initRetrieveEngineRegistry` 会按其中出现的驱动名注册相应引擎。已实现并在启动函数中出现的名字包括 `postgres`、`sqlite`、`elasticsearch_v8`、`elasticsearch_v7`、`opensearch`、`qdrant`、`weaviate`、`milvus`，以及后续分支中的 Doris 与腾讯云 VectorDB。环境变量路径会构造 ID 形如 `__env_postgres__` 的虚拟存储；用户还可以在界面里配置库表中的向量存储，形成“环境默认 + 可运维的命名存储”两套来源。`types.vectorstore.go` 把 Infinity 和 ElasticFaiss 明确标为遗留或实验性质，没有可单独部署的实例，注册逻辑也要求未知引擎不能被静默忽略。阅读检索架构时，应把这两个名字视为类型兼容残留，而不是 0.9.0 的可选产品引擎。

多种检索引擎并存，并不等于一次查询会自动广播到所有引擎。知识库或租户会关联实际使用的存储组；检索服务按该配置把请求扇出到已选引擎，再做结果融合。超时可由 `MULTI_STORE_RETRIEVE_TIMEOUT_SEC` 一类配置约束。引擎地址还要经过 SSRF 校验，避免把向量库配置写成对内网任意地址的探测工具。SQLite 路径只属于 Lite：它加载 `sqlite-vec`，用同一文件承担业务数据和向量，能力与运维模型都和 ParadeDB 不同。

Redis 的职责是运行时协调，而不是知识的权威存储。Asynq 用它保存任务和重试状态；流管理用它在多实例间衔接 SSE；系统设置变更可以通过发布订阅通知其他进程；限流和模型最大并发（`WEKNORA_MODEL_MAX_CONCURRENCY`）也依赖它。连接可配置逻辑库、前缀、命名空间、操作超时以及 TLS（面向托管 Redis）。没有 Redis 时，Lite 用进程内执行器代替队列，功能可用范围随之收缩，尤其是跨进程的流和分布式闸门。

文件与对象存储是第三条存储轴线。`STORAGE_TYPE` 与 `storage_backends` 表支持 `local`、`minio`、`cos`、`tos`、`s3`、`oss`、`ks3`、`obs`。默认本地目录由 `LOCAL_STORAGE_BASE_DIR` 决定，标准容器路径是 `/data/files`。统一资源表让同一文件可以被知识对象、会话附件或消息产物引用，而不把物理路径散落在各个业务表里。预签名下载、预览和短链（`/r/:token`、`/api/v1/files/presigned` 等）都建立在资源授权之上。多模态图片、Wiki 媒体、技能包和聊天附件都走这套存储，因此“只想用本地盘”和“必须上对象存储”会按功能组合变化：某些图片多模态校验会要求对象存储配置完整。可选的 `minio` profile 只是把其中一种 provider 跑在同一 Compose 网络里，并不取消对其他云存储的支持。

Neo4j 是第四条轴线，只在图谱开启时成为权威图存储。它与 Postgres 中的分块通过 chunk ID 对齐；删除知识或库时，维护任务需要同时清理图节点，否则会出现“检索还能跳到已删分块”的不一致。公开图查询会再回查分块是否仍然有效，正是为了把图存储和主库之间的延迟不一致挡住。

## 十、API 面的形状

对外 API 以 `/api/v1` 为前缀，由 Gin 分组注册。仓库内有体积很大的 `docs/swagger.json` 与 `docs/swagger.yaml`，并有契约测试约束其同步，但阅读架构不应把 OpenAPI 文件当成目录来粘贴。更有效的办法是按路由文件看到的限界上下文理解资源面。

认证与空间：注册、邀请注册、登录、登出、刷新、校验、OIDC 启动与回调、切换租户、修改密码与偏好，以及当前租户的成员、API Key、审计、邀请、技能与沙箱覆盖。平台管理员另有用户列表、状态、重置密码、创建用户、平台 API Key、设置摘要、提权与撤销等。系统信息、部署能力、解析引擎探测、存储引擎状态、沙箱检查、模型目录读写都挂在系统分组下，供前端在“尚未完成初始化”和“日常设置”两种界面之间复用。

知识与内容：知识库的增删改、复制、移动目标、置顶、画像生成、混合检索、活动流；知识对象的文件/URL/手工创建、预览下载、重解析、取消、批量操作、文件夹、标签、图片画廊、索引重建；分块的读写、修订、回滚和生成问题；FAQ 条目的导入导出与检索；Wiki 页面、修订、文件夹、链接重建、检查与自动修复。图谱只读查询单独挂在知识库之下，但不进入内容写接口。

会话与问答：会话的增删改、标题生成、附件、停止、fork、rewind、置顶、续流、建议问题、产物下载；知识问答与智能体问答的 SSE 入口；消息搜索与批量删除；转写；沙箱终端与桌面的票据及 WebSocket 升级路径；本地浏览器与后台工作项。嵌入渠道复制了会话和问答的一个子集，并把认证换成渠道令牌交换。

智能体、组织与渠道：智能体的 CRUD、复制、工具与类型预设、分享；组织的加入、邀请、成员与跨空间分享；嵌入渠道和 IM 渠道的配置、轮换令牌、回调；微信二维码状态。技能目录、安装、文件与指导语属于技能子域，但路由上常与智能体或沙箱配置相邻。

基础设施与集成：模型及其凭证、调试与复制；向量存储；对象存储后端；数据源及其同步、暂停、日志与凭证；联网搜索服务与提供方；MCP 服务（作为客户端去连接外部工具）、工具审批、OAuth；沙箱配置与按配置安装的技能；评测。记忆有用户侧与管理员侧两套：用户管理自己的条目和主题，管理员可按主体查看和调整。自动化包括定义、触发校验、暂停恢复、手动运行、授权与通知。

文件访问故意不完全藏在 `/api/v1` 之下。`/files`、`/r/:token` 以及预签名接口要兼顾浏览器直接打开、嵌入页面和跨域预览，因此在 `files.go` 里单独注册，并配合来源策略与令牌有效期。健康检查与 Swagger UI 挂在根上，不走租户鉴权。本地浏览器扩展的授权与内部接口也相对独立，以免把扩展通信写进普通会话路由。

API Key 与 Cookie/JWT 会话是两套主体。Key 可以授予全权限，也可以按能力（检索、问答、入库、管理模型等）和知识库范围收缩。未在策略表登记的路由对 Key 默认关闭。这使开放 API、MCP 端点、自动化和前端会话可以共享路由实现，却不必共享同一授权宽度。错误响应走统一信封，中间件负责把领域错误转换成状态码，Handler 不应随便写两种互不相认的 JSON 形状。

## 十一、前端信息架构与后端上下文的对应

前端路由定义在 `frontend/src/router/index.ts`。未登录可见登录、注册、邀请加入、工作空间引导和组织加入。登录后的主壳对应知识库列表与详情、会话创建与聊天、智能体列表、自动化、工具箱、制品库、组织、平台与系统设置。知识库详情下再展开文档、FAQ、Wiki、画廊和库设置；库设置子页与后端知识库配置字段对应，包括分块、模型、解析器、图谱、向量存储、数据源、分享、存储和高级项。全局设置页的分节在 `frontend/src/views/settings/Settings.vue` 与 `frontend/src/config/settingsAccess.ts` 中列出，并按角色赋予最低可见门槛。

与工作空间后端上下文直接对应的设置分节包括：一般设置、Ollama、WeKnora Cloud、模型、联网搜索、聊天历史、默认模型槽位、工作空间记忆、向量存储、解析引擎、对象存储、沙箱、版本信息、用户资料、我的记忆、助手偏好、环境变量、凭证保险库，以及成员与租户信息。技能和 MCP 作为管理员分节出现，因为安装技能会改写沙箱镜像或运行环境，MCP 则涉及外部工具凭证和审批策略。系统管理员 additionally 可见部署级分节：全局系统设置、模型目录、运行队列、平台 API Key、全局审计。这些分节并不都拥有同名的单一后端资源，有的是把多个系统接口聚在一个页面上，例如队列巡检对应任务检查器，模型目录对应系统级 catalog 接口。

主界面的左侧知识库与会话、右侧问答，对应的是知识库列表、会话列表和聊天流式接口，而不是一个“全能页面”直接操作全部表。工具箱（`/toolbox`）把 API 集成、CLI、MCP Server 接入、Chrome 扩展和 Claw Skill 做成落地说明与配置，对应的后端是 API Key、MCP 端点、嵌入策略等，而不是又一套业务表。嵌入页（`embed/`）是给外部网站用的精简聊天壳，走嵌入渠道令牌，不能进入工作空间设置。这种前端切分与后端路由分组基本同构：知识、会话、智能体、设置、平台管理各自封闭，避免把图谱或数据源做成脱离知识库的一级导航。例外是自动化、助手和制品库，它们在 v0.9.0 被提升为更显眼的入口，后端则分别落在自动化服务、带 `assistant` 种类的会话和消息产物上。

前端角色可见性不能代替后端守卫。`settingsAccess.ts` 写明自己只是前端导航的单一事实来源，后端路由守卫仍然权威。Viewer 可以看见模型和默认槽位，但编辑动作仍应由 Admin 或更高级角色的接口拒绝。这一点与 API Key 的 fail-closed 策略一致：界面隐藏是体验，授权是服务端的边界。


## 十二、扩展点、配置分类与可选 profile

WeKnora 的扩展主要不是独立的插件进程，而是“可替换实现 + 可开关管线 + 可登记的外部连接”。官方开发文档 `website-docs/06-development/03-extension-points.md` 按这个思路整理。从架构上可以把扩展点分成六类。

第一类是检索引擎与存储后端。检索引擎实现 `RetrieveEngine` 一类仓储接口，并在启动时向 `RetrieveEngineRegistry` 注册；对象存储实现 provider 接口，并出现在 `storage_backends` 或环境变量 `STORAGE_TYPE` 中。新增一种向量库，原则上应在 `repository/retriever/` 增加包、在 `types` 中增加引擎名、在 `container.go` 中增加注册分支，并决定它是否进入 Compose profile。新增一种对象存储同理。Infinity 与 ElasticFaiss 说明：只加枚举不加可部署实现，会造成类型面和环境面的长期噪音。

第二类是模型协议与厂商目录。`internal/models/api/` 按线格式分包，`providers/` 声明厂商默认端点、能力与兼容策略。目录可以被系统管理员覆盖，但不能在运行中“偷偷”改写已经创建的模型客户端快照。要支持一家新的 OpenAI 兼容厂商，往往不必改问答管线；要支持一种新的线协议，才需要新的 API 包。重排、嵌入、语音各自有不同于聊天补全的请求形状，因此扩展模型类型比扩展厂商更昂贵。

第三类是文档解析引擎和分块策略。`docreader` 的 parser registry 允许按文件类型选择实现；知识库 `ParserEngineRules` 把选择权交给空间管理员，而不是写死在二进制里。分块策略在 Go 侧的 `chunker` 包，`auto` 策略内部还有回退链。图片管线的 `default` 与 `smartocr` 是解析之后的另一处策略分支。这些扩展都发生在入库路径，失败会被跨度记录，而不会直接破坏已完成索引的旧文档，除非用户显式重解析。

第四类是数据源连接器、联网搜索提供方和 IM 适配器。数据源类型常量包括飞书、Lark、飞书云盘、Lark Drive、Notion、Confluence、语雀、GitHub、Google Drive、OneDrive、钉钉、网页爬取、Slack、IMAP、RSS、GitLab、IMA、Seafile、Nextcloud。`container.go` 在启动时按区域注册飞书/Lark 的 Wiki 与 Drive 连接器。联网搜索可以把 SearXNG、Tavily 或可配置的提供方表作为来源。IM 包目录包含微信、企业微信、飞书、钉钉、Slack、Telegram、QQ 机器人、Mattermost、云之家等适配。它们都把外部事件翻译成“创建知识、创建会话或投递消息”，最终仍进入同一套知识对象或会话模型。缺少某个适配器，只是少一种入口，不应让核心问答停止工作。

第五类是 Agent 工具、MCP、技能和自动化。内置工具由智能体配置的 `allowed_tools` 白名单裁剪；MCP 服务把外部工具动态加入同一循环，并带有 OAuth、凭证和按工具的审批。技能是可安装到沙箱镜像或运行环境中的指令与脚本包，执行发生在 Docker、E2B、CubeSandbox 或本机沙箱等后端里，而不是在 `app` 进程内直接 `exec` 不可信代码。自动化调度器以任务所有者身份启动助手会话，把周期或一次性工作变成持久化的运行记录和通知。这些扩展改变的是“谁在何时以何种权限调用已有能力”，很少引入新的权威数据模型。

第六类是客户端形态：Web、CLI、Go SDK、小程序、桌面、Chrome 扩展、嵌入 iframe、DeepSeek Harness 插件、本机浏览器技能。它们是同一 API 的多种外观。Python `mcp-server/` 曾经把 API 再包装成 MCP 工具，现已弃用，能力由内置 MCP 端点接替。保留该目录是为了兼容旧部署，不应再把它当作新的扩展推荐位。

配置同样分层，不能只看一个文件。第一层是环境变量，`.env.example` 中出现的键名数量以数百计，按镜像版本、运行时、网络地址、数据库、Redis 与队列并发、文件存储、各对象存储 provider、检索引擎、Neo4j、Ollama 与内置模型、docreader 与 PDF 细节、密钥、注册与空间策略、OIDC、沙箱、联网搜索、MCP、Langfuse、SSRF 与本机浏览器分组。其中真正在标准 Compose 里默认生效、且必须由部署者填写的，主要是数据库与 Redis 口令、`JWT_SECRET`、`SYSTEM_AES_KEY` 以及可选的签名密钥；其余大多是注释掉的可选覆盖。第二层是 `config/config.yaml`，包含服务端口、会话检索的默认阈值与 Top-K、是否开启改写和重排、提示词模板 ID、默认分块大小与重叠、文档处理超时、图谱抽取的默认描述和示例。第三层是 `config/` 下的内置智能体、类型预设、内置模型示例、厂商目录示例和 `prompt_templates/`。第四层是数据库中的租户默认设置、知识库配置、模型行、向量存储行、存储后端行和系统设置表。运行时发生冲突时，应以更靠近资源的那一层为准：知识库配置覆盖租户默认值，单次上传覆盖再覆盖知识库默认值；模型调用以已创建的模型行为准，而不是以目录里的最新推荐值为准。

可选 Compose profile 是部署层的扩展开关，必须和运行配置一起理解。只启动 `neo4j` 容器却不设 `NEO4J_ENABLE`，图谱仍然关闭。只设 `STORAGE_TYPE=minio` 却不启动 `minio` profile 或外部 MinIO，文件写入会失败。只把 `RETRIEVE_DRIVER` 改成 `qdrant` 却不提供可达的 Qdrant，启动注册会报错并导致该引擎不可用。`langfuse` profile 拉起的是完整附属栈，还需要一组独立的初始化口令和公钥配置；即便不启动该 profile，也可以把 `LANGFUSE_HOST` 指向外部实例。`dex` 只为测试 OIDC 提供身份源。`odl-hybrid` 需要本地构建镜像。`full` 是便利集合，不是“生产必须全部打开”的模式，打开后内存和故障面都会显著上升。官方建议标准 Docker 部署从 4 核 CPU、8 GB 内存起步，且该起步值不含本机 Ollama 模型权重，也不含把上述可选栈全部拉起的余量。

还有一组行为开关位于租户与认证策略：`DISABLE_REGISTRATION`、复杂密码、默认租户模式、是否允许自助创建空间、是否启用 RBAC、是否允许跨租户访问、每用户最多拥有空间数、是否自动创建 API Key、默认存储配额、邀请有效期、邀请自动接受、审计保留天数、OIDC 启用等。官方后端设计写明：所有 RBAC 守卫尊重 `cfg.Tenant.EnableRBAC`，关闭时仅记录“本应拒绝”的日志后放行，这是灰度迁移期行为。对架构阅读者来说，这意味着授权模型在源码里是完整的，但一个具体部署可能故意把它降为告警模式；讨论多租户隔离时必须同时声明该开关的状态，而不能假定 0.9.0 的二进制一定在强制执行角色。

## 十三、并发、异步任务与失败重试

异步任务是入库、同步和富化的脊柱，也是 WeKnora 把“企业里常见的长任务”从 HTTP 请求中拆出去的主要办法。任务类型与队列拓扑的单一事实来源是 `internal/types/task.go`。系统声明六个 worker 池：`core`、`postprocess`、`enrichment`、`maintenance`、`shared`、`wiki`，每个池背后是独立的 `asynq.Server`，并发上限因此是硬隔离，而不是仅仅在同一个服务器里用权重表达偏好。默认并发分别是 8、2、12、4、6、8。共享池可以消费 core 与 enrichment 的队列，以便在某一阶段空闲时出借容量，同时仍保留各池的保底并发。这些默认值可被 `WEKNORA_ASYNQ_*_CONCURRENCY` 以及 Wiki、模型最大并发等环境变量覆盖。另有 `CONCURRENCY_POOL_SIZE` 控制文档处理中的协程池（`ants`），它不是 Asynq 的 worker 数。

队列名与任务类型的对应是固定的。`default` 队列承载 `document:process` 与 `manual:process`。`chat_attachment` 同样在 core 池，但权重更高，专门处理会话临时文档，避免知识库批量导入把交互上传挤到后面。`postprocess` 队列承载统一后处理调度 `knowledge:post_process`。enrichment 池下再按职责拆成 `summary`、`multimodal`、`graph`、`question`、`memory` 等队列，分别对应摘要与自动标签、图片多模态、图谱抽取、问题生成、长期记忆抽取。`sync` 承载数据源同步。维护队列的物理 Redis 名仍是 `low`，目的是让旧版本入队的任务在滚动升级时还能被消费；新代码使用语义化常量 `QueueMaintenance`，任务包括 FAQ 导入、库克隆、索引删除、库删除、批量删除与重解析、知识移动。Wiki 使用独立池和 `wiki` 队列，包含页面摄入与库级收尾（索引重建、死链清理、交叉链接），收尾带防抖。生产者入队时仍须显式指定队列，测试和可观测性则用 `QueueForTaskType` 检查是否漂移。

失败与重试建立在 Asynq 自身的重试，以及业务层的死信、跨度和 housekeeping 之上。任务可以带 attempt 和知识 ID 等作用域，过期 attempt 的任务必须成为空操作。死信写入 `task_dead_letters`，并有检查器接口供系统管理员在前端队列页查看、重放或按知识库取消。`task_pending_ops` 用 `dedup_key` 和领取时间支持巡检与补偿，避免只依赖 Redis 内存队列。文档处理超时由 `WEKNORA_DOCUMENT_PROCESS_TIMEOUT` 和各类解析器超时约束；超时后的状态应落到 `failed` 或保持可取消，而不是永远停在 `processing`。重新解析、取消解析、删除之间的互斥，是失败恢复里最容易出错的部分，源码为此引入了 admission 与 status 短路。数据源同步另有暂停、冲突跳过、结果上限和重试确认，因为外部系统的失败模式与本地文件解析不同。

问答路径上的并发是另一种性质。单次请求内部，`CHUNK_SEARCH_PARALLEL` 用并行任务同时跑分块检索和实体检索；多存储扇出也有超时。模型调用有租户或全局的并发闸门，防止把下游 LLM 打满。SSE 流需要在客户端断开、用户停止、实例重启时被正确关闭或续接，续流接口就是为此存在。Agent 工具调用、MCP 审批和沙箱执行都有超时，`WEKNORA_AGENT_TOOL_APPROVAL_FAIL_OPEN` 一类开关会改变超时后的失败策略，这是安全与可用性之间的显式权衡，必须在部署时当成安全策略的一部分，而不是单纯的性能参数。自动化调度器、技能安装进度和后台 Shell 作业各自有独立的状态与取消接口，官方后端设计特别提醒：后台 Shell 的等待和取消不等同于交互终端进程，待审批状态的恢复也不等于可以重放任意外部写入。

Lite 模式下的 `SyncTaskExecutor` 把上述队列拓扑折叠进进程内同步或本地调度。功能路径大多仍在，但失去了跨进程重试、独立扩容 enrichment 池、以及用 Redis 做分布式锁和流管理的能力。架构评估若针对标准 Compose，不应把 Lite 的同步执行当成生产默认。

## 十四、安全、认证与租户边界

认证支持三条主路径：用户名密码（JWT 访问令牌与刷新令牌，落在 `auth_tokens`），API Key（`X-API-Key`，哈希保存在 `tenant_api_keys`），以及可选 OIDC（`OIDC_AUTH_ENABLE=true`，支持 PKCE 与标准发现/端点配置，`dex` profile 仅供测试）。中间件把通过校验的主体写入上下文，键名定义在 `internal/types/const.go`，包括用户、租户、角色、请求 ID、API Key 范围、审计用 Key 标识、以及嵌入、IM、MCP 等不同的 `PrincipalAuthSource`。共享智能体场景下，会话所属租户、模型与知识库解析所用租户、沙箱绑定所用租户可能不是同一个值，源码为此引入了 `SessionTenantIDContextKey` 与 `SandboxTenantIDContextKey` 等互不相同的键，并在注释中解释：沙箱销毁必须按会话所有者查找绑定，否则会留下仍在计费的微虚机。阅读授权代码时，不能只取 `TenantIDContextKey` 一键以蔽之。

授权是多层相交的。第一层是租户成员角色。Owner 可删除空间或变更 Owner；Admin 管理成员、集成和多数空间级设置；Contributor 可创建知识库和智能体并编辑内容；Viewer 只读并可以对话。第二层是知识库级授权，包括自有库、组织分享、以及通过共享智能体获得的只读或受限范围，实现于 `application/access` 与 `KBAccessRead`/`KBAccessWrite` 守卫。第三层是 API Key 能力与知识库范围，与角色正交，未登记路由默认拒绝。第四层是 Agent 执行权限、工具审批、MCP 审批和自动化授权（grants），用于约束“智能体以用户身份执行写操作”的范围，v0.9.0 把这套模型提升为产品能力。第五层是资源令牌与嵌入渠道令牌，面向文件预览和外部网站聊天，必须限制来源、过期时间和可访问的库。系统管理员（`is_system_admin`）和跨租户标志（`can_access_all_tenants` 与 `EnableCrossTenantAccess`）是平台级通道，只应出现在明确的平台接口上，并用 `CrossTenant` 守卫保护。

凭证与密钥有独立的保护措施。`JWT_SECRET`、`SYSTEM_AES_KEY`、`SYSTEM_SIGNING_KEY` 是部署必填或强烈要求替换的密钥；模型、数据源、MCP、对象存储的密钥应加密落盘，接口避免在普通 GET 中回传明文。配置导出和初始化接口有专门的脱敏测试，说明这是有意识的边界，而不是只靠前端不展示。出站请求受 SSRF 白名单、DNS 约束和拨号超时限制，覆盖 URL 导入、数据源、向量库地址、网页抓取等路径。文档解析和租户级解析器地址同样有 SSRF 相关校验。上传大小、技能包大小、请求体限制（例如 FAQ、混合检索、嵌入聊天）在 Handler 层单独收紧，减轻被大包拖垮的风险。

租户隔离的权威在数据访问：多数仓储查询都应带上租户条件，知识库、模型、会话、记忆都不允许仅凭客户端提交的 ID 跨空间读取。软删除、分享和共享智能体让“可见性”变得比单列 `tenant_id` 更复杂，因此访问包以显式 grant 作为补充，而不是让查询随处去掉租户过滤。若部署关闭了 `EnableRBAC`，上述守卫会退化，隔离强度取决于剩余的租户过滤和认证；这是必须在安全评估里单独标注的部署选择。审计日志记录行动者、角色、对象、路径、结果和范围，并按 `WEKNORA_AUDIT_RETENTION_DAYS` 保留，为空间管理员和系统管理员提供事后追溯，但它不能替代前置守卫。

嵌入页、IM 机器人和 MCP 端点扩大了攻击面，因为它们把聊天能力暴露给外部网络或外部平台。嵌入有独立的来源策略和令牌交换；IM 有各平台的签名或回调解密；MCP 端点有独立令牌并可按端点限制工具与知识库。这些入口都不应当直接获得 Owner 级的空间管理能力，除非被显式授予。沙箱网络策略、技能安装需要 Admin 权限、以及“把根级脚本写入沙箱镜像”的警告，都说明技能系统被当作高风险扩展点来设计。

## 十五、设计权衡：企业广度与复杂度

把 0.9.0 的源码树看作整体，最显著的设计选择是：用一个 Go 主服务覆盖知识库、问答、智能体、多入口集成和平台治理，同时把可变的引擎和附属系统做成可选项。这个选择对“企业内部不同部门、不同资料形态、不同模型供应商、不同合规要求”是友善的。同一套产品可以在只启用 ParadeDB 和两个模型的情况下，作为部门知识问答上线；也可以逐步打开对象存储、重排、视觉、语音、图谱、Wiki、数据源同步、IM、MCP、沙箱技能、自动化和 Langfuse，而不必更换主应用。索引策略的四个开关、模型五类、数据源十几种、检索引擎多种、存储八种 provider，都是在同一领域模型上做笛卡尔式的场景组合，而不是为每个场景分叉出无法汇合的产品线。

为此付出的代价同样清楚。第一，认知负担高。要理解一次问答，需要同时知道动态管线、知识库策略、租户默认值、模型绑定、是否联网、是否重排、是否有图谱实体、是否走 Wiki 加权。要理解一次入库，需要同时知道解析引擎规则、分块策略、索引开关、富化子任务和 attempt 机制。官方文档已经按子系统拆成数十篇，源码里的 Service 文件数量也表明边界在扩张。第二，测试矩阵和失败模式是组合爆炸的。任意两个可选引擎、任意一种连接器和一种存储的组合都可能在边界上出现凭证、SSRF、超时或一致性问题。第三，历史兼容造成重复入口。`ENABLE_GRAPH_RAG` 与 `NEO4J_ENABLE`、`Pipeline` 与 `PipelineBuilder`、`ExtractConfig.Enabled` 与 `IndexingStrategy.GraphEnabled`、独立 `mcp-server` 与内置 MCP 端点、环境变量向量库与库表向量库、MySQL 遗留脚本与真实主库选项，都是“两套机制曾经或仍然同时出现在树里”的例子。有的已经被明确废弃并停止读取，有的仍在运行中并存并由代码做同步或降级。第四，主进程职责过宽。API、Worker、MCP 服务端、IM 接入同驻，简化了默认部署，却让性能隔离和权限最小化变得更难：一条失控的解析队列和一次公开的嵌入聊天共享同一进程资源，尽管它们在队列权重和鉴权上已经被分开。

代码里也能看到针对复杂度的收敛设计。队列定义集中在一处，避免权重和任务类型漂移。知识库访问规则从 Gin 中抽到 `application/access`。检索引擎用注册表而不是在检索调用处写大量分支。模型用协议包和厂商声明分离。图谱被做成可空驱动的附加来源，而不是检索核心的前置条件。动态管线用 `AddIf` 把可选阶段从固定列表里请出去。这些都是在“功能已经很多”的前提下，用内部抽象控制扩散。但抽象本身又增加了阅读成本，例如共享智能体下的多个租户上下文键，没有注释几乎无法正确修改。

因此，若用“是否适合企业项目、是否存在选配与冗余”来评价架构，结论应当是：源码支持这一判断，而且把选配写成了默认的扩展方式；冗余并非都是失误，有一部分是明确的兼容层或场景分叉（例如 FAQ 直答与检索生成、Wiki 导航与分块检索、混合检索 API 与聊天管线），也有一部分是尚未清理干净的历史接口。对二次开发而言，这意味着改核心状态机的风险高于在既有扩展点上增加一个提供方或连接器。对运行而言，这意味着生产配置的首要工作是关闭不需要的 profile 和管线，而不是把 `full` 当作推荐拓扑。后续的功能文档将按能力逐项说明哪些是默认核心、哪些是选配、它们依赖哪些进程和模型，以及哪些入口在做相近的事。

本文依据的是 0.9.0 源码树与仓库内文档，没有启动 Docker Compose，也没有在运行系统上验证超时、重试和隔离的实际表现。凡涉及外部引擎在故障时的精确降级文案或状态码，除已引用的 Handler 声明和仓储空操作外，应以对应服务实现和测试为准。

## 十六、启动过程与请求中间件链

`cmd/server/main.go` 在组装 dig 容器之后启动 HTTP 服务，并在监听前后执行两类不同严格程度的动作。数据库迁移由 `AUTO_MIGRATE` 控制，可在启动时自动执行 `migrations/versioned` 或 Lite 下的 `migrations/sqlite`；失败或 dirty 状态会被缓存，供系统信息接口把版本显示为失败或 dirty，而不是静默丢掉该行。`AUTO_RECOVER_DIRTY` 提供把脏迁移标记恢复的选项，这是运维逃生舱，不应理解为日常自动修复。监听本身在 `listen.go` 里带重试，以便在容器编排中等待端口或依赖就绪。

`runStartupBootstrap` 的注释写明：容器构建完成、HTTP 开始监听之前的引导是尽力而为，失败只告警，不中止启动。设计意图是，环境变量写错时，运维仍能把服务拉起来再从运行中的实例修复，而不是因为一处笔误让部署完全无法启动。`WEKNORA_BOOTSTRAP_SYSTEM_ADMIN_EMAIL` 在部署尚无系统管理员时，把匹配该邮箱的首个用户提升为系统管理员；若已经存在系统管理员，该变量不再授予特权，以避免界面上的撤销被启动过程抵消。这种“引导期宽松、运行期收紧”的策略，与 RBAC 灰度开关类似，都是把可运行性放在前，把严格配置放在后，评估安全时必须单独列出。

请求进入 Gin 之后，全局中间件顺序在官方后端设计文档中给出，并与 `internal/middleware/` 及 `router.go` 对应。`MultipartFormCleanup` 在请求结束（包括失败和 panic 恢复）后删除写入系统临时目录的表单文件，避免容器 `/tmp` 被大上传堆积。CORS 明确允许 `Authorization`、`X-API-Key`、`X-Tenant-ID`、`X-Embed-Session`、`X-WeKnora-Desktop-Token` 以及 MCP Streamable HTTP 需要的 `MCP-Protocol-Version`、`Mcp-Session-Id` 等头。`RequestID` 复用或生成 `X-Request-ID`，写入 Gin 上下文和 `Request.Context()`，贯穿日志与追踪。`Language` 决定文档处理语言的优先级是环境变量 `WEKNORA_LANGUAGE`，然后是 `Accept-Language` 的首个标签，最后默认 `zh-CN`。`Logger` 记录请求与响应，并对密码、令牌字段脱敏，截断 base64 图片，SSE 响应跳过完整记录，单条有大小上限。`Recovery` 捕获 panic 并返回 500。`ErrorHandler` 读取 `c.Errors` 末位，若是 `*errors.AppError` 则按其 HTTP 码返回统一的 `{success:false, error:{code,message,details}}` 信封，其余为 500。

认证并不只有一条全局 `Auth`。嵌入公开组使用 `EmbedAuth`，校验发布令牌并做基于 Redis 的三级限流（每 IP 每分钟、渠道全局每分钟、渠道每日）。内置 MCP 端点使用 `MCPEndpointAuth`，校验端点 Bearer，注入端点所属空间、机器主体，以及由工具白名单和知识库范围派生的 API Key 式权限。沙箱终端等 WebSocket 使用短时 ticket，再由 `AttachAuthenticatedUser` 建立与普通 Auth 相同的会话上下文，成员和角色仍从数据库解析。免认证的邀请查询和受邀注册使用进程内存滑动窗口限流，超限返回 429。普通浏览器和 API 请求走 JWT 或 API Key 的 `Auth`，再进入 `APIKeyGate` 与 RBAC 守卫。Langfuse 追踪中间件和审计提供者挂在认证之后，以便事件带上真实主体。文件预签名路由则走签名校验而非用户会话，避免把临时下载链接绑死在 Cookie 上。

这套链的架构含义是：同一套路由树服务多种主体，但每种主体在进入业务 Handler 之前就被换成带范围的上下文。后续 Service 不应再解析原始令牌，只应消费上下文中的 principal、tenant、grant 和 API Key 范围。若在任务 Worker 中调用同一 Service，必须由入队时保存的身份重新注入等价上下文，否则会在“HTTP 里能过、异步里越权或取不到租户”之间摇摆。

## 十七、知识库类型、能力标志与分块类型

前面在数据模型里强调了索引策略的四个开关，还需要补上知识库类型和分块类型，否则容易把“一个文档库打开 Wiki 管线”和“一个 FAQ 库”写成同一概念。

`internal/types/knowledgebase.go` 定义三种知识库类型：`document`、`faq`、`wiki`。`EnsureDefaults` 在类型为空时回落到 `document`；非 FAQ 库会清空 `FAQConfig`，非文档库会清空自动标签和画像配置；FAQ 库则补齐默认的索引模式，包括对问题与答案如何进入索引的预设。`Capabilities()` 计算出一组给前端和智能体编辑器使用的布尔能力：`vector`、`keyword`、`wiki`、`graph`、`faq`。其中 FAQ 来自库类型是否为 `faq`，Wiki 来自 `IsWikiEnabled()`，而 `IsWikiEnabled()` 只看 `IndexingStrategy.WikiEnabled`，并不要求 `Type == wiki`。自动生成 Wiki 还要再满足 `WikiConfig.IsAutoGenerateEnabled()`。由此可见，类型字段和索引策略不是一一对应的：文档库可以打开 Wiki 生成管线，FAQ 是一种以问答对为中心的库类型，`wiki` 作为类型常量存在，但运行时“是否按 Wiki 能力过滤智能体可用库”看的是策略开关。这是产品面出现多种相近入口时，架构上必须先分清的一层。JSON 序列化还会计算 `capabilities` 并刻意扣住存储和 VLM 的密钥字段，避免组织分享的接收方在列表接口中看到所有者的密钥。

分块类型定义在 `internal/types/chunk.go`，数量超过“正文切一段”的朴素模型。`text` 是普通文本块；`parent_text` 是父子策略中的父块，注释写明仅用于上下文、不参与向量索引；`image_ocr`、`image_caption`、`image_vector` 是多模态管线挂在展示该图片的文本块之下的子块。`image_vector` 的注释特别强调：它的索引行保存的是图片本身的向量，而不是 `Content` 的文本向量，`Content` 只是复用图片描述（没有描述时用 OCR 文本）供重排和回答上下文使用，任何按文本重建索引的路径都不能处理它。这是一处不能被“全部重嵌入”简单覆盖的硬约束，索引重建如果忽略类型，就会破坏图片向量检索。此外还有 `summary`、`entity`、`relationship`、`faq`、`web_search`、`table_summary`、`table_column`、`wiki_page`。`wiki_page` 的注释写明，它用于把 Wiki 页面接入现有检索管线。也就是说，Wiki 既有自己的页面表、链接和修订，也会投影成分块，以便不打开 Wiki 导航工具的检索路径仍可能命中页面内容。实体与关系分块则表明，图谱抽取的结果除了写入 Neo4j，还可以或曾经以分块形式进入同一套检索，阅读具体写入路径时要区分“图数据库中的节点”和“类型为 entity 的 chunk”是不是同一次抽取的两种落存。网页搜索结果被做成 `web_search` 分块，说明联网命中在融合阶段会与知识库命中共用检索结果结构，而不是另造一套无法重排的对象。

分块还有状态和标志位：存储完成与索引完成被分成不同状态值，推荐等布尔状态用位标志保留扩展空间。父子关系通过 `parent_chunk_id` 表达。内容哈希用于去重和变更检测。把如此多的分块类型放进同一张 `chunks` 表和同一套检索引擎接口，是典型的“单一检索总线、多种来源投影”设计：FAQ、Wiki、表格摘要、图片和联网结果都可以进入重排与融合，代价是重建索引、删除和权限过滤都必须按类型区分特殊情况。`IsImageChildChunkType` 就是这种特殊情况的一处集中判断。

## 十八、docreader 进程内部及其与 app 的契约

`docreader` 虽然在产品叙述里常被一句话带过，但它是唯一默认常驻的 Python 进程，有自己的并发、资源上限和解析器注册表。`docreader/main.py` 用 gRPC 服务端承载 `DocReaderServicer`，工作线程池大小取自 `CONFIG.grpc_max_workers`，发送与接收消息长度受 `grpc_max_message_size_bytes` 限制，上传字节另受 `grpc_max_file_size_mb` 校验。健康检查使用 `grpc_health`，与 Compose 中的 `grpc_health_probe` 对应。服务可以按配置添加 TLS 安全端口，也可以在未启用 TLS 时以 insecure 模式监听，并在日志中明确写出“WITHOUT TLS”，提醒这是部署选择而不是隐藏默认。图像引用会从解析产物中收集，经过共享目录或流式字节变成 `ImageRef`，再由 `app` 侧上传到对象存储或本地盘。UTF-8 校验与修复发生在返回前，避免非法字节进入 Go 侧分块器。

解析器目录 `docreader/parser/` 按格式拆分：PDF 版式与扫描件、DOCX、Excel 转换与修复、HTML、网页、EPUB、Markdown、MarkItDown、图片预处理、XMind、MHTML，以及 OpenDataLoader。`registry` 与 `chain_parser` 负责按类型或规则选择和串联。预处理工人、PDF 渲染 DPI、嵌入图片抽取、矢量图表区域识别等大量 `DOCREADER_PDF_*` 与 `DOCREADER_PREPROCESS_*` 变量，说明解析被当成对内存和 CPU 敏感的子系统单独调参，而不是沿用 Go 侧的 `CONCURRENCY_POOL_SIZE`。`odl-hybrid` 作为可选 HTTP 后端，只有当知识库规则指向 OpenDataLoader 且该服务可达时才进入路径；它失败时的回退由 `DOCREADER_ODL_HYBRID_FALLBACK` 一类配置决定。对架构而言，`app` 与 `docreader` 的契约是：输入为文件字节或 URL 及解析选项，输出为文本、图片引用和足够的页级元数据；ASR、VLM、分块、嵌入都不在 docreader 内完成（音频转写由 app 在调用解析前后按配置插入），从而保持 Python 进程可以独立扩容和独立发布镜像。

共享卷是这个契约里最容易被忽略的部分。gRPC 消息有大小限制，直接把所有图片内嵌在响应里并不合适，因此解析出的图片落在 `/tmp/docreader`，由 `app` 读取后再写入长期存储。若两个服务的卷没有配对，会出现“解析成功但图片全丢”的故障，表面像多模态配置错误，根因却是进程间传输。开发编排把 `50051` 映射到宿主，是为了让宿主机上的 `app` 能连到容器里的 docreader，传输路径与生产相同，只是网络位置变了。

## 十九、检索总线、混合引擎与 Wiki、数据源等附属模型

检索引擎仓储被一层混合引擎包装。`container.go` 在注册 Postgres、SQLite、Elasticsearch、OpenSearch、Qdrant 等实现时，普遍调用 `retriever.NewKVHybridRetrieveEngine(repo, engineType)`。也就是说，业务侧面对的是“同时支持关键词与向量的混合引擎”这一接口，具体引擎再声明自己支持 `keywords`、`vector` 中的哪些 `RetrieverType`。系统信息里的 `supportsRetrieverType` 通过 `GetRetrieverEngineMapping` 查询该能力，供前端或初始化向导避免把不支持关键词的纯向量库当成完整的默认引擎。多引擎并存时，知识库创建可以绑定 `vector_store_id`；环境变量驱动的默认存储与库表中的命名存储可以同时出现，检索扇出与超时由搜索服务处理。这套总线让 FAQ 分块、Wiki 页面分块和普通文本分块走同一写入与查询接口，也让“只开关键词或只开向量”成为策略问题，而不是换一套 API。

Wiki 的权威页面并不等同于这些投影分块。`wiki_pages` 及相关的文件夹、链接、修订、问题表构成一套接近小型站点的模型：页面有 slug、正文、摘要、类型与状态，修订带 `edit_source`（pipeline、agent、user、revert）和编辑者，并有软、硬两级版本保留上限；链接可以重建，死链和问题可以上报与修复。摄入任务把文档改写成页面，收尾任务做交叉链接和索引同步，再写成 `wiki_page` 分块供检索总线使用。因此 Wiki 在架构上同时是“一种内容产品和一套写入管线”以及“检索总线上的一种分块类型”。关闭 `WikiEnabled` 后，自动生成停止，但已有页面和分块如何保留，要以删除与开关切换的服务逻辑为准，不能假定立刻从检索中消失或立刻物理删除。

数据源模型是另一条写入知识对象的路径。`data_sources` 绑定到租户和知识库，保存类型、加密后的配置、cron 调度、增量或全量模式、冲突策略（覆盖或跳过）、是否同步删除，以及游标和上次结果。每次执行在 `sync_logs` 中记录创建、更新、删除、跳过和失败计数。同步任务进入维护池的 `sync` 队列，失败不影响已经同步成功的对象，但会把数据源状态打成 `error` 或部分成功。连接器只负责列举和拉取，落入知识对象之后仍走解析或替换索引的既有服务，从而避免为飞书或 Notion 各写一套分块器。IM 渠道和嵌入渠道则主要写入会话，而不是知识库；它们有自己的渠道表、会话映射和凭证，模式包括 websocket 或 webhook（钉钉在较新迁移后只用 websocket）。联网搜索提供方表按租户保存 Bing、Google、Tavily、SearXNG 等配置，并指定默认项。这些表让“入口多样性”落在配置数据上，而不是落在分叉的核心表结构上。

智能体与组织的表把共享和授权变成数据而不是临时内存。自定义智能体、分享、组织成员、按租户禁用某个共享智能体、工具审批和执行授权，都有对应持久化。长期记忆、自动化运行、通知、审计、资源登记和任务死信同样如此。0.9.0 新增的助手与自动化并没有跳出这套“主库存状态、队列跑任务、会话走 SSE”的格局，只是增加了会话种类、授权表和调度器。这再次说明：功能面在变宽，但架构骨架仍然是同一个主进程加同一套 Postgres。

## 二十、对前文若干判断的补充与边界

把知识库类型、分块类型和检索总线放在一起看，用户关于“功能很多、大量选配、部分冗余、适合企业多场景”的判断，在数据模型上也能落地。同一段资料可以同时进入向量索引、关键词索引、Wiki 页面、FAQ 条目和图谱节点，还可以在问答时再与联网结果、表格摘要、图片 OCR 和长期记忆拼接。这些路径不是全部强制开启的，默认只打开向量与关键词；但它们共享分块表、混合引擎和重排融合，因此关闭某一路径通常是停止写入或停止加权，而不是卸载代码。冗余来自场景：FAQ 直达与段落生成、Wiki 跳转与分块检索、混合检索 API 与聊天管线、内置 MCP 端点与旧 Python MCP 服务，各自服务不同的调用方。真正需要警惕的是历史双字段和遗留引擎名，它们不会带来新场景，只会让配置者读到两套开关。

关于“关键词是否必须配置嵌入模型”，类型层的 `NeedsEmbedding` 把 `KeywordEnabled` 计算在内，创建和校验会遵循该契约。至于某个具体引擎在只开关键词时是否仍然调用嵌入接口，属于实现细节，本文不把类型契约直接写成“BM25 物理上一定发生了一次 embed 调用”。关于独立图查询的 503 与 409，Swagger 与服务层有声明，仓储在驱动为空时返回空结果；问答管线中的实体检索则走空结果降级，不把整次聊天失败掉。关于 `Type == wiki` 与 `WikiEnabled`，能力计算以策略开关为准。关于 MySQL，启动迁移不使用 `migrations/mysql`。关于 Infinity 与 ElasticFaiss，没有可部署实例。这些边界在阅读功能文档时也应保持，避免把文档愿望或历史常量写成 0.9.0 的默认运行时。

`cmd/server` 的引导策略、RBAC 关闭时的放行、Neo4j 仓储的空操作成功返回，都属于“为了让系统在部分配置缺失时仍能起来或继续跑”的降级。它们降低了运维门槛，也要求部署检查不能只看进程是否监听 8080。系统信息里的图谱引擎字段、存储引擎检查、解析引擎探测、沙箱检查和数据库迁移版本，正是把这些降级表面化的只读窗口。前端设置页和初始化向导消费这些窗口，但权威状态仍在后端进程和数据库。

至此，0.9.0 的系统架构可以收束为：三个核心进程加 ParadeDB 与 Redis 构成最小闭合回路；主服务内部用分层、注册表、动态管线和大量可选表扩展出企业所需的场景组合；知识的权威在 Postgres 的知识库、知识对象与分块，图的权威在可选 Neo4j，文件的权威在资源表加存储后端，任务的权威在 Asynq 与死信表，会话的权威在消息与流管理。功能如何按角色和场景打开，由 `features.md` 按能力逐项说明。

本文依据的是 0.9.0 源码树与仓库内文档，没有启动 Docker Compose，也没有在运行系统上验证超时、重试和隔离的实际表现。凡涉及外部引擎在故障时的精确降级文案或状态码，除已引用的 Handler 声明、仓储空操作和系统信息字段外，应以对应服务实现和测试为准。

## 二十一、智能体运行时在主进程中的位置

知识问答管线以事件插件链一次性装配并执行到流式生成为止。智能体对话则进入 `internal/agent/` 中一套可多轮、可暂停、可恢复的运行时。`session_agent_qa.go` 的 `AgentQA` 负责把会话、模型、知识范围、每请求的技能与 MCP 范围转换成引擎配置，再把控制权交给引擎。引擎的核心循环从文件名即可看出其阶段：`think.go` 让对话模型产生下一步思考或工具调用，`act.go` 执行工具，`observe.go` 把工具结果写回上下文，`finalize.go` 在结束时整理答案与引用。这与经典的 ReAct 循环一致，但被加上了大量企业场景所需的控制面。

控制面首先是暂停与恢复。`suspend.go` 与 `resume.go` 以及人工交互相关的 `hitl/`、`approval/`、`hostreview/` 表明，工具调用可以在等待审批、等待用户表单或等待 MCP OAuth 时把运行挂起，并把状态持久化，而不是把未完成的循环只留在内存里。官方架构概述写明：协作实例、审批及运行挂起状态会持久化；自动化调度器以任务所有者身份启动助手会话。恢复时必须重新注入授权上下文，并遵守“挂起状态可恢复，不等于任意外部写入可重放”的约束。`steer.go` 允许在运行中注入新的用户指令，测试文件还关注 steer 与工具调用的顺序，说明这是对进行中循环的受控打断，而不是另开一条无视当前工具状态的聊天。

其次是上下文治理。`compaction/` 与 `token/` 处理上下文膨胀，思考阶段溢出时可以压缩；`checkpoint.go` 为长任务保存检查点。`collaboration/` 支持把子任务交给委派实例，再汇总结果，对应 v0.9.0 的多智能体协作，会话种类上会出现 `agent_delegated` 这类不进入普通列表的记录。`background.go` 把一部分工作放到会话的后台工作项接口上，与 HTTP 请求的生命周期解耦，但仍属于同一运行时，而不是入库用的 Asynq 文档队列。

再次是工具与策略。`tools/` 存放内置工具，`skills/` 连接技能包，`policy/` 与 `operations/` 判断读取、探测、写入和破坏性操作是否被当前授权允许。MCP 工具通过代理进入同一 act 阶段，并有超时、审批和失败策略。沙箱终端与桌面、本机浏览器技能、数据分析（DuckDB）都作为工具后端出现，执行地点在沙箱或受控查询引擎，结果作为观察返回。提示词按场景拆分，例如 `prompts_wiki.go`、`prompts_browser.go` 以及知识库画像相关提示，避免所有智能体共享同一段无法维护的系统提示。

智能体运行时与检索管线的连接点是工具，而不是强制把每一次 `agent-chat` 都先跑一遍完整的 `rag_stream`。预设 `rag-qa` 会把 `search_knowledge`、`read_document`、`list_documents` 放入白名单；`wiki-qa` 则依赖 Wiki 能力。引擎在需要证据时通过工具调用知识库检索服务，因此同一套混合引擎既服务 `/knowledge-chat`，也服务智能体工具。架构上这是有意的复用，也造成两条对话入口在可观测性和提示词组装上并不完全对称：知识问答的引用由聊天管线的 references 插件提前推送，智能体的引用和步骤则更多依赖消息里的 `agent_steps` 与工具观察。阅读日志和前端展示时，不能假定两种入口的 SSE 事件集合相同。

把智能体放在主进程而不是独立编排服务，使工具可以直接调用内部 Service 接口，不必把知识库检索再暴露一轮网络协议；代价是一轮失控的工具循环会占用与 API、文档 Worker 相同的进程资源。超时、审批、并发闸门和沙箱隔离是用来收紧这条路径的，而不是把它变成另一个进程边界。

## 二十二、跨存储删除与清理的准入

知识对象的生命周期在写入时已经跨过 Postgres、检索引擎、对象存储，并在启用图谱时跨过 Neo4j，在启用 Wiki 时跨过页面表。删除因此不能只删 `knowledges` 一行。`knowledge_delete_plan.go` 把删除做成先规划再执行的过程，并能识别数据源替换时已经原子软删除旧行的情况，避免重复删除。更值得注意的是清理准入：`deleteReferencedKnowledge` 的注释要求，只允许使用已经授权的持久化关系中的 ID（会话消息、临时库或克隆差异），绝不能直接信任请求体里的 ID；若期望的知识库是已知的，还要钉住该库。一旦发现租户、绑定库发生变化，返回禁止错误“cleanup resource binding changed”。清理上下文通过 `withKnowledgeCleanup` 注入精确的 knowledge ID 到 KB ID 映射，并声明它不会把一般的知识库写权限授予会话所有者。

这套设计把“谁可以发起删除”和“后台如何把引用清理完”分开。HTTP 或任务在获得许可后，把允许清理的引用集合冻结下来，后续 Worker 即使换了一个执行环境，也不能把清理范围扩大到集合之外。克隆、移动、数据源替换和会话临时文档的回收都依赖这种精确引用，而不是“按租户扫一遍同类对象”。对架构而言，这是多存储一致性的控制面：权威映射在 Postgres，外部引擎和对象存储上的条目按计划删除；失败则进入维护任务或死信，而不是在 Handler 里同步走完所有后端。图谱公开查询会再次校验分块是否仍然有效，可以看作删除延迟窗口上的读侧保护，而不能代替删除计划本身。

## 二十三、流管理、查询理解与配置默认值如何进入一次问答

流式输出的跨实例状态由 `internal/stream/` 管理。目录中有 `factory.go`、`memory_manager.go`、`redis_manager.go` 以及基于 Redis 的通知收件箱。`STREAM_MANAGER_TYPE` 与是否配置 Redis 决定工厂选出内存实现还是 Redis 实现。内存实现对 Lite 和单进程足够，但不能在多个 `app` 副本之间续接同一条 SSE。Redis 实现使客户端可以在负载均衡或短暂断开后调用续流接口，从同一会话把未结束的生成接回去。停止生成、实例重启和通知投递都依赖这套管理器把“当前这一轮”的状态从 Handler 的本地 goroutine 里抬出来。没有它，知识问答和智能体问答的多副本部署会把流钉死在接到请求的那一个进程上。

查询理解插件在动态管线里位于记忆召回之后、并行检索之前。它读取 `ChatManage` 上的改写开关、扩展开关以及查询理解所用的模型槽位，产出改写后的查询、是否需要检索的意图，以及可能的实体列表。若判断不需要检索，后续并行检索直接跳过。`config/config.yaml` 的 `conversation` 段为这些行为提供部署级默认值，例如 `max_rounds`、`keyword_threshold`、`embedding_top_k`、`vector_threshold`、`rerank_threshold`、`rerank_top_k`、`enable_rewrite`、`enable_query_expansion`、`enable_rerank`，以及改写、摘要、会话标题、实体抽取、问题生成所用的提示词模板 ID。租户默认设置和知识库或会话级配置可以覆盖其中一部分，使不同空间不必共享同一套阈值。阅读一次具体问答时，应把 `ChatManage` 视为“已经解析完所有覆盖之后的运行快照”，而不是直接把 `config.yaml` 里的数字当成该请求的有效值。fallback 策略（例如改走模型或返回固定话术）也在这一层配置里，属于生成失败或检索为空时的产品行为，而不是检索引擎本身的错误。

这些默认值还解释了为什么重排和改写在架构上是可选阶段，却出现在默认配置里：`enable_rerank` 与 `enable_rewrite` 在 `config.yaml` 中为 `true`，但真正执行仍取决于是否绑定了相应模型、以及该次管线是否走到对应事件。默认开、资源缺则降级，是 WeKnora 处理选配能力时反复出现的模式，与 Neo4j 驱动为空时的空操作、Ollama 可选时的启动告警属于同一家族，只是发生在请求路径而不是进程启动路径。

把启动降级、请求中间件、知识库能力、分块总线、解析进程、智能体循环、删除准入和流管理连在一起，可以看到主服务内部其实有两条时间尺度不同的控制环：一条是请求级的（中间件、动态管线、智能体循环、SSE），一条是任务级的（Asynq 池、删除计划、数据源同步、Wiki 收尾）。它们共享领域模型与授权上下文，但失败重试和可观测性工具不同。把两者误认为同一条流水线，会在排障时找错队列或找错流管理器。

## 二十四、巡检、对外 MCP 面、前端 API 模块与评测的位置

任务失败的最后一道安全网是 `HousekeepingService`（`knowledge_housekeeping.go`）。它周期扫描长时间卡在 `pending`、`processing` 或 `finalizing` 的知识行，并把确认卡住的行标为 `failed`，以免用户界面永远停在转圈。注释把它定位为 Asynq 重试、死信回调以及多模态“最后一次尝试时 finalize”都未覆盖到的情况的补位，例如 Worker 在 defer 运行前被杀死、DocReader 超时之后 Worker 又丢失、多模态计数器未能递减。启动日志写明默认按五分钟一轮扫描；可用 `WEKNORA_HOUSEKEEPING_ENABLED=false` 关闭。构造函数故意不自动开始，需在进程生命周期里调用 `Start`，停止时若一轮扫描尚未结束，会在超时后继续关机并留下日志。

扫描不能只看 `knowledges.updated_at`。该字段通常只在解析状态切换时更新，而一次长时间的 DocReader 调用或大批量嵌入可能一小时不改状态。因此巡检把知识行的更新时间与最近一条处理跨度的更新时间做或组合：`SpanTracker` 的开始、结束、失败和跳过都会刷新跨度行，正在推进的管线即使父行“冻结”在某一阶段，也仍有心跳。没有任何跨度的行（例如某些 Lite 路径或旧任务）则退回到只看 `updated_at`。第二道门再区分“心跳已旧但子任务只是在繁忙队列里排队、尚未被 Worker 领取”的健康积压，避免把仅仅是排队的富化任务误杀。队列检查器为此提供活跃探测，删除扫描也复用类似的存活判断。这套逻辑把跨度表从“给前端展示进度”提升为运行时正确性的一部分：没有跨度心跳，巡检的误判率会上升。关闭巡检可以减少后台查询，但会重新打开“行永远 processing”的窗口。

对外 MCP 面与作为客户端去连接外部 MCP 工具的路径，在进程内是分开的。管理接口由 `RegisterMCPEndpointRoutes` 挂在 `/mcp-endpoints`：列表和工具目录对 Viewer 可读，创建、更新、删除和轮换令牌要求 Admin，API Key 需要 `manage_channels` 能力。注释把这些端点描述为与嵌入渠道类似的空间级集成面。真正接受 Claude 或 Cursor 连接的公开面由 `RegisterMCPServerRoutes` 挂在 `/mcp/:endpoint_id`，使用 `internal/mcpserver` 的 Handler，并在全局 `Auth` 之前挂上 `MCPEndpointAuth`，与嵌入公开路由的做法相同，支持 POST、GET、DELETE 以适配 Streamable HTTP。一端是空间管理员配置“把哪些工具和哪些知识库以何种令牌对外暴露”，另一端是机器主体拿着该令牌调用内置工具。`frontend/src/api/mcp-endpoint.ts` 与 `mcp-service.ts` 也分成两个模块，分别对应对外端点和作为客户端登记的外部 MCP 服务。旧的 `mcp-server/` 进程曾经用 Python 再包一层 REST 调用，现已弃用，避免与内置端点抢同一职责。

前端 `frontend/src/api/` 的目录几乎是后端限界上下文的一份清单：`knowledge-base`、`wiki`、`chunker`、`chat`、`agent`、`model`、`vector-store`、`storage-backend`、`datasource`、`web-search`、`mcp-endpoint`、`mcp-service`、`skill`、`memory`、`tenant`、`organization`、`system`、`automation`、`embed`、`initialization` 等。它不实现业务规则，只把路由分组映射为 TypeScript 调用。初始化模块对应尚未完成首次配置时的向导，与日常设置页共享部分系统接口，但所处的产品阶段不同。这种一一对应降低了前后端漂移的概率，也意味着新增一个后端上下文时，通常要同时增加路由文件、Service 和前端 API 模块，成本是完整的，不容易“只加一个隐藏接口”。

评测在路由上属于基础设施分组的 `/evaluation`，Handler 提供提交评测与查询结果两套接口，仓库的 `dataset/` 存放评估用问答数据和脚本。它消费的是已有的检索与生成能力，而不是第三条问答引擎，位置上更接近运维与质量工具。Helm Chart 的模板只包含 `app`、`docreader`、`frontend`、`postgres`、`redis`、可选 `neo4j`、Ingress、PVC 和密钥，并不把 Compose 里所有 profile 都做成默认子图表。这说明官方把 Kubernetes 形态对齐的是核心拓扑加图谱可选项，Qdrant、Langfuse、SearXNG 等扩张件需要另行接入。架构评估若以 Helm 为生产目标，应把“Chart 默认边界”和“源码支持的全部引擎”分开，不能假设集群安装会自动得到 Compose `full` 的全部附属进程。

以上补充与前面各章一起，构成对 0.9.0 系统架构的说明。功能如何向不同角色打开，以及哪些能力是默认核心、哪些是选配，见 `features.md`。

## 二十五、初始化向导与 Lite 发行在架构上的收缩

首次配置并不是在核心拓扑之外另写一套向导服务，而是由 `internal/handler/initialization.go` 把“为某个知识库补齐模型、存储、多模态、重排和图谱抽取配置”收成一组接口。`InitializeByKB`、`UpdateKBConfig`、`GetCurrentConfigByKB` 都以知识库为轴，而不是一次写死整个部署。处理过程会校验初始化请求、按类型装配模型描述并写入或复用已有模型，再把嵌入、对话、视觉等 ID 回写到知识库。图谱相关配置会检查 `NEO4J_ENABLE`；多模态和重排也有独立的校验函数。同一 Handler 还提供 Ollama 状态、模型列表、下载与进度查询，把本地模型的拉取状态机（对应模型行上的 `downloading` 与 `download_failed`）接到向导里。配置读取路径有脱敏，避免把密钥回传给前端。对架构来说，初始化是“把可选能力第一次绑定到一个具体知识库”的事务切面，日常设置页则是同一批资源的后续编辑入口，两者共享模型表和知识库行，不维护第二份配置权威。

Lite 与标准发行共用大部分源码，但在编译期注入的 `handler.Edition`（系统信息里默认写成 `standard`）会改变启动和能力表面。`cmd/server/main.go` 只在 Lite 构建里自动发现 `.env.lite`，显式 `ENV_FILE` 则对所有构建生效。`deployment_capabilities.go` 在 `edition` 为 lite 时，把组织能力标为 `not_supported_in_lite`，并把远程沙箱同样标为不支持，供前端隐藏或禁用对应入口，而不是让请求打到后端再变成含义不明的错误。自动开户接口 `auth/auto-setup` 只在 Lite 版可用，且要求请求头 `X-WeKnora-Desktop-Token` 与进程内设置的一次性令牌常量时间比较相等，用于桌面或单机首次拉起默认用户与空间。沙箱配置 Handler 用 `liteHidden` 直接回答相关路由，因为桌面构建改走本机沙箱模型。这些收缩是发行形态上的架构分支：同一领域模型在 Lite 里关掉跨空间组织和远程沙箱，并把存储与队列换为 SQLite 和进程内执行器，而不是维护一个精简到无法再合入主线的分叉仓库。

巡检服务除前文所述对解析状态的扫描外，还有后续几轮：把卡住的摘要状态恢复为失败；把删除任务已经不存在、却仍停在 `deleting` 的行按与解析卡住相同的契约转到失败，以免列表永远显示删除中；以及收割已经进入终态却仍挂着未关闭跨度的行，避免跨度表留下无法解释的开口。这些轮次说明“状态机的终态”和“附属记录的终态”在多存储、多队列环境下可能脱节，巡检的职责是把脱节重新变成用户可见的失败或干净的收尾。它与任务检查器、死信和跨度心跳一起，构成任务级控制环的可观测与自愈面。标准发行默认打开这层安全网，是因为 Worker 与 API 同驻或可多实例部署时，进程被杀和任务丢失比单机脚本更常见。

前端通过部署能力接口读取 `Edition` 以及组织、远程沙箱等项的可用原因，设置导航和平台页据此隐藏 Lite 不提供的入口。这与 `settingsAccess.ts` 声明的“后端守卫仍然权威”一致：发行收缩先在能力接口上显式表达，再由界面收敛，最后仍由 Handler 对 Lite 专属或 Lite 禁用的路由做硬判断，例如自动开户拒绝非 Lite 发行、沙箱配置在 Lite 下直接隐藏。三者缺一，就会出现菜单能进但接口失败，或接口开放但发行并不支持该依赖拓扑的情况。

## 二十六、即时通讯与嵌入渠道作为入站适配层

IM 与嵌入聊天不实现第二套检索或生成引擎，而是把外部平台事件适配进既有的会话与问答服务。`internal/im/service.go` 以适配器工厂按渠道配置创建各平台连接，并维护渠道状态、领导重试和进行中的请求。入站消息有去重窗口（已处理消息 ID 保留数分钟，并定期清理），正文长度、引用长度、附件字节和附件解析超时都有上限，避免把即时通讯变成不受控的大文件入口。附件会在问答开始前被下载和解析，文本注入提示词，图片则受更严格的视觉附件大小限制，以免展开为过大的 data URI。出站时会去掉知识问答或智能体管线产生的、只在 Web 界面有意义的引用标签，并把存储 URL 改写成适合该平台的可访问地址；流式内容按固定间隔刷新到外部平台，以在速率限制和可感知延迟之间折中。智能体路径在最终答案流结束后，还会等待完成事件，并带超时，以免 IM 侧永久挂起。失败、取消和无答案都有固定的回退话术。这些细节表明：外部平台是不可靠、有速率限制且不理解内部引用格式的客户端，适配层必须把内部事件模型翻译成平台能接受的消息，而不是把 SSE 原样转发出去。

嵌入渠道则用发布令牌换取会话令牌，并可为预览签发短期会话。令牌解析、渠道是否启用、会话句柄签名与校验都在 `embed_session.go` 和对应中间件中完成，然后再进入与普通知识问答或智能体问答相同的 Handler 子集。域名允许列表和三级限流属于这条适配层的一部分，用来约束把聊天框嵌进第三方网站后的滥用面。IM 渠道表把平台用户或线程映射到内部会话，使同一外部对话可以续上上下文；嵌入渠道同样把匿名访客映射为带范围的会话主体。二者都不应获得空间管理权限，其知识范围在渠道配置和智能体绑定里被钉死。增加一个新的 IM 平台，主要工作是写适配器并登记工厂，而不是改检索管线；这与模型厂商、检索引擎的扩展方式是同一思想在入口侧的对应物。
