type Props = {
  seed?: number
  label?: string
  sublabel?: string
  className?: string
  url?: string
  alt?: string
  kind?: string
  fit?: 'cover' | 'contain'
}

const palettes = [
  ['#18181B', '#DB2777', '#F472B6', '#FDF2F8'],
  ['#0F172A', '#2563EB', '#38BDF8', '#EFF6FF'],
  ['#14532D', '#10B981', '#6EE7B7', '#ECFDF5'],
  ['#3B0764', '#9333EA', '#E879F9', '#FAF5FF'],
  ['#431407', '#EA580C', '#FDBA74', '#FFF7ED'],
  ['#1E293B', '#E11D48', '#FDA4AF', '#FFF1F2'],
]

export function Artwork({ seed = 0, label = 'AI Visual', sublabel = 'SparkStudio', className, url, alt, kind = 'image', fit = 'cover' }: Props) {
  if (url) {
    if (kind === 'video') {
      return <video className={className} src={url} aria-label={alt || label} controls style={{ width: '100%', height: '100%', objectFit: fit }} />
    }
    return <img className={className} src={url} alt={alt || label} style={{ width: '100%', height: '100%', objectFit: fit }} />
  }
  const p = palettes[Math.abs(seed) % palettes.length]
  const gid = `art-grad-${Math.abs(seed)}-${String(label).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`
  return (
    <svg className={className} viewBox="0 0 400 250" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p[0]} />
          <stop offset="55%" stopColor={p[1]} />
          <stop offset="100%" stopColor={p[2]} />
        </linearGradient>
      </defs>
      <rect width="400" height="250" fill={`url(#${gid})`} />
      <circle cx={70 + (seed * 37) % 180} cy={60 + (seed * 23) % 90} r={52 + (seed % 3) * 14} fill={p[3]} fillOpacity="0.16" />
      <rect x="26" y="156" width="348" height="68" rx="14" fill="rgba(9,9,11,0.52)" />
      <text x="42" y="185" fill="#FFFFFF" fontSize="16" fontWeight="700" fontFamily="Inter,Noto Sans SC,sans-serif">
        {label.length > 26 ? `${label.slice(0, 26)}…` : label}
      </text>
      <text x="42" y="207" fill="#E4E4E7" fontSize="12" fontWeight="500" fontFamily="Inter,Noto Sans SC,sans-serif">
        {sublabel.length > 36 ? `${sublabel.slice(0, 36)}…` : sublabel}
      </text>
    </svg>
  )
}

export function ProductArt({ seed = 0, kind = 'product' }: { seed?: number; kind?: string }) {
  const bg = ['#FEF3C7', '#FDF2F8', '#EFF6FF', '#ECFDF5', '#F8FAFC', '#FAF5FF'][Math.abs(seed) % 6]
  return (
    <svg viewBox="0 0 340 250" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect width="340" height="250" fill={bg} />
      <ellipse cx="170" cy="216" rx="70" ry="10" fill="rgba(9,9,11,0.12)" />
      <rect x="127" y="92" width="86" height="110" rx="14" fill="#FFFFFF" stroke="#D4D4D8" />
      <rect x="142" y="68" width="56" height="32" rx="9" fill={kind === 'garment' ? '#DBEAFE' : '#FBCFE8'} />
      <circle cx="170" cy="143" r="24" fill={kind === 'garment' ? '#2563EB' : '#DB2777'} opacity="0.14" />
      <path d="M154 143h32M170 127v32" stroke={kind === 'garment' ? '#2563EB' : '#DB2777'} strokeWidth="4" strokeLinecap="round" />
      <text x="170" y="186" textAnchor="middle" fill="#52525B" fontSize="10" fontWeight="600" fontFamily="Inter,Noto Sans SC,sans-serif">
        PRODUCT REFERENCE
      </text>
    </svg>
  )
}

export function ModelArt({ seed = 0, label = 'MODEL' }: { seed?: number; label?: string }) {
  return (
    <svg viewBox="0 0 260 260" aria-hidden="true">
      <defs>
        <linearGradient id={`model-bg-${seed}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F4F4F5" />
          <stop offset="100%" stopColor="#E4E4E7" />
        </linearGradient>
      </defs>
      <rect width="260" height="260" fill={`url(#model-bg-${seed})`} />
      <circle cx="130" cy="82" r="30" fill="#FFFFFF" stroke="#D4D4D8" />
      <path d="M66 218c8-59 37-88 64-88s56 29 64 88" fill="#FFFFFF" stroke="#D4D4D8" />
      <rect x="91" y="102" width="78" height="112" rx="18" fill={seed % 2 ? '#DBEAFE' : '#FCE7F3'} opacity="0.9" />
      <text x="130" y="243" textAnchor="middle" fill="#52525B" fontSize="9" fontWeight="700" fontFamily="Inter,Noto Sans SC,sans-serif">
        {label}
      </text>
    </svg>
  )
}
