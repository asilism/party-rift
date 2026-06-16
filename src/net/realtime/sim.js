// 게임 무관 고정틱 시뮬레이터 — 권위 서버(④)와 클라 로컬 예측(①)에서 동일하게 쓴다.
//
// 게임 어댑터 계약(realtime game adapter):
//   STEP        : number   물리 한 틱(초)
//   createGame(players, opts) -> state
//   setInput(state, playerId, input)        조향/이동 등 "지속" 입력을 상태에 적어둠
//   applyAction(state, action, playerId)    아이템/스킬/구매 등 1회성 입력
//   step(state, dt)                         dt초만큼 진행(봇 AI 포함)
//   makeView(state) -> view                 직렬화 가능한 렌더용 스냅샷
//   makeBot(state, playerId)                이탈한 사람 자리를 봇이 인계
//
// 입력은 setInput으로 상태에 "달라붙어" 다음 변경까지 유지되므로,
// 시뮬레이터는 그저 고정 STEP으로 step만 돌리면 된다.
export class RealtimeSim {
  constructor(adapter, state, startTick = 0) {
    this.a = adapter
    this.state = state
    this.acc = 0
    this.tick = startTick
  }

  setInput(playerId, input) {
    this.a.setInput(this.state, playerId, input)
  }

  applyAction(action, playerId) {
    this.a.applyAction?.(this.state, action, playerId)
  }

  // 실제 경과(ms)만큼 고정 STEP으로 여러 번 진행. 진행한 틱 수를 돌려준다.
  // 너무 큰 간격(탭 비활성 등)은 잘라 폭주를 막는다.
  advance(dtMs) {
    const stepMs = this.a.STEP * 1000
    this.acc += Math.min(250, Math.max(0, dtMs))
    let n = 0
    while (this.acc >= stepMs) {
      this.a.step(this.state, this.a.STEP)
      this.acc -= stepMs
      this.tick++
      n++
      if (n > 20) { this.acc = 0; break } // 안전벨트
    }
    return n
  }

  view() {
    return this.a.makeView(this.state)
  }
}
