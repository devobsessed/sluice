import { ImageResponse } from 'next/og'
import { type NextRequest } from 'next/server'

/**
 * Preview endpoint for favicon iteration.
 * Visit /api/test/favicon-preview to see the icon at 256x256.
 * DELETE THIS FILE when done iterating.
 */
export async function GET(_request: NextRequest) {
  const previewSize = 256

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
            width: 256,
            height: 256,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #333333 0%, #333333 50%, #2a2a2a 50%, #2a2a2a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Subtle glow behind triangle */}
          <div
            style={{
              position: 'absolute',
              width: 140,
              height: 140,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(5, 150, 105, 0.35) 0%, rgba(5, 150, 105, 0) 70%)',
            }}
          />
          {/* Teal play triangle */}
          <svg
            width="160"
            height="160"
            viewBox="0 0 100 100"
            style={{ marginLeft: 14 }}
          >
            <path
              d="M20 8 L90 50 L20 92 Z"
              fill="#059669"
            />
          </svg>
        </div>
      </div>
    ),
    { width: previewSize, height: previewSize },
  )
}
