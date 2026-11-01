import {expect,it} from 'vitest'
import {resolveMarketApiBase} from './marketNetwork'
it('uses the live website origin for production API and WebSocket routing',()=>{
 for(const origin of ['https://www.custosfinance.xyz','https://custosfinance.xyz','https://preview.example.test'])expect(resolveMarketApiBase('',origin)).toBe(origin)
})
it('preserves local development and explicit backend overrides',()=>{
 expect(resolveMarketApiBase('', 'http://127.0.0.1:3001')).toBe('http://127.0.0.1:8001')
 expect(resolveMarketApiBase(undefined, 'http://localhost:3001')).toBe('http://127.0.0.1:8001')
 expect(resolveMarketApiBase('https://backend.example.test','https://www.custosfinance.xyz')).toBe('https://backend.example.test')
})
it('does not treat a domain impersonating localhost as a local development site',()=>{expect(resolveMarketApiBase('', 'https://localhost.attacker.test')).toBe('https://localhost.attacker.test')})
