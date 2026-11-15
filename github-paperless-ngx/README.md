# github-paperless-ngx：paperless-ngx 分析与运行记录

本目录收录对上游项目 [paperless-ngx/paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) 的分析，与同级的 `github-eShop/`、`github-Articles/` 并列。源码不进入本仓库，只保存在本机研究环境（如分析机上的检出目录）。这是一个 Python / Django + Angular 的文档管理系统，不是 .NET 项目，但仍作为多项目分析仓库中的独立条目。

## 项目信息

| 项 | 内容 |
| --- | --- |
| 上游 | https://github.com/paperless-ngx/paperless-ngx |
| 本机检出 | 浅克隆（`--depth 1`），默认分支 `dev`，提交 `4610171a94e5932e85a80e480032e397cdb6f309`（2026-11-15 01:33 Asia/Shanghai） |
| 版本 | `pyproject.toml` / `src/paperless/version.py` / 前端 `package.json` 均为 **3.4.2** |
| 技术栈 | Python ≥ 3.11（Docker 镜像构建基于 Python 3.14），Django 5.2，Celery，Granian ASGI；前端 Angular 22（`src-ui`，pnpm） |
| 中间件 | Valkey（Redis 兼容消息与缓存）、Postgres 18 / MariaDB 12 / SQLite；可选 Apache Tika 与 Gotenberg；应用容器内还跑 Web、Celery worker/beat、消费目录监视进程 |
| 主要启动路径 | Docker Compose（`docker/compose/`）；也可使用官方安装脚本 `install-paperless-ngx.sh` 或文档中的裸机 / 开发方式 |
| Step 1 结论 | 已浅克隆到本机，未把源码提交进分析仓库，未在本机部署运行 |
| Step 2 结论 | 已完成仓库分析文档（`analysis.md`）；未改源码，未启动服务，未推送 GitHub |

## 文档

- [analysis.md](./analysis.md)：仓库分析（结构、依赖、中间件、进程模型、启动命令、部署与配置、数据流）
- [paperless-ngx-steps.md](./paperless-ngx-steps.md)：分步记录（命令、版本、结果、限制）
