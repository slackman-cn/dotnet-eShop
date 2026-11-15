# eShop 能否改为 Serverless 架构：FaaS / BaaS 与现有方案对比

> 文档版本：Step 6  
> 对应源码：`/workspace/eShop`，分支 `main`，提交 `913acea66708a59595351174cee9b29f37179d29`  
> 依据：已有架构文档 `docs/architecture.md`（v1）与 `docs/architecture-v2.md`（v2），以及其中引用的源码结论。本文不新增未经核对的源码细节，也不把未实测的云部署写成既成事实。  
> 本文性质：架构可行性评估与改造路径建议，不是迁移实施手册，也不是对某一云厂商的推荐书。

## 1. 先说结论

**可以改，但不适合一次性把整套 eShop 搬成纯 Serverless。**

更准确的判断是三句话：

1. **部分适合 FaaS。** 最明显的是按事件或定时触发、几乎无本地状态的工人：`OrderProcessor`（宽限期扫描）、`PaymentProcessor`（模拟支付）、以及 Webhooks 的对外推送。它们本来就不是“一直听 HTTP 的 API 进程”。
2. **部分适合 BaaS。** 身份、数据库、缓存、消息、网关、对象存储，都可以换成云厂商的托管服务，而不必先把业务代码拆成函数。这往往是收益最大、风险相对可控的一步。
3. **部分应保留长运行进程。** 以 `Ordering.API` 为代表的交易核心（DDD 聚合、工作单元、Outbox、跨服务 Saga），以及当前的 Blazor WebApp（依赖长连接与进程内通知）、Basket 的 gRPC/HTTP/2 端点，直接函数化会碰到超时、连接、协议和事务边界等硬约束。它们可以逐步缩小、换协议或换宿主，但不该作为第一批“全部改成函数”的对象。

因此，对比“现在这套 .NET 10 + Aspire 编排的进程型微服务”，Serverless 不是全面优于或全面劣于，而是**在闲置成本、弹性、少运维中间件上有优势，在冷启动、长事务、gRPC、本地 Aspire 开发闭环和改造成本上有代价**。推荐走混合路径：基础设施先 BaaS 化，工人 / 网关 / 身份再 FaaS 或托管化，核心交易暂时保留微服务，待 Outbox、库存预留、支付对账补齐后再考虑更深的函数化。下文按这个结论展开。

## 2. 现状：现在这套方案在解决什么问题

eShop 当前不是单体，也不是已经 Serverless 的应用。它是一套**进程型微服务**：每个业务能力是一个长运行的 ASP.NET Core（或 Worker）进程，由 Aspire AppHost 在本地把进程和中间件容器编排在一起，云端设计目标是 Azure Container Apps（`AppHost.cs` 中声明了 `AddAzureContainerAppEnvironment("aca")`，但本环境**未实测** `aspire publish` / `deploy`）。

用已有分析可以这样概括现状：

- **运行时与编排。** 目标框架为 .NET 10，Aspire SDK 13.6.0。本地 `aspire start` 会拉起 17 个资源（Step 3 实测全部 Running / Healthy）：包括 Redis、RabbitMQ、带 pgvector 的 Postgres，以及 Identity、Catalog、Basket、Ordering、OrderProcessor、PaymentProcessor、Webhooks、WebApp、WebhookClient、mobile-bff 等。
- **通信。** 同步路径是 REST（服务发现逻辑名如 `http://catalog-api`、`http://ordering-api`）和 Basket 的 gRPC（`basket.proto`，本机实测健康检查只接受 HTTP/2）。异步路径是 RabbitMQ 交换机 `eshop_event_bus`，routing key 为集成事件类型名。下单是一条事件驱动的 Saga：创建订单后先进入 `Submitted`，再经宽限期、库存校验、模拟支付，逐步走到 `Paid` / `Cancelled` / `Shipped`。
- **数据与一致性。** Catalog、Identity、Ordering、Webhooks 各有 Postgres 逻辑库（数据自治，但本地共用一个 Postgres 实例）。Basket 把购物车放在 Redis。Ordering 与 Catalog 使用 Outbox（`IntegrationEventLogEF`）保证“业务提交”和“事件记录”的原子性；**PaymentProcessor 没有 Outbox**，进程若在发布前崩溃，Saga 可能停在 `StockConfirmed`。库存是“先校验、支付成功后再扣减”，存在超卖窗口——这些已经在 v2 中作为改进点写出，对 Serverless 改造同样关键。
- **身份与前端。** `Identity.API` 自托管 Duende IdentityServer 7.3.2，使用开发签名证书、内存客户端，并关闭 KeyManagement，源码已标明不适合生产。WebApp 是 Blazor，Cookie + OIDC，并订阅订单状态事件以便在 UI 上通知；这依赖进程内的通知机制，而不是纯静态页面。
- **网关。** `mobile-bff` 是 YARP 反向代理，当前源码路由只覆盖 Catalog、Ordering、Identity，**没有** Basket。经 BFF 访问 Catalog 在本机出现过超时，商店主流程因 WebApp 直连后端而不受影响。

