# paperless-ngx 本机部署与运行记录

本文是一份独立的本机部署记录：按文中的命令和配置，可以在同一类 Linux + Docker 环境里把 paperless-ngx 跑起来，并核对本机这次实际得到的结果。不依赖其他分析文档。密钥与数据库口令只写占位符。

记录时间：2026-11-15，时区 Asia/Shanghai（UTC+8）。部署发生在分析用的 Linux 云电脑（下文称「本机」），不是分析者自己的笔记本。服务在写完本文后保持运行。

## 1. 结论

- 栈已经拉起并保持运行。Web 入口：<http://127.0.0.1:8000/> ，未登录会 302 到 <http://127.0.0.1:8000/accounts/login/?next=/> 。
- 应用版本 **Paperless-ngx v3.4.2**（容器日志 `[paperless.asgi] [init] Paperless-ngx version: v3.4.2`，仪表盘侧栏同样显示该版本）。
- 使用官方 **Postgres + Tika + Gotenberg** Compose 模板。本机只向宿主机发布 **8000:8000**，没有改成 8010。
- 本地管理员用户名：`admin`。口令只存在运行目录，文档中写作 `<SEED_ADMIN_PASSWORD>`。
- 登录页与空仪表盘已用本机 `DISPLAY=:11` 上的有界面 Playwright Chromium 打开并截图，见第 11 节。
- 已向消费目录投放一份最小 PDF，消费完成并写入数据库（1 篇文档）。仪表盘截图是在投放这份文件之前拍摄的，当时统计为 0。
- 未停止、未修改已经在跑的 eShop Aspire 容器，也未改 Articles 的中间件端口（宿主 5432、6379、1433、27018、5672/15672 等）。
- paperless-ngx 源码检出保持干净；真实密钥不进入分析文档目录。

## 2. 环境

| 项 | 本机实测值 |
| --- | --- |
| 日期 | 2026-11-15，Asia/Shanghai（UTC+8） |
| Docker | 29.9.3，`dockerd` 在运行 |
| Compose 插件 | v5.7.1 |
| 源码检出（只读使用） | `/workspace/paperless-ngx`，分支 `dev`，提交 `4610171a94e5932e85a80e480032e397cdb6f309`，版本 3.4.2 |
| 运行目录（含密钥与数据挂载） | `/workspace/paperless-ngx-run/` |
| 文档目录 | `/workspace/github-paperless-ngx/` |
| 宿主机 8000 | 启动前空闲，启动后由 `paperless-webserver-1` 占用 |

源码提交说明为 `Chore (dev): add tsconfig missing types (#14771)`，提交时间 2026-11-14 09:33:39 -0800，即 2026-11-15 01:33 Asia/Shanghai。部署过程没有对这份检出执行 `git pull`，也没有把密钥或 compose 副本写进源码树。`git status` 在部署结束后仍是干净的 `dev`。

## 3. 为什么用 Postgres + Tika + Gotenberg 这一份模板

官方 `docker/compose/` 里有多份模板（SQLite、MariaDB、Postgres，以及是否附带 Tika/Gotenberg 的组合）。本机选用：

```text
/workspace/paperless-ngx/docker/compose/docker-compose.postgres-tika.yml
```

原因：

- **Postgres** 是官方推荐的生产向数据库，也适合 Web、Celery worker、beat、消费进程同时读写。SQLite 更适合单机试玩，不作为这次目标。
- **Tika + Gotenberg** 用来处理 Office 等非纯 PDF 输入（Tika 抽文本，Gotenberg 做转换）。模板里已经写好服务名与默认连接，不必另外拼一套。
- 经纪器用官方镜像 **Valkey 9**（`valkey/valkey:9-alpine`），连接串仍是 `redis://broker:6379`。模板**不把** Postgres 的 5432 和 Valkey 的 6379 发布到宿主机，只在 compose 网络内部互通。这一点对「本机已有 Articles 占用宿主 5432/6379」很重要，见第 6 节。
- 应用容器镜像是 `ghcr.io/paperless-ngx/paperless-ngx:latest`。容器内用 s6-overlay 同时拉起 Granian（HTTP）、Celery worker、Celery beat 和 `document_consumer`。

