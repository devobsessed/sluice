import { ImageResponse } from 'next/og'

export const size = {
  width: 180,
  height: 180,
}

export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          borderRadius: '50%',
        }}
      >
        {/* Two-tone grey circle */}
        <div
          style={{
            width: 180,
            height: 180,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #3a3a3a 0%, #3a3a3a 50%, #2a2a2a 50%, #2a2a2a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Teal play triangle */}
          <svg
            width="112"
            height="112"
            viewBox="0 0 100 100"
            style={{ marginLeft: 10 }}
          >
            <path
              d="M20 8 L90 50 L20 92 Z"
              fill="#059669"
            />
          </svg>
        </div>
      </div>
    ),
    { ...size },
  )
}