这套方案的核心假设是：**服务进程常驻、连接可以复用、事务可以在一次请求的 DbContext 生命周期里完成，消息消费者作为 HostedService 与 API 一起启动。** Serverless 要挑战的，正是这些假设。

## 3. 概念澄清：Serverless、FaaS、BaaS 不是同一件事

讨论“能不能改成 Serverless”之前，必须把几个经常被混用的词分开。否则会出现“把 API 丢进 Azure Functions 就算完成改造”，或“买了托管 Postgres 就宣称已经 Serverless”这类名不副实的结论。

### 3.1 Serverless

Serverless 是一种运维和计费模型，不是一种编程语言或框架。应用开发者不再预置、管理虚拟机或常驻集群节点，而是按实际调用、执行时间或托管服务的用量付费；扩缩（包括缩到零）由平台负责。它包含 FaaS，也包含大量 BaaS，还可以包括“无服务器容器”（按请求伸缩的容器实例）。因此“改成 Serverless”可以有很浅的改法（只换托管数据库），也可以有很深的改法（业务全部写成函数）。

### 3.2 FaaS（Function as a Service）

FaaS 把部署单元从“长运行进程”换成“按事件或请求被唤醒的函数”。典型触发器包括 HTTP、队列/总线消息、定时（cron）、存储事件、事件网格。函数实例在空闲时可以被回收，下一次调用可能经历冷启动；执行通常有超时上限（各平台从几十秒到十几分钟不等，不在此臆造具体数字）。连接、内存中的缓存、后台 HostedService，都不能再默认“进程一直活着”。

对 eShop 而言，把现在的 `BackgroundService`（如 `GracePeriodManagerService`）或一个集成事件处理程序改写成函数，属于 FaaS；把整个 `Ordering.API` 连同 MediatR 管道和 Outbox 投递原样塞进一个 HTTP 函数，只是换了宿主，并不自动获得 FaaS 的好处，还可能把超时和连接问题带进去。

### 3.3 BaaS（Backend as a Service）

BaaS 指由平台托管、以 API 或 SDK 交付的后端能力：认证与用户目录、数据库、对象存储、缓存、消息、推送、文件 CDN 等。调用方仍然可以是长运行微服务，也可以是函数或静态前端。**换 BaaS 不要求先拆函数。** 例如把自建 RabbitMQ 换成 Azure Service Bus 或 Amazon SQS/SNS，把自托管 IdentityServer 换成 Entra ID、Auth0 或 Amazon Cognito，都属于 BaaS 方向的改造。

### 3.4 和容器 PaaS、“无服务器容器”的区别

现在 eShop 若按 AppHost 的设计部署到 Azure Container Apps，更接近**容器平台 / PaaS**：每个服务仍是一个容器化的长运行（或可缩容的）进程，只是节点由平台管理。Container Apps、AWS App Runner、Google Cloud Run 这类“无服务器容器”可以按流量伸缩甚至缩到零，看起来很像 Serverless，但编程模型仍是进程（ASP.NET、gRPC、HostedService 都可以相对原样保留）。

这与纯 FaaS 的差别在于：

| 维度 | 纯 FaaS | 无服务器容器（如 Container Apps / Cloud Run） | 当前本地 Aspire 模型 |
| --- | --- | --- | --- |
| 部署单元 | 函数（一次调用一个处理程序） | 容器 / 服务进程 | 本机项目进程 + 中间件容器 |
| 常驻连接（DB、Redis、gRPC） | 需额外处理（连接池、冷启动） | 较接近现有写法 | 连接可长期复用 |
| 后台循环 | 要拆成定时/队列触发 | 可保留 `BackgroundService` | OrderProcessor、事件消费均在进程内 |
| 计费 | 多为按调用和执行时间 | 多为按 vCPU / 内存占用时间，视是否缩到零 | 本地无云计费；云上未实测 |
| 改造量 | 大（触发器、超时、状态外置） | 中小（主要改配置和伸缩） | 现状 |