没有选用安装脚本 `install-paperless-ngx.sh`，也没有在宿主机上裸机跑 Django，以便把数据、网络和密钥全部限制在独立的运行目录与 compose 项目 `paperless` 里。

## 4. 运行目录与密钥隔离

源码树不放密钥。运行时文件全部放在 `/workspace/paperless-ngx-run/`：

```bash
mkdir -p /workspace/paperless-ngx-run/consume /workspace/paperless-ngx-run/export
cp /workspace/paperless-ngx/docker/compose/docker-compose.postgres-tika.yml \
   /workspace/paperless-ngx-run/docker-compose.yml
cp /workspace/paperless-ngx/docker/compose/docker-compose.env \
   /workspace/paperless-ngx-run/docker-compose.env
cp /workspace/paperless-ngx/docker/compose/.env \
   /workspace/paperless-ngx-run/.env
```

`.env` 内容只有项目名（官方如此）：

```env
COMPOSE_PROJECT_NAME=paperless
```

生成密钥与数据库口令（只写进运行目录，不写进文档目录）：

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"   # PAPERLESS_SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(24))"   # POSTGRES_PASSWORD / PAPERLESS_DBPASS
python3 -c "import secrets; print(secrets.token_urlsafe(24))"   # 首次启动管理员口令
```

运行目录里另有 `.secret_key`、`.db_password`、`.admin_password`、`.admin_username`（内容为 `admin`），权限收紧为 `600`。该目录的 `.gitignore` 忽略 compose、env、密钥文件以及 `consume/`、`export/`，避免将来被误打进文档包。

文档与仓库里的占位符统一为：

| 含义 | 占位符 |
| --- | --- |
| Django `SECRET_KEY` | `<PAPERLESS_SECRET_KEY>` |
| Postgres / 应用库口令 | `<DEV_DB_PASSWORD>` |
| 本地管理员口令 | `<SEED_ADMIN_PASSWORD>` |

## 5. 实际使用的 Compose 与环境变量（已脱敏）

相对官方模板，本机只改了数据库口令，并显式写出数据库连接项，避免应用还用默认的 `paperless` 口令去连已经改过口令的库。Web 服务增加的环境变量如下；`PAPERLESS_REDIS`、Tika、Gotenberg 的地址保持模板原样。

```yaml
# 摘录自 /workspace/paperless-ngx-run/docker-compose.yml（已脱敏）
services:
  broker:
    image: docker.io/valkey/valkey:9-alpine
    restart: unless-stopped
    volumes:
      - redisdata:/data

  db:
    image: docker.io/library/postgres:18
    restart: unless-stopped
    volumes:
      - pgdata:/var/lib/postgresql
    environment:
      POSTGRES_DB: paperless
      POSTGRES_USER: paperless
      POSTGRES_PASSWORD: <DEV_DB_PASSWORD>

  webserver:
    image: ghcr.io/paperless-ngx/paperless-ngx:latest
    restart: unless-stopped
    depends_on:
      - db
      - broker
      - gotenberg
      - tika
    ports:
      - "8000:8000"
    volumes:
      - data:/usr/src/paperless/data
      - media:/usr/src/paperless/media
      - ./export:/usr/src/paperless/export
      - ./consume:/usr/src/paperless/consume
    env_file: docker-compose.env
    environment:
      PAPERLESS_REDIS: redis://broker:6379
      PAPERLESS_DBHOST: db
      PAPERLESS_DBENGINE: postgresql
      PAPERLESS_DBNAME: paperless
      PAPERLESS_DBUSER: paperless
      PAPERLESS_DBPASS: <DEV_DB_PASSWORD>
      PAPERLESS_TIKA_ENABLED: 1
      PAPERLESS_TIKA_GOTENBERG_ENDPOINT: http://gotenberg:3000
      PAPERLESS_TIKA_ENDPOINT: http://tika:9998

  gotenberg:
    image: docker.io/gotenberg/gotenberg:8.38
    restart: unless-stopped
    command:
      - gotenberg
      - --chromium-disable-javascript=true
      - --chromium-allow-list=^file:///tmp/.*

  tika:
    image: docker.io/apache/tika:3.3.1.0
    restart: unless-stopped
