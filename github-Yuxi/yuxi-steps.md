# Yuxi 步骤记录

环境：分析用 Linux 机器，Debian GNU/Linux 13（trixie），8 核，15 GiB 内存。时区 Asia/Shanghai。源码与密钥不进入本仓库。

## Step 1 下载代码

时间：2026-11-19 08:02（Asia/Shanghai）。

命令与结果：

- 从 https://github.com/xerrors/Yuxi.git 浅克隆（`--depth 1`）到 `/workspace/Yuxi`，跟的是默认分支 `main`，不是文档里的 `v0.8.0` 标签。
- 提交 `47e4e5a6d905584b3ed47c993c8a7aeb47c15f39`，短哈希 `47e4e5a`，说明为 `fix: 优化会话工具时间线和 Shell 结果展示`。
- 提交时间 2026-11-18 17:30:36 +0800（Asia/Shanghai），检出大约 35 MB。
- `backend/pyproject.toml` 版本字段为 `0.8.0`。

未把源码复制进本分析仓库。当时尚未分析部署方式。

## Step 2 分析部署方式

时间：2026-11-19 08:03（Asia/Shanghai）。主要结论详见 [analysis.md](./analysis.md)。

- 官方推荐路径是 Docker Compose。开发用 `docker-compose.yml`，生产用 `docker-compose.prod.yml`。没有 Helm / Kubernetes 安装路径。
- 官方教程要求先 `git clone --branch v0.8.0`，再 `./scripts/init.sh`，然后 `docker compose --profile container up --build -d`。应用镜像在本机构建；PostgreSQL、Redis、Milvus、etcd、Neo4j 使用现成镜像。
- 开发验证：`curl --fail http://localhost:5050/api/system/ready`，界面 http://localhost:5173 ，API 文档 http://localhost:5050/docs 。
- 默认开启知识库，标准拓扑包含 Milvus（加 etcd）和 Neo4j。可叠加 `docker-compose.no-knowledge.yml` 关闭。沙盒默认 Container；Cube 需要 KVM，本次不采用。
- 0.8 面向全新部署，不自动升级旧库。
- 本机 Docker 版本满足官方生产下限。尚未初始化，尚未启动。
