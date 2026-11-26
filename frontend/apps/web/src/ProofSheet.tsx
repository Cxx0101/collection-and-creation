export type ProofItem = {
  src: string
  alt: string
  label: string
  meta: string
}

export function ProofSheet({
  items,
  compact = false,
  label = '近期产物',
}: {
  items: ProofItem[]
  compact?: boolean
  label?: string
}) {
  return (
    <figure className={`proof-sheet ${compact ? 'is-compact' : ''}`.trim()}>
      <div className="proof-sheet-head">
        <span>{label}</span>
        <span className="proof-sheet-count tabular">{String(items.length).padStart(2, '0')} 张</span>
      </div>
      <div className="proof-grid">
        {items.map((item, index) => (
          <div className="proof-frame" key={`${item.src}-${index}`}>
            <span className="proof-crop tl" aria-hidden="true" />
            <span className="proof-crop tr" aria-hidden="true" />
            <span className="proof-crop bl" aria-hidden="true" />
            <span className="proof-crop br" aria-hidden="true" />
            <img src={item.src} alt={item.alt} loading={index === 0 ? 'eager' : 'lazy'} />
            <div className="proof-caption">
              <span className="proof-index tabular">{String(index + 1).padStart(2, '0')}</span>
              <span className="proof-label">{item.label}</span>
              <span className="proof-meta">{item.meta}</span>
            </div>
          </div>
        ))}
      </div>
    </figure>
  )
}