```

`docker-compose.env` 中与本次部署相关的有效项：

```env
PAPERLESS_SECRET_KEY=<PAPERLESS_SECRET_KEY>
PAPERLESS_TIME_ZONE=Asia/Shanghai
PAPERLESS_OCR_LANGUAGE=eng
# PAPERLESS_OCR_LANGUAGES=chi_sim  # 镜像源里没有 tesseract-ocr-chi_sim，已跳过
PAPERLESS_ADMIN_USER=admin
PAPERLESS_ADMIN_MAIL=admin@localhost
PAPERLESS_ADMIN_PASSWORD=<SEED_ADMIN_PASSWORD>
```

说明：

- 时区通过 `PAPERLESS_TIME_ZONE=Asia/Shanghai` 交给应用。容器内系统命令 `date` 仍显示 UTC（官方镜像常见做法），Django / 文档日期按该时区配置。
- 曾尝试启用简体中文 OCR，见第 8 节；最终回退为镜像自带的 `eng`，否则容器无法通过系统检查。
- `PAPERLESS_ADMIN_*` 会在首次成功启动时由镜像的 `init-superuser` 创建超级用户，不必再交互式运行 `createsuperuser`。

数据卷（compose 项目名 `paperless`）：`paperless_data`、`paperless_media`、`paperless_pgdata`、`paperless_redisdata`。消费与导出目录是运行目录下的绑定挂载。

## 6. 端口选择与和其他已运行栈的关系

官方这份 postgres-tika 模板只发布：

```text
8000:8000   ->  paperless-webserver-1
```

`db` 的 5432、`broker` 的 6379、`gotenberg` 的 3000、`tika` 的 9998 都只在 `paperless_default`（网段 `172.20.0.0/16`）内部监听，**没有** `0.0.0.0` 映射。因此：

- 不会和 Articles 已经发布到宿主机的 **5432**（Postgres）、**6379**（Redis Stack）冲突。
- 不会和 Articles 的 SQL Server **1433**、Mongo **27018**、RabbitMQ **5672/15672** 冲突。
- 不会和 eShop Aspire 发布在高位端口（以及 `127.0.0.1` 上的映射）冲突。

启动前 8000 空闲，启动后仍是 `0.0.0.0:8000->8000/tcp`，没有改成 `8010:8000`。

`docker compose up -d` 之后再次核对，Articles 与 eShop 的容器和宿主端口仍在，包括：

- `articles-postgres-1`：`0.0.0.0:5432->5432/tcp`（healthy）
- `articles-journals-redisdb-1`：`0.0.0.0:6379->6379/tcp`
- `articles-sqlserver-1`：`0.0.0.0:1433->1433/tcp`
- `mongo-gridfs`：`0.0.0.0:27018->27017/tcp`
- `rabbitmq`：`0.0.0.0:5672->5672/tcp`、`0.0.0.0:15672->15672/tcp`
- `articles-hasura`（host 网络，原端口保留）
- eShop：`postgres-3acade60`、`redis-tbyuchgm`、`eventbus-3acade60`、`mobile-bff-fvudknhq` 仍在高位 / `127.0.0.1` 端口上运行

Paperless 的库与经纪人虽然内部也叫 5432/6379，但只出现在 `paperless_default` 里，例如 `paperless-db-1` 的 Ports 列是 `5432/tcp`（无宿主映射）。

## 7. 启动命令与第一次失败

在运行目录执行：

```bash
cd /workspace/paperless-ngx-run
docker compose pull
docker compose up -d
```

镜像拉取成功。`up -d` 大约在 2026-11-15 16:31:48 Asia/Shanghai 创建网络 `paperless_default`、上述四个 named volume，以及五个容器。Postgres 日志确认完成 `initdb` 并监听 `0.0.0.0:5432`；Valkey 日志为 `Ready to accept connections tcp`。但 **webserver 一直不健康**，`curl http://127.0.0.1:8000/` 得到 `Connection reset by peer`。

