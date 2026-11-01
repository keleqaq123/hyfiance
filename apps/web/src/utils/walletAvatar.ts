export function walletAvatar(address: string) {
  let seed = /^0x[0-9a-f]{40}$/i.test(address) ? parseInt(address.slice(2, 10), 16) : 1
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return (seed >>> 0) / 4294967296
  }
  const hue = Math.floor(random() * 360)
  return {
    background: `hsl(${hue}, 65%, 65%)`,
    shapes: [0, 1, 2].map(i => ({
      color: `hsl(${(hue + (i + 1) * 85) % 360}, 65%, ${40 + i * 10}%)`,
      transform: `translate(${(random() * 12 - 6).toFixed(2)} ${(random() * 12 - 6).toFixed(2)}) rotate(${Math.floor(random() * 360)} 8 8)`
    }))
  }
}
