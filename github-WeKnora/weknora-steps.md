# WeKnora 步骤记录

环境：分析用 Linux 机器，Debian GNU/Linux 13（trixie），8 核，15 GiB 内存。时区 Asia/Shanghai。源码与密钥不进入本仓库。

## Step 1 下载代码

时间：2026-11-19 07:51（Asia/Shanghai）。

命令与结果：

- 从 https://github.com/Tencent/WeKnora.git 浅克隆（`--depth 1`）到 `/workspace/WeKnora`。
- 分支 `main`，提交 `81a03046bed16504d249bb22591492966fc9c9b9`，短哈希 `81a0304`，说明为 `Merge pull request #5658 from NianJiuZst/fix/lite-kb-clone-move-progress`。
- 提交时间 2026-11-18 06:55:41 -0600（2026-11-18 20:55 Asia/Shanghai），检出大约 276 MB。
- 仓库内 `VERSION` 文件为 `0.9.0`。

未把源码复制进本分析仓库。当时尚未分析部署方式。

## Step 2 检查部署方式

时间：2026-11-19 07:52（Asia/Shanghai）。约束：本次只分析 Docker Compose，不使用 Kubernetes / Helm 作为实际部署路径。

主要结论（详见 [analysis.md](./analysis.md)）：

- 官方推荐路径是标准 Docker Compose：复制 `.env.example` 为 `.env` 并填写密钥后，`docker compose pull && docker compose up -d`。`make start-all` 是同一路径的脚本封装。
- 默认只启动 `frontend`、`app`、`docreader`、`postgres`（ParadeDB `v0.25.11-pg17`）、`redis` 五个核心服务。业务镜像为 `wechatopenai/weknora-ui` / `weknora-app` / `weknora-docreader`。
- Web UI 默认 `http://localhost`（端口 80），后端 API 默认 `8080`。
- 官方建议 4 核 / 8 GB 内存起步。本机 8 核、15 GiB，Docker Engine 29.9.3 与 Compose v5.7.1 已安装，满足起步条件。
- Neo4j、MinIO、Qdrant、Langfuse、MCP 等均为可选 profile。另有 Helm、Lite 单二进制和尚未正式发布的桌面应用。

尚未复制 `.env`，尚未拉取镜像，尚未启动。完整运行还需要配置对话模型和嵌入模型（Ollama 或 OpenAI 兼容接口）。

## Step 3 梳理知识库链路

时间：2026-11-19 07:55 至 07:58（Asia/Shanghai）。详细说明见 [pipeline.md](./pipeline.md)。

主要结论：

- 入库：上传后先落盘并写入 `pending` 记录，经 Asynq 异步解析、分块、嵌入和索引，可选再做摘要、问题生成、图谱抽取等富化，最后变为 `completed`。
- 问答：会话内走插件管线，包括历史与记忆、查询改写、混合检索、重排融合，再流式生成并附引用。
- 知识图谱存在，但默认关闭；需要 Neo4j profile、`NEO4J_ENABLE=true` 以及知识库级抽取开关。抽取使用对话模型，结果写入 Neo4j。
- 模型类型共五类：对话、嵌入、重排、视觉、语音。对话模型和嵌入模型是起步配置，不是系统仅有的两类。

本步只对照文档与源码类型定义，没有启动服务，也没有用真实文档验证效果。
