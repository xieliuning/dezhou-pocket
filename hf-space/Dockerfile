FROM node:20-alpine

RUN apk add --no-cache git

WORKDIR /app

# 构建时拉取 GitHub 仓库最新代码（公开仓库无需令牌）
RUN git clone --depth 1 https://github.com/xieliuning/dezhou-pocket.git /app

# HF Spaces 要求监听 7860
ENV PORT=7860
EXPOSE 7860

CMD ["node", "server/server.js"]
