import React from 'react'

export default class PageErrorBoundary extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
  state = {failed: false}
  static getDerivedStateFromError() { return {failed: true} }
  componentDidCatch(error: Error) { console.error('Page failed to render', error) }
  render() {
    if (this.state.failed) return <div role="alert" className="rl-alert" style={{margin: 24}}>
      This page could not be opened. <button onClick={() => window.location.reload()}>Reload page</button>
      <a href="#/reality" onClick={() => this.setState({failed: false})}>Back to Launchpad</a>
    </div>
    return this.props.children
  }
}
