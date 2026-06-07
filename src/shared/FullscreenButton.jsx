import { useEffect, useState } from 'react'

// 전체화면 토글 버튼. 전체화면일 때는 창모드로 '돌아가기' 아이콘으로 바뀐다.
export default function FullscreenButton() {
  const [fs, setFs] = useState(false)

  useEffect(() => {
    const onChange = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  function toggle() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.()
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {})
    }
  }

  return (
    <button
      className="btn btn--ghost"
      onClick={toggle}
      aria-label={fs ? '전체화면 끄기' : '전체화면'}
      title={fs ? '창모드로 돌아가기' : '전체화면'}
    >
      {fs ? '🡼 창모드' : '⛶'}
    </button>
  )
}
