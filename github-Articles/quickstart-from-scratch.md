# Articles 从零复现手册（quickstart-from-scratch）

这份文档说明的是：**不克隆现成仓库，如何从空白目录复现 Articles 这类投稿审稿系统**。若你只想把已经存在的 [ldumit/Articles](https://github.com/ldumit/Articles) 跑起来，请看同目录的 [quickstart.md](./quickstart.md)。

- **对照上游：** https://github.com/ldumit/Articles ，提交 [`63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721`](https://github.com/ldumit/Articles/commit/63ee8c086a69725c9ac5dbc3e7d8f9ce0dc00721)
- **架构依据：** [architecture.md](./architecture.md)
- **原则：** 下文同时写清「上游现在怎么做」和「从零复现时你该怎么做」。源码与 README **没有**声明本仓库是由某一个第三方脚手架一键生成的，不要那样假设。

建议在全新目录中操作（例如 `~/work/Articles-from-scratch`），不要写入正在运行的 `/workspace/Articles`。

---

## Step1: 准备开发环境

与 [quickstart.md](./quickstart.md) 开头相同，这里只保留从零复现必须的工具。版本以本机步骤记录为准。

| 组件 | 上游要求 | 本机已验证 |
| --- | --- | --- |
| OS | 能跑 Docker 即可 | Linux |
| .NET | 全部项目 `net9.0`；仓库没有 `global.json` | 安装 **.NET 9 SDK**（可同时保留 .NET 10）。本机另装了运行时 **9.0.23**：只用 .NET 10 而不装 9.0 运行时，Auth 的 EF 迁移会因 roll-forward 失败 |
| Docker + Compose 插件 | 中间件全部由 Compose 拉起 | Docker **29.9.3**，Compose 插件 **v5.7.1** |
| Git | 用于你自己的新仓库 | 本机 git 2.47.3 |

IDE（仓库没有强制指定）：Visual Studio 或 VS Code + C# Dev Kit 即可。不需要 Aspire CLI——上游不是 Aspire 项目。

本机 SDK 自带的官方模板（`dotnet new list` 已核对）包括：`sln`、`web`、`webapi`、`grpc`、`classlib`、`mstest`、`xunit`、`nunit`、`editorconfig`、`gitignore`、`packagesprops` 等。默认列表里没有 FastEndpoints / Carter / Aspire 短名称，那些要另外安装（见 Step2）。

```bash
dotnet --list-sdks
dotnet --list-runtimes | rg 'Microsoft.NETCore.App 9\.'
docker compose version
dotnet new list
```

Linux 上跑上游同类项目时，还要把 `APPDATA` 设成可写目录（上游 compose override 引用了 `${APPDATA}`；宿主机 `dotnet run` 时部分配置也依赖它）。从零复现同样建议：

```bash
export APPDATA="${APPDATA:-$HOME/.config}"
```

---

## Step2: 创建项目

### 2.1 上游现在怎么做

解决方案在 `src/Articles.sln`（另有一份 `src/Submission.sln`，从零时不必复制这个拆分）。布局是「BuildingBlocks + 按限界上下文拆分的服务 + 可选模块」：

| 类型 | 上游项目 | SDK / TFM | 从零时最接近的官方模板 |
| --- | --- | --- | --- |
| HTTP API | Auth.API、Journals.API、Submission.API、Production.API、ArticleHub.API、Review.API、ApiGateway | `Microsoft.NET.Sdk.Web` / `net9.0` | `webapi` 或 `web` |
| 层内类库 | 各服务的 Domain / Application / Persistence，以及 BuildingBlocks | `Microsoft.NET.Sdk` / `net9.0` | `classlib` |
| 文件 / 邮件模块 | FileService.MongoGridFS 等、EmailService.* | classlib | `classlib` |
| 测试 | **没有测试项目** | — | 从零必须补，推荐官方 `xunit` |

HTTP 风格在上游是混合的（教学仓库有意保留多样性）：

- **FastEndpoints 7.0.1：** Auth、Journals、Production（以及共享的 `Blocks.FastEndpoints`）
- **Carter 9.0.0：** ArticleHub.API、Review.API
- Submission 使用自己的 Endpoints 注册，并与 gRPC 客户端并存

同步查询用的是 **protobuf-net.Grpc**（代码优先），不是 `Grpc.Tools` 那种 `.proto` 优先栈。因此官方 `dotnet new grpc` **不能直接代表**上游 gRPC 项目。

中间件不由 Aspire 管理，而是 `src/docker-compose.yml` + `docker-compose.override.yml`。

### 2.2 官方 / 默认模板

推荐全部骨架都用 SDK 自带模板：`sln`、`packagesprops`、`editorconfig`、`webapi`、`classlib`、`xunit`。目标框架一律 `-f net9.0`。

官方 `grpc` 模板会生成 `.proto` + `Grpc.AspNetCore` 示例，适合验证「本机能否跑 gRPC」，但要复现 Articles 的代码优先契约，应在 `webapi` 上添加 `protobuf-net.Grpc.AspNetCore` 1.2.2，而不是把官方 grpc 模板当成服务骨架。

不要用 Aspire 模板（`aspire-empty` / `aspire-starter`）来生成 Articles，那会引入与上游不符的 AppHost。

### 2.3 第三方模板（只列能核对到来源的）

| 能力 | 模板来源 | 短名称 / 安装 | 与 Articles 的关系 | 建议 |
| --- | --- | --- | --- | --- |
| FastEndpoints | 官方组织的 [FastEndpoints.TemplatePack](https://github.com/FastEndpoints/Template-Pack)：`dotnet new install FastEndpoints.TemplatePack` | 仓库 README 写明：`feproj`（起步项目）、`feintproj`（集成测试与代码放一起）、`fetest`（xUnit）、`feat`（功能文件集）、`feaot`（AOT） | Auth / Journals / Production 的确用 FastEndpoints，但还有 BuildingBlocks、MediatR、EF、MassTransit | **可选**：用 `feproj` 或 `feat` 学习垂直切片目录，再把 TFM / 包版本改成上游的 `net9.0` + 7.0.1。不要指望一键得到整个微服务解 |
| Carter | [CarterTemplate](https://www.nuget.org/packages/CarterTemplate)（存在 9.0.0，与上游 Carter 9.0.0 主版本一致）：`dotnet new install CarterTemplate::9.0.0` | 官方包页与文档使用 `dotnet new carter`。安装后务必再执行 `dotnet new list carter` 确认 | ArticleHub、Review 引用 Carter 9.0.0 | **可选**。更稳妥是 `webapi` + 手动加 `Carter` 9.0.0。不要安装未钉版本的最新模板（例如 10.x 面向 net10），以免和 `net9.0` 错位 |
| MassTransit | 未找到厂商官方、且与本项目对应的 `dotnet new` 模板 | — | `Blocks.Messaging` 引用 `MassTransit.RabbitMQ` 8.5.2 | 官方 `classlib` / `webapi` 后按 CPM 加包 |
| YARP | 未找到适用的官方模板 | — | 仅 ApiGateway 引用 `Yarp.ReverseProxy` 2.3.0 | 官方 `web` + 手动加包与 `appsettings` 路由 |
| Redis.OM、Mongo GridFS、Hasura、EF | 无需要为此引入的第三方解决方案模板 | — | 见 Step3 | 加包验证 |

### 2.4 取舍与推荐命令序列

- **默认走官方模板打底**，再按 `src/Directory.Packages.props` 钉版本。
- 只有在团队希望 FastEndpoints / Carter 的目录约定时，才对**单个** API 使用 `feproj` 或 `carter`，然后立刻改目标框架和包版本，使其与 CPM 一致。
- MassTransit、YARP、Hasura 没有值得采用的第三方解决方案模板。

```bash
mkdir Articles && cd Articles
dotnet new sln -n Articles
dotnet new packagesprops -o src
dotnet new editorconfig
dotnet new gitignore

# BuildingBlocks（名称与上游对齐，便于对照 architecture.md）
for n in Articles.Abstractions Articles.Grpc.Contracts Articles.Integration.Contracts Articles.Security \
         Blocks.AspNetCore Blocks.Core Blocks.Domain Blocks.EntityFrameworkCore Blocks.Exceptions \
         Blocks.FastEndpoints Blocks.Hasura Blocks.Http.Abstractions Blocks.MediatR Blocks.Messaging Blocks.Redis
do
  dotnet new classlib -n "$n" -o "src/BuildingBlocks/$n" -f net9.0
  dotnet sln add "src/BuildingBlocks/$n/$n.csproj"
done

# 各限界上下文：API + 分层类库
create_service() {
  local svc="$1"
  dotnet new webapi -n "${svc}.API" -o "src/Services/${svc}/${svc}.API" -f net9.0
  dotnet new classlib -n "${svc}.Domain" -o "src/Services/${svc}/${svc}.Domain" -f net9.0
  dotnet new classlib -n "${svc}.Persistence" -o "src/Services/${svc}/${svc}.Persistence" -f net9.0
  # 上游 Auth / Submission / Review / Production 另有 Application 层；Journals / ArticleHub 较薄
  if [ "$svc" != "Journals" ] && [ "$svc" != "ArticleHub" ]; then
    dotnet new classlib -n "${svc}.Application" -o "src/Services/${svc}/${svc}.Application" -f net9.0
  fi
  dotnet sln add src/Services/${svc}/*/*.csproj
}
create_service Auth
create_service Journals
create_service ArticleHub
create_service Submission
create_service Review
create_service Production

dotnet new web -n ApiGateway -o src/ApiGateway -f net9.0
dotnet sln add src/ApiGateway/ApiGateway.csproj

# 文件与邮件模块可后补，先建 Mongo GridFS 这一条（Submission / Review 会用到）
dotnet new classlib -n FileStorage.Contracts -o src/Modules/FileService/FileService.Contracts -f net9.0
dotnet new classlib -n FileStorage.MongoGridFS -o src/Modules/FileService/FileService.MongoGridFS -f net9.0
dotnet sln add src/Modules/FileService/*/*.csproj

# Step3 选型测试（上游没有测试项目，这是从零必须补的）
dotnet new xunit -n TechSelection.Tests -o tests/TechSelection.Tests -f net9.0
dotnet sln add tests/TechSelection.Tests/TechSelection.Tests.csproj
```

然后把 `src/Directory.Packages.props` 改成与上游一致（至少包括 Step3 用到的版本）。测试项目要能引用这份 CPM：在 csproj 或 `Directory.Build.props` 中启用 `ManagePackageVersionsCentrally`。

---

## Step3: 安装依赖，并用测试项目验证技术选型

这一步的目标是：**证明关键技术在本机能工作**，不是实现投稿业务。上游仓库**没有测试项目**，因此测试框架是从零复现时的新选择。本手册采用官方 `dotnet new xunit`（SDK 已带）。

优先使用 [quickstart.md](./quickstart.md) 中的中间件 compose（以及 [docker-compose.local.yml](./docker-compose.local.yml) 对 Postgres 健康检查的修正）。上游同样**没有** Testcontainers 引用；若你自行引入，版本不要写成「上游已钉」。

### 3.1 启动验证用中间件

把 compose 里的 `<DEV_DB_PASSWORD>`、`<HASURA_ADMIN_SECRET>` 换成本地开发值后再启动。完整 YAML 见 [quickstart.md](./quickstart.md)，不要在这里复制一份以免漂移。

```bash
# 在 github-Articles 目录，或把该 YAML / 覆盖文件拷到你的新仓库
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
docker compose ps
# 端口：SQL 1433，Postgres 5432，Redis Stack 6379/8801，Mongo 27018，RabbitMQ 5672/15672，Hasura 4493
```

若 5432 / 6379 / 5672 已被占用，先改映射。本机 eShop Aspire 使用高位端口，通常不必停 eShop。不要停止正在运行的 Articles API。

Linux 上 Hasura 可能无法经 Docker 网桥访问 Postgres（Step 1 出现过 `SYN_SENT`）。healthz 失败时，按 quickstart 用 host 网络启动 Hasura，数据库 URL 指向 `127.0.0.1:5432`。

### 3.2 按上游版本加包

版本均来自 `src/Directory.Packages.props`：

```bash
cd tests/TechSelection.Tests
dotnet add package Microsoft.EntityFrameworkCore.SqlServer --version 9.0.8
dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL --version 9.0.4
dotnet add package StackExchange.Redis --version 2.9.11
dotnet add package Redis.OM --version 1.0.1
dotnet add package MongoDB.Driver --version 3.4.3
dotnet add package MassTransit.RabbitMQ --version 8.5.2
dotnet add package Grpc.Net.Client --version 2.71.0
dotnet add package protobuf-net.Grpc --version 1.2.2
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer --version 9.0.8
dotnet add package FastEndpoints --version 7.0.1
dotnet add package Carter --version 9.0.0
dotnet add package Microsoft.AspNetCore.Mvc.Testing --version 9.0.8
```

`Microsoft.AspNetCore.Mvc.Testing` 9.0.8 与 EF / JWT 的 9.0.8 对齐；若 CPM 里没有这一行，在测试项目里显式指定，不要随手装最新版。启用 CPM 后去掉 `--version`。

连接串（口令全部占位符）：

```text
SQL Server: Server=127.0.0.1,1433;User Id=sa;Password=<DEV_DB_PASSWORD>;TrustServerCertificate=True;Initial Catalog=TechSel
Postgres:   Host=127.0.0.1;Port=5432;Database=ArticleHubDb;Username=postgres;Password=<DEV_DB_PASSWORD>
Redis:      localhost:6379
Mongo:      mongodb://root:<DEV_DB_PASSWORD>@127.0.0.1:27018/gridfs_db?authSource=admin
RabbitMQ:   amqp://guest:guest@127.0.0.1:5672/
Hasura:     http://127.0.0.1:4493/
```

### 3.3 选型验证测试（示例）

**（1）EF Core + SQL Server（Auth / Submission / Review / Production）**

```csharp
public class SqlProbe { public int Id { get; set; } public string Name { get; set; } = ""; }
public class SqlProbeContext : DbContext
{
    public SqlProbeContext(DbContextOptions<SqlProbeContext> options) : base(options) { }
    public DbSet<SqlProbe> Items => Set<SqlProbe>();
}

public class SqlServerConnectivityTests
{
    [Fact]
    public async Task Can_create_table_insert_and_query()
    {
        var cs = Environment.GetEnvironmentVariable("ARTICLES_TEST_SQL")
            ?? "Server=127.0.0.1,1433;User Id=sa;Password=<DEV_DB_PASSWORD>;TrustServerCertificate=True;Initial Catalog=TechSel";
        var options = new DbContextOptionsBuilder<SqlProbeContext>().UseSqlServer(cs).Options;
        await using var db = new SqlProbeContext(options);
        await db.Database.EnsureCreatedAsync();
        db.Items.Add(new SqlProbe { Name = "probe" });
        await db.SaveChangesAsync();
        Assert.True(await db.Items.AnyAsync());
    }
}
```

**（2）EF Core + Postgres（ArticleHub / Hasura 同源库）**

```csharp
[Fact]
public async Task Can_connect_articlehub_postgres()
{
    var cs = Environment.GetEnvironmentVariable("ARTICLES_TEST_PG")
        ?? "Host=127.0.0.1;Port=5432;Database=ArticleHubDb;Username=postgres;Password=<DEV_DB_PASSWORD>";
    var options = new DbContextOptionsBuilder<SqlProbeContext>().UseNpgsql(cs).Options;
    await using var db = new SqlProbeContext(options);
    Assert.True(await db.Database.CanConnectAsync());
}
```

**（3）Redis Stack（Journals 主存储；`Redis.OM` 1.0.1 + `StackExchange.Redis` 2.9.11）**

```csharp
[Fact]
public async Task Redis_can_set_and_get()
{
    var mux = await ConnectionMultiplexer.ConnectAsync("localhost:6379");
    var db = mux.GetDatabase();
    await db.StringSetAsync("techsel:probe", "ok", TimeSpan.FromMinutes(1));
    Assert.Equal("ok", (string?)await db.StringGetAsync("techsel:probe"));
}
```

通过后再加一条 Redis.OM 最小用例：定义一个带 `[Document]` 的类型，`new RedisConnectionProvider(mux).RedisCollection<T>().InsertAsync`，再按 Id 取出。这证明 Journals 选用的客户端能连上 Redis Stack，而不是只证明 TCP 通。

**（4）MongoDB / GridFS（FileService.MongoGridFS）**

```csharp
[Fact]
public async Task Mongo_gridfs_can_upload_and_download()
{
    var url = Environment.GetEnvironmentVariable("ARTICLES_TEST_MONGO")
        ?? "mongodb://root:<DEV_DB_PASSWORD>@127.0.0.1:27018/gridfs_db?authSource=admin";
    var client = new MongoClient(url);
    var bucket = new MongoDB.Driver.GridFS.GridFSBucket(client.GetDatabase("gridfs_db"));
    var id = await bucket.UploadFromBytesAsync("probe.txt", "hello"u8.ToArray());
    var bytes = await bucket.DownloadAsBytesAsync(id);
    Assert.Equal("hello", System.Text.Encoding.UTF8.GetString(bytes));
}
```

**（5）MassTransit + RabbitMQ（`MassTransit.RabbitMQ` 8.5.2）**

```csharp
public record TechSelMessage(string Text);

[Fact]
public async Task MassTransit_can_publish_and_consume_on_rabbitmq()
{
    var tcs = new TaskCompletionSource<string>();
    var harness = new ServiceCollection()
        .AddMassTransit(x =>
        {
            x.AddHandler<TechSelMessage>(ctx =>
            {
                tcs.TrySetResult(ctx.Message.Text);
                return Task.CompletedTask;
            });
            x.UsingRabbitMq((ctx, cfg) =>
            {
                cfg.Host("amqp://guest:guest@127.0.0.1:5672/");
                cfg.ConfigureEndpoints(ctx);
            });
        })
        .BuildServiceProvider();

    var bus = harness.GetRequiredService<IBusControl>();
    await bus.StartAsync();
    try
    {
        await bus.Publish(new TechSelMessage("ok"));
        Assert.Equal("ok", await tcs.Task.WaitAsync(TimeSpan.FromSeconds(8)));
    }
    finally { await bus.StopAsync(); }
}
```

`AddHandler` API 以 8.5.2 为准，若略有差异，改成显式 Consumer 类即可。本步用真实 RabbitMQ；MassTransit 的 In-Memory Test Harness 只能证明包能引用，不能证明本机代理可用。

**（6）gRPC 通道（代码优先栈的最小证明）**

```csharp
[Fact]
public void Grpc_channel_can_be_created()
{
    using var channel = Grpc.Net.Client.GrpcChannel.ForAddress("http://127.0.0.1:4402");
    Assert.NotNull(channel);
}
```

下一条更有意义的测试：用 `webapi` + `protobuf-net.Grpc.AspNetCore` 1.2.2 写一个 `IGreeter` 接口，`AddCodeFirstGrpc()` 发布，客户端 `channel.CreateGrpcService<IGreeter>()` 调用。官方 `dotnet new grpc` 的 Greeter 只能证明 protobuf 工具链，不能代替这条。

**（7）JWT Bearer（`Microsoft.AspNetCore.Authentication.JwtBearer` 9.0.8）**

与 eShop 手册相同思路：测试里用 `RandomNumberGenerator` 现场生成签名密钥，签发后校验 `sub`。不要把上游 `appsettings` 里的密钥抄进测试。完整的 `POST /api/tokens`、种子用户与 ASP.NET Identity 放到 Step5。

**（8）FastEndpoints 7.0.1 最小宿主**

建一个临时 `web` 项目或在测试里用 `WebApplication.Create()`：

```csharp
public class PingEndpoint : EndpointWithoutRequest<string>
{
    public override void Configure() => Get("/techsel/ping");
    public override Task<string> ExecuteAsync(CancellationToken ct) => Task.FromResult("pong");
}
```

`WebApplicationFactory` 或 `app.RunAsync` 后 `GET /techsel/ping` 期望 200 且正文为 `pong`。这只证明包与中间件能注册，不实现登录。

**（9）Carter 9.0.0 最小模块**

```csharp
public class PingModule : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
        => app.MapGet("/techsel/carter", () => "pong");
}
```

`builder.Services.AddCarter()`、`app.MapCarter()` 后请求该路径。ArticleHub / Review 在 Step5 再换成真实模块。

**（10）Hasura（本地可测）**

```csharp
[Fact]
public async Task Hasura_healthz_is_ok()
{
    using var http = new HttpClient { BaseAddress = new Uri("http://127.0.0.1:4493/") };
    var res = await http.GetAsync("healthz");
    res.EnsureSuccessStatusCode();
    Assert.Equal("OK", (await res.Content.ReadAsStringAsync()).Trim(), ignoreCase: true);
}
```

若还要证明 GraphQL 引擎能执行查询，可 `POST /v1/graphql`，请求头 `x-hasura-admin-secret: <HASURA_ADMIN_SECRET>`，body 用 `__typename` 这类内省。Step 1 记录：即便 healthz 正常，元数据自动 track 也可能未完成（上游 `hasura-init` 是注释状态），不要在本步断言业务表已暴露。

### 3.4 运行

```bash
export ARTICLES_TEST_SQL='Server=127.0.0.1,1433;User Id=sa;Password=<DEV_DB_PASSWORD>;TrustServerCertificate=True;Initial Catalog=TechSel'
export ARTICLES_TEST_PG='Host=127.0.0.1;Port=5432;Database=ArticleHubDb;Username=postgres;Password=<DEV_DB_PASSWORD>'
export ARTICLES_TEST_MONGO='mongodb://root:<DEV_DB_PASSWORD>@127.0.0.1:27018/gridfs_db?authSource=admin'
dotnet test tests/TechSelection.Tests
```

全部绿，才进入搭结构。某一项红，先修中间件、网络（尤其 Hasura）或包版本。

---

## Step4: 按照系统架构创建 MVP（整体结构 + DevOps）

### 4.1 空的整体结构

技术选型通过后，把目录调整成与上游 / architecture.md 一致的骨架。各 API 此时只需能启动的空宿主（FastEndpoints 或 Carter 的 ping，或一个 `GET /`）。上游**没有**健康检查端点和 OpenTelemetry，从零可以加一个最小 `/health`，但不要假装上游已经有。

```text
Articles/
  src/
    Directory.Packages.props
    Articles.sln
    docker-compose.yml          # 只含中间件；Postgres 健康检查用 postgres / ArticleHubDb
    BuildingBlocks/...
    Services/Auth|Journals|ArticleHub|Submission|Review|Production/
    ApiGateway/
    Modules/FileService/...
  tests/
    TechSelection.Tests/
  .github/workflows/ci.yml      # 上游没有，从零建议补上
  .editorconfig
```

一起启动的方式与上游一致：Compose 拉中间件，再对 5 个默认 API 分别 `dotnet run`（Auth 4401、Journals 4402、ArticleHub 4403、Submission 4404、Review 4405）。Production 在上游 compose 中被注释，结构里可以留空宿主，但不纳入默认启动。ApiGateway 同样先留空，等路由表对照清楚再启用（上游网关端口表已过时）。

不要使用上游 Dockerfile 直接构建：Step 1 已记录它们基于 `sdk:8.0`，与 `net9.0` 不一致，COPY 也不完整。

### 4.2 DevOps（上游没有 CI，必须标明）

检索上游仓库：**没有** `.github/workflows`，也没有测试项目。从零复现时建议补上最小 GitHub Actions（restore / build / test），不要把下面的文件写成「上游已有」。

```yaml
# .github/workflows/ci.yml
# 从零复现时建议新增；上游提交 63ee8c0 中不存在此文件。
name: build-and-test
on:
  pull_request:
  push:
    branches: [ main ]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup .NET 9
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '9.0.x'
      - name: Restore
        run: dotnet restore src/Articles.sln
      - name: Build
        run: dotnet build src/Articles.sln --no-restore
      - name: Test
        run: dotnet test src/Articles.sln --no-build --no-restore
```

需要连接中间件的测试，应在 workflow 里加 service container，或把它们标为显式的集成测试，避免默认 CI 没有 SQL Server / Redis 时变红。镜像发布不是上游默认路径（Dockerfile 尚不可用），本阶段不要编造容器发布 job。

---

## Step5: 按照系统功能模块创建 MVP

按 [architecture.md](./architecture.md) 的限界上下文，一块一块做最小可运行切片。顺序服从依赖：先身份与期刊主数据，再投稿与审稿，然后 ArticleHub 读模型，最后可选的 Production 与网关。

| 顺序 | 模块 | 要建 / 补齐的项目 | 最小功能 | 中间件 | 怎么验证 |
| --- | --- | --- | --- | --- | --- |
| 1 | Auth | Auth.API / Application / Domain / Persistence，`Articles.Security` | 开发种子用户可登录，`POST /api/tokens` 返回 JWT（路径是 `/api/tokens`，不是 `/tokens`） | SQL Server | curl 登录成功；用 token 访问一个 `[Authorize]` 的探活接口 |
| 2 | Journals | Journals.API / Domain / Persistence，`Blocks.Redis` | 能列出期刊（上游开发数据可列出多本期刊；本机 Step 1 曾返回 7 本） | Redis Stack | 带令牌调用列表 API，返回非空 |
| 3 | 同步查询 gRPC | `Articles.Grpc.Contracts`，Auth / Journals 的 code-first 服务 | Person / Journal 的最小查询接口可被客户端调用 | 无额外中间件 | Submission 侧通道能查出上一步的期刊或用户 |
| 4 | Submission | Submission.* + FileStorage.MongoGridFS | 能创建一篇投稿并保存一个小文件 | SQL Server、Mongo 27018、RabbitMQ、上一步 gRPC | 创建 API 返回新 Id；GridFS 中能读到文件；总线上有对应消息 |
| 5 | Review | Review.*（Carter） | 能接收「进入审稿」的消息，或提供一个最小的审稿通过/拒绝接口 | SQL Server、RabbitMQ、可选 Mongo | 发布或调用后，审稿记录状态变化，并发出下一事件 |
| 6 | ArticleHub | ArticleHub.*、`Blocks.Hasura`（Carter） | 订阅已发生的集成事件，投影到 Postgres；Hasura 能查到投影结果 | Postgres `ArticleHubDb`、Hasura、RabbitMQ | `/healthz` 为 OK；在 Console 中 track 投影表后，GraphQL 能读到一条记录 |
| 7 | Production | Production.*（结构可先建） | 最小的「进入生产」状态推进 | SQL Server、RabbitMQ | 默认不启动；有事件后再验证 |
| 8 | ApiGateway | ApiGateway | 用 YARP 把 `/auth`、`/journals` 等转到已验证的服务 | 无 | 经网关登录或列期刊成功。对照并修正上游过时端口表后再启用 |

种子口令写 `<SEED_DEFAULT_PASSWORD>`，Hasura 写 `<HASURA_ADMIN_SECRET>`。每做完一块再进入下一块；不要在 token 还签不出来时开始写投稿状态机（上游使用 Stateless 5.19.0，可在 Submission / Review 切片里再引入）。EmailService、MinIO / Azure Blob 替代存储属于更后的可选替换。

---

## 与「运行现成仓库」的区别

- 克隆并启动现成代码：见 [quickstart.md](./quickstart.md)。
- 本文是从空白目录复现：先环境，再模板建项目，再测试验证技术选型，再搭骨架并**补上上游没有的 CI**，最后按模块填业务。
- 完成后应对齐对照提交的架构与端口约定，而不是必须得到与上游逐文件相同的生成结果。
