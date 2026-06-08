// 6콤보 이상에서 하늘에서 떨어지는 별똥별 연출(순수 CSS).
const STARS = [
  { left: 12, delay: 0 },
  { left: 34, delay: 0.18 },
  { left: 55, delay: 0.06 },
  { left: 72, delay: 0.26 },
  { left: 88, delay: 0.12 },
  { left: 22, delay: 0.34 },
  { left: 64, delay: 0.42 },
]

export default function ShootingStars() {
  return (
    <div className="shooting-stars" aria-hidden="true">
      {STARS.map((s, i) => (
        <span
          key={i}
          className="shooting-star"
          style={{ left: `${s.left}%`, animationDelay: `${s.delay}s` }}
        >
          🌠
        </span>
      ))}
    </div>
  )
}