很多团队口头说的“Serverless 改造”，实际做的是第三列走到第二列，而不是第一列。对 eShop 这完全合理，但不应当和“全面 FaaS”混为一谈。本文后文说 FaaS 时，特指函数计算；说 BaaS 时，特指托管后端能力；若提到无服务器容器，会单独写出。

## 4. 逐服务评估：哪些适合 FaaS，哪些适合 BaaS，哪些应留在进程里

下表基于 v2 对各服务职责、协议、存储和事件角色的结论。所谓“适合”是指改造后能对上平台特性，且收益大于主要风险；不是“已经有现成的官方 Serverless 版 eShop”。

| 服务 / 资源 | 现状特点（源码与实测） | 更适合 | 原因 | 改造代价 |
| --- | --- | --- | --- | --- |
| Catalog.API | 单项目贫血模型；无状态 REST；商品主数据在 `catalogdb`（含 pgvector 嵌入）；图片在本地 `Pics/`；订阅库存相关事件，改价走 Outbox | **FaaS 或“管理式 API + BaaS 数据库”均可考虑**；读多写少，是相对好的候选 | HTTP 查询天然适合函数或可缩到零的容器。数据可迁到托管 Postgres（需确认 pgvector / 等价向量检索）。图片更适合对象存储 + CDN，而不是打进函数包 | 中。冷启动会拖累商店首屏和列表接口；语义搜索第一次加载模型或建立连接可能更慢。Outbox 与事件订阅要有等价的触发器和派遣方式。写接口的授权本身在参考实现中偏弱，迁移时不应原样放大到公网函数 |
| Basket.API | gRPC（`basket.proto`），HTTP/2 only（本机 HTTP/1.1 探活会 400）；状态在 Redis；订阅 `OrderStartedIntegrationEvent` 清空购物车 | **优先 REST + Redis BaaS，或保留小型常驻进程**；不建议把现有 gRPC 服务直接丢进主流 HTTP FaaS | 多数 FaaS 入口以 HTTP/1.1 或平台网关为主，对服务端 gRPC / HTTP/2 支持有限或不完整（各云能力不同，但都不能假设与当前 Basket 行为一致）。购物车本身是短生命周期键值，很适合托管 Redis | 中高。若改 REST，WebApp、未来移动端和契约测试都要改。若保留 gRPC，更稳妥的是小规格常驻或无服务器容器，而不是纯函数 |
| Ordering.API | 三项目 DDD；MediatR 管道里有校验、日志、`TransactionBehavior`（先提交再投递 Outbox）；创建订单后立即返回，状态靠 Saga 推进；读侧部分用 Dapper | **建议保留长运行微服务（或无服务器容器），不要作为首批 FaaS** | 一次命令可能包含显式事务、领域事件派发和 Outbox 写入；FaaS 的超时、重试（可能重复 POST，虽然已有 IdentifiedCommand 幂等）和“函数实例随时被回收”会放大事务与连接风险。Saga 中枢也不宜拆成互不共享单元的一堆无协调函数 | 高。若未来函数化，需要先把 Outbox 派遣做成独立触发器、把每个命令变成明确的短事务，并仔细设计重试与幂等。这是重构，不是换宿主 |
| OrderProcessor | 无对外 HTTP；`GracePeriodManagerService` 定时扫描 `orderingdb` 中过了宽限期的 `Submitted` 订单，发布 `GracePeriodConfirmedIntegrationEvent`；与 Ordering 共享数据库（同一限界上下文的 Worker） | **很适合 FaaS 定时触发，或由消息/调度器触发的函数** | 天生就是周期任务，不必占用一个常驻进程。用 Timer Trigger 或等价调度即可 | 低到中。要注意与 Ordering 迁移、连接串和并发（多实例同时扫描）的协调，避免重复发布宽限期事件 |
| PaymentProcessor | 仅订阅 `OrderStatusChangedToStockConfirmed`，按配置模拟成功或失败并直接 `PublishAsync`；无自己的数据库，**无 Outbox** | **非常适合 FaaS（消息触发）**，但必须先补可靠性 | 典型的“来一个事件、做一个动作、出一个事件”，和函数模型一致。现有缺口是崩溃可能丢结果，函数化后若平台自动重试，没有对账存储会更危险 | 中。函数化的前提是先把支付结果持久化（或使用带 Outbox / 事务性发信的消息服务），并保证处理幂等 |
| Webhooks.API | 订阅登记在独立库；消费价格与订单支付/发货事件后向 `DestUrl` POST；流量随外部订阅突发 | **适合 FaaS + BaaS 消息/HTTP 出站** | 推送是突发、可并行、允许最终一致的工作。订阅数据可放托管库，投递可交给队列加函数重试 | 中。生产还需补 SSRF 防护、重试与死信，这些在参考实现里相对简化，不能假设“改成函数就自动安全” |
| Identity.API | 自托管 Duende IdentityServer；协议端点、登录 UI、Cookie、开发证书；被几乎所有客户端和 API 依赖 | **不适合直接把协议端点函数化**；更适合换成 **BaaS 身份**（Entra ID、Auth0、Cognito 等） | 授权码流程、密钥与证书轮转、会话 Cookie、发现文档缓存，都假设一个稳定的权威服务。FaaS 冷启动和实例切换对 IdP 不友好。源码本身已用 TODO 标明开发证书与 KeyManagement 关闭不适合生产 | 中高。换托管 IdP 要重配 WebApp OIDC、MAUI、各 API 的 Audience / Authority，并清理演示用内存客户端和明文演示密钥。这是生产化本来就要做的事，与是否 FaaS 正交，但收益明确 |
| WebApp（Blazor） | 交互式 UI；OIDC Cookie；进程内订阅订单状态以通知在线用户；图片可 forward 到 Catalog | **不适合纯 FaaS 原样托管**；可改为静态站点 / WASM + BaaS 或 API，或放到支持长连接的容器上 | Blazor Server 依赖 SignalR 长连接，函数平台普遍不擅长维持大量双向连接。进程内 `OrderStatusNotificationService` 也无法在缩到零的函数实例之间共享 | 高（若重做前端）。较小的改法是把 WebApp 放到无服务器容器并保留 SignalR；较大的改法是改成静态托管 + 调用后端 API，通知改用 Web PubSub 等 BaaS |
| WebhookClient | 演示用 OIDC 客户端，展示 Hook 载荷 | 可随 Webhooks 一起变为静态演示 + API，优先级低 | 不是业务关键路径 | 低 |
| mobile-bff（YARP） | 代码化路由；外部 HTTP 入口；无 Basket 路由；本机存在代理超时问题 | **适合换成 API Gateway BaaS**（如 Azure API Management、Amazon API Gateway 等） | 路由、版本校验、前缀剥离正是网关产品的本职。用托管网关还能补认证、限流、观测 | 中。要逐条迁移现有 `ConfigureMobileBffRoutes` 的版本匹配规则，并先解决“能否稳定打到 Catalog”的问题，不能把已知超时原样搬到云网关就当完成 |
| Postgres + pgvector | 四逻辑库共用实例；Catalog 依赖向量扩展 | **适合托管数据库 BaaS**（注意向量能力） | 减少自运维，备份和高可用由平台承担。向量检索必须确认托管实例支持等价扩展 | 中。连接方式从 Aspire 注入变为平台连接串、防火墙与身份验证；冷启动下的连接风暴需要池化或代理（如 PgBouncer / 云侧连接池） |
| Redis | Basket 的 `/basket/{userId}` JSON | **适合托管缓存 BaaS** | 与购物车模型匹配，改造主要在连接与网络隔离 | 低到中 |
| RabbitMQ `eshop_event_bus` | 直连交换机 + 队列绑定；事件名即 routing key；消费者是 HostedService | **适合托管消息 BaaS**（Service Bus、SQS/SNS、Pub/Sub 等） | 可降低 Broker 运维，并与 FaaS 触发器结合。`EventBus` 抽象本来就把实现隔离在 `EventBusRabbitMQ`，这是替换的有利条件 | 中。要重写总线实现、订阅拓扑和观测标签；Outbox 的派遣要对接新总线的事务性或至少一次投递语义 |
| ClientApp / HybridApp（MAUI） | 未纳入 AppHost；MAUI 9.0.40，与后端 .NET 10 不同步 | 保持客户端，后端入口走网关与 BaaS 身份 | 移动端本来就不是服务器进程 | 视 BFF / IdP 变化而定 |

