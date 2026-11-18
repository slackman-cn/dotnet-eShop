# TrustGraph 仓库分析与部署评估

记录时间：2026-11-19（Asia/Shanghai）。对照仓库为 [trustgraph-ai/trustgraph](https://github.com/trustgraph-ai/trustgraph)，浅克隆提交 [`17e5d74`](https://github.com/trustgraph-ai/trustgraph/commit/17e5d74)（`master`，说明为 `release/v2.11 -> master (#1208)`，提交时间 2026-11-12 21:32:18 UTC，即 2026-11-13 05:32 Asia/Shanghai）。源码只留在分析机的 `/workspace/trustgraph`，不进入本仓库。

本文只覆盖已做完的分析，不包含实际部署。部署约束为：只用 Docker 或 Podman Compose，不使用 Kubernetes 或 Minikube。

## 项目是什么

TrustGraph 是一套面向 W3C 本体的知识图谱运行时，覆盖 RDF / OWL / SHACL / SPARQL。它把文档解析、向量检索、图/三元组存储和流程编排放在同一套部署里，而不是一个单独的图数据库产品。

官方文档入口：

- [部署总览](https://docs.trustgraph.ai/deployment/)
- [Docker Compose](https://docs.trustgraph.ai/deployment/compose.html)
- [如何选择部署方式](https://docs.trustgraph.ai/deployment/choosing-deployment.html)
- [Quickstart](https://docs.trustgraph.ai/quickstart/)

## 怎么部署

不必从这份源码自行编译后再部署。官方路径是先生成配置，再按生成结果启动：

1. 在已安装 Node.js 的机器上运行 `npx @trustgraph/config`，或打开 [配置页面](https://config-ui.demo.trustgraph.ai/)。
2. 下载 `deploy.zip`，其中包含 `docker-compose.yaml`（或 Kubernetes 清单）和 `INSTALLATION.md`。
3. 按安装说明启动。完整跑起来还需要一个云端大模型接口密钥（默认走托管 LLM，而不是本机 Ollama）。

仓库内的 `dev-tools/install/install_trustgraph.sh` 有一套硬件启发式：内存不少于 16 GB，并且有 GPU 或不少于 8 核时倾向 Ollama，否则走 OpenAI；总内存约 15 GB 时会落到托管 LLM。这与「官方推荐先用云端 API」一致。

本次明确不使用 Kubernetes / Minikube。官方文档里 Minikube 方案的门槛更高（约 14.5 GB 内存、9 核），不适合当前这台分析机。

## 官方资源门槛与本机对照

官方 Compose 文档要求给 TrustGraph 留出大约 **12 GB 以上内存** 和 **8 核 CPU**。[选择部署方式](https://docs.trustgraph.ai/deployment/choosing-deployment.html) 里还有一个更松的下限（8 GB / 4 核），但同时说明 16 GB 笔记本在已有其他负载时很可能跑不起来。

分析当时（2026-11-19 00:13，Asia/Shanghai）这台 Debian 13 分析机的实测：

| 项 | 官方 Compose 建议 | 本机当时情况 | 结论 |
| --- | --- | --- | --- |
| CPU | 8 核可用 | 8 核 | 满足 |
| 磁盘 | 需能放下镜像与数据 | 128 GB 盘，已用 20 GB，剩余 109 GB（约 16%） | 满足 |
| 内存 | 建议给栈留出 12 GB 以上 | 总内存 15 GiB，当时约 7.8 GiB 已用、7.8 GiB 可用 | 偏紧，低于 12 GB 建议值 |
| 运行时 | Docker 或 Podman，以及 Compose | 分析当时未安装；已在 Step 3 补齐，见 [docker-install.md](./docker-install.md) | 安装后已具备 |
| Python | 3.11+ | 3.13.5 | 满足 |
| Node.js / npx | 生成配置时需要 | 已安装 | 满足 |
| GPU / Ollama | 可选；无则用云端 LLM | 无 | 走托管 LLM 即可 |

结论：CPU 和磁盘够用，分析当时可用内存达不到官方给 Compose 的 12 GB 建议。若继续部署，应选用 Compose + 托管 LLM，并先再看一遍空闲内存；在内存仍然偏紧时，完整栈可能启动失败或表现不稳。尚未生成 `deploy.zip`，也尚未拉取 TrustGraph 相关镜像。

## Cassandra 在这套栈里的角色

官方默认用 Cassandra 作为图/三元组后台。Cassandra 本身是宽列（分区 KV）存储，查询语言是 CQL，没有 Cypher 或 Gremlin 这类原生图查询语言。

TrustGraph 把它当三元组存储来用：SPARQL 等图查询在 TrustGraph 这一层完成，再映射成对 Cassandra 的读写，并不是 Cassandra 自带图能力。如果更在意原生图查询，官方模板也可以换成 Neo4j、Memgraph 或 FalkorDB。入门仍推荐 Cassandra，主要是因为单机 Compose 更省事，不是因为它是图数据库。

## 官方推荐的 Docker 镜像

标签来自 TrustGraph 2.11 / 2.12 官方模板（[trustgraph-templates](https://github.com/trustgraph-ai/trustgraph-templates) 中的 `images.jsonnet`）。默认组合是 Cassandra + Qdrant + Pulsar。

| 角色 | 镜像 | 类别 |
| --- | --- | --- |
| 图/三元组存储 | `docker.io/cassandra:5.0.8` | 中间件 |
| 向量库 | `docker.io/qdrant/qdrant:v1.18.0` | 中间件 |
| 消息队列 | `docker.io/apachepulsar/pulsar:4.2.1` | 中间件 |
| 对象存储 | `docker.io/minio/minio:v0.20260512.133534-dev` | 中间件 |
| 监控 | `docker.io/prom/prometheus:v3.11.3` | 中间件 |
| 可视化 | `docker.io/grafana/grafana:13.0.1` | 中间件 |
| 日志 | `docker.io/grafana/loki:3.7.2` | 中间件 |
| 业务编排 | `docker.io/trustgraph/trustgraph-flow:<版本>` | TrustGraph 业务镜像 |
| 界面 | `docker.io/trustgraph/trustgraph-ui:2.4.0` | TrustGraph 业务镜像 |
| 文档解析 | `docker.io/trustgraph/trustgraph-docling:<版本>` | TrustGraph 业务镜像 |

`<版本>` 会跟所选的 TrustGraph 发行版走。大模型默认走云端 API，不在这张推荐表里，也不必再跑本地模型镜像。

如果改组件，对应镜像会换成：`rabbitmq:4.1-management` 或 `apache/kafka:4.1.2` 替代 Pulsar；`neo4j`、`memgraph` 或 `falkordb` 替代 Cassandra；`milvusdb/milvus:v2.6.17`（还要配 `etcd`）替代 Qdrant。官方入门建议先用上面那套默认组合。

## 当前状态

- 源码已浅克隆，分析已完成。
- Docker 已安装并验证，见 [docker-install.md](./docker-install.md)。
- 尚未生成 Compose 配置，尚未部署 TrustGraph。
- 完整运行还需要云端 LLM 接口密钥，并需要再次确认可用内存。
