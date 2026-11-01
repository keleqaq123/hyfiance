import { transparentize } from 'polished'
import React, { useMemo } from 'react'
import styled, {
  ThemeProvider as StyledComponentsThemeProvider,
  createGlobalStyle,
  css,
  DefaultTheme
} from 'styled-components'
import { useIsDarkMode } from '../state/user/hooks'
import { Text, TextProps } from 'rebass'
import { Colors } from './styled'

export * from './components'

const MEDIA_WIDTHS = {
  upToExtraSmall: 500,
  upToSmall: 600,
  upToMedium: 960,
  upToLarge: 1280
}

const mediaWidthTemplates: { [width in keyof typeof MEDIA_WIDTHS]: typeof css } = Object.keys(MEDIA_WIDTHS).reduce(
  (accumulator, size) => {
    ;(accumulator as any)[size] = (a: any, b: any, c: any) => css`
      @media (max-width: ${(MEDIA_WIDTHS as any)[size]}px) {
        ${css(a, b, c)}
      }
    `
    return accumulator
  },
  {}
) as any

const white = '#FFFFFF'
const black = '#000000'

export function colors(darkMode: boolean): Colors {
  return {
    // base
    white,
    black,

    // text
    text1: darkMode ? '#EFF7F2' : '#16181B',
    text2: darkMode ? '#9AA9A1' : '#565A69',
    text3: darkMode ? '#718078' : '#888D9B',
    text4: darkMode ? '#56645C' : '#C3C5CB',
    text5: darkMode ? '#2D3933' : '#EDEEF2',

    // backgrounds / greys
    bg0: darkMode ? '#0A0F0D' : '#F4F5F7',
    bg1: darkMode ? '#101A16' : '#FFFFFF',
    bg2: darkMode ? '#14211C' : '#F7F8FA',
    bg3: darkMode ? '#1B2822' : '#EDEEF2',
    bg4: darkMode ? '#2A3D34' : '#CED0D9',
    bg5: darkMode ? '#718078' : '#888D9B',

    //specialty colors
    modalBG: darkMode ? 'rgba(0,0,0,.72)' : 'rgba(0,0,0,0.3)',
    advancedBG: darkMode ? 'rgba(99,233,168,0.05)' : 'rgba(255,255,255,0.6)',

    //primary colors
    primary1: darkMode ? '#63E9A8' : '#2EAB73',
    primary2: darkMode ? '#7AF0B7' : '#23895B',
    primary3: darkMode ? '#40C990' : '#19734B',
    primary4: darkMode ? '#183E2D' : '#D8F5E6',
    primary5: darkMode ? '#102B20' : '#EAFBF1',

    // color text
    primaryText1: darkMode ? '#63E9A8' : '#19734B',

    // secondary colors
    secondary1: darkMode ? '#63E9A8' : '#2EAB73',
    secondary2: darkMode ? '#153126' : '#DFF7EA',
    secondary3: darkMode ? '#10251C' : '#EFFCF4',

    // other
    red1: '#FF6871',
    red2: '#F82D3A',
    green1: '#45C982',
    yellow1: '#E3BC67',
    yellow2: '#D59A3A'

    // dont wanna forget these blue yet
    // blue4: darkMode ? '#153d6f70' : '#C4D9F8',
    // blue5: darkMode ? '#153d6f70' : '#EBF4FF',
  }
}

export function theme(darkMode: boolean): DefaultTheme {
  return {
    ...colors(darkMode),

    grids: {
      sm: 8,
      md: 12,
      lg: 24
    },

    //shadows
    shadow1: darkMode ? '#000' : '#2F80ED',

    // media queries
    mediaWidth: mediaWidthTemplates,

    // css snippets
    flexColumnNoWrap: css`
      display: flex;
      flex-flow: column nowrap;
    `,
    flexRowNoWrap: css`
      display: flex;
      flex-flow: row nowrap;
    `
  }
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Custos Swap uses the dark trading surface as its default. The settings
  // toggle can still opt into the light palette when a user explicitly asks.
  const darkMode = useIsDarkMode()

  const themeObject = useMemo(() => theme(darkMode), [darkMode])

  return <StyledComponentsThemeProvider theme={themeObject}>{children}</StyledComponentsThemeProvider>
}

const TextWrapper = styled(Text)<{ color: keyof Colors }>`
  color: ${({ color, theme }) => (theme as any)[color]};
`

export const TYPE = {
  main(props: TextProps) {
    return <TextWrapper fontWeight={500} color={'text2'} {...props} />
  },
  link(props: TextProps) {
    return <TextWrapper fontWeight={500} color={'primary1'} {...props} />
  },
  black(props: TextProps) {
    return <TextWrapper fontWeight={500} color={'text1'} {...props} />
  },
  body(props: TextProps) {
    return <TextWrapper fontWeight={400} fontSize={16} color={'text1'} {...props} />
  },
  largeHeader(props: TextProps) {
    return <TextWrapper fontWeight={600} fontSize={24} {...props} />
  },
  mediumHeader(props: TextProps) {
    return <TextWrapper fontWeight={500} fontSize={20} {...props} />
  },
  subHeader(props: TextProps) {
    return <TextWrapper fontWeight={400} fontSize={14} {...props} />
  },
  blue(props: TextProps) {
    return <TextWrapper fontWeight={500} color={'primary1'} {...props} />
  },
  yellow(props: TextProps) {
    return <TextWrapper fontWeight={500} color={'yellow1'} {...props} />
  },
  darkGray(props: TextProps) {
    return <TextWrapper fontWeight={500} color={'text3'} {...props} />
  },
  gray(props: TextProps) {
    return <TextWrapper fontWeight={500} color={'bg3'} {...props} />
  },
  italic(props: TextProps) {
    return <TextWrapper fontWeight={500} fontSize={12} fontStyle={'italic'} color={'text2'} {...props} />
  },
  error({ error, ...props }: { error: boolean } & TextProps) {
    return <TextWrapper fontWeight={500} color={error ? 'red1' : 'text2'} {...props} />
  }
}

export const FixedGlobalStyle = createGlobalStyle`
html, input, textarea, button {
  font-family: 'Inter', sans-serif;
  letter-spacing: -0.018em;
  font-display: fallback;
}
@supports (font-variation-settings: normal) {
  html, input, textarea, button {
    font-family: 'Inter var', sans-serif;
  }
}

html,
body {
  margin: 0;
  padding: 0;
  min-height: 100%;
}

#root {
  min-height: 100vh;
}

* {
  box-sizing: border-box;
}

button {
  user-select: none;
  font: inherit;
}

html {
  font-size: 16px;
  font-variant: none;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
}

::selection {
  background: rgba(99, 233, 168, 0.28);
}

button:focus-visible,
a:focus-visible,
input:focus-visible {
  outline: 2px solid #63e9a8;
  outline-offset: 2px;
}
`

export const ThemedGlobalStyle = createGlobalStyle`
html {
  color: ${({ theme }) => theme.text1};
  background-color: ${({ theme }) => theme.bg0};
}

body {
  min-height: 100vh;
  color: ${({ theme }) => theme.text1};
  background-color: ${({ theme }) => theme.bg0};
  background-position: center top;
  background-repeat: no-repeat;
  background-image: ${({ theme }) =>
    `radial-gradient(50% 38% at 50% 0%, ${transparentize(0.94, theme.primary1)} 0%, ${transparentize(
      1,
      theme.bg0
    )} 72%), linear-gradient(180deg, ${theme.bg0} 0%, ${theme.bg0} 100%)`};
}

body,
input,
textarea,
button {
  transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
}
`
