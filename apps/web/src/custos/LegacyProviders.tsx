import React from 'react'
import ReactGA from 'react-ga'
import {createWeb3ReactRoot,Web3ReactProvider} from '@web3-react/core'
import {Provider} from 'react-redux'
import {NetworkContextName} from '../constants'
import '../i18n'
import store from '../state'
import ApplicationUpdater from '../state/application/updater'
import ListsUpdater from '../state/lists/updater'
import MulticallUpdater from '../state/multicall/updater'
import TransactionUpdater from '../state/transactions/updater'
import UserUpdater from '../state/user/updater'
import ThemeProvider,{ThemedGlobalStyle} from '../theme'
import getLibrary from '../utils/getLibrary'
const analyticsId=import.meta.env.VITE_GOOGLE_ANALYTICS_ID
ReactGA.initialize(analyticsId||'test',analyticsId?{}:{testMode:true})
const Web3ProviderNetwork=createWeb3ReactRoot(NetworkContextName)
function Updaters() {
  return (
    <>
      <ListsUpdater />
      <UserUpdater />
      <ApplicationUpdater />
      <TransactionUpdater />
      <MulticallUpdater />
    </>
  )
}

export default function LegacyProviders({children}:{children:React.ReactNode}){
 return <Web3ReactProvider getLibrary={getLibrary}><Web3ProviderNetwork getLibrary={getLibrary}><Provider store={store}><Updaters/><ThemeProvider><ThemedGlobalStyle/>{children}</ThemeProvider></Provider></Web3ProviderNetwork></Web3ReactProvider>
}
