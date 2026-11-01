import React from 'react'
import {Route} from 'react-router-dom'
import LegacyProviders from './LegacyProviders'
import DefiShell from './DefiShell'
import Web3ReactManager from '../components/Web3ReactManager'
import GoogleAnalyticsReporter from '../components/analytics/GoogleAnalyticsReporter'
import DarkModeQueryParamReader from '../theme/DarkModeQueryParamReader'
export default function LegacyApp(){return <LegacyProviders><Route component={GoogleAnalyticsReporter}/><Route component={DarkModeQueryParamReader}/><Web3ReactManager><DefiShell/></Web3ReactManager></LegacyProviders>}
