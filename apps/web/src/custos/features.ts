import features from '../../../../networks/elysium-features.json'
const elysium=Number(import.meta.env.VITE_CHAIN_ID)===99801
export const POINTS_ENABLED=!elysium||features.points
export const SYNTHETIC_MARKETS_ENABLED=!elysium||features.syntheticMarkets
export function unavailableRoute(path:string){
 return (!POINTS_ENABLED&&/^\/(reality|defi)\/season(?:\/|$)/.test(path))||(!SYNTHETIC_MARKETS_ENABLED&&(/^\/perp(?:\/|$)/.test(path)||/^\/defi\/(rwa|perpetuals|markets|portfolio|transparency)(?:\/|$)/.test(path)||(/^\/defi\/(spot|liquidity)(?:\/|$)/.test(path)&&!/^\/defi\/(spot|liquidity)\/v2(?:\/|$)/.test(path))))
}
