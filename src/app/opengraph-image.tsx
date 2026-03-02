import { ImageResponse } from 'next/og'

export const alt = 'Sluice — Turn YouTube into a Knowledge Bank'

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

async function loadGoogleFont(font: string, weight: number, text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${font}:wght@${weight}&text=${encodeURIComponent(text)}`
  const css = await (await fetch(url)).text()
  const match = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)
  if (!match?.[1]) {
    throw new Error(`Failed to load font: ${font} ${weight}`)
  }
  const response = await fetch(match[1])
  return response.arrayBuffer()
}

export default async function Image() {
  const titleText = 'SLUICE'
  const descriptorText = 'Turn YouTube into a Knowledge Bank'

  const [interBold, interRegular] = await Promise.all([
    loadGoogleFont('Inter', 700, titleText),
    loadGoogleFont('Inter', 400, descriptorText),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1c1c1c',
          padding: '60px',
        }}
      >
        {/* Logo + Title lockup */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 32,
          }}
        >
          {/* Sluice logo */}
          <svg
            width="88"
            height="88"
            viewBox="0 0 100 100"
          >
            <defs>
              <linearGradient id="og-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#333333" />
                <stop offset="50%" stopColor="#333333" />
                <stop offset="50%" stopColor="#2a2a2a" />
                <stop offset="100%" stopColor="#2a2a2a" />
              </linearGradient>
              <radialGradient id="og-glow" cx="55%" cy="50%" r="35%">
                <stop offset="0%" stopColor="rgba(5, 150, 105, 0.35)" />
                <stop offset="100%" stopColor="rgba(5, 150, 105, 0)" />
              </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="50" fill="url(#og-bg)" />
            <circle cx="55" cy="50" r="35" fill="url(#og-glow)" />
            <path d="M37 20 L82 50 L37 80 Z" fill="#059669" />
          </svg>
          <div
            style={{
              fontSize: 96,
              fontFamily: 'Inter Bold',
              fontWeight: 700,
              color: '#fafafa',
              letterSpacing: '0.25em',
              lineHeight: 1,
            }}
          >
            {titleText}
          </div>
        </div>

        {/* Teal accent line */}
        <div
          style={{
            width: 200,
            height: 3,
            backgroundColor: '#059669',
            marginTop: 32,
            marginBottom: 32,
          }}
        />

        {/* Descriptor */}
        <div
          style={{
            fontSize: 28,
            fontFamily: 'Inter Regular',
            fontWeight: 400,
            color: '#a3a3a3',
            lineHeight: 1,
          }}
        >
          {descriptorText}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: 'Inter Bold',
          data: interBold,
          style: 'normal',
          weight: 700,
        },
        {
          name: 'Inter Regular',
          data: interRegular,
          style: 'normal',
          weight: 400,
        },
      ],
    },
  )
}
