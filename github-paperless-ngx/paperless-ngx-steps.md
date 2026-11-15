# paperless-ngx 分析步骤记录

对应上游：[paperless-ngx/paperless-ngx](https://github.com/paperless-ngx/paperless-ngx)  
本机路径：`/workspace/paperless-ngx`  
分支 / 提交：`dev` / `4610171a94e5932e85a80e480032e397cdb6f309`（浅克隆，约 121 MB）  
记录位置：本仓库的 `github-paperless-ngx/`（与 `github-eShop/`、`github-Articles/` 同级）。**不把 paperless-ngx 源码提交进 slackman-cn/dotnet-eShop。**

---

## Step 1：下载代码（2026-11-15 16:19，Asia/Shanghai UTC+8）

目标：把上游仓库浅克隆到本机，供后续分析。未部署、未启动服务，也未把源码拷入分析仓库。

### 命令与结果

```bash
git clone --depth 1 https://github.com/paperless-ngx/paperless-ngx.git /workspace/paperless-ngx
```

- 默认分支为 `dev`（`origin/HEAD -> origin/dev`）。
- 检出提交：`4610171a94e5932e85a80e480032e397cdb6f309`
- 提交说明：`Chore (dev): add tsconfig missing types (#14771)`
- 提交时间：2026-11-14 09:33:39 -0800，即 **2026-11-15 01:33 Asia/Shanghai**
- 工作区大小约 121 MB
- `pyproject.toml` 版本字段为 3.4.2

未执行 `git pull`，未修改检出目录，未推送源码到分析仓库。

**结果：源码已在本机可用，尚未运行。**

---

## Step 2：分析仓库并撰写文档（2026-11-15 16:24，Asia/Shanghai UTC+8）

目标：根据源码与仓库内文档，分析结构、依赖、中间件、进程模型、启动命令和部署方式，写入分析仓库的 `github-paperless-ngx/`，供后续提交到 slackman-cn/dotnet-eShop。本步不部署、不启动容器。

### 做了什么

- 再次确认 `git rev-parse HEAD` 仍为 `4610171a94e5932e85a80e480032e397cdb6f309`，未执行 `git pull`，未修改 `/workspace/paperless-ngx`。
- 阅读并摘录：`README.md`、`docs/setup.md`、`docs/development.md`、`docs/index.md`、`docs/configuration.md` 章节标题、`pyproject.toml`、`Dockerfile`、`paperless.conf.example`、`install-paperless-ngx.sh`、`docker/compose` 下全部 compose 与 `docker-compose.env`、`docker/init-flow.md`、s6 长期服务的 `run` 脚本、`src/paperless/settings`、`src/documents/models.py` / `tasks.py` / `document_consumer.py`、`src-ui/package.json`、`.github/workflows` 的工作流名称、`scripts/` 下 systemd 单元与 `start_services.sh`。
- 核对 `.env` 仅含 `COMPOSE_PROJECT_NAME`，分析文档中的库口令与密钥均改为占位符。
- 未运行 `docker compose`、未安装 Python 依赖、未启动 Granian/Celery。
- 未改动 `github-eShop/` 与 `github-Articles/`。

### 产出

- `/workspace/github-paperless-ngx/README.md`：目录索引与项目信息表
- `/workspace/github-paperless-ngx/analysis.md`：主分析文档
- `/workspace/github-paperless-ngx/paperless-ngx-steps.md`：本步骤记录

### 从源码确认的要点（详见 analysis.md）

- 版本 3.4.2；Python/Django 后端 + Angular 22 前端；Docker 为官方首选安装路径。
- 单个应用镜像内用 s6-overlay 同时运行 Granian、Celery worker、Celery beat、`document_consumer`，可选 Flower。
- 经纪镜像为 `valkey/valkey:9-alpine`（连接串仍是 `redis://`）；数据库可选 Postgres 18、MariaDB 12 或 SQLite；Tika 3.3.1.0 与 Gotenberg 8.38 为可选 Office 支持。
- 官方 compose 模板共 8 个 yml（含 Portainer 与 CI 测试专用文件）。

**结果：分析文档已写完，未启动服务，未推送仓库。**

---

## Step 3：本机部署并运行（2026-11-15 16:50，Asia/Shanghai UTC+8）

目标：在本机用官方 Postgres + Tika + Gotenberg Compose 把 paperless-ngx 跑起来，单独写成部署文档，服务保持运行。不修改、不停止已经在跑的 eShop Aspire 与 Articles 中间件；不把源码或真实密钥写入文档目录；本步不提交、不推送仓库。

详细过程、脱敏后的 compose / env、端口对照、镜像摘要、截图和排障见 [deploy.md](./deploy.md)。下文只记结论。

### 做了什么

- 运行目录：`/workspace/paperless-ngx-run/`（从官方 `docker/compose/docker-compose.postgres-tika.yml`、`docker-compose.env`、`.env` 拷出）。源码检出 `/workspace/paperless-ngx` 保持干净，HEAD 仍为 `4610171a94e5932e85a80e480032e397cdb6f309`。
- 生成真实的 `PAPERLESS_SECRET_KEY`、数据库口令和首次管理员口令，只保存在运行目录；文档中写 `<PAPERLESS_SECRET_KEY>`、`<DEV_DB_PASSWORD>`、`<SEED_ADMIN_PASSWORD>`。
- 设置 `PAPERLESS_TIME_ZONE=Asia/Shanghai`。曾尝试 `PAPERLESS_OCR_LANGUAGE=chi_sim+eng` / `PAPERLESS_OCR_LANGUAGES=chi_sim`，镜像源没有 `tesseract-ocr-chi_sim` 软件包，系统检查失败导致 webserver 重启循环，已回退为 `eng`（镜像自带 deu/eng/fra/ita/osd/spa）。
- `docker compose pull && docker compose up -d`。宿主只发布 `8000:8000`（启动前空闲，未改 8010）。paperless 的 Postgres / Valkey 端口仅在 compose 网络内部，与 Articles 已发布的宿主 5432 / 6379 以及 eShop 高位端口无冲突；事后复查这些容器仍在运行。
- 第一次启动时 webserver 连不上 `db:5432` 和 `broker:6379`。原因是本机 iptables-legacy 的 FORWARD 策略为 DROP，与 Docker 29 的 nft 规则并存，网桥内容器互访被丢掉。只对 `paperless_default` 网桥 `br-35184e2f2b3b` 在 legacy 的 `DOCKER-USER` 链放行后恢复互通，然后重建 webserver。该规则宿主机重启后需按当时网桥名重加。
- webserver 于 16:47:29 变为 healthy。应用日志：Paperless-ngx v3.4.2，Granian 监听 8000。管理员 `admin` 由 `PAPERLESS_ADMIN_*` 在首次成功启动时创建（`Created superuser "admin" with provided password.`），并用 `manage.py` 核对存在。
- `curl`：`/` 返回 302 到 `/accounts/login/?next=/`；登录页 HTTP 200，标题 *Paperless-ngx sign in*。用 `DISPLAY=:11` 上的有界面 Playwright Chromium 打开登录页并登录，截图见 `screenshots/01-login.png`、`screenshots/02-dashboard.png`（空仪表盘，Total documents: 0，截图早于冒烟文件）。
- 向 `consume/smoke-test.pdf` 投放 594 字节最小 PDF，16:48:40 消费完成，数据库中有 1 篇 `smoke-test.pdf`。OCR 阶段有 “page already has text” 和 “Too few characters” 日志，未挡住入库。

### 运行中的镜像

- `ghcr.io/paperless-ngx/paperless-ngx:latest`（v3.4.2），`sha256:d704e84f88300eb6ab001ab15720a2330ff99169cf9f94d6b8fcc44b63a84c84`
- `postgres:18`（容器内 18.7），`sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc`
- `valkey/valkey:9-alpine`（9.1.3），`sha256:bf09d58e96d6b4524a15396b65b242bbe18beebbcc15a04d8ee75ddac62fae0b`
- `gotenberg/gotenberg:8.38`，`sha256:aa552cc115db488e0f0bcb07446aac13071ad51505b642c84bb894500907b42b`
- `apache/tika:3.3.1.0`，`sha256:90b7fa1dc018434075fce9e1d9b88b1e3d0ea6979d0cf86e116c79a8073ae973`

### 产出

- `/workspace/github-paperless-ngx/deploy.md`：独立的本机部署与运行记录
- `/workspace/github-paperless-ngx/screenshots/01-login.png`、`02-dashboard.png`
- 本文件追加 Step 3；`README.md` 增加 deploy.md 与 Step 3 结论

**结果：服务保持运行，URL 为 http://127.0.0.1:8000/ 。未改 eShop / Articles，未提交、未推送。**
