import 'inter-ui'
import './custos/custos.css'
import './custos/base.css'
import React,{StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import App from './pages/App'
if('ethereum' in window)(window.ethereum as any).autoRefreshOnNetworkChange=false
const rootElement=document.getElementById('root')
if(!rootElement)throw new Error('Custos root element was not found')
createRoot(rootElement).render(<StrictMode><App/></StrictMode>)
