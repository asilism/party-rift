# 조디악 럼블 — 단일 Node 호스트(Railway/Render/Fly/Cloud Run 등)용 컨테이너.
# server/index.js 한 프로세스가 dist/ 정적 파일 + /ws WebSocket을 같은 포트로 서빙한다.
# (Vercel 같은 서버리스에는 영속 WebSocket·60Hz 루프가 안 올라가므로 영속 Node 호스트가 필요하다.)

# 1) 빌드 스테이지: dev 의존성(vite)까지 깔고 클라이언트 번들(dist/)을 만든다.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 2) 런타임 스테이지: 운영 의존성(ws) + 서버/공유 로직 + 빌드된 dist/ 만 담아 가볍게.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY src ./src
COPY --from=build /app/dist ./dist
# 호스트가 PORT 환경변수를 주입한다(없으면 8787). 서버가 process.env.PORT를 따른다.
EXPOSE 8787
CMD ["node", "server/index.js"]
