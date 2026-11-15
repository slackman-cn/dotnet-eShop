# Articles 从零搭建 Quickstart

这是一份从零开始在本机跑起 [ldumit/Articles](https://github.com/ldumit/Articles) 的操作手册，不是架构论文。

- **上游仓库：** https://github.com/ldumit/Articles.git
- **对照提交：** [`63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721`](https://github.com/ldumit/Articles/commit/63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721)（分支 `master`）
- **本机研究环境：** Linux；Step 1 已用 Docker Compose 拉起中间件，再用宿主机 `dotnet run` 启动 5 个业务 API，并验证登录与期刊列表。
- **启动方式：这不是 Aspire。** 推荐路径是 Compose 只跑中间件，API 在宿主机用 `dotnet run`。上游 Dockerfile 目前不适合直接 `compose up` 业务镜像（见第 5 节）。

---

## 1. 开发环境与 IDE

上游根目录 `readme.md` 在该提交上是空的，没有写“必须使用某 IDE”。解决方案和项目文件里能看到 Visual Studio / Docker 相关元数据，因此把它写成最贴上来源的选择，而不是唯一允许的工具。

### 必需软件

| 组件 | 仓库事实 | 本机 Step 1 已验证的版本 |
| --- | --- | --- |
| OS | 上游 compose 与 Dockerfile 面向 Linux 容器；也可在 Windows / macOS 上用 Docker 开发。本机实测为 Linux。 | Linux |
| .NET SDK / 运行时 | 全部项目目标框架为 `net9.0`（`src/Directory.Packages.props` 中 ASP.NET / EF 包为 9.0.8） | 机器上已有 .NET 10 SDK，**必须再装 .NET 9 运行时**。本机使用 ASP.NET Core / .NET 运行时 **9.0.23**。仅用 .NET 10 做 `DOTNET_ROLL_FORWARD=LatestMajor` 跑 Auth 时，迁移会抛出 `PendingModelChangesWarning` 并退出 |
| Docker Engine + Compose 插件 | 启动路径依赖 `src/docker-compose.yml` 与 `docker-compose.override.yml` | Docker 引擎与本机其它项目共用；补装了 Compose **v5.7.1**（`docker compose version`） |
| Git | 克隆仓库 | 可用本机 git |

### IDE（不要写成“必须用某一个”）

- **Visual Studio** 是仓库项目文件里最明确的路径：`*.csproj` 含 `Microsoft.VisualStudio.Azure.Containers.Tools.Targets`、`DockerfileContext`、`DockerComposeProjectPath`；`src/docker-compose.dcproj` 存在；`Auth.API` 等的 `launchSettings.json` 带有 `Container (Dockerfile)`、`WSL` 配置；根 `src/launchSettings.json` 有 `Docker Compose` 配置文件（注意它只写了启动 `production-api`，与默认被注释的 compose 状态不一致，见第 5 节）。用 Visual Studio 打开 `src/Articles.sln` 是上游留下的入口。
- 仓库文档没有指定 **Visual Studio Code** 或 **Rider**。只要本机 SDK / 运行时满足 `net9.0`，用它们打开解决方案也可以，但不要把某款扩展写成官方要求。
- 即便用 Visual Studio 的 Docker Compose 启动，也请先阅读第 5 节：上游业务 Dockerfile 目前不能干净构建，本机验证过的是“Compose 只起中间件 + 宿主机 `dotnet run`”。

---

## 2. 依赖的中间件（docker-compose 格式）

真实依赖的中间件（来自 `src/docker-compose.yml` + `docker-compose.override.yml`，以及 Step 1 拉到的镜像标签）是：

| 服务名 | 镜像（上游写法 → Step 1 实际 tag） | 主机端口 | 用途 |
| --- | --- | --- | --- |
| `sqlserver` | `mcr.microsoft.com/mssql/server`（未钉标签）→ `mcr.microsoft.com/mssql/server:latest` | 1433 | Auth / Submission / Review（及未默认启动的 Production）的 SQL Server |
| `postgres` | `postgres`（未钉标签）→ `postgres:latest` | 5432 | ArticleHub 库 `ArticleHubDb`；Hasura 也连同一库 |
| `journals-redisdb` | `redis/redis-stack`（未钉标签）→ `redis/redis-stack:latest` | 6379、8801 | Journals 主存储与搜索 |
| `mongo-gridfs` | `mongo:6.0`（上游写明） | 27018→27017 | Submission / Review 的 GridFS |
| `rabbitmq` | `rabbitmq:management`（上游写明） | 5672、15672 | 集成事件；管理页 15672。compose 中 `hostname: articles-mq` |
| `articlehub-hasura` | `hasura/graphql-engine`（未钉标签） | 4493→8080 | ArticleHub 的 GraphQL 引擎与控制台 |

下面是**建议在本地使用的完整中间件 compose**（只含中间件，不含 5 个 API、不含被注释的 `production-api`、不含 ApiGateway）。请先把所有 `<DEV_DB_PASSWORD>`、`<HASURA_ADMIN_SECRET>` 换成自己的开发值再启动；不要把真实密钥提交进仓库。

与上游原文件的差异：

1. **去掉业务 API 服务**（`auth-api` 等）。上游把它们写在同一份 compose 里，但 Dockerfile 目前不能直接构建，本机验证路径是宿主机跑 API。
2. **修正 Postgres 健康检查。** 上游 `docker-compose.yml` 为 `pg_isready -U app -d articles`，与 override 中 `POSTGRES_USER=postgres`、`POSTGRES_DB=ArticleHubDb` 不一致，检查会一直失败。这里与 [docker-compose.local.yml](./docker-compose.local.yml) 相同，改为 `pg_isready -U postgres -d ArticleHubDb`。
3. **不依赖 `${APPDATA}` 卷。** 上游 override 为 API 容器挂了 Windows 风格的 UserSecrets / HTTPS 证书目录；这份中间件文件没有这些卷。若仍用上游文件启动 API 容器，Linux 上需先设置 `APPDATA`（见第 5 节）。
4. **默认发布端口、库名、Hasura 开关与上游 override 保持一致**（1433、5432、6379/8801、27018、5672/15672、4493；`ArticleHubDb`；控制台与 `graphql-default` 命名约定）。
5. **不包含已被注释的 `production-api` 和 `hasura-init`。**

本目录的 [docker-compose.local.yml](./docker-compose.local.yml) **仍然只是健康检查覆盖文件**，供叠加在上游两份 compose 上使用（与 Step 1 相同），避免再维护一份互相不一致的完整文件。从零搭建若只想起中间件，可以直接使用下面这份独立 YAML（复制到临时文件，替换口令后 `docker compose up -d`），或继续用第 3.3 节的“上游文件 + 本目录覆盖”命令。

```yaml
# 建议本地使用的 Articles 中间件 compose（完整可读版本）
# 与上游差异见上文；健康检查修正与 docker-compose.local.yml 一致。

services:
  sqlserver:
    image: mcr.microsoft.com/mssql/server
    environment:
      - ACCEPT_EULA=Y
      - SA_PASSWORD=<DEV_DB_PASSWORD>
    ports:
      - "1433:1433"

  postgres:
    image: postgres
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=<DEV_DB_PASSWORD>
      - POSTGRES_DB=ArticleHubDb
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d ArticleHubDb"]
      interval: 5s
      timeout: 3s
      retries: 30

  journals-redisdb:
    image: redis/redis-stack
    ports:
      - "6379:6379"
      - "8801:8801"

  mongo-gridfs:
    image: mongo:6.0
    environment:
      MONGO_INITDB_ROOT_USERNAME: root
      MONGO_INITDB_ROOT_PASSWORD: <DEV_DB_PASSWORD>
    ports:
      - "27018:27017"

  rabbitmq:
    image: "rabbitmq:management"
    hostname: articles-mq
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      # 与上游 override 一致：RabbitMQ 开发默认账户。业务配置里的口令请用占位符保管。
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest

  articlehub-hasura:
    image: hasura/graphql-engine
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      - HASURA_GRAPHQL_DATABASE_URL=postgres://postgres:<DEV_DB_PASSWORD>@postgres:5432/ArticleHubDb
      - HASURA_GRAPHQL_ADMIN_SECRET=<HASURA_ADMIN_SECRET>
      - HASURA_GRAPHQL_ENABLE_CONSOLE=true
      - HASURA_GRAPHQL_EXPERIMENTAL_FEATURES=naming_convention
      - HASURA_GRAPHQL_DEFAULT_NAMING_CONVENTION=graphql-default
    ports:
      - "4493:8080"
```

说明：上游没有给 SQL Server 写 healthcheck，这份 YAML 也不另造一条。可以像 Step 1 那样看日志里的 “SQL Server is now ready for client connections”。Hasura 在部分 Docker 网络下可能连不上 `postgres` 主机名，见第 5 节。

RabbitMQ 的 `guest` / `guest` 是上游 override 与 `RabbitMqOptions` 的开发默认值，不是另外生成的秘钥。其它口令一律用占位符。

---

## 3. 从零搭建步骤

### 3.1 安装依赖

```bash
dotnet --list-sdks
dotnet --list-runtimes
# 需要有 net9.0 的 Microsoft.NETCore.App / Microsoft.AspNetCore.App。
# 本机实测运行时：9.0.23
# 若只有 .NET 10 SDK：不要依赖 DOTNET_ROLL_FORWARD=LatestMajor 去跑 Auth 迁移。

docker compose version
# 本机实测：Docker Compose version v5.7.1
```

Windows / macOS 上安装 .NET 9 SDK 通常已包含运行时。Linux 上如果已经装了更新的 SDK，仍要单独安装 9.0 运行时。

### 3.2 克隆代码

```bash
git clone https://github.com/ldumit/Articles.git
cd Articles
# 若要与本文对照提交完全一致：
# git checkout 63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721
```

业务代码在 `src/`，解决方案为 `src/Articles.sln`。

可选编译（本机用 .NET 10 SDK 编译 net9.0 成功，有警告无错误）：

```bash
cd src
dotnet restore Articles.sln
dotnet build Articles.sln -c Debug
```

### 3.3 启动中间件

**本机已验证的方式：** 使用上游两份 compose，再叠加本目录的健康检查覆盖。不要在这一步 `up` 业务 API 服务。

```bash
# Linux：即使这次只起中间件，若以后仍用上游 override 起 API 容器，也建议先设 APPDATA
export APPDATA=/tmp/articles-appdata
mkdir -p "$APPDATA/Microsoft/UserSecrets" "$APPDATA/ASP.NET/Https"

cd /path/to/Articles/src
docker compose -p articles \
  -f docker-compose.yml \
  -f docker-compose.override.yml \
  -f /path/to/github-Articles/docker-compose.local.yml \
  up -d sqlserver journals-redisdb postgres mongo-gridfs rabbitmq articlehub-hasura
```

把 `/path/to/github-Articles/docker-compose.local.yml` 换成你放置覆盖文件的实际路径。覆盖文件只改 Postgres 健康检查，与上一节完整 YAML 中的检查一致。

检查：

```bash
docker compose -p articles ps
# Postgres 应为 healthy；1433 / 5432 / 6379 / 27018 / 5672 / 15672 / 4493 应在监听。
```

若你改用上一节的独立 YAML，先替换占位符，再在该文件所在目录执行 `docker compose -f <文件> up -d`，不要再与上游两份文件同时叠加，以免重复定义服务。

**端口提醒：** 本机 eShop Aspire 的中间件走高位端口，不占用 5432 / 6379 / 5672 / 1433，因此 Articles 可以用这些默认端口且不必停 eShop。若这些端口已被占用，先改映射再改连接串。

### 3.4 启动业务 API（宿主机 `dotnet run`）

上游 `appsettings.json` 里，RabbitMQ、Hasura、gRPC、Mongo 常用 Docker 主机名（`articles-mq`、`articlehub-hasura`、`auth-api`、`mongo-gridfs`）。进程跑在宿主机时，必须用环境变量改到环回地址（**不要改仓库源码**）。本机为避免开发证书以及和 eShop 抢 HTTPS 端口，只绑定 HTTP `4401–4405`。

```bash
export ASPNETCORE_ENVIRONMENT=Development
unset DOTNET_ROLL_FORWARD
export RabbitMqOptions__Host='amqp://127.0.0.1:5672'
export HasuraOptions__BaseUrl='http://127.0.0.1:4493/'
export GrpcServicesOptions__Services__Person__Url='http://127.0.0.1:4401'
export GrpcServicesOptions__Services__Journal__Url='http://127.0.0.1:4402'
export ConnectionStrings__MongoFileStorage='mongodb://root:<DEV_DB_PASSWORD>@127.0.0.1:27018/gridfs_db?authSource=admin'
export ConnectionStrings__SubmissionFileStorage='mongodb://root:<DEV_DB_PASSWORD>@127.0.0.1:27018/gridfs_db?authSource=admin'
```

`Journal` 的 gRPC 地址是按 `appsettings.json` 的配置项补上的，便于 Submission 在需要时调用；Step 1 记录里明确设置过 Person 地址，**未单独做 gRPC 探活**。Mongo 口令与 compose 中 `MONGO_INITDB_ROOT_PASSWORD` 保持一致。

各 API 的 `launchSettings.json` HTTP 端口与 compose override 一致。启动示例（可先 `dotnet build`，再 `--no-build`）：

```bash
# Auth  4401
cd src/Services/Auth/Auth.API
dotnet run -c Debug --no-launch-profile --urls 'http://127.0.0.1:4401'

# Journals  4402
cd src/Services/Journals/Journals.API
dotnet run -c Debug --no-launch-profile --urls 'http://127.0.0.1:4402'

# ArticleHub  4403
cd src/Services/ArticleHub/ArticleHub.API
dotnet run -c Debug --no-launch-profile --urls 'http://127.0.0.1:4403'

# Submission  4404
cd src/Services/Submission/Submission.API
dotnet run -c Debug --no-launch-profile --urls 'http://127.0.0.1:4404'

# Review  4405
cd src/Services/Review/Review.API
dotnet run -c Debug --no-launch-profile --urls 'http://127.0.0.1:4405'
```

开发环境启动时，Auth / Submission / Review 会执行 `Database.Migrate()` 并种子数据；Journals 会建 Redis 索引并种子期刊。不要同时启动多份同一 API。

**默认不要启动** `production-api`（上游 compose 已整段注释）和 `ApiGateway`（不在 compose 内，且路由端口表已过时：例如把 submission 指到 4403，而 4403 实际是 ArticleHub）。

### 3.5 验证访问

本机 Step 1 已验证：

| 目标 | 地址 / 动作 | 结果 |
| --- | --- | --- |
| Auth Swagger | http://127.0.0.1:4401/swagger | UI 可打开；`/swagger/v1/swagger.json` 为 200 |
| 登录 | `POST http://127.0.0.1:4401/api/tokens` | 200，返回 jwt 与 refresh token（不要写入共享文档）。路径必须是 **`/api/tokens`**，直接 `POST /tokens` 是 404 |
| 当前用户 | `GET http://127.0.0.1:4401/api/users/me`（Bearer） | 200，种子管理员邮箱 `dotnetlabx@articles.test`，角色 `USERADMIN` |
| Journals | `GET http://127.0.0.1:4402/api/journals` | 无令牌 401；带令牌 200，`totalCount=7` |
| 其它 Swagger | http://127.0.0.1:4403/swagger 、4404、4405 | Swagger JSON 为 200 |
| Hasura | http://127.0.0.1:4493/healthz 、/console | 在处理网络问题后 healthz 为 OK |
| RabbitMQ 管理页 | http://127.0.0.1:15672 | 上游开发用户 `guest` |

种子用户口令定义在 `src/Services/Auth/Auth.Persistence/Data/Test/Seed.cs`，公开文档写作 `<SEED_DEFAULT_PASSWORD>`。管理员邮箱见上。

登录示例（把口令换成你的开发种子值，不要把它提交到 git）：

```bash
curl -s -X POST http://127.0.0.1:4401/api/tokens \
  -H 'Content-Type: application/json' \
  -d '{"email":"dotnetlabx@articles.test","password":"<SEED_DEFAULT_PASSWORD>"}'
```

### 3.6 停止

只停 Articles，不要误停 eShop 的 Aspire 容器：

```bash
# 停掉本机 dotnet 进程（若你自行记录了 PID，用 PID；不要 aspire stop）
# 停中间件：
cd /path/to/Articles/src
docker compose -p articles down
# 若按第 5 节用 host 网络另起过 Hasura：
# docker rm -f articles-hasura
```

---

## 4. 常见问题与注意事项

1. **必须使用 .NET 9 运行时。** 用 .NET 10 roll-forward 跑 Auth 迁移会遇到 `PendingModelChangesWarning`。
2. **Postgres 健康检查。** 务必使用 `pg_isready -U postgres -d ArticleHubDb`，或叠加 `docker-compose.local.yml`。
3. **Hasura 在新 Docker 网桥上连不上 Postgres。** Step 1 出现过容器访问 `postgres:5432` 超时（`SYN_SENT`），宿主机访问已发布的 5432 正常。处理是停掉 compose 中的 Hasura，改用 `--network host` 启动，数据库 URL 指向 `127.0.0.1:5432`，监听 4493，之后 `/healthz` 返回 OK。完整 `docker run` 命令没有逐字记入步骤记录；复现时环境变量应与 override 一致（`HASURA_GRAPHQL_DATABASE_URL`、`HASURA_GRAPHQL_ADMIN_SECRET`、控制台与命名约定）。即便 healthz 正常，元数据自动 track 仍可能未完成（上游 `hasura-init` 也是注释状态），表要等 ArticleHub 迁移后再在控制台 track。
4. **上游 Dockerfile 不适合直接构建业务 API。** 构建阶段用 `sdk:8.0` 但目标是 net9.0；`COPY` 往往只有单个 API 目录，缺少 BuildingBlocks 与 `Directory.Packages.props`；`ENTRYPOINT` 的 exec 形式不会展开 `${APP_NAME}`。本机验证路径是宿主机 `dotnet run`。
5. **Linux 上 `${APPDATA}` 为空。** 叠加上游 override 时先导出到临时目录，否则 UserSecrets 卷规格无效。
6. **登录路径是 `/api/tokens`，不是 `/tokens`。** FastEndpoints 的路由前缀为 `api`。Postman 环境使用 HTTPS `4441–4445`；本机实测是 HTTP `4401–4405`。
7. **不要默认启动 Production 与 ApiGateway。** 前者在 compose 中被注释；后者端口表过时且 `Program.cs` 仍有 `todo add authentication`。
8. **开发配置里的主机名。** 宿主机跑 API 时必须改 RabbitMQ / Hasura / gRPC / Mongo 地址，否则会去解析 `articles-mq` 等容器 DNS。
9. **未在 Step 1 单独验证的部分：** 真实 SMTP / SendGrid / Azure Blob、完整 GridFS 文件往返、服务间 gRPC 探活、Hasura 自动 track。
10. **与 eShop 并存。** 停 Articles 时不要执行 `aspire stop`，也不要删除名称类似 `postgres-3acade60`、`eventbus-3acade60`、`redis-tbyuchgm`、`mobile-bff-*` 的 eShop 容器。

更完整的架构说明见 [architecture.md](./architecture.md)，逐步排错过见 [Articles-steps.md](./Articles-steps.md)。