容器日志里的关键句：

```text
db:5432 - no response
[init-db-wait] Unable to connect after 63 seconds.
s6-rc: warning: unable to start service init-wait-for-db: command exited 1
Redis ping #0 failed.
Error: Timeout connecting to server.
```

在 webserver 里解析 `db` / `broker` 正常（`172.20.0.3`、`172.20.0.5`），环境变量也正确（`PAPERLESS_DBHOST=db`、`PAPERLESS_REDIS=redis://broker:6379`）。用 Python 对 `db:5432`、`broker:6379`、`gotenberg:3000`、`tika:9998` 做 TCP 连接，全部 **TimeoutError**。从 `gotenberg` 或 `db` 互连同样失败。同一宿主机访问这些容器 IP 却是通的（`host-to-db-ok`、`host-to-broker-ok`）。

原因是本机同时存在 **iptables-nft** 与 **iptables-legacy** 两套过滤表，且 `net.bridge.bridge-nf-call-iptables=1`，网桥上的容器互访会走 FORWARD：

- nft / `iptables`（Docker 29 的 Firewall Backend）里，`FORWARD` 策略是 ACCEPT，并且已经为 `br-35184e2f2b3b`（即 `paperless_default`）写了 `-i br-… -j ACCEPT`。
- **iptables-legacy** 的 `FORWARD` 策略是 **DROP**，其 `DOCKER-FORWARD` 链几乎只覆盖了默认的 `docker0`，没有 compose 自定义网桥的放行规则。包在 legacy 表被丢掉，表现为「同一 compose 网络内连不上」。

这不是 paperless 配置错误，也不是 5432/6379 被 Articles 占用。为了不改动 eShop / Articles 各自网桥上的规则，只在 legacy 表的 `DOCKER-USER` 链里为 paperless 网桥加了一条对内放行（2026-11-15 16:40 左右，Asia/Shanghai）：

```bash
# 网桥名 = br- + paperless_default 网络 ID 的前 12 位
# 本次为 br-35184e2f2b3b；若重新创建网络，名称会变，需要先查：
# docker network inspect paperless_default --format '{{.Id}}' | cut -c1-12
sudo iptables-legacy -I DOCKER-USER -i br-35184e2f2b3b -o br-35184e2f2b3b -j ACCEPT
```

加规则后，webserver 立刻可以连上 `db:5432`、`broker:6379`、`gotenberg:3000`、`tika:9998`。随后只重启了 paperless 的 webserver，没有重启其他项目的容器：

```bash
cd /workspace/paperless-ngx-run
docker compose restart webserver
```

注意：这条 legacy 规则在宿主机重启后不会自动恢复。若以后 webserver 再次出现 `db:5432 - no response` 或 Redis ping 超时，先查网桥名再执行同样的 `-I DOCKER-USER … -j ACCEPT`，不要去改 Articles / eShop 的网桥规则。

## 8. 中文 OCR 尝试与回退到英语

镜像预装的 Tesseract 语言（容器内 `tesseract --list-langs`）是：`deu`、`eng`、`fra`、`ita`、`osd`、`spa`。没有 `chi_sim`。

首次启动时曾在 `docker-compose.env` 中设置：

```env
PAPERLESS_OCR_LANGUAGE=chi_sim+eng
PAPERLESS_OCR_LANGUAGES=chi_sim
```

意图是让入口脚本安装 `tesseract-ocr-chi_sim`。实际日志：

```text
[init-tesseract-langs] Skipped tesseract-ocr-chi_sim: Package not found! :(
```

语言包没有装上，但 `PAPERLESS_OCR_LANGUAGE` 仍指向 `chi_sim`。数据库迁移本身可以完成（`System check identified no issues` 出现在 migrate 阶段），然而 `init-superuser` / `init-system-checks` 会做 Django 系统检查并失败：

```text
SystemCheckError: System check identified some issues:
ERRORS:
?: The selected ocr language chi_sim is not installed. Paperless cannot OCR your documents without it. Please fix PAPERLESS_OCR_LANGUAGE.
s6-rc: warning: unable to start service init-system-checks: command exited 1
```

