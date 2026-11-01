import React from 'react'
import {Check} from 'lucide-react'

export default function RealityVerifiedMark({corner=false}:{corner?:boolean}){
 return <span className={'rl-verified-mark'+(corner?' rl-verified-mark-corner':'')} role="img" aria-label="Proof verified" title="Reality verified by Custos"><Check size={14} strokeWidth={3.5} aria-hidden="true"/></span>
}
