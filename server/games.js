// 서버 권위 시뮬을 돌릴 실시간 게임 어댑터 등록소.
import { riftNet } from '../src/games/rift/netgame.js'

export const GAMES = {
  rift: riftNet,
}

export const isRealtimeGame = (id) => Object.prototype.hasOwnProperty.call(GAMES, id)
