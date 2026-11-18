# Compose 容器互访被 iptables-legacy 拦截

记录时间：2026-11-19 01:04（Asia/Shanghai）。环境与 [docker-install.md](./docker-install.md) 相同：Debian 13，Docker 由官方静态包安装，守护进程用 `/usr/local/sbin/start-dockerd.sh` 启动（没有 systemd）。本记录只说明一次实际故障，不是对静态安装方式的全面否定。

## 现象

TrustGraph 已用官方 2.10 的 `deploy.zip` 在 `/workspace/trustgraph-deploy` 启动 Compose。管理界面 [http://127.0.0.1:8888](http://127.0.0.1:8888) 能打开，但随后显示 `Backend unreachable`，细节为 `bootstrap-status failed: 504`。

API 网关 `api-gateway` 日志反复出现：

```text
TimeoutError: [Errno 110] Connect call failed ('172.18.0.9', 5672)
aiormq.exceptions.AMQPConnectionError: [Errno 110] Connect call failed ('172.18.0.9', 5672)
```

`172.18.0.9` 是同一 Compose 项目里 RabbitMQ 的地址。网关因此无法完成启动，8088 端口没有真正监听，界面就会 504。该容器按 `restart: on-failure:100` 多次重启。

对照实验：

- 宿主机访问 `172.18.0.9:5672` 立即成功（约 1 ms）。
- 从 `api-gateway` 容器访问同一地址的 5672、15672 等端口，以及 Cassandra `9042`、Qdrant `6333`、Garage `3900`、UI `8888`，全部 TCP 超时（约 8 s）。
- 说明不是 RabbitMQ 没起来，而是**容器之间**的通信被丢掉；`hello-world` 当时能跑通，是因为它不需要容器互访。

## 这不是 docker0 没配好

排查时容易怀疑：静态安装、没有 `systemctl start docker`，是不是没像发行版软件包那样配置好 `docker0`。

事实不是这样：

| 项 | 当时状态 |
| --- | --- |
| `docker0` | 已存在，地址 `172.17.0.1/16`，状态 `DOWN`（默认桥没有容器在用，这是正常的） |
| Compose 网桥 | `br-3ec55acc5d7a` 已创建并 `UP`，网段 `172.18.0.0/16`，网关 `172.18.0.1` |
| `ip_forward` | 已开启 |
| `net.bridge.bridge-nf-call-iptables` | 为 `1`（桥接流量会走 iptables FORWARD） |
| 当前 dockerd 规则 | 写在 **iptables-nft** 里，已经包含对该 Compose 网桥的放行：`DOCKER-FORWARD` 中有 `-i br-3ec55acc5d7a -j ACCEPT` |

TrustGraph 的容器都连在 Compose 网桥上，不走 `docker0`。`docker0` 空闲并不等于网络没配好。静态安装、不用 systemd，也不是这次故障的直接原因。

## 真正原因：两套 iptables 叠在一起

本机同时存在：

1. **iptables-nft**（`iptables` 命令默认后端是 `nf_tables`）：FORWARD 策略为 ACCEPT，且已有当前 dockerd 为 `br-3ec55acc5d7a` 写入的 DOCKER 规则。
2. **iptables-legacy**：FORWARD 策略为 **DROP**，DOCKER 相关规则**只覆盖了 `docker0`**，没有 Compose 网桥。计数器显示该链丢掉了全部未匹配报文（当时约 3510 packets / 211K bytes）。

两条栈的 filter FORWARD 都会生效。nft 这边放行之后，legacy 这边仍按 DROP 丢掉容器互访包。这更像是：较早一次 dockerd 启动（或只来得及为默认桥编程）把规则写进了 legacy；补装 `iptables` 后命令走 nft，后续规则写到了 nft，legacy 里的旧 DROP 策略却还在。

安装过程与此有关的背景见 [docker-install.md](./docker-install.md)：第一次启动 dockerd 时本机还没有 `iptables` 命令，后来才用 deb 补装 `iptables 1.8.11 (nf_tables)`。这可以解释为什么会出现“两套规则、一套过时”的局面，但不能把它简单归结成“没配置 docker0”。

## 处理

在 legacy 的 FORWARD 链头部放行该 Compose 网桥（与 nft 侧 dockerd 的做法一致）：

```bash
sudo iptables-legacy -I FORWARD 1 -i br-3ec55acc5d7a -j ACCEPT
```

处理后，从 API 网关探测 RabbitMQ、Cassandra、Qdrant、Garage 的 TCP 均在 1–2 ms 内成功。重启 `api-gateway` 及其他在故障期间启动的处理器后：

- 日志出现 `Async RabbitMQ connected to rabbitmq:5672`
- 随后 `IamAuth: fetched IAM signing public key`
- 网关开始监听：`======== Running on http://0.0.0.0:8088 ========`
- 刷新管理页面后，504 消失，进入 “Sign in to continue” 登录页

这条 legacy 规则在重启 dockerd 或清空 iptables 后不一定还在。若需要固定下来，应把它写进 `/usr/local/sbin/start-dockerd.sh`（在守护进程起来并创建网桥之后执行），或统一清理 legacy 表，只保留 nft 规则。当时尚未改启动脚本。

## 简要结论

容器互访失败，是因为 iptables-legacy 的 FORWARD 默认 DROP，且只放行了 `docker0`，与当前 dockerd 写在 iptables-nft 里的 Compose 网桥规则冲突。不是 Compose 网桥没建，也不是缺少 `systemctl` 导致 `docker0` 未配置。
