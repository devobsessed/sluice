import { ImageResponse } from 'next/og'

export const size = {
  width: 32,
  height: 32,
}

export const contentType = 'image/png'

export default function Icon() {
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
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #3a3a3a 0%, #3a3a3a 50%, #2a2a2a 50%, #2a2a2a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Teal play triangle */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 100 100"
            style={{ marginLeft: 2 }}
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
