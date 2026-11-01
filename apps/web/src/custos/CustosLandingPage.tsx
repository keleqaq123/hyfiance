import {POINTS_ENABLED} from './features'
import React, { useEffect, useState } from 'react'
import type {RealityAsset} from './realityClient'
import './homepage.css'

function scrollToSection(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
  event.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function BrandSymbol({ className = 'brand-symbol' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="5">
        <path d="M18 14v36M46 14v36" />
      </g>
      <path d="M18 32h28" stroke="#35b978" strokeWidth="5" />
    </svg>
  )
}

function LargeBrandSymbol({ className = 'hero-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="38">
        <path d="M144 112v288M368 112v288" />
      </g>
      <path d="M144 256h224" stroke="#35b978" strokeWidth="38" />
    </svg>
  )
}

function LandingHeader({ onEnter }: { onEnter: () => void }) {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const updateHeader = () => setScrolled(window.scrollY > 18)
    updateHeader()
    window.addEventListener('scroll', updateHeader, { passive: true })
    return () => window.removeEventListener('scroll', updateHeader)
  }, [])

  const links = [
    ['Stories', 'stories'],
    ['Markets', 'markets'],
    ['Proof', 'proof'],
    ['Season 1', 'season'],
  ].filter(([label])=>POINTS_ENABLED||label!=='Season 1')

  const navigateTo = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    setOpen(false)
    scrollToSection(event, id)
  }

  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
      <a className="brand" href="#top" aria-label="Hyfiance home" onClick={(event) => navigateTo(event, 'top')}>
        <BrandSymbol />
        <span>HYFIANCE</span>
      </a>

      <button
        className="menu-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="primary-nav"
        onClick={() => setOpen((value) => !value)}
      >
        <span />
        <span />
        <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
      </button>

      <nav className={`primary-nav${open ? ' is-open' : ''}`} id="primary-nav" aria-label="Primary navigation">
        {links.map(([label, id]) => (
          <a key={id} href={`#${id}`} onClick={(event) => navigateTo(event, id)}>{label}</a>
        ))}
      </nav>

      <a className="header-cta" href="#/reality" onClick={onEnter}>
        Explore Reality <span aria-hidden="true">↗</span>
      </a>
    </header>
  )
}

function HomepageMarketRow({asset, number}: {asset: RealityAsset; number: string}) {
  return (
    <a className="market-row reality-project-row" href={'#/reality/asset/'+asset.id}>
      <span className="market-no">{number}</span>
      <img src={(import.meta.env.VITE_API_BASE || '')+asset.image_url+'?width=480'} alt={asset.name} loading="lazy"/>
      <span className="market-code">{asset.symbol}<small>{asset.name}</small></span>
      <span className="market-name">{asset.story}</span>
      <span className="market-state">{asset.verified?'BLUE V':'OPEN LAUNCH'}</span>
      <span className="market-arrow" aria-hidden="true">↗</span>
    </a>
  )
}

