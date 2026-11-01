import React, {useRef, useState} from 'react'
import {Link} from 'react-router-dom'
import {Loader2, ShieldCheck, Upload} from 'lucide-react'
import {api, RealityAsset, uploadFile} from './realityClient'
import RealityVerificationGuide from './RealityVerificationGuide'

export default function RealityEvidenceStep({asset, wallet, connect, notify, go}: {
  asset: RealityAsset; wallet?: string; connect: () => Promise<void>; notify: (message: string) => void; go: (id: string) => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const uploaded = useRef(new Map<File, string>())
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!wallet) {await connect(); return}
    if (wallet.toLowerCase() !== asset.wallet.toLowerCase()) {notify('Reconnect the wallet that created this application.'); return}
    if (!files.length) {notify('Upload your reality evidence before submitting.'); return}
    setBusy(true)
    try {
      const ids: string[] = []
      for (const file of files) {
        let id = uploaded.current.get(file)
        if (!id) {id = (await uploadFile(file, true)).id; uploaded.current.set(file, id)}
        ids.push(id)
      }
      await api('/assets/' + asset.id + '/proof', {proof_ids: ids, note: note.trim()})
      notify('Application submitted for human review. Token issuance stays locked until approval.')
      go(asset.id)
    } catch (error: any) {notify(error.message)} finally {setBusy(false)}
  }
  return <>
    <div className="rl-heading"><div><h1>Prove your real asset</h1><p>{asset.name} · Private evidence for a Blue V application</p></div></div>
    <div className="rl-create-layout">
      <form className="rl-panel rl-create-form" onSubmit={event => void submit(event)}>
        <div className="rl-steps"><span>01 Project saved</span><b>02 Upload evidence</b><span>03 Human review</span></div>
        <div className="rl-verification-intro"><ShieldCheck size={24}/><div><h2>Your application is not submitted yet</h2><p>Upload evidence below. A reviewer must approve your application before you can issue a verified token.</p></div></div>
        <h2>1. Photograph your challenge code</h2>
        <p className="rl-muted">Write this code on paper and photograph it beside the real item. Both must be readable. For historical memories, follow the category guidance.</p>
        <div className="rl-proof-code">{asset.proof_code}</div>
        <h2>2. Upload original evidence & supporting documents</h2>
        <label className="rl-file-label"><Upload size={20}/>Choose evidence files<input aria-label="Upload verification evidence" type="file" multiple disabled={busy} accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/webm" onChange={event => {
          const selected = Array.from(event.target.files || [])
          if (selected.length > 12) {notify('Choose up to 12 evidence files.'); return}
          if (selected.some(file => file.size > 10 * 1024 * 1024)) {notify('Each evidence file must be under 10 MB.'); return}
          setFiles(selected)
        }}/></label>
        <p className="rl-footnote">JPG / PNG / WebP · PDF · MP4 / WebM · Up to 12 files · 10 MB each. Evidence is private to you and reviewers.</p>
        {files.map((file, index) => <p className="rl-muted" key={index}>{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>)}
        <label className="rl-field">3. Explain your connection to this asset<textarea required minLength={3} maxLength={2000} rows={5} value={note} disabled={busy} onChange={event => setNote(event.target.value)} placeholder="How is this asset connected to you? What does each file prove? Explain any missing documents."/></label>
        <div className="rl-button-row"><button type="submit" className="rl-button" disabled={busy || !files.length}>{busy ? <Loader2 size={16} className="spin"/> : <ShieldCheck size={16}/>}Submit application for review</button><Link to={'/reality/asset/' + asset.id} className="rl-outline">Save for later</Link></div>
        <p className="rl-footnote">Your project is already saved. “Save for later” keeps the project; files selected here are uploaded only when you submit.</p>
      </form>
      <aside><section className="rl-panel rl-inset rl-verification-panel"><RealityVerificationGuide category={asset.category}/></section></aside>
    </div>
  </>
}
