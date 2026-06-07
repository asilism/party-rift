// 순수 CSS 폭죽 연출. 우승 팝업 좌우에서 계속 터진다.
// 각 폭죽은 12개의 불꽃이 방사형으로 퍼지며, 좌/우가 번갈아 터지도록 딜레이를 준다.
const SPARKS = Array.from({ length: 12 })

function Burst({ side, delay }) {
  return (
    <div className={`firework firework--${side}`} style={{ '--delay': `${delay}s` }}>
      {SPARKS.map((_, i) => (
        <span
          key={i}
          className="firework__spark"
          style={{ '--angle': `${i * 30}deg`, '--hue': `${(i * 40) % 360}` }}
        />
      ))}
    </div>
  )
}

export default function Fireworks() {
  return (
    <div className="fireworks" aria-hidden="true">
      <Burst side="left" delay={0} />
      <Burst side="left2" delay={0.9} />
      <Burst side="right" delay={0.45} />
      <Burst side="right2" delay={1.3} />
    </div>
  )
}