关于云映射，只作对照、不指定必须采用哪一家：

- **Azure 方向（与当前 AppHost 声明的 ACA 更近）：** 函数可用 Azure Functions（.NET Isolated Worker 模型，便于复用现有依赖注入与部分中间件思路）；消息可用 Service Bus 或 Event Grid；数据可用 Azure Database for PostgreSQL、Azure Cache for Redis；身份可用 Entra ID；网关可用 API Management。Aspire 对 Azure 资源有第一方集成，也有把 Functions 纳入编排的演进，但**本仓库当前 AppHost 编排的是项目进程和容器，而不是 Functions 项目**，不能说“已经支持一键发函数”。
- **AWS 方向：** Lambda + API Gateway / ALB，RDS Postgres 或 Aurora，ElastiCache，SQS/SNS 或 EventBridge，Cognito。同样要把 `EventBusRabbitMQ` 换成对应适配器。
- 其他云有类似组合。选型关键不是品牌，而是：是否支持所需协议（gRPC、HTTP/2）、向量检索、消息触发函数、以及连接池。

.NET Isolated Worker 的意义在于：函数可以继续用熟悉的 DI 和部分库，而不是被迫写成脚本风格。即便如此，超时、冷启动和“没有进程级 HostedService”仍然在，Ordering 的事务管道不会因为换了 Isolated Worker 就自动变得适合 FaaS。

