import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { AppToaster } from './components/layout/AppToaster'
import { ErrorBoundary } from './components/layout/ErrorBoundary'
import { initTheme } from './lib/theme'
import './index.css'

// Before the first paint, so the sign-in screen honours the saved preference
// instead of flashing light and correcting itself after the shell mounts.
initTheme()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Readiness data ages meaningfully within a shift, so keep it fresh but
      // avoid hammering the API on every focus change in a busy ward.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        const message = error instanceof Error ? error.message : ''
        // Never retry an authorisation failure -- it will not start working.
        if (/permission|JWT|not authorised|row-level security/i.test(message)) return false
        return failureCount < 2
      },
    },
    mutations: { retry: 0 },
  },
})

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
            <AppToaster />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
