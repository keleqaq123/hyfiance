import React, { Suspense } from 'react'
import { HashRouter, Redirect, Route, Switch } from 'react-router-dom'
const LegacyApp=React.lazy(()=>import('../custos/LegacyApp'))
const CustosLandingPage=React.lazy(()=>import('../custos/CustosLandingPage'))
const RealityApp=React.lazy(()=>import('../custos/RealityApp'))
import PageErrorBoundary from '../components/PageErrorBoundary'

/**
 * Custos application routes.
 *
 * The landing page owns the public `/` experience.  Everything behind it is
 * deliberately grouped under `/defi`, so the product is not presented as a
 * single-purpose swap page even though the Custos V2 swap and LP primitives
 * remain available inside the workspace.
 */
export default function App() {
  return (
    <PageErrorBoundary><HashRouter>
      <Suspense fallback={<div className="custos-route-loading" role="status">Opening Custos…</div>}>
        <Switch>
          <Route exact path={['/', '/index.html', '/legacy-home']} component={CustosLandingPage} />
          <Route path="/reality" component={RealityApp} />
          <Route exact path="/defi/faucet" component={RealityApp} />
          <Route exact path="/defi/launchpad" component={RealityApp} />
          <Route
            path={['/defi', '/swap', '/send', '/pool', '/find', '/create', '/add', '/remove', '/perp']}
            render={() => (
              <LegacyApp />
            )}
          />
          <Redirect to="/" />
        </Switch>
      </Suspense>
    </HashRouter></PageErrorBoundary>
  )
}
