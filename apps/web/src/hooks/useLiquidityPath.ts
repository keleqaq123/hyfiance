import {useLocation} from 'react-router-dom'

/** Keep liquidity workflows in the shell from which they were opened. */
export default function useLiquidityPath() {
  const reality = useLocation().pathname.startsWith('/reality')
  return (path: string) => reality
    ? path === '/pool' ? '/reality/pool' : '/reality/pool' + path
    : path
}
