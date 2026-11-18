# github-trustgraph：trustgraph-ai/trustgraph 分析与环境记录

本目录收录对上游项目 [trustgraph-ai/trustgraph](https://github.com/trustgraph-ai/trustgraph) 的分析，与同级的 `github-eShop/`、`github-Articles/`、`github-paperless-ngx/` 并列。源码不进入本仓库，只保存在本机研究环境（如 `/workspace/trustgraph`）。这不是 .NET 项目，但仍作为多项目分析仓库中的独立条目。

## 项目信息

| 项 | 内容 |
| --- | --- |
| 上游 | https://github.com/trustgraph-ai/trustgraph |
| 本机检出 | 浅克隆（`--depth 1`），默认分支 `master`，提交 `17e5d74`（release/v2.11 -> master (#1208)，2026-11-13 05:32 Asia/Shanghai），约 37 MB |
| 技术栈 | W3C 本体运行时（RDF / OWL / SHACL / SPARQL）；官方用 Docker / Podman Compose 或 Kubernetes 部署。本次约束为只用 Compose，不使用 Kubernetes / Minikube |
| 默认中间件 | 官方 2.10 推荐为 Cassandra、Qdrant、Garage（对象存储，取代较早文档中的 MinIO）和 Pulsar；本次为节省内存改用 RabbitMQ，并去掉了 Grafana / Prometheus / Loki 与 MCP |
| 主要启动路径 | `npx @trustgraph/config` 或 https://config-ui.demo.trustgraph.ai/ 生成 `deploy.zip`，再按其中的 `docker-compose.yaml` 启动 |
| 官方文档 | https://docs.trustgraph.ai/deployment/ |
| Step 1 结论 | 已浅克隆到本机 `/workspace/trustgraph`，未把源码提交进分析仓库 |
| Step 2 结论 | 已完成仓库分析与环境对照（见 `analysis.md`）。8 核与磁盘足够；分析当时可用内存约 7.8 GiB，低于官方 Compose 建议的 12 GB 以上。当时尚未安装 Docker。未生成 `deploy.zip`，未部署 |
| Step 3 结论 | 2026-11-19 00:35（Asia/Shanghai）已在本机装好 Docker Engine 29.9.3、Compose v5.7.1、Buildx v0.39.0，并用 `hello-world` 验证。详细步骤见 `docker-install.md` |
| Step 4 结论 | 2026-11-19 已用官方 2.10 Compose 在 `/workspace/trustgraph-deploy` 启动。界面可打开，但因 iptables-legacy 与 iptables-nft 规则冲突，容器互访被丢弃，API 网关连不上 RabbitMQ，页面报 `bootstrap-status failed: 504`。已在 legacy FORWARD 中放行 Compose 网桥后恢复，详见 `docker-network.md` |

## 文档

- [analysis.md](./analysis.md)：仓库分析与部署评估（方式、门槛、本机对照、官方推荐镜像）
- [docker-install.md](./docker-install.md)：本机 Docker 安装步骤与验证结果
- [docker-network.md](./docker-network.md)：Compose 容器互访被 iptables-legacy 拦截的现象、原因和处理
- [trustgraph-steps.md](./trustgraph-steps.md)：分步记录（命令、版本、结果、限制）