## 5. 优势与代价：和现有进程型方案对比

下表尽量写得诚实。所谓优势，是相对“自己用 Aspire 拉起一堆常驻进程和中间件容器，并在云上按容器长时间占用计费（若按设计落到 Container Apps）”而言；本环境并未实测云账单，成本判断是机制上的，不是报价单。

| 维度 | 现有方案（进程型微服务 + 自建或容器化中间件） | 改为 FaaS / BaaS 后可能的变化 | 对 eShop 的实际含义 |
| --- | --- | --- | --- |
| 成本 | 本地无云成本；云上若容器常驻，即使夜间无人访问也占用计算。演示环境 17 个资源同时在线，闲置浪费明显 | 闲置时可缩到零，按调用或执行时间计费。BaaS 有基础套餐费（库、缓存、IdP、网关往往不是完全免费） | **低流量演示、突发活动有优势。** 若 WebApp 和商品浏览是持续流量，函数与网关的单次调用费加冷启动重试，未必比一组小规格常驻容器更便宜。不能假设“改 Serverless 一定省钱” |
| 弹性 | 按服务进程扩缩，粒度是实例；要自己或平台配规则 | 函数按事件并行度伸缩，峰值时对库存校验、Webhook 推送有利 | 促销或批量推送时，FaaS 对 Payment / Webhooks / 读多的 Catalog 更合适。交易中枢仍受数据库写能力限制，弹性不会魔法般消除超卖或锁竞争 |
| 运维 | 要照看 Postgres、Redis、RabbitMQ、证书、各服务健康；Aspire 已减轻本地编排，云上仍有容器与中间件 | 少运维 Broker 和数据库主机，补丁和多可用区交给平台 | **运维优势主要来自 BaaS，而不是来自把 C# 改写成函数。** 只上 Functions、仍自己跑 RabbitMQ，收益有限 |
| 冷启动 | 进程已启动，Step 3 中首页和 101 件商品列表可立即返回 | 缩到零后第一次请求要等实例拉起、JIT/AOT、建立 TLS 和数据库连接 | **对商店首屏和登录跳转不友好。** Catalog 读路径若函数化，必须做预热、最小实例或把热点只读接口留在常驻/边缘缓存。这是相对现方案的明显劣势 |
| 连接 | 进程内可维护 Npgsql、Redis、RabbitMQ 连接池 | 函数实例频繁创建销毁，容易打满数据库连接；gRPC 通道也无法默认长存 | Basket 的 Redis、Ordering / Catalog 的 Postgres 都需要连接代理或谨慎的池配置。这是技术风险，不是纸面问题 |
| gRPC 与 HTTP/2 | Basket 已按 HTTP/2 only 工作，WebApp 用生成的客户端 | FaaS 和部分网关对服务端 gRPC 支持不完整 | 要么改 REST，要么 Basket 留在容器。硬迁函数很可能先在协议上失败 |
| 事务与 Outbox | Ordering 的 `TransactionBehavior` 在请求线程里提交再投递；Catalog 有类似的显式事务。已知支付无 Outbox，且未见独立的失败重派扫描器 | 函数超时或平台重试会导致重复执行；若仍在请求内同步投递，失败模式更复杂 | **Saga 改造代价高。** 应先补支付持久化、Outbox 派遣器和库存预留，再谈拆函数。否则 Serverless 会把现有一致性缺口放大 |
| 可观测性 | OpenTelemetry + Aspire Dashboard，本地一次看清 17 个资源和消息标签 | 云上要接平台的日志、指标、追踪；函数调用链与消息触发需要重新埋点 | 不是做不到，但是**本地 Dashboard 那种“一键看到全拓扑”的体验会变弱**，要重新建设 |
| 供应商锁定 | 业务代码在 .NET，中间件相对可替换（已有 `IEventBus` 抽象）；Aspire 对 Azure 有偏斜 | BaaS 和函数触发器会加深对某一云的依赖（身份、消息、网关尤其明显） | 抽象层能减缓锁定（尤其是事件总线），但 IdP 和网关迁移成本仍然高。应在合同和分层上有意识地保留替换点 |
| 安全责任边界 | 自托管 IdP、开发证书、`RequireHttpsMetadata = false`、`ValidateAudience = false`、演示密钥，责任全在应用侧 | BaaS 身份与托管库把一部分安全（补丁、认证协议实现）交给平台，应用仍要管授权、密钥、SSR F、最小权限 | 换 BaaS 身份是加分项，但不能把参考实现里偏演示的授权配置原样带到云上 |
| 本地开发 | Aspire 一条命令拉起全环境，Step 1–3 已验证可行（亦有 BuildKit、证书、BFF 超时等踩坑） | 纯云 BaaS 会迫使开发者连云、用仿真器，或维护两套模拟。Functions 虽可本地跑，但消息、身份、网关很难完整仿真 17 个资源的关系 | **这是现方案的显著优势。** 任何改造路径都应尽量保留 AppHost 能在本地一键拉起的能力，否则日常开发效率会下降 |

