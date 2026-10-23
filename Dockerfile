# Node 24:node:sqlite 免 --experimental-sqlite flag(ADR 0006 / 0003)。纯 JS 依赖,无需构建工具链。
FROM node:24-slim AS build
WORKDIR /app
# 国内网络:用 npmmirror 镜像源,避免拉官方 registry 超时(UND_ERR_BODY_TIMEOUT)
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# pnpm 不认 NPM_CONFIG_REGISTRY(BUGS.md),必须用 --registry 显式指向 npmmirror,否则拉官方超时
RUN pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# 前端构建:React + Vite + echarts → web/dist(供 Hono serveStatic 到 /dashboard)
FROM node:24-slim AS webbuild
WORKDIR /app/web
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
# 用 npm(避开 pnpm v10 两坑:lockfile 版本不兼容 + 禁依赖 build 脚本);.npmrc 指 npmmirror 防拉官方超时
COPY web/.npmrc web/package.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
# tzdata:slim 镜像不含时区库,缺它则 TZ=Asia/Shanghai 失效、Date 回落 UTC,定点同步会偏 8 小时
# 国内网络:apt 换 aliyun 镜像,避免拉 deb.debian.org 超时(exit 100)
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# 同上:pnpm 用 --registry 显式走 npmmirror(BUGS.md:此处曾漏配,runtime install 拉官方超时 build 失败)
RUN pnpm install --frozen-lockfile --prod --registry=https://registry.npmmirror.com
COPY --from=build /app/dist ./dist
COPY --from=webbuild /app/web/dist ./web/dist
ENV NODE_ENV=production
# 扫码登录页 / 代理服务端口
EXPOSE 3333
# 常驻:起登录服务 + 每天定点同步(采集→补数据→打标→分析)
CMD ["node", "dist/scheduler.js"]
