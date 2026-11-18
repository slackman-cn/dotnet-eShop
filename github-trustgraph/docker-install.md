# 本机 Docker 安装步骤

记录时间：2026-11-19 00:35（Asia/Shanghai）。环境是分析用的 Debian GNU/Linux 13（trixie）机器，用户为 `box`，具备免密 `sudo`。这台机器没有可用的 systemd 作为 init，因此 Docker 守护进程用脚本启动，而不是 `systemctl enable --now docker`。

安装完成后的版本：

| 组件 | 版本 |
| --- | --- |
| Docker Engine / Client | 29.9.3 |
| containerd | v2.4.2 |
| runc | 1.5.2 |
| Docker Compose 插件 | v5.7.1（实际生效的是 `~/.docker/cli-plugins/docker-compose`） |
| Docker Buildx 插件 | v0.39.0 |
| iptables | 1.8.11（`nf_tables` 后端） |

验证：`docker run --rm hello-world` 已成功拉取并输出官方欢迎信息。存储驱动为 `overlay2`，cgroup 为 v2 / `cgroupfs`。

## 为什么不用官方 apt 源

原先计划按 Docker 官方文档，为 Debian 添加 `download.docker.com` 的 apt 源，再安装 `docker-ce`、`docker-ce-cli`、`containerd.io`、`docker-buildx-plugin`、`docker-compose-plugin`。

`sudo apt-get update` 失败：访问 `http://deb.debian.org`（trixie、trixie-updates、debian-security）时返回 `500 Internal Server Error`，对端地址是 `198.18.0.1:80`，软件源被报告为未签名。把 `/etc/apt/sources.list.d/debian.sources` 临时改成 HTTPS 后，又出现 SSL `unexpected eof`（对端仍是 `198.18.0.1:443`）。即使加上 `Acquire::http::Proxy=false`，结果相同。

同一时间，用 `curl` 访问这些 HTTP / HTTPS 地址可以返回 200，Google Chrome 的 HTTPS 软件源也能正常 `Hit`。说明问题出在 apt 走的那条代理路径，而不是 Debian 源本身不可达。

`debian.sources` 已恢复为原来的 HTTP URI，没有长期改动系统软件源。随后改用 Docker 官方静态包，并用 `curl` 单独补上 apt 装不上的 `iptables`。

## 安装步骤

以下命令在 `/tmp` 下执行，安装目标为系统路径。

### 1. 下载官方静态包与插件