一句话归纳：**闲置成本和中间件运维，Serverless（尤其是 BaaS）有优势；对常驻浏览型流量、gRPC、下单 Saga 和本地开发闭环，现有进程模型更稳。** 优势不是全面的。

## 6. 三条改造路径与推荐

不要只讨论“全改或全不改”。按侵入性和风险，可以从浅到深分成三条路。

### 路径 A：保留进程，基础设施 BaaS 化

业务服务仍是现在的 ASP.NET / Worker 进程（可以部署在 Container Apps、Cloud Run 等无服务器容器上，按流量伸缩），但 Postgres、Redis、RabbitMQ、密钥和镜像仓库改为托管服务。AppHost 的资源声明从本地容器转向云资源引用，代码改动主要集中在连接与 `EventBus` 的实现替换。

- **优点：** 最接近现有架构和 Aspire 模型，能保留 gRPC、Blazor 长连接、MediatR 事务管道；运维和可靠性提升明显；可与生产化任务（证书、Audience、健康检查暴露策略）一起做。
- **缺点：** 闲置成本改善取决于容器能否缩到零、以及缩到零后对冷启动的接受度；函数级的极致弹性用不上。
- **适用：** 要把参考实现变成可上线系统，且团队希望改动可控。

### 路径 B：混合（推荐）

在路径 A 的基础上，把**适合事件/定时触发的部分**改成 FaaS，把**认证和入口**改成 BaaS，**核心交易和当前 Web 前端**暂留进程或无服务器容器：

1. 身份迁到托管 IdP（BaaS），拿掉开发证书和内存客户端。
2. 网关用 API Management / API Gateway 替换或前置 `mobile-bff`，先修复并明确路由范围（是否包含 Basket）。
3. `OrderProcessor`、`PaymentProcessor`（先补 Outbox 或对账存储）、Webhooks 投递改为消息或定时触发的函数。
4. Catalog 的纯查询可试点函数或带 CDN 的只读边缘缓存；写路径和 Outbox 先留在进程，或等派遣器独立后再拆。
5. Ordering、Basket（在改为 REST 之前）、WebApp 仍以进程或容器运行。
6. 全程保留 Aspire 本地编排：函数项目若纳入仓库，也应能在 AppHost 里和仿真器/容器一起启动。

