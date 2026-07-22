import { useEffect, useRef, useState } from 'react'
import { CATEGORIES, ITEMS, getItem, sumStats, STAT_LABEL, ITEM_SLOTS, SELL_REFUND, buildQuote } from './items.js'
import { CLASSES, ENHANCE_MAX, enhanceCost, enhanceRate } from './engine.js'
import { getZodiac } from '../../shared/zodiac.js'
import { sound } from '../../shared/sound.js'
import { t } from '../../shared/i18n.js'

// 아이템 능력치를 한 줄 칩들로 (예: "공격력 +45"). 실제 적용되는(배율 포함) 값으로 보여 준다.
function StatTags({ stats }) {
  return (
    <span className="rift-shop__stats">
      {Object.entries(stats).filter(([, v]) => v).map(([k, v]) => (
        <span key={k} className="rift-shop__stat">
          {t(STAT_LABEL[k]?.name)} {STAT_LABEL[k]?.fmt(v)}
        </span>
      ))}
    </span>
  )
}

// 수호석 우물 상점 (오버레이). 우물 안에 있을 때만 열 수 있고,
//  - 골드로 아이템을 사면 인벤토리(5칸)에 들어가 능력치가 바로 오른다.
//  - 칸이 꽉 차면 되팔아 자리를 비운다.
//  - 무한 방어에서는 꽉 찬 뒤에도 골드로 아이템을 "강화"해 계속 성장한다(실패 시 파괴 없음).
export default function RiftShop({ me, mode, onBuy, onSell, onResetShop, onEnhance, onClose }) {
  const [cat, setCat] = useState('attack')
  const [flash, setFlash] = useState(null) // { slot, ok } — 강화 결과 반짝
  const seqRef = useRef(me?.enhanceSeq || 0)
  // 강화 결과 감지: enhanceSeq가 바뀌면 해당 슬롯을 성공/실패로 반짝이고 소리를 낸다
  useEffect(() => {
    if (!me) return undefined
    if (me.enhanceSeq !== seqRef.current) {
      seqRef.current = me.enhanceSeq
      setFlash({ slot: me.enhanceSlot, ok: me.enhanceOk })
      sound.enhance(me.enhanceOk)
      const tm = setTimeout(() => setFlash(null), 650)
      return () => clearTimeout(tm)
    }
    return undefined
  }, [me])
  if (!me) return null
  const cls = CLASSES[me.cls]
  const items = me.items || []
  const plusArr = me.itemPlus || []
  const full = items.length >= ITEM_SLOTS
  const canEnhance = mode === 'defense' // 강화는 무한 방어 전용
  const bonus = sumStats(items, plusArr) // 강화 반영 합산
  const shown = ITEMS.filter((it) => it.cat === cat)
  const owned = new Set(items)

  return (
    <div className="rift-shop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rift-shop__panel">
        <div className="rift-shop__head">
          <div className="rift-shop__title">
            <span className="rift-shop__who">{getZodiac(me.zodiacId)?.emoji} {cls?.icon}{t(cls?.name)}</span>
            <span className="rift-shop__gold">💰 {me.gold}</span>
          </div>
          <div className="rift-shop__head-btns">
            {onResetShop && (
              <button
                className="btn btn--ghost rift-shop__undo"
                onClick={onResetShop}
                disabled={!me.shopUndo}
                title={t('마지막 구매/판매를 한 건씩 취소합니다 (무료). 상점을 벗어나면 그 전 변경은 취소할 수 없어요.')}
              >
                {t('↺ 되돌리기')}
              </button>
            )}
            <button className="btn btn--ghost rift-shop__close" onClick={onClose}>{t('✕ 닫기')}</button>
          </div>
        </div>

        {/* 인벤토리 (ITEM_SLOTS칸) */}
        <div className="rift-shop__inv">
          {Array.from({ length: ITEM_SLOTS }).map((_, i) => {
            const it = getItem(items[i])
            const sellPrice = it ? Math.floor(it.cost * SELL_REFUND) : 0
            const plus = plusArr[i] || 0
            const maxed = plus >= ENHANCE_MAX
            const cost = enhanceCost(plus)
            const rate = Math.round(enhanceRate(plus) * 100)
            const afford = me.gold >= cost
            const flashCls = flash && flash.slot === i ? (flash.ok ? ' rift-shop__slot--ok' : ' rift-shop__slot--fail') : ''
            return (
              <div key={i} className={`rift-shop__slot ${it ? 'rift-shop__slot--filled' : ''}${flashCls}`}>
                {it ? (
                  <>
                    <button
                      className="rift-shop__sell"
                      onClick={() => onSell(i)}
                      title={`${t(it.name)} ${t('되팔기')} — 💰${sellPrice} ${t('돌려받음')}`}
                    >
                      <span className="rift-shop__slot-icon">
                        {it.icon}
                        {plus > 0 && <b className="rift-shop__plus">+{plus}</b>}
                      </span>
                      <small>{t(it.name)}</small>
                      <span className="rift-shop__sell-tag">↩ 💰{sellPrice}</span>
                    </button>
                    {canEnhance && onEnhance && (
                      <button
                        className="rift-shop__enhance"
                        onClick={() => onEnhance(i)}
                        disabled={maxed || !afford}
                        title={maxed
                          ? t('최대 강화입니다')
                          : t('강화 도전 — 실패해도 아이템은 그대로(골드만 소모). 무제한 스탯(공격력·주문력·체력)에 특히 효과적이에요.')}
                      >
                        {maxed
                          ? <>⚒️ MAX</>
                          : <><span className="rift-shop__enh-cost">⚒️💰{cost}</span><b className="rift-shop__enh-rate">{rate}%</b></>}
                      </button>
                    )}
                  </>
                ) : (
                  <span className="rift-shop__slot-empty">＋</span>
                )}
              </div>
            )
          })}
          <div className="rift-shop__totals">
            {Object.entries(bonus).filter(([, v]) => v).length === 0 ? (
              <span className="rift-shop__totals-none">{t('아직 장비가 없어요')}</span>
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
              {c.icon} {t(c.name)}
            </button>
          ))}
        </div>

        {/* 아이템 목록 — 재료(from)를 갖고 있으면 조합 할인가를 보여 준다 */}
        <div className="rift-shop__grid">
          {shown.map((it) => {
            const have = owned.has(it.id)
            const quote = buildQuote(items, it.id)
            const combining = quote.consumes.length > 0
            const afford = me.gold >= quote.price
            const hasRoom = items.length - quote.consumes.length < ITEM_SLOTS
            const canBuy = !have && hasRoom && afford
            const recipe = (it.from || []).map((c) => t(getItem(c)?.name)).join(' + ')
            const tip = [
              t(it.desc),
              recipe && `${t('조합 재료')}: ${recipe} (${t('갖고 있으면 그 가격만큼 할인 + 슬롯 확보')})`,
              it.active && `${t('사용 효과')}: ${t(it.active.label)} (${t('쿨다운')} ${it.active.cd}s)`,
            ].filter(Boolean).join('\n')
            return (
              <button
                key={it.id}
                className={`rift-shop__item ${canBuy ? '' : 'rift-shop__item--off'}`}
                disabled={!canBuy}
                onClick={() => onBuy(it.id)}
                title={tip}
              >
                <span className="rift-shop__item-icon">{it.icon}</span>
                <span className="rift-shop__item-body">
                  <span className="rift-shop__item-name">
                    {t(it.name)}
                    {it.active && <span className="rift-shop__item-active" title={t('사용 효과가 있는 아이템')}>⚡</span>}
                    {it.from && (
                      <span className="rift-shop__item-recipe">
                        {it.from.map((c) => getItem(c)?.icon).join('')}▶
                      </span>
                    )}
                  </span>
                  <StatTags stats={sumStats([it.id])} />
                </span>
                <span className="rift-shop__item-cost">
                  {have ? t('보유중') : combining
                    ? <><s className="rift-shop__item-full">{it.cost}</s> 🔧💰{quote.price}</>
                    : <>💰 {it.cost}</>}
                </span>
              </button>
            )
          })}
        </div>
        <p className="rift-shop__foot">
          {canEnhance && full
            ? t('⚒️ 인벤토리가 꽉 찼어요 — 아이템을 강화해 계속 강해지세요! (실패해도 아이템은 그대로)')
            : full ? t('🎒 인벤토리가 꽉 찼어요 — 되팔아 자리를 비우세요.')
              : t('병사·정글몹·타워·적 영웅을 처치해 골드를 모으세요!')}
          <span className="rift-shop__foot-note">{t(' · ↺ 되돌리기로 방금 구매부터 한 건씩 무료 취소(상점을 벗어나기 전까지)')}</span>
        </p>
      </div>
    </div>
  )
}
