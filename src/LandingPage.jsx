import { useNavigate } from 'react-router-dom'

export default function LandingPage() {
  const navigate = useNavigate()

  const btn = (solid) => ({
    padding: '11px 36px',
    background: solid ? 'white' : 'transparent',
    border: solid ? 'none' : '1px solid rgba(255,255,255,0.2)',
    borderRadius: '3px',
    color: solid ? '#080808' : 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: solid ? 400 : 300,
    letterSpacing: '0.06em',
    transition: 'opacity 0.15s',
  })

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: '#080808',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '56px',
    }}>
      <h1 style={{
        margin: 0,
        color: 'white',
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: 'clamp(2.8rem, 7vw, 5.5rem)',
        fontWeight: 200,
        letterSpacing: '0.22em',
        textTransform: 'lowercase',
      }}>
        postmodel
      </h1>

      <div style={{ display: 'flex', gap: '14px' }}>
        <button style={btn(true)} onClick={() => navigate('/app')}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          Sign In
        </button>
        <button style={btn(false)} onClick={() => navigate('/app?guest=1')}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          Continue as Guest
        </button>
      </div>
    </div>
  )
}
