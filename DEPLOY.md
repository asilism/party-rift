# 배포 가이드

파티 리프트는 **상태를 들고 계속 떠 있는 단일 Node 서버**다. `server/index.js` 한 프로세스가

- `dist/` 정적 파일(클라이언트 번들)을 서빙하고
- `/ws` WebSocket으로 매치메이킹 큐 → 드래프트 → 60Hz 실시간 전투를 주도한다.

> ⚠️ **Vercel·Netlify Functions 같은 서버리스에는 못 올린다.** 영속 WebSocket 서버와
> 게임 틱 루프, 인메모리 매치 상태가 서버리스 모델과 맞지 않는다. 아래의 **영속 Node 호스트**가 필요하다.

서버는 `process.env.PORT`(없으면 8787)를 따르고 `0.0.0.0`에 바인딩하므로, 대부분의 PaaS가 추가 설정 없이 동작한다.
WebSocket은 같은 도메인의 `/ws`로 자동 연결되어(`src/net/RoomClient.js`) 별도 환경변수가 필요 없다.

---

## 로컬에서 운영 모드로 확인

```bash
npm install
npm run build      # dist/ 생성
npm start          # http://localhost:8787 (= node server/index.js)
```

브라우저로 http://localhost:8787 접속 → 큐 → 드래프트 → 전투까지 한 포트로 돈다.

---

## 방법 1) Docker (어느 호스트든 동일 · 권장)

리포 루트에 `Dockerfile`이 있다. 빌드 스테이지에서 `dist/`를 만들고, 런타임 스테이지는 `ws` + `server/` + `src/` + `dist/`만 담는다.

로컬 테스트:

```bash
docker build -t party-rift .
docker run -p 8787:8787 party-rift   # http://localhost:8787
```

### Railway
1. GitHub에 푸시
2. Railway → **New Project → Deploy from GitHub repo** → 이 리포 선택
3. `Dockerfile`을 자동 감지해 빌드·배포. `PORT`는 Railway가 주입한다(설정 불필요)
4. **Settings → Networking → Generate Domain**으로 공개 URL 발급

### Render
1. Render → **New → Web Service** → 리포 연결
2. **Runtime: Docker** 선택 → 나머지 기본값
3. 배포 완료 후 발급된 `onrender.com` 도메인으로 접속 (wss 자동)

### Fly.io
```bash
fly launch     # Dockerfile 감지 → fly.toml 생성(internal_port/PORT 자동)
fly deploy
```

---

## 방법 2) Docker 없이 (Railway/Render 빌드팩)

컨테이너를 안 쓰고 Node 빌드팩으로 올릴 수도 있다. 서비스 설정에서:

- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`

> 빌드 단계에서 dev 의존성(vite)이 깔려야 한다. Render·Railway(Nixpacks)는 기본적으로
> 빌드 시 dev 의존성을 포함하므로 그대로 동작한다. 만약 빌드에서 `vite: not found`가 나면
> Docker(방법 1)로 가면 확실하다.

---

## 체크리스트

- [ ] `npm run build && npm start`가 로컬에서 동작하는지 먼저 확인
- [ ] 호스트가 HTTPS를 제공하는지(대부분 자동) → 그래야 클라가 `wss://`로 붙는다
- [ ] 공개 도메인 접속 시 큐 입장 → 드래프트 → 전투까지 진행되는지
- [ ] (선택) 무료 플랜의 슬립/콜드스타트 정책 확인 — 첫 접속이 느릴 수 있다

환경변수는 따로 필요 없다(`PORT`는 호스트가 주입).
