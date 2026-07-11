import { Component } from 'react'
import { t } from './i18n.js'

// 게임에서 런타임 오류가 나면 빈/깨진 화면 대신 오류 내용을 보여준다.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    // 콘솔에도 남김
    console.error('게임 오류:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#fff', overflow: 'auto', height: '100%' }}>
          <h2>{t('⚠️ 오류가 발생했어요')}</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#ff9b9b' }}>
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <button className="btn btn--primary" onClick={() => this.setState({ error: null }) || this.props.onExit?.()}>
            {t('로비로')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
