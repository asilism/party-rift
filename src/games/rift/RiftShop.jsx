import { useState } from 'react'
import { CATEGORIES, ITEMS, getItem, sumStats, STAT_LABEL, ITEM_SLOTS } from './items.js'
import { CLASSES } from './engine.js'
import { getZodiac } from '../../shared/zodiac.js'

// 아이템 능력치를 한 줄 칩들로 (예: "공격력 +45"). 실제 적용되는(배율 포함) 값으로 보여 준다.
function StatTags({ stats }) {
  return (
    <span className="rift-shop__stats">
      {Object.entries(stats).filter(([, v]) => v).map(([k, v]) => (
        <span key={k} className="rift-shop__stat">
          {STAT_LABEL[k]?.name} {STAT_LABEL[k]?.fmt(v)}
        </span>
      ))}
    </span>
  )
}

// 넥서스 우물 상점 (오버레이). 우물 안에 있을 때만 열 수 있고,
//  - 골드로 아이템을 사면 인벤토리(3칸)에 들어가 능력치가 바로 오른다.
//  - 칸이 꽉 차면 되팔아 자리를 비운다.
export default function RiftShop({ me, onBuy, onSell, onClose }) {
  const [cat, setCat] = useState('attack')
  if (!me) return null
  const cls = CLASSES[me.cls]
  const items = me.items || []
  const full = items.length >= ITEM_SLOTS
  const bonus = sumStats(items)
  const shown = ITEMS.filter((it) => it.cat === cat)
  const owned = new Set(items)

  return (
    <div className="rift-shop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rift-shop__panel">
        <div className="rift-shop__head">
          <div className="rift-shop__title">
            <span className="rift-shop__who">{getZodiac(me.zodiacId)?.emoji} {cls?.icon}{cls?.name}</span>
            <span className="rift-shop__gold">💰 {me.gold}</span>
          </div>
          <button className="btn btn--ghost rift-shop__close" onClick={onClose}>✕ 닫기</button>
        </div>

        {/* 인벤토리 3칸 */}
        <div className="rift-shop__inv">
          {Array.from({ length: ITEM_SLOTS }).map((_, i) => {
            const it = getItem(items[i])
            return (
              <div key={i} className={`rift-shop__slot ${it ? 'rift-shop__slot--filled' : ''}`}>
                {it ? (
                  <button className="rift-shop__sell" onClick={() => onSell(i)} title={`${it.name} 되팔기`}>
                    <span className="rift-shop__slot-icon">{it.icon}</span>
                    <small>{it.name}</small>
                    <span className="rift-shop__sell-tag">↩ 판매</span>
                  </button>
                ) : (
                  <span className="rift-shop__slot-empty">＋</span>
                )}
              </div>
            )
          })}
          <div className="rift-shop__totals">
            {Object.entries(bonus).filter(([, v]) => v).length === 0 ? (
              <span className="rift-shop__totals-none">아직 장비가 없어요</span>
            ) : (
              <StatTags stats={Object.fromEntries(Object.entries(bonus).filter(([, v]) => v))} />
            )}
          </div>
        </div>

        {/* 카테고리 탭 */}
        <div className="rift-shop__tabs">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`rift-shop__tab ${cat === c.id ? 'rift-shop__tab--on' : ''}`}
              style={cat === c.id ? { '--cat': c.color } : null}
              onClick={() => setCat(c.id)}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </div>

        {/* 아이템 목록 */}
        <div className="rift-shop__grid">
          {shown.map((it) => {
            const have = owned.has(it.id)
            const afford = me.gold >= it.cost
            const canBuy = !have && !full && afford
            return (
              <button
                key={it.id}
                className={`rift-shop__item ${canBuy ? '' : 'rift-shop__item--off'}`}
                disabled={!canBuy}
                onClick={() => onBuy(it.id)}
                title={it.desc}
              >
                <span className="rift-shop__item-icon">{it.icon}</span>
                <span className="rift-shop__item-body">
                  <span className="rift-shop__item-name">{it.name}</span>
                  <StatTags stats={sumStats([it.id])} />
                </span>
                <span className="rift-shop__item-cost">
                  {have ? '보유중' : <>💰 {it.cost}</>}
                </span>
              </button>
            )
          })}
        </div>
        <p className="rift-shop__foot">
          {full ? '🎒 인벤토리가 꽉 찼어요 — 되팔아 자리를 비우세요.'
            : '미니언·정글몹·타워·적 영웅을 처치해 골드를 모으세요!'}
        </p>
      </div>
    </div>
  )
}
