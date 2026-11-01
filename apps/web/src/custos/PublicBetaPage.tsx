import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  CheckCircle2,
  Copy,
  Share2,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import {api,snapshotReality,ensureGiwa,setCredential} from './realityClient';

type Profile = {
  wallet: string;
  referralCode: string;
  points: number;
  bonusPoints?: number;
  stakeCompleted?: boolean;
  verifiedTransactions: number;
  qualifiedReferrals: number;
  rank: number;
  qualified: boolean;
  season: string;
  xStatus: string;
  xHandle: string;
};

type Entry = {
  rank: number;
  wallet: string;
  points: number;
  bonusPoints?: number;
  verifiedTransactions: number;
  qualifiedReferrals: number;
};

type Stats = {
  participants: number;
  verifiedTransactions: number;
  pointsIssued: number;
  qualifiedReferrals: number;
};

function short(address: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—';
}

function number(value: number) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function captureReferral() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const incoming = (params.get('ref') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
  if (incoming) localStorage.setItem('custos_ref', incoming);
  return incoming || localStorage.getItem('custos_ref') || '';
}

export default function PublicBetaPage({
  wallet,
  onConnect,
  setToast,
  authenticated=false,
}: {
  wallet: string;
  authenticated?: boolean;
  onConnect: () => Promise<void> | void;
  setToast: (value: string) => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [entries, setEntries] = useState<Entry[]>(()=>snapshotReality('/season/leaderboard')?.entries||[]);
  const [originalEntries, setOriginalEntries] = useState<Entry[]>(()=>snapshotReality('/season/original-leaderboard')?.entries||[]);
  const [board, setBoard] = useState<'original'|'reality'>('reality');
  const [boardLoading, setBoardLoading] = useState(true);
  const [originalError, setOriginalError] = useState('');
  const [stats, setStats] = useState<Stats>({
    participants: 0,
    verifiedTransactions: 0,
    pointsIssued: 0,
    qualifiedReferrals: 0,
  });
  const [verificationReady, setVerificationReady] = useState(false);
  const [refCode, setRefCode] = useState('');
  const [xUrl,setXUrl]=useState('https://x.com/custosfinance');
  useEffect(()=>{api('/season/x/config').then(c=>setXUrl(c.url)).catch(()=>{})},[]);
  const [busy,setBusy]=useState(false);
  async function joinSeason(){
    if(authenticated){const p=await api<Profile>('/season/register',{ref_code:refCode});setProfile(p);return p;}
    const config=await api('/config'), provider=await ensureGiwa(config),signer=provider.getSigner(),address=await signer.getAddress();
    if(wallet && address.toLowerCase()!==wallet.toLowerCase())throw new Error('Use the connected wallet');
    const challenge=await api('/auth/challenge',{wallet:address});
    const signature=await signer.signMessage(challenge.message),result=await api('/auth/login',{id:challenge.id,signature});
    setCredential(result.token);const p=await api<Profile>('/season/register',{ref_code:refCode});setProfile(p);return p;
  }
  async function visitX(){if(profile?.xStatus==='visited')return;setBusy(true);try{await joinSeason();const p=await api<Profile>('/season/x-visit',{});setProfile(p);setToast('X visit recorded: 10 points, once per wallet')}catch(e:any){setToast(e.message||'Could not record points. Connect your wallet and retry.')}finally{setBusy(false)}}

  useEffect(() => {
    setRefCode(captureReferral());
  }, []);

  async function refreshPublic() {
    try {
      await Promise.allSettled([
        api('/season/stats').then(setStats),
        api('/season/leaderboard').then(body=>setEntries(body.entries||[])),
        api('/config').then(body=>setVerificationReady(Boolean(body.launchpad))),
      ]);
    } catch {
      // Keep the public page usable while the backend restarts.
    }
  }

  async function refreshOriginal() {
    try {
      const body=await api('/season/original-leaderboard');
      setOriginalError(body.stale?'The original site is temporarily unavailable. Showing the last successful update.':'');
      setOriginalEntries(body.entries || []);
    } catch (error: any) {
      setOriginalError(error.message || 'Could not load the original leaderboard.');
    } finally {setBoardLoading(false);}
  }

  async function refreshProfile() {
    if (!wallet) {
      setProfile(null);
      return;
    }
    try {
      const response = await fetch(`/api/reality/season/profile/${wallet}`, { cache: 'no-store' });
      if (response.ok) setProfile(await response.json());
    } catch {
      // Wallet profile will appear after backend is reachable.
    }
  }

  useEffect(() => {
    void refreshPublic();
    void refreshOriginal();
    const timer = window.setInterval(()=>{void refreshPublic();void refreshOriginal();}, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refreshProfile();
    const timer = window.setInterval(refreshProfile, 5_000);
    return () => window.clearInterval(timer);
  }, [wallet]);

  const inviteUrl = useMemo(() => {
    if (!profile?.referralCode) return '';
    return `${window.location.origin}/#/reality/season?ref=${profile.referralCode}`;
  }, [profile?.referralCode]);

  async function copyInvite() {
    try {
      const p=inviteUrl?profile:await joinSeason();
      if(!p?.referralCode)return;
      await navigator.clipboard.writeText(`${window.location.origin}/#/reality/season?ref=${p.referralCode}`);
    }catch(e:any){setToast(e.message||'Could not create an invite link');return;}
    setToast('Custos Finance invite link copied.');
  }

  return (
    <div className="fade-up space-y-5 rl-season-content">
      <section className="rl-season-intro">
        <div><p className="rl-eyebrow">CUSTOS FINANCE · SEASON 1</p><h1>Season 1</h1><p>Bring something real. Earn points. Rise together.</p></div>
        <div className="rl-season-activity" aria-label="Season activity"><span><b>{number(stats.participants)}</b> Participants</span><span><b>{number(stats.verifiedTransactions)}</b> Tokens launched</span><span><b>{number(stats.pointsIssued)}</b> Points issued</span><span><b>{number(stats.qualifiedReferrals)}</b> Referrals</span></div>
        <p className="rl-footnote">{verificationReady?'Onchain verification ready':'Waiting for launchpad deployment'}{refCode?<span> · Referral captured: <code>{refCode}</code></span>:null}</p>
      </section>
      <section className="giwa-panel rl-season-profile" aria-label="Your Season 1 profile">
        <div className="rl-season-wallet"><Wallet size={22}/><div><span>Connected wallet</span><strong title={wallet}>{wallet?short(wallet):'Connect to see your profile'}</strong></div></div>
        <div className="rl-season-profile-stats"><ProfileStat label="Points" value={number(profile?.points||0)}/><ProfileStat label="Rank" value={profile?.qualified?`#${profile.rank}`:'—'}/><ProfileStat label="Tokens launched" value={number(profile?.verifiedTransactions||0)}/><ProfileStat label="Referrals" value={number(profile?.qualifiedReferrals||0)}/></div>
        {wallet?<button type="button" className="secondary-button rl-season-invite" disabled={busy} onClick={()=>void copyInvite()} title="Copy unique invite link"><Copy size={15}/><span>Copy invite link</span></button>:<button className="primary-button rl-season-connect" onClick={()=>void onConnect()}><span>Connect Wallet</span></button>}
      </section>
      {(profile?.bonusPoints||0)>0?<p className="rl-inline-note">Community feedback rewards: {profile?.bonusPoints} points · Included in your total</p>:null}
      <section className="rl-season-tasks grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Season tasks">
        <div className="giwa-panel rounded-[22px] p-5">
          <div className="flex justify-between text-emerald-200"><Users size={17}/><span>+10 · once</span></div>
          <h3 className="mt-5 text-[19px] font-semibold">Follow Custos on X</h3>
          <p className="mt-2 text-[11px] text-white/42">Open our X profile to earn 10 points, once per wallet.</p>
          <a href={xUrl} target="_blank" rel="noopener noreferrer" onClick={()=>{if(!busy)void visitX()}} className="primary-button mt-5 flex w-full items-center justify-center rounded-lg py-3">{profile?.xStatus==='visited'?'Completed · Open X again ↗':busy?'Recording points…':'Follow Custos on X · +10 ↗'}</a>
          <p className="mt-4 text-[11px] text-white/42">{profile?.xStatus==='visited'?'10 points earned':wallet?'Follow our official X account':'Connect your wallet to record task points'}</p>
        </div>
        <Quest icon={<ShieldCheck size={17}/>} title="Stake ETH" points="+100 · once" href="#/reality/stake" text="Stake GIWA ETH for CFI. First confirmed stake: 100 points." status={profile?.stakeCompleted?'Completed · 100 points earned':'Stake ETH to complete'}/>
        <Quest icon={<Activity size={17}/>} title="Launch a token" points="+100 · once" href="#/reality/create" text="Issue a real project token on GIWA. Points follow onchain confirmation." status={profile?.verifiedTransactions?'Completed':'Complete after onchain verification'}/>
        <div className="giwa-panel rounded-[22px] p-5">
          <div className="flex justify-between text-emerald-200"><Share2 size={17}/><span>+100 / qualified friend</span></div>
          <h3 className="mt-5 text-[19px] font-semibold">Invite friends</h3>
          <p className="mt-2 text-[11px] text-white/42">Earn points when a friend joins through your link and launches their first token.</p>
          <button className="primary-button mt-5 w-full rounded-lg py-3" disabled={busy} onClick={()=>void copyInvite()}>Sign and copy invite link</button>
          <p className="mt-4 text-[11px] text-emerald-200">Completed {profile?.qualifiedReferrals||0} qualified referrals</p>
        </div>
      </section>
        <section className="giwa-panel rl-season-leaderboard rounded-[24px] p-5 md:p-6" aria-label="Season 1 leaderboard">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold tracking-[.15em] text-emerald-300">LEADERBOARD</p>
              <h2 className="mt-2 text-[28px] font-semibold tracking-[-.05em]">Season 1 leaderboard</h2>
            </div>
            <ShieldCheck size={21} className="text-emerald-300" />
          </div>

          <div className="rl-tabs" aria-label="Season leaderboard source" style={{marginTop:16}}>
            <button className={board==='reality'?'active':''} aria-pressed={board==='reality'} onClick={()=>setBoard('reality')}>Reality tasks</button>
            <button className={board==='original'?'active':''} aria-pressed={board==='original'} onClick={()=>setBoard('original')}>Original Season 1</button>
          </div>
          <p className="rl-footnote">{board==='original'?'Live leaderboard from the original Custos Season 1: historical points, transactions and referrals. Reality task points are tracked separately.':'Points from X visits, token launches, staking, qualified invitations and community feedback rewards.'}</p>
          {board==='original'&&originalError?<div className="rl-alert" role="alert">{originalError}<button onClick={()=>void refreshOriginal()}>Retry</button></div>:null}
          <div className="mt-5 overflow-hidden rounded-2xl border border-white/[.08]">
            <div className="grid grid-cols-[58px_1fr_90px_80px] bg-white/[.035] px-4 py-3 text-[9px] font-semibold tracking-[.1em] text-white/35 md:grid-cols-[70px_1fr_120px_110px_100px]">
              <span>RANK</span><span>WALLET</span><span className="text-right">POINTS</span><span className="hidden text-right md:block">TXS</span><span className="text-right">REFS</span>
            </div>
            {(board==='original'?originalEntries:entries).length ? (board==='original'?originalEntries:entries).map((entry) => (
              <div key={entry.wallet} className="grid grid-cols-[58px_1fr_90px_80px] items-center border-t border-white/[.06] px-4 py-3 text-[11px] md:grid-cols-[70px_1fr_120px_110px_100px]">
                <span className="font-semibold text-emerald-200">#{entry.rank}</span>
                <span className="font-mono text-white/64" title={entry.wallet}>{short(entry.wallet)}{wallet.toLowerCase()===entry.wallet.toLowerCase()?<small> · You</small>:null}</span>
                <span className="text-right font-semibold">{number(entry.points)}</span>
                <span className="hidden text-right text-white/42 md:block">{number(entry.verifiedTransactions)}</span>
                <span className="text-right text-white/42">{number(entry.qualifiedReferrals)}</span>
              </div>
            )) : (
              <div className="px-5 py-10 text-center text-[12px] text-white/35">{board==='original'?(boardLoading?'Loading original Season 1…':originalError?'Leaderboard unavailable. Please retry.':'No recorded participants in the original Season 1.'):'No qualifying participants yet. Complete a task to join the leaderboard.'}</div>
            )}
          </div>
        </section>
      <section className="rounded-2xl border border-amber-200/10 bg-amber-200/[.025] px-5 py-4 text-[10px] leading-relaxed text-white/42">
        <strong className="text-white/72">Season disclosure:</strong> points are testnet participation metrics only. They do not guarantee a token, airdrop, reward, allocation, financial value or future eligibility. Custos Finance synthetic assets and tUSDC are testnet-only.
      </section>
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[.08] bg-white/[.025] p-4"><p className="text-[9px] text-white/34">{label}</p><p className="mt-2 text-[22px] font-semibold tracking-[-.04em]">{value}</p></div>;
}

function Quest({ icon, title, points, text, href, status='Points after qualification', external = false }: { icon: ReactNode; title: string; points: string; text: string; href: string; status?: string; external?: boolean }) {
  return <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className="giwa-panel group rounded-[22px] p-5 transition hover:-translate-y-1 hover:border-emerald-300/25"><div className="flex items-center justify-between"><span className="text-emerald-300">{icon}</span><span className="rounded-full border border-emerald-300/18 bg-emerald-300/[.06] px-2.5 py-1 text-[10px] font-semibold text-emerald-200">{points}</span></div><h3 className="mt-5 text-[19px] font-semibold">{title}</h3><p className="mt-2 text-[11px] leading-relaxed text-white/42">{text}</p><div className="mt-5 flex items-center gap-2 text-[10px] font-semibold text-emerald-200"><CheckCircle2 size={13} /> {status}</div></a>;
}
