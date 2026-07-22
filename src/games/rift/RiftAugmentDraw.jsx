import { useEffect } from 'react'
import { AUG_BY_ID, RARITY_META } from './augments.js'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'
import { t } from '../../shared/i18n.js'

// 조디악 증강 뽑기 — 5의 배수 파도마다 3장 중 1장 선택(시뮬은 엔진이 정지). 하데스 신뽑기/롤 증강식.
export default function RiftAugmentDraw({ draw, zodiacId, wave, onPick }) {
  useEffect(() => { sound.key() }, [draw?.seq]) // 카드 공개음
  if (!draw) return null
  const cards = (draw.choices || []).map((id) => AUG_BY_ID[id]).filter(Boolean)
  return (
    <div className="aug-draw">
      <div className="aug-draw__panel">
        <div className="aug-draw__head">
          <span className="aug-draw__wave">🌊 {wave}{t('번째 파도')}</span>
          <h2 className="aug-draw__title">✨ {t('조디악 증강')}</h2>
          <span className="aug-draw__sub">{t('하나를 골라 강해지세요 — 이 판 동안 유지됩니다')}</span>
        </div>
        <div className="aug-draw__cards">
          {cards.map((a) => {
            const meta = RARITY_META[a.rarity]
            const isSig = !!a.zodiac
            return (
              <button
                key={a.id}
                className={`aug-card aug-card--${a.rarity}`}
                style={{ '--rar': meta.color }}
                onClick={() => { sound.go(); onPick(a.id) }}
              >
                <span className="aug-card__rarity">{isSig ? `${getZodiac(zodiacId)?.emoji} ${t('시그니처')}` : t(meta.label)}</span>
                <span className="aug-card__icon">{a.icon}</span>
                <span className="aug-card__name">{t(a.name)}</span>
                <span className="aug-card__desc">{t(a.desc)}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