export default function CustosLandingPage() {
  const goToTerminal = () => { window.location.hash = '/reality' }
  const goToSeason = () => { window.location.hash = '/reality/season' }
  const [issued,setIssued]=useState<RealityAsset[]>([])
  const [feedState,setFeedState]=useState('loading')
  useEffect(()=>{
    const controller=new AbortController();let active=true
    const timer=window.setTimeout(()=>controller.abort(),6000)
    const base=(import.meta.env.VITE_API_BASE || '').replace(/\/$/,'')
    async function load(path:string){const response=await fetch(base+'/api/reality'+path,{signal:controller.signal});if(!response.ok)throw new Error('Unavailable');return (await response.json()).items as RealityAsset[]}
    load('/assets?issued=true&sort=new&limit=3').then(tokens=>{if(active){setIssued(tokens.filter(asset=>asset.id!=='1ef04e73-a6cf-43b2-8489-e76d1530409f'));setFeedState('ready')}}).catch(()=>{if(active)setFeedState('error')}).finally(()=>window.clearTimeout(timer))
    return ()=>{active=false;controller.abort();window.clearTimeout(timer)}
  },[])

  return (
    <div className="homepage">
      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="ambient-blocks ambient-blocks--left" aria-hidden="true">
          <span /><span /><span /><span />
        </div>

        <LandingHeader onEnter={goToTerminal} />

        <div className="hero-content">
          <p className="eyebrow"><span className="status-dot" /> ELYSIUM TESTNET · CREATOR LAUNCHPAD</p>
          <p className="hero-kicker">REALITY LAUNCHPAD ON ELYSIUM</p>
          <h1 id="hero-title" className="reality-hero-title">Real things.<br/>Value beyond<br/>a price tag.</h1>
          <p className="hero-tagline">YOUR WORLD. A SHARED SENSE OF VALUE.</p>
          <p className="hero-description">
            A beloved pet. An old camera. A café you built.<br/>Hyfiance lets anyone create a token around something real—and lets people discover, support and trade what matters to them.
          </p>
          <div className="hero-actions">
            <a className="button button--primary" href="#/reality" onClick={goToTerminal}>
              Explore Reality <span aria-hidden="true">↗</span>
            </a>
            <a className="button button--ghost" href="#/reality/create">
              Create Something Real <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        <div className="hero-art" aria-hidden="true">
          <LargeBrandSymbol />
          <span className="art-block art-block--one" />
          <span className="art-block art-block--two" />
          <span className="art-block art-block--three" />
          <span className="art-block art-block--green" />
        </div>

        <div className="hero-index" aria-hidden="true">01 / 06</div>
        <div className="hero-scroll" aria-hidden="true"><span /> SCROLL TO EXPLORE</div>
      </section>

      <section className="ticker" aria-label="Hyfiance principles">
        <div><span>01</span><strong>CREATE</strong><small>Anyone can launch</small></div>
        <div><span>02</span><strong>PROVE</strong><small>Reality comes first</small></div>
        <div><span>03</span><strong>DISCOVER</strong><small>Find what matters</small></div>
        <div><span>04</span><strong>VALUE</strong><small>Express it through trading</small></div>
      </section>

      <section className="system section" id="stories" aria-labelledby="stories-title">
        <div className="section-label"><span>01</span> THE WORLD YOU KNOW</div>
        <div className="section-heading"><h2 id="stories-title">Every real thing<br/>has a story.</h2><p>Some things matter because of what they earn. Others, because of what they mean. A story, an object or a place can bring people together.</p></div>
        <div className="reality-story-prompts">{[['A beloved pet','A companion. A shared memory. A story people care about.'],['An old camera','An everyday object with a history only you can tell.'],['A café you built','A place, its people and the work behind it.']].map(([title,copy])=><article key={title}><span>WHAT COULD YOU BRING?</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
        <div className="reality-story-feed"><p className="reality-feed-label">REALITY STARTS WITH WHAT MATTERS TO YOU</p><div className="reality-story-grid"><article className="reality-story-card reality-companion-card"><img src="/custos-companion.png" alt="A golden dog sitting on the grass" loading="lazy" decoding="async"/><div><span>A BELOVED PET</span><h3>A companion.<br/>A story worth sharing.</h3><p>No price tag can tell you what a beloved pet means. Bring something real to Hyfiance—and let people discover what it means to them.</p><a href="#/reality/create"><small>Share your own story ↗</small></a></div></article></div></div>
        <p className="reality-manifesto">You don’t need to own a building<br/>to bring something real onchain.</p>
      </section>

      <section className="system section" id="system" aria-labelledby="system-title">
        <div className="section-label"><span>02</span> YOUR WAY IN</div>
        <div className="section-heading">
          <h2 id="system-title">Anyone can launch.<br/>Reality comes first.</h2>
          <p>Start with something that exists, happened or belongs to you. Share its image and story, create a token, and let others discover it.</p>
        </div>

        <div className="layer-grid">
          <article className="layer-card layer-card--featured">
            <div className="card-topline"><span>01</span><span>OPEN TO EVERYONE</span></div>
            <div className="layer-glyph layer-glyph--rings" aria-hidden="true" />
            <h3>Open launch</h3>
            <p>Upload a real image, tell your story and issue your token with your wallet. No prior approval. No Blue V badge.</p>
            <a href="#/reality/create?mode=free">Create your project <span>↗</span></a>
          </article>
          <article className="layer-card">
            <div className="card-topline"><span>02</span><span>EVIDENCE, THEN REVIEW</span></div>
            <div className="layer-glyph layer-glyph--grid" aria-hidden="true" />
            <h3>Verified launch</h3>
            <p>Submit original photos and evidence of your connection or ownership. Hyfiance reviews your application before verified issuance.</p>
            <a href="#/reality/create?mode=verified">Apply for Blue V <span>↗</span></a>
          </article>
          <article className="layer-card">
            <div className="card-topline"><span>03</span><span>VALUE THROUGH PARTICIPATION</span></div>
            <div className="layer-glyph layer-glyph--bars" aria-hidden="true"><i /><i /><i /><i /></div>
            <h3>Community discovery</h3>
            <p>Follow stories, collect favorites and trade project tokens. Different people see different value in the same real thing.</p>
            <a href="#/reality/market">Explore the market <span>↗</span></a>
          </article>
        </div>
        <p className="reality-rules">REAL-WORLD SUBJECTS REQUIRED · Fictional meme projects, stolen images and fabricated evidence may be delisted.</p>
      </section>

      <section className="proof section" id="proof" aria-labelledby="proof-title">
        <div className="section-label"><span>03</span> PROOF & PEOPLE</div>
        <div className="proof-layout">
          <div className="proof-copy">
            <h2 id="proof-title">Verified for reality.<br/>Valued by people.</h2>
            <p>Hyfiance reviews the evidence. People decide what deserves their attention and support. Token prices form through buying and selling.</p>
          </div>
          <div className="proof-items">
            <article>
              <span className="proof-no">01</span>
              <h3>PROOF OF REALITY</h3>
              <p>Original images, a fresh challenge code and supporting documents help establish that your submission comes from the real world.</p>
            </article>
            <article>
              <span className="proof-no">02</span>
              <h3>BLUE V · HUMAN REVIEW</h3>
              <p>The badge means Hyfiance has reviewed evidence of authenticity and your connection to the project. It does not set a price or guarantee returns.</p>
            </article>
            <article>
              <span className="proof-no">03</span>
              <h3>COMMUNITY VALUE</h3>
              <p>Discover, support and trade what matters to you. Prices reflect trading demand; tokens do not automatically grant ownership of an item or its income.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="markets section" id="markets" aria-labelledby="markets-title">
        <div className="section-label section-label--light"><span>04</span> FROM STORIES TO MARKETS</div>
        <div className="market-heading">
          <div>
            <p className="eyebrow"><span className="status-dot" /> COMMUNITY PROJECTS · ELYSIUM TESTNET</p>
            <h2 id="markets-title">Discover what<br/>people believe in.</h2>
          </div>
          <p>Meet real projects, see recent launches and follow community trading in the rankings.</p>
        </div>

        <div className="market-list">
          {issued.map((asset,index)=><HomepageMarketRow key={asset.id} number={'0'+(index+1)} asset={asset}/>)}
        </div>
        {!issued.length?<p className="reality-feed-message" role="status">{feedState==='loading'?'Loading community launches…':feedState==='error'?'The project feed is temporarily unavailable. You can still open Explore Reality.':'New onchain launches will appear here. Bring the first story.'}</p>:null}
        <div className="hero-actions"><a className="button button--primary" href="#/reality/market">Explore Markets <span>↗</span></a><a className="button button--ghost" href="#/reality/rankings">View Rankings <span>↗</span></a></div>
        <p className="market-disclaimer">ELYSIUM TESTNET · TRANSACTIONS USE TEST HYPE · DELISTING DOES NOT DELETE ONCHAIN TOKENS</p>
      </section>

      {POINTS_ENABLED&&<section className="season section" id="season" aria-labelledby="season-title">
        <div className="season-blocks" aria-hidden="true"><span /><span /><span /></div>
        <div className="season-copy">
          <p className="eyebrow"><span className="status-dot" /> SEASON 1 · NOW OPEN</p>
          <h2 id="season-title">Bring your piece<br/>of reality.</h2>
          <p>A photo. A collection. A business. Something only you could bring. Start your project, invite your friends and take part in Season 1.</p>
          <div className="hero-actions"><a className="button button--primary" href="#/reality/create">Create Something Real <span>↗</span></a>
          <a className="button button--ghost" href="#/reality/season" onClick={goToSeason}>
            Join Season 1 <span>↗</span>
          </a></div>
        </div>
        <LargeBrandSymbol className="season-mark" />
      </section>}

      <footer className="site-footer">
        <div className="footer-brand">
          <BrandSymbol />
          <div><strong>HYFIANCE</strong><small>REALITY LAUNCHPAD ON ELYSIUM</small></div>
        </div>
        <div className="footer-links">
          <a href="#markets" onClick={(event) => scrollToSection(event, 'markets')}>Markets</a>
          <a href="#proof" onClick={(event) => scrollToSection(event, 'proof')}>Proof</a>
          {POINTS_ENABLED&&<a href="#season" onClick={(event) => scrollToSection(event, 'season')}>Season 1</a>}
        </div>
        <div className="footer-meta"><span>ELYSIUM TESTNET</span><span>TESTNET ONLINE</span><span>© {new Date().getFullYear()} HYFIANCE</span></div>
      </footer>
    </div>
  )
}