从 [Docker 静态包目录](https://download.docker.com/linux/static/stable/x86_64/) 取当时最新的 `docker-29.9.3.tgz`。Compose 与 Buildx 取 GitHub Release 当时的最新版：

```bash
curl -fL --retry 3 --retry-delay 2 -o docker-29.9.3.tgz \
  https://download.docker.com/linux/static/stable/x86_64/docker-29.9.3.tgz
curl -fL --retry 3 --retry-delay 2 -o docker-compose-linux-x86_64 \
  https://github.com/docker/compose/releases/download/v5.8.0/docker-compose-linux-x86_64
curl -fL --retry 3 --retry-delay 2 -o buildx-v0.39.0.linux-amd64 \
  https://github.com/docker/buildx/releases/download/v0.39.0/buildx-v0.39.0.linux-amd64
```

说明：虽然下载的是 Compose v5.8.0，但本机 `~/.docker/cli-plugins/docker-compose` 里已有一份 v5.7.1，CLI 会优先用用户目录下的插件，所以 `docker compose version` 显示的是 v5.7.1。系统目录 `/usr/local/lib/docker/cli-plugins/` 里仍保留了这次放入的 v5.8.0 与 Buildx。

### 2. 安装到 `/usr/local`

```bash
sudo tar xz -C /tmp -f docker-29.9.3.tgz
sudo install -m 0755 \
  docker/docker docker/dockerd docker/containerd docker/runc \
  docker/ctr docker/docker-proxy docker/docker-init \
  docker/containerd-shim-runc-v2 \
  /usr/local/bin/
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo install -m 0755 docker-compose-linux-x86_64 \
  /usr/local/lib/docker/cli-plugins/docker-compose
sudo install -m 0755 buildx-v0.39.0.linux-amd64 \
  /usr/local/lib/docker/cli-plugins/docker-buildx
```

将用户 `box` 加入 `docker` 组，并写入基本守护进程配置：

```bash
sudo groupadd --system docker   # 若组已存在可跳过
sudo usermod -aG docker box
sudo mkdir -p /etc/docker /var/lib/docker
echo '{"storage-driver":"overlay2","log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' \
  | sudo tee /etc/docker/daemon.json
```

### 3. 补装 iptables

第一次启动 `dockerd` 时，containerd 已起来，但网络控制器失败并退出，日志为：

```text
failed to start daemon: Error initializing network controller: ...
failed to register "bridge" driver: failed to create NAT chain DOCKER: iptables not found
```

本机已有 `nftables`，但没有 `iptables` 命令（它位于 `/usr/sbin`）。因为 apt 不可用，改为用 `curl` 从 `https://deb.debian.org/debian` 下载 Debian 13 的 deb，校验 SHA256 后用 `dpkg -i` 安装：

- `iptables_1.8.11-2_amd64.deb`
- `libip4tc2_1.8.11-2_amd64.deb`
- `libip6tc2_1.8.11-2_amd64.deb`
- `libnetfilter-conntrack3_1.1.0-1_amd64.deb`
- `libnfnetlink0_1.0.2-3_amd64.deb`

`libmnl0`、`libxtables12`、`libnftnl11`、`netbase` 本来就已经安装。安装后 `iptables --version` 为 `iptables v1.8.11 (nf_tables)`。

### 4. 启动守护进程

这台机器没有可用的 systemd init，因此把启动脚本放在 `/usr/local/sbin/start-dockerd.sh`：用 `setsid` 在独立会话里启动 `/usr/local/bin/dockerd`，日志写入 `/var/log/dockerd.log`，并等待套接字出现。`PATH` 必须包含 `/usr/sbin`，否则仍然找不到 `iptables`。

```bash
sudo /usr/local/sbin/start-dockerd.sh
```

成功后日志中有 `API listen on /var/run/docker.sock`。套接字属主为 `root:docker`。为了让尚未重新登录、补充组还没生效的会话也能使用，启动脚本会把套接字权限设为 `666`。

机器重启后需要再次执行上面这条命令，守护进程不会自动拉起。

### 5. 验证

```bash
docker version
docker compose version
docker buildx version
docker run --rm hello-world
```

`hello-world:latest` 已从 Docker Hub 拉取成功，容器能跑通。说明守护进程、overlay2、出网拉镜像和桥接网络都可用。

## 需要记住的限制

- 不要用这台机器上的 `apt-get update` / `apt-get install docker-ce` 作为当前安装路径，除非先解决 apt 经 `198.18.0.1` 失败的问题。
- 重启后要手动执行 `sudo /usr/local/sbin/start-dockerd.sh`。
- 新登录会话会继承 `docker` 组；若当前会话还没有该组，可继续用上述套接字权限，或用 `sg docker -c 'docker ...'`。
- 安装 Docker 只是 TrustGraph 部署的前置条件，并不等于已经部署 TrustGraph。

## 后续问题：Compose 容器互访失败

`hello-world` 只能证明守护进程、拉镜像和默认桥接可用，不能证明 Compose 项目里的容器可以互相访问。2026-11-19 01:04（Asia/Shanghai）在启动 TrustGraph 时发现：宿主机能连上容器端口，容器之间的 TCP 却全部超时。原因不是 `docker0` 没建好，而是本机同时存在 iptables-nft 与 iptables-legacy 两套规则，legacy 的 FORWARD 默认 DROP，且只放行了 `docker0`。处理方法和完整对照见 [docker-network.md](./docker-network.md)。
