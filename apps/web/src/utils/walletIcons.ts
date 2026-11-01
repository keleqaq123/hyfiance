import arrowRight from '../assets/images/arrow-right.svg'
import coinbaseWalletIcon from '../assets/images/coinbaseWalletIcon.svg'
import fortmaticIcon from '../assets/images/fortmaticIcon.png'
import metamask from '../assets/images/metamask.png'
import portisIcon from '../assets/images/portisIcon.png'
import trustWallet from '../assets/images/trustWallet.png'
import walletConnectIcon from '../assets/images/walletConnectIcon.svg'

const walletIcons: Record<string, string> = {
  'arrow-right.svg': arrowRight,
  'coinbaseWalletIcon.svg': coinbaseWalletIcon,
  'fortmaticIcon.png': fortmaticIcon,
  'metamask.png': metamask,
  'portisIcon.png': portisIcon,
  'trustWallet.png': trustWallet,
  'walletConnectIcon.svg': walletConnectIcon
}

export function getWalletIcon(iconName: string): string {
  return walletIcons[iconName] ?? arrowRight
}