容器因此进入重启循环，8000 端口仍然 reset。按照「中文 OCR 失败就记录并改用默认英语、不要把栈停在坏状态」的原则，把配置改回：

```env
PAPERLESS_OCR_LANGUAGE=eng
# PAPERLESS_OCR_LANGUAGES=chi_sim  # 已注释
```

然后只重建 webserver：

```bash
cd /workspace/paperless-ngx-run
docker compose up -d webserver
```

日志变为 `[init-tesseract-langs] No additional installs requested`，系统检查通过。若以后要中文 OCR，需要换一个能提供 `tesseract-ocr-chi_sim` 的软件源或自行把训练数据挂进 `/usr/share/tesseract-ocr/5/tessdata/`，而不是只改环境变量。

## 9. 镜像、版本与容器状态

健康检查通过时间约为 **2026-11-15 16:47:29 Asia/Shanghai**。应用日志时间为 16:47:09（同一时区，Paperless 已按 `Asia/Shanghai` 打日志）：

```text
[INFO] Starting granian (main PID: 222)
[INFO] Listening at: http://:::8000
[2026-11-15 16:47:09,783] [INFO] [paperless.asgi] [init] Paperless-ngx version: v3.4.2
[INFO] [celery.apps.worker] celery@… ready.
[INFO] [paperless.management.consumer] Watching /usr/src/paperless/consume using native file system events
```

Web 容器内 Python 为 **3.14.9**。数据库容器：`postgres (PostgreSQL) 18.7 (Debian 18.7-1.pgdg13+2)`。经纪人：`Valkey server v=9.1.3`。Valkey 启动时有一条 `Memory overcommit must be enabled` 警告，不影响本次连通。

本次实际拉取并运行的镜像（`docker image inspect` 的 RepoDigest / Id；Created 为镜像构建时间，已换算为 Asia/Shanghai）：

| 服务 | 镜像标签 | 摘要 / 镜像 ID | 镜像构建时间（Asia/Shanghai） |
| --- | --- | --- | --- |
| webserver | `ghcr.io/paperless-ngx/paperless-ngx:latest` | `sha256:d704e84f88300eb6ab001ab15720a2330ff99169cf9f94d6b8fcc44b63a84c84` | 2026-11-04 05:44 |
| db | `postgres:18` | `sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc` | 2026-11-13 04:53 |
| broker | `valkey/valkey:9-alpine` | `sha256:bf09d58e96d6b4524a15396b65b242bbe18beebbcc15a04d8ee75ddac62fae0b` | 2026-10-27 07:52 |
| gotenberg | `gotenberg/gotenberg:8.38` | `sha256:aa552cc115db488e0f0bcb07446aac13071ad51505b642c84bb894500907b42b` | 2026-10-15 23:05 |
| tika | `apache/tika:3.3.1.0` | `sha256:90b7fa1dc018434075fce9e1d9b88b1e3d0ea6979d0cf86e116c79a8073ae973` | 2026-05-27 22:26 |

`docker compose ps`（健康之后；webserver 因 OCR 回退重建，创建时间晚于其他四个服务）：

```text
NAME                    IMAGE                                        STATUS                   PORTS
paperless-broker-1      docker.io/valkey/valkey:9-alpine             Up (no healthcheck)      6379/tcp
paperless-db-1          docker.io/library/postgres:18                Up (no healthcheck)      5432/tcp
paperless-gotenberg-1   docker.io/gotenberg/gotenberg:8.38           Up (no healthcheck)      3000/tcp
paperless-tika-1        docker.io/apache/tika:3.3.1.0                Up (no healthcheck)      9998/tcp
paperless-webserver-1   ghcr.io/paperless-ngx/paperless-ngx:latest   Up (healthy)             0.0.0.0:8000->8000/tcp, [::]:8000->8000/tcp
```

## 10. 管理员是怎么创建的

没有使用交互式 `createsuperuser`。在 `docker-compose.env` 里设置了 `PAPERLESS_ADMIN_USER=admin`、`PAPERLESS_ADMIN_MAIL=admin@localhost`、`PAPERLESS_ADMIN_PASSWORD=<SEED_ADMIN_PASSWORD>`。