- **优点：** 在高风险的 Saga 和协议上保持现状的正确性（并先补已知缺口），同时在工人、身份、网关上拿到 Serverless 的主要好处；可以分里程碑交付，失败可以回退。
- **缺点：** 系统里同时存在进程和函数两种宿主，观测和发布管线要两套约定；团队需要同时理解 Aspire 与 Functions（或 Lambda）模型。
- **为什么推荐 B：** 它对准了第 4 章的可迁移性，而不是用一种模型硬套所有服务。eShop 的价值在于把“同步 + 异步 + Outbox + 状态机”讲清楚；这些机制在混合架构里仍然成立，而全量 FaaS 会迫使你在尚未补齐支付可靠性和库存预留之前，就处理函数超时和重复触发。推荐 B，就是先拿稳的收益，再为以后的 C 留接口（独立派遣器、消息适配层、无状态查询）。

### 路径 C：全 Serverless 重构

前端改为静态或 WASM，API 全部函数化，数据、身份、消息、存储全部 BaaS，Saga 用平台工作流（如 Durable Functions、Step Functions）显式编排，而不是靠多个进程里的事件处理程序隐式推进。Basket 改为 REST，Blazor Server 放弃或重写。

- **优点：**  theoretically 最接近“按调用付费、无常驻进程”，运维面最窄。
- **缺点：** 等于重做一版 eShop，而不是迁移。工作流、契约、前端、测试、本地开发全部要重写；与上游参考实现分叉巨大；投入与教学/演示收益往往不成正比。冷启动和连接问题仍然要单独治理。
- **适用：** 仅当产品目标已经变成云原生 SaaS、团队有明确的函数平台标准、并且愿意放弃“保持与 dotnet/eShop 相近的代码结构”时再考虑。

### 建议的迁移步骤（按路径 B）

下列顺序是建议，不是已经执行的操作：

1. **先补架构缺口，再拆宿主。** 支付持久化与幂等、Outbox 派遣和积压监控、评估库存预留。否则函数重试会放大丢失或重复。
2. **基础设施 BaaS 化（路径 A）。** 托管库 / 缓存 / 消息先行，进程代码尽量不动。用 `IEventBus` 适配新总线。
3. **身份 BaaS 化。** 与生产安全项合并进行。
4. **工人函数化。** OrderProcessor、PaymentProcessor、Webhooks 投递。用同一套事件名和测试矩阵回归下单 Saga。
5. **网关 BaaS 化。** 对照现有 YARP 路由和版本参数，先在非生产环境验证 Catalog 与 Ordering。
6. **再评估 Catalog 读路径和 Basket 协议。** 有数据再决定是否函数化或改 REST。
7. **最后才讨论 Ordering 与 WebApp 是否更深地 Serverless。** 没有前六步的稳定基础，不应进入路径 C。

## 7. 结论

eShop **可以**走向 Serverless，而且**有真实优势**：演示和低流量环境下的闲置成本、中间件少运维、工人与推送的弹性、以及用托管身份替换明显偏演示的 IdentityServer 配置。这些优势主要来自 **BaaS 和有选择的 FaaS**，而不是来自“把所有 API 改成函数”本身。

相对现在的 **.NET 10 + Aspire 进程型微服务**，它**不是无条件更优**。Catalog 与 WebApp 的常驻浏览体验会受冷启动影响；Basket 的 gRPC/HTTP/2 与 FaaS 入口并不天然契合；Ordering 的事务、Outbox 和下单 Saga 改造代价高，且现有支付无 Outbox、库存不预留等缺口会在函数重试下变得更危险；本地 Aspire 一键编排的开发体验也需要刻意保留，否则日常效率会下降。

因此：**不要一次性整体搬迁。推荐路径 B——基础设施与身份先 BaaS，工人/网关再 FaaS，核心交易和当前 Blazor 前端保留进程或无服务器容器，先补可靠性再决定是否走向更彻底的函数化。** 这样既回答了“能不能改、有没有优势”，也避免把参考实现里尚未生产化的部分，直接放大成云上的运行时事故。

若只做一件与 Serverless 同方向、但即使不上函数也值得做的事，应当是：**用托管身份和托管数据/消息替换自建中间件，并补齐 Outbox 派遣与支付对账。** 这既是生产化，也是任何后续 FaaS 的前提。
