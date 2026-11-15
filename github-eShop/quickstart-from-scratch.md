# eShop 从零复现手册（quickstart-from-scratch）

这份文档说明的是：**不克隆现成仓库，如何从空白目录复现 eShop 这类系统**。若你只想把已经存在的 [dotnet/eShop](https://github.com/dotnet/eShop) 跑起来，请看同目录的 [quickstart.md](./quickstart.md)。

- **对照上游：** https://github.com/dotnet/eShop ，提交 [`913acea66708a59595351174cee9b29f37179d29`](https://github.com/dotnet/eShop/commit/913acea66708a59595351174cee9b29f37179d29)
- **架构依据：** [architecture-v2.md](./architecture-v2.md)
- **原则：** 下文同时写清「上游现在怎么做」和「从零复现时你该怎么做」。不要假设 eShop 本身是由某一个第三方脚手架一键生成的——README 与源码都没有这样声明。

建议在**全新目录**中操作（例如 `~/work/eShop-from-scratch`），不要写入正在运行的 `/workspace/eShop`。

---

## Step1: 准备开发环境

与 [quickstart.md](./quickstart.md) 第 1 节相同，这里只保留从零复现必须的工具。版本以本机步骤记录为准。

| 组件 | 上游要求 | 本机已验证 |
| --- | --- | --- |
| OS | 有 OCI 容器运行时即可（README 推荐 Docker Desktop，也支持 Podman） | Linux |
| .NET SDK | `global.json`：`10.0.302`，`rollForward: latestFeature` | **10.0.303** |
| Aspire CLI | README 要求安装；`aspire.config.json` / AppHost SDK 为 **13.6.0** | CLI **13.6.5**（`aspire --version`） |
| Docker | 本地编排与功能测试都需要 | **29.9.3**；Linux 静态安装还需 **Buildx 0.39.0** + BuildKit，否则日后的 YARP / 隧道镜像可能构建失败 |
| Git | 用于你自己的新仓库 | 本机 git 2.47.3 |
| Node.js | 仅 Playwright e2e 需要 | 本机 Node v24.22.1、npm 11.21.1（可稍后安装） |

IDE（上游 README 写成 Optional，不是强制）：

- Visual Studio + `ASP.NET and web development`
- VS Code + C# Dev Kit + Aspire 扩展
- 跑 MAUI 客户端时再装 MAUI workload（默认编排不含客户端）

本机已安装的 SDK 自带这些官方模板（`dotnet new list` 已核对）：`sln`、`web`、`webapi`、`blazor`、`grpc`、`worker`、`classlib`、`razorclasslib`、`mstest`、`xunit`、`nunit`、`editorconfig`、`gitignore`、`globaljson`、`packagesprops` 等。默认列表里**没有** `aspire` 短名称；Aspire 模板要另外安装或走 Aspire CLI（见 Step2）。

```bash
dotnet --version          # 期望 10.0.3xx
aspire --version          # 本机 13.6.5
docker info
dotnet new list
```

---

## Step2: 创建项目

### 2.1 上游现在怎么做

上游是完整的参考应用，入口是 `eShop.Web.slnf` 与 `src/eShop.AppHost`（`Sdk="Aspire.AppHost.Sdk/13.6.0"`）。业务项目类型对照如下：

| 项目 | csproj SDK | 从零时最接近的官方模板 |
| --- | --- | --- |
| eShop.AppHost | `Aspire.AppHost.Sdk/13.6.0` | Aspire 的空应用 / AppHost 模板 |
| eShop.ServiceDefaults | `Microsoft.NET.Sdk` | Aspire Service Defaults，或 `classlib` 后按上游补包 |
| Catalog.API / Identity.API / Ordering.API / Webhooks.API / PaymentProcessor / WebApp 等 Web 宿主 | `Microsoft.NET.Sdk.Web` | `webapi` 或 `web`；WebApp 用 `blazor` |
| WebAppComponents、WebhookClient | Razor / Web | `razorclasslib`、`web` |
| Basket.API | Web + gRPC | `grpc` |
| OrderProcessor | `Microsoft.NET.Sdk.Worker` | `worker` |
| Ordering.Domain / Infrastructure、EventBus、EventBusRabbitMQ、IntegrationEventLogEF | `Microsoft.NET.Sdk` | `classlib` |
| 单元测试 | `MSTest.Sdk`（`global.json` 钉 `MSTest.Sdk` 4.0.2） | 官方 `mstest`，再按需改成 `MSTest.Sdk` |
| 功能测试 | `Aspire.AppHost.Sdk/13.6.0` + `xunit.v3.mtp-v2` 3.2.2 | 先建最小测试；功能测试可在 Step4 再对齐 |
| ClientApp / HybridApp | MAUI / Razor 多目标 | 本阶段可跳过 |

源码和 README **没有**写“本仓库由某某 `dotnet new` 模板生成”。Identity.API 使用 Duende IdentityServer 7.3.2 + ASP.NET Identity，并带有 Quickstart UI 目录，但这不能证明它就是当前 `Duende.Templates` 的一键产物。

### 2.2 官方 / 默认模板

本机 SDK 已能直接使用的短名称：`sln`、`webapi`、`web`、`blazor`、`grpc`、`worker`、`classlib`、`razorclasslib`、`mstest`、`xunit`、`gitignore`、`editorconfig`、`globaljson`、`packagesprops`。

Aspire 官方模板包是 [Aspire.ProjectTemplates](https://www.nuget.org/packages/Aspire.ProjectTemplates)（可钉 `13.6.0` 以对齐 AppHost SDK）。本机 `aspire new --help`（CLI 13.6.5）已列出：

- `aspire-empty`：Empty AppHost
- `aspire-starter`：Starter App（ASP.NET Core / Blazor）
- 以及 React / Python / TypeScript 等起步模板（与 eShop 不符，不要用）

[Aspire 模板文档](https://aspire.dev/get-started/aspire-sdk-templates) 还说明：可用 `dotnet new install Aspire.ProjectTemplates::13.6.0` 安装，再用 `dotnet new list` 查看当时注册的短名称（例如单独的 AppHost、Service Defaults、Aspire 测试项目）。安装后以你机器上的 `dotnet new list` 为准，不要使用未经 `list` 确认的短名称。

推荐：**用 `aspire-empty` 打底（只要 AppHost + 共享默认项），不要用 `aspire-starter` 一键生成示例 API/Blazor**——eShop 的服务数量和分层远多于 starter，starter 会变成拆改负担。

### 2.3 第三方模板（只列能核对到来源的）

| 能力 | 模板来源 | 短名称 / 安装 | 与 eShop 的关系 | 建议 |
| --- | --- | --- | --- | --- |
| Aspire 编排 | 官方 `Aspire.ProjectTemplates` / `aspire new` | 见上 | 与 AppHost、ServiceDefaults 直接对应 | **采用**，用来打底 |
| 身份 | 厂商模板 [Duende.Templates](https://docs.duendesoftware.com/identityserver/overview/templates/)：`dotnet new install Duende.Templates` | 官方文档列出 `duende-is-aspid`（IdentityServer + ASP.NET Identity）、`duende-is-ef`、`duende-is-empty` 等。文档写这些模板当前目标框架是 .NET 8，生成后需改到 `net10.0` | eShop 也是 IdentityServer + ASP.NET Identity + EF，但目录、种子和 Aspire 接入是参考应用自己的 | **可选对照**，不要当成 eShop 的生成源。更稳妥是 `dotnet new web` 后按上游包版本手动加 `Duende.IdentityServer` 7.3.2 等 |
| YARP mobile-bff | 未找到 YARP 官方、且与本项目对应的 `dotnet new` 模板 | — | 上游用 `Aspire.Hosting.Yarp` 在 AppHost 里声明，没有独立 csproj | 用官方模板不适用；在 AppHost 中按上游方式添加 |
| MediatR、EF Core、gRPC、Redis、RabbitMQ | 无需要为复现 eShop 而引入的第三方解决方案模板 | — | 都是包引用 | 官方 `webapi` / `grpc` / `classlib` + `Directory.Packages.props` 中的版本 |

不要用与本仓库无关的“电商微服务大全模板”来生成 eShop，版本、身份方案和目录都会对不上。

### 2.4 取舍与推荐命令序列

- **官方模板负责骨架：** 解决方案、AppHost、各服务宿主、类库、测试项目、CPM、gitignore。
- **第三方模板只在身份这一处值得考虑：** 若团队不熟 IdentityServer，可用 `duende-is-aspid` 做学习型原型，再把协议配置迁到 eShop 的 Aspire 方案里；要贴近上游结构，则从 `web` 起步手写。
- **包版本一律来自上游 `Directory.Packages.props`，不要随手装“最新版”。**

```bash
# 在空目录中。钉模板版本 13.6.0，与上游 AppHost SDK 一致
aspire new aspire-empty --name eShop --output ./eShop --version 13.6.0 --non-interactive
cd eShop

# 若 empty 模板尚未带上这些文件，再补：
dotnet new globaljson --sdk-version 10.0.302 --roll-forward latestFeature --force
dotnet new packagesprops
dotnet new editorconfig
dotnet new gitignore

# 共享库与总线（官方 classlib）
dotnet new classlib -n EventBus -o src/EventBus -f net10.0
dotnet new classlib -n EventBusRabbitMQ -o src/EventBusRabbitMQ -f net10.0
dotnet new classlib -n IntegrationEventLogEF -o src/IntegrationEventLogEF -f net10.0
# ServiceDefaults：若 aspire-empty 已生成则跳过；否则 classlib 后按上游项目补 FrameworkReference 与包

# 业务宿主
dotnet new webapi -n Catalog.API -o src/Catalog.API -f net10.0 --no-openapi false
dotnet new grpc    -n Basket.API -o src/Basket.API -f net10.0
dotnet new web     -n Identity.API -o src/Identity.API -f net10.0
dotnet new webapi  -n Ordering.API -o src/Ordering.API -f net10.0
dotnet new classlib -n Ordering.Domain -o src/Ordering.Domain -f net10.0
dotnet new classlib -n Ordering.Infrastructure -o src/Ordering.Infrastructure -f net10.0
dotnet new worker  -n OrderProcessor -o src/OrderProcessor -f net10.0
dotnet new webapi  -n PaymentProcessor -o src/PaymentProcessor -f net10.0
dotnet new webapi  -n Webhooks.API -o src/Webhooks.API -f net10.0
dotnet new web     -n WebhookClient -o src/WebhookClient -f net10.0
dotnet new blazor  -n WebApp -o src/WebApp -f net10.0
dotnet new razorclasslib -n WebAppComponents -o src/WebAppComponents -f net10.0

# 把项目加进解决方案（名称以 aspire-empty 实际生成的 .sln 为准）
dotnet sln add src/**/*.csproj

# Step3 用的选型验证测试（先建，下一步再加包）
dotnet new mstest -n TechSelection.Tests -o tests/TechSelection.Tests -f net10.0
dotnet sln add tests/TechSelection.Tests/TechSelection.Tests.csproj
```

然后把 `Directory.Packages.props` 里的版本改成与上游一致（至少包括下面 Step3 用到的那些）。上游 `global.json` 还设置了 `"MSTest.Sdk": "4.0.2"`；单元测试项目若要对齐，把 csproj 的 SDK 改为 `MSTest.Sdk`。

---

## Step3: 安装依赖，并用测试项目验证技术选型

这一步的目标是：**证明关键技术在本机能工作**，不是实现商店业务。先建测试项目，再按上游版本加包，为每项（或紧密相关的一组）写一条能红/绿的测试。

上游测试现状（供对照，不是本步必须一次抄齐）：

- 单元测试：`MSTest.Sdk` + `NSubstitute` 5.3.0
- 功能测试：`xunit.v3.mtp-v2` 3.2.2，项目本身是 Aspire AppHost，用来拉起 Postgres 等
- 浏览器旅程：根目录 Playwright（`npm run test:e2e`）
- **上游没有引用 Testcontainers。** 从零验证时，优先复用已有的 [docker-compose.middleware.yml](./docker-compose.middleware.yml)（Postgres+pgvector、Redis、RabbitMQ）。若你自行引入 Testcontainers，那是复现时的额外选择，版本不能写成“上游已钉”。

### 3.1 启动验证用中间件

先把 compose 中的 `<DEV_DB_PASSWORD>` 换成本地开发口令（不要提交真实口令）：

```bash
# 在 github-eShop 目录，或把该 compose 拷到你的新仓库
docker compose -f docker-compose.middleware.yml up -d
docker compose -f docker-compose.middleware.yml ps
# 初始化脚本会创建 catalogdb / identitydb / orderingdb / webhooksdb
```

注意：若本机 Articles 或其它进程已占用 5432 / 6379 / 5672，先改端口或停冲突容器。不要去停正在跑的 eShop Aspire（它通常占用高位端口）。

### 3.2 按上游版本加包

在 `tests/TechSelection.Tests` 中添加（版本均来自上游 `Directory.Packages.props`）：

```bash
cd tests/TechSelection.Tests
dotnet add package Microsoft.EntityFrameworkCore.Relational --version 10.0.12
dotnet add package Npgsql.EntityFrameworkCore.PostgreSQL --version 10.0.3
dotnet add package Pgvector --version 0.3.2
dotnet add package Pgvector.EntityFrameworkCore --version 0.3.0
dotnet add package Aspire.StackExchange.Redis --version 13.6.0
# 若只想用 Redis 客户端而不引入 Aspire 组件，也可只用 StackExchange.Redis；
# 上游业务侧实际引用的是 Aspire.StackExchange.Redis 13.6.0。
dotnet add package Aspire.RabbitMQ.Client --version 13.6.0
dotnet add package Grpc.AspNetCore --version 2.84.0
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer --version 10.0.12
dotnet add package MediatR --version 13.1.0
dotnet add package FluentValidation --version 12.1.1
```

如果已经启用中央包管理，把版本写进 `Directory.Packages.props`，`dotnet add package` 不再带 `--version`。

连接串用环境变量或测试配置，例如：

```text
Host=127.0.0.1;Port=5432;Database=catalogdb;Username=postgres;Password=<DEV_DB_PASSWORD>
```

Redis：`localhost:6379`。RabbitMQ：`amqp://guest:guest@127.0.0.1:5672/`（`guest` 是 RabbitMQ 开发默认账户；若你改过口令，用占位符保管）。

### 3.3 选型验证测试（示例）

下面每组一个最小测试。JWT 秘钥在测试里现场生成，不要写入固定生产密钥。

**（1）EF Core + Postgres**

```csharp
// PostgresConnectivityTests.cs
public class CatalogProbe
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
}

public class ProbeDbContext : DbContext
{
    public ProbeDbContext(DbContextOptions<ProbeDbContext> options) : base(options) { }
    public DbSet<CatalogProbe> Items => Set<CatalogProbe>();
}

[TestClass]
public class PostgresConnectivityTests
{
    [TestMethod]
    public async Task Can_create_table_insert_and_query()
    {
        var cs = Environment.GetEnvironmentVariable("ESHOP_TEST_PG")
            ?? "Host=127.0.0.1;Port=5432;Database=catalogdb;Username=postgres;Password=<DEV_DB_PASSWORD>";
        var options = new DbContextOptionsBuilder<ProbeDbContext>().UseNpgsql(cs).Options;
        await using var db = new ProbeDbContext(options);
        await db.Database.EnsureCreatedAsync();
        db.Items.Add(new CatalogProbe { Name = "probe" });
        await db.SaveChangesAsync();
        Assert.IsTrue(await db.Items.AnyAsync());
    }
}
```

**（2）pgvector（与 Catalog 语义检索同一扩展）**

```csharp
[TestMethod]
public async Task Can_enable_vector_extension()
{
    var cs = Environment.GetEnvironmentVariable("ESHOP_TEST_PG")
        ?? "Host=127.0.0.1;Port=5432;Database=catalogdb;Username=postgres;Password=<DEV_DB_PASSWORD>";
    await using var conn = new Npgsql.NpgsqlConnection(cs);
    await conn.OpenAsync();
    await using var cmd = new Npgsql.NpgsqlCommand("CREATE EXTENSION IF NOT EXISTS vector;", conn);
    await cmd.ExecuteNonQueryAsync();
    await using var check = new Npgsql.NpgsqlCommand(
        "SELECT extname FROM pg_extension WHERE extname = 'vector';", conn);
    Assert.AreEqual("vector", await check.ExecuteScalarAsync());
}
```

镜像必须是 `ankane/pgvector:latest`（与 AppHost 一致）。普通 `postgres` 镜像没有该扩展。

**（3）Redis**

```csharp
[TestMethod]
public async Task Redis_can_set_and_get()
{
    var mux = await ConnectionMultiplexer.ConnectAsync("localhost:6379");
    var db = mux.GetDatabase();
    await db.StringSetAsync("techsel:probe", "ok", TimeSpan.FromMinutes(1));
    Assert.AreEqual("ok", (string?)await db.StringGetAsync("techsel:probe"));
}
```

若使用 `Aspire.StackExchange.Redis`，在测试里直接用 `ConnectionMultiplexer` 仍足以证明客户端与服务器可用。上游 Basket 把购物车存在 Redis 中。

**（4）RabbitMQ（对应 EventBusRabbitMQ / `Aspire.RabbitMQ.Client`）**

```csharp
[TestMethod]
public async Task RabbitMq_can_publish_and_consume()
{
    var factory = new RabbitMQ.Client.ConnectionFactory { Uri = new Uri("amqp://guest:guest@127.0.0.1:5672/") };
    using var conn = await factory.CreateConnectionAsync();
    using var channel = await conn.CreateChannelAsync();
    var queue = (await channel.QueueDeclareAsync(exclusive: true)).QueueName;
    var tcs = new TaskCompletionSource<string>();
    var consumer = new RabbitMQ.Client.AsyncEventingBasicConsumer(channel);
    consumer.ReceivedAsync += (_, ea) =>
    {
        tcs.TrySetResult(System.Text.Encoding.UTF8.GetString(ea.Body.ToArray()));
        return Task.CompletedTask;
    };
    await channel.BasicConsumeAsync(queue, autoAck: true, consumer);
    var body = System.Text.Encoding.UTF8.GetBytes("hello");
    await channel.BasicPublishAsync(exchange: "", routingKey: queue, body: body);
    var received = await tcs.Task.WaitAsync(TimeSpan.FromSeconds(5));
    Assert.AreEqual("hello", received);
}
```

`CreateConnectionAsync` / `CreateChannelAsync` 的 API 以你安装的 `RabbitMQ.Client`（由 `Aspire.RabbitMQ.Client` 传递引入）为准；若方法名与示例不完全一致，按该包版本的 API 微调，不要改中间件版本来迁就示例。

**（5）gRPC（对应 Basket）**

本步不必先实现完整 `basket.proto`。用 `dotnet new grpc` 生成的项目应能 `dotnet run`；测试可以启动该宿主或对已有 contract 做一次客户端通道创建：

```csharp
[TestMethod]
public void Grpc_channel_can_be_created()
{
    using var channel = Grpc.Net.Client.GrpcChannel.ForAddress("http://127.0.0.1:5221");
    Assert.IsNotNull(channel);
}
```

更有价值的下一条测试是：把 Step2 的 `Basket.API` 跑起来，对模板自带的 `Greeter` 调用 `SayHello`，断言返回非空。通过后再把 proto 换成上游那种 Basket 契约。

**（6）JWT Bearer（身份最小校验；完整 Duende 放到 Step5）**

```csharp
[TestMethod]
public void Can_issue_and_validate_jwt()
{
    var key = new SymmetricSecurityKey(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
    var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
    var token = new JwtSecurityToken("eShop-techsel", "eShop-techsel",
        [new Claim("sub", "alice")],
        expires: DateTime.UtcNow.AddMinutes(5), signingCredentials: creds);
    var jwt = new JwtSecurityTokenHandler().WriteToken(token);

    var principal = new JwtSecurityTokenHandler().ValidateToken(jwt, new TokenValidationParameters
    {
        ValidIssuer = "eShop-techsel",
        ValidAudience = "eShop-techsel",
        IssuerSigningKey = key,
        ValidateLifetime = true
    }, out _);
    Assert.AreEqual("alice", principal.FindFirst("sub")?.Value);
}
```

这只证明「签发 + 校验」这条链可用。Duende IdentityServer、OIDC 登录页、种子用户 `alice` / `bob` 属于 Step5。种子口令在上游 `UsersSeed.cs`，文档中写 `<SEED_DEFAULT_PASSWORD>`。

**（7）MediatR + FluentValidation（Ordering 应用层用到）**

```csharp
public record Ping(string Text) : IRequest<string>;
public class PingHandler : IRequestHandler<Ping, string>
{
    public Task<string> Handle(Ping request, CancellationToken ct) => Task.FromResult(request.Text.ToUpperInvariant());
}

[TestMethod]
public async Task MediatR_can_send_command()
{
    var services = new ServiceCollection().AddMediatR(c => c.RegisterServicesFromAssembly(typeof(Ping).Assembly));
    var mediator = services.BuildServiceProvider().GetRequiredService<IMediator>();
    Assert.AreEqual("OK", await mediator.Send(new Ping("ok")));
}
```

可再加一个 FluentValidation 测试：校验失败时抛出 `ValidationException`。上游 Ordering 把校验放在 MediatR 管道里。

### 3.4 运行

```bash
export ESHOP_TEST_PG='Host=127.0.0.1;Port=5432;Database=catalogdb;Username=postgres;Password=<DEV_DB_PASSWORD>'
dotnet test tests/TechSelection.Tests --output detailed
```

全部绿，才能认为 Postgres+pgvector、Redis、RabbitMQ、gRPC 客户端、JWT、MediatR 的选型在本机成立。某一项红，先修连接或包版本，不要同时铺开业务模块。

---

## Step4: 按照系统架构创建 MVP（整体结构 + DevOps）

### 4.1 空的整体结构

技术选型通过后，把目录调整成与上游一致的骨架。各服务此时只需能启动的空宿主（例如 `/health` 或一个 `GET /`），重点是**结构正确、能被 AppHost（或日后的 compose）一起拉起**。

建议目录：

```text
eShop/
  global.json
  Directory.Packages.props
  Directory.Build.props
  .editorconfig
  aspire.config.json          # appHost.path = src/eShop.AppHost/eShop.AppHost.csproj
  eShop.Web.slnf              # 先包含 Web 后端与测试，不含 MAUI
  src/
    eShop.AppHost/
    eShop.ServiceDefaults/
    EventBus/ EventBusRabbitMQ/ IntegrationEventLogEF/
    Catalog.API/ Basket.API/ Identity.API/
    Ordering.API/ Ordering.Domain/ Ordering.Infrastructure/
    OrderProcessor/ PaymentProcessor/
    Webhooks.API/ WebhookClient/
    WebApp/ WebAppComponents/
  tests/
    TechSelection.Tests/
    （随后再补各服务 UnitTests / FunctionalTests）
  .github/workflows/
```

AppHost 里先只声明 `AddPostgres("postgres").WithImage("ankane/pgvector").WithImageTag("latest")`、`AddRedis("redis")`、`AddRabbitMQ("eventbus")`，以及已经存在的空项目与 `/health`。健康检查映射可参考上游 `eShop.ServiceDefaults` 中的 `MapHealthChecks("/health")`。先不要接 Foundry / Ollama。

本机可用 `aspire run` 验证：仪表板能打开、各资源变为 Running / Healthy。Dashboard 地址类似 `https://localhost:19888/login?t=<TOKEN_FROM_aspire_ps>`，token 每次启动都会变。

### 4.2 DevOps（以上游真实工作流为准）

上游 `.github/workflows/` 里已经有：

| 文件 | 作用 |
| --- | --- |
| `pr-validation.yml` | PR 与 `main` 推送：`actions/setup-dotnet@v3`（读 `global.json`），`dotnet build eShop.Web.slnf`，`dotnet test --solution eShop.Web.slnf --no-build --no-progress --output detailed`；忽略 markdown 与 MAUI 路径 |
| `playwright.yml` | `dotnet-version: '10.0.x'` + Node LTS，`npm ci`，安装 Chromium，`ESHOP_USE_HTTP_ENDPOINTS=1` 后 `npm run test:e2e` |
| `pr-validation-maui.yml` | MAUI 客户端（从零的第一阶段可暂不纳入） |
| `markdownlint.yml` | 文档检查 |

从零复现时，先建立与 `pr-validation.yml` 等价的最小流水线（restore/build/test）。下面是按上游文件缩写的示例，不要编造不存在的 job 名称：

```yaml
# .github/workflows/pr-validation.yml
name: eShop Pull Request Validation
on:
  pull_request:
    paths-ignore: [ '**.md' ]
  push:
    branches: [ main ]
    paths-ignore: [ '**.md' ]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup .NET (global.json)
        uses: actions/setup-dotnet@v3
      - name: Build
        run: dotnet build eShop.Web.slnf
      - name: Test
        run: dotnet test --solution eShop.Web.slnf --no-build --no-progress --output detailed
```

Playwright 工作流可在 WebApp 登录切片完成后再加。上游文件里用环境变量传入演示账号；你自己的仓库应使用 GitHub Secrets，口令写 `<SEED_DEFAULT_PASSWORD>`，不要把上游种子口令写进公开 YAML。

发布：上游 README 说明可用 Aspire CLI 部署到 Azure Container Apps（`aspire deploy`，且警告该样本把 Postgres / Redis / RabbitMQ 也以容器方式部署，仅供评估）。从零 MVP 先把 PR 验证跑通即可，不要在本地 CI 尚未变绿时做云发布。

---

## Step5: 按照系统功能模块创建 MVP

按已有架构的限界上下文，一块一块做最小可运行切片。顺序服从依赖：先身份与商品主数据，再篮子与订单，最后 Web 与网关。

| 顺序 | 模块 | 要建 / 补齐的项目 | 最小功能 | 中间件 | 怎么验证 |
| --- | --- | --- | --- | --- | --- |
| 1 | Identity | `Identity.API` | 能启动 IdentityServer；开发环境种子用户可登录（用户名 `alice` / `bob`，口令见 `UsersSeed.cs`，文档写 `<SEED_DEFAULT_PASSWORD>`） | Postgres `identitydb` | 浏览器或 curl 打开登录页；签发的 token 能被其它 API 校验 |
| 2 | Catalog | `Catalog.API` | 能列出商品 / 品牌（对应上游 catalog 查询 API）；图片读取可后补 | Postgres `catalogdb`，可选 pgvector | `GET` 列表返回非空（可先手写两条种子）；`/health` 200 |
| 3 | Basket | `Basket.API` + proto | 按买家读写购物车 | Redis；需要 Identity 的 audience / 地址 | gRPC 客户端添加一件商品后再读取 |
| 4 | Ordering | `Ordering.API` + Domain + Infrastructure | 能用购物车信息创建订单并查询 | Postgres `orderingdb`；RabbitMQ；MediatR | 创建订单 API 返回新 Id；库中有记录 |
| 5 | 处理机 | `OrderProcessor`（worker）、`PaymentProcessor` | 订阅订单状态变化，完成宽限期或支付结果的最小闭环 | RabbitMQ；Ordering 库 | 发布一条集成事件后，订单状态按上游状态机前进一步 |
| 6 | Webhooks | `Webhooks.API`、`WebhookClient` | 能注册一个 webhook 并在事件到达时收到调用 | Postgres `webhooksdb`；RabbitMQ | 注册 URL，触发一次事件，接收端点被调用 |
| 7 | WebApp | `WebApp`、`WebAppComponents` | 首页能列出 Catalog 商品，并能登录 | 依赖 1–4 | https://localhost:7298 或 http://localhost:5045（与上游 launchSettings 一致）打开首页 |
| 8 | mobile-bff | 仅 AppHost 中的 YARP | 把 mobile 路由转到 catalog / orders / identity | 无独立库 | 进程 Healthy。注意本机实测中，经 BFF 访问 catalog 曾出现超时，WebApp 本身走 catalog-api，不受影响 |

每做完一块就跑该模块测试和 `aspire run`，再进入下一块。不要在 Identity 还不能发 token 时开始写下单 Saga。ClientApp / HybridApp、Foundry 聊天属于更后的可选切片。

---

## 与「运行现成仓库」的区别

- 克隆并启动现成代码：见 [quickstart.md](./quickstart.md)。
- 本文是从空白目录复现：先环境，再模板建项目，再测试验证技术选型，再搭骨架与 CI，最后按模块填业务。
- 完成后，行为应对齐对照提交的架构，而不是必须得到与上游逐文件相同的生成结果。
