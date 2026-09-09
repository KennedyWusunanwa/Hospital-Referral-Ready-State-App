import { createRoot } from 'react-dom/client'
import { initTheme } from './lib/theme'
import './index.css'

// Before the first paint, so the sign-in screen honours the saved preference
// instead of flashing light and correcting itself after the shell mounts.
initTheme()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

const REQUIRED_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const

const missing = REQUIRED_ENV.filter((key) => !import.meta.env[key])

/**
 * A misconfigured deployment is the single most likely first-run failure, and
 * it used to present as a blank white page: `lib/supabase.ts` throws while its
 * module is being evaluated, which is before React can mount and therefore
 * before the error boundary exists. Checking the environment here, and only
 * then importing the app, turns that into something a person can act on.
 *
 * The values are inlined by Vite at build time, so a fix means redeploying,
 * not just editing the variables -- which is exactly the part people miss.
 */
function renderConfigurationRequired(root: HTMLElement, missingKeys: readonly string[]): void {
  createRoot(root).render(
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <main className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Configuration required
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          This deployment cannot reach its database because the following build-time environment
          {missingKeys.length === 1 ? ' variable is' : ' variables are'} missing:
        </p>
        <ul className="mt-3 space-y-1">
          {missingKeys.map((key) => (
            <li
              key={key}
              className="rounded-md bg-slate-100 px-3 py-2 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200"
            >
              {key}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
          Add them in your host&rsquo;s project settings (on Vercel: Settings &rarr; Environment
          Variables), taking the values from the Supabase dashboard under Project Settings &rarr;
          API. Locally, copy <code className="font-mono text-xs">.env.example</code> to{' '}
          <code className="font-mono text-xs">.env</code>.
        </p>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          These are read when the site is <strong>built</strong>, not when it is loaded. After adding
          them you must redeploy &mdash; saving the variables alone will not change this page.
        </p>
      </main>
    </div>,
  )
}

if (missing.length > 0) {
  renderConfigurationRequired(rootElement, missing)
} else {
  void import('./bootstrap').then(({ start }) => start(rootElement))
}
