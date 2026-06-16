// 서버 권위 시뮬을 돌릴 실시간 게임 어댑터 등록소.
// 새 실시간 게임은 netgame.js 어댑터를 만들어 여기 한 줄 추가하면 된다.
import { kartNet } from '../src/games/kart/netgame.js'
import { riftNet } from '../src/games/rift/netgame.js'

export const GAMES = {
  kart: kartNet,
  rift: riftNet,
}

export const isRealtimeGame = (id) => Object.prototype.hasOwnProperty.call(GAMES, id)
