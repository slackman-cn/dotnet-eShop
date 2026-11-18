# TrustGraph 步骤记录

环境：分析用 Linux 机器，Debian GNU/Linux 13（trixie），8 核，15 GiB 内存。时区 Asia/Shanghai。源码与密钥不进入本仓库。

## Step 1 下载代码

时间：2026-11-19。

命令与结果：

- 从 https://github.com/trustgraph-ai/trustgraph.git 浅克隆（`--depth 1`）到 `/workspace/trustgraph`。
- 分支 `master`，提交 `17e5d74`，说明为 `release/v2.11 -> master (#1208)`。
- 提交时间 2026-11-12 21:32:18 UTC（2026-11-13 05:32 Asia/Shanghai），检出大约 37 MB。

未把源码复制进本分析仓库。

## Step 2 仓库分析与环境对照

时间：2026-11-19。约束：只用 Docker / Podman Compose，不使用 Kubernetes / Minikube。

主要结论（详见 [analysis.md](./analysis.md)）：

- 官方部署路径是 `npx @trustgraph/config` 或 https://config-ui.demo.trustgraph.ai/ 生成 `deploy.zip`，不必先编译这份源码。
- Compose 建议给 TrustGraph 留出 12 GB 以上内存和 8 核。本机 8 核、剩余磁盘约 109 GB，满足；分析当时（00:13）可用内存约 7.8 GiB，低于 12 GB 建议值。
- 分析当时未安装 Docker 或 Podman。Python 3.13.5 与 Node / npx 已具备。无 GPU，适合走托管 LLM。
- 默认中间件为 Cassandra + Qdrant + Pulsar，加上 MinIO 与监控组件。Cassandra 是宽列存储，SPARQL 等图查询在 TrustGraph 层完成。
- 官方 2.11 / 2.12 模板中的推荐镜像见分析文档中的表格。

未生成 `deploy.zip`，未部署。完整运行还需要云端 LLM 接口密钥。

## Step 3 安装 Docker

时间：2026-11-19 00:35（Asia/Shanghai）。详细命令见 [docker-install.md](./docker-install.md)。

过程摘要：

1. 官方 apt 安装路径失败：`apt-get update` 访问 Debian 源时经 `198.18.0.1` 返回 500（HTTP）或 SSL 意外中断（HTTPS）。`debian.sources` 已恢复原状。
2. 改用官方静态包 `docker-29.9.3.tgz`，二进制安装到 `/usr/local/bin`，插件安装到 `/usr/local/lib/docker/cli-plugins`。
3. 第一次启动 `dockerd` 因缺少 `iptables` 失败。用 `curl` 下载 Debian deb 后 `dpkg -i` 安装了 `iptables` 1.8.11 及其依赖。
4. 因没有 systemd init，使用 `/usr/local/sbin/start-dockerd.sh` 以 `setsid` 启动守护进程。
5. `docker run --rm hello-world` 成功。

安装结果：Docker Engine 29.9.3，Compose v5.7.1，Buildx v0.39.0。用户 `box` 已加入 `docker` 组。机器重启后需重新执行启动脚本。

仍未部署 TrustGraph。
