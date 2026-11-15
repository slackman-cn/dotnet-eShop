# eShop 从零搭建 Quickstart

这是一份从零开始在本机跑起 [dotnet/eShop](https://github.com/dotnet/eShop) 的操作手册，不是架构论文。

- **上游仓库：** https://github.com/dotnet/eShop
- **对照提交：** [`913acea66708a59595351174cee9b29f37179d29`](https://github.com/dotnet/eShop/commit/913acea66708a59595351174cee9b29f37179d29)（分支 `main`）
- **本机研究环境：** Linux；Step 1–3 已在同一台机器上用 Aspire 跑通，17 个资源均为 Running / Healthy。本文命令以官方 README 与那次实测为准。
- **重要前提：官方本地启动路径是 .NET Aspire（`aspire run` / `aspire start`），不是 `docker compose up` 整套业务堆栈。** 下面的 compose 只描述中间件合约，不包含 WebApp 或各 API。

---

## 1. 开发环境与 IDE

仓库根目录 [`README.md`](https://github.com/dotnet/eShop/blob/main/README.md) 把 IDE 写成 **Optional IDE setup**，因此没有“必须使用某一款 IDE”的要求。用终端 + Aspire CLI 即可启动。

### 必需软件

| 组件 | 仓库要求 | 本机 Step 记录已验证的版本 |
| --- | --- | --- |
| OS | README 要求有可用的 OCI 容器运行时；Windows / macOS / Linux 均可。本机实测为 Linux。 | Linux |
| .NET SDK | [`global.json`](https://github.com/dotnet/eShop/blob/main/global.json) 指定 SDK `10.0.302`，`rollForward: latestFeature`，`allowPrerelease: false` | **10.0.303**（符合 rollForward） |
| Aspire SDK / CLI | 根目录 `aspire.config.json` 与 AppHost 使用 `Aspire.AppHost.Sdk/13.6.0`；README 要求安装 [Aspire CLI](https://aspire.dev/get-started/install-cli/) | AppHost SDK **13.6.0**，CLI **`aspire --version` → 13.6.5** |
| 容器运行时 | README 推荐 [Docker Desktop](https://www.docker.com/products/docker-desktop/)，也支持 [Podman](https://podman.io/docs/installation)（需按 Aspire 文档配置） | Docker **29.9.3**。本机是静态安装的引擎，还需 **Docker Buildx 0.39.0** 并启用 BuildKit，否则 `mobile-bff` 的隧道镜像构建会失败（见第 5 节） |
| Git | 克隆仓库 | 本机曾使用 git 2.47.3 |

README 写明：不必再单独安装 Aspire workload 或某个 Visual Studio 组件；AppHost SDK 与托管集成已经由仓库项目引用。

### 可选：IDE 与插件（以仓库 README 为准）

- **Visual Studio**，勾选 `ASP.NET and web development` 工作负载。启动方式：打开 `eShop.Web.slnf`，把 `src/eShop.AppHost/eShop.AppHost.csproj` 设为启动项目，按 Ctrl+F5，会打开 Aspire 仪表板。
- **Visual Studio Code** + [C# Dev Kit](https://code.visualstudio.com/docs/csharp/get-started) + [Aspire 扩展](https://aspire.dev/get-started/aspire-vscode-extension/)。
- 若要跑移动客户端，再安装 [.NET MAUI workload](https://learn.microsoft.com/dotnet/maui/get-started/installation)。默认 `aspire run` **不会**把 MAUI / Hybrid 客户端纳入编排。

仓库没有提到 Rider，因此本文不把它写成必需或官方推荐。

### 可选：Node.js（仅端到端测试）

跑 Playwright 浏览旅程时才需要（`npm ci`、`npx playwright install chromium`、`npm run test:e2e`）。本机 Step 1 已有 Node v24.22.1、npm 11.21.1；上游 CI 使用 Node LTS。只启动网站不必装 Node。

---

## 2. 依赖的中间件（docker-compose 格式）

AppHost（`src/eShop.AppHost/AppHost.cs`）声明了三样中间件，并在其上创建四个 Postgres 数据库：

- `postgres`：`.WithImage("ankane/pgvector").WithImageTag("latest")`，`ContainerLifetime.Persistent`；数据库名为 `catalogdb`、`identitydb`、`orderingdb`、`webhooksdb`
- `redis`：`builder.AddRedis("redis")`（代码未钉镜像）
- `eventbus`：`builder.AddRabbitMQ("eventbus").WithLifetime(ContainerLifetime.Persistent)`（代码未钉镜像）

本机 Step 1 实测 Aspire 拉到的镜像是 **`ankane/pgvector:latest`**、**`redis:8.6`**、**`rabbitmq:4.3`**。Aspire 会为这些容器分配随机主机端口（例如当时 Postgres 为 `localhost:28956`，RabbitMQ 为 `localhost:28955`，Redis 为 `127.0.0.1:32772` 等），并自动把连接串注入各服务。

下面这份 compose 与独立文件 [docker-compose.middleware.yml](./docker-compose.middleware.yml) 内容相同，是中间件合约，方便阅读和在“自备基础设施”时对照。初始化脚本见 [docker-compose.middleware.init.sql](./docker-compose.middleware.init.sql)。

**请不要把它当成官方全栈启动方式。** 默认实践仍是只跑 `aspire run`：Aspire 自己会拉起等价容器。若你改用这份 compose：

1. 先把 `<DEV_DB_PASSWORD>` 换成自己的开发口令；
2. 不要与正在运行的 `aspire start` 抢同一套主机端口（5432 / 6379 / 5672）。本机研究环境里，eShop 的 Aspire 容器用的是高位端口，Articles 则占用了 5432 / 6379 / 5672，因此在已有 Articles 中间件的机器上直接按下面端口启动会冲突；
3. 必须把业务进程的连接串改成与 compose 一致（Aspire 默认注入的地址和口令与这份文件不是同一套）。Redis 在 Aspire 下还可能启用 TLS 与额外端口，本文件按常见开发方式只暴露明文 6379，**不能**假定可以和 Aspire 已生成的连接串互换。

```yaml
# 文件：github-eShop/docker-compose.middleware.yml
# eShop 中间件只读合约（不是官方启动方式）。

services:
  postgres:
    image: ankane/pgvector:latest
    container_name: eshop-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: "<DEV_DB_PASSWORD>"
      POSTGRES_DB: postgres
    ports:
      - "5432:5432"
    volumes:
      - eshop-postgres-data:/var/lib/postgresql/data
      - ./docker-compose.middleware.init.sql:/docker-entrypoint-initdb.d/01-databases.sql:ro
    healthcheck:
      # AppHost 未提供 compose 健康检查；这是为独立启动本文件而加的标准探测。
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 20

  redis:
    image: redis:8.6
    container_name: eshop-redis
    ports:
      - "6379:6379"
    volumes:
      - eshop-redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

  eventbus:
    image: rabbitmq:4.3
    container_name: eshop-eventbus
    ports:
      - "5672:5672"
    volumes:
      - eshop-rabbitmq-data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 20

volumes:
  eshop-postgres-data:
  eshop-redis-data:
  eshop-rabbitmq-data:
```

可选自备中间件的启动（仅在你明确不走 Aspire 拉容器、并已替换口令、且端口空闲时）：

```bash
# 在本文档所在目录
docker compose -f docker-compose.middleware.yml up -d
docker compose -f docker-compose.middleware.yml ps
```

---

## 3. 从零搭建步骤

### 3.1 安装依赖

1. 安装 [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)，使其满足 `global.json`（`10.0.302`，允许同一 feature band 向前滚动）。

   ```bash
   dotnet --version
   # 本机实测：10.0.303
   ```

2. 安装 [Aspire CLI](https://aspire.dev/get-started/install-cli/) 并确认：

   ```bash
   aspire --version
   # 本机实测：13.6.5
   ```

3. 安装并启动 Docker Desktop（或已按 Aspire 文档配置的 Podman）。

   ```bash
   docker version
   docker info
   ```

   若 `docker build --progress=plain` 报找不到 buildx（Linux 静态安装的 Docker 29.x 上出现过），需安装 Docker Buildx，并确保默认使用 BuildKit。否则后面的 `mobile-bff` 可能 `FailedToStart`。

### 3.2 克隆代码

```bash
git clone https://github.com/dotnet/eShop.git
cd eShop
# 若要与本文对照提交完全一致：
# git checkout 913acea66708a59595351174cee9b29f37179d29
```

根目录的 `aspire.config.json` 已经指向 `src/eShop.AppHost/eShop.AppHost.csproj`，可避免和测试项目里的其他 AppHost 混淆。

### 3.3 启动中间件

**默认（推荐）：不要单独启动上一节的 compose。** 下一步 `aspire run` 会按 AppHost 拉起 Postgres / Redis / RabbitMQ。

只有在你要自备基础设施时，才在替换口令、确认 5432 / 6379 / 5672 空闲后执行 `docker compose -f docker-compose.middleware.yml up -d`，并自行改连接串。本机实测没有走这条路径。

### 3.4 启动业务与编排（官方路径）

确认容器运行时已启动，然后在仓库根目录：

```bash
# 前台运行，日志直接打在终端；Ctrl+C 结束
aspire run
```

启动完成后，CLI 会打印类似下面的仪表板地址（**token 每次启动都会变**，不要把它写进共享文档）：

```text
Dashboard: https://localhost:<port>/login?t=<TOKEN_FROM_aspire_ps>
```

本机实测仪表板为：

```text
https://localhost:19888/login?t=<TOKEN_FROM_aspire_ps>
```

也可后台运行：

```bash
aspire start
aspire ps
# 全部结束后：
# aspire stop
```

从 Visual Studio 启动时：打开 `eShop.Web.slnf`，启动项目设为 `eShop.AppHost`，Ctrl+F5。

HTTPS 开发证书可用 `dotnet dev-certs https` 生成。本机已生成但**未**执行 `dotnet dev-certs https --trust`，浏览器可能提示证书不受信任；用 curl 时加 `-k`，或在 Playwright 中忽略 HTTPS 错误。

### 3.5 验证访问

本机 Step 3 在 `aspire start` 之后确认 17 个资源均为 Running / Healthy。当时对外地址如下（再次启动时，除 WebApp / 仪表板在 launchSettings 里写死的端口外，部分容器端口可能变化；以 `aspire ps` 为准）。

| 资源 | 本机实测地址 | 说明 |
| --- | --- | --- |
| WebApp | http://localhost:5045 → 307 到 https://localhost:7298 | `launchSettings` 的 https 配置为 `https://localhost:7298;http://localhost:5045`。首页标题 AdventureWorks，HTTP 200 |
| Aspire 仪表板 | https://localhost:19888/login?t=\<TOKEN_FROM_aspire_ps\> | AppHost `launchSettings` 中 `applicationUrl` 为 `https://localhost:19888;http://localhost:18848`。用 `aspire ps` 取当前 token |
| identity-api | http://localhost:5223 、https://localhost:5243 | `/health` 已在 AppHost 注册 |
| catalog-api | http://localhost:5222 | 网站目录走这条，不经过 mobile-bff |
| basket-api | http://localhost:5221（仅 HTTP/2） | 探活需 HTTP/2 |
| ordering-api | http://localhost:5224 | AppHost 注册了 `/health` |
| webhooks-api | http://localhost:5227 | |
| order-processor | http://localhost:16888 | |
| payment-processor | http://localhost:5226 | |
| webhooksclient | http://localhost:5062 、https://localhost:7260 | |
| mobile-bff | 当时 Aspire 公布 http://localhost:41469 、https://localhost:45357（容器端口会变） | 进程可为 Healthy，但经 BFF 访问 catalog 的 curl 曾超时，见第 5 节 |

登录种子账号定义在 `src/Identity.API/UsersSeed.cs`：用户名 `alice` 与 `bob`。口令见该文件中的常量，公开文档写作 `<SEED_DEFAULT_PASSWORD>`，不要把真实口令抄进共享笔记。

快速检查示例：

```bash
curl -k -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:5045/
curl -k -s -o /dev/null -w '%{http_code}\n' https://localhost:7298/
curl -k -s -o /dev/null -w '%{http_code}\n' http://localhost:5222/health
curl -k -s -o /dev/null -w '%{http_code}\n' http://localhost:5223/health
aspire ps
```

本机还用 Playwright 对 https://localhost:7298/ 与商品页 `/item/99` 截过图。服务若只监听 `127.0.0.1`，经出口代理的桌面浏览器可能打不开 localhost，这与站点本身是否启动成功不是同一件事。

### 3.6 可选：跑测试

```bash
# 服务端测试（README）
dotnet test --solution eShop.Web.slnf

# Playwright（会自己启动 AppHost，先确保容器运行时可用）
npm ci
npx playwright install chromium
npm run test:e2e
```

CI 里会设置 `ESHOP_USE_HTTP_ENDPOINTS=1`，使旅程走 HTTP。本机功能测试与单元测试的细节见架构文档与步骤记录，不是启动网站的前置条件。

---

## 4. 常见问题与注意事项

1. **不要把 docker-compose 当成官方全栈入口。** 业务进程、Identity、YARP `mobile-bff`、仪表板都由 Aspire 编排。中间件 compose 只是合约和自备基础设施时的对照。
2. **端口冲突。** 自备 compose 使用 5432 / 6379 / 5672；Aspire 默认用随机高位端口。两者同时启动且都去绑 5432 会失败。本机 Articles 中间件已经占用这些常规端口时，不要再按默认端口启动这份 eShop compose。
3. **`mobile-bff` 构建失败。** 缺少 Buildx 时，Aspire 为容器网络隧道执行 `docker build --progress` 会失败，资源状态 `FailedToStart`。装好 Buildx 并启用 BuildKit 后，需要 `aspire stop` 再 `aspire start` 才能清掉 DCP 对失败构建的缓存；只执行 `aspire resource mobile-bff start` 不够。
4. **`mobile-bff` 进程健康但 catalog 反代超时。** Step 3 上资源为 Running / Healthy，对 `/api/catalog/catalogBrands?api-version=1.0` 等路径的 curl 在 8–15 秒内超时。WebApp 走 catalog-api，不受这条路径影响。不要把 BFF 探活失败写成整站失败。
5. **HTTPS 证书未加入信任。** 本机未执行 `dotnet dev-certs https --trust`。
6. **仪表板 token 会变。** 每次启动 AppHost 都会重新生成，用 `aspire ps` 查看，不要把旧 token 写进文档。
7. **可选的 Foundry / Ollama。** README 中的 Azure Foundry 聊天与 AppHost 里的可选 AI 资源不是默认 `aspire run` 的前置，本文不展开。
8. **停止服务时要分清项目。** 停 eShop 用 `aspire stop`（或前台 Ctrl+C）。不要误删其他项目的容器，也不要在未确认的情况下 `docker rm` 名称像 `postgres-3acade60`、`eventbus-3acade60` 这类 Aspire 持久容器，除非你确实要重置 eShop 中间件。

更完整的架构说明见 [architecture-v2.md](./architecture-v2.md)，逐步排错过见 [eShop-steps.md](./eShop-steps.md)。