在 chi_sim 导致的重启循环里，`init-superuser` 先撞上 SystemCheckError，当时没有建成可用账号。OCR 改回 `eng` 并重建 webserver 之后，日志为：

```text
[init-superuser] Creating superuser...
Created superuser "admin" with provided password.
[init-superuser] Superuser creation done
```

之后在容器内核对：

```bash
docker compose exec -T webserver python3 /usr/src/paperless/src/manage.py shell -c \
  "from django.contrib.auth import get_user_model; U=get_user_model(); qs=U.objects.filter(is_superuser=True); print('superuser_count=', qs.count()); print('usernames=', list(qs.values_list('username', flat=True)))"
```

输出：`superuser_count= 1`，`usernames= ['admin']`。

若以后在没有设置 `PAPERLESS_ADMIN_*` 的情况下需要补建账号，可在运行目录执行非交互创建（口令用环境变量传入，不要写进文档或 shell 历史）：

```bash
# 仅作备用路径；本次未使用
docker compose exec -T -e DJANGO_SUPERUSER_PASSWORD='<SEED_ADMIN_PASSWORD>' webserver \
  python3 /usr/src/paperless/src/manage.py createsuperuser --noinput --username admin --email admin@localhost
```

## 11. 如何打开与验证

### 11.1 HTTP

```bash
curl -sI --max-time 8 http://127.0.0.1:8000/
# 302 Location: http://127.0.0.1:8000/accounts/login/?next=/

curl -sD - -o /tmp/pl-login-body -w 'http=%{http_code} size=%{size_download}\n' \
  --max-time 15 http://127.0.0.1:8000/accounts/login/
# HTTP/1.1 200 OK
# content-type: text/html; charset=utf-8
# content-language: en-us
# server: granian
# 正文长度 6726，<title>Paperless-ngx sign in</title>
# 表单字段：name="login"（#inputUsername）、name="password"（#inputPassword），按钮「Sign in」
```

本机浏览器可打开：

- 登录页：<http://127.0.0.1:8000/accounts/login/>
- 登录成功后：<http://127.0.0.1:8000/dashboard>
- 用户名：`admin`，口令：运行目录中的 `<SEED_ADMIN_PASSWORD>`

### 11.2 截图（有界面 Playwright Chromium）

本机桌面显示号为 `DISPLAY=:11`。用已缓存的 Playwright Chromium（`/home/box/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`，Python 包 1.49.1）以 **headed** 方式打开上述地址，而不是只用 curl 冒充「已打开浏览器」。截图保存在分析文档目录，不含口令：

| 文件 | 说明 |
| --- | --- |
| [`screenshots/01-login.png`](./screenshots/01-login.png) | 登录页，标题 *Paperless-ngx sign in*，地址 `/accounts/login/`，可见 Username / Password / Sign in |
| [`screenshots/02-dashboard.png`](./screenshots/02-dashboard.png) | 登录成功后的空仪表盘，地址 `/dashboard`，标题 *Dashboard - Paperless-ngx*。顶栏提示 *Successfully signed in as admin.*，欢迎语 *Hello admin, welcome to Paperless-ngx*，卡片 *Paperless-ngx is running!*，统计 *Total documents: 0*。侧栏可见 Paperless-ngx v3.4.2 |

这两张图都在投放冒烟 PDF 之前拍摄，所以仪表盘是空的。

## 12. 消费目录与最小功能检查

绑定关系：

```text
宿主 /workspace/paperless-ngx-run/consume  ->  容器 /usr/src/paperless/consume
宿主 /workspace/paperless-ngx-run/export   ->  容器 /usr/src/paperless/export
```

consumer 在 16:47:08 开始监视消费目录。为验证「放下文件即可入库」，在 16:48 左右向 `consume/` 写入一份 594 字节的最小 PDF（内含英文文本 `paperless smoke test`），文件名 `smoke-test.pdf`。日志时间（Asia/Shanghai）：

