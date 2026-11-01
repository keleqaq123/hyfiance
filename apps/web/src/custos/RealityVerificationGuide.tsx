import React from 'react'
import {ShieldCheck} from 'lucide-react'

const evidence: Record<string, {title: string; items: string[]}> = {
  memories: {
    title: 'Memories & pets',
    items: [
      'Pets: recent photos from different angles and a short video with your challenge code. Add a vet record, microchip record or adoption document if available.',
      'Memories: the original photo or video, its date and context, and evidence of your connection to the people or event. For an old photo or letter, photograph the original with your challenge code.',
      'If the original item or pet is no longer available, explain this and provide original files or supporting records for review.',
    ],
  },
  things: {
    title: 'Objects & collectibles',
    items: [
      'Clear photos of the front, back and identifying details, plus a photo or short video with your handwritten challenge code.',
      'An invoice, purchase receipt, ownership record or signed transfer document connecting the item to you.',
      'Include serial numbers, maker marks or authenticity certificates when available. For your own artwork, include creation records.',
    ],
  },
  assets: {
    title: 'Property & businesses',
    items: [
      'Property: current photos and a title, land registry extract or other document identifying the property and its owner.',
      'Business: registration documents and evidence that you own the business or are authorized to represent it.',
      'For receivables, IP or commercial rights, include the relevant contract and evidence of your entitlement. If acting for an owner, include their authorization.',
    ],
  },
}

export default function RealityVerificationGuide({category, optional = false}: {category: string; optional?: boolean}) {
  const selected = evidence[category] || evidence.things
  return <div className="rl-verification-guide">
    <div className="rl-verification-heading"><ShieldCheck size={22}/><h2>Blue V evidence checklist</h2></div>
    <p className="rl-muted">{optional ? 'Optional for open launches. Submit these materials if you want to apply for Blue V.' : 'Prepare these materials before applying. A reviewer checks the evidence before a Blue V badge is granted.'}</p>
    <h3>For every application</h3>
    <ol>
      <li><strong>Original evidence.</strong> Use your own photos or videos. Downloaded images and AI-generated images cannot serve as proof of reality.</li>
      <li><strong>A fresh challenge photo.</strong> Save your project to receive a challenge code, then photograph the real item with that code handwritten on paper. Keep both clearly visible.</li>
      <li><strong>Your connection.</strong> Explain what the item is, how you are connected to it, and what each uploaded file proves.</li>
    </ol>
    <h3>{selected.title}: supporting materials</h3>
    <ul>{selected.items.map(item => <li key={item}>{item}</li>)}</ul>
    <div className="rl-verification-upload"><strong>Upload after saving your project</strong><span>JPG / PNG / WebP · PDF · MP4 / WebM</span><span>Up to 12 files · Maximum 10 MB per file</span></div>
    <p className="rl-footnote">Evidence uploads are private to you and reviewers. Hide unrelated sensitive details, but keep the item, dates and ownership or authorization details readable. Reviewers may request clearer or additional evidence.</p>
    <p className="rl-inline-note"><strong>What Blue V means:</strong> Custos has reviewed evidence of reality and your connection to the submission. It does not certify a price, guarantee returns or transfer legal ownership to token holders.</p>
  </div>
}
