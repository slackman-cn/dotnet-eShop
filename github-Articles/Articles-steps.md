# Articles 部署步骤记录

对应上游：[ldumit/Articles](https://github.com/ldumit/Articles.git)  
本机路径：`/workspace/Articles`  
分支 / 提交：`master` / `63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721`（浅克隆）  
记录位置：本仓库的 `github-Articles/`（与 `github-eShop/` 同级）。**不把 Articles 源码提交进 slackman-cn/dotnet-eShop。**

---

## Step 1：尝试部署运行（2026-11-15，Asia/Shanghai）

目标：在助手的 Linux 云电脑上真正把项目跑起来，并验证 HTTP/API 可访问。全部命令在本机执行，不在用户的 Mac 上执行。已运行的 eShop Aspire 编排保持运行，未执行 `aspire stop`。

### 1. 先读仓库，搞清如何启动

根目录 `readme.md` 为空。有参考价值的是：

- `docs/architecture/README.md`：课程范围的分层 / DDD / CQRS 说明，没有启动命令。
- `src/Articles.sln`：完整解决方案；另有 `src/Submission.sln`。
- **启动方式是 Docker Compose，不是 Aspire。** 未发现 AppHost / `aspire.config.json` / `global.json`。
- `src/docker-compose.yml` + `src/docker-compose.override.yml` 定义默认要启动的服务。
- `postman/Demo.postman_environment.json` 给出各 API 的开发地址（HTTPS `4441–4445`）。该文件里还有预置 JWT，**本文不摘录这些令牌**。
- `ApiGateway`（YARP）在解决方案中，但 **没有** 写进 compose；其 `appsettings.json` 里的下游端口与 compose/launchSettings 也不一致（例如把 submission 指到 `4403`，而 4403 实际是 ArticleHub）。本次未启动网关。
- `production-api` 在 compose 中被整段注释，本次未启动。

目标框架全部为 **`net9.0`**（`Directory.Packages.props` 中 ASP.NET 包为 9.0.8）。根 Dockerfile / 各服务 Dockerfile 的运行时镜像是 `mcr.microsoft.com/dotnet/aspnet:9.0`，但构建阶段写的是 `mcr.microsoft.com/dotnet/sdk:8.0`（8 的 SDK 无法发布 net9.0 项目）。部分 Dockerfile 只复制单个项目目录，缺少 `Directory.Packages.props` 与 BuildingBlocks 引用；Auth 等服务的 `ENTRYPOINT` 使用 exec 形式且包含 `${APP_NAME}`，exec 形式不会展开环境变量。因此 **本次没有用这些 Dockerfile 构建业务镜像**，改为：Compose 只跑中间件，API 在宿主机用 `dotnet run` 启动。

依赖与配置（均来自仓库开发默认值，未编造云密钥）：

| 资源 | 来源 | 说明 |
| --- | --- | --- |
| SQL Server（Auth / Submission / Review 库） | override：`SA_PASSWORD`，连接串 `User Id=sa` | 开发库口令见上游 override，本文用 `<DEV_DB_PASSWORD>` 代替 |
| Postgres `ArticleHubDb` | override：`POSTGRES_USER=postgres`，`POSTGRES_DB=ArticleHubDb` | ArticleHub 使用；健康检查与用户/库名曾不一致（见问题） |
| Redis Stack | Journals 连接串 `redis://localhost:6379` | 端口 6379、8801 |
| MongoDB 6 GridFS | appsettings 中的 `mongodb://root:...@mongo-gridfs:27017` | 宿主机映射为 `27018`，运行时已改指向 `127.0.0.1:27018` |
| RabbitMQ | 用户 `guest`，主机名 `articles-mq` | 宿主机改为 `amqp://127.0.0.1:5672`；管理界面 `15672` |
| Hasura | `HASURA_GRAPHQL_ADMIN_SECRET` 为仓库中的演示值 | 本文写 `<HASURA_ADMIN_SECRET>`；控制台端口 `4493` |
| JWT | 各服务 `JwtOptions` 使用同一套演示 Issuer/Audience/Secret | 不把 Secret 与令牌写入本文 |
| 邮件 / Azure Blob | Auth、Submission 的 appsettings 含 SMTP 与 Azure 连接串占位 | 未配置真实云密钥；本次未验证发信和云存储。SMTP 即使用仓库里的开发值，也不保证可达 |
| 种子账号 | `Auth.Persistence/Data/Test/Seed.cs` 使用 `DefaultPassword`，人员来自 `Person.json` | 管理员邮箱 `dotnetlabx@articles.test`，口令见源码常量，本文写 `<SEED_DEFAULT_PASSWORD>` |

### 2. 与正在运行的 eShop 的端口关系

eShop 的 Postgres / Redis / RabbitMQ 容器只发布在 `127.0.0.1` 的高位端口（如 `28956`、`32772`、`28955`），**没有占用** 本机的 5432 / 6379 / 5672 / 15672 / 1433。Articles 的 API 计划端口 4401–4405、Hasura 4493、Mongo 27018 也空闲。因此 **不必停止 eShop**，Articles 使用其默认端口即可。

### 3. 环境准备

本机已有：Docker 29.9.3（静态二进制 + buildx 包装脚本）、.NET SDK 10.0.303。缺少两点，已安装：

1. **Docker Compose 插件原本不存在**（只有 buildx）。`docker compose -p ...` 报 `unknown shorthand flag: 'p'`。安装了 Compose **v5.7.1** 到 `~/.docker/cli-plugins/docker-compose`。`docker compose version` 显示 `Docker Compose version v5.7.1`。
2. **.NET 9 运行时原本不存在。** SDK 10 可以 *编译* net9.0（`dotnet build Articles.sln` 成功，121 个警告，0 个错误）。直接运行时提示缺少 `Microsoft.NETCore.App` 9.0.0。曾尝试 `DOTNET_ROLL_FORWARD=LatestMajor` 用 .NET 10 跑 Auth：进程能起来，但在 `Migrate<AuthDbContext>()` 时抛出 `PendingModelChangesWarning`（“model changes each time it is built”）并退出。安装 **ASP.NET Core / .NET 运行时 9.0.23** 后，同一程序在 9.0 运行时下迁移和种子数据成功。

安装命令：

```bash
curl -fsSL -o ~/.docker/cli-plugins/docker-compose   https://github.com/docker/compose/releases/download/v5.7.1/docker-compose-linux-x86_64
chmod +x ~/.docker/cli-plugins/docker-compose

curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
bash /tmp/dotnet-install.sh --channel 9.0 --runtime aspnetcore --install-dir "$HOME/.dotnet"
```

构建：

```bash
export PATH="$HOME/.dotnet:$HOME/.aspire/bin:/usr/local/bin:$PATH"
export DOTNET_ROOT="$HOME/.dotnet"
cd /workspace/Articles/src
dotnet restore Articles.sln --verbosity minimal
dotnet build Articles.sln --no-restore -c Debug --verbosity minimal
# restore / build 退出码均为 0
```

### 4. 启动基础设施

上游 `docker-compose.yml` 里 Postgres 的健康检查是 `pg_isready -U app -d articles`，与 override 中的用户 `postgres`、库 `ArticleHubDb` 不一致。准备了本地覆盖文件 `github-Articles/docker-compose.local.yml`（只改健康检查，不改上游文件）。

Linux 上 `${APPDATA}` 默认为空，override 里的 UserSecrets / HTTPS 证书卷路径会无效。启动前设置 `APPDATA=/tmp/articles-appdata` 并创建对应空目录。

```bash
export APPDATA=/tmp/articles-appdata
mkdir -p "$APPDATA/Microsoft/UserSecrets" "$APPDATA/ASP.NET/Https"
cd /workspace/Articles/src
docker compose -p articles   -f docker-compose.yml   -f docker-compose.override.yml   -f /workspace/github-Articles/docker-compose.local.yml   up -d sqlserver journals-redisdb postgres mongo-gridfs rabbitmq articlehub-hasura
```

结果：`up_exit=0`。容器与本机端口：

| 容器 | 镜像（tag） | 本机端口 |
| --- | --- | --- |
| articles-sqlserver-1 | `mcr.microsoft.com/mssql/server:latest` | 1433 |
| articles-postgres-1 | `postgres:latest` | 5432（healthy） |
| articles-journals-redisdb-1 | `redis/redis-stack:latest` | 6379、8801 |
| mongo-gridfs | `mongo:6.0` | 27018→27017 |
| rabbitmq（hostname `articles-mq`） | `rabbitmq:management` | 5672、15672 |
| articles-articlehub-hasura-1（随后被替换，见问题 3） | `hasura/graphql-engine` | 4493→8080 |

从宿主机探测 5432 / 1433 / 5672 / 6379 均可达。Redis `PING` 返回 `PONG`。SQL Server 日志出现 “SQL Server is now ready for client connections” 与 “Recovery is complete”。eShop 的 5 个容器仍为 Up。

### 5. 启动 API（宿主机进程，HTTP）

为避免开发证书和与 eShop 抢 HTTPS 端口，本次只绑 HTTP：4401–4405。把 docker 内部主机名改成环回地址（环境变量，不改源码）：

```bash
export ASPNETCORE_ENVIRONMENT=Development
unset DOTNET_ROLL_FORWARD
export RabbitMqOptions__Host='amqp://127.0.0.1:5672'
export HasuraOptions__BaseUrl='http://127.0.0.1:4493/'
export GrpcServicesOptions__Services__Person__Url='http://127.0.0.1:4401'
export ConnectionStrings__MongoFileStorage='mongodb://root:<DEV_DB_PASSWORD>@127.0.0.1:27018/gridfs_db?authSource=admin'
export ConnectionStrings__SubmissionFileStorage='mongodb://root:<DEV_DB_PASSWORD>@127.0.0.1:27018/gridfs_db?authSource=admin'

# 示例：Auth
cd /workspace/Articles/src/Services/Auth/Auth.API
dotnet run --no-build -c Debug --no-launch-profile --urls 'http://127.0.0.1:4401'
# Journals 4402、ArticleHub 4403、Submission 4404、Review 4405 同样方式
```

结果：五个进程均报告 `Application started` 并监听预定端口。Auth 在启动时执行了 `Migrate` 与 `SeedTestData`。Journals / ArticleHub / Submission / Review 的 Swagger JSON 均返回 HTTP 200。日志中有两类非致命错误：

- ArticleHub 第一次查 `__EFMigrationsHistory` 失败（库是新建的），随后成功应用 `20250929193737_InitialCreate`。
- Submission / Review 种子阶段对部分表执行 `DBCC CHECKIDENT(..., RESEED, 0)` 失败，提示表没有 identity 列（例如 `Journal`）。服务仍继续启动，MassTransit 消费者已注册。

### 6. HTTP / API 验证

| 检查 | 结果 |
| --- | --- |
| `GET http://127.0.0.1:4401/swagger/v1/swagger.json` | 200 |
| `POST http://127.0.0.1:4401/api/tokens`（管理员种子账号） | 200，返回 `email` / `jwtToken` / `refreshToken`（令牌不写入本文） |
| `GET http://127.0.0.1:4401/api/users/me`（带 Bearer） | 200，`email=dotnetlabx@articles.test`，`roles=['USERADMIN']` |
| `GET http://127.0.0.1:4402/api/journals`（无令牌） | 401 |
| `GET http://127.0.0.1:4402/api/journals`（带令牌） | 200，`totalCount=7` |
| ArticleHub / Submission / Review `/swagger/v1/swagger.json` | 200 |
| `GET http://127.0.0.1:4493/healthz`（替换网络后的 Hasura） | 200，正文 `OK` |
| RabbitMQ 管理页 `http://127.0.0.1:15672` | 可打开登录页 |

登录路径是 FastEndpoints 实际映射的 **`/api/tokens`**，不是属性上写的 `/tokens`（直接 POST `/tokens` 为 404）。Postman 环境使用 HTTPS `4441–4445`；本次为 HTTP `4401–4405`。

### 7. 截图

使用 eShop 目录里已安装的 Playwright，**无窗口 headless** 截图（未关闭 eShop 的 Playwright 窗口，也未占用桌面浏览器），保存在 `github-Articles/screenshots/`：

- `auth-swagger.png`、`journals-swagger.png`、`articlehub-swagger.png`、`submission-swagger.png`、`review-swagger.png`
- `hasura-console.png`（`/console`）
- `rabbitmq-management.png`

### 8. 访问地址（仅本机）

这些地址开在助手的 Linux 电脑上，用户的 Mac 默认访问不到。

| 服务 | 地址 |
| --- | --- |
| Auth.API | http://127.0.0.1:4401/swagger ，登录 `POST /api/tokens` |
| Journals.API | http://127.0.0.1:4402/swagger ，`GET /api/journals` |
| ArticleHub.API | http://127.0.0.1:4403/swagger |
| Submission.API | http://127.0.0.1:4404/swagger |
| Review.API | http://127.0.0.1:4405/swagger |
| Hasura Console / health | http://127.0.0.1:4493/console ，http://127.0.0.1:4493/healthz |
| RabbitMQ Management | http://127.0.0.1:15672（开发用户 `guest`） |
| Postgres / SQL Server / Redis / Mongo | 127.0.0.1:5432 / 1433 / 6379 / 27018 |

### 9. 问题与处理

1. **Compose 插件缺失。** 已安装 v5.7.1。
2. **需要 .NET 9 运行时；不能用 .NET 10 roll-forward 跑 Auth。** 已安装 9.0.23。
3. **Docker 新网桥上容器互访超时。** 从 `articlehub-hasura` 容器访问 `postgres:5432` 出现 `Connection timed out`（SYN_SENT）。宿主机访问已发布端口正常。可能与本机 Docker 为静态安装、iptables-legacy 与 nft 并存有关，未再改系统防火墙，以免影响 eShop。处理：停掉 compose 里的 Hasura，改用 `--network host` 启动，数据库 URL 指向 `127.0.0.1:5432`，监听端口 4493。之后 `/healthz` 返回 OK。日志里仍有 “source default has not been initialized yet”，表结构要等 ArticleHub 迁移之后再在控制台 track；未完成自动 metadata 初始化（上游 compose 里的 `hasura-init` 也是注释掉的）。
4. **Dockerfile 不足以直接 `compose up` 业务 API。** SDK 8 vs net9、COPY 不完整、ENTRYPOINT 变量不展开。本次走宿主机 `dotnet run`。
5. **Postgres 健康检查与实际用户/库不一致。** 用 `docker-compose.local.yml` 覆盖。
6. **`${APPDATA}` 在 Linux 上为空。** 启动前设置到临时目录。
7. **API 网关与 Production 未启动。** 网关不在 compose，且端口表过时；Production 在 compose 中被注释。
8. **未验证的部分：** 真实 SMTP / SendGrid / Azure Blob；Submission 上传到 GridFS 的完整文件链路；服务间 gRPC（已把 Person 地址指到本机 HTTP，但未单独做 gRPC 探活）；Hasura 表自动 track。
9. **种子与演示密钥。** 只使用仓库开发默认值。公开文档用占位符，不写令牌、库口令、JWT Secret、SMTP 口令。

### 10. 如何停止（不要误停 eShop）

```bash
# 只停 Articles 的 API 进程（不要 aspire stop）
# 日志目录中有各服务 pid 文件：/tmp/articles-logs/*.pid
kill $(cat /tmp/articles-logs/*.pid)

# 只停 Articles 的 Compose 项目
cd /workspace/Articles/src
docker compose -p articles down
docker rm -f articles-hasura   # 若使用了 host 网络的 Hasura
```

不要对 eShop 执行 `aspire stop`，也不要 `docker rm` 名为 `postgres-3acade60`、`eventbus-3acade60`、`redis-tbyuchgm`、`mobile-bff-*` 的容器。

### 11. 本次结论

**部署运行基本成功（部分组件）：** 中间件和 5 个核心 API（Auth、Journals、ArticleHub、Submission、Review）已在本机运行，Swagger 可打开，Auth 登录与 Journals 列表 API 已用种子管理员验证通过。Hasura 在改为 host 网络后健康检查正常。未启动 Production 与 ApiGateway。eShop 全程保持运行。

**结果：Articles Step 1 已完成，未推送仓库 ✅**

---

## Step 2：架构设计分析（2026-11-15 10:42，Asia/Shanghai UTC+8）

目标：基于真实源码撰写 Articles 的微服务架构设计分析，正文不少于 1 万字（中文字符 + 英文单词，不计代码块、不计纯路径/命令行），直接写成完整长文，不先出简短 v1。

### 做了什么

- 再次确认源码提交仍为 `63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721`（`master`），**未执行 `git pull`，未修改 `/workspace/Articles` 任何文件**。
- 阅读 `github-Articles/Articles-steps.md`、`github-Articles/README.md`，以及上游 `src/Directory.Packages.props`、全部服务 `Program.cs` / 组成根、BuildingBlocks、Modules、集成事件与 gRPC 契约、compose、Dockerfile、appsettings（摘录时脱敏）。风格对照 eShop 的 `architecture-v2.md`。
- **未重新部署，未停止** 仍在监听的 Articles API（4401–4405）与 Hasura（4493），也未停止 eShop Aspire。
- 写成完整文档 [`architecture.md`](./architecture.md)，放入本目录，**不含 Articles 源码拷贝**。未提交、未推送 GitHub。

### 依据与产出

| 项 | 内容 |
| --- | --- |
| 源码 | `/workspace/Articles`，提交 `63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721` |
| 输出路径 | `/workspace/github-Articles/architecture.md` |
| 正文字数 | 17,753（中文字符 + 英文单词；不计代码块、不计纯路径/命令行） |
| 是否 ≥ 10,000 | 是 |
| 源码摘录 | 70 段，均带相对路径；配置中的 JWT 秘钥、库口令、Hasura Admin Secret、种子口令、Azure 存储密钥、SMTP 口令已替换为占位符 |
| 结构 | 技术选型、项目框架、服务拆分、模块通信、认证授权、数据一致性/状态机/文件、配置与环境、开发、部署、测试、已知限制、模式总结与规划建议，另有三张 mermaid 图与附录文件清单 |

### 从代码确认的主要结论（详见 architecture.md）

- 按投稿生命周期拆分限界上下文；数据库每服务一份；同步点查走 gRPC，跨上下文状态变化走 MassTransit / RabbitMQ；ArticleHub 用 Hasura GraphQL 做读模型。
- 不是 Aspire，目标框架一律 `net9.0`。HTTP 同时存在 FastEndpoints、Carter、手写 Minimal API 三种写法（教学仓库有意保留多样性）。
- 仓库内**没有**测试项目和 CI 工作流，也**没有** OpenTelemetry / 健康检查端点；未启用 MassTransit Outbox。
- Step 1 已记录的限制在文中保留：上游 Dockerfile 不适合直接构建、ApiGateway 端口表过时且默认未启动、`production-api` 在 compose 中被注释、Postgres 健康检查与真实用户/库不一致。

**结果：Articles 架构分析文档已写完，未推送仓库。**
