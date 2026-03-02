interface SluiceLogoProps {
  size?: number
  className?: string
}

export function SluiceLogo({ size = 24, className }: SluiceLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      aria-label="Sluice logo"
    >
      <defs>
        <linearGradient id="sluice-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#333333" />
          <stop offset="50%" stopColor="#333333" />
          <stop offset="50%" stopColor="#2a2a2a" />
          <stop offset="100%" stopColor="#2a2a2a" />
        </linearGradient>
        <radialGradient id="sluice-glow" cx="55%" cy="50%" r="35%">
          <stop offset="0%" stopColor="rgba(5, 150, 105, 0.35)" />
          <stop offset="100%" stopColor="rgba(5, 150, 105, 0)" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill="url(#sluice-bg)" />
      <circle cx="55" cy="50" r="35" fill="url(#sluice-glow)" />
      <path d="M37 20 L82 50 L37 80 Z" fill="#059669" />
    </svg>
  )
}
