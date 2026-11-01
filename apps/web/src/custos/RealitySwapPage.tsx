import React from 'react'
import LegacyProviders from './LegacyProviders'

import {ThemeProvider} from 'styled-components'

import {theme} from '../theme'

import Web3ReactManager from '../components/Web3ReactManager'

import Web3Status from '../components/Web3Status'

import Popups from '../components/Popups'

import Swap from '../pages/Swap'

import Pool from '../pages/Pool'

import {Link, Route, Switch} from 'react-router-dom'

import PoolFinder from '../pages/PoolFinder'

import AddLiquidity from '../pages/AddLiquidity'

import RemoveLiquidity from '../pages/RemoveLiquidity'



export default function RealitySwapPage({pool=false}:{pool?:boolean}){

  return <LegacyProviders><ThemeProvider theme={theme(false)}><div className="rl-native-swap">{pool?<div className="rl-swap-heading"><span className="rl-eyebrow">Custos V2</span><h1>Manage liquidity</h1><p>Add, import and manage your Custos V2 liquidity positions.</p></div>:null}<Web3ReactManager><div className="rl-native-swap-body"><div className="rl-alert" role="status">Custos V2 uses its own V2-WETH on Elysium Testnet. Native ETH is wrapped automatically through the V2 router; the native bridge WETH is a separate token. <Link to="/reality/swap/rwa">Trade issued RWA tokens </Link></div><div className="rl-native-wallet"><Web3Status/></div><Popups/>{pool?<Switch><Route exact path="/reality/pool/find" component={PoolFinder}/><Route exact path={['/reality/pool/add/:currencyIdA/:currencyIdB','/reality/pool/add/:currencyIdA','/reality/pool/add']} component={AddLiquidity}/><Route exact path="/reality/pool/remove/:currencyIdA/:currencyIdB" component={RemoveLiquidity}/><Route component={Pool}/></Switch>:<Swap/>}</div></Web3ReactManager></div></ThemeProvider></LegacyProviders>

}