```text
16:48:37  File is stable: /usr/src/paperless/consume/smoke-test.pdf
16:48:37  Adding … to the task queue
16:48:37  Consuming smoke-test.pdf
16:48:37  pdftotext exited 0
16:48:38  Encountered an error while running OCR: page already has text! …
          Attempting force OCR to get the text.
16:48:38  [tesseract] Too few characters. Skipping this page
16:48:40  Output file is a PDF/A-2b (as expected)
16:48:40  Document 2026-11-15 smoke-test consumption finished
```

另有 Ghostscript 10.5.1 关于 ToUnicode / 连字的警告，建议升级到 10.7.0，本次没有挡住消费结束。随后消费目录被清空（文件已被取走）。数据库核对：

```text
document_count= 1
[(1, 'smoke-test.pdf', 'smoke-test', 'application/pdf')]
```

这只是一份最小冒烟文件：文本层已存在，强制 OCR 时字符很少，Tesseract 报了 “Too few characters”，但消费流程走完并生成了文档记录。不代表生产级中文扫描件 OCR 已验证（见第 8 节，当前识别语言是 `eng`）。

日常添加文档的方式：把文件拷进 `/workspace/paperless-ngx-run/consume/`，或登录后在网页上 Upload / 拖放。

## 13. 实际遇到的问题（汇总）

1. **同一 compose 网络内容器互访超时**（见第 7 节）。根因是 iptables-legacy 的 FORWARD DROP，与 Docker 29 的 nft 规则并存。处理：仅对 `paperless_default` 对应网桥在 `DOCKER-USER` 放行。未改其他项目的防火墙规则。宿主机重启后需要按网桥名重加。
2. **`tesseract-ocr-chi_sim` 在镜像使用的软件源中不存在**（见第 8 节）。只设置 `PAPERLESS_OCR_LANGUAGES=chi_sim` 不够；若同时把 `PAPERLESS_OCR_LANGUAGE` 设成 `chi_sim`，系统检查失败，webserver 会重启循环。已回退 `eng`。
3. **首次 `up -d` 时 webserver 没有完成迁移和建管理员**，因为第 1 点导致等库 63 秒后 init 失败。修复网络并改回 OCR 后，迁移与超级用户都在一次成功启动里完成。
4. **Valkey** 提示需要 `vm.overcommit_memory=1`。本次没有改宿主机 sysctl，服务可接受连接。
5. **冒烟 PDF** 已有文本层，OCR 阶段有 “page already has text” 和 “Too few characters” 日志，消费仍结束。
6. 本机 desktop Chrome 有时会因出口代理访问不了箱内 `localhost`；本次验证走的是 `DISPLAY=:11` 上的 Playwright Chromium，以及宿主机上的 `curl 127.0.0.1`。

## 14. 服务保持运行；以后如何停或再起

写本文时栈仍在运行，**不要**用 `docker compose down` 结束它，除非明确要求停止。常用命令（一律在 `/workspace/paperless-ngx-run` 下执行，不要对 eShop / Articles 的 compose 项目操作）：

```bash
cd /workspace/paperless-ngx-run
docker compose ps
docker compose logs -f webserver
# 只重启应用容器：
# docker compose restart webserver
# 若要停止 paperless（本次未执行）：
# docker compose stop
```

再起后若 webserver 又连不上 `db` / `broker`，先确认第 7 节的 iptables-legacy 规则还在，再查 `docker compose logs webserver`。

## 15. 本机路径一览

| 路径 | 作用 |
| --- | --- |
| `/workspace/paperless-ngx` | 源码浅克隆，保持干净 |
| `/workspace/paperless-ngx-run` | Compose 运行目录、密钥、consume/export |
| `/workspace/github-paperless-ngx/deploy.md` | 本文 |
| `/workspace/github-paperless-ngx/screenshots/01-login.png` | 登录页截图 |
| `/workspace/github-paperless-ngx/screenshots/02-dashboard.png` | 空仪表盘截图 |
| `/workspace/github-paperless-ngx/paperless-ngx-steps.md` | 分步记录（本步为 Step 3） |

本文没有把真实密钥、数据库口令或管理员口令写入文档目录，也没有把 paperless 源码拷进文档目录。
