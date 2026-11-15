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
