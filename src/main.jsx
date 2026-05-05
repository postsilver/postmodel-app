import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.jsx'
import ViewPage from './ViewPage.jsx'
import LandingPage from './LandingPage.jsx'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={
          <ClerkProvider publishableKey={publishableKey}>
            <App />
          </ClerkProvider>
        } />
        <Route path="/view/:id" element={<ViewPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
